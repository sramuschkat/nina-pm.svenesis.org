using System.Globalization;
using System.Windows;
using System.Windows.Media;
using NinaPm.Core.Simulator;
using NinaPm.Nina.Ui;

namespace NinaPm.Nina.Simulator;

/// <summary>Pinsel aus <c>#RRGGBB</c> (eingefroren); ungültige Werte → <paramref name="fallback"/>.</summary>
internal static class Brush
{
    public static SolidColorBrush Of(string? hex, string fallback, byte alpha = 0xFF)
    {
        Color color;
        try
        {
            color = (Color)ColorConverter.ConvertFromString(string.IsNullOrWhiteSpace(hex) ? fallback : hex);
        }
        catch (FormatException)
        {
            color = (Color)ColorConverter.ConvertFromString(fallback);
        }
        color.A = alpha;
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}

/// <summary>Zielkarte (Schritt 2) mit Texten und Farben; Werte aus <see cref="SimulatorCard"/>. Aufbau wie die Zielkarten des Web-Simulators.</summary>
public sealed class SimulatorCardView(SimulatorCard card)
{
    public SimulatorCard Card { get; } = card;

    public string Name => Card.Name;

    public SolidColorBrush ColorBrush { get; } = Brush.Of(ChartPalette.ForSeries(card.SeriesIndex), ChartPalette.Marker);

    public bool Transit => Card.Transit;

    public string TransitLabel => Texts.Transit;

    public string TransitBox => Texts.TransitBox;

    public string HoursText => Texts.CardHours(Card.AllocatedHours.ToString("0.0", CultureInfo.CurrentCulture));

    public string WindowText => $"{Texts.CardWindow}: {Card.Window}";

    public string AltitudeText => Card.Altitude.Length == 0 ? "" : $"{Texts.CardAltitude}: {Card.Altitude}";

    public string MoonText => Card.MoonSeparation.Length == 0 ? "" : $"{Texts.CardMoonSep}: {Card.MoonSeparation}";

    /// <summary>Kennzahlen als Zeilen Bezeichnung → Wert (Zeitfenster, Zugeteilt, Höhe, Mondabstand).</summary>
    public IReadOnlyList<CardFact> Facts { get; } =
    [
        .. new[]
        {
            new CardFact(Texts.CardWindow, card.Window),
            new CardFact(Texts.CardAllocated, $"{card.AllocatedHours.ToString("0.0", CultureInfo.CurrentCulture)} h"),
            new CardFact(Texts.CardAltitude, card.Altitude),
            new CardFact(Texts.CardMoonSep, card.MoonSeparation),
        }.Where(f => f.Value.Length > 0),
    ];

    public string LinesHeader => Texts.CardLinesHeader;

    public IReadOnlyList<CardLineView> Lines { get; } = [.. card.Lines.Select(l => new CardLineView(l))];

    public IReadOnlyList<CardCheckView> Checks { get; } = [.. card.Checks.Select(c => new CardCheckView(c))];

    public IReadOnlyList<string> Flips { get; } =
        [.. card.Flips.Select(f => f.InTransitWindow ? Texts.CardFlipInWindow(f.Time) : Texts.CardFlip(f.Time, f.Minutes))];

    public bool HasFlips => Flips.Count > 0;

    public SolidColorBrush FlipBrush { get; } = Brush.Of(ChartPalette.Meridian, ChartPalette.Meridian);
}

/// <summary>Kennzahl der Zielkarte.</summary>
public sealed record CardFact(string Label, string Value);

/// <summary>Zeile des Belichtungsplans: Filter-Chip in Filterfarbe, Zahlen, Mondprofil als Pille.</summary>
public sealed class CardLineView(CardLine line)
{
    public string Chip => line.Filter;

    public SolidColorBrush ChipBrush { get; } = Brush.Of(line.Color, ChartPalette.Marker);

    public SolidColorBrush ChipForeground { get; } = Brush.Of(ChartPalette.TextOn(line.Color ?? ChartPalette.Marker), "#ffffff");

    public string Detail => Texts.CardLineDetail(line.Need, line.Tonight, line.ExposureS.ToString("0.###", CultureInfo.CurrentCulture))
        + (line.Enabled ? "" : $" · {Texts.CardLineOff}");

    /// <summary>Bisheriger Einzeiler (Kopieren, Tests).</summary>
    public string Text => Texts.CardLine(line.Filter, line.ExposureS.ToString("0.###", CultureInfo.CurrentCulture), line.Need, line.Tonight)
        + (line.Enabled ? "" : $" · {Texts.CardLineOff}");

