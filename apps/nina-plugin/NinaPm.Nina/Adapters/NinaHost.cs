using System.Collections.Concurrent;
using System.IO;
using NINA.Astrometry;
using NINA.Core.Enum;
using NINA.Core.Model;
using NINA.Core.Utility;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Profile.Interfaces;
using NINA.Sequencer.Conditions;
using NINA.Sequencer.Container;
using NINA.Sequencer.SequenceItem;
using NINA.Sequencer.SequenceItem.Platesolving;
using NINA.Sequencer.Trigger.Platesolving;
using NINA.WPF.Base.Interfaces.Mediator;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Planning;
using NinaPm.Core.Time;
using NinaPm.Nina.Sequencer;

namespace NinaPm.Nina.Adapters;

/// <summary>
/// NINA-Seite des Blockablaufs (execution.md §4.1–§4.3, TK 10.3 Nr. 4/5): setzt <see cref="IBlockHost"/> und
/// <see cref="INightHost"/> auf NINAs Mediatoren um. Muster nach dem Astro-PM-Plugin (MIT), Commit 5dd621d:
/// <c>Instructions/TargetInstructionSet.cs</c> (Ziel setzen, Center-after-Drift, interne Elemente am Container) und
/// <c>Instructions/AstroPMChildItems.cs</c> (Belichtung, Bildpipeline); Trigger-Walk und Bildzuordnung wie im
/// Probe-Plugin (AP-S2b, P-01…P-03 go). Koordinaten mit <c>Angle.ByDegree</c> (NT-28), nicht <c>ByHours</c>.
/// </summary>
internal sealed class NinaHost(NinaMediators m) : IBlockHost, INightHost
{
    private static readonly TimeSpan SaveTimeout = TimeSpan.FromSeconds(120);
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(10);

    private readonly IClock clock = SystemClock.Instance;
    private readonly ConcurrentDictionary<int, (Guid CaptureId, Blocks Block, Entries Entry)> pending = new();
    private int handlerAttached;
    private NINA.Core.Model.Equipment.FilterInfo? currentFilter;
    private ISequenceItem? previousItem;
    private (Guid ProjectId, Guid? PanelId, DateTimeOffset EndUtc)? lastCentered;
    private bool interruptedSinceCenter;

    /// <summary>Container, der gerade ausgeführt wird (setzt <see cref="NinaPmContainer.Execute"/>).</summary>
    public NinaPmContainer? Container { get; set; }

    public NinaPmRuntime? Runtime { get; set; }

    public IProgress<ApplicationStatus>? Progress { get; set; }

    private NinaPmContainer Box => Container ?? throw new InvalidOperationException("kein NINA-PM-Container aktiv");

    // ---- INightHost ---------------------------------------------------------------------------------------

    public SafetyState ReadSafety()
    {
        var info = m.SafetyMonitor.GetInfo();
        return new SafetyState(AncestorHasSafetyCondition(Container), info.Connected, info.IsSafe);
    }

    public static bool AncestorHasSafetyCondition(ISequenceContainer? start)
    {
        for (var c = start?.Parent; c is not null; c = c.Parent)
            if (c is SequenceContainer container && container.GetConditionsSnapshot().Any(x => x is SafetyMonitorCondition))
                return true;
        return false;
    }

    /// <summary>Letzter AF aus NINAs Historie (PC-Ortszeit → UTC wie <c>AutofocusAfterTimeTrigger</c>, NT-24).</summary>
    public DateTimeOffset? LastAutofocusUtc
    {
        get
        {
            var time = m.ImageHistory.AutoFocusPoints?.LastOrDefault()?.AutoFocusPoint?.Time;
            return time is { } t ? new DateTimeOffset(t.ToUniversalTime(), TimeSpan.Zero) : null;
        }
    }

    public void OnInterrupted() => interruptedSinceCenter = true;

    // ---- IBlockHost: Vorbereitung -----------------------------------------------------------------------

