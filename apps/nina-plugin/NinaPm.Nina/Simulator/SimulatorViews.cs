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

/// <summary>Zielkarte (Schritt 2) mit Texten und Farben; Werte aus <see cref="SimulatorCard"/>.</summary>
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

    public IReadOnlyList<CardLineView> Lines { get; } = [.. card.Lines.Select(l => new CardLineView(l))];

    public IReadOnlyList<CardCheckView> Checks { get; } = [.. card.Checks.Select(c => new CardCheckView(c))];

    public IReadOnlyList<string> Flips { get; } =
        [.. card.Flips.Select(f => f.InTransitWindow ? Texts.CardFlipInWindow(f.Time) : Texts.CardFlip(f.Time, f.Minutes))];
}

public sealed class CardLineView(CardLine line)
{
    public SolidColorBrush ColorBrush { get; } = Brush.Of(line.Color, ChartPalette.Marker);

    public string Text => Texts.CardLine(line.Filter, line.ExposureS.ToString("0.###", CultureInfo.CurrentCulture), line.Need, line.Tonight)
        + (line.Enabled ? "" : $" · {Texts.CardLineOff}");

    public string MoonText => line.MoonProfile is { } m
        ? Texts.CardMoon(Texts.MoonProfile(m)) + (line.MoonMustBeDown ? $" · {Texts.CardMoonDown}" : "")
        : "";

    public double Opacity => line.Enabled ? 1 : 0.5;
}

public sealed class CardCheckView(CardCheck check)
{
    public string Text => $"{SimulatorCards.Symbol(check.State)} {Texts.Check(check.Key)}";

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

/// <summary>Rechteck der Plangrafik (Band, Block, Filterabschnitt) in Pixeln.</summary>
public sealed record ChartRectView(double Left, double Top, double Width, double Height, SolidColorBrush Fill, string Label,
    SolidColorBrush LabelBrush, string ToolTip);

/// <summary>Linie bzw. Kurve der Plangrafik in Pixeln.</summary>
public sealed record ChartLineView(PointCollection Points, SolidColorBrush Stroke, double Thickness, DoubleCollection? Dash);

/// <summary>Beschriftung der Plangrafik in Pixeln.</summary>
public sealed record ChartTextView(double Left, double Top, string Text, SolidColorBrush Foreground);

/// <summary>
/// Plangrafik (FA-SIM-07) in Pixeln: Anteile des Kerns (<see cref="PlanChart"/>) × feste Breite. Oben die Filterleiste,
/// darunter die Blöcke je Ziel, darunter Dämmerungsbänder mit Höhenkurven, Mindesthöhe, Flip-Marken und Jetzt-Linie,
/// unten die Stunden in Standortzeit.
/// </summary>
public sealed class PlanChartView
{
    public const double Width = 960;
    public const double FilterTop = 0;
    public const double FilterHeight = 16;
    public const double BlockTop = 20;
    public const double BlockHeight = 24;
    public const double SkyTop = 50;
    public const double SkyHeight = 160;
    public const double TickTop = SkyTop + SkyHeight + 2;
    public const double Height = TickTop + 16;

    public PlanChartView(PlanChart chart)
    {
        Chart = chart;
        var axis = Brush.Of(ChartPalette.Axis, ChartPalette.Axis);
        var dark = Brush.Of(ChartPalette.Frame, ChartPalette.Frame);
        var meridian = Brush.Of(ChartPalette.Meridian, ChartPalette.Meridian);
        var rects = new List<ChartRectView>
        {
            // Grund: Tag/bürgerliche Dämmerung hell, je Dämmerungsstufe dunkler (chart-sky-night).
            new(0, SkyTop, Width, SkyHeight, Brush.Of(ChartPalette.Civil, ChartPalette.Civil, 0x66), "", axis, ""),
        };
        foreach (var b in chart.Bands)
            rects.Add(new ChartRectView(b.X * Width, SkyTop, b.Width * Width, SkyHeight,
                Brush.Of(ChartPalette.SkyNight, ChartPalette.SkyNight, b.Level switch { 1 => 0x99, 2 => 0xBB, _ => 0xFF }), "", axis, ""));
        foreach (var b in chart.Blocks)
        {
            var label = b.Transit ? $"{b.Label} ({Texts.Transit})" : b.Label;
            rects.Add(new ChartRectView(b.X * Width, BlockTop, Math.Max(1, b.Width * Width), BlockHeight,
                Brush.Of(ChartPalette.ForSeries(b.SeriesIndex), ChartPalette.Marker), label, dark, $"{label} · {b.Window}"));
        }
        foreach (var f in chart.FilterBars)
            rects.Add(new ChartRectView(f.X * Width, FilterTop, Math.Max(1, f.Width * Width), FilterHeight,
                Brush.Of(f.Color, ChartPalette.Marker), f.Label, dark, f.Label));
        Rects = rects;

        PointCollection Points(IEnumerable<(double X, double Y)> pts)
        {
            var c = new PointCollection(pts.Select(p => new Point(p.X * Width, SkyTop + p.Y * SkyHeight)));
            c.Freeze();
            return c;
        }
        DoubleCollection Dash(params double[] d)
        {
            var c = new DoubleCollection(d);
            c.Freeze();
            return c;
        }
        var lines = new List<ChartLineView>
        {
            new(Points([(0, chart.MinAltitudeY), (1, chart.MinAltitudeY)]), Brush.Of(ChartPalette.MinAltitude, ChartPalette.MinAltitude), 1, Dash(4, 3)),
        };
        if (chart.Moon is { } moon)
            lines.Add(new ChartLineView(Points(moon.Points), Brush.Of(ChartPalette.Moon, ChartPalette.Moon), 1.5, Dash(2, 2)));
        lines.AddRange(chart.Curves.Select(c =>
            new ChartLineView(Points(c.Points), Brush.Of(ChartPalette.ForSeries(c.SeriesIndex), ChartPalette.Marker), 2, null)));
        foreach (var f in chart.Flips)
            lines.Add(new ChartLineView(Points([(f.X, (BlockTop - SkyTop) / SkyHeight), (f.X, 1)]), meridian, 1, Dash(3, 2)));
        if (chart.NowX is { } now)
            lines.Add(new ChartLineView(Points([(now, (FilterTop - SkyTop) / SkyHeight), (now, 1)]), Brush.Of(ChartPalette.Now, ChartPalette.Now), 1.5, null));
        Lines = lines;

        Labels = [.. chart.Ticks.Select(t => new ChartTextView(Math.Min(Width - 14, Math.Max(0, t.X * Width - 7)), TickTop, t.Label, axis)),
            .. chart.Flips.Select(f => new ChartTextView(Math.Min(Width - 70, f.X * Width + 3), SkyTop + 2, f.Label, meridian))];
    }

    public PlanChart Chart { get; }

    public double ChartWidth => Width;

    public double ChartHeight => Height;

    public IReadOnlyList<ChartRectView> Rects { get; }

    public IReadOnlyList<ChartLineView> Lines { get; }

    public IReadOnlyList<ChartTextView> Labels { get; }
}
