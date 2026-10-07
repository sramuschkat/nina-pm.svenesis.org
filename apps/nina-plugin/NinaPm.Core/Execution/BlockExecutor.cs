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

/// <summary>Soll der Kamera (Rig <c>camera.setpointC</c>, <c>toleranceC</c>; NT-E2).</summary>
public sealed record CoolingTarget(double SetpointC, double ToleranceC);

/// <summary>
/// Kühlung nur prüfen und warnen (NT-E2, §4.1 Nr. 3): abweichend, wenn der Kühler aus ist oder
/// <c>|Temperatur − Soll| &gt; Toleranz</c>; ohne Soll bzw. ohne Messwert keine Abweichung.
/// </summary>
public static class CoolingCheck
{
    public static bool Deviates(CoolingTarget? target, CameraCooling reading)
    {
        if (target is null) return false;
        if (!reading.CoolerOn) return true;
        return reading.TemperatureC is { } t && !double.IsNaN(t) && Math.Abs(t - target.SetpointC) > target.ToleranceC;
    }
}

/// <summary>Winkelprüfung (flip-rotation.md §3): Toleranz und Überspringen bei Abweichung ohne Rotator (Rig <c>rotator</c>).</summary>
public sealed record RotationSettings(double ToleranceDeg, bool SkipOnMismatch)
{
    /// <summary>
    /// Winkelprüfung nur mit Rotator im Rig oder mit <em>Bei Abweichung überspringen</em> (Entscheidung Sven 06.10.2026):
    /// Ohne Rotator meldete das Plugin sonst vor jedem Block <c>ROTATION_MISMATCH</c>, obwohl sich nichts drehen lässt und
    /// belichtet wird (Rig-Nacht Starfront: 136° gemessen, 0° erwartet). Ohne Prüfung entfällt auch das eigene Plate-Solve.
    /// </summary>
    public static RotationSettings? For(bool rotatorPresent, double toleranceDeg, bool skipOnMismatch) =>
        rotatorPresent || skipOnMismatch ? new RotationSettings(toleranceDeg, skipOnMismatch) : null;
}

/// <summary>
/// Zusätze für einen Block: Prüfung im Block alle 15 min (§3.2), Kühlungs-Soll mit Warnung höchstens einmal je Block
/// (NT-E2), ein Abbruchgrund vor jeder Belichtung (z. B. <c>lease_lost</c>, §6), Flip- und Rotationseinstellungen des
/// Rigs (AP-16f), Playback-Modus des Rigs und Meldungen an den Server (Ereignis, Code); Download-Zeit des Rigs
/// (<c>overhead.downloadS</c>, wie die Engine) und weiches Blockende (<see cref="Playback.SoftEnd"/>, Plugin 0.4.8);
/// Blockstart nach dem Zentrieren mit Beginn des Anfahrens und zeitgeführt übersprungene Belichtungen für das Nachtjournal
/// (AP-53b; <see cref="Started"/> mit Beginn und ob der Slew entfiel, Plugin 0.4.19). <see cref="Report"/> trägt beim Flip dessen Ende als Zeitpunkt (Plugin 0.4.18); <see cref="FlipDoneTonight"/>
/// meldet, ob für die Einheit des Blocks in dieser Nacht schon ein Flip erledigt ist (<c>flipDoneByPanel</c>).
/// </summary>
public sealed record BlockRunOptions(
    Func<Entries, CancellationToken, Task<string?>>? InBlockCheck = null,
    CoolingTarget? Cooling = null,
    Action<Blocks>? TemperatureWarning = null,
    Func<string?>? StopReason = null,
    FlipSettings? Flip = null,
    RotationSettings? Rotation = null,
    PlaybackMode? Mode = null,
    Action<EventsKind, string?, Blocks, double?, DateTimeOffset?>? Report = null,
    Action<Blocks>? FlipDone = null,
    Func<bool>? SkipRequested = null,
    Func<bool>? TargetsChanged = null,
    Func<DateTimeOffset?>? TransitDeadline = null,
    Func<TimeSpan>? InBlockInterval = null,
    double? DownloadS = null,
    DateTimeOffset? SoftEndUtc = null,
    Action<Blocks, DateTimeOffset, bool>? Started = null,
    Action<Blocks, Entries>? EntrySkipped = null,
    Func<Blocks, bool>? FlipDoneTonight = null);

/// <summary>Was ein laufender Block gerade tut, wenn keine Belichtung läuft (Fenster im Imaging-Reiter, Plugin 0.4.18).</summary>
public enum BlockActivityKind
{
    /// <summary>Schneller als geplant: Warten auf den geplanten Zeitpunkt der nächsten Belichtung (<c>WAIT_PLAN</c>).</summary>
    WaitPlan,

    /// <summary>Plan-Eintrag <c>wait</c> bis zu seinem Ende (<c>WAIT_ENTRY</c>).</summary>
    WaitEntry,

    /// <summary>Plan-Eintrag <c>wait</c> vor einem <c>meridian_flip</c>: Warten auf den Meridian (<c>WAIT_ENTRY reason=meridian</c>).</summary>
    WaitMeridian,

    /// <summary>Warten auf NINAs früheste Flipzeit (<c>WAIT_FLIP</c>).</summary>
    WaitFlip,

    /// <summary>Trigger zur Flipzeit laufen (NINAs Meridian-Flip).</summary>
    Flip,

    /// <summary>Slew bzw. Zentrieren (Blockbeginn oder nach einem Flip).</summary>
    Centering,
}

/// <summary>
/// Tätigkeit des Blocks außerhalb einer Belichtung: Art, Beginn, Ende (falls bekannt) und der Plan-Eintrag, zu dem sie gehört
/// (<c>null</c>, z. B. beim Zentrieren nach einem ungeplanten Flip oder beim Warten auf die nächste Belichtung).
/// </summary>
public sealed record BlockActivity(BlockActivityKind Kind, DateTimeOffset SinceUtc, DateTimeOffset? UntilUtc = null, int? Seq = null);

