using System.Globalization;
using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Simulator;

/// <summary>Zeile einer Zielkarte: Filter mit Farbchip, verbleibend/heute, Mondprofil (roher Name), aktiv.</summary>
public sealed record CardLine(string Filter, string? Color, double ExposureS, int Need, int Tonight, string? MoonProfile, bool MoonMustBeDown,
    bool Enabled);

/// <summary>Flip-Kennzeichen einer Zielkarte („Flip 01:23 CDT (4 min)“, FA-SIM-06).</summary>
public sealed record CardFlip(string Time, int Minutes, bool InTransitWindow);

/// <summary>Prüfliste ✓/✗/⚠ der Zielkarte; Schlüssel <c>altitude</c>, <c>time</c>, <c>moon</c>, <c>darkness</c>, <c>rotation</c>.</summary>
public sealed record CardCheck(string Key, string State);

/// <summary>
/// Zielkarte (Schritt 2, FA-SIM-06) aus der Simulation des Servers: Zeitfenster in Standortzeit, zugeteilte Stunden,
/// Höhenbereich, kleinster Mondabstand, Zeilen, Prüfliste, Flips und Transit-Kasten. Sprachneutral; Texte ergänzt die
/// Oberfläche.
/// </summary>
public sealed record SimulatorCard(
    Guid ProjectId,
    string Name,
    int SeriesIndex,
    bool Transit,
    double AllocatedHours,
    string Window,
    string Altitude,
    string MoonSeparation,
    IReadOnlyList<CardLine> Lines,
    IReadOnlyList<CardCheck> Checks,
    IReadOnlyList<CardFlip> Flips);

/// <summary>Nicht zugeteiltes Projekt mit Diagnose-Codes (<c>diagnosticReasons</c>, FA-SIM-03).</summary>
public sealed record UnallocatedProject(Guid ProjectId, string Name, IReadOnlyList<string> Reasons);

public static class SimulatorCards
{
    private static string Deg(double v) => v.ToString("0", CultureInfo.InvariantCulture) + "°";

    public static IReadOnlyList<SimulatorCard> Build(NinaSimulation s, SiteTime site) =>
        s.Cards.Select(c => new SimulatorCard(
            c.ProjectId,
            c.Name,
            c.SeriesIndex,
            c.Transit,
            Math.Round(c.AllocatedS / 3600, 1),
            c.FromUtc is { } f && c.ToUtc is { } t ? $"{site.Clock(f)}–{site.ClockZone(t)}" : "",
            c.AltMinDeg is { } lo && c.AltMaxDeg is { } hi ? $"{lo.ToString("0", CultureInfo.InvariantCulture)}–{Deg(hi)}" : "",
            c.MoonSepMinDeg is { } m ? Deg(m) : "",
            c.Lines.Select(l => new CardLine(l.Filter, l.Color, l.ExposureS, l.Need, l.Tonight, l.Moon?.Name, l.Moon?.MustBeDown ?? false,
                l.Enabled)).ToList(),
            [
                new("altitude", Code(c.Checks.Altitude)),
                new("time", Code(c.Checks.Time)),
                new("moon", Code(c.Checks.Moon)),
                new("darkness", Code(c.Checks.Darkness)),
                new("rotation", Code(c.Checks.Rotation)),
            ],
            c.Flips.Select(x => new CardFlip(site.ClockZone(x.AtUtc), (int)Math.Round(x.DurationS / 60), x.InTransitWindow)).ToList()))
        .ToList();

    public static IReadOnlyList<UnallocatedProject> Unallocated(NinaSimulation s) =>
        s.Unallocated.Select(u => new UnallocatedProject(u.ProjectId, u.Name,
            u.Reasons.Select(r => LockedSettings.Code(r.Reason)).Distinct().ToList())).ToList();

    private static string Code(NinaSimulationCheck c) => LockedSettings.Code(c);

    /// <summary>✓ ok, ✗ fail, ⚠ warn, – none.</summary>
    public static string Symbol(string state) => state switch
    {
        "ok" => "✓",
        "fail" => "✗",
        "warn" => "⚠",
        _ => "–",
    };
}
