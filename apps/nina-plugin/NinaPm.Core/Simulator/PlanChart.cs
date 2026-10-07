using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Simulator;

/// <summary>Dämmerungsstufe als Band: 1 = Sonne unter −6°, 2 = unter −12°, 3 = unter −18° (astronomisch dunkel).</summary>
public sealed record ChartBand(double X, double Width, int Level);

/// <summary>
/// Zeitbezug eines Blocks bzw. Filterabschnitts: <see cref="Normal"/> im Simulator; in den Fenstern im Imaging-Reiter
/// (AP-53b) ist Erledigtes blass (<see cref="Past"/>) und Geplantes kräftig (<see cref="Planned"/>), Sven 07.10.2026.
/// </summary>
public enum ChartTense
{
    Normal,
    Past,
    Planned,
}

/// <summary>Block der Plangrafik, farbig je Ziel (<see cref="SeriesIndex"/>).</summary>
public sealed record ChartBlock(double X, double Width, string Label, int SeriesIndex, bool Transit, string Window)
{
    public ChartTense Tense { get; init; } = ChartTense.Normal;
}

/// <summary>Abschnitt der Filterleiste („Ha ×17“), Farbe aus den Filter-Stammdaten.</summary>
public sealed record ChartFilterBar(double X, double Width, string Label, string? Color)
{
    public ChartTense Tense { get; init; } = ChartTense.Normal;
}

/// <summary>Art einer Lücke im Erledigten (schraffiert, AP-53b).</summary>
public enum ChartGapKind
{
    /// <summary>Leerlauf zwischen zwei Blöcken.</summary>
    Idle,

    /// <summary>Safety-Pause (unsicher).</summary>
    Safety,

    /// <summary>Meridian-Flip.</summary>
    Flip,

    /// <summary>Wiederholte Blöcke ohne Belichtung (z. B. <c>transit_interrupt</c>-Schleife, Rig-Nacht 06./07.10.2026).</summary>
    EmptyBlocks,

    /// <summary>Übersprungene Blöcke (Zentrieren fehlgeschlagen, Filter fehlt …).</summary>
    Skipped,
}

/// <summary>Lücke im Erledigten mit Grund (<see cref="Reason"/>: Code, bei leeren Blöcken der Blockgrund) und Anzahl.</summary>
public sealed record ChartGap(double X, double Width, ChartGapKind Kind, string? Reason, int Count, string Window);

/// <summary>Senkrechte Marke (Meridian-Flip) mit Uhrzeit in Standortzeit.</summary>
public sealed record ChartMarker(double X, string Label);

/// <summary>Stundenmarke der Zeitachse in Standortzeit (<c>21:00</c>, <c>22:00</c>, …).</summary>
public sealed record ChartTick(double X, string Label);

/// <summary>Himmelsabschnitt (5 min) in der Farbe der geschätzten Sonnenhöhe (<see cref="ChartPalette.Sky"/>).</summary>
public sealed record ChartSky(double X, double Width, string Color);

