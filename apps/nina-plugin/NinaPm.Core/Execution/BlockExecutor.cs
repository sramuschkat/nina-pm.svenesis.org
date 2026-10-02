using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Planning;
using NinaPm.Core.Time;

namespace NinaPm.Core.Execution;

/// <summary>Ergebnis eines Blocks: genau ein <c>block_skipped</c>- oder <c>block_end</c>-Grund (execution.md §4.1).</summary>
public sealed record BlockOutcome(bool Started, string Reason, int Exposures, int SkippedTimeAware)
{
    public bool Skipped => !Started;

    /// <summary>Mehr als 3 verpasste Belichtungen → beim nächsten Mal <c>refresh</c> (§4.2).</summary>
    public bool NeedsReplan => Playback.NeedsReplan(SkippedTimeAware);
}

/// <summary>
/// Ein Block je Aufruf nach dem Astro-PM-Muster (execution.md §4.1/§4.2, TK 10.3 Nr. 4/7), als Kernlogik über
/// <see cref="IBlockHost"/>: Vorprüfungen (vorbei, ohne Belichtung, nicht machbar), Warten auf den Blockstart, Ziel
/// setzen, Slew/Zentrieren mit Wiederholungsleiter, Trigger-Set vor Zielwechsel, Guiding, Einträge nach der Tabelle
/// Eintrag → Aktion mit <see cref="Playback"/> und hartem Blockschluss, Trigger-Set nach Zielwechsel.
/// Abbrüche (Unterbrechung, Benutzer, eigene) wirft der Executor weiter; die Einordnung macht der Container (§4.6).
/// </summary>
public sealed class BlockExecutor(IBlockHost host, IClock clock, NinaPmLog log)
{
    /// <summary>Wartezeiten zwischen Zentrier-Versuchen (§4.1 Nr. 5).</summary>
    public static readonly int[] CenterRetryS = [15, 15, 30, 60, 120, 300, 300, 600, 600];

    /// <summary>Download-Zeit je Belichtung für den Blockschluss; Rig-Einstellung, Standard 3 s.</summary>
    public double DownloadS { get; init; } = 3;

    public PlaybackMode Mode { get; init; } = PlaybackMode.Sequential;

    /// <summary>Verzug für das zeitgeführte Playback; misst AP-16f, bis dahin 0.</summary>
    public Func<TimeSpan> Offset { get; init; } = () => TimeSpan.Zero;

    /// <summary>
    /// Ein Block. <paramref name="inBlockCheck"/> (execution.md §3.2) läuft alle 15 min vor einer Belichtung mit dem
    /// anstehenden Eintrag; liefert er einen Grund (<c>target_removed</c>, <c>transit_interrupt</c>), endet der Block nach
    /// der laufenden Belichtung mit diesem Grund.
    /// </summary>
    public async Task<BlockOutcome> RunAsync(Blocks block, DateTimeOffset? darknessEndUtc, CancellationToken token,
        Func<Entries, CancellationToken, Task<string?>>? inBlockCheck = null)
    {
        var skip = PreCheck(block);
        if (skip is not null) return Skip(block, skip);

        var start = ReplanPolicy.PlannedStart(block);
        if (clock.UtcNow < start) await host.DelayAsync(start, token).ConfigureAwait(false);
        if (block.EndUtc <= clock.UtcNow) return Skip(block, "elapsed");
        if (!host.IsViableNow(block)) return Skip(block, "not_viable");

        host.SetTarget(block);
        if (!host.CanSkipSlew(block) && !await CenterWithRetriesAsync(block, token).ConfigureAwait(false))
            return Skip(block, "center_failed");

        log.Event("BLOCK_START", ("id", block.Id), ("atUtc", clock.UtcNow));
        await host.BeforeTargetChangeAsync(token).ConfigureAwait(false);
        await host.StartGuidingAsync(token).ConfigureAwait(false);

        var (reason, exposures, skipped) = await EntriesAsync(block, darknessEndUtc, inBlockCheck, token).ConfigureAwait(false);

        await host.AfterTargetChangeAsync(token).ConfigureAwait(false);
        log.Event("BLOCK_END", ("id", block.Id), ("reason", reason));
        return new BlockOutcome(true, reason, exposures, skipped);
    }

    /// <summary>§4.1 Nr. 1: vorbei bzw. ohne Belichtung; Filterprüfung (<c>filter_not_found</c>) folgt mit AP-16d.</summary>
    private string? PreCheck(Blocks block)
    {
        if (block.EndUtc <= clock.UtcNow) return "elapsed";
        if (!block.Entries.Any(e => e.Cmd is EntriesCmd.Expose or EntriesCmd.Expose_series)) return "no_exposures";
        return null;
    }

    private BlockOutcome Skip(Blocks block, string reason)
    {
        log.Event("BLOCK_SKIPPED", ("id", block.Id), ("reason", reason));
        return new BlockOutcome(false, reason, 0, 0);
    }

