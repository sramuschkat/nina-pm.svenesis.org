namespace NinaPm.Core.Flats;

/// <summary>Status einer Flat-Kombination im Plugin (<c>flat_combination_local</c>; <c>pending</c> gibt es nur hier, TK 6.6).</summary>
public enum FlatStatus
{
    Pending,
    Running,
    Done,
    Skipped,
}

/// <summary>Ziel, dessen Lights eine Kombination nutzen: Projekt, Panel und der Name, unter dem NINA die Lights gespeichert hat.</summary>
public sealed record FlatTarget(Guid ProjectId, Guid? PanelId, string Name);

/// <summary>
/// Gespeicherte Light-Aufnahmen einer Nacht, zusammengefasst je Kombination aus Filter, Kamera, gemessenem mechanischem
/// Winkel (Zehntelgrad) und Ziel (execution.md §7). Gain/Offset <c>null</c> stehen als <c>-1</c> (NT-38).
/// </summary>
public sealed record LightObservation(
    string FilterShort,
    string NinaFilter,
    int Gain,
    int Offset,
    int Binning,
    int ReadoutIndex,
    string? ReadoutName,
    int MechDg,
    FlatTarget Target,
    long FirstSeq,
    int Count)
{
    /// <summary>Schlüssel der Zusammenfassung (ohne Anzahl und Reihenfolge).</summary>
    public string Key => $"{FilterShort}|{NinaFilter}|{Gain}|{Offset}|{Binning}|{ReadoutIndex}|{MechDg}|{Target.ProjectId}|{Target.PanelId}";
}

/// <summary>
/// Eine Flat-Kombination der Nacht (FA-NIN-17, execution.md §7): Filter + **eingefrorener** mechanischer Winkel
/// (<see cref="MechDg"/>, Zehntelgrad, NIN5-8) + Gain + Offset + Binning + Auslesemodus-Index – ohne Ziel, mit der
/// Zielliste. Zähler und Sollwerte für Meldung und Fortsetzen nach einem Neustart.
/// </summary>
public sealed class FlatCombination
{
    public required string FilterShort { get; init; }
    public required string NinaFilter { get; init; }
    public required int Gain { get; init; }
    public required int Offset { get; init; }
    public required int Binning { get; init; }
    public required int ReadoutIndex { get; init; }
    public string? ReadoutName { get; init; }

    /// <summary>Eingefrorener Repräsentant in Zehntelgrad – Schlüssel und Anfahrwinkel, nach dem Anlegen unveränderlich.</summary>
    public required int MechDg { get; init; }

    /// <summary>Laufend nachgeführter Median (nur Anzeige/Diagnose).</summary>
    public int MedianDg { get; set; }

    public List<FlatTarget> Targets { get; set; } = [];

    /// <summary>Durch den vollständigen Flat-Satz ergänzt (kein Light mit diesem Filter in der Nacht).</summary>
    public bool FullSet { get; init; }

    public FlatStatus Status { get; set; } = FlatStatus.Pending;

    /// <summary>Reihenfolge der Ausführung (stabil über Neustarts).</summary>
    public int Order { get; set; }

    public int FlatsSaved { get; set; }
    public int DarkFlatsSaved { get; set; }

    /// <summary>Sollwerte aus der ersten Ausführung (NIN5-9); <c>null</c> = noch nicht begonnen bzw. Anzahl offen (Auto-Exposure/Sky).</summary>
    public int? FlatsPlanned { get; set; }
    public int? DarkFlatsPlanned { get; set; }

    /// <summary>Belichtungszeit der Flats (aus der ersten Aufnahme), Schlüssel der Dark-Flat-Gruppe.</summary>
    public double? FlatExposureS { get; set; }

    /// <summary><c>flat_exposure_off</c> wurde für die erste Aufnahme geprüft.</summary>
    public bool ExposureChecked { get; set; }

    /// <summary>Auto-Flats (AP-50b): Regel geprüft (einmal, bevor die Kombination beginnt).</summary>
    public bool AutoChecked { get; set; }

    /// <summary>Nachgeholt aus einer früheren Nacht (AP-50b): Nacht, in der die Kombination entstand.</summary>
    public string? CarriedFrom { get; set; }

    /// <summary>Gespeicherte Dateien (vollständiger Pfad) für die Kopie in die Ordner der übrigen Ziele.</summary>
    public List<string> SavedFiles { get; set; } = [];

    /// <summary>Schlüssel ohne Winkel (Filter, Kamera, Auslesemodus).</summary>
    public string CameraKey => $"{FilterShort}|{Gain}|{Offset}|{Binning}|{ReadoutIndex}";

    /// <summary>Schlüssel in <c>flat_combination_local</c> (wie serverseitig: Filter, Winkel, Gain, Offset, Binning, Auslesemodus).</summary>
    public string Key => $"{CameraKey}|{MechDg}";

    /// <summary>Lesbarer Kurzschlüssel für das Log (<c>combination=</c>, Winkel steht in <c>mechDg=</c>).</summary>
    public string LogKey => $"{FilterShort}_b{Binning}_g{Gain}_o{Offset}_r{ReadoutIndex}";

    public bool Open => Status is FlatStatus.Pending or FlatStatus.Running;
}

/// <summary>Dark-Flats je (Belichtungszeit, Gain, Offset, Binning, Auslesemodus) genau einmal je Nacht (NIN-15).</summary>
public sealed class DarkFlatGroup
{
    public required string Key { get; init; }
    public FlatStatus Status { get; set; } = FlatStatus.Pending;
    public int Saved { get; set; }

    /// <summary>Kombination, unter deren Schlüssel die Dark-Flats gemeldet werden.</summary>
    public string? CombinationKey { get; set; }

    /// <summary>Gespeicherte Dark-Flat-Dateien der Gruppe (im Ordner des Primärziels ihrer Kombination).</summary>
    public List<string> Files { get; set; } = [];

    /// <summary>Ziele (sanitisierte Namen), in deren Ordner die Dark-Flats schon liegen – kein zweites Kopieren je Kombination.</summary>
    public List<string> CopiedTo { get; set; } = [];

    public static string KeyFor(double exposureS, int gain, int offset, int binning, int readoutIndex) =>
        $"{Math.Round(exposureS, 3).ToString(System.Globalization.CultureInfo.InvariantCulture)}|{gain}|{offset}|{binning}|{readoutIndex}";
}

/// <summary>Filter des Rigs (Bootstrap) für den vollständigen Flat-Satz und die Reihenfolge der Himmelsflats.</summary>
public sealed record RigFilter(string ShortName, string? NinaFilterName, int Position, string? Type);