    /// <summary>
    /// Höhe und Dunkelheit jetzt (§4.1 Nr. 3): Ziel über der Mindesthöhe des Projekts (sonst 0°) und vor dem Ende der
    /// eigenen Dämmerungsgrenze. Im Testbetrieb (NIN-17, alle drei Bedingungen) immer machbar.
    /// </summary>
    public bool IsViableNow(Blocks block)
    {
        if (Runtime?.TestModeActive == true) return true;
        var now = clock.UtcNow;
        if (block.TwilightEndUtc is { } end && now >= end) return false;
        var astro = m.Profile.ActiveProfile.AstrometrySettings;
        var minAlt = Runtime?.Runner.Targets?.Projects.FirstOrDefault(p => p.Id == block.ProjectId)?.Conditions.MinAltitudeDeg ?? 0;
        var alt = Coordinates(block).Transform(Angle.ByDegree(astro.Latitude), Angle.ByDegree(astro.Longitude), astro.Elevation).Altitude.Degree;
        return alt >= minAlt;
    }

    /// <summary>J2000-Koordinaten des Blocks in Grad (NT-28: <c>raDeg = 198,069</c> → RA 13,2046 h).</summary>
    public static Coordinates Coordinates(Blocks block) =>
        new(Angle.ByDegree(block.RaDeg), Angle.ByDegree(block.DecDeg), Epoch.J2000);

    public void SetTarget(Blocks block)
    {
        var coords = new InputCoordinates(Coordinates(block));
        var astro = m.Profile.ActiveProfile.AstrometrySettings;
        var target = new InputTarget(Angle.ByDegree(astro.Latitude), Angle.ByDegree(astro.Longitude), astro.Horizon)
        {
            TargetName = TargetName(block),
            InputCoordinates = coords,
            PositionAngle = block.RotationDeg,
        };
        if (target.DeepSkyObject is not null)
        {
            target.DeepSkyObject.Name = target.TargetName;
            target.DeepSkyObject.Coordinates = coords.Coordinates;
        }
        Box.Target = target;
        previousItem = null;
        // Koordinaten in Center-after-Drift der Vorfahren injizieren (TargetInstructionSet.cs SetTargetFromBlock).
        foreach (var trigger in AncestorTriggers())
            if (trigger is CenterAfterDriftTrigger drift)
            {
                drift.AttachNewParent(Box);
                drift.Coordinates = coords.Clone();
                drift.Inherited = true;
                drift.SequenceBlockInitialize();
            }
    }

    /// <summary>Name, unter dem die Lights gespeichert werden: Projekt bzw. „Projekt – Panel-Label“ (§4.1 Nr. 4).</summary>
    private string TargetName(Blocks block)
    {
        var project = Runtime?.Runner.Targets?.Projects.FirstOrDefault(p => p.Id == block.ProjectId);
        if (project is null) return "NINA-PM";
        var panel = project.Panels.FirstOrDefault(p => p.Id == block.PanelId);
        return project.Panels.Count > 1 && panel is not null ? $"{project.Name} – {panel.Label}" : project.Name;
    }

    public bool CanSkipSlew(Blocks block)
    {
        if (lastCentered is not { } last || last.PanelId is not { } panel) return false;
        var info = m.Telescope.GetInfo();
        var offset = ArcminBetween(m.Telescope.GetCurrentPosition().Transform(Epoch.J2000), Coordinates(block));
        return ReplanPolicy.SkipSlew(last.ProjectId, panel, last.EndUtc, block, info.AtPark, interruptedSinceCenter, offset);
    }

    private static double ArcminBetween(Coordinates a, Coordinates b)
    {
        double R(double deg) => deg * Math.PI / 180;
        var d = Math.Acos(Math.Clamp(
            Math.Sin(R(a.Dec)) * Math.Sin(R(b.Dec)) + Math.Cos(R(a.Dec)) * Math.Cos(R(b.Dec)) * Math.Cos(R(a.RADegrees - b.RADegrees)), -1, 1));
        return d * 180 / Math.PI * 60;
    }