/// <summary>
/// Ein Block je Aufruf nach dem Astro-PM-Muster (execution.md §4.1/§4.2, TK 10.3 Nr. 4/7), als Kernlogik über
/// <see cref="IBlockHost"/>: Vorprüfungen (vorbei, ohne Belichtung, nicht machbar), Warten auf den Blockstart, Ziel
/// setzen, Slew/Zentrieren mit Wiederholungsleiter und Winkelprüfung modulo 180°, Trigger-Set vor Zielwechsel, Guiding,
/// Einträge nach der Tabelle Eintrag → Aktion mit <see cref="Playback"/> und hartem Blockschluss, Flip aktiv auslösen und
/// erkennen (auch ungeplant), Trigger-Set nach Zielwechsel. Der kumulierte Verzug (Startverzug plus tatsächliche minus
/// geplante Dauer jeder Aktion) schiebt die Planuhr des zeitgeführten Playbacks (§4.2, NT-21).
/// Abbrüche (Unterbrechung, Benutzer, eigene) wirft der Executor weiter; die Einordnung macht der Container (§4.6).
/// </summary>
public sealed class BlockExecutor(IBlockHost host, IClock clock, NinaPmLog log)
{
    /// <summary>Wartezeiten zwischen Zentrier-Versuchen (§4.1 Nr. 5).</summary>
    public static readonly int[] CenterRetryS = [15, 15, 30, 60, 120, 300, 300, 600, 600];

    /// <summary>Takt beim Warten auf NINAs früheste Flipzeit (§4.2).</summary>
    public static readonly TimeSpan FlipWaitTick = TimeSpan.FromSeconds(10);

    /// <summary>
    /// Download-Zeit je Belichtung für den Blockschluss, wenn der Block keine aus dem Rig mitbringt
    /// (<see cref="BlockRunOptions.DownloadS"/>); Standard 3 s.
    /// </summary>
    public double DownloadS { get; init; } = 3;

    /// <summary>Playback-Modus, wenn der Block keinen aus dem Rig mitbringt (<see cref="BlockRunOptions.Mode"/>).</summary>
    public PlaybackMode Mode { get; init; } = PlaybackMode.Sequential;

    /// <summary>Zuletzt gestartete Belichtung des laufenden Blocks (Live-Status, FA-NIN-13); außerhalb eines Blocks <c>null</c>.</summary>
    public Entries? CurrentEntry { get; private set; }

    /// <summary>Beginn der laufenden Belichtung (<see cref="CurrentEntry"/>) für Fortschritt und Restzeit (AP-53b).</summary>
    public DateTimeOffset? CurrentEntryStartedUtc { get; private set; }

    /// <summary>
    /// Zuletzt begonnene Belichtung des laufenden Blocks – bleibt nach ihrem Ende stehen (Filter und Kamera im Live-Status,
    /// Position im Protokoll); <see cref="CurrentEntry"/> ist dagegen nur während der Belichtung gesetzt (Plugin 0.4.18:
    /// vorher zeigte das Fenster beim Warten, Flip und Zentrieren die letzte Belichtung als „▶ läuft 100 %“).
    /// </summary>
    public Entries? LastEntry { get; private set; }

    /// <summary>Tätigkeit außerhalb einer Belichtung (Warten, Flip, Zentrieren); während einer Belichtung und außerhalb eines Blocks <c>null</c>.</summary>
    public BlockActivity? Activity { get; private set; }

    /// <summary>
    /// Pier-Seite nach einem erkannten Flip je Ziel (Projekt, Panel) in dieser Laufzeit: Flippte NINA in Block A ungeplant,
    /// ist der Plan-Flip desselben Ziels in einem späteren Block B erledigt, solange die Montierung noch auf dieser Seite
    /// steht (Analyse 07.10.2026). Nur zusammen mit <see cref="BlockRunOptions.FlipDoneTonight"/> (Nachtgrenze).
    /// </summary>
    private readonly Dictionary<(Guid ProjectId, Guid? PanelId), string> flippedPier = [];

    /// <summary>Gespiegelte Optik nur einmal melden (NT-33: einmal je Nacht; der Executor lebt eine Laufzeit lang).</summary>
    private bool opticsMirroredWarned;

    /// <summary>
    /// Ziel, dessen Winkel zuletzt außerhalb der Toleranz lag (ohne Rotator): entfällt das Zentrieren beim nächsten Block
    /// desselben Ziels, entfiele sonst auch die Winkelprüfung – mit <c>skipOnMismatch</c> bleibt der Block übersprungen.
    /// </summary>
    private (Guid ProjectId, Guid? PanelId)? mismatchTarget;

    /// <summary>Zustand eines Blocklaufs: Verzug, ausstehendes Zentrieren nach einem Flip, Flip erledigt.</summary>
    private sealed class Run(Blocks block, BlockRunOptions options)
    {
        public Blocks Block { get; } = block;
        public BlockRunOptions Options { get; } = options;

        /// <summary>Download-Zeit wie in der Engine (Rig <c>overhead.downloadS</c>), sonst der Standard des Executors.</summary>
        public double DownloadS { get; init; }
        public TimeSpan Offset { get; set; } = TimeSpan.Zero;

        /// <summary>
        /// Vorgezogene Planuhr (Plugin 0.4.18): Plan-Zeit, die durch Gutschriften frei wurde, nachdem der Verzug schon 0 war
        /// (z. B. Flip, Warten und Zentrieren, die NINA vorher erledigt hat, oder ein entfallener Slew). Die nächste
        /// Belichtung beginnt dann um diese Zeit früher statt nach <c>WAIT_PLAN</c>; nie negativ, nur aus Gutschriften.
        /// </summary>
        public TimeSpan PullForward { get; set; } = TimeSpan.Zero;

        /// <summary>Letzte Prüfung im Block (§3.2), auch während einer Wartezeit.</summary>
        public DateTimeOffset LastCheck { get; set; }
        public bool RecenterPending { get; set; }
        public bool Flipped { get; set; }

        /// <summary>Transitserie begonnen (<c>TRANSIT_START</c> gemeldet).</summary>
        public bool SeriesStarted { get; set; }

        /// <summary>Filter der Transit-Zeile gesetzt – einmal, schon vor dem Fensterbeginn (§5).</summary>
        public bool SeriesFilterSet { get; set; }
    }

    /// <summary>Wartezeit im Block bis zum geplanten Eintrag, ab der das Plugin <c>WAIT_PLAN</c> (bzw. <c>WAIT_ENTRY</c>, <c>WAIT_FLIP</c>, <c>WAIT_BLOCK</c>) protokolliert.</summary>
    public const double WaitLogMinS = 30;