    public string MoonText => line.MoonProfile is { } m
        ? Texts.CardMoon(Texts.MoonProfile(m)) + (line.MoonMustBeDown ? $" · {Texts.CardMoonDown}" : "")
        : "";

    public bool HasMoon => MoonText.Length > 0;

    public SolidColorBrush MoonBrush { get; } = Brush.Of(ChartPalette.Meridian, ChartPalette.Meridian);

    public double Opacity => line.Enabled ? 1 : 0.5;
}

/// <summary>Prüfpunkt der Zielkarte: farbiges Zeichen ✓/✗/⚠, Text in Textfarbe.</summary>
public sealed class CardCheckView(CardCheck check)
{
    public string Icon => SimulatorCards.Symbol(check.State);

    public string Label => Texts.Check(check.Key);

    public string Text => $"{Icon} {Label}";

    public SolidColorBrush Brush { get; } = check.State switch
    {
        "fail" => Simulator.Brush.Of(ChartPalette.MinAltitude, ChartPalette.MinAltitude),
        "warn" => Simulator.Brush.Of(ChartPalette.Warn, ChartPalette.Warn),
        _ => Simulator.Brush.Of(ChartPalette.Ok, ChartPalette.Ok),
    };
}

/// <summary>Nicht zugeteiltes Projekt mit Gründen.</summary>
public sealed class UnallocatedView(UnallocatedProject project)
{
    public string Text => project.Reasons.Count == 0
        ? project.Name
        : $"{project.Name} – {string.Join(", ", project.Reasons.Select(Texts.DiagnosticReason))}";
}

/// <summary>Zeile des Planprotokolls (Zellen nach <see cref="PlanLog.Columns"/>).</summary>
public sealed class LogRowView(PlanLogRow row)
{
    public string Time => row.Cells[0];
    public string Cmd => row.Cells[1];
    public string Target => row.Cells[2];
    public string Panel => row.Cells[3];
    public string No => row.Cells[4];
    public string Filter => row.Cells[5];
    public string Exposure => row.Cells[6];
    public string Gain => row.Cells[7];
    public string Offset => row.Cells[8];
    public string Binning => row.Cells[9];
    public string Readout => row.Cells[10];
    public string Rotation => row.Cells[11];
    public string Ra => row.Cells[12];
    public string Dec => row.Cells[13];
    public string Alt => row.Cells[14];
    public string MoonSep => row.Cells[15];
    public string MoonOk => row.Cells[16];
    public string Required => row.Cells[17];
    public string Dark => row.Cells[18];
    public string La => row.Cells[19];
    public string Profile => row.Cells[20];
}

/// <summary>Rechteck der Plangrafik (Himmel, Block, Filterabschnitt) in Pixeln, optional mit Rahmen und Beschriftung oben links.</summary>
public sealed record ChartRectView(double Left, double Top, double Width, double Height, SolidColorBrush Fill, string Label,
    SolidColorBrush LabelBrush, string ToolTip, SolidColorBrush? Stroke = null, double StrokeThickness = 0, bool LabelTop = false)
{
    public Thickness Border => new(StrokeThickness);

    public VerticalAlignment LabelAlignment => LabelTop ? VerticalAlignment.Top : VerticalAlignment.Center;

    public FontWeight LabelWeight => LabelTop ? FontWeights.SemiBold : FontWeights.Normal;

    public double LabelSize => LabelTop ? 12 : 10.5;

    public Thickness LabelMargin => LabelTop ? new Thickness(5, 4, 3, 0) : new Thickness(4, 0, 3, 0);
}

/// <summary>Fläche der Plangrafik (Mond) in Pixeln.</summary>
public sealed record ChartPolygonView(PointCollection Points, SolidColorBrush Fill);

/// <summary>Linie bzw. Kurve der Plangrafik in Pixeln.</summary>
public sealed record ChartLineView(PointCollection Points, SolidColorBrush Stroke, double Thickness, DoubleCollection? Dash);

/// <summary>Beschriftung der Plangrafik in Pixeln; mit Hintergrund als Kasten (Flip-Marke).</summary>
public sealed record ChartTextView(double Left, double Top, string Text, SolidColorBrush Foreground, SolidColorBrush? Background = null,
    double Size = 11, bool Bold = false)
{
    public FontWeight Weight => Bold ? FontWeights.SemiBold : FontWeights.Normal;

    public Thickness Padding => Background is null ? new Thickness(0) : new Thickness(4, 1, 4, 1);
}

/// <summary>
/// Plangrafik (FA-SIM-07) in Pixeln, gestaltet wie die Plangrafik des Web-Simulators (Farben aus <c>packages/ui-tokens</c>):
/// dunkler Rahmen, oben die Filterleiste in Filterfarben, darunter der Himmel im Verlauf nach Sonnenhöhe, Mond als rote
/// Fläche, Blöcke als halbtransparente Flächen in Zielfarbe mit Namen, Höhenkurven je Ziel, Raster, gestrichelte
/// Mindesthöhe, Dämmerungsgrenzen mit Namen, Flip-Marken, Jetzt-Linie; links die Höhen, unten die Stunden in Standortzeit.
/// </summary>
public sealed class PlanChartView
{
    public const double Width = 960;
    public const double PadLeft = 36;
    public const double PadRight = 10;
    public const double PlotWidth = Width - PadLeft - PadRight;
    public const double FilterTop = 8;
    public const double FilterHeight = 18;
    public const double PlotTop = 32;
    public const double PlotHeight = 230;
    public const double AxisTop = PlotTop + PlotHeight + 5;
    public const double Height = AxisTop + 20;

