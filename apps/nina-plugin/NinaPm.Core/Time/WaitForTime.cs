namespace NinaPm.Core.Time;

/// <summary>Quelle von <em>NINA-PM Warten auf Zeit</em> (FA-NIN-26): feste Uhrzeit oder Abenddämmerung.</summary>
public enum WaitSource
{
    /// <summary>Uhrzeit in Standortzeit.</summary>
    Time,

    /// <summary>Bürgerliche Abenddämmerung (Sonne −6°).</summary>
    CivilDusk,

    /// <summary>Nautische Abenddämmerung (Sonne −12°).</summary>
    NauticalDusk,

    /// <summary>Astronomische Abenddämmerung (Sonne −18°).</summary>
    AstronomicalDusk,
}

/// <summary>
/// Einstellungen von <em>Warten auf Zeit</em>: Quelle, Uhrzeit (nur <see cref="WaitSource.Time"/>), Versatz in Minuten
/// und Tageswechsel-Zeit (Standard lokaler Mittag wie die Nacht-Definition, FK 8.1).
/// </summary>
public sealed record WaitForTimeSpec(
    WaitSource Source,
    TimeOnly Time,
    int OffsetMinutes = 0,
    TimeOnly? Rollover = null)
{
    public static readonly TimeOnly Noon = new(12, 0);

    public TimeOnly RolloverTime => Rollover ?? Noon;

    /// <summary>Tageswechsel weicht vom lokalen Mittag ab → Hinweis in der Anweisung (FA-NIN-26).</summary>
    public bool RolloverDiffersFromNoon => RolloverTime != Noon;
}

/// <summary>Ergebnis: Zielzeitpunkt (UTC) für die Nacht <see cref="Night"/>; <c>null</c>, wenn die Quelle in dieser Nacht fehlt (Polartag).</summary>
public sealed record WaitTarget(string Night, DateTimeOffset? UntilUtc);

/// <summary>
/// <em>NINA-PM Warten auf Zeit</em> (AP-52, FA-NIN-26, execution.md §1). Muster nach dem Astro-PM-Plugin (MIT),
/// <c>Instructions/AstroPMWaitForTime.cs</c>, Commit 5dd621d: Zielzeit je Ausführung neu für die aktuelle Nacht bestimmen
/// (nie eine Zeit aus einer früheren Nacht, die als „vorbei“ gälte), Tageswechsel-Zeit, Versatz. Abweichend vom Original:
/// <list type="bullet">
/// <item>Nacht über <c>currentNight</c> aus der Tabelle des Servers (NT-01); ist sie schon beendet (Tagesschleife), gilt
/// die folgende Nacht.</item>
/// <item>Uhrzeiten in **Standortzeit** über <see cref="SiteClock"/> mit L2, nie in der Windows-Zone des PCs (NT-06).</item>
/// <item>Dämmerungen aus dem Bootstrap (Server-Engine), keine eigene Astronomie (H1).</item>
/// <item>Uhrzeit vor der Tageswechsel-Zeit (z. B. 01:30) gehört zum Morgen nach dem Abend des Nacht-Schlüssels.</item>
/// </list>
/// </summary>
public static class WaitForTime
{
    /// <summary>
    /// Nacht, auf die gewartet wird: <c>currentNight(now)</c>; ist genau diese Nacht schon beendet
    /// (<paramref name="finishedNight"/>, Tagesschleife am Morgen vor dem Nachtfensterende), die folgende.
    /// </summary>
    public static NightRow TargetRow(IReadOnlyList<NightRow> nights, DateTimeOffset now, string? finishedNight)
    {
        var row = NightCalendar.CurrentRow(nights, now);
        // Start am Morgen nach der Dunkelheit, aber vor dem Nachtfensterende (z. B. NINA startet um 06:00): currentNight ist
        // noch die alte Nacht, deren Abenddämmerung vorbei ist – ohne diese Regel ginge es sofort weiter, und die Sequenz
        // entparkte im Morgengrauen (Analyse 04.10.2026). Dann gilt die folgende Nacht.
        var darknessOver = row.Twilight is { } tw
            && (tw.Astronomical.DawnUtc ?? tw.Nautical.DawnUtc ?? tw.Civil.DawnUtc) is { } dawn && now >= dawn;
        if ((finishedNight is null || row.Night != finishedNight) && !darknessOver) return row;
        var index = nights.ToList().FindIndex(n => n.Night == row.Night);
        if (index < 0 || index + 1 >= nights.Count) throw new NightTableException("Folgenacht fehlt in der Nacht-Tabelle");
        return nights[index + 1];
    }

    /// <summary>Zielzeitpunkt für die Nacht <paramref name="row"/> (vor dem Versatz bei fehlender Dämmerung <c>null</c>).</summary>
    public static WaitTarget Target(WaitForTimeSpec spec, NightRow row, SiteClock site)
    {
        DateTimeOffset? at = spec.Source switch
        {
            WaitSource.Time => ClockTime(spec, row, site),
            WaitSource.CivilDusk => row.Twilight?.Civil.DuskUtc,
            WaitSource.NauticalDusk => row.Twilight?.Nautical.DuskUtc,
            WaitSource.AstronomicalDusk => row.Twilight?.Astronomical.DuskUtc,
            _ => null,
        };
        return new WaitTarget(row.Night, at?.AddMinutes(spec.OffsetMinutes));
    }

    public static WaitTarget Target(WaitForTimeSpec spec, IReadOnlyList<NightRow> nights, SiteClock site, DateTimeOffset now,
        string? finishedNight) =>
        Target(spec, TargetRow(nights, now, finishedNight), site);

    /// <summary>Uhrzeit ab der Tageswechsel-Zeit am Abenddatum des Nacht-Schlüssels, davor am Folgetag (L2 über <see cref="SiteClock"/>).</summary>
    private static DateTimeOffset ClockTime(WaitForTimeSpec spec, NightRow row, SiteClock site)
    {
        var evening = DateOnly.ParseExact(row.Night, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var date = spec.Time >= spec.RolloverTime ? evening : evening.AddDays(1);
        return site.ToUtc(date, spec.Time);
    }

    /// <summary>Verbleibende Wartezeit (0, wenn der Zeitpunkt vorbei ist oder fehlt).</summary>
    public static TimeSpan Remaining(WaitTarget target, DateTimeOffset now) =>
        target.UntilUtc is { } until && until > now ? until - now : TimeSpan.Zero;
}
