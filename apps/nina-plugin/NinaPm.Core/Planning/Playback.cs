using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Planning;

/// <summary>Wiedergabe-Art (FA-NIN-12, Scheduler-Einstellung).</summary>
public enum PlaybackMode
{
    /// <summary>
    /// Nach der Planuhr <c>now − offset</c>: der letzte fällige <c>expose</c>-Eintrag (<c>atUtc ≤ now − offset</c>) ist dran,
    /// frühere fällige sind verpasst (<c>skipped_timeaware</c>). Vorschlag zur Spec-Korrektur: execution.md §4.2 schreibt
    /// <c>now + offset</c>; mit dem Verzug als positivem Offset würde das bei Verzug mehr Belichtungen verwerfen, nicht weniger.
    /// </summary>
    TimeAware,

    /// <summary>Strikt der nächste <c>expose</c>-Eintrag, kein Offset.</summary>
    Sequential,
}

/// <summary>Was als Nächstes im Block geschieht.</summary>
public enum PlaybackKind
{
    /// <summary>Belichtung <see cref="PlaybackStep.EntryIndex"/> jetzt starten.</summary>
    Expose,

    /// <summary>Zu früh: bis <see cref="PlaybackStep.WaitUntilUtc"/> warten (zeitgeführt).</summary>
    Wait,

    /// <summary>Block beenden; Grund in <see cref="PlaybackStep.EndReason"/> (<c>completed</c> oder <c>night_end</c>).</summary>
    End,
}

public sealed record PlaybackStep(PlaybackKind Kind, int? EntryIndex, IReadOnlyList<int> Skipped, DateTimeOffset? WaitUntilUtc, string? EndReason)
{
    public static PlaybackStep End(string reason, IReadOnlyList<int> skipped) => new(PlaybackKind.End, null, skipped, null, reason);
}

/// <summary>
/// Auswahl der nächsten Belichtung im Block (execution.md §4.2, TK 10.3 Nr. 7) als reine Logik. Der Offset (kumulierter
/// Verzug aus Nicht-Belichtungsaktionen und Startverzug, NT-21) wird vom Adapter gemessen und hier nur angewandt.
/// Blockschluss: eine Belichtung beginnt nur, wenn <c>now + exposureS + downloadS ≤ blockEnd</c> – bzw. bis zum weichen
/// Blockende <see cref="SoftEnd"/>, wenn die Zeit danach im Plan frei ist (Spec-Ergänzung 06.10.2026); Ausnahme
/// <c>lastOfNight</c> mit der Kulanzgrenze <c>min(darknessEndUtc, block.twilightEndUtc)</c> (NT-13, M4).
/// </summary>
public static class Playback
{
    /// <summary>Mehr übersprungene Belichtungen je Block → Neuplanung <c>refresh</c> bei der nächsten Gelegenheit.</summary>
    public const int MaxSkippedBeforeReplan = 3;

    /// <summary>Höchstens so weit darf eine verspätete Belichtung über das Blockende laufen (ein Slot der Engine).</summary>
    public static readonly TimeSpan SoftEndMax = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Verzugstoleranz (AP-71, „Block passt noch“, execution.md §4.1/§4.2, allocation.md §8.1): Die Engine legt
    /// <c>endUtc</c> auf das Ende der letzten Aktion, und der nächste Block rückt direkt dahinter (A-35) – es bleibt keine
    /// Sekunde Spiel. Bis zu dieser Dauer darf der aufgelaufene Verzug (Startverzug eingeschlossen) die letzte Belichtung über
    /// <c>endUtc</c> schieben; der nächste Block beginnt dann entsprechend später und baut den Verzug selbst ab.
    /// Rig-Nacht 08./09.10.2026: 0,7 s Startverzug → <c>BLOCK_SKIPPED elapsed</c> für einen Block mit einer Belichtung.
    /// </summary>
    public static readonly TimeSpan LateGraceMax = TimeSpan.FromSeconds(60);

