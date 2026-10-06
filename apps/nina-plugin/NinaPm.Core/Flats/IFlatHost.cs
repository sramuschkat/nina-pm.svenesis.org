namespace NinaPm.Core.Flats;

/// <summary>
/// Inhalt der drei Boxen am Container (execution.md §7): ob sie Anweisungen haben, ob die Box <em>Je Kombination</em>
/// Dark-Flats enthält, ob sie NINAs trainierte Tabelle nutzt (<em>Trained Flat/Dark Flat Exposure</em>) und ob die
/// Anzahl vorab feststeht (bei <em>Auto Exposure/Brightness Flat</em> und <em>Sky Flat</em> entscheidet die Box selbst).
/// </summary>
public sealed record FlatBoxes(bool Setup, bool PerCombination, bool Teardown, bool HasDarkFlats, bool UsesTrainedTable, bool CountsKnown)
{
    public static readonly FlatBoxes Empty = new(false, false, false, false, false, true);

    public bool Any => Setup || PerCombination || Teardown;
}

/// <summary>Werte, die das Plugin vor einer Kombination in alle Flat-Anweisungen der Box schreibt.</summary>
/// <param name="FilterIndex">Index im NINA-Profil (ab 0), <c>-1</c> ohne Filterrad.</param>
/// <param name="Flats">Anzahl der Flats in diesem Lauf (fehlende bei Fortsetzung); bei unbekannter Anzahl die Rig-Anzahl.</param>
/// <param name="DarkFlats">Anzahl der Dark-Flats; 0 = Dark-Flat-Teil auslassen (Gruppe erledigt, NIN-15).</param>
/// <param name="TargetName">Name, unter dem die Dateien gespeichert werden (<c>$$TARGETNAME$$</c>, Primärziel).</param>
public sealed record FlatComboRun(int FilterIndex, int Gain, int Offset, int Binning, int Flats, int DarkFlats, string TargetName);

/// <summary>Von NINA gespeicherte Flat- oder Dark-Flat-Datei während des Flat-Laufs (<c>ImageSaved</c>).</summary>
/// <param name="Dark">Bildtyp <c>DARK</c>: NINA 3.2 speichert Dark-Flats (<em>Trained Dark Flat Exposure</em>) als <c>DARK</c>.</param>
public sealed record FlatImage(
    string Path,
    bool Dark,
    string? FilterName,
    int Binning,
    double ExposureS,
    double? MeanAdu,
    DateTimeOffset CapturedAtUtc,
    DateTimeOffset ExposureMidUtc,
    double? SensorTempC,
    double? SetPointC);

/// <summary>
/// Was der Flat-Ablauf von NINA braucht (TK 10.3 Nr. 12, execution.md §7). <c>NinaPm.Nina</c> setzt es auf NINAs
/// Mediatoren, die Boxen am Container und den globalen <c>ImageSaved</c>-Handler um; der kopflose Nachtlauf auf ein
/// simuliertes NINA.
/// </summary>
public interface IFlatHost
{
    FlatBoxes Boxes();

    bool RotatorConnected { get; }

    Task MoveMechanicalAsync(double degrees, CancellationToken token);

    /// <summary>Filternamen des aktiven NINA-Profils in Profil-Reihenfolge (Position = Index + 1).</summary>
    IReadOnlyList<string> ProfileFilterNames();

    Task ChangeFilterAsync(int filterIndex, CancellationToken token);

    IReadOnlyList<string>? ReadoutModes();

    /// <summary>Auslesemodus für FLAT/DARK setzen (<c>SetReadoutModeForNormalImages</c>; NINA nutzt die Snapshot-Einstellung nur für SNAPSHOT).</summary>
    void SetReadoutMode(int index);

    /// <summary>Trainierte Flat-Belichtung (NINAs Tabelle nach Filterposition, Binning, Gain, Offset); <c>null</c> = nicht trainiert.</summary>
    double? TrainedFlatExposureS(int filterIndex, int binning, int gain, int offset);

    /// <summary>Vollausschlag der Kamera (2^Bittiefe − 1) für <c>flat_exposure_off</c>; <c>null</c> = unbekannt.</summary>
    double? MaxAdu();

    Task RunSetupAsync(CancellationToken token);

    Task RunCombinationAsync(FlatComboRun run, CancellationToken token);

    Task RunTeardownAsync(CancellationToken token);

    /// <summary>Einen globalen <c>ImageSaved</c>-Handler für den ganzen Flat-Lauf anhängen (NIN5-11).</summary>
    void BeginImages(Action<FlatImage> sink);

    void EndImages();

    /// <summary>Datei kopieren (Zielordner anlegen); <c>false</c>, wenn das Ziel schon existiert oder das Kopieren scheitert.</summary>
    bool CopyFile(string source, string destination);

    Task DelayAsync(DateTimeOffset untilUtc, CancellationToken token);
}
