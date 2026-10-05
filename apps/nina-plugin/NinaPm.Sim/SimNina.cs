using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Session;
using NinaPm.Core.Time;

namespace NinaPm.Sim;

/// <summary>
/// Simuliertes NINA für den Blockablauf (IBlockHost/INightHost): dieselben Regeln wie der NINA-Adapter
/// (<see cref="HostRules"/>: Filter, Auslesemodus, Hinweise, Aufnahme-Meldung), Geräte aus <see cref="SimWorld"/>. Jede
/// Aktion stellt die virtuelle Uhr um ihre Dauer vor; eine Belichtung bricht ab, sobald der Sequenz-Token abgebrochen
/// wird (Safety, Benutzer-Stopp, Absturz).
/// </summary>
public sealed partial class SimNina(VirtualClock clock, SimWorld world, Func<NightRunner?> runner, NinaPmLog log, Func<bool> dead, TextWriter logWriterForSim)
    : IBlockHost, INightHost
{
    public const double DownloadS = 2;
    private readonly HostRules rules = new(clock, () => log, runner);
    private string? currentFilter;
    private (Guid ProjectId, Guid? PanelId)? lastCentered;
    private bool interrupted;

    // ---- INightHost ---------------------------------------------------------------------------------

    /// <summary>Abgestürzt: als Unterbrechung einordnen, damit der tote Prozess keine Session beendet.</summary>
    public SafetyState ReadSafety() => dead() ? new SafetyState(true, false, false) : new SafetyState(true, world.MonitorConnected, world.MonitorSafe);

    public DateTimeOffset? LastAutofocusUtc => world.LastAutofocusUtc;

    public void OnInterrupted() => interrupted = true;

    public void PlanBuilt(NinaTargets? targets, NinaPlanResponse plan)
    {
        rules.PlanBuilt(targets, world.ProfileFilters, world.DitherTrigger ? "DitherAfterExposures" : null);
        rules.FlipInTransit(plan, world.AutoFocusAfterFlip);
        var siteOffset = runner()?.Bootstrap is { } b ? SiteCheck.SiteOffset(b, clock.UtcNow) : null;
        var pc = world.PcUtcOffsetMinutes is { } m ? TimeSpan.FromMinutes(m) : siteOffset ?? TimeSpan.Zero;
        rules.CheckSite(new SiteFacts(pc, 31.5471, -99.3823, 0, world.RotatorRangeQuarter, world.FlipTrigger,
            world.ProfileLocation.ElementAtOrDefault(0), world.ProfileLocation.ElementAtOrDefault(1)));
    }

    // ---- IBlockHost ---------------------------------------------------------------------------------

    public bool IsViableNow(Blocks block) => true;

    public string? UnexposableReason(Blocks block) => rules.UnexposableReason(block, world.ProfileFilters, world.ReadoutModes);

    private Blocks? target;

    /// <summary>Trigger-Regeln des Blocks (Transit, §5) und schon gemeldete Unterdrückungen.</summary>
    private TransitTriggerContext? transitTriggers;
    private readonly HashSet<string> suppressedLogged = [];

    public void SetTarget(Blocks block)
    {
        target = block;
        transitTriggers = TriggerPolicy.ForBlock(block, runner()?.Targets);
        suppressedLogged.Clear();
    }

    public bool CanSkipSlew(Blocks block) =>
        !interrupted && !world.Parked && lastCentered == (block.ProjectId, block.PanelId);

    public async Task<CenterResult> SlewCenterAsync(Blocks block, bool rotate, CancellationToken token)
    {
        var newTarget = lastCentered != (block.ProjectId, block.PanelId);
        var name = runner()?.Targets?.Projects.FirstOrDefault(p => p.Id == block.ProjectId)?.Name;
        if (name is not null && world.CenterFailProjects.Contains(name))
        {
            // Falsche Zielkoordinaten: NINAs Center gibt nach seinen Plate-Solve-Versuchen auf.
            await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(world.CenterFailS), token).ConfigureAwait(false);
            world.Parked = false;
            return new CenterResult(false, "Cancelling centering after 10 unsuccessful slew attempts");
        }
        await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(world.CenterS + (newTarget ? world.CenterDelayS : 0)), token).ConfigureAwait(false);
        world.Parked = false;
        // Auch ein unvermeidlicher Flip im Transitfenster (planned: false, Lücke ausgewiesen, NT-25): NINA flippt trotzdem.
        if (newTarget && block.MeridianFlip is { } flip && (flip.Planned || flip.GapStartUtc is not null))
        {
            // Montierung: früheste Flipzeit des Ziels = Plan-Flipzeit + Abweichung der Montierung; vorher westlich.
            world.EarliestFlipUtc = flip.PlannedUtc.AddSeconds(world.MountFlipOffsetS);
            world.Pier = clock.UtcNow >= world.EarliestFlipUtc.Value.AddMinutes(10) ? "east" : "west";
        }
        else if (newTarget)
        {
            // Ohne Flip im Block (Meridian schon vorbei oder nicht in der Nacht): Pier-Seite bleibt, kein Flip mehr fällig.
            world.EarliestFlipUtc = null;
        }
        lastCentered = (block.ProjectId, block.PanelId);
        interrupted = false;
        return new CenterResult(true);
    }

    // ---- Flip und Rotation (AP-16f) ----------------------------------------------------------------

    public bool RotatorConnected => world.RotatorConnected;

    public bool NinaRecentersAfterFlip => world.Recenter;

    public string? PierSide() => world.PierKnown ? world.Pier : null;

    public double? MinutesToEarliestFlip() =>
        world.EarliestFlipUtc is { } e ? (e - clock.UtcNow).TotalMinutes : 600;

    /// <summary>NINAs Meridian-Flip-Trigger: flippt bei jedem Aufruf ab der frühesten Flipzeit (L8), wenn er in der Sequenz ist.</summary>
    private async Task NinaFlipTriggerAsync(CancellationToken token)
    {
        if (!world.FlipTrigger || world.Pier != "west" || world.EarliestFlipUtc is not { } e || clock.UtcNow < e) return;
        FileLogSink.Sim(logWriterForSim, clock, "NINA meridian flip");
        await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(world.FlipDurationS), token).ConfigureAwait(false);
        world.Pier = "east";
        world.Flips++;
    }

    public Task RunTriggersAsync(CancellationToken token) => NinaFlipTriggerAsync(token);

    public Task<SolveReading> SolveAsync(CancellationToken token)
    {
        if (!world.SolveAvailable || target is null) return Task.FromResult(new SolveReading(null));
        // Ohne Rotator der Kamerawinkel, mit Rotator der Soll-Winkel; nach dem Flip steht der Himmels-PA um 180° gedreht.
        var pa = (world.RotatorConnected ? target.RotationDeg : world.CameraAngleDeg ?? target.RotationDeg) + (world.Pier == "east" ? 180 : 0);
        return Task.FromResult(new SolveReading(Rotation.Normalize(pa)));
    }

    public Task BeforeTargetChangeAsync(CancellationToken token) => Task.CompletedTask;

    public Task AfterTargetChangeAsync(CancellationToken token) => Task.CompletedTask;

    public Task StartGuidingAsync(CancellationToken token) => Task.CompletedTask;

    public async Task ChangeFilterAsync(Entries entry, CancellationToken token)
    {
        currentFilter = null;
        var r = rules.ChooseFilter(entry, world.ProfileFilters);
        if (r.Kind is FilterResolutionKind.NoWheel or FilterResolutionKind.NotFound) return;
        currentFilter = world.ProfileFilters[r.Index];
        await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(5), token).ConfigureAwait(false);
    }

    public CameraCooling ReadCooling() => new(world.CoolerOn, world.CameraTemperatureC);

    public async Task<ExposureResult> ExposeAsync(Blocks block, Entries entry, bool temperatureDeviation, CancellationToken token)
    {
        if (world.ProfileFilters.Count > 0 && currentFilter is null) await ChangeFilterAsync(entry, token);
        if (world.ProfileFilters.Count > 0 && currentFilter is null) return ExposureResult.Skipped;
        if (rules.ChooseReadout(entry, world.ReadoutModes).Kind == ReadoutResolutionKind.NotFound) return ExposureResult.Skipped;
        // NINAs Trigger-Walk vor der Belichtung: ab der frühesten Flipzeit flippt der Meridian-Flip-Trigger (±1 Belichtung).
        await NinaFlipTriggerAsync(token).ConfigureAwait(false);
        // Autofokus-Trigger: im Transit ohne Erlaubnis der Beobachtung unterdrückt (dieselbe Regel wie der Adapter).
        const string af = "AutofocusAfterTimeTrigger";
        var afSuppressed = world.AfTrigger && TriggerPolicy.Suppressed(af, transitTriggers);
        if (afSuppressed && suppressedLogged.Add(af))
        {
            log.Event("TRIGGER_SUPPRESSED", ("type", af));
            runner()?.ReportEvent(EventsKind.Trigger_suppressed, af, data: new Dictionary<string, object> { ["type"] = af });
        }
        else if (!afSuppressed && world.AfTrigger && world.AfEveryMin > 0
            && (world.LastAutofocusUtc is not { } lastAf || clock.UtcNow - lastAf >= TimeSpan.FromMinutes(world.AfEveryMin)))
        {
            // NINAs Autofokus nach Zeit (Trigger vor der Belichtung) mit realer Dauer – unabhängig vom `autofocus_hint` des Plans.
            FileLogSink.Sim(logWriterForSim, clock, "NINA autofocus");
            await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(world.AfDurationS), token).ConfigureAwait(false);
            world.LastAutofocusUtc = clock.UtcNow;
        }
        var exposureS = entry.ExposureS ?? 0;
        var id = Uuid7.New(clock);
        var start = clock.UtcNow;
        // Rotator: der mechanische Winkel steht auf dem Soll des Blocks und bleibt beim Flip (NT-E4) – Flat-Kombinationen je Winkel.
        var mech = world.RotatorConnected ? Rotation.Normalize(block.RotationDeg) : 0;
        var facts = rules.Facts(id, block, entry, currentFilter, temperatureDeviation, exposureS, world.ReadoutModes, mech, "pierWest");
        try
        {
            await clock.AdvanceToAsync(start.AddSeconds(exposureS), token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            if (!dead()) rules.Aborted(id, facts);
            throw;
        }
        // Download und Speichern laufen auch nach einem Abbruch zu Ende (NINA speichert das Bild).
        await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(DownloadS), CancellationToken.None).ConfigureAwait(false);
        if (facts is null || dead()) return ExposureResult.Saved;
        world.ImageCounter++;
        var file = $"SIM_{entry.Filter}_{world.ImageCounter:0000}.fits";
        rules.Saved(facts with { CapturedAtUtc = start, ExposureMidUtc = start.AddSeconds(exposureS / 2) },
            new Metrics { Hfr = 2.1, Stars = 900, MeanAdu = 1200, SensorTempC = world.CameraTemperatureC, SetPointC = world.CameraSetpointC },
            file);
        return ExposureResult.Saved;
    }

    public Task DitherAsync(CancellationToken token) => clock.AdvanceToAsync(clock.UtcNow.AddSeconds(world.DitherSettleS), token);

    public Task DelayAsync(DateTimeOffset untilUtc, CancellationToken token) => clock.AdvanceToAsync(untilUtc, token);
}