    /// <summary>Mindestabstand zweier Ziel-Prüfungen während einer Wartezeit (falls der Abruf scheitert und das Signal bleibt).</summary>
    public static readonly TimeSpan WaitRecheck = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Transit-Vorlauf (§5): eine Einzelbelichtung ab <paramref name="startUtc"/> endete nicht mehr vor dem Vorlauf eines
    /// festgelegten Transits → der Block endet für die Neuplanung (Fall b). Eine laufende Belichtung bricht das nie ab.
    /// </summary>
    private static bool TransitBlocks(Run run, Entries e, DateTimeOffset startUtc) =>
        !Playback.Repeats(e) && run.Options.TransitDeadline?.Invoke() is { } deadline
        && startUtc.AddSeconds((e.ExposureS ?? 0) + run.DownloadS) > deadline;

    /// <summary>Verzug fortschreiben: tatsächliche minus geplante Dauer, nie negativ (§4.2, NIN-14); Mehrzeit zehrt zuerst eine vorgezogene Planuhr auf.</summary>
    private void Overrun(Run run, DateTimeOffset started, double plannedS) =>
        Shift(run, clock.UtcNow - started - TimeSpan.FromSeconds(plannedS), pull: false);

    /// <summary>
    /// Geplanter Eintrag entfällt, weil seine Arbeit schon getan ist: seine Dauer verkürzt den Verzug (nie negativ). Was
    /// danach übrig bleibt, zieht die Planuhr vor (<see cref="Run.PullForward"/>, Plugin 0.4.18) – sonst wartete die Rig die
    /// frei gewordene Flip- bzw. Slew-Zeit mit <c>WAIT_PLAN</c> ab.
    /// </summary>
    private void Credit(Run run, double plannedS) => Shift(run, -TimeSpan.FromSeconds(plannedS), pull: true);

    private static void Shift(Run run, TimeSpan delta, bool pull)
    {
        if (delta > TimeSpan.Zero && run.PullForward > TimeSpan.Zero)
        {
            var used = delta < run.PullForward ? delta : run.PullForward;
            run.PullForward -= used;
            delta -= used;
        }
        var o = run.Offset + delta;
        if (o < TimeSpan.Zero)
        {
            if (pull) run.PullForward += -o;
            o = TimeSpan.Zero;
        }
        run.Offset = o;
    }

    /// <summary>
    /// Nach dem Warten bis zu einer festen Uhrzeit (Meridian, Ende eines <c>wait</c>-Eintrags, §4.2): die Planuhr steht
    /// wieder auf dem Plan – Verzug = <c>max(0, jetzt − geplantes Ende)</c>, nichts vorgezogen. Das entspricht dem Verbuchen
    /// der tatsächlichen gegen die geplante Wartezeit, ohne dass ein früheres Eintreffen den Verzug erhöht.
    /// </summary>
    private void SyncToPlan(Run run, DateTimeOffset plannedEndUtc)
    {
        var late = clock.UtcNow - plannedEndUtc;
        run.Offset = late > TimeSpan.Zero ? late : TimeSpan.Zero;
        run.PullForward = TimeSpan.Zero;
    }

