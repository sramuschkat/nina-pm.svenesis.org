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
public sealed record RotationSettings(double ToleranceDeg, bool SkipOnMismatch);

/// <summary>
/// Zusätze für einen Block: Prüfung im Block alle 15 min (§3.2), Kühlungs-Soll mit Warnung höchstens einmal je Block
/// (NT-E2), ein Abbruchgrund vor jeder Belichtung (z. B. <c>lease_lost</c>, §6), Flip- und Rotationseinstellungen des
/// Rigs (AP-16f), Playback-Modus des Rigs und Meldungen an den Server (Ereignis, Code).
/// </summary>
public sealed record BlockRunOptions(
    Func<Entries, CancellationToken, Task<string?>>? InBlockCheck = null,
    CoolingTarget? Cooling = null,
    Action<Blocks>? TemperatureWarning = null,
    Func<string?>? StopReason = null,
    FlipSettings? Flip = null,
    RotationSettings? Rotation = null,
    PlaybackMode? Mode = null,
    Action<EventsKind, string?, Blocks>? Report = null,
    Action<Blocks>? FlipDone = null,
    Func<bool>? SkipRequested = null);

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

    /// <summary>Download-Zeit je Belichtung für den Blockschluss; Rig-Einstellung, Standard 3 s.</summary>
    public double DownloadS { get; init; } = 3;

    /// <summary>Playback-Modus, wenn der Block keinen aus dem Rig mitbringt (<see cref="BlockRunOptions.Mode"/>).</summary>
    public PlaybackMode Mode { get; init; } = PlaybackMode.Sequential;

    /// <summary>Zuletzt gestartete Belichtung des laufenden Blocks (Live-Status, FA-NIN-13); außerhalb eines Blocks <c>null</c>.</summary>
    public Entries? CurrentEntry { get; private set; }

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
        public TimeSpan Offset { get; set; } = TimeSpan.Zero;
        public bool RecenterPending { get; set; }
        public bool Flipped { get; set; }
    }

    /// <summary>Verzug fortschreiben: tatsächliche minus geplante Dauer, nie negativ (§4.2, NIN-14).</summary>
    private void Overrun(Run run, DateTimeOffset started, double plannedS)
    {
        var o = run.Offset + (clock.UtcNow - started) - TimeSpan.FromSeconds(plannedS);
        run.Offset = o < TimeSpan.Zero ? TimeSpan.Zero : o;
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
        var run = new Run(block, options);
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
        // Bis Blockstart warten, 10-s-Takt, abbrechbar durch *Block überspringen* (§4.1 Nr. 2).
        while (clock.UtcNow < start)
        {
            if (options.SkipRequested?.Invoke() == true) return Skip(block, "user_skip");
            var next = clock.UtcNow + FlipWaitTick;
            await host.DelayAsync(next < start ? next : start, token).ConfigureAwait(false);
        }
        if (options.SkipRequested?.Invoke() == true) return Skip(block, "user_skip");
        if (block.EndUtc <= clock.UtcNow) return Skip(block, "elapsed");
        if (!host.IsViableNow(block)) return Skip(block, "not_viable");

        host.SetTarget(block);
        if (host.CanSkipSlew(block))
        {
            if (!host.RotatorConnected && options.Rotation is { SkipOnMismatch: true } && mismatchTarget == (block.ProjectId, block.PanelId))
                return Skip(block, "rotation_mismatch");
        }
        else
        {
            if (!await CenterWithRetriesAsync(block, rotate: true, token).ConfigureAwait(false))
                return Skip(block, "center_failed");
            // Ohne (verbundenen) Rotator: Winkel mit eigenem Plate-Solve prüfen (§4.1 Nr. 5, NT-29); mit Rotator prüft
            // NINAs CenterAndRotate selbst modulo 180°.
            if (!host.RotatorConnected && await CheckRotationAsync(run, token).ConfigureAwait(false) is { SkipBlock: true })
                return Skip(block, "rotation_mismatch");
        }

        log.Event("BLOCK_START", ("id", block.Id), ("atUtc", clock.UtcNow));
        // Startverzug: tatsächlicher minus geplanter Beginn der Einträge nach dem Zentrieren (§4.2, NT-21).
        var plannedEntries = block.Entries.FirstOrDefault(e => e.Cmd is not (EntriesCmd.Slew_center or EntriesCmd.Slew_center_rotate))?.AtUtc;
        if (plannedEntries is { } p && clock.UtcNow > p) run.Offset = clock.UtcNow - p;
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
        }
        var (reason, exposures, skipped) = result;

        await host.AfterTargetChangeAsync(token).ConfigureAwait(false);
        log.Event("BLOCK_END", ("id", block.Id), ("reason", reason));
        return new BlockOutcome(true, reason, exposures, skipped);
    }

    /// <summary>§4.1 Nr. 1: vorbei bzw. ohne Belichtung; Filterprüfung (<c>filter_not_found</c>) im Adapter (AP-16d).</summary>
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
                run.Options.Report?.Invoke(EventsKind.Warning, "optics_mirrored", block);
            }
            return new RotationOutcome(false);
        }
        if (reading.PositionAngleDeg is not { } actual)
        {
            log.Event("ROTATION_UNKNOWN", ("id", block.Id));
            run.Options.Report?.Invoke(EventsKind.Rotation_unknown, null, block);
            return new RotationOutcome(false);
        }
        if (Rotation.WithinTolerance(actual, block.RotationDeg, r.ToleranceDeg))
        {
            if (mismatchTarget == (block.ProjectId, block.PanelId)) mismatchTarget = null;
            return new RotationOutcome(false);
        }
        mismatchTarget = (block.ProjectId, block.PanelId);
        log.Event("ROTATION_MISMATCH", ("id", block.Id));
        run.Options.Report?.Invoke(EventsKind.Rotation_mismatch, null, block);
        return new RotationOutcome(r.SkipOnMismatch && !host.RotatorConnected);
    }

    /// <summary>
    /// Einträge nach §4.2: Belichtungen wählt <see cref="Playback"/> (verpasste → <c>SKIPPED_TIMEAWARE</c>), die übrigen
    /// Einträge zwischen zwei Belichtungen werden in Planreihenfolge ausgeführt. <c>wait</c> endet spätestens beim
    /// folgenden <c>meridian_flip</c>; <c>autofocus_hint</c> ist Zeitmarke; <c>slew_center</c> im Block zentriert nur nach
    /// einem Flip. Wechselt die Pier-Seite um eine Belichtung herum, war das ein (ungeplanter) Flip → vor der nächsten
    /// Belichtung zentrieren (M3).
    /// </summary>
    private async Task<(string Reason, int Exposures, int Skipped)> EntriesAsync(Run run, DateTimeOffset? darknessEndUtc,
        Func<bool> checkCooling, CancellationToken token)
    {
        var block = run.Block;
        var options = run.Options;
        var mode = options.Mode ?? Mode;
        var inBlockCheck = options.InBlockCheck;
        var entries = block.Entries;
        var lastCheck = clock.UtcNow;
        var cursor = -1;
        var exposures = 0;
        var skippedTotal = 0;
        while (true)
        {
            token.ThrowIfCancellationRequested();
            if (run.RecenterPending) await RecenterAfterFlipAsync(run, plannedS: 0, token).ConfigureAwait(false);
            var step = Playback.Next(block, cursor, clock.UtcNow, run.Offset, mode, darknessEndUtc, DownloadS);
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
            // ihre Zwischen-Einträge mit (nur Filterwechsel und der Flip bleiben wirksam).
            for (var i = cursor + 1; i < target; i++)
                await RunNonExposureAsync(run, i, target, skip: step.Skipped.Count > 0 && i < step.Skipped[^1], token).ConfigureAwait(false);
            if (step.Kind == PlaybackKind.Wait)
            {
                await host.DelayAsync(step.WaitUntilUtc!.Value, token).ConfigureAwait(false);
                cursor = target - 1;
                continue;
            }
            if (options.StopReason?.Invoke() is { } stop) return (stop, exposures, skippedTotal);
            if (inBlockCheck is not null && ReplanPolicy.InBlockCheckDue(lastCheck, clock.UtcNow))
            {
                lastCheck = clock.UtcNow;
                var end = await inBlockCheck(entries[target], token).ConfigureAwait(false);
                if (end is not null) return (end, exposures, skippedTotal);
            }
            var deviation = checkCooling();
            var e = entries[target];
            CurrentEntry = e;
            var pierBefore = host.PierSide();
            var started = clock.UtcNow;
            var result = await host.ExposeAsync(block, e, deviation, token).ConfigureAwait(false);
            if (result == ExposureResult.Saved) exposures++;
            if (result != ExposureResult.Skipped) Overrun(run, started, (e.ExposureS ?? 0) + DownloadS);
            DetectUnplannedFlip(run, pierBefore, host.PierSide(), started);
            cursor = target;
        }
    }

    /// <summary>
    /// Ungeplanter Flip (NINAs Trigger vor einer Belichtung, auch die geplante ±1 Belichtung früher): Pier-Seite
    /// gewechselt → <c>FLIP</c>, Zentrieren vor der nächsten Belichtung, ein späterer <c>meridian_flip</c> ist erledigt.
    /// </summary>
    private void DetectUnplannedFlip(Run run, string? before, string? after, DateTimeOffset started)
    {
        if (FlipRules.Detect(before, after, null, null, 0, 0) != FlipDetection.Flipped) return;
        var durationS = Math.Max(0, Math.Round((clock.UtcNow - started).TotalSeconds));
        Flipped(run, before!, after!, durationS);
    }

    private void Flipped(Run run, string before, string after, double durationS)
    {
        run.Flipped = true;
        run.RecenterPending = true;
        log.Event("FLIP", ("id", run.Block.Id), ("pierBefore", before), ("pierAfter", after), ("durationS", durationS));
        run.Options.Report?.Invoke(EventsKind.Flip, null, run.Block);
        run.Options.FlipDone?.Invoke(run.Block);
    }

    /// <summary>
    /// Nach jedem erkannten Flip (M3, NT-E4): <c>Center</c> (nie <c>CenterAndRotate</c>), danach Winkelprüfung modulo 180°
    /// mit eigenem Plate-Solve; mit NINA-<c>Recenter = true</c> ohne Rotator nur die Winkelprüfung (NT-22).
    /// </summary>
    private async Task RecenterAfterFlipAsync(Run run, double plannedS, CancellationToken token)
    {
        run.RecenterPending = false;
        var started = clock.UtcNow;
        if (!(host.NinaRecentersAfterFlip && !host.RotatorConnected))
            await CenterWithRetriesAsync(run.Block, rotate: false, token).ConfigureAwait(false);
        await CheckRotationAsync(run, token).ConfigureAwait(false);
        Overrun(run, started, plannedS);
    }

    /// <summary>
    /// Flip aktiv auslösen (NT-21, M1, M3; execution.md §4.2/§4.5): warten (10-s-Takt), bis NINAs früheste Flipzeit
    /// erreicht ist, höchstens bis <c>limitEnd</c>; dann die Trigger aller Vorfahren aufrufen. Erkennung über die
    /// Pier-Seite, ohne Pier-Seite über einen PA-Sprung ≈ 180° (NIN5-1), sonst <c>flip_undetected</c>. Hat NINA im Block
    /// schon geflippt (±1 Belichtung), ist der Eintrag erledigt.
    /// </summary>
    private async Task FlipAsync(Run run, Entries entry, CancellationToken token)
    {
        if (run.Flipped) return;
        var block = run.Block;
        var flip = run.Options.Flip;
        var started = clock.UtcNow;
        var planned = block.MeridianFlip?.PlannedUtc ?? entry.AtUtc;
        var limitEnd = flip is null ? entry.AtUtc.AddSeconds(entry.DurationS ?? 0) : FlipRules.LimitEnd(planned, flip);
        while (clock.UtcNow < limitEnd && host.MinutesToEarliestFlip() is > 0)
        {
            var next = clock.UtcNow + FlipWaitTick;
            await host.DelayAsync(next < limitEnd ? next : limitEnd, token).ConfigureAwait(false);
        }
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
                Flipped(run, pierBefore ?? "unknown", pierAfter ?? "unknown", FlipRules.DurationS(clock.UtcNow, triggerStart, planned));
                break;
            default:
                // NINA hat nicht (erkennbar) geflippt: Plan-Flip bleibt offen (flipDoneByPanel unverändert, NIN5-1).
                log.Event("FLIP_UNDETECTED", ("id", block.Id));
                run.Options.Report?.Invoke(EventsKind.Flip_undetected, null, block);
                break;
        }
        // Verzug: Warten auf die früheste Flipzeit und der Flip selbst gegen die geplante Flipdauer (§4.2).
        Overrun(run, started, entry.DurationS ?? durationS);
    }

    private async Task RunNonExposureAsync(Run run, int index, int nextExpose, bool skip, CancellationToken token)
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
                await FlipAsync(run, e, token).ConfigureAwait(false);
                break;
            case EntriesCmd.Slew_center or EntriesCmd.Slew_center_rotate when run.RecenterPending:
                // Nach dem Flip nur Zentrieren, auch bei einem älteren Plan mit slew_center_rotate (NT-E4).
                await RecenterAfterFlipAsync(run, e.DurationS ?? 0, token).ConfigureAwait(false);
                break;
            case EntriesCmd.Wait when !skip:
                var until = e.AtUtc.AddSeconds(e.DurationS ?? 0);
                var flip = block.Entries.Skip(index + 1).Take(nextExpose - index - 1)
                    .FirstOrDefault(x => x.Cmd == EntriesCmd.Meridian_flip);
                if (flip is not null && flip.AtUtc < until) until = flip.AtUtc;
                // Planuhr: der Plan ist um den Verzug verschoben (zeitgeführt, §4.2).
                if ((run.Options.Mode ?? Mode) == PlaybackMode.TimeAware) until += run.Offset;
                if (until > clock.UtcNow) await host.DelayAsync(until, token).ConfigureAwait(false);
                break;
            default:
                // autofocus_hint ist Zeitmarke (NT-24); slew_center ohne vorangegangenen Flip ebenso (Panelwechsel = neuer Block).
                break;
        }
    }
}
