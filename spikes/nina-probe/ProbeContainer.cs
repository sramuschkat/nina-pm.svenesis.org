using System.Collections.Concurrent;
using System.ComponentModel.Composition;
using System.IO;
using System.Runtime.Serialization;
using Newtonsoft.Json;
using NINA.Astrometry;
using NINA.Astrometry.Interfaces;
using NINA.Core.Enum;
using NINA.Core.Model;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Profile.Interfaces;
using NINA.Sequencer.Conditions;
using NINA.Sequencer.Container;
using NINA.Sequencer.Container.ExecutionStrategy;
using NINA.Sequencer.SequenceItem;
using NINA.Sequencer.Trigger.Platesolving;
using NINA.WPF.Base.Interfaces.Mediator;
using NINA.WPF.Base.Interfaces.ViewModel;

namespace NinaPm.Probe;

/// <summary>
/// Probe-Container für AP-S2b (P-01…P-03, P-13): ein <see cref="SequenceContainer"/> mit
/// <see cref="IDeepSkyObjectContainer"/> und überschriebenem <c>Execute</c>, der eine Serie interner Belichtungen
/// ausführt und dazwischen die Trigger aller Vorfahren selbst aufruft (execution.md §2, §4.3, §4.5, §4.6, §5).
/// Container-Grundmuster (kein <c>base.Execute</c>, Platzhalter, Serialisierung, <c>Target</c>) nach dem
/// Astro-PM-Plugin (MIT), Instructions/TargetInstructionSet.cs, Commit 5dd621d; der Trigger-Walk ist dagegen neu:
/// eigene Iteration über <c>GetTriggersSnapshot</c> statt <c>RunTriggers</c>, Kontext = dieser Container (NIN5-3),
/// Dither immer und Autofokus wahlweise unterdrückt (NT-23).
/// </summary>
[ExportMetadata("Name", "NINA-PM Probe")]
[ExportMetadata("Description", "AP-S2b: Trigger-Walk, Bildzuordnung, Belichtungsabbruch, Auslesemodus, Flip-Erkennung")]
[ExportMetadata("Icon", "SequentialSVG")]
[ExportMetadata("Category", "NINA-PM Probe")]
[Export(typeof(ISequenceItem))]
[Export(typeof(ISequenceContainer))]
[JsonObject(MemberSerialization.OptIn)]
public sealed class ProbeContainer : SequenceContainer, IDeepSkyObjectContainer
{
    private static readonly TimeSpan SaveTimeout = TimeSpan.FromSeconds(120);

    private readonly IProfileService profileService;
    private readonly ITelescopeMediator telescope;
    private readonly IFilterWheelMediator filterWheel;
    private readonly IImagingMediator imaging;
    private readonly ICameraMediator camera;
    private readonly IImageSaveMediator imageSave;
    private readonly IImageHistoryVM imageHistory;
    private readonly ISafetyMonitorMediator safetyMonitor;
    private readonly INighttimeCalculator nighttimeCalculator;

    /// <summary><c>Image.Id → Aufnahme-ID</c> bis <c>ImageSaved</c> oder Zeitüberschreitung (§4.3).</summary>
    private readonly ConcurrentDictionary<int, string> pending = new();
    /// <summary>
    /// <c>ImageSaved</c>-Handler bleibt über das Blockende hinaus angehängt, bis alle offenen Aufnahmen gespeichert
    /// oder abgelaufen sind: NINA speichert im Hintergrund, die letzten Bilder kommen erst nach <c>BLOCK_END</c>
    /// (P-02 in der VM, 01.10.2026: Bild 19 und 20 0,3 s bzw. 2 s nach Blockende, vorher ohne <c>CAPTURE</c>-Zeile).
    /// </summary>
    private int handlerAttached;
    private volatile bool blockRunning;
    private readonly HashSet<string> suppressedLogged = new(StringComparer.Ordinal);
    private short? readoutIndexLogged;

