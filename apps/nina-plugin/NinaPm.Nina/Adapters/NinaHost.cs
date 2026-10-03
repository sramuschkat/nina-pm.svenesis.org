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
using NinaPm.Core.Reporting;
using NinaPm.Core.Time;
using NinaPm.Nina.Sequencer;
using Center = NINA.Sequencer.SequenceItem.Platesolving.Center;

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
    /// <summary>Zuordnung <c>Image.Id → Aufnahme</c> (Kern, AP-16e).</summary>
    private readonly CaptureRegistry captures = new();
    private int handlerAttached;
    private NINA.Core.Model.Equipment.FilterInfo? currentFilter;
    private ISequenceItem? previousItem;
    private (Guid ProjectId, Guid? PanelId, DateTimeOffset EndUtc)? lastCentered;
    private bool interruptedSinceCenter;
    /// <summary>Hinweise höchstens 1×/12 h je Schlüssel (filter_not_found je Filter, readout_mode_not_found je Modus, §4.3/§4.4).</summary>
    private HostRules? rules;

    /// <summary>Gemeinsame Regeln mit dem kopflosen Nachtlauf (Hinweise, Filter, Auslesemodus, Meldungen).</summary>
    private HostRules Rules => rules ??= new HostRules(clock, () => Runtime?.Log, () => Runtime?.Runner);

    /// <summary>NINAs Mediatoren (Heartbeat-Einstellungen, AP-16e).</summary>
    internal NinaMediators Mediators => m;

    /// <summary>Trigger der Vorfahren des zuletzt laufenden Containers; ohne Container keine (Heartbeat, §6).</summary>
    internal IEnumerable<NINA.Sequencer.Trigger.ISequenceTrigger> CurrentTriggers() =>
        Container is null ? [] : AncestorTriggers().ToList();

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

    /// <summary>Abweichungen von der Sequenzvorlage beim letzten Planaufbau (Hinweis auf der Optionsseite, kein Abbruch).</summary>
    public IReadOnlyList<NinaPm.Core.Sequence.TemplateDeviation> Deviations { get; private set; } = [];

    /// <summary>
    /// Nach dem Planaufbau (execution.md §1, §4.3 NT-23, §4.4): Sequenzvorlage (<see cref="HostRules.CheckSequence"/>); Dither-Trigger in den Vorfahren → einmal je Nacht
    /// <c>warning nina_dither_trigger_present</c> (der Walk unterdrückt ihn ohnehin); bestätigte NINA-Filternamen, die
    /// im Profil fehlen → <c>warning filter_wheel_changed</c> je Name höchstens 1×/12 h.
    /// </summary>
    public void PlanBuilt(NinaTargets? targets)
    {
        // Sequenzvorlage zuerst (AP-16h): sie meldet einen fehlenden Flip-Trigger mit allen übrigen Abweichungen.
        Deviations = Rules.CheckSequence(SequenceTree.FromAncestors(Container), m.SafetyMonitor.GetInfo()?.Connected == true);
        var triggers = Container is null ? [] : AncestorTriggers().ToList();
        var dither = triggers.FirstOrDefault(t => t.GetType().Name.Contains("dither", StringComparison.OrdinalIgnoreCase));
        Rules.PlanBuilt(targets, ProfileFilterNames(), dither?.GetType().Name);
        Rules.CheckSite(SiteFacts(triggers.Any(t => t.GetType().Name == "MeridianFlipTrigger")));
    }

    /// <summary>
    /// Fakten für den SiteCheck (AP-16f): PC-Zeitzone jetzt – die einzige erlaubte Stelle für
    /// <c>TimeZoneInfo.Local</c> (NT-06) –, Standort und Sternzeit-Abweichung der Montierung, Rotator-Bereich.
    /// </summary>
    private SiteFacts SiteFacts(bool flipTriggerPresent)
    {
#pragma warning disable RS0030 // NT-06: SiteCheck-Hinweis pc_timezone_differs vergleicht die PC-Zone mit der Standortzone.
        var pcOffset = TimeZoneInfo.Local.GetUtcOffset(clock.UtcNow);
#pragma warning restore RS0030
        var t = m.Telescope.GetInfo();
        double? lstDeltaS = null;
        if (t.Connected && double.IsFinite(t.SiderealTime))
        {
            var deltaH = t.SiderealTime - AstroUtil.GetLocalSiderealTimeNow(t.SiteLongitude);
            deltaH -= 24 * Math.Round(deltaH / 24);
            lstDeltaS = deltaH * 3600;
        }
        return new SiteFacts(pcOffset, t.Connected ? t.SiteLatitude : null, t.Connected ? t.SiteLongitude : null, lstDeltaS,
            m.Profile.ActiveProfile.RotatorSettings.RangeType.ToString() == "QUARTER", flipTriggerPresent);
    }

    /// <summary>Filternamen des aktiven NINA-Profils in Rad-Reihenfolge (leer ohne Filterrad).</summary>
    private List<string> ProfileFilterNames() =>
        m.Profile.ActiveProfile.FilterWheelSettings.FilterWheelFilters?.Select(f => f.Name).ToList() ?? [];

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

    public bool AnyFilterAvailable(Blocks block) => Rules.AnyFilterAvailable(block, ProfileFilterNames());

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
        // Koordinaten in Center-after-Drift der Vorfahren und in die Anweisungen der Trigger-Sets injizieren
        // (TargetInstructionSet.cs SetTargetFromBlock, FA-NIN-16).
        foreach (var trigger in AncestorTriggers())
            switch (trigger)
            {
                case CenterAfterDriftTrigger drift:
                    drift.AttachNewParent(Box);
                    drift.Coordinates = coords.Clone();
                    drift.Inherited = true;
                    drift.SequenceBlockInitialize();
                    break;
                case BeforeExposureTrigger or AfterExposureTrigger or BeforeTargetChangeTrigger or AfterTargetChangeTrigger:
                    CoordinatesInjector.Inject(((NINA.Sequencer.Trigger.SequenceTrigger)trigger).TriggerRunner, coords);
                    break;
            }
    }

    /// <summary>Name, unter dem die Lights gespeichert werden: Projekt bzw. „Projekt – Panel-Label“ (§4.1 Nr. 4).</summary>
    private string TargetName(Blocks block) => NinaPm.Core.Targets.TargetTitle.For(block, Runtime?.Runner.Targets);

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
    /// Nach dem Flip ruft der Kern mit <paramref name="allowRotate"/> = <c>false</c>: nur Center (NT-E4).
    /// </summary>
    public async Task<CenterResult> SlewCenterAsync(Blocks block, bool allowRotate, CancellationToken token)
    {
        var coords = new InputCoordinates(Coordinates(block));
        var connected = m.Rotator.GetInfo().Connected;
        var rotate = allowRotate && block.RotationMode == BlocksRotationMode.Rotator && connected;
        if (block.RotationMode == BlocksRotationMode.Rotator && !connected)
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

    /// <summary>
    /// Trigger-Sets <em>NINA-PM vor Zielwechsel</em> aller Vorfahren einschließlich der globalen Trigger (FA-NIN-16,
    /// §4.1 Nr. 6; Walk wie TargetInstructionSet.cs). Ein Fehler darin bricht den Block ab wie jeder andere.
    /// </summary>
    public async Task BeforeTargetChangeAsync(CancellationToken token)
    {
        foreach (var set in AncestorTriggers().OfType<BeforeTargetChangeTrigger>().ToList())
            await set.FireAsync(Progress ?? new Progress<ApplicationStatus>(), token);
    }

    /// <summary>
    /// Trigger-Sets <em>NINA-PM nach Zielwechsel</em> (§4.1 Nr. 7); ein Fehler darin wird nur gemeldet – der Block ist
    /// schon abgeschlossen (TargetInstructionSet.cs).
    /// </summary>
    public async Task AfterTargetChangeAsync(CancellationToken token)
    {
        if (Box.Target is not null && lastCentered is { } c) lastCentered = c with { EndUtc = clock.UtcNow };
        foreach (var set in AncestorTriggers().OfType<AfterTargetChangeTrigger>().ToList())
        {
            try
            {
                await set.FireAsync(Progress ?? new Progress<ApplicationStatus>(), token);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                Logger.Warning($"NINA-PM: Trigger-Set nach dem Zielwechsel fehlgeschlagen: {ex.Message}");
            }
        }
    }

    public async Task StartGuidingAsync(CancellationToken token)
    {
        if (!m.Guider.GetInfo().Connected) return;
        if (!await m.Guider.StartGuiding(false, Progress ?? new Progress<ApplicationStatus>(), token))
            Runtime?.Log.Warning("WARNING", ("code", "guiding_failed"));
    }

    // ---- IBlockHost: Einträge -----------------------------------------------------------------------------

    /// <summary>
    /// Filter über den bestätigten <c>ninaFilterName</c> (Zeile in <c>targets</c>, sonst Rig-Filter im Bootstrap), exakt
    /// wie im NINA-Profil (§4.4, NT-E1, <see cref="FilterResolver"/>); nie ein anderer Filter. Nicht gefunden → die
    /// folgende Belichtung wird übersprungen, <c>FILTER_NOT_FOUND</c> höchstens 1×/12 h je Filter. Ohne Filterrad kein
    /// Wechsel.
    /// </summary>
    public async Task ChangeFilterAsync(Entries entry, CancellationToken token)
    {
        currentFilter = null;
        var filters = m.Profile.ActiveProfile.FilterWheelSettings.FilterWheelFilters;
        var r = Rules.ChooseFilter(entry, ProfileFilterNames());
        switch (r.Kind)
        {
            case FilterResolutionKind.NoWheel:
            case FilterResolutionKind.NotFound:
                return;
            default:
                currentFilter = filters![r.Index];
                await m.FilterWheel.ChangeFilter(currentFilter, token, Progress ?? new Progress<ApplicationStatus>());
                return;
        }
    }

    /// <summary>Kühlung jetzt (NT-E2); ohne verbundene Kamera „aus“ und ohne Messwert.</summary>
    public CameraCooling ReadCooling()
    {
        var c = m.Camera.GetInfo();
        return c.Connected
            ? new CameraCooling(c.CoolerOn, double.IsFinite(c.Temperature) ? c.Temperature : null)
            : new CameraCooling(false, null);
    }

    /// <summary>
    /// Fakten einer Aufnahme vor der Belichtung (AP-16e, execution.md §4.3): Plan, nach dem belichtet wird, die an NINA
    /// übergebenen Werte, Pier-Seite nach fester ASCOM-Zuordnung (NT-34), gemessener mechanischer Rotatorwinkel (ohne
    /// Rotator 0). Zeiten vorläufig (jetzt), bis NINAs Metadaten vorliegen. Ohne laufenden Plan <c>null</c>.
    /// </summary>
    internal CaptureFacts? CaptureFactsFor(Guid captureId, Blocks block, Entries entry, NINA.Core.Model.Equipment.FilterInfo? filter,
        bool temperatureDeviation, double exposureS)
    {
        var rotator = m.Rotator.GetInfo();
        var telescope = m.Telescope.GetInfo();
        return Rules.Facts(captureId, block, entry, filter?.Name, temperatureDeviation, exposureS,
            m.Camera.GetInfo().ReadoutModes?.ToList(),
            rotator.Connected && float.IsFinite(rotator.MechanicalPosition) ? rotator.MechanicalPosition : 0,
            telescope.Connected ? telescope.SideOfPier.ToString() : null);
    }

    public async Task<ExposureResult> ExposeAsync(Blocks block, Entries entry, bool temperatureDeviation, CancellationToken token)
    {
        var filters = m.Profile.ActiveProfile.FilterWheelSettings.FilterWheelFilters;
        // Filter beim Filterwechsel nicht gefunden: mit den aktuellen Zielen erneut versuchen – eine im Web bestätigte
        // Zuordnung wirkt so ab der nächsten Belichtung, nicht erst im nächsten Block (P-05 prod 03.10.2026).
        if (filters is { Count: > 0 } && currentFilter is null) await ChangeFilterAsync(entry, token);
        if (filters is { Count: > 0 } && currentFilter is null) return ExposureResult.Skipped;
        if (!ApplyReadoutMode(entry)) return ExposureResult.Skipped;

        var item = new TakeExposureItem(this, m, block, entry, currentFilter, Uuid7.New(clock), temperatureDeviation);
        item.AttachNewParent(Box);
        var progress = Progress ?? new Progress<ApplicationStatus>();
        await TriggerWalker.RunAsync(Box, after: false, previousItem, item, progress, Runtime, token);
        try
        {
            await item.Execute(progress, token);
        }
        catch (OperationCanceledException)
        {
            Rules.Aborted(item.CaptureId, item.Facts);
            throw;
        }
        await TriggerWalker.RunAsync(Box, after: true, item, item, progress, Runtime, token);
        previousItem = item;
        return item.Captured ? ExposureResult.Saved : ExposureResult.Failed;
    }

    /// <summary>
    /// Auslesemodus per Name → Index (§4.3, NT-37, <see cref="ReadoutResolver"/>); genau ein Modus → diesen; nie über
    /// den Index. Nicht gefunden → Belichtung überspringen, <c>READOUT_MODE_NOT_FOUND</c> höchstens 1×/12 h je Modus.
    /// Vor jeder Belichtung neu gesetzt, weil die Einstellung in NINA dauerhaft wirkt.
    /// </summary>
    private bool ApplyReadoutMode(Entries entry)
    {
        var r = Rules.ChooseReadout(entry, m.Camera.GetInfo().ReadoutModes?.ToList());
        switch (r.Kind)
        {
            case ReadoutResolutionKind.Unchanged:
                return true;
            case ReadoutResolutionKind.NotFound:
                return false;
            default:
                m.Camera.SetReadoutModeForNormalImages((short)r.Index);
                return true;
        }
    }

    public async Task DitherAsync(CancellationToken token)
    {
        if (m.Guider.GetInfo().Connected) await m.Guider.Dither(token);
    }

    // ---- IBlockHost: Flip und Rotation (AP-16f, execution.md §4.5) ------------------------------------------

    public bool RotatorConnected => m.Rotator.GetInfo().Connected;

    public bool NinaRecentersAfterFlip => m.Profile.ActiveProfile.MeridianFlipSettings.Recenter;

    /// <summary>Pier-Seite nach fester ASCOM-Zuordnung (NT-34); ohne Montierung <c>null</c>.</summary>
    public string? PierSide()
    {
        var t = m.Telescope.GetInfo();
        return t.Connected
            ? CaptureMapper.PierSide(t.SideOfPier.ToString()) switch
            {
                CapturesPierSide.West => "west",
                CapturesPierSide.East => "east",
                _ => null,
            }
            : null;
    }

    /// <summary>
    /// Minuten bis NINAs früheste Flipzeit wie <c>MeridianFlipTrigger.CalculateMinimumTimeRemaining</c>:
    /// <c>TimeToMeridianFlip − (MaxMinutesAfterMeridian − MinutesAfterMeridian)</c>, mit Pause vor dem Meridian zusätzlich
    /// <c>− MinutesAfterMeridian − PauseTimeBeforeMeridian</c>. Ohne Montierung <c>null</c>.
    /// </summary>
    public double? MinutesToEarliestFlip()
    {
        var t = m.Telescope.GetInfo();
        if (!t.Connected || !double.IsFinite(t.TimeToMeridianFlip)) return null;
        var s = m.Profile.ActiveProfile.MeridianFlipSettings;
        var min = TimeSpan.FromHours(t.TimeToMeridianFlip) - TimeSpan.FromMinutes(s.MaxMinutesAfterMeridian - s.MinutesAfterMeridian);
        if (s.PauseTimeBeforeMeridian != 0)
            min = min - TimeSpan.FromMinutes(s.MinutesAfterMeridian) - TimeSpan.FromMinutes(s.PauseTimeBeforeMeridian);
        return min.TotalMinutes;
    }

    /// <summary>Trigger aller Vorfahren zur Flipzeit (M1): NINAs <em>Meridian Flip</em>-Trigger flippt, Dither unterdrückt.</summary>
    public Task RunTriggersAsync(CancellationToken token) =>
        TriggerWalker.RunAsync(Box, after: false, previousItem, Box, Progress ?? new Progress<ApplicationStatus>(), Runtime, token);

    /// <summary>
    /// Eigenes Plate-Solve (flip-rotation.md §3, NIN-4): Aufnahme und Lösung mit den Plate-Solve-Einstellungen des
    /// Profils wie NINAs <em>Center</em>, ohne Sync; <c>PositionAngle</c> und <c>Flipped</c> (NT-33). Scheitert es, ist
    /// der Winkel unbekannt.
    /// </summary>
    public async Task<SolveReading> SolveAsync(CancellationToken token)
    {
        var profile = m.Profile.ActiveProfile;
        var ps = profile.PlateSolveSettings;
        try
        {
            var solver = m.PlateSolverFactory.GetCaptureSolver(m.PlateSolverFactory.GetPlateSolver(ps),
                m.PlateSolverFactory.GetBlindSolver(ps), m.Imaging, m.FilterWheel);
            var parameter = new NINA.PlateSolving.CaptureSolverParameter
            {
                Attempts = ps.NumberOfAttempts,
                Binning = ps.Binning,
                Coordinates = m.Telescope.GetCurrentPosition(),
                DownSampleFactor = ps.DownSampleFactor,
                FocalLength = profile.TelescopeSettings.FocalLength,
                MaxObjects = ps.MaxObjects,
                PixelSize = profile.CameraSettings.PixelSize,
                ReattemptDelay = TimeSpan.FromMinutes(ps.ReattemptDelay),
                Regions = ps.Regions,
                SearchRadius = ps.SearchRadius,
                BlindFailoverEnabled = ps.BlindFailoverEnabled,
            };
            var seq = new NINA.Equipment.Model.CaptureSequence(ps.ExposureTime, NINA.Equipment.Model.CaptureSequence.ImageTypes.SNAPSHOT,
                ps.Filter, new NINA.Core.Model.Equipment.BinningMode(ps.Binning, ps.Binning), 1) { Gain = ps.Gain };
            var r = await solver.Solve(seq, parameter, new Progress<NINA.PlateSolving.PlateSolveProgress>(),
                Progress ?? new Progress<ApplicationStatus>(), token);
            return r is { Success: true } ? new SolveReading(r.PositionAngle, r.Flipped) : new SolveReading(null);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            Logger.Warning($"NINA-PM: Plate-Solve für die Winkelprüfung fehlgeschlagen: {ex.Message}");
            return new SolveReading(null);
        }
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

    /// <summary>
    /// Zuordnung <c>Image.Id → Aufnahme</c> vor <c>Enqueue</c> (§4.3); ein globaler Handler, gelöst erst, wenn nichts
    /// mehr aussteht. Nach 120 s ohne <c>ImageSaved</c> → <c>failed</c> und <c>warning image_not_saved</c>.
    /// </summary>
    internal void RegisterPending(int imageId, CaptureFacts facts)
    {
        captures.Register(imageId, facts, clock.UtcNow);
        if (Interlocked.Exchange(ref handlerAttached, 1) == 0) m.ImageSave.ImageSaved += OnImageSaved;
        _ = Task.Run(async () =>
        {
            await Task.Delay(CaptureRegistry.SaveTimeout + TimeSpan.FromSeconds(1));
            foreach (var f in captures.Expire(clock.UtcNow)) Rules.Failed(f);
            ReleaseIfDrained();
        });
    }

    /// <summary>
    /// <c>ImageSaved</c> mit bekannter ID → <c>saved</c>, Dateiname ohne Pfad; Messwerte aus dem Ereignis (NIN5-10):
    /// HFR und Sterne der Sterndetektion, Mittelwert der Statistik, Sensortemperatur und Sollwert – fehlende Werte
    /// werden weggelassen, nie als 0 gemeldet.
    /// </summary>
    private void OnImageSaved(object? sender, ImageSavedEventArgs e)
    {
        var imageId = e.MetaData?.Image?.Id;
        if (imageId is null || captures.Saved(imageId.Value) is not { } facts) return;
        var file = e.PathToImage is null ? "" : Path.GetFileName(e.PathToImage.LocalPath);
        var star = e.StarDetectionAnalysis;
        var metrics = new Metrics
        {
            Hfr = star is not null && double.IsFinite(star.HFR) && star.HFR > 0 ? star.HFR : null,
            Stars = star is not null && star.DetectedStars > 0 ? star.DetectedStars : null,
            MeanAdu = e.Statistics is { } st && double.IsFinite(st.Mean) ? st.Mean : null,
            SensorTempC = e.MetaData?.Camera is { } cam && double.IsFinite(cam.Temperature) ? cam.Temperature : null,
            SetPointC = e.MetaData?.Camera is { } cam2 && double.IsFinite(cam2.SetPoint) ? cam2.SetPoint : null,
        };
        Rules.Saved(facts, metrics, file);
        ReleaseIfDrained();
    }

    private void ReleaseIfDrained()
    {
        if (captures.Pending == 0 && Interlocked.Exchange(ref handlerAttached, 0) == 1) m.ImageSave.ImageSaved -= OnImageSaved;
    }
}
