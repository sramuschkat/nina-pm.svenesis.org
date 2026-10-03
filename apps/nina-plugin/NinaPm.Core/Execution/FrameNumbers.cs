namespace NinaPm.Core.Execution;

/// <summary>
/// Bildnummer für NINAs Dateimuster <c>$$FRAMENR$$</c> (<c>CaptureSequence.ProgressExposureCount</c>) je Ziel und
/// Filter, wie NINAs eigene Belichtung (<c>TakeExposure</c>: Zähler je DSO-Container und Filter, beginnt bei 0, nur im
/// Speicher, erst nach der Aufnahme weitergezählt). Ohne Zähler trug jede Datei <c>0000</c> (P-05 prod 03.10.2026).
/// </summary>
public sealed class FrameNumbers
{
    private readonly Dictionary<(string Target, string Filter), int> counts = [];

    /// <summary>Nummer der nächsten Aufnahme dieses Ziels mit diesem Filter.</summary>
    public int Peek(string target, string? filter) => counts.GetValueOrDefault((target, filter ?? ""));

    /// <summary>Aufnahme gemacht: nächste Nummer.</summary>
    public void Advance(string target, string? filter) => counts[(target, filter ?? "")] = Peek(target, filter) + 1;
}
