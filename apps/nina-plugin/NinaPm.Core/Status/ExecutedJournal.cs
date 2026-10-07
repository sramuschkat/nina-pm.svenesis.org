using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Status;

/// <summary>
/// Ist vom Server (<c>NinaSimulation.executed</c>, AP-53c) als Einträge des Nachtjournals, damit Plugin-Simulator und
/// Fenster im Imaging-Reiter es mit <see cref="NightViewBuilder"/> wie das lokale Journal zeichnen: Blöcke als
/// Start/Ende, Filterabschnitte als zusammengefasste Aufnahmen (<see cref="JournalData.Count"/>), Lücken aus leeren
/// Blöcken als ein leerer Block mit Anzahl, Ereignisse (Flip, Übersprungenes, Safety, Planwechsel, Flats).
/// </summary>
public static class ExecutedJournal
{
    public static IReadOnlyList<JournalEntry> From(ExecutedNight? executed)
    {
        if (executed is null) return [];
        var list = new List<(DateTimeOffset At, string Kind, JournalData Data)>();
        foreach (var b in executed.Blocks)
        {
            var transit = b.Kind == ExecutedBlockKind.Transit;
            list.Add((b.StartUtc, JournalKinds.BlockStart, new JournalData
            {
                PlanId = b.NightPlanId, BlockId = b.BlockId, ProjectId = b.ProjectId, PanelId = b.PanelId, Title = b.Title, Transit = transit,
            }));
            if (!b.Running && b.EndUtc is { } end)
                list.Add((end, JournalKinds.BlockEnd, new JournalData
                {
                    BlockId = b.BlockId, ProjectId = b.ProjectId, Reason = b.EndReason, Exposures = b.Exposures,
                }));
        }
        foreach (var g in executed.Gaps.Where(g => g.Kind == ExecutedGapKind.Empty_blocks))
        {
            var id = Guid.NewGuid();
            list.Add((g.FromUtc, JournalKinds.BlockStart, new JournalData { BlockId = id, Title = "" }));
            list.Add((g.ToUtc, JournalKinds.BlockEnd, new JournalData { BlockId = id, Reason = g.Reason, Exposures = 0, Count = g.Count }));
        }
        foreach (var s in executed.Segments)
        {
            void Add(string result, int count)
            {
                if (count > 0)
                    list.Add((s.EndUtc, JournalKinds.Capture, new JournalData
                    {
                        BlockId = s.BlockId, ProjectId = s.ProjectId, Filter = s.Filter, ExposureS = s.ExposureS, StartUtc = s.StartUtc,
                        Result = result, Count = count,
                    }));
            }
            Add("saved", s.Saved);
            Add("failed", s.Failed);
        }
        foreach (var e in executed.Events)
        {
            var entry = e.Kind switch
            {
                ExecutedEventKind.Flip => (JournalKinds.Flip, new JournalData { BlockId = e.BlockId, DurationS = e.DurationS }),
                ExecutedEventKind.Skipped_timeaware => (JournalKinds.Skipped, new JournalData { BlockId = e.BlockId, ProjectId = e.ProjectId, Reason = e.Code ?? "late" }),
                ExecutedEventKind.Block_skipped => (JournalKinds.BlockSkipped, new JournalData { BlockId = e.BlockId, ProjectId = e.ProjectId, Reason = e.Code }),
                ExecutedEventKind.Safety_pause => (JournalKinds.SafetyPause, new JournalData()),
                ExecutedEventKind.Safety_resume => (JournalKinds.SafetyResume, new JournalData()),
                ExecutedEventKind.Plan_built or ExecutedEventKind.Plan_rebuilt => (JournalKinds.Plan, new JournalData { Revision = e.Revision, Reason = e.Code }),
                ExecutedEventKind.Flats_start => (JournalKinds.FlatsStart, new JournalData()),
                ExecutedEventKind.Flats_end => (JournalKinds.FlatsEnd, new JournalData()),
                _ => ((string, JournalData)?)null,
            };
            if (entry is { } x) list.Add((e.AtUtc, x.Item1, x.Item2));
        }
        // Aufnahme-Abschnitte stehen am Abschnittsende – nach Zeit ordnen, gleiche Zeit in Einfügereihenfolge.
        return [.. list.Select((x, n) => (x, n)).OrderBy(p => p.x.At).ThenBy(p => p.n)
            .Select((p, n) => new JournalEntry(-(n + 1), p.x.At, p.x.Kind, p.x.Data))];
    }

    /// <summary>
    /// Lokales Journal (vollständig, frisch) ergänzt um das Server-Ist vor seinem ersten Eintrag – z. B. nach einer
    /// Neuinstallation oder einem Update mitten in der Nacht. Ohne lokales Journal gilt das Server-Ist.
    /// </summary>
    public static IReadOnlyList<JournalEntry> Merge(IReadOnlyList<JournalEntry> local, IReadOnlyList<JournalEntry> server)
    {
        if (server.Count == 0) return local;
        if (local.Count == 0) return server;
        var first = local.Min(e => e.AtUtc);
        return [.. server.Where(e => e.AtUtc < first), .. local];
    }
}
