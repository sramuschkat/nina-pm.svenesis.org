using System.Collections.Concurrent;
using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Reporting;

/// <summary>
/// Was das Plugin über eine Belichtung weiß, bevor NINA sie speichert (execution.md §4.3, TK 7.6): ID vor der Belichtung,
/// Plan, nach dem belichtet wurde, und die tatsächlich an NINA übergebenen Werte. Zeitpunkte aus NINAs Metadaten
/// (<c>ExposureStart</c>, <c>ExposureMidPoint</c>; NT-10).
/// </summary>
public sealed record CaptureFacts(
    Guid CaptureId,
    string Night,
    Guid NightPlanId,
    Blocks Block,
    Entries Entry,
    DateTimeOffset CapturedAtUtc,
    DateTimeOffset ExposureMidUtc,
    string FilterActual,
    double ExposureS,
    int? Gain,
    int? Offset,
    int Binning,
    string? ReadoutMode,
    int? ReadoutModeIndex,
    double RotatorMechDeg,
    CapturesPierSide? PierSide,
    bool TemperatureDeviation,
    Metrics? Metrics,
    double? RotationDeg = null);

/// <summary>Meldung einer Light-Aufnahme (<c>captures</c>, contracts/nina/README.md) aus den Fakten der Belichtung.</summary>
public static class CaptureMapper
{
    /// <summary>
    /// <c>capturedAtUtc</c> = Belichtungsbeginn, <c>exposureMidUtc</c> = Mitte (Pflicht, NT-10); <c>fileName</c> nur bei
    /// <c>saved</c>; <c>raDeg/decDeg</c> = Soll des Panels (NT-36); <c>rotationDeg</c> = gemessen, sonst Soll des Blocks.
    /// </summary>
    public static Captures Build(CaptureFacts f, CapturesResult result, string? fileName) => new()
    {
        Id = f.CaptureId,
        CapturedAtUtc = f.CapturedAtUtc,
        ExposureMidUtc = f.ExposureMidUtc,
        Night = f.Night,
        NightPlanId = f.NightPlanId,
        FilterShortName = f.Entry.Filter ?? f.FilterActual,
        FilterActual = f.FilterActual,
        ExposureS = f.ExposureS,
        Gain = f.Gain,
        Offset = f.Offset,
        Binning = f.Binning,
        ReadoutMode = f.ReadoutMode,
        ReadoutModeIndex = f.ReadoutModeIndex,
        RotatorMechDeg = f.RotatorMechDeg,
        TemperatureDeviation = f.TemperatureDeviation,
        Result = result,
        FileName = result == CapturesResult.Saved ? fileName : null,
        Metrics = f.Metrics,
        FrameType = CapturesFrameType.Light,
        BlockId = f.Block.Id,
        ProjectId = f.Block.ProjectId,
        PanelId = f.Block.PanelId,
        ExposureLineId = f.Entry.ExposureLineId,
        TransitObservationId = f.Block.TransitObservationId,
        RaDeg = f.Block.RaDeg,
        DecDeg = f.Block.DecDeg,
        RotationDeg = f.RotationDeg ?? f.Block.RotationDeg,
        PierSide = f.PierSide,
        // Pflichtfeld; Einträge der Transitserie tragen keins (der Server ordnet Transitaufnahmen selbst zu).
        Bonus = f.Entry.Bonus ?? false,
    };

    /// <summary>Feste ASCOM-Zuordnung (NT-34): <c>pierWest → west</c>, <c>pierEast → east</c>, sonst <c>null</c>.</summary>
    public static CapturesPierSide? PierSide(string? ascomPointingState) => ascomPointingState switch
    {
        "pierWest" => CapturesPierSide.West,
        "pierEast" => CapturesPierSide.East,
        _ => null,
    };
}

/// <summary>
/// Zuordnung <c>Image.Id</c> (NINA) → Aufnahme (execution.md §4.3): registriert **vor** <c>Enqueue</c>; <c>ImageSaved</c>
/// mit bekannter ID → <c>saved</c>; nach 120 s ohne <c>ImageSaved</c> → <c>failed</c>. Jede ID wird genau einmal
/// abgeschlossen, auch bei schnellen Folgen und gleichzeitigem Speichern/Ablauf.
/// </summary>
public sealed class CaptureRegistry
{
    public static readonly TimeSpan SaveTimeout = TimeSpan.FromSeconds(120);

    private readonly ConcurrentDictionary<int, (CaptureFacts Facts, DateTimeOffset RegisteredUtc)> pending = new();

    public int Pending => pending.Count;

    public void Register(int imageId, CaptureFacts facts, DateTimeOffset now) => pending[imageId] = (facts, now);

    /// <summary><c>ImageSaved</c>: Fakten der Aufnahme, wenn die ID noch aussteht; sonst <c>null</c> (fremdes oder schon abgelaufenes Bild).</summary>
    public CaptureFacts? Saved(int imageId) => pending.TryRemove(imageId, out var p) ? p.Facts : null;

    /// <summary>Abgelaufene Einträge (≥ 120 s seit der Registrierung) entfernen und zurückgeben.</summary>
    public IReadOnlyList<CaptureFacts> Expire(DateTimeOffset now)
    {
        var expired = new List<CaptureFacts>();
        foreach (var (id, p) in pending)
            if (now - p.RegisteredUtc >= SaveTimeout && pending.TryRemove(id, out var removed))
                expired.Add(removed.Facts);
        return expired;
    }
}
