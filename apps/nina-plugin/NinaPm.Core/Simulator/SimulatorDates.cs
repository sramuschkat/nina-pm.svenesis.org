using System.Globalization;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Time;

namespace NinaPm.Core.Simulator;

/// <summary>
/// Datumsauswahl des Simulators (FA-NIN-18, FA-SIM-01): ◀ Nacht ▶ und <em>Heute Nacht</em> = <c>currentNight</c> aus der
/// Nacht-Tabelle des Bootstraps (Kap. 8.1, NT-01) – nur Nächte dieser Tabelle, dieselben, die der Server annimmt.
/// </summary>
public sealed class SimulatorDates(IReadOnlyList<NightRow> nights)
{
    public static SimulatorDates From(NinaBootstrap? bootstrap) =>
        new(bootstrap is null ? [] : NightCalendar.FromBootstrap(bootstrap));

    public bool Available => nights.Count > 0;

    /// <summary><em>Heute Nacht</em>; <c>null</c> ohne verwendbare Tabelle.</summary>
    public string? Tonight(DateTimeOffset now)
    {
        try
        {
            return NightCalendar.CurrentNight(nights, now);
        }
        catch (NightTableException)
        {
            return null;
        }
    }

    private int Index(string night) => nights.ToList().FindIndex(n => n.Night == night);

    public bool Contains(string night) => Index(night) >= 0;

    /// <summary>Vorige Nacht der Tabelle (nicht vor <c>currentNight</c>); am Anfang bleibt die Nacht.</summary>
    public string Previous(string night, DateTimeOffset now)
    {
        var i = Index(night);
        var first = Tonight(now) is { } t ? Math.Max(0, Index(t)) : 0;
        return i > first ? nights[i - 1].Night : night;
    }

    /// <summary>Nächste Nacht der Tabelle; am Ende bleibt die Nacht.</summary>
    public string Next(string night)
    {
        var i = Index(night);
        return i >= 0 && i + 1 < nights.Count ? nights[i + 1].Night : night;
    }

    public bool CanGoBack(string night, DateTimeOffset now) => Previous(night, now) != night;

    public bool CanGoForward(string night) => Next(night) != night;

    /// <summary>Doppeldatum wie in der Web-App (rules/ui.md): <c>2026-09-17</c> → „17./18.09.2026“.</summary>
    public static string Label(string night)
    {
        var d = DateOnly.ParseExact(night, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var n = d.AddDays(1);
        return d.Month == n.Month
            ? $"{d:dd}./{n:dd}.{n:MM}.{n:yyyy}"
            : $"{d:dd}.{d:MM}./{n:dd}.{n:MM}.{n:yyyy}";
    }
}