    [ImportingConstructor]
    public ProbeContainer(IProfileService profileService, ITelescopeMediator telescope, IFilterWheelMediator filterWheel,
        IImagingMediator imaging, ICameraMediator camera, IImageSaveMediator imageSave, IImageHistoryVM imageHistory,
        ISafetyMonitorMediator safetyMonitor, INighttimeCalculator nighttimeCalculator) : base(new SequentialStrategy())
    {
        this.profileService = profileService;
        this.telescope = telescope;
        this.filterWheel = filterWheel;
        this.imaging = imaging;
        this.camera = camera;
        this.imageSave = imageSave;
        this.imageHistory = imageHistory;
        this.safetyMonitor = safetyMonitor;
        this.nighttimeCalculator = nighttimeCalculator;
        NighttimeData = nighttimeCalculator.Calculate(null);
        var astro = profileService.ActiveProfile.AstrometrySettings;
        target = new InputTarget(Angle.ByDegree(astro.Latitude), Angle.ByDegree(astro.Longitude), astro.Horizon);
        Add(new ProbePlaceholderItem());
    }

    private ProbeContainer(ProbeContainer cloneMe) : this(cloneMe.profileService, cloneMe.telescope, cloneMe.filterWheel,
        cloneMe.imaging, cloneMe.camera, cloneMe.imageSave, cloneMe.imageHistory, cloneMe.safetyMonitor,
        cloneMe.nighttimeCalculator)
    {
        CopyMetaData(cloneMe);
        ExposureCount = cloneMe.ExposureCount;
        ExposureSeconds = cloneMe.ExposureSeconds;
        Filters = cloneMe.Filters;
        MeridianInMinutes = cloneMe.MeridianInMinutes;
        DeclinationDeg = cloneMe.DeclinationDeg;
        PositionAngleDeg = cloneMe.PositionAngleDeg;
        AbortExposureNumber = cloneMe.AbortExposureNumber;
        AbortAfterSeconds = cloneMe.AbortAfterSeconds;
        ReadoutModeName = cloneMe.ReadoutModeName;
        SuppressAutofocus = cloneMe.SuppressAutofocus;
        IgnorePierSide = cloneMe.IgnorePierSide;
        SlewToTarget = cloneMe.SlewToTarget;
    }

    public override object Clone() => new ProbeContainer(this);

    // ── Parameter (im Sequenz-Editor, mit der Sequenz gespeichert; Werte je Protokoll: README) ──

    private int exposureCount = 20;
    [JsonProperty] public int ExposureCount { get => exposureCount; set { exposureCount = value; RaisePropertyChanged(); } }

    private double exposureSeconds = 60;
    [JsonProperty] public double ExposureSeconds { get => exposureSeconds; set { exposureSeconds = value; RaisePropertyChanged(); } }

    private string filters = "L,R";
    /// <summary>Filter im Wechsel, Komma-getrennt, exakt wie im NINA-Profil; leer = ohne Filterwechsel.</summary>
    [JsonProperty] public string Filters { get => filters; set { filters = value ?? ""; RaisePropertyChanged(); } }

    private double meridianInMinutes = 10;
    /// <summary>Ziel-RA = lokale Sternzeit der Montierung + n Minuten → Meridian in n Minuten (P-01, P-13).</summary>
    [JsonProperty] public double MeridianInMinutes { get => meridianInMinutes; set { meridianInMinutes = value; RaisePropertyChanged(); } }

    private double declinationDeg = 20;
    [JsonProperty] public double DeclinationDeg { get => declinationDeg; set { declinationDeg = value; RaisePropertyChanged(); } }

    private double positionAngleDeg = 30;
    /// <summary>Positionswinkel für die Ziel-Metadaten (FITS-Header, P-02).</summary>
    [JsonProperty] public double PositionAngleDeg { get => positionAngleDeg; set { positionAngleDeg = value; RaisePropertyChanged(); } }

    private int abortExposureNumber;
    /// <summary>Diese Belichtung (1…n) über den eigenen Abbruch-Token beenden; 0 = keine (P-03, P-13).</summary>
    [JsonProperty] public int AbortExposureNumber { get => abortExposureNumber; set { abortExposureNumber = value; RaisePropertyChanged(); } }

    private double abortAfterSeconds = 20;
    [JsonProperty] public double AbortAfterSeconds { get => abortAfterSeconds; set { abortAfterSeconds = value; RaisePropertyChanged(); } }

