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
public sealed class SimNina(VirtualClock clock, SimWorld world, Func<NightRunner?> runner, NinaPmLog log, Func<bool> dead)
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

    public DateTimeOffset? LastAutofocusUtc => null;

    public void OnInterrupted() => interrupted = true;

    public void PlanBuilt(NinaTargets? targets) =>
        rules.PlanBuilt(targets, world.ProfileFilters, world.DitherTrigger ? "DitherAfterExposures" : null);

    // ---- IBlockHost ---------------------------------------------------------------------------------

    public bool IsViableNow(Blocks block) => true;

    public void SetTarget(Blocks block)
    {
    }

    public bool CanSkipSlew(Blocks block) =>
        !interrupted && !world.Parked && lastCentered == (block.ProjectId, block.PanelId);

    public async Task<CenterResult> SlewCenterAsync(Blocks block, CancellationToken token)
    {
        await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(60), token).ConfigureAwait(false);
        world.Parked = false;
        lastCentered = (block.ProjectId, block.PanelId);
        interrupted = false;
        return new CenterResult(true);
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
        if (world.ProfileFilters.Count > 0 && currentFilter is null) return ExposureResult.Skipped;
        if (rules.ChooseReadout(entry, world.ReadoutModes).Kind == ReadoutResolutionKind.NotFound) return ExposureResult.Skipped;
        var exposureS = entry.ExposureS ?? 0;
        var id = Uuid7.New(clock);
        var start = clock.UtcNow;
        var facts = rules.Facts(id, block, entry, currentFilter, temperatureDeviation, exposureS, world.ReadoutModes, 0, "pierWest");
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

    public Task DitherAsync(CancellationToken token) => clock.AdvanceToAsync(clock.UtcNow.AddSeconds(10), token);

    public async Task MeridianFlipAsync(Blocks block, Entries entry, CancellationToken token)
    {
        if (entry.AtUtc > clock.UtcNow) await clock.AdvanceToAsync(entry.AtUtc, token).ConfigureAwait(false);
        await clock.AdvanceToAsync(clock.UtcNow.AddSeconds(entry.DurationS ?? 240), token).ConfigureAwait(false);
    }

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
        SequenceTriggers = new SequenceTriggers
        {
            Autofocus = [],
            Dither = world.DitherTrigger ? ["DitherAfterExposures"] : [],
            AutofocusAfterTimeMin = null,
        },
    };
}
