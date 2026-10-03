using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Execution;

/// <summary>
/// SiteCheck (execution.md §2, §6; NT-05, NT-06, NT-22): PC-Zeitzone gegen Standortzone, Standort und Sternzeit der
/// Montierung gegen den Rig-Standort. Die Uhrabweichung prüft der Heartbeat (<c>NightLoop.ClockChecked</c>).
/// </summary>
public static class SiteCheck
{
    /// <summary>LST-Abweichung der Montierung, ab der <c>mount_site_mismatch</c> gilt (NT-22).</summary>
    public const double MaxSiderealDeltaS = 60;

    /// <summary>Standort-Offset zu <paramref name="nowUtc"/> aus <c>bootstrap.timeZoneTransitions</c> (letzter Übergang ≤ jetzt).</summary>
    public static TimeSpan? SiteOffset(NinaBootstrap bootstrap, DateTimeOffset nowUtc)
    {
        var transitions = bootstrap.TimeZoneTransitions.OrderBy(t => t.AtUtc).ToList();
        if (transitions.Count == 0) return null;
        var current = transitions.LastOrDefault(t => t.AtUtc <= nowUtc) ?? transitions[0];
        return TimeSpan.FromMinutes(current.UtcOffsetMinutes);
    }

    /// <summary><c>pc_timezone_differs</c>: Offset der PC-Zone ≠ Standort-Offset jetzt.</summary>
    public static bool TimezoneDiffers(TimeSpan pcOffset, TimeSpan siteOffset) => pcOffset != siteOffset;

    /// <summary>Meldetext mit Folge und Empfehlung (L3), Standortzone aus dem Bootstrap.</summary>
    public static string TimezoneMessage(TimeSpan pcOffset, TimeSpan siteOffset, string siteZone) =>
        $"Windows-Zeitzone des NINA-PCs (UTC{Format(pcOffset)}) weicht von der Standortzone {siteZone} (UTC{Format(siteOffset)}) ab: "
        + "Datums-Platzhalter wie $$DATEMINUS12$$ und $$DATE$$ wechseln nach der PC-Zone – die Aufnahmen einer Nacht können in "
        + "zwei Datumsordnern landen, die nicht zum Nacht-Schlüssel passen. Empfehlung: Windows-Zeitzone = Standortzone. "
        + "Nacht, Blockzeiten und NINA-PM-Zeitangaben gelten unabhängig davon in Standortzeit.";

    private static string Format(TimeSpan o) => $"{(o < TimeSpan.Zero ? "-" : "+")}{o.Duration():hh\\:mm}";

    /// <summary>
    /// <c>mount_site_mismatch</c>: Montierungsstandort mehr als <see cref="Geo.SiteWarnKm"/> vom Rig-Standort entfernt oder
    /// Sternzeit der Montierung &gt; 60 s neben der berechneten LST (NT-22). Ohne Montierung keine Prüfung.
    /// </summary>
    public static bool MountSiteMismatch(double? mountLatDeg, double? mountLonDeg, double? siderealDeltaS, double siteLatDeg, double siteLonDeg)
    {
        if (mountLatDeg is { } lat && mountLonDeg is { } lon && Geo.DistanceKm(lat, lon, siteLatDeg, siteLonDeg) > Geo.SiteWarnKm) return true;
        return siderealDeltaS is { } d && Math.Abs(d) > MaxSiderealDeltaS;
    }
}
