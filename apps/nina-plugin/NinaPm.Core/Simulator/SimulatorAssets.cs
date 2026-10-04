namespace NinaPm.Core.Simulator;

/// <summary>
/// Zielfarben der Plangrafik und Zielkarten (FA-SIM-07): dieselben Werte wie <c>chart-series-1…6</c> in
/// <c>packages/ui-tokens/src/tokens.ts</c> (themenunabhängig wie das Nachtdiagramm; ein Test vergleicht beide Quellen).
/// Danach wiederholt sich die Reihe.
/// </summary>
public static class ChartPalette
{
    public static readonly IReadOnlyList<string> Series = ["#e8ecf2", "#7fc8f8", "#f6c85f", "#b39ddb", "#80cbc4", "#f48fb1"];

    /// <summary><c>chart-marker</c>: Filter ohne Farbe in den Stammdaten.</summary>
    public const string Marker = "#7fb2e5";

    /// <summary><c>chart-moon</c></summary>
    public const string Moon = "#d8433b";

    /// <summary><c>chart-min-alt</c></summary>
    public const string MinAltitude = "#e5484d";

    public static string ForSeries(int index) => index < 0 ? Moon : Series[index % Series.Count];
}

/// <summary>
/// Infobox <em>Beispielsequenzen herunterladen</em> (FA-NIN-18, FA-NIN-25): die mit dieser Plugin-Version ausgelieferten
/// Sequenzen unter <c>https://nina-pm.svenesis.org/downloads/nina-sequences/&lt;Plugin-Version&gt;/&lt;Datei&gt;</c>
/// (<c>NinaPm.Nina/Samples/README.md</c>). Die Liste prüft ein Test gegen den Samples-Ordner.
/// </summary>
public static class SampleSequences
{
    public const string BaseUrl = "https://nina-pm.svenesis.org/downloads/nina-sequences";

    /// <summary>Dateien in <c>NinaPm.Nina/Samples/</c> (R1); <c>multi-night.json</c> (AP-52) und <c>with-flats.json</c> (AP-50) kommen mit ihren Paketen.</summary>
    public static readonly IReadOnlyList<string> Files = ["one-night-safety.json", "one-night.json"];

    public static string Url(string pluginVersion, string file) => $"{BaseUrl}/{Uri.EscapeDataString(pluginVersion)}/{Uri.EscapeDataString(file)}";
}