    private string readoutModeName = "";
    /// <summary>Auslesemodus per Name (exakt, ohne Groß-/Kleinschreibung, §4.3); leer = nicht setzen.</summary>
    [JsonProperty] public string ReadoutModeName { get => readoutModeName; set { readoutModeName = value ?? ""; RaisePropertyChanged(); } }

    private bool suppressAutofocus;
    /// <summary>Trigger mit „autofocus“ im Typnamen unterdrücken (wie im Transit, §5; P-13 Nr. 1).</summary>
    [JsonProperty] public bool SuppressAutofocus { get => suppressAutofocus; set { suppressAutofocus = value; RaisePropertyChanged(); } }

    private bool ignorePierSide;
    /// <summary>Pier-Seite als unbekannt behandeln (P-13, Lauf „Pier-Seite null“, NIN5-1).</summary>
    [JsonProperty] public bool IgnorePierSide { get => ignorePierSide; set { ignorePierSide = value; RaisePropertyChanged(); } }

    private bool slewToTarget = true;
    [JsonProperty] public bool SlewToTarget { get => slewToTarget; set { slewToTarget = value; RaisePropertyChanged(); } }

    // ── IDeepSkyObjectContainer ──

    private InputTarget target;
    public InputTarget Target { get => target; set { target = value; RaisePropertyChanged(); } }

    public NighttimeData NighttimeData { get; }

    // ── Serialisierung: Platzhalter nie speichern (Original Z. 339–379) ──

    [OnSerializing]
    public void OnSerializingProbe(StreamingContext context) => ScrubPlaceholders();

    [OnSerialized]
    public void OnSerializedProbe(StreamingContext context) => EnsurePlaceholder();

    [OnDeserialized]
    public void OnDeserializedProbe(StreamingContext context)
    {
        ScrubPlaceholders();
        EnsurePlaceholder();
    }

    private void ScrubPlaceholders()
    {
        foreach (var item in GetItemsSnapshot())
            if (item is ProbePlaceholderItem || item is UnknownSequenceItem) Items.Remove(item);
    }

    private void EnsurePlaceholder()
    {
        if (Items.Count == 0) Add(new ProbePlaceholderItem());
    }

    // ── Ablauf ──

    public override async Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        // Bewusst kein base.Execute: die Strategie liefe über den Platzhalter (Original Z. 762–766).
        var blockId = Uuid7.New();
        suppressedLogged.Clear();
        readoutIndexLogged = null;
        ProbeLog.Note($"Start: {ExposureCount} × {ExposureSeconds} s, Filter „{Filters}“, Meridian in {MeridianInMinutes} min, " +
                      $"Dec {DeclinationDeg}°, PA {PositionAngleDeg}°, Abbruch Nr. {AbortExposureNumber} nach {AbortAfterSeconds} s, " +
                      $"Auslesemodus „{ReadoutModeName}“, AF unterdrücken {SuppressAutofocus}, Pier-Seite ignorieren {IgnorePierSide}");
        SetTarget();
        if (SlewToTarget)
            await telescope.SlewToCoordinatesAsync(Target.InputCoordinates.Coordinates, token);

