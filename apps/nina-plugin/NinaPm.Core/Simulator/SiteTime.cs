using System.Globalization;
using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Simulator;

/// <summary>Abschnitt der Standortzeit: Offset und Kürzel (<c>CDT</c>) ab <see cref="FromUtc"/>; ohne Kürzel <c>UTC−5</c>.</summary>
public sealed record ZoneSegment(DateTimeOffset FromUtc, int UtcOffsetMinutes, string? Abbr);

/// <summary>
/// Standortzeit mit Kürzel im Simulator (FA-NIN-18, NT-03): Abschnitte aus der Simulation des Servers
/// (<c>timeZoneSegments</c> mit Kürzel) bzw. aus <c>bootstrap.timeZoneTransitions</c> (nur Offset). Nie die Zeitzone des
/// NINA-PCs (NT-06).
/// </summary>
public sealed class SiteTime
{
    private readonly IReadOnlyList<ZoneSegment> segments;

    public SiteTime(IEnumerable<ZoneSegment> segments)
    {
        this.segments = segments.OrderBy(s => s.FromUtc).ToList();
    }

    /// <summary>Ohne Angaben: UTC.</summary>
    public static SiteTime Utc { get; } = new([new ZoneSegment(DateTimeOffset.MinValue, 0, "UTC")]);

    public static SiteTime From(NinaSimulation simulation) =>
        new(simulation.TimeZoneSegments.Select(s => new ZoneSegment(s.FromUtc, s.UtcOffsetMinutes, s.Abbr)));

    public static SiteTime From(NinaBootstrap? bootstrap) =>
        bootstrap is null || bootstrap.TimeZoneTransitions.Count == 0
            ? Utc
            : new(bootstrap.TimeZoneTransitions.Select(t => new ZoneSegment(t.AtUtc, t.UtcOffsetMinutes, null)));

    private ZoneSegment Segment(DateTimeOffset utc) => segments.LastOrDefault(s => s.FromUtc <= utc) ?? segments[0];

    public DateTimeOffset Local(DateTimeOffset utc) => utc.ToOffset(TimeSpan.FromMinutes(Segment(utc).UtcOffsetMinutes));

    /// <summary>Kürzel der Zone zum Zeitpunkt, sonst <c>UTC−5</c> bzw. <c>UTC+5:30</c>.</summary>
    public string Abbr(DateTimeOffset utc)
    {
        var s = Segment(utc);
        if (!string.IsNullOrEmpty(s.Abbr)) return s.Abbr!;
        var m = s.UtcOffsetMinutes;
        if (m == 0) return "UTC";
        var sign = m < 0 ? "−" : "+";
        var a = Math.Abs(m);
        return a % 60 == 0 ? $"UTC{sign}{a / 60}" : $"UTC{sign}{a / 60}:{a % 60:00}";
    }

    /// <summary><c>21:08</c></summary>
    public string Clock(DateTimeOffset utc) => Local(utc).ToString("HH:mm", CultureInfo.InvariantCulture);

    /// <summary><c>21:08 CDT</c></summary>
    public string ClockZone(DateTimeOffset utc) => $"{Clock(utc)} {Abbr(utc)}";

    /// <summary><c>21:08:00 CDT</c> (Planprotokoll, wie S-40).</summary>
    public string ClockSeconds(DateTimeOffset utc) =>
        $"{Local(utc).ToString("HH:mm:ss", CultureInfo.InvariantCulture)} {Abbr(utc)}";

    /// <summary><c>17.09. 21:08 CDT</c></summary>
    public string DateClockZone(DateTimeOffset utc) =>
        $"{Local(utc).ToString("dd.MM.", CultureInfo.InvariantCulture)} {ClockZone(utc)}";
}