    /// <summary>
    /// Blockende mit Verzugstoleranz: <c>endUtc + min(Verzug, LateGraceMax)</c>, mindestens das weiche Blockende
    /// <paramref name="softEndUtc"/>. Transitblöcke enden hart (Fensterende).
    /// </summary>
    public static DateTimeOffset? WithLateGrace(Blocks block, DateTimeOffset? softEndUtc, TimeSpan late)
    {
        if (block.Kind == BlocksKind.Transit || late <= TimeSpan.Zero) return softEndUtc;
        var grace = block.EndUtc + (late < LateGraceMax ? late : LateGraceMax);
        return softEndUtc is { } s && s > grace ? s : grace;
    }

    /// <param name="after">Index des zuletzt abgearbeiteten Eintrags (-1 am Blockanfang).</param>
    /// <param name="softEndUtc">Weiches Blockende (<see cref="SoftEnd"/>); <c>null</c> = harter Blockschluss bei <c>endUtc</c>.</param>
    /// <param name="pullForward">
    /// Vorgezogene Planuhr (Plugin 0.4.18, execution.md §4.2): frei gewordene Plan-Zeit (Flip, Warten, Zentrieren schon
    /// erledigt, Slew entfallen), nachdem der Verzug 0 erreicht hat; nie negativ. Die Planuhr ist dann <c>now − offset +
    /// pullForward</c> – die nächste Belichtung beginnt, statt die frei gewordene Zeit abzuwarten.
    /// </param>
    public static PlaybackStep Next(
        Blocks block,
        int after,
        DateTimeOffset now,
        TimeSpan offset,
        PlaybackMode mode,
        DateTimeOffset? darknessEndUtc,
        double downloadS,
        DateTimeOffset? softEndUtc = null,
        TimeSpan pullForward = default)
    {
        var entries = block.Entries;
        var all = Enumerable.Range(after + 1, Math.Max(0, entries.Count - after - 1))
            .Where(i => entries[i].Cmd is EntriesCmd.Expose or EntriesCmd.Expose_series)
            .ToList();
        if (all.Count == 0) return PlaybackStep.End("completed", []);
        if (entries[all[0]].Cmd == EntriesCmd.Expose_series)
            return Series(block, all[0], now, offset, mode, darknessEndUtc, downloadS);
        // Belichtungen bis zur nächsten Serie (ein Block enthält praktisch nur eine der beiden Arten).
        var exposes = all.TakeWhile(i => entries[i].Cmd == EntriesCmd.Expose).ToList();

        var skipped = new List<int>();
        int chosen;
        if (mode == PlaybackMode.Sequential)
        {
            chosen = exposes[0];
        }
        else
        {
            if (offset < TimeSpan.Zero) offset = TimeSpan.Zero;
            if (pullForward < TimeSpan.Zero) pullForward = TimeSpan.Zero;
            // Planuhr: der Plan ist um den Verzug nach hinten gerutscht (bzw. um frei gewordene Zeit nach vorn).
            var shift = offset - pullForward;
            var planClock = now - shift;
            var due = exposes.Where(i => entries[i].AtUtc <= planClock).ToList();
            if (due.Count == 0)
                return new PlaybackStep(PlaybackKind.Wait, exposes[0], [], entries[exposes[0]].AtUtc + shift, null);
            // Der letzte fällige Eintrag ist dran; alle früheren fälligen sind verpasst.
            chosen = due[^1];
            skipped.AddRange(due.Take(due.Count - 1));
        }

        var e = entries[chosen];
        var finish = now.AddSeconds((e.ExposureS ?? 0) + downloadS);
        if (finish <= block.EndUtc || now < block.EndUtc && finish <= EndFor(block, softEndUtc))
            return new PlaybackStep(PlaybackKind.Expose, chosen, skipped, null, null);

        var limit = KulanzLimit(darknessEndUtc, block.TwilightEndUtc);
        if (e.LastOfNight == true && limit is { } l && finish <= l)
            return new PlaybackStep(PlaybackKind.Expose, chosen, skipped, null, null);
        return PlaybackStep.End(limit is { } k && finish > k ? "night_end" : "completed", skipped);
    }

