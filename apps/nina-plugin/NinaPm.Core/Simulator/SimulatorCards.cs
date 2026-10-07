using System.Globalization;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Status;

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

/// <summary>Stand eines Projekts ohne Zielkarte in der Rechnung ab jetzt (wie die Web-Zielkarten, PR #301).</summary>
public enum UnallocatedState
{
    /// <summary>Nicht zugeteilt (Diagnose-Codes).</summary>
    None,

    /// <summary>Die Rig arbeitet noch daran: offener Block im gespeicherten Plan bzw. laufender Block im Nachtjournal.</summary>
    RunningAtRig,

    /// <summary>Heute Nacht belichtet, aber nicht mehr geplant (fertig, pausiert, Transit vorbei) – blass.</summary>
    DoneTonight,
}

/// <summary>Nicht zugeteiltes Projekt mit Diagnose-Codes (<c>diagnosticReasons</c>, FA-SIM-03) und Stand an der Rig.</summary>
public sealed record UnallocatedProject(Guid ProjectId, string Name, IReadOnlyList<string> Reasons, UnallocatedState State = UnallocatedState.None);

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

    /// <summary>
    /// Nicht zugeteilte Projekte der Rechnung ab jetzt. Mit den lokalen Daten der Nacht (<paramref name="local"/>:
    /// gespeicherter Plan und Nachtjournal, Plugin 0.4.18) wie im Web (PR #301): Projekte mit offenem Block im gespeicherten
    /// Plan bzw. laufendem Block „Läuft an der Rig“, heute Nacht belichtete, nicht mehr geplante „Heute Nacht abgearbeitet“
    /// (auch wenn der Server sie gar nicht mehr als nicht zugeteilt führt). Laufendes zuerst, dann Abgearbeitetes, dann der Rest.
    /// </summary>
    public static IReadOnlyList<UnallocatedProject> Unallocated(NinaSimulation s, NightViewInputs? local = null)
    {
        var list = s.Unallocated.Select(u => new UnallocatedProject(u.ProjectId, u.Name,
            u.Reasons.Select(r => LockedSettings.Code(r.Reason)).Distinct().ToList())).ToList();
        if (local is null || local.Night != s.Night) return list;
        var planned = s.Cards.Select(c => c.ProjectId).ToHashSet();
        var running = new HashSet<Guid>();
        if (local.Running is { } r) running.Add(r.Block.ProjectId);
        if (local.Plan?.Night == s.Night)
            foreach (var b in local.Plan.Blocks.Where(b => b.EndUtc > local.Now && !local.Done.Contains(b.Id)))
                running.Add(b.ProjectId);
        var captured = local.Journal.Where(e => e.Kind == JournalKinds.Capture && e.Data.Result == "saved" && e.Data.ProjectId is not null)
            .Select(e => e.Data.ProjectId!.Value).ToHashSet();
        UnallocatedState StateOf(Guid id) => running.Contains(id) ? UnallocatedState.RunningAtRig
            : captured.Contains(id) ? UnallocatedState.DoneTonight
            : UnallocatedState.None;
        list = [.. list.Select(u => u with { State = StateOf(u.ProjectId) })];
        // Belichtete bzw. gerade laufende Projekte, die der Server weder zuteilt noch als nicht zugeteilt führt.
        var known = list.Select(u => u.ProjectId).Concat(planned).ToHashSet();
        foreach (var id in captured.Concat(local.Running is { } rb ? [rb.Block.ProjectId] : []).Distinct().Where(id => !known.Contains(id)))
        {
            var name = local.Targets?.Projects.FirstOrDefault(p => p.Id == id)?.Name
                ?? local.Journal.LastOrDefault(e => e.Data.ProjectId == id && !string.IsNullOrEmpty(e.Data.Title))?.Data.Title
                ?? id.ToString();
            list.Add(new UnallocatedProject(id, name, [], StateOf(id)));
        }
        return [.. list.Select((u, n) => (u, n)).OrderBy(x => x.u.State switch
        {
            UnallocatedState.RunningAtRig => 0,
            UnallocatedState.DoneTonight => 1,
            _ => 2,
        }).ThenBy(x => x.n).Select(x => x.u)];
    }

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