    /// <summary>
    /// Ein Block. <see cref="BlockRunOptions.InBlockCheck"/> (execution.md §3.2) läuft alle 15 min vor einer Belichtung
    /// mit dem anstehenden Eintrag; liefert er einen Grund (<c>target_removed</c>, <c>transit_interrupt</c>), endet der
    /// Block nach der laufenden Belichtung mit diesem Grund.
    /// </summary>
    public async Task<BlockOutcome> RunAsync(Blocks block, DateTimeOffset? darknessEndUtc, CancellationToken token,
        BlockRunOptions? options = null)
    {
        options ??= new BlockRunOptions();
        var run = new Run(block, options) { DownloadS = options.DownloadS ?? DownloadS };
        var temperatureWarned = false;
        bool CheckCooling()
        {
            var deviates = CoolingCheck.Deviates(options.Cooling, host.ReadCooling());
            if (deviates && !temperatureWarned)
            {
                temperatureWarned = true;
                log.Warning("WARNING", ("code", "camera_temperature"), ("block", block.Id));
                options.TemperatureWarning?.Invoke(block);
            }
            return deviates;
        }
        var skip = PreCheck(block);
        if (skip is not null) return Skip(block, skip);

        var start = ReplanPolicy.PlannedStart(block);
        // Bis Blockstart warten, 10-s-Takt, abbrechbar durch *Block überspringen* (§4.1 Nr. 2); ab 30 s eine Zeile im Log.
        if ((start - clock.UtcNow).TotalSeconds >= WaitLogMinS)
            log.Event("WAIT_BLOCK", ("block", block.Id), ("untilUtc", start), ("durationS", Math.Round((start - clock.UtcNow).TotalSeconds)));
        while (clock.UtcNow < start)
        {
            if (options.SkipRequested?.Invoke() == true) return Skip(block, "user_skip");
            var next = clock.UtcNow + FlipWaitTick;
            await host.DelayAsync(next < start ? next : start, token).ConfigureAwait(false);
        }
        if (options.SkipRequested?.Invoke() == true) return Skip(block, "user_skip");
        // Ab hier ist die Rig für den Block tätig (Anfahren, Zentrieren): Beginn im Nachtjournal.
        var activeFrom = clock.UtcNow;
        if (block.EndUtc <= clock.UtcNow || NothingFits(run)) return Skip(block, "elapsed");
        if (!host.IsViableNow(block)) return Skip(block, "not_viable");
        // §4.1 Nr. 1: keine Zeile mit gefundenem Filter bzw. Auslesemodus → überspringen statt den Block leer abzusitzen
        // (P-05 prod 03.10.2026).
        if (host.UnexposableReason(block) is { } unexposable) return Skip(block, unexposable);

        host.SetTarget(block);
        var slewSkipped = host.CanSkipSlew(block);
        try
        {
            if (slewSkipped)
            {
                if (!host.RotatorConnected && options.Rotation is { SkipOnMismatch: true } && mismatchTarget == (block.ProjectId, block.PanelId))
                    return Skip(block, "rotation_mismatch");
            }
            else
            {
                Activity = new BlockActivity(BlockActivityKind.Centering, clock.UtcNow, Seq: block.Entries.FirstOrDefault()?.Seq);
                if (!await CenterWithRetriesAsync(block, rotate: true, token).ConfigureAwait(false))
                    return Skip(block, "center_failed");
                // Ohne (verbundenen) Rotator: Winkel mit eigenem Plate-Solve prüfen (§4.1 Nr. 5, NT-29); mit Rotator prüft
                // NINAs CenterAndRotate selbst modulo 180°.
                if (!host.RotatorConnected && await CheckRotationAsync(run, token).ConfigureAwait(false) is { SkipBlock: true })
                    return Skip(block, "rotation_mismatch");
            }
        }
        finally
        {
            Activity = null;
        }

        log.Event("BLOCK_START", ("id", block.Id), ("atUtc", clock.UtcNow));
        options.Started?.Invoke(block, activeFrom, slewSkipped);
        // Startverzug: tatsächlicher minus geplanter Beginn der Einträge nach dem Zentrieren (§4.2, NT-21).
        var plannedEntries = block.Entries.FirstOrDefault(e => e.Cmd is not (EntriesCmd.Slew_center or EntriesCmd.Slew_center_rotate))?.AtUtc;
        if (plannedEntries is { } p && clock.UtcNow > p) run.Offset = clock.UtcNow - p;
        // Slew entfällt (gleiches Ziel, §3.2): die geplante Slew-/Zentrierzeit ist frei – die Planuhr steht auf dem Ende des
        // Slews statt WAIT_PLAN über slewCenterS (Plugin 0.4.18).
        else if (slewSkipped && plannedEntries is { } q && clock.UtcNow < q) run.PullForward = q - clock.UtcNow;
        // Flip dieses Ziels schon in einem früheren Block der Nacht erledigt und die Montierung steht noch auf der Seite nach
        // dem Flip: Warten, Plan-Flip und Zentrieren danach entfallen wie bei einem Flip im Block (Plugin 0.4.18).
        if (FlippedEarlier(block, options)) run.Flipped = true;
        CheckCooling();
        await host.BeforeTargetChangeAsync(token).ConfigureAwait(false);
        await host.StartGuidingAsync(token).ConfigureAwait(false);

        (string Reason, int Exposures, int Skipped) result;
        try
        {
            result = await EntriesAsync(run, darknessEndUtc, CheckCooling, token).ConfigureAwait(false);
        }
        finally
        {
            CurrentEntry = null;
            CurrentEntryStartedUtc = null;
            LastEntry = null;
            Activity = null;
            // Auch wenn die Serie mit Fehler oder Abbruch endet (Plugin 0.4.18): sonst fehlte transit_end auf dem Server.
            if (run.SeriesStarted)
            {
                log.Event("TRANSIT_END", ("id", block.Id));
                options.Report?.Invoke(EventsKind.Transit_end, null, block, null, null);
            }
        }
        var (reason, exposures, skipped) = result;

        await host.AfterTargetChangeAsync(token).ConfigureAwait(false);
        log.Event("BLOCK_END", ("id", block.Id), ("reason", reason));
        return new BlockOutcome(true, reason, exposures, skipped);
    }

    /// <summary>
    /// Plan-Flip dieses Blocks schon erledigt: In dieser Nacht flippte für das Ziel schon ein früherer Block
    /// (<c>flipDoneByPanel</c>), und die Montierung steht noch auf der Pier-Seite nach diesem Flip.
    /// </summary>
    private bool FlippedEarlier(Blocks block, BlockRunOptions options)
    {
        if (!block.Entries.Any(e => e.Cmd == EntriesCmd.Meridian_flip)) return false;
        if (!flippedPier.TryGetValue((block.ProjectId, block.PanelId), out var side)) return false;
        if (options.FlipDoneTonight?.Invoke(block) == false)
        {
            flippedPier.Remove((block.ProjectId, block.PanelId));
            return false;
        }
        if (host.PierSide() != side) return false;
        log.Note($"Block {block.Id}: flip of this target already done tonight (pier side {side}) – planned wait, flip and centering are skipped");
        return true;
    }

    /// <summary>§4.1 Nr. 1: vorbei bzw. ohne Belichtung; die Filterprüfung (<c>filter_not_found</c>) folgt nach dem Warten auf den Blockstart.</summary>
    private string? PreCheck(Blocks block)
    {
        if (block.EndUtc <= clock.UtcNow) return "elapsed";
        if (!block.Entries.Any(e => e.Cmd is EntriesCmd.Expose or EntriesCmd.Expose_series)) return "no_exposures";
        return null;
    }