    /// <summary>
    /// Ein Versuch Slew + Zentrieren über NINAs eigene Anweisungen (Center bzw. Center and Rotate mit
    /// <c>PositionAngle = block.rotationDeg</c>, NT-E4), am Container hängend; NINA meldet Fehlschlag als Ausnahme.
    /// </summary>
    public async Task<CenterResult> SlewCenterAsync(Blocks block, CancellationToken token)
    {
        var coords = new InputCoordinates(Coordinates(block));
        var rotate = block.RotationMode == BlocksRotationMode.Rotator && m.Rotator.GetInfo().Connected;
        if (block.RotationMode == BlocksRotationMode.Rotator && !rotate)
            Runtime?.Log.Warning("WARNING", ("code", "rotator_unavailable"), ("block", block.Id));
        Center item = rotate
            ? new CenterAndRotate(m.Profile, m.Telescope, m.Imaging, m.Rotator, m.FilterWheel, m.Guider, m.Dome, m.DomeFollower,
                m.PlateSolverFactory, m.WindowServiceFactory) { Coordinates = coords, PositionAngle = block.RotationDeg }
            : new Center(m.Profile, m.Telescope, m.Imaging, m.FilterWheel, m.Guider, m.Dome, m.DomeFollower,
                m.PlateSolverFactory, m.WindowServiceFactory) { Coordinates = coords };
        item.AttachNewParent(Box);
        try
        {
            await item.Execute(Progress ?? new Progress<ApplicationStatus>(), token);
            lastCentered = (block.ProjectId, block.PanelId, block.EndUtc);
            interruptedSinceCenter = false;
            return new CenterResult(true);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            Logger.Warning($"NINA-PM: Zentrieren fehlgeschlagen: {ex.Message}");
            return new CenterResult(false, ex.Message);
        }
    }

    public Task BeforeTargetChangeAsync(CancellationToken token) => Task.CompletedTask; // Trigger-Sets FA-NIN-16: AP-16h

    public Task AfterTargetChangeAsync(CancellationToken token)
    {
        if (Box.Target is not null && lastCentered is { } c) lastCentered = c with { EndUtc = clock.UtcNow };
        return Task.CompletedTask;
    }

    public async Task StartGuidingAsync(CancellationToken token)
    {
        if (!m.Guider.GetInfo().Connected) return;
        if (!await m.Guider.StartGuiding(false, Progress ?? new Progress<ApplicationStatus>(), token))
            Runtime?.Log.Warning("WARNING", ("code", "guiding_failed"));
    }

    // ---- IBlockHost: Einträge -----------------------------------------------------------------------------

    /// <summary>
    /// Filter über den bestätigten <c>ninaFilterName</c> der Rig-Filter (Bootstrap), exakt wie im NINA-Profil (§4.4,
    /// NT-E1); kein Präfix, nie ein anderer Filter. Fehlt er, wird die folgende Belichtung übersprungen (Feinheiten AP-16d).
    /// </summary>
    public async Task ChangeFilterAsync(Entries entry, CancellationToken token)
    {
        currentFilter = null;
        var filters = m.Profile.ActiveProfile.FilterWheelSettings.FilterWheelFilters;
        if (filters is null || filters.Count == 0 || entry.Filter is null) return;
        var nina = Runtime?.Runner.Bootstrap?.Rig.Filters.FirstOrDefault(f => f.ShortName == entry.Filter)?.NinaFilterName;
        currentFilter = nina is null ? null : filters.FirstOrDefault(f => string.Equals(f.Name, nina, StringComparison.Ordinal));
        if (currentFilter is null)
        {
            Runtime?.Log.Event("FILTER_NOT_FOUND", ("filter", nina ?? ""), ("short", entry.Filter));
            return;
        }
        await m.FilterWheel.ChangeFilter(currentFilter, token, Progress ?? new Progress<ApplicationStatus>());
    }

    public async Task<ExposureResult> ExposeAsync(Blocks block, Entries entry, CancellationToken token)
    {
        var filters = m.Profile.ActiveProfile.FilterWheelSettings.FilterWheelFilters;
        if (filters is { Count: > 0 } && currentFilter is null) return ExposureResult.Skipped;
        if (!ApplyReadoutMode(entry)) return ExposureResult.Skipped;

        var item = new TakeExposureItem(this, m, block, entry, currentFilter, Uuid7.New(clock));
        item.AttachNewParent(Box);
        var progress = Progress ?? new Progress<ApplicationStatus>();
        await TriggerWalker.RunAsync(Box, after: false, previousItem, item, progress, Runtime, token);
        try
        {
            await item.Execute(progress, token);
        }
        catch (OperationCanceledException)
        {
            Runtime?.Log.Event("CAPTURE", ("id", item.CaptureId), ("result", "aborted"), ("atUtc", clock.UtcNow));
            throw;
        }
        await TriggerWalker.RunAsync(Box, after: true, item, item, progress, Runtime, token);
        previousItem = item;
        return item.Captured ? ExposureResult.Saved : ExposureResult.Failed;
    }