/// <summary>Dämmerungsgrenze: <c>civil</c>, <c>nautical</c>, <c>astronomical</c>; abends (<see cref="Evening"/>) bzw. morgens.</summary>
public sealed record ChartTwilight(double X, string Kind, bool Evening);

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

    /// <summary>Himmel als Verlauf nach Sonnenhöhe (wie im Web-Simulator), 5-min-Abschnitte.</summary>
    public IReadOnlyList<ChartSky> Sky { get; init; } = [];

    /// <summary>Dämmerungsgrenzen im Nachtfenster für Linien und Beschriftung („Bürgerl.“, „Naut.“, „Astro.“).</summary>
    public IReadOnlyList<ChartTwilight> Twilight { get; init; } = [];

    /// <summary>Mondbeleuchtung in % – Deckkraft der Mondfläche (<see cref="ChartPalette.MoonAlpha"/>).</summary>
    public double MoonIlluminationPct { get; init; }

    /// <summary>Lücken im Erledigten (nur in den Fenstern im Imaging-Reiter).</summary>
    public IReadOnlyList<ChartGap> Gaps { get; init; } = [];

    /// <summary>Anteil 0…1 der Zeitachse für einen Zeitpunkt (begrenzt).</summary>
    public double At(DateTimeOffset t) => Math.Clamp((t - StartUtc).TotalSeconds / Math.Max(1, (EndUtc - StartUtc).TotalSeconds), 0, 1);

    /// <summary>Breite zwischen zwei Zeitpunkten als Anteil (nicht negativ).</summary>
    public double Span(DateTimeOffset from, DateTimeOffset to) => Math.Max(0, At(to) - At(from));

    public static readonly TimeSpan SkyStep = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Sonnenhöhe aus den Dämmerungszeiten des Servers geschätzt: −6°/−12°/−18° an den Grenzen, dazwischen linear, vor der
    /// ersten bzw. nach der letzten Grenze mit der Steigung des äußeren Abschnitts fortgesetzt (höchstens +6°). Ohne
    /// Grenzen −18° (Polarnacht) bzw. +6° (keine Dunkelheit). Nur für den Farbverlauf – geplant wird auf dem Server.
    /// </summary>
    public static double SunAltitude(NinaSimulationDarkness d, DateTimeOffset at)
    {
        var anchors = new List<(DateTimeOffset At, double Alt)>();
        void Add(DateTimeOffset? t, double alt)
        {
            if (t is { } v) anchors.Add((v, alt));
        }
        Add(d.CivilStartUtc, -6);
        Add(d.NauticalStartUtc, -12);
        Add(d.AstronomicalStartUtc, -18);
        Add(d.AstronomicalEndUtc, -18);
        Add(d.NauticalEndUtc, -12);
        Add(d.CivilEndUtc, -6);
        anchors.Sort((a, b) => a.At.CompareTo(b.At));
        if (anchors.Count == 0) return d.AstronomicalStartUtc is null && d.CivilStartUtc is null ? 6 : -18;
        if (anchors.Count == 1) return anchors[0].Alt;
        static double Lerp((DateTimeOffset At, double Alt) a, (DateTimeOffset At, double Alt) b, DateTimeOffset t)
        {
            var span = (b.At - a.At).TotalSeconds;
            return span <= 0 ? a.Alt : a.Alt + (b.Alt - a.Alt) * (t - a.At).TotalSeconds / span;
        }
        double alt;
        if (at <= anchors[0].At) alt = Lerp(anchors[0], anchors[1], at);
        else if (at >= anchors[^1].At) alt = Lerp(anchors[^2], anchors[^1], at);
        else
        {
            var i = anchors.FindIndex(a => a.At > at);
            alt = Lerp(anchors[i - 1], anchors[i], at);
        }
        return Math.Clamp(alt, -18, 6);
    }

    /// <summary>Höhe in Grad → Anteil von oben (90° = 0, Horizont = 1).</summary>
    public static double AltitudeY(double altDeg) => 1 - Math.Clamp(altDeg, 0, MaxAltitudeDeg) / MaxAltitudeDeg;

    public static PlanChart Build(NinaSimulation s, SiteTime site, DateTimeOffset now)
    {
        var frame = Frame(s.NightWindow.StartUtc, s.NightWindow.EndUtc, s.Darkness, site, now);
        double X(DateTimeOffset t) => frame.At(t);
        double W(DateTimeOffset from, DateTimeOffset to) => frame.Span(from, to);
        double Y(double altDeg) => AltitudeY(altDeg);

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
        var minAlt = s.Targets.Count > 0 ? s.Targets.Min(t => t.MinAltitudeDeg) : 30;
        return frame with
        {
            Curves = curves,
            Moon = moon,
            Blocks = blocks,
            FilterBars = bars,
            Flips = flips,
            MinAltitudeY = Y(minAlt),
            MoonIlluminationPct = s.Moon.IlluminationPct,
        };
    }

    /// <summary>
    /// Rahmen ohne Plan: Dämmerungsbänder, Himmel, Dämmerungsgrenzen, Stundenmarken und Jetzt-Linie für ein Nachtfenster
    /// (Fenster im Imaging-Reiter ohne Simulation: aus dem gespeicherten Plan, AP-53b). Mindesthöhe 30°.
    /// </summary>
    public static PlanChart Frame(DateTimeOffset start, DateTimeOffset end, NinaSimulationDarkness d, SiteTime site, DateTimeOffset now)
    {
        var span = Math.Max(1, (end - start).TotalSeconds);
        double X(DateTimeOffset t) => Math.Clamp((t - start).TotalSeconds / span, 0, 1);
        double W(DateTimeOffset from, DateTimeOffset to) => Math.Max(0, X(to) - X(from));

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

        // Volle Stunden in Standortzeit (bei Zeitumstellung zählt die jeweilige Ortszeit).
        var ticks = new List<ChartTick>();
        var local = site.Local(start);
        var first = new DateTimeOffset(local.Year, local.Month, local.Day, local.Hour, 0, 0, local.Offset);
        if (first < local) first = first.AddHours(1);
        for (var t = first.ToUniversalTime(); t <= end; t = t.AddHours(1))
            ticks.Add(new ChartTick(X(t), site.Local(t).ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture)));

        var sky = new List<ChartSky>();
        for (var t = start; t < end; t += SkyStep)
        {
            var to = t + SkyStep < end ? t + SkyStep : end;
            sky.Add(new ChartSky(X(t), W(t, to), ChartPalette.Sky(SunAltitude(d, t + (to - t) / 2))));
        }
        var mid = start + (end - start) / 2;
        var twilight = new List<ChartTwilight>();
        void Cross(DateTimeOffset? at, string kind)
        {
            if (at is { } v && v > start && v < end) twilight.Add(new ChartTwilight(X(v), kind, v < mid));
        }
        Cross(d.CivilStartUtc, "civil");
        Cross(d.NauticalStartUtc, "nautical");
        Cross(d.AstronomicalStartUtc, "astronomical");
        Cross(d.AstronomicalEndUtc, "astronomical");
        Cross(d.NauticalEndUtc, "nautical");
        Cross(d.CivilEndUtc, "civil");

        return new PlanChart(start, end, bands, [], null, [], [], [], ticks,
            now >= start && now <= end ? X(now) : null, AltitudeY(30), site.Abbr(start))
        {
            Sky = sky,
            Twilight = [.. twilight.OrderBy(c => c.X)],
        };
    }
}