/// <summary>NINA-Einstellungen für den Heartbeat aus dem simulierten Profil (Filterplätze ab 1, Kamera, Auslesemodi).</summary>
public sealed class SimSettings(SimWorld world, double latDeg, double lonDeg) : INinaSettingsSource
{
    public NinaHeartbeat Snapshot() => new()
    {
        ProfileLocation = new ProfileLocation { LatDeg = latDeg, LonDeg = lonDeg },
        FilterWheel = [.. world.ProfileFilters.Select((name, i) => new FilterWheel { Position = i + 1, Name = name, FocusOffset = 0 })],
        Camera = new Camera { TemperatureC = world.CameraTemperatureC, SetPointC = world.CameraSetpointC, CoolerOn = world.CoolerOn, CoolerPowerPct = 40 },
        CameraReadoutModes = [.. world.ReadoutModes.Select((name, i) => new CameraReadoutModes { Index = i, Name = name })],
        Rotator = new Rotator
        {
            Connected = world.RotatorConnected,
            RangeType = world.RotatorRangeQuarter ? RotatorRangeType.QUARTER : RotatorRangeType.FULL,
            RangeStartMechanicalDeg = 0,
            Reverse = false,
        },
        MeridianFlip = new MeridianFlip
        {
            TriggerPresent = world.FlipTrigger,
            UseSideOfPier = true,
            Recenter = world.Recenter,
            AutoFocusAfterFlip = world.AutoFocusAfterFlip,
            SettleTimeS = 0,
            PauseBeforeMin = world.FlipPauseBeforeMin,
            AfterMin = 5,
            MaxAfterMin = 10,
        },
        SequenceTriggers = new SequenceTriggers
        {
            Autofocus = world.AfTrigger ? ["AutofocusAfterTimeTrigger"] : [],
            Dither = world.DitherTrigger ? ["DitherAfterExposures"] : [],
            AutofocusAfterTimeMin = null,
        },
    };
}
