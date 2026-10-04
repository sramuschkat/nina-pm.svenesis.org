using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Simulator;

/// <summary>Dämmerungsstufe als Band: 1 = Sonne unter −6°, 2 = unter −12°, 3 = unter −18° (astronomisch dunkel).</summary>
public sealed record ChartBand(double X, double Width, int Level);

/// <summary>Block der Plangrafik, farbig je Ziel (<see cref="SeriesIndex"/>).</summary>
public sealed record ChartBlock(double X, double Width, string Label, int SeriesIndex, bool Transit, string Window);

/// <summary>Abschnitt der Filterleiste („Ha ×17“), Farbe aus den Filter-Stammdaten.</summary>
public sealed record ChartFilterBar(double X, double Width, string Label, string? Color);

/// <summary>Senkrechte Marke (Meridian-Flip) mit Uhrzeit in Standortzeit.</summary>
public sealed record ChartMarker(double X, string Label);

/// <summary>Stundenmarke der Zeitachse in Standortzeit (<c>21</c>, <c>22</c>, …).</summary>
public sealed record ChartTick(double X, string Label);

/// <summary>Höhenkurve: <c>Y</c> = 0 oben (90°) … 1 unten (Horizont); unter dem Horizont auf 1 begrenzt.</summary>
public sealed record ChartCurve(string Name, int SeriesIndex, IReadOnlyList<(double X, double Y)> Points);

/// <summary>
/// Plangrafik des Simulators (FA-NIN-18, FA-SIM-07) als Anteile 0…1 der Zeitachse (Nachtfenster): Dämmerungsbänder,
/// Höhenkurven je Ziel und Mond, belegte Blöcke farbig je Ziel, darüber die Filterleiste in Filterfarben, Flip-Marken,
/// Stundenmarken in Standortzeit und die Jetzt-Linie. Die Ansicht rechnet nur noch Anteile × Breite.
/// </summary>
public sealed record PlanChart(
    DateTimeOffset StartUtc,
    DateTimeOffset EndUtc,
    IReadOnlyList<ChartBand> Bands,
    IReadOnlyList<ChartCurve> Curves,
    ChartCurve? Moon,
    IReadOnlyList<ChartBlock> Blocks,
    IReadOnlyList<ChartFilterBar> FilterBars,
    IReadOnlyList<ChartMarker> Flips,
    IReadOnlyList<ChartTick> Ticks,
    double? NowX,
    double MinAltitudeY,
    string Zone)
{
    public const double MaxAltitudeDeg = 90;

    public static PlanChart Build(NinaSimulation s, SiteTime site, DateTimeOffset now)
    {
        var start = s.NightWindow.StartUtc;
        var end = s.NightWindow.EndUtc;
        var span = Math.Max(1, (end - start).TotalSeconds);
        double X(DateTimeOffset t) => Math.Clamp((t - start).TotalSeconds / span, 0, 1);
        double W(DateTimeOffset from, DateTimeOffset to) => Math.Max(0, X(to) - X(from));
        double Y(double altDeg) => 1 - Math.Clamp(altDeg, 0, MaxAltitudeDeg) / MaxAltitudeDeg;

        var d = s.Darkness;
        var bands = new List<ChartBand>();
        void Band(DateTimeOffset? from, DateTimeOffset? to, int level)
        {
            if (from is null && to is null) return;
            var a = from ?? start;
            var b = to ?? end;
            if (b > a) bands.Add(new ChartBand(X(a), W(a, b), level));
        }
        Band(d.CivilStartUtc, d.CivilEndUtc, 1);
        Band(d.NauticalStartUtc, d.NauticalEndUtc, 2);
        Band(d.AstronomicalStartUtc, d.AstronomicalEndUtc, 3);

        var curves = s.Targets
            .Select(t => new ChartCurve(t.Name, t.SeriesIndex, t.Altitude.Select(p => (X(p.AtUtc), Y(p.AltDeg))).ToList()))
            .ToList();
        var moon = s.Moon.Altitude.Count == 0
            ? null
            : new ChartCurve("moon", -1, s.Moon.Altitude.Select(p => (X(p.AtUtc), Y(p.AltDeg))).ToList());

        var blocks = s.Blocks
            .Select(b => new ChartBlock(X(b.StartUtc), W(b.StartUtc, b.EndUtc), b.Label, b.SeriesIndex,
                b.Kind == NinaSimulationBlockKind.Transit, $"{site.Clock(b.StartUtc)}–{site.ClockZone(b.EndUtc)}"))
            .ToList();
        var bars = s.FilterBars
            .Select(f => new ChartFilterBar(X(f.FromUtc), W(f.FromUtc, f.ToUtc), $"{f.Filter} ×{f.Count}", f.Color))
            .ToList();
        var flips = s.Flips.Select(f => new ChartMarker(X(f.AtUtc), $"Flip {site.Clock(f.AtUtc)}")).ToList();

        // Volle Stunden in Standortzeit (bei Zeitumstellung zählt die jeweilige Ortszeit).
        var ticks = new List<ChartTick>();
        var local = site.Local(start);
        var first = new DateTimeOffset(local.Year, local.Month, local.Day, local.Hour, 0, 0, local.Offset);
        if (first < local) first = first.AddHours(1);
        for (var t = first.ToUniversalTime(); t <= end; t = t.AddHours(1))
            ticks.Add(new ChartTick(X(t), site.Local(t).ToString("HH", System.Globalization.CultureInfo.InvariantCulture)));

        var minAlt = s.Targets.Count > 0 ? s.Targets.Min(t => t.MinAltitudeDeg) : 30;
        return new PlanChart(start, end, bands, curves, moon, blocks, bars, flips, ticks,
            now >= start && now <= end ? X(now) : null, Y(minAlt), site.Abbr(start));
    }
}
