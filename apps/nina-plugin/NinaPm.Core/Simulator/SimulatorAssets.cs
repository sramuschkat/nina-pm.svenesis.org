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

    /// <summary><c>chart-frame</c>: Grund der Plangrafik (Tag).</summary>
    public const string Frame = "#10151c";

    /// <summary><c>chart-sky-night</c> (<c>rgb(14, 24, 36)</c>): Dämmerungsbänder, je Stufe deckender.</summary>
    public const string SkyNight = "#0e1824";

    /// <summary><c>chart-mark-civil</c>: Tageslicht/bürgerliche Dämmerung über dem Grund.</summary>
    public const string Civil = "#9cc1ee";

    /// <summary><c>chart-axis</c>: Stundenmarken und Beschriftung.</summary>
    public const string Axis = "#9aa7b6";

    /// <summary><c>chart-now</c>: Jetzt-Linie.</summary>
    public const string Now = "#e5484d";

    /// <summary><c>chart-meridian</c>: Flip-Marken.</summary>
    public const string Meridian = "#c9a3ff";

    /// <summary><c>chart-recommended</c>: Prüfliste ✓.</summary>
    public const string Ok = "#2ecc71";

    /// <summary><c>chart-mark-sun</c>: Prüfliste ⚠.</summary>
    public const string Warn = "#f0a93b";

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

    /// <summary>Dateien in <c>NinaPm.Nina/Samples/</c>: R1 und <c>multi-night.json</c> (AP-52); <c>with-flats.json</c> (AP-50) folgt.</summary>
    public static readonly IReadOnlyList<string> Files = ["one-night-safety.json", "one-night.json", "multi-night.json"];

    public static string Url(string pluginVersion, string file) => $"{BaseUrl}/{Uri.EscapeDataString(pluginVersion)}/{Uri.EscapeDataString(file)}";
}
