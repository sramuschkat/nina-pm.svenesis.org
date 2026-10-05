using Newtonsoft.Json;
using NINA.Astrometry;
using NINA.Core.Model;
using NINA.Core.Utility;
using NINA.Core.Model.Equipment;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Equipment.Model;
using NINA.Sequencer.Interfaces;
using NINA.Profile.Interfaces;
using NINA.Sequencer.SequenceItem;
using NINA.WPF.Base.Interfaces.ViewModel;
using NINA.WPF.Base.Interfaces.Mediator;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Reporting;
using NinaPm.Nina.Adapters;

namespace NinaPm.Nina.Sequencer;

/// <summary>
/// Internes Belichtungselement (execution.md §4.3): nicht exportiert, nie Kind des Containers, aber über
/// <c>AttachNewParent(container)</c> angehängt, damit NINAs Flip-Trigger die Zielkoordinaten findet; implementiert
/// <see cref="IExposureItem"/>, damit „AF nach n Belichtungen“ zählt. Bildpipeline und <c>GetEstimatedDuration</c> nach
/// dem Astro-PM-Plugin (MIT), <c>Instructions/AstroPMChildItems.cs</c> <c>AstroPMTakeExposureItem</c>, Commit 5dd621d;
/// Aufnahme-ID vor der Belichtung und Zuordnung <c>Image.Id → Aufnahme</c> vor <c>Enqueue</c> wie im Probe-Plugin.
/// </summary>
[JsonObject(MemberSerialization.OptIn)]
internal sealed class TakeExposureItem : SequenceItem, IExposureItem
{
    private readonly NinaHost host;
    private readonly NinaMediators m;
    private readonly Blocks block;
    private readonly Entries entry;
    private readonly FilterInfo? filter;
    private readonly bool temperatureDeviation;

    public TakeExposureItem(NinaHost host, NinaMediators m, Blocks block, Entries entry, FilterInfo? filter, Guid captureId,
        bool temperatureDeviation)
    {
        this.host = host;
        this.m = m;
        this.block = block;
        this.entry = entry;
        this.filter = filter;
        this.temperatureDeviation = temperatureDeviation;
        CaptureId = captureId;
        ExposureTime = entry.ExposureS ?? 0;
        // Gain/Offset null → −1 = NINA-Standard (NT-38).
        Gain = entry.Gain ?? -1;
        Offset = entry.Offset ?? -1;
        Binning = new BinningMode((short)(entry.Binning ?? 1), (short)(entry.Binning ?? 1));
        Name = "NINA-PM Exposure";
    }

    /// <summary>Aufnahme-ID (UUID v7), vergeben <b>vor</b> der Belichtung (§4.3).</summary>
    public Guid CaptureId { get; }

    /// <summary>NINA hat das Bild aufgenommen und zum Speichern eingereiht.</summary>
    public bool Captured { get; private set; }

    /// <summary>
    /// Fakten der Aufnahme für die Meldung (AP-16e): vor der Belichtung mit vorläufigen Zeiten (für <c>aborted</c>),
    /// nach <c>CaptureImage</c> mit <c>ExposureStart</c>/<c>ExposureMidPoint</c> aus NINAs Metadaten (NT-10).
    /// </summary>
    public CaptureFacts? Facts { get; private set; }

    public double ExposureTime { get; set; }
    public int Gain { get; set; }
    public int Offset { get; set; }
    public string ImageType { get => "LIGHT"; set { } }
    public BinningMode Binning { get; set; }

    /// <summary>Flip-Trigger rechnet mit der Dauer der nächsten Anweisung.</summary>
    public override TimeSpan GetEstimatedDuration() => TimeSpan.FromSeconds(ExposureTime);

    public override async Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token)
    {
        var target = host.Container!.Target;
        var frame = host.Frames.Peek(target.TargetName, filter?.Name);
        // Bildnummer für $$FRAMENR$$ wie NINAs TakeExposure (ProgressExposureCount), sonst immer 0000.
        var sequence = new CaptureSequence(ExposureTime, "LIGHT", filter, Binning, 1)
        {
            Gain = Gain, Offset = Offset, ProgressExposureCount = frame, TotalExposureCount = frame + 1,
        };
        progress?.Report(new ApplicationStatus { Source = "NINA-PM", Status = $"{target.TargetName} {entry.Filter} {ExposureTime} s" });

        Facts = host.CaptureFactsFor(CaptureId, block, entry, filter, temperatureDeviation, ExposureTime);
        var exposure = await m.Imaging.CaptureImage(sequence, token, progress, target.TargetName);
        if (exposure is null) return;
        host.Frames.Advance(target.TargetName, filter?.Name);
        var imageId = exposure.MetaData.Image.Id;
        // Bildhistorie: sonst zählen „AF nach n Belichtungen“ und „AF nach HFR-Anstieg“ nicht (NIN-19).
        m.ImageHistory.Add(imageId, "LIGHT");
        if (Facts is not null)
        {
            var start = exposure.MetaData.Image.ExposureStart is var s && s != default ? Utc(s) : Facts.CapturedAtUtc;
            Facts = Facts with
            {
                CapturedAtUtc = start,
                ExposureMidUtc = exposure.MetaData.Image.ExposureMidPoint is var mid && mid != default ? Utc(mid) : start.AddSeconds(ExposureTime / 2),
            };
            host.RegisterPending(imageId, Facts);
        }

        var imageData = await exposure.ToImageData(progress, token);
        var prepare = m.Imaging.PrepareImage(imageData, new PrepareImageParameters(true, true), token);
        m.ImageHistory.PopulateStatistics(imageId, await imageData.Statistics);
        imageData.MetaData.Target.Name = target.TargetName;
        imageData.MetaData.Target.Coordinates = target.InputCoordinates.Coordinates;
        imageData.MetaData.Target.PositionAngle = target.PositionAngle;
        await m.ImageSave.Enqueue(imageData, prepare, progress, token);
        Captured = true;
    }

    /// <summary>NINA setzt die Belichtungszeiten in UTC (execution.md §4.3).</summary>
    private static DateTimeOffset Utc(DateTime t) => new(DateTime.SpecifyKind(t, DateTimeKind.Utc));

    public override object Clone() => throw new NotSupportedException("internal item, not cloned");

    public override string ToString() => $"NINA-PM Exposure {entry.Filter} {ExposureTime} s";
}