    /// <summary>
    /// Wiederholungsleiter 15, 15, 30, 60, 120, 300, 300, 600, 600 s; nicht warten, wenn der nächste Versuch nach
    /// Blockende läge; danach <c>center_failed</c> (§4.1 Nr. 5).
    /// </summary>
    private async Task<bool> CenterWithRetriesAsync(Blocks block, CancellationToken token)
    {
        for (var attempt = 0; ; attempt++)
        {
            var r = await host.SlewCenterAsync(block, token).ConfigureAwait(false);
            if (r.Success) return true;
            log.Warning("WARNING", ("code", "center_failed"), ("block", block.Id), ("index", attempt + 1));
            if (attempt >= CenterRetryS.Length) return false;
            var next = clock.UtcNow.AddSeconds(CenterRetryS[attempt]);
            if (next >= block.EndUtc) return false;
            await host.DelayAsync(next, token).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Einträge nach §4.2: Belichtungen wählt <see cref="Playback"/> (verpasste → <c>SKIPPED_TIMEAWARE</c>), die übrigen
    /// Einträge zwischen zwei Belichtungen werden in Planreihenfolge ausgeführt. <c>wait</c> endet spätestens beim
    /// folgenden <c>meridian_flip</c>; <c>autofocus_hint</c> und Slew-Einträge sind Zeitmarken.
    /// </summary>
    private async Task<(string Reason, int Exposures, int Skipped)> EntriesAsync(Blocks block, DateTimeOffset? darknessEndUtc,
        Func<Entries, CancellationToken, Task<string?>>? inBlockCheck, CancellationToken token)
    {
        var entries = block.Entries;
        var lastCheck = clock.UtcNow;
        var cursor = -1;
        var exposures = 0;
        var skippedTotal = 0;
        while (true)
        {
            token.ThrowIfCancellationRequested();
            var step = Playback.Next(block, cursor, clock.UtcNow, Offset(), Mode, darknessEndUtc, DownloadS);
            foreach (var i in step.Skipped)
            {
                log.Event("SKIPPED_TIMEAWARE", ("id", block.Id), ("index", entries[i].Seq));
                skippedTotal++;
            }
            if (step.Kind == PlaybackKind.End)
            {
                // Abschließende Nicht-Belichtungen (z. B. Dither nach der letzten Belichtung) entfallen mit dem Blockschluss.
                return (step.EndReason!, exposures, skippedTotal);
            }
            var target = step.EntryIndex!.Value;
            // Nicht-Belichtungen zwischen der letzten und der gewählten Belichtung; übersprungene Belichtungen nehmen
            // ihre Zwischen-Einträge mit (nur Filterwechsel bleiben wirksam).
            for (var i = cursor + 1; i < target; i++)
                await RunNonExposureAsync(block, i, target, skip: step.Skipped.Count > 0 && i < step.Skipped[^1], token).ConfigureAwait(false);
            if (step.Kind == PlaybackKind.Wait)
            {
                await host.DelayAsync(step.WaitUntilUtc!.Value, token).ConfigureAwait(false);
                cursor = target - 1;
                continue;
            }
            if (inBlockCheck is not null && ReplanPolicy.InBlockCheckDue(lastCheck, clock.UtcNow))
            {
                lastCheck = clock.UtcNow;
                var end = await inBlockCheck(entries[target], token).ConfigureAwait(false);
                if (end is not null) return (end, exposures, skippedTotal);
            }
            var result = await host.ExposeAsync(block, entries[target], token).ConfigureAwait(false);
            if (result == ExposureResult.Saved) exposures++;
            cursor = target;
        }
    }

    private async Task RunNonExposureAsync(Blocks block, int index, int nextExpose, bool skip, CancellationToken token)
    {
        var e = block.Entries[index];
        switch (e.Cmd)
        {
            case EntriesCmd.Filter:
                await host.ChangeFilterAsync(e, token).ConfigureAwait(false);
                break;
            case EntriesCmd.Dither when !skip:
                await host.DitherAsync(token).ConfigureAwait(false);
                break;
            case EntriesCmd.Meridian_flip:
                // Ein verpasster Flip-Zeitpunkt entbindet nicht vom Flip (NINA flippt ab der frühesten Flipzeit).
                await host.MeridianFlipAsync(block, e, token).ConfigureAwait(false);
                break;
            case EntriesCmd.Wait when !skip:
                var until = e.AtUtc.AddSeconds(e.DurationS ?? 0);
                var flip = block.Entries.Skip(index + 1).Take(nextExpose - index - 1)
                    .FirstOrDefault(x => x.Cmd == EntriesCmd.Meridian_flip);
                if (flip is not null && flip.AtUtc < until) until = flip.AtUtc;
                if (until > clock.UtcNow) await host.DelayAsync(until, token).ConfigureAwait(false);
                break;
            default:
                // slew_center(_rotate) im Block (Panelwechsel nach Flip) übernimmt AP-16f; autofocus_hint ist Zeitmarke (NT-24).
                break;
        }
    }
}