    /// <summary>
    /// Keine Belichtung passt mehr vor das (weiche) Blockende (Blockschluss, §4.2; Serie: vor <c>untilUtc</c>) – der Block
    /// ist praktisch vorbei, Slew und Zentrieren entfallen (z. B. der Rest eines Transitblocks nach der Neuplanung).
    /// Belichtungen mit <c>lastOfNight</c> dürfen bis zur Kulanzgrenze laufen und zählen immer als passend.
    /// </summary>
    private bool NothingFits(Run run)
    {
        var block = run.Block;
        var now = clock.UtcNow;
        var blockEnd = run.Options.SoftEndUtc is { } soft && soft > block.EndUtc ? soft : block.EndUtc;
        foreach (var e in block.Entries.Where(x => x.Cmd is EntriesCmd.Expose or EntriesCmd.Expose_series))
        {
            if (e.LastOfNight == true) return false;
            // Weiches Blockende nur für eine Belichtung, die vor endUtc beginnt (PreCheck: endUtc > now).
            var end = e.Cmd == EntriesCmd.Expose_series ? (e.UntilUtc is { } u && u < block.EndUtc ? u : block.EndUtc) : blockEnd;
            if (now.AddSeconds((e.ExposureS ?? 0) + run.DownloadS) <= end) return false;
        }
        return true;
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
    private async Task<bool> CenterWithRetriesAsync(Blocks block, bool rotate, CancellationToken token)
    {
        for (var attempt = 0; ; attempt++)
        {
            var r = await host.SlewCenterAsync(block, rotate, token).ConfigureAwait(false);
            if (r.Success) return true;
            log.Warning("WARNING", ("code", "center_failed"), ("block", block.Id), ("index", attempt + 1));
            if (attempt >= CenterRetryS.Length) return false;
            var next = clock.UtcNow.AddSeconds(CenterRetryS[attempt]);
            if (next >= block.EndUtc) return false;
            await host.DelayAsync(next, token).ConfigureAwait(false);
        }
    }

    private sealed record RotationOutcome(bool SkipBlock);

    /// <summary>
    /// Winkelprüfung modulo 180° mit eigenem Plate-Solve (flip-rotation.md §3): kein Solve → <c>rotation_unknown</c>;
    /// gespiegelt → <c>optics_mirrored</c> (einmal), keine Prüfung; Abweichung → <c>rotation_mismatch</c>, Block nur
    /// überspringen, wenn <c>skipOnMismatch</c> und kein verbundener Rotator. Ohne Rotationseinstellungen keine Prüfung.
    /// </summary>
    private async Task<RotationOutcome> CheckRotationAsync(Run run, CancellationToken token)
    {
        if (run.Options.Rotation is not { } r) return new RotationOutcome(false);
        var block = run.Block;
        var reading = await host.SolveAsync(token).ConfigureAwait(false);
        if (reading.Mirrored)
        {
            if (!opticsMirroredWarned)
            {
                opticsMirroredWarned = true;
                log.Warning("WARNING", ("code", "optics_mirrored"), ("block", block.Id));
                run.Options.Report?.Invoke(EventsKind.Warning, "optics_mirrored", block, null, null);
            }
            return new RotationOutcome(false);
        }
        if (reading.PositionAngleDeg is not { } actual)
        {
            log.Event("ROTATION_UNKNOWN", ("id", block.Id));
            run.Options.Report?.Invoke(EventsKind.Rotation_unknown, null, block, null, null);
            return new RotationOutcome(false);
        }
        if (Rotation.WithinTolerance(actual, block.RotationDeg, r.ToleranceDeg))
        {
            if (mismatchTarget == (block.ProjectId, block.PanelId)) mismatchTarget = null;
            return new RotationOutcome(false);
        }
        mismatchTarget = (block.ProjectId, block.PanelId);
        log.Event("ROTATION_MISMATCH", ("id", block.Id));
        run.Options.Report?.Invoke(EventsKind.Rotation_mismatch, null, block, null, null);
        return new RotationOutcome(r.SkipOnMismatch && !host.RotatorConnected);
    }

    /// <summary>
    /// Einträge nach §4.2: Belichtungen wählt <see cref="Playback"/> (verpasste → <c>SKIPPED_TIMEAWARE</c>), die übrigen
    /// Einträge zwischen zwei Belichtungen werden in Planreihenfolge ausgeführt. <c>wait</c> endet spätestens beim
    /// folgenden <c>meridian_flip</c>; <c>autofocus_hint</c> ist Zeitmarke; <c>slew_center</c> im Block zentriert nur nach
    /// einem Flip. Wechselt die Pier-Seite um eine Belichtung herum, war das ein (ungeplanter) Flip → vor der nächsten
    /// Belichtung zentrieren (M3). Überspringen, Zurücksetzen und <c>lease_lost</c> beenden den Block vor jeder weiteren
    /// Aktion (§4.2, §4.6); mehr als 3 verpasste Belichtungen beenden ihn für die Neuplanung (<c>replanned</c>).
    /// </summary>
    private async Task<(string Reason, int Exposures, int Skipped)> EntriesAsync(Run run, DateTimeOffset? darknessEndUtc,
        Func<bool> checkCooling, CancellationToken token)
    {
        var block = run.Block;
        var options = run.Options;
        var mode = options.Mode ?? Mode;
        var inBlockCheck = options.InBlockCheck;
        var entries = block.Entries;
        run.LastCheck = clock.UtcNow;
        var cursor = -1;
        var exposures = 0;
        var skippedTotal = 0;
        while (true)
        {
            token.ThrowIfCancellationRequested();
            // Gestoppter Block endet sofort – auch vor dem Zentrieren nach einem Flip (§4.2, Plugin 0.4.18).
            if (options.StopReason?.Invoke() is { } stopped) return (stopped, exposures, skippedTotal);
            if (run.RecenterPending) await RecenterAfterFlipAsync(run, plannedS: 0, seq: null, token).ConfigureAwait(false);
            var stepAt = clock.UtcNow;
            var step = Playback.Next(block, cursor, stepAt, run.Offset, mode, darknessEndUtc, run.DownloadS, options.SoftEndUtc, run.PullForward);
            foreach (var i in step.Skipped)
            {
                log.Event("SKIPPED_TIMEAWARE", ("id", block.Id), ("index", entries[i].Seq));
                options.EntrySkipped?.Invoke(block, entries[i]);
                skippedTotal++;
            }
            if (Playback.NeedsReplan(skippedTotal))
            {
                // §4.2: mehr als 3 verpasste Belichtungen – der Plan passt nicht mehr; Block jetzt beenden (es läuft keine
                // Belichtung), der Container plant ab jetzt neu (Plugin 0.4.18; vorher ungenutzt).
                log.Note($"Block {block.Id}: {skippedTotal} exposures skipped (time-aware) – block ends for a new plan");
                return ("replanned", exposures, skippedTotal);
            }
            if (step.Kind == PlaybackKind.End)
            {
                // Abschließende Nicht-Belichtungen (z. B. Dither nach der letzten Belichtung) entfallen mit dem Blockschluss.
                return (step.EndReason!, exposures, skippedTotal);
            }
            var target = step.EntryIndex!.Value;
            // Nicht-Belichtungen zwischen der letzten und der gewählten Belichtung; übersprungene Belichtungen nehmen
            // ihre Zwischen-Einträge mit (nur Filterwechsel und der Flip bleiben wirksam).
            var offsetBefore = (run.Offset, run.PullForward);
            for (var i = cursor + 1; i < target; i++)
            {
                if (options.StopReason?.Invoke() is { } stopBetween) return (stopBetween, exposures, skippedTotal);
                var end = await RunNonExposureAsync(run, i, target, skip: step.Skipped.Count > 0 && i < step.Skipped[^1], token).ConfigureAwait(false);
                if (end is not null) return (end, exposures, skippedTotal);
            }
            if (target > cursor + 1 && (clock.UtcNow != stepAt || (run.Offset, run.PullForward) != offsetBefore))
            {
                // Zeit verging (Warten, Flip, Zentrieren) bzw. der Verzug hat sich geändert (z. B. Flip schon erledigt):
                // Blockschluss, Nachtende, weiches Blockende und Wartezeit mit der neuen Zeit bestimmen (Rig-Nacht
                // 06./07.10.2026, Analyse 07.10.2026) – vorher begann eine Belichtung nach dem Flip mit der alten Entscheidung.
                cursor = target - 1;
                continue;
            }
            if (Playback.Repeats(entries[target]) && !run.SeriesFilterSet)
            {
                // Filter der Transit-Zeile einmal vor der Serie (§5), noch im Vorlauf; danach kein Filterwechsel.
                run.SeriesFilterSet = true;
                await host.ChangeFilterAsync(entries[target], token).ConfigureAwait(false);
                cursor = target - 1; // Einträge davor (Vorlauf, Flip) sind erledigt
                continue;
            }
            if (step.Kind == PlaybackKind.Wait)
            {
                // Schneller als geplant (zeitgeführt, §4.2): bis zum geplanten Zeitpunkt warten. Ab 30 s eine Zeile im Log –
                // sonst sähe ein Block z. B. mit nicht genutzter Autofokus-Zeit minutenlang untätig aus (VM-Lauf 05.10.2026).
                var until = step.WaitUntilUtc!.Value;
                var waitS = (until - clock.UtcNow).TotalSeconds;
                if (waitS >= WaitLogMinS)
                    log.Event("WAIT_PLAN", ("block", block.Id), ("untilUtc", until), ("durationS", Math.Round(waitS)));
                Activity = new BlockActivity(BlockActivityKind.WaitPlan, clock.UtcNow, until);
                var endInWait = await WaitAsync(run, until, entries[target], token).ConfigureAwait(false);
                Activity = null;
                if (endInWait is not null) return (endInWait, exposures, skippedTotal);
                cursor = target - 1;
                continue;
            }
            if (options.StopReason?.Invoke() is { } stop) return (stop, exposures, skippedTotal);
            // Prüfung im Block alle 15 min – oder sofort, wenn der Heartbeat ein neues targets-ETag meldet (z. B. eine im
            // Web bestätigte Filterzuordnung, P-05 prod 03.10.2026).
            var interval = options.InBlockInterval?.Invoke() ?? ReplanPolicy.InBlockInterval;
            if (inBlockCheck is not null && (clock.UtcNow - run.LastCheck >= interval || options.TargetsChanged?.Invoke() == true))
            {
                run.LastCheck = clock.UtcNow;
                var end = await inBlockCheck(entries[target], token).ConfigureAwait(false);
                if (end is not null) return (end, exposures, skippedTotal);
            }
            var e = entries[target];
            var series = Playback.Repeats(e);
            // Transit-Vorlauf (§5): eine Belichtung beginnt nur, wenn sie vor dem Vorlauf eines festgelegten Transits
            // endet; sonst endet der Block für die Neuplanung mit dem Transit (Fall b).
            if (TransitBlocks(run, e, clock.UtcNow)) return ("transit_interrupt", exposures, skippedTotal);
            if (series && !run.SeriesStarted)
            {
                run.SeriesStarted = true;
                log.Event("TRANSIT_START", ("id", block.Id), ("untilUtc", e.UntilUtc ?? block.EndUtc));
                run.Options.Report?.Invoke(EventsKind.Transit_start, null, block, null, null);
            }
            var deviation = checkCooling();
            var pierBefore = host.PierSide();
            var started = clock.UtcNow;
            Activity = null;
            CurrentEntry = e;
            LastEntry = e;
            CurrentEntryStartedUtc = started;
            ExposureResult result;
            try
            {
                result = await host.ExposeAsync(block, e, deviation, token).ConfigureAwait(false);
            }
            finally
            {
                // Nach der Belichtung läuft keine mehr (Fenster: Warten, Flip, Zentrieren statt „▶ läuft 100 %“).
                CurrentEntry = null;
                CurrentEntryStartedUtc = null;
            }
            if (result == ExposureResult.Saved) exposures++;
            if (result != ExposureResult.Skipped) Overrun(run, started, (e.ExposureS ?? 0) + run.DownloadS);
            if (series && result != ExposureResult.Saved && clock.UtcNow == started)
            {
                // Ohne Belichtung vergeht keine Zeit: die Serie liefe auf der Stelle (Filter/Auslesemodus fehlt).
                log.Warning("WARNING", ("code", "transit_series_stalled"), ("block", block.Id));
                return ("error", exposures, skippedTotal);
            }
            DetectUnplannedFlip(run, pierBefore, host.PierSide(), started, (e.ExposureS ?? 0) + run.DownloadS);
            // Die Serie wiederholt denselben Eintrag bis untilUtc (Playback entscheidet über das Ende).
            cursor = series ? target - 1 : target;
        }
    }

    /// <summary>
    /// Warten im Block bis <paramref name="until"/> im 10-s-Takt (§4.2): Zurücksetzen, Überspringen und <c>lease_lost</c>
    /// beenden den Block sofort mit ihrem Grund; ein neues targets-ETag löst die Prüfung im Block aus (höchstens einmal je
    /// Minute, falls der Abruf scheitert); würde <paramref name="next"/> ab <paramref name="until"/> nicht mehr vor dem
    /// Vorlauf eines festgelegten Transits enden, endet der Block mit <c>transit_interrupt</c>. Für das Warten auf den
    /// geplanten Zeitpunkt und – seit Plugin 0.4.18 – ebenso für einen <c>wait</c>-Eintrag.
    /// </summary>
    private async Task<string?> WaitAsync(Run run, DateTimeOffset until, Entries? next, CancellationToken token)
    {
        var options = run.Options;
        DateTimeOffset? lastWaitCheck = null;
        while (clock.UtcNow < until)
        {
            if (options.StopReason?.Invoke() is { } stop) return stop;
            if (next is not null && TransitBlocks(run, next, until)) return "transit_interrupt";
            if (next is not null && options.InBlockCheck is { } check && options.TargetsChanged?.Invoke() == true
                && (lastWaitCheck is null || clock.UtcNow - lastWaitCheck >= WaitRecheck))
            {
                lastWaitCheck = run.LastCheck = clock.UtcNow;
                if (await check(next, token).ConfigureAwait(false) is { } end) return end;
                continue;
            }
            var tick = clock.UtcNow + FlipWaitTick;
            await host.DelayAsync(tick < until ? tick : until, token).ConfigureAwait(false);
        }
        return null;
    }

    /// <summary>
    /// Ungeplanter Flip (NINAs Trigger vor einer Belichtung, auch die geplante ±1 Belichtung früher): Pier-Seite
    /// gewechselt → <c>FLIP</c>, Zentrieren vor der nächsten Belichtung, ein späterer <c>meridian_flip</c> ist erledigt.
    /// </summary>
    private void DetectUnplannedFlip(Run run, string? before, string? after, DateTimeOffset started, double exposureS)
    {
        if (FlipRules.Detect(before, after, null, null, 0, 0) != FlipDetection.Flipped) return;
        // NINAs Trigger flippt vor der Belichtung, erkannt wird es danach: die Belichtung gehört nicht zur Flipdauer
        // (Rig-Nacht 06./07.10.2026: gemeldet 1903 s, davon 605 s Belichtung und Download). Zeitpunkt ist das Ende des Flips
        // vor der Belichtung (Beginn + Dauer), nicht die Erkennung danach – sonst zeichnete das Fenster den Flip eine
        // Belichtung zu spät (Plugin 0.4.18). Trigger danach (z. B. Autofokus nach dem Flip) lassen sich im Kern nicht
        // abtrennen und zählen mit.
        var durationS = Math.Max(0, Math.Round((clock.UtcNow - started).TotalSeconds - exposureS));
        Flipped(run, before!, after!, durationS, started.AddSeconds(durationS));
    }

    private void Flipped(Run run, string before, string after, double durationS, DateTimeOffset endedUtc)
    {
        run.Flipped = true;
        run.RecenterPending = true;
        if (after is "east" or "west") flippedPier[(run.Block.ProjectId, run.Block.PanelId)] = after;
        log.Event("FLIP", ("id", run.Block.Id), ("pierBefore", before), ("pierAfter", after), ("durationS", durationS));
        run.Options.Report?.Invoke(EventsKind.Flip, null, run.Block, durationS, endedUtc); // mit Dauer (FA-NIN-24)
        run.Options.FlipDone?.Invoke(run.Block);
    }

    /// <summary>
    /// Nach jedem erkannten Flip (M3, NT-E4): <c>Center</c> (nie <c>CenterAndRotate</c>), danach Winkelprüfung modulo 180°
    /// mit eigenem Plate-Solve; mit NINA-<c>Recenter = true</c> ohne Rotator nur die Winkelprüfung (NT-22).
    /// </summary>
    private async Task RecenterAfterFlipAsync(Run run, double plannedS, int? seq, CancellationToken token)
    {
        run.RecenterPending = false;
        var started = clock.UtcNow;
        Activity = new BlockActivity(BlockActivityKind.Centering, started, Seq: seq);
        try
        {
            if (!(host.NinaRecentersAfterFlip && !host.RotatorConnected))
                await CenterWithRetriesAsync(run.Block, rotate: false, token).ConfigureAwait(false);
            await CheckRotationAsync(run, token).ConfigureAwait(false);
        }
        finally
        {
            Activity = null;
        }
        Overrun(run, started, plannedS);
    }

    /// <summary>
    /// Flip aktiv auslösen (NT-21, M1, M3; execution.md §4.2/§4.5): warten (10-s-Takt), bis NINAs früheste Flipzeit
    /// erreicht ist, höchstens bis <c>limitEnd</c>; dann die Trigger aller Vorfahren aufrufen. Erkennung über die
    /// Pier-Seite, ohne Pier-Seite über einen PA-Sprung ≈ 180° (NIN5-1), sonst <c>flip_undetected</c>. Hat NINA im Block
    /// schon geflippt (±1 Belichtung), ist der Eintrag erledigt. Ein gestoppter Block (Überspringen, Zurücksetzen,
    /// <c>lease_lost</c>) endet ohne Flip (Plugin 0.4.18).
    /// </summary>
    private async Task<string?> FlipAsync(Run run, Entries entry, CancellationToken token)
    {
        if (run.Flipped)
        {
            // NINA hat schon geflippt; die Flipdauer steckt im Verzug. Die geplante Flipzeit ist damit frei (Rig-Nacht
            // 06./07.10.2026: sonst doppelt gezählt, 20 min Leerlauf nach dem Flip).
            Credit(run, entry.DurationS ?? 0);
            return null;
        }
        var block = run.Block;
        var flip = run.Options.Flip;
        var stopReason = run.Options.StopReason;
        var started = clock.UtcNow;
        var planned = block.MeridianFlip?.PlannedUtc ?? entry.AtUtc;
        var limitEnd = flip is null ? entry.AtUtc.AddSeconds(entry.DurationS ?? 0) : FlipRules.LimitEnd(planned, flip);
        if (host.MinutesToEarliestFlip() is { } minutes && minutes > 0 && clock.UtcNow < limitEnd)
        {
            var earliest = clock.UtcNow.AddSeconds(Math.Round(minutes * 60));
            var until = earliest < limitEnd ? earliest : limitEnd;
            var waitS = (until - clock.UtcNow).TotalSeconds;
            if (waitS >= WaitLogMinS)
                log.Event("WAIT_FLIP", ("block", block.Id), ("untilUtc", until), ("durationS", Math.Round(waitS)));
            Activity = new BlockActivity(BlockActivityKind.WaitFlip, clock.UtcNow, until, entry.Seq);
        }
        try
        {
            while (clock.UtcNow < limitEnd && host.MinutesToEarliestFlip() is > 0)
            {
                if (stopReason?.Invoke() is { } stop) return stop;
                var next = clock.UtcNow + FlipWaitTick;
                await host.DelayAsync(next < limitEnd ? next : limitEnd, token).ConfigureAwait(false);
            }
            // Gestoppt: keine Trigger mehr (sonst flippte NINA noch für einen beendeten Block).
            if (stopReason?.Invoke() is { } stopped) return stopped;
            Activity = new BlockActivity(BlockActivityKind.Flip, clock.UtcNow, Seq: entry.Seq);
            var pierBefore = host.PierSide();
            double? paBefore = pierBefore is null ? (await host.SolveAsync(token).ConfigureAwait(false)).PositionAngleDeg : null;
            var triggerStart = clock.UtcNow;
            await host.RunTriggersAsync(token).ConfigureAwait(false);
            var triggerS = (clock.UtcNow - triggerStart).TotalSeconds;
            var pierAfter = host.PierSide();
            double? paAfter = pierBefore is null || pierAfter is null ? (await host.SolveAsync(token).ConfigureAwait(false)).PositionAngleDeg : null;
            var durationS = flip?.DurationS ?? entry.DurationS ?? 0;
            switch (FlipRules.Detect(pierBefore, pierAfter, paBefore, paAfter, triggerS, durationS))
            {
                case FlipDetection.Flipped:
                    Flipped(run, pierBefore ?? "unknown", pierAfter ?? "unknown", FlipRules.DurationS(clock.UtcNow, triggerStart, planned), clock.UtcNow);
                    break;
                default:
                    // NINA hat nicht (erkennbar) geflippt: Plan-Flip bleibt offen (flipDoneByPanel unverändert, NIN5-1).
                    log.Event("FLIP_UNDETECTED", ("id", block.Id));
                    run.Options.Report?.Invoke(EventsKind.Flip_undetected, null, block, null, null);
                    break;
            }
            // Verzug: Warten auf die früheste Flipzeit und der Flip selbst gegen die geplante Flipdauer (§4.2).
            Overrun(run, started, entry.DurationS ?? durationS);
            return null;
        }
        finally
        {
            Activity = null;
        }
    }

    /// <summary>Eine Nicht-Belichtung (§4.2); liefert einen Grund, wenn der Block währenddessen endet (Stopp, Transit, Fall a/b).</summary>
    private async Task<string?> RunNonExposureAsync(Run run, int index, int nextExpose, bool skip, CancellationToken token)
    {
        var block = run.Block;
        var e = block.Entries[index];
        var started = clock.UtcNow;
        switch (e.Cmd)
        {
            case EntriesCmd.Filter:
                await host.ChangeFilterAsync(e, token).ConfigureAwait(false);
                Overrun(run, started, e.DurationS ?? 0);
                break;
            case EntriesCmd.Dither when !skip:
                await host.DitherAsync(token).ConfigureAwait(false);
                Overrun(run, started, e.DurationS ?? 0);
                break;
            case EntriesCmd.Meridian_flip:
                // Ein verpasster Flip-Zeitpunkt entbindet nicht vom Flip (NINA flippt ab der frühesten Flipzeit).
                return await FlipAsync(run, e, token).ConfigureAwait(false);
            case EntriesCmd.Slew_center or EntriesCmd.Slew_center_rotate when run.RecenterPending:
                // Nach dem Flip nur Zentrieren, auch bei einem älteren Plan mit slew_center_rotate (NT-E4).
                await RecenterAfterFlipAsync(run, e.DurationS ?? 0, e.Seq, token).ConfigureAwait(false);
                break;
            case EntriesCmd.Slew_center or EntriesCmd.Slew_center_rotate when run.Flipped:
                // Nach einem ungeplanten Flip schon vor der nächsten Belichtung zentriert (Zeit im Verzug): geplante Zeit frei.
                Credit(run, e.DurationS ?? 0);
                break;
            case EntriesCmd.Wait when !skip:
                return await WaitEntryAsync(run, index, nextExpose, token).ConfigureAwait(false);
            default:
                // autofocus_hint ist Zeitmarke (NT-24); slew_center ohne vorangegangenen Flip ebenso (Panelwechsel = neuer Block).
                break;
        }
        return null;
    }

    /// <summary>
    /// <c>wait</c>-Eintrag (§4.2): bis <c>atUtc + durationS</c>, spätestens bis zum folgenden <c>meridian_flip</c> – feste
    /// Uhrzeiten, nicht um den Verzug verschoben (Plugin 0.4.18: vorher wartete das Plugin bis Flipzeit + Verzug, obwohl der
    /// Meridian nicht später kommt). Danach steht die Planuhr wieder auf dem Plan (<see cref="SyncToPlan"/>): kürzeres
    /// Warten als geplant baut den Verzug ab. Hat NINA im Block (bzw. für das Ziel in dieser Nacht) schon geflippt, entfällt
    /// das Warten vor dem Flip (0.4.17). Das Warten prüft wie die Wartezeit vor einer Belichtung im 10-s-Takt.
    /// </summary>
    private async Task<string?> WaitEntryAsync(Run run, int index, int nextExpose, CancellationToken token)
    {
        var block = run.Block;
        var e = block.Entries[index];
        var flip = block.Entries.Skip(index + 1).Take(nextExpose - index - 1).FirstOrDefault(x => x.Cmd == EntriesCmd.Meridian_flip);
        if (flip is not null && run.Flipped)
        {
            // Warten auf den Meridian vor einem Flip, den NINA schon ausgeführt hat: entfällt, die geplante Zeit
            // ist frei. Sonst wartete das Plugin bis Flipzeit + Verzug (Rig-Nacht 06./07.10.2026: 03:22–03:43 CDT).
            log.Event("WAIT_SKIPPED", ("block", block.Id), ("reason", "flipped"), ("plannedS", e.DurationS ?? 0));
            Credit(run, e.DurationS ?? 0);
            return null;
        }
        var until = e.AtUtc.AddSeconds(e.DurationS ?? 0);
        if (flip is not null && flip.AtUtc < until) until = flip.AtUtc;
        var waitS = (until - clock.UtcNow).TotalSeconds;
        if (waitS >= WaitLogMinS)
            log.Event("WAIT_ENTRY", ("block", block.Id), ("untilUtc", until), ("durationS", Math.Round(waitS)),
                ("reason", flip is null ? "plan" : "meridian"));
        Activity = new BlockActivity(flip is null ? BlockActivityKind.WaitEntry : BlockActivityKind.WaitMeridian, clock.UtcNow, until, e.Seq);
        try
        {
            if (await WaitAsync(run, until, block.Entries[nextExpose], token).ConfigureAwait(false) is { } end) return end;
        }
        finally
        {
            Activity = null;
        }
        SyncToPlan(run, until);
        return null;
    }
}