    private static double Px(double x) => PadLeft + x * PlotWidth;

    private static double Py(double y) => PlotTop + y * PlotHeight;

    /// <summary>Grobe Textbreite für die Lage von Beschriftungen (11 px Schrift).</summary>
    private static double TextWidth(string text, double size = 11) => text.Length * size * 0.56;

    public PlanChartView(PlanChart chart)
    {
        Chart = chart;
        var label = Brush.Of(ChartPalette.Label, ChartPalette.Label, (byte)Math.Round(ChartPalette.LabelAlpha * 255));
        var curve = Brush.Of(ChartPalette.Curve, ChartPalette.Curve);
        var frame = Brush.Of(ChartPalette.Frame, ChartPalette.Frame);
        var grid = Brush.Of(ChartPalette.Grid, ChartPalette.Grid, (byte)Math.Round(ChartPalette.GridAlpha * 255));
        var meridian = Brush.Of(ChartPalette.Meridian, ChartPalette.Meridian);
        var now = Brush.Of(ChartPalette.Now, ChartPalette.Now);
        FrameBrush = frame;

        var rects = new List<ChartRectView>();
        // Himmel im Verlauf nach Sonnenhöhe (SKY_STOPS), 5-min-Abschnitte; +1 px gegen Nähte.
        foreach (var k in chart.Sky)
            rects.Add(new ChartRectView(Px(k.X), PlotTop, Math.Max(1, k.Width * PlotWidth + 1), PlotHeight,
                Brush.Of(k.Color, ChartPalette.SkyNight), "", label, ""));
        // Blöcke als Flächen in Zielfarbe (20 % Fläche, 60 % Rahmen), Name oben links.
        foreach (var b in chart.Blocks)
        {
            var name = b.Transit ? $"{b.Label} ({Texts.Transit})" : b.Label;
            var color = ChartPalette.ForSeries(b.SeriesIndex);
            var w = Math.Max(1, b.Width * PlotWidth);
            rects.Add(new ChartRectView(Px(b.X), PlotTop, w, PlotHeight, Brush.Of(color, ChartPalette.Marker, 0x33),
                w > 40 ? name : "", curve, $"{name} · {b.Window}", Brush.Of(color, ChartPalette.Marker, 0x99), 1, LabelTop: true));
        }
        // Filterleiste in Filterfarben, Text dunkel auf hellen Farben, sonst weiß; 1 px Fuge zwischen den Abschnitten.
        foreach (var f in chart.FilterBars)
        {
            var color = f.Color ?? ChartPalette.Marker;
            var w = Math.Max(1, f.Width * PlotWidth - 1);
            rects.Add(new ChartRectView(Px(f.X), FilterTop, w, FilterHeight, Brush.Of(color, ChartPalette.Marker),
                w > 26 ? f.Label : "", Brush.Of(ChartPalette.TextOn(color), "#ffffff"), f.Label));
        }
        Rects = rects;

        PointCollection Points(IEnumerable<(double X, double Y)> pts)
        {
            var c = new PointCollection(pts.Select(p => new Point(Px(p.X), Py(p.Y))));
            c.Freeze();
            return c;
        }
        DoubleCollection Dash(params double[] d)
        {
            var c = new DoubleCollection(d);
            c.Freeze();
            return c;
        }

        // Mond als rote Fläche bis zum Horizont, Deckkraft nach Beleuchtung (wie im Web).
        var polygons = new List<ChartPolygonView>();
        if (chart.Moon is { Points.Count: > 1 } moon)
            polygons.Add(new ChartPolygonView(
                Points([(moon.Points[0].X, 1), .. moon.Points, (moon.Points[^1].X, 1)]),
                Brush.Of(ChartPalette.MoonFill, ChartPalette.MoonFill, (byte)Math.Round(ChartPalette.MoonAlpha(chart.MoonIlluminationPct) * 255))));
        Polygons = polygons;

        var lines = new List<ChartLineView>
        {
            // Raster: 60° und volle Stunden fein.
            new(Points([(0, 1 - 60.0 / PlanChart.MaxAltitudeDeg), (1, 1 - 60.0 / PlanChart.MaxAltitudeDeg)]), grid, 1, null),
        };
        lines.AddRange(chart.Ticks.Select(t => new ChartLineView(Points([(t.X, 0), (t.X, 1)]), grid, 1, null)));
        lines.AddRange(chart.Twilight.Select(t => new ChartLineView(Points([(t.X, 0), (t.X, 1)]), grid, 1, null)));
        // Mindesthöhe gestrichelt weiß (40 %).
        lines.Add(new ChartLineView(Points([(0, chart.MinAltitudeY), (1, chart.MinAltitudeY)]),
            Brush.Of("#ffffff", "#ffffff", 0x66), 1, Dash(3, 3)));
        lines.AddRange(chart.Curves.Select(c =>
            new ChartLineView(Points(c.Points.Where(p => p.Y < 1)), Brush.Of(ChartPalette.ForSeries(c.SeriesIndex), ChartPalette.Marker), 2, null)));
        foreach (var f in chart.Flips)
            lines.Add(new ChartLineView(Points([(f.X, 0), (f.X, 1)]), meridian, 1, Dash(4, 3)));
        if (chart.NowX is { } nowX)
            lines.Add(new ChartLineView(Points([(nowX, 0), (nowX, 1)]), now, 1.5, null));
        Lines = lines;

        var labels = new List<ChartTextView>();
        // Höhen links, Stunden unten (Standortzeit).
        foreach (var alt in new[] { 0, 30, 60, 90 })
            labels.Add(new ChartTextView(4, Py(1 - alt / PlanChart.MaxAltitudeDeg) - 8, $"{alt}°", label, Size: 10.5));
        foreach (var t in chart.Ticks)
            labels.Add(new ChartTextView(Math.Clamp(Px(t.X) - 14, 0, Width - 30), AxisTop, t.Label, label, Size: 10.5));
        // Dämmerungsnamen am Fuß: abends rechts der Linie, morgens links davon.
        foreach (var t in chart.Twilight)
        {
            var word = Texts.TwilightWord(t.Kind);
            var left = t.Evening ? Px(t.X) + 4 : Px(t.X) - 4 - TextWidth(word);
            labels.Add(new ChartTextView(left, PlotTop + PlotHeight - 17, word, label));
        }
        // Flip-Marke als Kasten in Meridianfarbe.
        foreach (var f in chart.Flips)
        {
            var left = Px(f.X) + 2 + TextWidth(f.Label) + 8 <= PadLeft + PlotWidth ? Px(f.X) + 2 : Px(f.X) - 2 - TextWidth(f.Label) - 8;
            labels.Add(new ChartTextView(left, PlotTop + 24, f.Label, frame, meridian, Bold: true));
        }
        // „Mond“ am höchsten Punkt der Mondfläche.
        if (chart.Moon is { Points.Count: > 1 } m && m.Points.MinBy(p => p.Y) is var top && top.Y < 1 - 5 / PlanChart.MaxAltitudeDeg)
            labels.Add(new ChartTextView(Px(top.X) - TextWidth(Texts.MoonWord) / 2, Py(top.Y) - 16, Texts.MoonWord, now, Bold: true));
        Labels = labels;
    }

    public PlanChart Chart { get; }

    public double ChartWidth => Width;

    public double ChartHeight => Height;

    public SolidColorBrush FrameBrush { get; }

    public IReadOnlyList<ChartRectView> Rects { get; }

    public IReadOnlyList<ChartPolygonView> Polygons { get; }

    public IReadOnlyList<ChartLineView> Lines { get; }

    public IReadOnlyList<ChartTextView> Labels { get; }
}