        ProbeLog.Event("BLOCK_START", ("id", blockId), ("atUtc", ProbeLog.Iso(DateTime.UtcNow)));
        blockRunning = true;
        if (Interlocked.Exchange(ref handlerAttached, 1) == 0) imageSave.ImageSaved += OnImageSaved;
        var filterList = Filters.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        ISequenceItem? previous = null;
        try
        {
            for (var n = 1; n <= ExposureCount; n++)
            {
                token.ThrowIfCancellationRequested();
                var filterName = filterList.Length == 0 ? "" : filterList[(n - 1) % filterList.Length];
                var item = new ProbeExposureItem(this, profileService, filterWheel, imaging, imageSave, imageHistory,
                    filterName, ExposureSeconds, n, ExposureCount);
                // Flip-Trigger holt die Zielkoordinaten über nextItem.Parent (Original-Kommentar Z. 1409–1416).
                item.AttachNewParent(this);

                // Reihenfolge §4.3: Filter → (Dither laut Plan, hier keiner) → Pier-Seite merken → Trigger → Pier-Seite
                // vergleichen → Belichtung → Nach-Trigger → Pier-Seite erneut vergleichen.
                await item.SwitchFilterAsync(progress, token);
                if (item.FilterMissing) continue;
                if (!ApplyReadoutMode()) continue;

                var pierBefore = PierSide();
                var ran = await RunAncestorTriggers(after: false, previous, item, progress, token);
                CheckFlip(pierBefore, ran);

                await ExposeAsync(item, n, progress, token);

                pierBefore = PierSide();
                ran = await RunAncestorTriggers(after: true, item, item, progress, token);
                CheckFlip(pierBefore, ran);
                previous = item;
            }
            ProbeLog.Event("BLOCK_END", ("id", blockId), ("reason", "completed"));
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            // §4.6: Unterbrechung (Loop While Safe am Vorfahren und nicht sicher) oder Benutzerabbruch.
            if (IsSafetyInterruption())
            {
                ProbeLog.Event("BLOCK_END", ("id", blockId), ("reason", "interrupted"));
                ProbeLog.Event("SAFETY_PAUSE", ("atUtc", ProbeLog.Iso(DateTime.UtcNow)));
            }
            else
            {
                ProbeLog.Event("BLOCK_END", ("id", blockId), ("reason", "user_skip"));
            }
            throw;
        }
        finally
        {
            blockRunning = false;
            ReleaseHandlerIfDrained();
        }
    }

    /// <summary>Handler erst lösen, wenn der Block vorbei ist und keine Aufnahme mehr auf <c>ImageSaved</c> wartet.</summary>
    private void ReleaseHandlerIfDrained()
    {
        if (!blockRunning && pending.IsEmpty && Interlocked.Exchange(ref handlerAttached, 0) == 1)
            imageSave.ImageSaved -= OnImageSaved;
    }

    /// <summary>Belichtung mit eigenem Abbruch-Token (§2, §5): bricht nur diese Belichtung ab, nicht die Sequenz.</summary>
    private async Task ExposeAsync(ProbeExposureItem item, int n, IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        using var own = CancellationTokenSource.CreateLinkedTokenSource(token);
        var exposure = item.Execute(progress, own.Token);
        if (n == AbortExposureNumber)
            _ = AbortLaterAsync(exposure, own, token);
        try
        {
            await exposure;
        }
        catch (OperationCanceledException)
        {
            ProbeLog.Event("CAPTURE", ("id", item.CaptureId), ("result", "aborted"), ("atUtc", ProbeLog.Iso(DateTime.UtcNow)));
            if (token.IsCancellationRequested) throw;
        }
    }

    private async Task AbortLaterAsync(Task exposure, CancellationTokenSource own, CancellationToken token)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(AbortAfterSeconds), token);
            if (exposure.IsCompleted) return;
            ProbeLog.Event("WARNING", ("code", "probe_abort"), ("atUtc", ProbeLog.Iso(DateTime.UtcNow)));
            own.Cancel();
            // Rückfall nur, wenn der Task nach 5 s nicht endet (§5).
            if (await Task.WhenAny(exposure, Task.Delay(TimeSpan.FromSeconds(5), CancellationToken.None)) != exposure)
            {
                ProbeLog.Event("WARNING", ("code", "probe_abort_fallback"), ("atUtc", ProbeLog.Iso(DateTime.UtcNow)));
                camera.AbortExposure();
            }
        }
        catch (OperationCanceledException)
        {
            // Sequenz selbst beendet.
        }
    }

    /// <summary>
    /// Trigger aller Vorfahren über die eigene Iteration (§4.3, §5, NIN5-3): Kontext ist dieser Container, vorheriges
    /// Element sonst der Container selbst. Dither immer unterdrückt, Autofokus wahlweise; Triggerfehler protokollieren,
    /// nicht abbrechen. NINA 3.2: <c>ShouldTrigger</c>/<c>ShouldTriggerAfter</c> sind synchron, ausgeführt wird über
    /// <c>ISequenceTrigger.Run</c> (setzt den Status und ruft <c>Execute</c>).
    /// </summary>
    private async Task<List<string>> RunAncestorTriggers(bool after, ISequenceItem? previous, ISequenceItem next,
        IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        var ran = new List<string>();
        for (var c = Parent; c is not null; c = c.Parent)
        {
            if (c is not SequenceContainer container) continue;
            foreach (var trigger in container.GetTriggersSnapshot())
            {
                // Deaktivierte Trigger überspringt NINA selbst; der eigene Walk muss das auch (P-01 01.10.2026:
                // deaktiviertes Center After Drift wurde geprüft und aufgerufen, Run kehrte sofort zurück).
                if (trigger.Status == SequenceEntityStatus.DISABLED) continue;
                var type = trigger.GetType().Name;
                if (type.Contains("dither", StringComparison.OrdinalIgnoreCase)
                    || (SuppressAutofocus && type.Contains("autofocus", StringComparison.OrdinalIgnoreCase)))
                {
                    if (suppressedLogged.Add(type)) ProbeLog.Event("TRIGGER_SUPPRESSED", ("type", type));
                    continue;
                }
                bool should;
                try
                {
                    should = after ? trigger.ShouldTriggerAfter(previous ?? this, this) : trigger.ShouldTrigger(previous ?? this, next);
                }
                catch (Exception ex)
                {
                    ProbeLog.Note($"ShouldTrigger {type}: {ex.GetType().Name}: {ex.Message}");
                    continue;
                }
                if (!should) continue;
                var started = DateTime.UtcNow;
                ProbeLog.Event("TRIGGER", ("type", type), ("atUtc", ProbeLog.Iso(started)));
                try
                {
                    await trigger.Run(this, progress, token);
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    ProbeLog.Event("WARNING", ("code", "trigger_failed"), ("type", type));
                    ProbeLog.Note($"Trigger {type}: {ex.GetType().Name}: {ex.Message}");
                }
                ProbeLog.Note($"Trigger {type} fertig nach {ProbeLog.Seconds((DateTime.UtcNow - started).TotalSeconds)} s");
                ran.Add($"{type}|{ProbeLog.Seconds((DateTime.UtcNow - started).TotalSeconds)}");
            }
        }
        return ran;
    }

    /// <summary>
    /// Flip-Erkennung über die Pier-Seite (§4.5): vor und nach dem Trigger-Aufruf gelesen; Zuordnung
    /// <c>pierWest → west</c>, <c>pierEast → east</c>, <c>pierUnknown → null</c>. Pier-Seite unbekannt und NINAs
    /// Flip-Trigger lief: ohne eigenes Plate-Solve (Probe) nur <c>FLIP_UNDETECTED</c> (NIN5-1).
    /// </summary>
    private void CheckFlip(string? before, List<string> ran)
    {
        var after = PierSide();
        var flipRun = ran.FirstOrDefault(r => r.StartsWith("MeridianFlipTrigger|", StringComparison.Ordinal));
        if (before is not null && after is not null && before != after)
            ProbeLog.Event("FLIP", ("pierBefore", before), ("pierAfter", after),
                ("durationS", flipRun?.Split('|')[1] ?? "0"));
        else if ((before is null || after is null) && flipRun is not null)
            ProbeLog.Event("FLIP_UNDETECTED", ("atUtc", ProbeLog.Iso(DateTime.UtcNow)));
    }

    private string? PierSide()
    {
        if (IgnorePierSide) return null;
        return telescope.GetInfo().SideOfPier switch
        {
            NINA.Core.Enum.PierSide.pierWest => "west",
            NINA.Core.Enum.PierSide.pierEast => "east",
            _ => null,
        };
    }

    /// <summary>Auslesemodus per Name → Index (§4.3, NT-37); genau ein Modus → diesen; sonst Belichtung überspringen.</summary>
    private bool ApplyReadoutMode()
    {
        if (ReadoutModeName.Length == 0) return true;
        var modes = camera.GetInfo().ReadoutModes?.ToList() ?? new List<string>();
        var index = modes.FindIndex(m => string.Equals(m, ReadoutModeName, StringComparison.OrdinalIgnoreCase));
        if (index < 0 && modes.Count == 1) index = 0;
        if (index < 0)
        {
            ProbeLog.Event("READOUT_MODE_NOT_FOUND", ("name", ReadoutModeName));
            ProbeLog.Note($"Kamera meldet: {string.Join(", ", modes)}");
            return false;
        }
        camera.SetReadoutModeForNormalImages((short)index);
        if (readoutIndexLogged != index)
        {
            ProbeLog.Event("READOUT", ("mode", "set"), ("name", modes[index]), ("index", index));
            readoutIndexLogged = (short)index;
        }
        return true;
    }

    private bool IsSafetyInterruption()
    {
        var hasSafetyCondition = false;
        for (var c = Parent; c is not null; c = c.Parent)
            if (c is SequenceContainer container && container.GetConditionsSnapshot().Any(x => x is SafetyMonitorCondition))
                hasSafetyCondition = true;
        var info = safetyMonitor.GetInfo();
        return hasSafetyCondition && !(info.Connected && info.IsSafe);
    }

    /// <summary>
    /// Ziel mit Meridian in n Minuten: RA = lokale Sternzeit der Montierung + n/60 h (ohne Präzessionskorrektur,
    /// für den Simulator genau genug). Aufbau von InputTarget und Weitergabe an Center-after-Drift nach
    /// Astro-PM-Plugin (MIT), TargetInstructionSet.cs `SetTargetFromBlock` (Z. 1514–1575), Commit 5dd621d.
    /// </summary>
    private void SetTarget()
    {
        var lst = telescope.GetInfo().SiderealTime;
        var raHours = ((lst + MeridianInMinutes / 60.0) % 24 + 24) % 24;
        var coords = new InputCoordinates(new Coordinates(Angle.ByHours(raHours), Angle.ByDegree(DeclinationDeg), Epoch.J2000));
        var astro = profileService.ActiveProfile.AstrometrySettings;
        var t = new InputTarget(Angle.ByDegree(astro.Latitude), Angle.ByDegree(astro.Longitude), astro.Horizon)
        {
            TargetName = "NINA-PM Probe",
            InputCoordinates = coords,
            PositionAngle = PositionAngleDeg,
        };
        if (t.DeepSkyObject is not null)
        {
            t.DeepSkyObject.Name = t.TargetName;
            t.DeepSkyObject.Coordinates = coords.Coordinates;
        }
        Target = t;
        for (var c = Parent; c is not null; c = c.Parent)
        {
            if (c is not SequenceContainer container) continue;
            foreach (var trigger in container.GetTriggersSnapshot())
                if (trigger is CenterAfterDriftTrigger drift)
                {
                    drift.AttachNewParent(this);
                    drift.Coordinates = coords.Clone();
                    drift.Inherited = true;
                    drift.SequenceBlockInitialize();
                }
        }
        ProbeLog.Note($"Ziel RA {raHours:F4} h (LST {lst:F4} h + {MeridianInMinutes} min), Dec {DeclinationDeg}°, PA {PositionAngleDeg}°");
    }

    // ── Zuordnung ImageSaved → Aufnahme-ID (§4.3) ──

    internal void RegisterPending(int imageId, string captureId) => pending[imageId] = captureId;

    internal void StartSaveTimeout(int imageId) => _ = Task.Run(async () =>
    {
        await Task.Delay(SaveTimeout);
        if (pending.TryRemove(imageId, out var captureId))
        {
            ProbeLog.Event("CAPTURE", ("id", captureId), ("result", "failed"), ("atUtc", ProbeLog.Iso(DateTime.UtcNow)));
            ProbeLog.Event("WARNING", ("code", "image_not_saved"), ("id", captureId));
            ReleaseHandlerIfDrained();
        }
    });

    private void OnImageSaved(object? sender, ImageSavedEventArgs e)
    {
        var imageId = e.MetaData?.Image?.Id;
        if (imageId is null || !pending.TryRemove(imageId.Value, out var captureId)) return;
        var file = e.PathToImage is null ? "" : Path.GetFileName(e.PathToImage.LocalPath);
        ProbeLog.Event("CAPTURE", ("id", captureId), ("result", "saved"), ("file", file), ("atUtc", ProbeLog.Iso(DateTime.UtcNow)));
        ReleaseHandlerIfDrained();
    }

    public override string ToString() => $"NINA-PM Probe ({ExposureCount} × {ExposureSeconds} s)";
}