    /// <summary>
    /// Transitserie (execution.md §5, transit.md §3): dieselbe Belichtung wiederholt ab <c>atUtc</c> (Fensterbeginn)
    /// bis <c>untilUtc</c>, unabhängig von Anzahl und Planungsbedarf. Kein Verzug: das Fenster ist fest, die Serie wartet
    /// nie über <c>atUtc</c> hinaus und verwirft keine Belichtungen. Passt die nächste Belichtung nicht mehr vor
    /// <c>min(untilUtc, endUtc)</c>, ist die Serie erledigt und die Einträge danach folgen.
    /// </summary>
    private static PlaybackStep Series(Blocks block, int index, DateTimeOffset now, TimeSpan offset, PlaybackMode mode,
        DateTimeOffset? darknessEndUtc, double downloadS)
    {
        var e = block.Entries[index];
        if (now < e.AtUtc) return new PlaybackStep(PlaybackKind.Wait, index, [], e.AtUtc, null);
        var until = e.UntilUtc is { } u && u < block.EndUtc ? u : block.EndUtc;
        if (now.AddSeconds((e.ExposureS ?? 0) + downloadS) <= until)
            return new PlaybackStep(PlaybackKind.Expose, index, [], null, null);
        return Next(block, index, now, offset, mode, darknessEndUtc, downloadS);
    }

    /// <summary>Eintrag gehört zu einer Transitserie, die der Executor wiederholt (Cursor bleibt davor).</summary>
    public static bool Repeats(Entries entry) => entry.Cmd == EntriesCmd.Expose_series;

    /// <summary>
    /// Weiches Blockende (execution.md §4.2, Spec-Ergänzung 06.10.2026): Ist die Zeit nach dem Block im Plan frei, darf
    /// eine Belichtung, die wegen Verzug nicht mehr vor <c>endUtc</c> endet, noch <b>vor</b> <c>endUtc</c> beginnen
    /// (also höchstens eine über das Blockende hinaus), wenn sie spätestens beim
    /// nächsten geplanten Block (<paramref name="nextBlockStartUtc"/>, Slew-Beginn), beim Nachtende
    /// (<see cref="KulanzLimit"/>) und <see cref="SoftEndMax"/> nach <c>endUtc</c> endet – die Engine hat Höhe und Mond
    /// nur bis zum Blockende geprüft. Transitblöcke enden hart (Fensterende). Liegt die Grenze nicht hinter
    /// <c>endUtc</c>, gilt <c>endUtc</c>.
    /// </summary>
    public static DateTimeOffset SoftEnd(Blocks block, DateTimeOffset? nextBlockStartUtc, DateTimeOffset? darknessEndUtc)
    {
        if (block.Kind == BlocksKind.Transit) return block.EndUtc;
        var end = block.EndUtc + SoftEndMax;
        if (nextBlockStartUtc is { } n && n < end) end = n;
        if (KulanzLimit(darknessEndUtc, block.TwilightEndUtc) is { } k && k < end) end = k;
        return end > block.EndUtc ? end : block.EndUtc;
    }

    private static DateTimeOffset EndFor(Blocks block, DateTimeOffset? softEndUtc) =>
        softEndUtc is { } s && s > block.EndUtc ? s : block.EndUtc;

    /// <summary><c>min(darknessEndUtc, block.twilightEndUtc)</c>; <c>null</c>-Werte zählen nicht (NT-13).</summary>
    public static DateTimeOffset? KulanzLimit(DateTimeOffset? darknessEndUtc, DateTimeOffset? twilightEndUtc) =>
        (darknessEndUtc, twilightEndUtc) switch
        {
            ({ } a, { } b) => a < b ? a : b,
            ({ } a, null) => a,
            (null, { } b) => b,
            _ => null,
        };

    /// <summary>Mehr als 3 übersprungene Belichtungen im Block → Neuplanung (execution.md §4.2).</summary>
    public static bool NeedsReplan(int skippedInBlock) => skippedInBlock > MaxSkippedBeforeReplan;
}