    /// <summary>Auslesemodus per Name → Index (§4.3, NT-37); genau ein Modus → diesen; sonst Belichtung überspringen.</summary>
    private bool ApplyReadoutMode(Entries entry)
    {
        if (string.IsNullOrEmpty(entry.ReadoutMode)) return true;
        var modes = m.Camera.GetInfo().ReadoutModes?.ToList() ?? [];
        var index = modes.FindIndex(x => string.Equals(x, entry.ReadoutMode, StringComparison.OrdinalIgnoreCase));
        if (index < 0 && modes.Count == 1) index = 0;
        if (index < 0)
        {
            Runtime?.Log.Event("READOUT_MODE_NOT_FOUND", ("name", entry.ReadoutMode));
            return false;
        }
        m.Camera.SetReadoutModeForNormalImages((short)index);
        return true;
    }

    public async Task DitherAsync(CancellationToken token)
    {
        if (m.Guider.GetInfo().Connected) await m.Guider.Dither(token);
    }

    /// <summary>
    /// Flip (NT-21, M3): ab <c>atUtc</c> die Vorfahren-Trigger aufrufen – NINAs <em>Meridian Flip</em>-Trigger flippt,
    /// sobald die früheste Flipzeit erreicht ist. Warten auf die früheste Flipzeit und Erkennung folgen mit AP-16f.
    /// </summary>
    public async Task MeridianFlipAsync(Blocks block, Entries entry, CancellationToken token)
    {
        if (entry.AtUtc > clock.UtcNow) await DelayAsync(entry.AtUtc, token);
        await TriggerWalker.RunAsync(Box, after: false, previousItem, Box, Progress ?? new Progress<ApplicationStatus>(), Runtime, token);
    }

    /// <summary>Wartet im 10-s-Takt (abbrechbar) bis <paramref name="untilUtc"/>.</summary>
    public async Task DelayAsync(DateTimeOffset untilUtc, CancellationToken token)
    {
        while (true)
        {
            var left = untilUtc - clock.UtcNow;
            if (left <= TimeSpan.Zero) return;
            await Task.Delay(left < Tick ? left : Tick, token);
        }
    }

    // ---- Bildzuordnung (§4.3, NIN5-11) --------------------------------------------------------------------

    private IEnumerable<NINA.Sequencer.Trigger.ISequenceTrigger> AncestorTriggers()
    {
        for (var c = Box.Parent; c is not null; c = c.Parent)
            if (c is SequenceContainer container)
                foreach (var t in container.GetTriggersSnapshot())
                    yield return t;
    }

    /// <summary>Zuordnung <c>Image.Id → Aufnahme</c> vor <c>Enqueue</c>; ein globaler Handler, gelöst erst, wenn nichts mehr aussteht.</summary>
    internal void RegisterPending(int imageId, Guid captureId, Blocks block, Entries entry)
    {
        pending[imageId] = (captureId, block, entry);
        if (Interlocked.Exchange(ref handlerAttached, 1) == 0) m.ImageSave.ImageSaved += OnImageSaved;
        _ = Task.Run(async () =>
        {
            await Task.Delay(SaveTimeout);
            if (pending.TryRemove(imageId, out var p))
            {
                Runtime?.Log.Event("CAPTURE", ("id", p.CaptureId), ("result", "failed"), ("atUtc", clock.UtcNow));
                Runtime?.Log.Warning("WARNING", ("code", "image_not_saved"), ("id", p.CaptureId));
                ReleaseIfDrained();
            }
        });
    }

    private void OnImageSaved(object? sender, ImageSavedEventArgs e)
    {
        var imageId = e.MetaData?.Image?.Id;
        if (imageId is null || !pending.TryRemove(imageId.Value, out var p)) return;
        var file = e.PathToImage is null ? "" : Path.GetFileName(e.PathToImage.LocalPath);
        Runtime?.Log.Event("CAPTURE", ("id", p.CaptureId), ("result", "saved"), ("file", file), ("atUtc", clock.UtcNow));
        Runtime?.Runner.ExposureSaved(p.Block, p.Entry);
        ReleaseIfDrained();
    }

    private void ReleaseIfDrained()
    {
        if (pending.IsEmpty && Interlocked.Exchange(ref handlerAttached, 0) == 1) m.ImageSave.ImageSaved -= OnImageSaved;
    }
}
