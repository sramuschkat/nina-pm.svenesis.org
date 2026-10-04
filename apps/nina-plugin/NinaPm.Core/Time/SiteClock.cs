using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Time;

/// <summary>Übergang der Standortzeit aus <c>bootstrap.timeZoneTransitions</c>: Offset ab <see cref="AtUtc"/>.</summary>
public sealed record ZoneTransition(DateTimeOffset AtUtc, int UtcOffsetMinutes);

/// <summary>
/// Standortzeit (NT-06, night.md §1): Umrechnung UTC ↔ Standortzeit **nur** über die Übergangsliste des Servers, nie
/// über die Windows-Zone des NINA-PCs. Zeitumstellung (L2, FA-NIN-26): eine doppelt vorkommende Standortzeit
/// (Rückstellung) gilt in ihrer **ersten** Instanz, eine ausgefallene (Vorstellung) wird um die Lücke **nach vorn**
/// verschoben – Starfront: 01:30 am 01.11.2026 → <c>06:30:00Z</c> (CDT), 02:30 am 08.03.2026 → 03:30 CDT = <c>08:30:00Z</c>.
/// </summary>
public sealed class SiteClock
{
    private readonly IReadOnlyList<ZoneTransition> transitions;

    public SiteClock(IEnumerable<ZoneTransition> transitions)
    {
        this.transitions = transitions.OrderBy(t => t.AtUtc).ToList();
        if (this.transitions.Count == 0) throw new ArgumentException("Übergangsliste ist leer", nameof(transitions));
    }

    public static SiteClock From(NinaBootstrap bootstrap) =>
        new(bootstrap.TimeZoneTransitions.Select(t => new ZoneTransition(t.AtUtc, t.UtcOffsetMinutes)));

    /// <summary>Offset zum Zeitpunkt: letzter Übergang ≤ <paramref name="utc"/>, davor der erste Eintrag.</summary>
    public int OffsetMinutesAt(DateTimeOffset utc)
    {
        var offset = transitions[0].UtcOffsetMinutes;
        foreach (var t in transitions)
        {
            if (t.AtUtc > utc) break;
            offset = t.UtcOffsetMinutes;
        }
        return offset;
    }

    /// <summary>Standortzeit zum Zeitpunkt (Offset der Standortzone).</summary>
    public DateTimeOffset ToSite(DateTimeOffset utc) => utc.ToOffset(TimeSpan.FromMinutes(OffsetMinutesAt(utc)));

    /// <summary>Lokales Datum in Standortzeit.</summary>
    public DateOnly SiteDate(DateTimeOffset utc) => DateOnly.FromDateTime(ToSite(utc).DateTime);

    /// <summary>
    /// Standortzeit → UTC mit L2: alle Offsets prüfen, deren Rückrechnung zur selben Standortzeit führt; mehrere →
    /// die früheste (erste Instanz); keine (Lücke) → mit dem Offset **vor** der Vorstellung rechnen, also um die Lücke
    /// später.
    /// </summary>
    public DateTimeOffset ToUtc(DateOnly date, TimeOnly time)
    {
        var wall = new DateTimeOffset(date.ToDateTime(time), TimeSpan.Zero);
        DateTimeOffset? first = null;
        foreach (var offset in transitions.Select(t => t.UtcOffsetMinutes).Distinct())
        {
            var utc = wall.AddMinutes(-offset);
            if (OffsetMinutesAt(utc) != offset) continue;
            if (first is null || utc < first) first = utc;
        }
        if (first is { } valid) return valid;

        // Lücke: Übergang mit steigendem Offset, in den die Standortzeit fällt.
        for (var i = 1; i < transitions.Count; i++)
        {
            var before = transitions[i - 1].UtcOffsetMinutes;
            var t = transitions[i];
            if (t.UtcOffsetMinutes <= before) continue;
            var withBefore = wall.AddMinutes(-before);
            var withAfter = wall.AddMinutes(-t.UtcOffsetMinutes);
            if (withAfter < t.AtUtc && withBefore >= t.AtUtc) return withBefore;
        }
        // Außerhalb der Tabelle: mit dem letzten bekannten Offset.
        return wall.AddMinutes(-transitions[^1].UtcOffsetMinutes);
    }
}
