using Newtonsoft.Json;
using NINA.Astrometry;
using NINA.Core.Model;
using NINA.Core.Model.Equipment;
using NINA.Core.Utility;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Equipment.Model;
using NINA.Profile.Interfaces;
using NINA.Sequencer.Interfaces;
using NINA.Sequencer.SequenceItem;
using NINA.WPF.Base.Interfaces.Mediator;
using NINA.WPF.Base.Interfaces.ViewModel;

namespace NinaPm.Probe;

/// <summary>
/// Internes Belichtungselement (execution.md §4.3): nicht exportiert, nie Kind des Containers, aber über
/// <c>AttachNewParent(container)</c> an ihn gehängt, damit NINAs Flip-Trigger die Zielkoordinaten findet.
/// Implementiert <see cref="IExposureItem"/>, damit „AF nach n Belichtungen“ die Aufnahme zählt.
/// Bildpipeline und <c>GetEstimatedDuration</c> nach Astro-PM-Plugin (MIT), Instructions/AstroPMChildItems.cs
/// `AstroPMTakeExposureItem` (Z. 235–516), Commit 5dd621d; neu: Aufnahme-ID vor der Belichtung und Zuordnung
/// <c>Image.Id → Aufnahme-ID</c> vor <c>Enqueue</c>, exakte Filterauflösung (§4.4), Auslesemodus per Name (§4.3).
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
public sealed class ProbeExposureItem : SequenceItem, IExposureItem
{
    private readonly ProbeContainer container;
    private readonly IProfileService profileService;
    private readonly IFilterWheelMediator filterWheel;
    private readonly IImagingMediator imaging;
    private readonly IImageSaveMediator imageSave;
    private readonly IImageHistoryVM imageHistory;
    private readonly int number;
    private readonly int total;
    private FilterInfo? resolvedFilter;

    public ProbeExposureItem(ProbeContainer container, IProfileService profileService, IFilterWheelMediator filterWheel,
        IImagingMediator imaging, IImageSaveMediator imageSave, IImageHistoryVM imageHistory,
        string filterName, double exposureS, int number, int total)
    {
        this.container = container;
        this.profileService = profileService;
        this.filterWheel = filterWheel;
        this.imaging = imaging;
        this.imageSave = imageSave;
        this.imageHistory = imageHistory;
        FilterName = filterName;
        ExposureTime = exposureS;
        this.number = number;
        this.total = total;
        Name = $"NINA-PM Probe Belichtung {number}";
    }

    /// <summary>Aufnahme-ID (UUID v7), vergeben <b>vor</b> der Belichtung (§4.3).</summary>
    public string CaptureId { get; } = Uuid7.New();

    public string FilterName { get; }

    /// <summary>Filter im Profil nicht gefunden → diese Belichtung wird übersprungen (§4.4).</summary>
    public bool FilterMissing { get; private set; }

    // IExposureItem: Gain/Offset null → −1 = NINA-Standard (NT-38).
    public double ExposureTime { get; set; }
    public int Gain { get; set; } = -1;
    public int Offset { get; set; } = -1;
    public string ImageType { get => "LIGHT"; set { } }
    public BinningMode Binning { get; set; } = new(1, 1);

    /// <summary>Flip-Trigger rechnet mit der Dauer der nächsten Anweisung (Original-Kommentar Z. 299–306).</summary>
    public override TimeSpan GetEstimatedDuration() => TimeSpan.FromSeconds(ExposureTime);

    /// <summary>
    /// Filter vor den Triggern wechseln, damit „AF nach Filterwechsel“ den neuen Filter sieht. Auflösung nur exakt
    /// (ordinal, §4.4): kein Präfix, keine Normalisierung, nie durch einen anderen Filter belichten.
    /// </summary>
    public async Task SwitchFilterAsync(IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        var filters = profileService.ActiveProfile.FilterWheelSettings.FilterWheelFilters;
        if (filters is null || filters.Count == 0 || FilterName.Length == 0) return; // OSC: ohne Wechsel
        resolvedFilter = filters.FirstOrDefault(f => string.Equals(f.Name, FilterName, StringComparison.Ordinal));
        if (resolvedFilter is null)
        {
            FilterMissing = true;
            ProbeLog.Event("FILTER_NOT_FOUND", ("filter", FilterName), ("short", FilterName));
            return;
        }
        await filterWheel.ChangeFilter(resolvedFilter, token, progress);
    }

    public override async Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        if (FilterMissing) return;
        var target = container.Target;
        var sequence = new CaptureSequence(ExposureTime, "LIGHT", resolvedFilter, Binning, 1)
        {
            Gain = Gain,
            Offset = Offset,
            ProgressExposureCount = number,
            TotalExposureCount = total,
        };
        progress?.Report(new ApplicationStatus { Source = "NINA-PM Probe", Status = $"Belichtung {number}/{total}" });

        var exposure = await imaging.CaptureImage(sequence, token, progress, target.TargetName);
        if (exposure is null)
        {
            ProbeLog.Event("CAPTURE", ("id", CaptureId), ("result", "failed"), ("atUtc", ProbeLog.Iso(DateTime.UtcNow)));
            return;
        }

        var imageId = exposure.MetaData.Image.Id;
        // Bildhistorie: sonst zählen „AF nach n Belichtungen“ und „AF nach HFR-Anstieg“ nicht (NIN-19).
        imageHistory.Add(imageId, "LIGHT");
        // Zuordnung vor Enqueue (§4.3): ImageSaved kann sofort nach dem Einreihen kommen.
        container.RegisterPending(imageId, CaptureId);

        var imageData = await exposure.ToImageData(progress, token);
        var prepare = imaging.PrepareImage(imageData, new PrepareImageParameters(true, true), token);
        imageHistory.PopulateStatistics(imageId, await imageData.Statistics);
        imageData.MetaData.Target.Name = target.TargetName;
        imageData.MetaData.Target.Coordinates = target.InputCoordinates.Coordinates;
        imageData.MetaData.Target.PositionAngle = target.PositionAngle;
        await imageSave.Enqueue(imageData, prepare, progress, token);
        container.StartSaveTimeout(imageId);
        Logger.Info($"NINA-PM Probe: Belichtung {number}/{total} eingereiht, Image.Id={imageId}, Aufnahme {CaptureId}");
    }

    public override object Clone() => throw new NotSupportedException("internes Element, wird nicht geklont");

    public override string ToString() => $"NINA-PM Probe Belichtung {number}/{total} {FilterName} {ExposureTime}s";
}
