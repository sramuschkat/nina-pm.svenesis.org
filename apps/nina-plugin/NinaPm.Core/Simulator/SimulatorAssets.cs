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

    /// <summary><c>chart-curve</c>: Beschriftung der Blöcke, Text auf dunklem Grund.</summary>
    public const string Curve = "#eef2f6";

    /// <summary><c>chart-grid</c> = <c>rgba(255, 255, 255, 0.16)</c>: Raster.</summary>
    public const string Grid = "#ffffff";
    public const double GridAlpha = 0.16;

    /// <summary><c>chart-label</c> = <c>rgba(228, 233, 239, 0.8)</c>: Achsen- und Dämmerungsbeschriftung.</summary>
    public const string Label = "#e4e9ef";
    public const double LabelAlpha = 0.8;

    /// <summary>Mondfläche wie im Web-Nachtdiagramm: <c>rgba(229, 72, 77, a)</c>, Deckkraft nach Beleuchtung.</summary>
    public const string MoonFill = "#e5484d";

    public static double MoonAlpha(double illuminationPct) => 0.18 + 0.4 * Math.Clamp(illuminationPct, 0, 100) / 100;

    /// <summary>
    /// <c>SKY_STOPS</c> aus <c>packages/ui-tokens</c>: Himmelsfarbe nach Sonnenhöhe (absteigend), dazwischen linear,
    /// außerhalb die Randfarbe – derselbe Verlauf wie im Web-Simulator.
    /// </summary>
    public static readonly IReadOnlyList<(double SunAltDeg, int R, int G, int B)> SkyStops =
    [
        (6, 166, 140, 69),
        (0, 93, 128, 168),
        (-6, 62, 92, 130),
        (-12, 31, 51, 80),
        (-18, 14, 24, 36),
    ];

    /// <summary>Himmelsfarbe <c>#rrggbb</c> zur Sonnenhöhe (wie <c>skyColor</c> im Web).</summary>
    public static string Sky(double sunAltDeg)
    {
        var first = SkyStops[0];
        var last = SkyStops[^1];
        static string Hex(double r, double g, double b) =>
            $"#{(int)Math.Round(r):x2}{(int)Math.Round(g):x2}{(int)Math.Round(b):x2}";
        if (sunAltDeg >= first.SunAltDeg) return Hex(first.R, first.G, first.B);
        for (var i = 0; i + 1 < SkyStops.Count; i++)
        {
            var a = SkyStops[i];
            var b = SkyStops[i + 1];
            if (sunAltDeg <= a.SunAltDeg && sunAltDeg >= b.SunAltDeg)
            {
                var f = (a.SunAltDeg - sunAltDeg) / (a.SunAltDeg - b.SunAltDeg);
                return Hex(a.R + (b.R - a.R) * f, a.G + (b.G - a.G) * f, a.B + (b.B - a.B) * f);
            }
        }
        return Hex(last.R, last.G, last.B);
    }

    /// <summary>Relative Helligkeit (0–1) einer Farbe <c>#rrggbb</c> für die Textfarbe auf Filterbalken und -chips (wie <c>luminance</c> im Web).</summary>
    public static double? Luminance(string? hex)
    {
        if (hex is null || hex.Length != 7 || hex[0] != '#') return null;
        if (!int.TryParse(hex.AsSpan(1), System.Globalization.NumberStyles.HexNumber, null, out var v)) return null;
        static double Lin(int c)
        {
            var x = c / 255.0;
            return x <= 0.03928 ? x / 12.92 : Math.Pow((x + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * Lin((v >> 16) & 0xFF) + 0.7152 * Lin((v >> 8) & 0xFF) + 0.0722 * Lin(v & 0xFF);
    }

    /// <summary>Text auf einer farbigen Fläche: dunkel (<c>chart-frame</c>) auf hellen Farben, sonst weiß.</summary>
    public static string TextOn(string? hex) => Luminance(hex) is > 0.45 ? Frame : "#ffffff";

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
