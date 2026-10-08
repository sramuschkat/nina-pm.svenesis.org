using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Simulator;
using NinaPm.Core.Targets;

namespace NinaPm.Core.Status;

/// <summary>Spalte „Ist“ einer Protokollzeile (AP-53b): ✓ gespeichert, ↷ übersprungen, ✕ fehlgeschlagen, ▶ läuft, ○ geplant.</summary>
public enum ActualState
{
    /// <summary>Erledigt ohne Aufnahme (Anfahren, Flip).</summary>
    Done,
    Saved,
    Skipped,
    Failed,
    Running,
    Planned,

    /// <summary>Lücke im Erledigten (Leerlauf, Safety, leere Blöcke).</summary>
    Gap,
}

/// <summary>
/// Zeile des Protokoll-Fensters: Zeit, Ist mit Grund (Code), Befehl (Code wie im Planprotokoll, dazu <c>block_skipped</c>,
/// <c>gap</c>, <c>flats</c>), Ziel und Kamerawerte. <see cref="Past"/> = vor jetzt (blass), <see cref="Current"/> = läuft.
/// </summary>
public sealed record NightLogRow(
    DateTimeOffset AtUtc,
    ActualState State,
    string? Reason,
    bool Past,
    bool Current,
    string Cmd,
    string Target,
    string Panel,
    int? No,
    string Filter,
    double? ExposureS,
    int? Gain,
    int? Offset,
    int? Binning,
    string? Readout,
    double? RotationDeg,
    double? RaDeg,
    double? DecDeg,
    double? AltDeg)
{
    /// <summary>Belichtung (Filter „Nur Belichtungen“).</summary>
    public bool IsExposure => Cmd is "expose" or "expose_series";

    /// <summary>Anzahl zusammengefasster Einträge (Lücke aus leeren Blöcken, Transit-Serie).</summary>
    public int Count { get; init; } = 1;

    /// <summary>Dauer in s (Flip, Lücke), sonst leer.</summary>
    public double? DurationS { get; init; }

    /// <summary>Fortschritt der laufenden Belichtung 0…1.</summary>
    public double? Progress { get; init; }
}

/// <summary>Zeile der Blockliste „Heutige Ziele“ im schmalen Fenster.</summary>
public sealed record NightBlockRow(string Title, DateTimeOffset StartUtc, DateTimeOffset? EndUtc, ActualState State, bool Transit, bool Flats = false);

/// <summary>Laufende Belichtung: Nr. <see cref="Index"/> von <see cref="Count"/> (Serie ohne Zahl), Restzeit.</summary>
public sealed record ExposureProgress(int Index, int? Count, double ExposureS, TimeSpan Remaining, double Fraction);

/// <summary>Was als Nächstes kommt: nächster Block oder Flats ab Nachtende.</summary>
public sealed record NextUp(string Title, DateTimeOffset AtUtc, bool Flats);

/// <summary>Fenster „NINA-PM“ und „NINA-PM Protokoll“ (AP-53b): Grafik, Protokoll, Blockliste, Fortschritt, Zähler, Fußzeile.</summary>
public sealed record NightView(
    string Night,
    PlanChart? Chart,
    IReadOnlyList<NightLogRow> Rows,
    IReadOnlyList<NightBlockRow> Blocks,
    ExposureProgress? Progress,
    NextUp? Next,
    int Saved,
    int Skipped,
    int Failed,
    Guid? PlanId,
    int? Revision,
    string? PlanReason,
    DateTimeOffset? PlanAtUtc)
{
    /// <summary>
    /// Was der laufende Block außerhalb einer Belichtung tut (Warten, Flip, Zentrieren; Plugin 0.4.18) – die Statuszeile zeigt
    /// es statt einer Belichtung; ohne laufenden Block bzw. während einer Belichtung <c>null</c>.
    /// </summary>
    public BlockActivity? Activity { get; init; }
}

/// <summary>Eingaben der Fenster (vom <c>NightRunner</c> gesammelt, in Tests frei gesetzt).</summary>
public sealed record NightViewInputs(
    string Night,
    IReadOnlyList<JournalEntry> Journal,
    NinaPlanResponse? Plan,
    IReadOnlySet<Guid> Done,
    (Blocks Block, DateTimeOffset StartedUtc)? Running,
    Entries? CurrentEntry,
    DateTimeOffset? CurrentEntryStartedUtc,
    NinaTargets? Targets,
    NinaBootstrap? Bootstrap,
    NinaSimulation? Simulation,
    SiteTime Site,
    DateTimeOffset Now,
    bool FlatsRunning = false,
    BlockActivity? Activity = null,
    Entries? LastEntry = null,
    IReadOnlyDictionary<int, EntryOutcome>? Outcomes = null);

/// <summary>
/// Aufbau der Fenster im Imaging-Reiter (AP-53b, execution.md §10) aus zwei Quellen: **bis jetzt** das Nachtjournal
/// (<see cref="NightJournal"/>: Blöcke, Aufnahmen, Übersprungenes, Flip, Safety), **ab jetzt** der gespeicherte Plan der
/// Nacht – der nach einer Neuplanung erst bei „jetzt“ beginnt. Erledigtes ist blass, Geplantes kräftig; Lücken zwischen
/// erledigten Blöcken sind schraffiert mit Grund. Dämmerung, Höhenkurven und Mond kommen aus der Simulation des Servers,
/// ohne sie zeigt die Grafik die Blöcke ohne Kurven. Rechnet nichts Astronomisches selbst (Regel 14).
/// </summary>
public static class NightViewBuilder
{
    /// <summary>Kürzere Pausen zwischen Blöcken (Anfahren, Speichern) gelten nicht als Lücke.</summary>
    public static readonly TimeSpan GapMin = TimeSpan.FromMinutes(2);

    /// <summary>Leere Blöcke, die so dicht aufeinander folgen, bilden eine Lücke.</summary>
    public static readonly TimeSpan EmptyMergeMax = TimeSpan.FromMinutes(2);

    /// <summary>Aufnahmen mit größerem Abstand bilden einen neuen Filterabschnitt.</summary>
    public static readonly TimeSpan BarSplit = TimeSpan.FromMinutes(15);

    private sealed class PastBlock
    {
        public required Guid BlockId;
        public required Guid ProjectId;
        public required string Title;
        public required bool Transit;
        public required DateTimeOffset Start;
        public DateTimeOffset? End;
        public string? Reason;
        public int Exposures;

        /// <summary>Anzahl zusammengefasster leerer Blöcke (Server-Ist, AP-53c), sonst 1.</summary>
        public int Count = 1;
        public bool Running;
    }

    public static NightView Build(NightViewInputs i)
    {
        var now = i.Now;
        var site = i.Site;
        var plan = i.Plan?.Night == i.Night ? i.Plan : null;
        var sim = i.Simulation?.Night == i.Night ? i.Simulation : null;
        var journal = i.Journal;
        var running = i.Running;

        // ---- Erledigtes aus dem Journal ----
        var past = new List<PastBlock>();
        var open = new Dictionary<Guid, PastBlock>();
        foreach (var e in journal)
        {
            var d = e.Data;
            switch (e.Kind)
            {
                case JournalKinds.BlockStart when d.BlockId is { } id:
                    var b = new PastBlock
                    {
                        BlockId = id, ProjectId = d.ProjectId ?? Guid.Empty, Title = d.Title ?? "", Transit = d.Transit ?? false, Start = e.AtUtc,
                    };
                    past.Add(b);
                    open[id] = b;
                    break;
                case JournalKinds.BlockEnd when d.BlockId is { } id && open.Remove(id, out var ended):
                    ended.End = e.AtUtc;
                    ended.Reason = d.Reason;
                    ended.Exposures = d.Exposures ?? ended.Exposures;
                    ended.Count = d.Count ?? 1;
                    break;
                case JournalKinds.Capture when d.BlockId is { } id && d.Result == "saved" && open.TryGetValue(id, out var withCapture):
                    withCapture.Exposures += d.Count ?? 1;
                    break;
            }
        }
        foreach (var b in open.Values)
        {
            if (running is { } r && r.Block.Id == b.BlockId) b.Running = true;
            else
            {
                // Ohne Blockende (Neustart mitten im Block): bis zum letzten Eintrag des Blocks.
                b.End = journal.Where(e => e.Data.BlockId == b.BlockId).Select(e => e.AtUtc).DefaultIfEmpty(b.Start).Max();
            }
        }

        // Zielfarben: aus der Simulation, sonst in der Reihenfolge des Auftretens.
        var series = new Dictionary<Guid, int>();
        foreach (var t in sim?.Targets ?? []) series[t.ProjectId] = t.SeriesIndex;
        var nextSeries = series.Count == 0 ? 0 : series.Values.Max() + 1;
        int Series(Guid project)
        {
            if (!series.TryGetValue(project, out var idx)) series[project] = idx = nextSeries++;
            return idx;
        }

        string TitleOf(Blocks block) => TargetTitle.For(block, i.Targets);

        var filterColors = (i.Bootstrap?.Rig.Filters ?? []).GroupBy(f => f.ShortName).ToDictionary(g => g.Key, g => g.First().Color);
        string? ColorOf(string? filter) => filter is not null && filterColors.TryGetValue(filter, out var c) ? c : null;

        // ---- Zeitachse ----
        DateTimeOffset start, end;
        NinaSimulationDarkness darkness;
        if (plan is not null)
        {
            start = plan.NightWindow.StartUtc;
            end = plan.NightWindow.EndUtc;
            darkness = new NinaSimulationDarkness
            {
                CivilStartUtc = plan.Darkness.CivilStartUtc,
                CivilEndUtc = plan.Darkness.CivilEndUtc,
                NauticalStartUtc = plan.Darkness.NauticalStartUtc,
                NauticalEndUtc = plan.Darkness.NauticalEndUtc,
                AstronomicalStartUtc = plan.Darkness.AstronomicalStartUtc,
                AstronomicalEndUtc = plan.Darkness.AstronomicalEndUtc,
            };
        }
        else if (sim is not null)
        {
            start = sim.NightWindow.StartUtc;
            end = sim.NightWindow.EndUtc;
            darkness = sim.Darkness;
        }
        else if (past.Count > 0)
        {
            start = past.Min(p => p.Start);
            end = past.Max(p => p.End ?? now);
            darkness = new NinaSimulationDarkness();
        }
        else
        {
            start = end = now;
            darkness = new NinaSimulationDarkness();
        }

        PlanChart? chart = null;
        var gaps = new List<ChartGap>();
        var chartBlocks = new List<ChartBlock>();
        var bars = new List<ChartFilterBar>();
        var flips = new List<ChartMarker>();
        var frame = end > start
            ? sim is not null ? PlanChart.Build(sim, site, now) with { Blocks = [], FilterBars = [], Flips = [] } : PlanChart.Frame(start, end, darkness, site, now)
            : null;
        string Window(DateTimeOffset a, DateTimeOffset b) => $"{site.Clock(a)}–{site.ClockZone(b)}";

        // Leere Blöcke (ohne Belichtung, z. B. transit_interrupt) zu Lücken zusammenfassen, die übrigen als Blöcke.
        var closed = past.Where(p => !p.Running).OrderBy(p => p.Start).ToList();
        var full = new List<PastBlock>();
        var gapRuns = new List<(DateTimeOffset From, DateTimeOffset To, string? Reason, int Count)>();
        foreach (var p in closed)
        {
            if (p.Exposures > 0)
            {
                full.Add(p);
                continue;
            }
            var to = p.End ?? p.Start;
            if (gapRuns.Count > 0 && p.Start - gapRuns[^1].To <= EmptyMergeMax && gapRuns[^1].Reason == p.Reason)
                gapRuns[^1] = (gapRuns[^1].From, to, p.Reason, gapRuns[^1].Count + p.Count);
            else gapRuns.Add((p.Start, to, p.Reason, p.Count));
        }
        var emptyGaps = gapRuns.Where(g => g.Count > 1 || g.To - g.From >= GapMin).ToList();

        var safety = journal.Where(e => e.Kind == JournalKinds.SafetyPause).Select(e => e.AtUtc).ToList();
        var skippedBlocks = journal.Where(e => e.Kind == JournalKinds.BlockSkipped).ToList();
        var flipsDone = journal.Where(e => e.Kind == JournalKinds.Flip).ToList();

        if (frame is not null)
        {
            foreach (var p in full)
            {
                var to = p.End ?? p.Start;
                chartBlocks.Add(new ChartBlock(frame.At(p.Start), frame.Span(p.Start, to), p.Title, Series(p.ProjectId), p.Transit, Window(p.Start, to))
                {
                    Tense = ChartTense.Past,
                });
            }
            if (past.FirstOrDefault(p => p.Running) is { } run)
                chartBlocks.Add(new ChartBlock(frame.At(run.Start), frame.Span(run.Start, now), run.Title, Series(run.ProjectId), run.Transit,
                    Window(run.Start, now)) { Tense = ChartTense.Past });

            foreach (var g in emptyGaps)
                gaps.Add(new ChartGap(frame.At(g.From), frame.Span(g.From, g.To), ChartGapKind.EmptyBlocks, g.Reason, g.Count, Window(g.From, g.To)));

            // Leerlauf zwischen erledigten Blöcken (ohne die schon erfassten leeren Blöcke).
            var spans = full.Select(p => (From: p.Start, To: p.End ?? p.Start))
                .Concat(emptyGaps.Select(g => (g.From, g.To)))
                .Concat(past.Where(p => p.Running).Select(p => (From: p.Start, To: now)))
                .OrderBy(x => x.From).ToList();
            for (var k = 1; k < spans.Count; k++)
            {
                var from = spans[k - 1].To;
                var to = spans[k].From;
                if (to - from < GapMin) continue;
                var kind = safety.Any(t => t >= from && t <= to) ? ChartGapKind.Safety
                    : skippedBlocks.Any(e => e.AtUtc >= from && e.AtUtc <= to) ? ChartGapKind.Skipped
                    : ChartGapKind.Idle;
                var reason = kind == ChartGapKind.Skipped ? skippedBlocks.Last(e => e.AtUtc >= from && e.AtUtc <= to).Data.Reason : null;
                var count = kind == ChartGapKind.Skipped ? skippedBlocks.Count(e => e.AtUtc >= from && e.AtUtc <= to) : 1;
                gaps.Add(new ChartGap(frame.At(from), frame.Span(from, to), kind, reason, count, Window(from, to)));
            }
            foreach (var f in flipsDone)
            {
                var from = f.AtUtc.AddSeconds(-(f.Data.DurationS ?? 0));
                gaps.Add(new ChartGap(frame.At(from), frame.Span(from, f.AtUtc), ChartGapKind.Flip, null, 1, Window(from, f.AtUtc)));
            }

            // Filterabschnitte der gespeicherten Aufnahmen: gleicher Block und Filter, ohne große Pause.
            var captures = journal.Where(e => e.Kind == JournalKinds.Capture && e.Data.Result == "saved").ToList();
            (Guid? Block, string? Filter, DateTimeOffset From, DateTimeOffset To, int Count)? bar = null;
            void Flush()
            {
                if (bar is { } x)
                    bars.Add(new ChartFilterBar(frame.At(x.From), frame.Span(x.From, x.To), $"{x.Filter} ×{x.Count}", ColorOf(x.Filter)) { Tense = ChartTense.Past });
                bar = null;
            }
            foreach (var c in captures)
            {
                var from = c.Data.StartUtc ?? c.AtUtc.AddSeconds(-(c.Data.ExposureS ?? 0));
                if (bar is { } x && x.Block == c.Data.BlockId && x.Filter == c.Data.Filter && from - x.To <= BarSplit)
                    bar = (x.Block, x.Filter, x.From, c.AtUtc, x.Count + (c.Data.Count ?? 1));
                else
                {
                    Flush();
                    bar = (c.Data.BlockId, c.Data.Filter, from, c.AtUtc, c.Data.Count ?? 1);
                }
            }
            Flush();
        }

        // ---- Kommendes aus dem gespeicherten Plan ----
        var future = (plan?.Blocks ?? [])
            .Where(b => b.EndUtc > now && (running?.Block.Id == b.Id || !i.Done.Contains(b.Id)))
            .OrderBy(b => b.StartUtc)
            .ToList();
        if (frame is not null)
        {
            foreach (var b in future)
            {
                var from = running?.Block.Id == b.Id ? now : Max(b.StartUtc, now);
                chartBlocks.Add(new ChartBlock(frame.At(from), frame.Span(from, b.EndUtc), TitleOf(b), Series(b.ProjectId), b.Kind == BlocksKind.Transit,
                    Window(b.StartUtc, b.EndUtc)) { Tense = ChartTense.Planned });
                foreach (var (from2, to2, filter, count) in PlannedBars(b, now))
                    bars.Add(new ChartFilterBar(frame.At(from2), frame.Span(from2, to2), $"{filter} ×{count}", ColorOf(filter)) { Tense = ChartTense.Planned });
                foreach (var f in b.Entries.Where(e => e.Cmd == EntriesCmd.Meridian_flip && e.AtUtc > now))
                    flips.Add(new ChartMarker(frame.At(f.AtUtc), $"Flip {site.Clock(f.AtUtc)}"));
            }
            chart = frame with { Blocks = chartBlocks, FilterBars = bars, Flips = flips, Gaps = gaps };
        }

        // ---- Protokoll ----
        double? Alt(Guid project, DateTimeOffset at) => sim?.Targets.FirstOrDefault(t => t.ProjectId == project) is { } t ? Interpolate(t.Altitude, at) : null;
        var titles = past.GroupBy(p => p.BlockId).ToDictionary(g => g.Key, g => g.First().Title);
        foreach (var b in plan?.Blocks ?? []) titles.TryAdd(b.Id, TitleOf(b));
        string Title(JournalData d) => d.BlockId is { } id && titles.TryGetValue(id, out var t) ? t : d.Title ?? "";
        string PanelName(Guid project, Guid? panel) =>
            panel is { } pid && i.Targets?.Projects.FirstOrDefault(p => p.Id == project) is { Panels.Count: > 1 } pr
                ? pr.Panels.FirstOrDefault(x => x.Id == pid)?.Label ?? "" : "";

        var rows = new List<NightLogRow>();
        var saved = 0;
        var skipped = 0;
        var failed = 0;
        var transitBlocks = past.Where(p => p.Transit).Select(p => p.BlockId).ToHashSet();
        // Nr. wie im Simulator (simulation-view.ts): laufende Belichtungsnummer je Belichtungszeile – im Journal gezählt nur
        // gespeicherte Aufnahmen, im Plan weitergezählt (Plugin 0.4.18: vorher je Projekt|Filter mit fehlgeschlagenen
        // gegenüber je Zeile im Plan, die Nummern sprangen). Ohne Zeilen-ID (Server-Ist, ältere Einträge) über die Ziele
        // (Projekt, Panel, Filter, Belichtung) zugeordnet, sonst je Projekt|Filter; Transit-Serien ohne Nummer.
        var numbers = new Dictionary<string, int>(StringComparer.Ordinal);
        int? Next(string key, bool series)
        {
            if (series) return null;
            numbers[key] = (numbers.TryGetValue(key, out var n) ? n : 0) + 1;
            return numbers[key];
        }
        string LineKey(Guid project, Guid? panel, string? filter, double? exposureS, Guid? lineId)
        {
            if (lineId is { } id) return id.ToString();
            var lines = i.Targets?.Projects.FirstOrDefault(p => p.Id == project)?.Panels
                .Where(p => panel is null || p.Id == panel)
                .SelectMany(p => p.Lines)
                .Where(l => l.Filter == filter && (exposureS is null || l.ExposureS == exposureS))
                .Select(l => l.Id).Distinct().ToList();
            return lines is { Count: 1 } ? lines[0].ToString() : $"{project}|{filter}";
        }
        foreach (var e in journal)
        {
            var d = e.Data;
            var project = d.ProjectId ?? Guid.Empty;
            switch (e.Kind)
            {
                case JournalKinds.BlockStart:
                    rows.Add(new NightLogRow(e.AtUtc, ActualState.Done, null, true, false, "slew_center", Title(d), PanelName(project, d.PanelId), null, "",
                        null, null, null, null, null, d.RotationDeg, d.RaDeg, d.DecDeg, Alt(project, e.AtUtc)));
                    break;
                case JournalKinds.Capture:
                    var state = d.Result == "saved" ? ActualState.Saved : ActualState.Failed;
                    if (state == ActualState.Saved) saved += d.Count ?? 1;
                    else failed += d.Count ?? 1;
                    var at = d.StartUtc ?? e.AtUtc;
                    rows.Add(new NightLogRow(at, state, d.Result == "saved" ? null : d.Result, true, false,
                        d.BlockId is { } bid && transitBlocks.Contains(bid) ? "expose_series" : "expose", Title(d), PanelName(project, d.PanelId),
                        d.Count is > 1 || state != ActualState.Saved ? null
                        : Next(LineKey(project, d.PanelId, d.Filter, d.ExposureS, d.LineId), d.BlockId is { } sb && transitBlocks.Contains(sb)),
                        d.Filter ?? "", d.ExposureS, d.Gain, d.Offset, d.Binning, d.Readout, d.RotationDeg, d.RaDeg, d.DecDeg, Alt(project, at))
                    { Count = d.Count ?? 1 });
                    break;
                case JournalKinds.Skipped:
                    skipped++;
                    rows.Add(new NightLogRow(e.AtUtc, ActualState.Skipped, d.Reason, true, false, "expose", Title(d), "", null, d.Filter ?? "",
                        d.ExposureS, null, null, null, null, null, null, null, Alt(project, e.AtUtc)));
                    break;
                case JournalKinds.BlockSkipped:
                    rows.Add(new NightLogRow(e.AtUtc, ActualState.Skipped, d.Reason, true, false, "block_skipped", Title(d), PanelName(project, d.PanelId),
                        null, "", null, null, null, null, null, null, null, null, null));
                    break;
                case JournalKinds.Flip:
                    rows.Add(new NightLogRow(e.AtUtc.AddSeconds(-(d.DurationS ?? 0)), ActualState.Done, null, true, false, "meridian_flip", Title(d), "",
                        null, "", null, null, null, null, null, null, null, null, null) { DurationS = d.DurationS });
                    break;
                case JournalKinds.SafetyPause:
                    rows.Add(new NightLogRow(e.AtUtc, ActualState.Gap, "safety", true, false, "gap", "", "", null, "", null, null, null, null, null, null,
                        null, null, null));
                    break;
            }
        }
        // Leere Blöcke als eine Zeile je Lücke statt einer Zeile je Block.
        foreach (var g in emptyGaps)
        {
            rows.RemoveAll(r => r.Cmd == "slew_center" && r.AtUtc >= g.From && r.AtUtc <= g.To);
            rows.Add(new NightLogRow(g.From, ActualState.Gap, g.Reason, true, false, "gap", "", "", null, "", null, null, null, null, null, null, null,
                null, null) { Count = g.Count, DurationS = (g.To - g.From).TotalSeconds });
        }

        // Laufende Belichtung und Kommendes.
        ExposureProgress? progress = null;
        if (running is { } rb)
        {
            var block = rb.Block;
            var exposures = block.Entries.Where(e => e.Cmd is EntriesCmd.Expose or EntriesCmd.Expose_series).ToList();
            if (i.CurrentEntry is { } ce && i.CurrentEntryStartedUtc is { } started)
            {
                var exp = ce.ExposureS ?? 0;
                var remaining = started.AddSeconds(exp) - now;
                if (remaining < TimeSpan.Zero) remaining = TimeSpan.Zero;
                var fraction = exp > 0 ? Math.Clamp((now - started).TotalSeconds / exp, 0, 1) : 1;
                var series2 = ce.Cmd == EntriesCmd.Expose_series;
                var savedInBlock = journal.Count(e => e.Kind == JournalKinds.Capture && e.Data.BlockId == block.Id && e.Data.Result == "saved");
                var index = series2 ? savedInBlock + 1 : exposures.FindIndex(e => e.Seq == ce.Seq) + 1;
                progress = new ExposureProgress(Math.Max(1, index), series2 ? null : exposures.Count, exp, remaining, fraction);
                rows.Add(EntryRow(block, ce, started, ActualState.Running, current: true) with { Progress = fraction });
            }
            // Plugin 0.4.18: nach der Belichtung läuft keine mehr – Warten, Flip und Zentrieren stehen als laufende Zeile da
            // (der passende Plan-Eintrag bzw. eine eigene Zeile), die Belichtung davor nicht mehr als „▶ läuft 100 %“.
            var entries = block.Entries;
            var activity = i.CurrentEntry is null ? i.Activity : null;
            var activityIndex = activity?.Seq is { } aseq ? entries.FindIndex(e => e.Seq == aseq) : -1;
            var anchor = i.CurrentEntry ?? i.LastEntry;
            var anchorIndex = anchor is null ? -1 : entries.FindIndex(e => e.Seq == anchor.Seq);
            var from = activityIndex >= 0 ? activityIndex : anchorIndex >= 0 ? anchorIndex + 1 : -1;
            if (activity is not null && activityIndex < 0)
                rows.Add(new NightLogRow(activity.SinceUtc, ActualState.Running, null, false, true, ActivityCmd(activity.Kind), TitleOf(block),
                    PanelName(block.ProjectId, block.PanelId), null, "", null, null, null, null, null, block.RotationDeg, block.RaDeg, block.DecDeg,
                    Alt(block.ProjectId, activity.SinceUtc))
                { DurationS = activity.UntilUtc is { } u ? (u - activity.SinceUtc).TotalSeconds : null });
            // AP-68: Erledigtes bzw. Entfallenes nach der letzten Belichtung als ✓ bzw. ↷ statt ○ (Dither, Autofokus, Warten);
            // nach einem Flip im Block steht der Flip als ✓ aus dem Journal da – der geplante Flip nicht noch einmal, Warten
            // davor und Zentrieren danach entfallen.
            var flippedInBlock = journal.Any(e => e.Kind == JournalKinds.Flip && e.Data.BlockId == block.Id);
            for (var k = 0; k < entries.Count; k++)
            {
                var e = entries[k];
                if (from >= 0 ? k < from : e.AtUtc < now) continue;
                if (k == activityIndex)
                {
                    rows.Add(EntryRow(block, e, activity!.SinceUtc, ActualState.Running, current: true));
                    continue;
                }
                if (flippedInBlock && e.Cmd == EntriesCmd.Meridian_flip) continue;
                var outcome = i.Outcomes is { } o && o.TryGetValue(e.Seq, out var x) ? x : (EntryOutcome?)null;
                if (outcome is null && flippedInBlock && FlipCompanion(entries, k)) outcome = EntryOutcome.Skipped;
                rows.Add(outcome switch
                {
                    EntryOutcome.Done => EntryRow(block, e, e.AtUtc, ActualState.Done, current: false) with { Past = true },
                    EntryOutcome.Skipped => EntryRow(block, e, e.AtUtc, ActualState.Skipped, current: false) with { Past = true },
                    _ => EntryRow(block, e, e.AtUtc, ActualState.Planned, current: false),
                });
            }
        }
        foreach (var b in future.Where(b => running?.Block.Id != b.Id))
            foreach (var e in b.Entries)
                rows.Add(EntryRow(b, e, e.AtUtc, ActualState.Planned, current: false));

        NightLogRow EntryRow(Blocks b, Entries e, DateTimeOffset at, ActualState state, bool current) =>
            new(at, state, null, false, current, LockedSettings.Code(e.Cmd), TitleOf(b), PanelName(b.ProjectId, b.PanelId),
                e.Cmd == EntriesCmd.Expose ? Next(LineKey(b.ProjectId, b.PanelId, e.Filter, e.ExposureS, e.ExposureLineId), false) : null, e.Filter ?? "", e.ExposureS, e.Gain, e.Offset, e.Binning,
                e.ReadoutMode, b.RotationDeg, b.RaDeg, b.DecDeg, Alt(b.ProjectId, at)) { DurationS = e.DurationS };

        // Flats ab Nachtende (wenn im Rig eingeschaltet).
        var flatsOn = i.Bootstrap?.Rig.Scheduler.Flats.Enabled == true;
        var flatsDone = journal.Any(e => e.Kind == JournalKinds.FlatsEnd);
        // Panel-Flats beginnen mit dem Nachtende, nur Himmelsflats ab flatsNotBeforeUtc (NightLoop, Entscheidung Sven
        // 06.10.2026) – vorher zeigte das Fenster nach dem Nachtende immer flatsNotBeforeUtc (Plugin 0.4.18).
        var skyFlats = i.Bootstrap?.Rig.Scheduler.Flats.Source == FlatsSource.Sky;
        NextUp? flatsNext = flatsOn && !flatsDone && !i.FlatsRunning && plan is not null
            ? new NextUp("", skyFlats ? plan.FlatsNotBeforeUtc : plan.DarknessEndUtc ?? plan.SessionEndUtc, true)
            : null;
        if (flatsNext is not null)
            rows.Add(new NightLogRow(flatsNext.AtUtc, ActualState.Planned, null, false, false, "flats", "", "", null, "", null, null, null, null, null,
                null, null, null, null));

        rows = [.. rows.Select((r, n) => (r, n)).OrderBy(x => x.r.AtUtc).ThenBy(x => x.n).Select(x => x.r)];

        // ---- Blockliste „Heutige Ziele“ ----
        var list = new List<NightBlockRow>();
        list.AddRange(full.Select(p => new NightBlockRow(p.Title, p.Start, p.End, ActualState.Done, p.Transit)));
        list.AddRange(past.Where(p => p.Running).Select(p => new NightBlockRow(p.Title, p.Start, running?.Block.EndUtc, ActualState.Running, p.Transit)));
        list.AddRange(future.Where(b => running?.Block.Id != b.Id)
            .Select(b => new NightBlockRow(TitleOf(b), b.StartUtc, b.EndUtc, ActualState.Planned, b.Kind == BlocksKind.Transit)));
        if (flatsNext is not null) list.Add(new NightBlockRow("", flatsNext.AtUtc, null, ActualState.Planned, false, Flats: true));
        list = [.. list.OrderBy(b => b.StartUtc)];

        var nextBlock = future.FirstOrDefault(b => running?.Block.Id != b.Id && b.StartUtc >= (running?.Block.EndUtc ?? now) - TimeSpan.FromMinutes(1));
        var next = nextBlock is not null ? new NextUp(TitleOf(nextBlock), nextBlock.StartUtc, false) : flatsNext;

        var lastPlan = journal.LastOrDefault(e => e.Kind == JournalKinds.Plan && (plan is null || e.Data.PlanId == plan.NightPlanId));
        return new NightView(i.Night, chart, rows, list, progress, next, saved, skipped, failed, plan?.NightPlanId, plan?.Revision,
            lastPlan?.Data.Reason, lastPlan?.AtUtc)
        {
            Activity = running is not null && i.CurrentEntry is null ? i.Activity : null,
        };
    }

    /// <summary>Befehl einer Tätigkeit ohne eigenen Plan-Eintrag (Protokoll, Code wie im Planprotokoll).</summary>
    private static string ActivityCmd(BlockActivityKind kind) => kind switch
    {
        BlockActivityKind.Flip or BlockActivityKind.WaitFlip => "meridian_flip",
        BlockActivityKind.Centering => "slew_center",
        BlockActivityKind.Autofocus => "autofocus_hint",
        BlockActivityKind.Dither => "dither",
        _ => "wait",
    };

    /// <summary><c>wait</c> direkt vor bzw. <c>slew_center</c> direkt nach einem geplanten <c>meridian_flip</c>.</summary>
    private static bool FlipCompanion(IReadOnlyList<Entries> entries, int k) =>
        entries[k].Cmd == EntriesCmd.Wait && k + 1 < entries.Count && entries[k + 1].Cmd == EntriesCmd.Meridian_flip
        || entries[k].Cmd is EntriesCmd.Slew_center or EntriesCmd.Slew_center_rotate && k > 0 && entries[k - 1].Cmd == EntriesCmd.Meridian_flip;

    private static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;

    /// <summary>Geplante Filterabschnitte eines Blocks ab jetzt: aufeinanderfolgende Belichtungen gleichen Filters.</summary>
    internal static IEnumerable<(DateTimeOffset From, DateTimeOffset To, string Filter, int Count)> PlannedBars(Blocks b, DateTimeOffset now)
    {
        (DateTimeOffset From, DateTimeOffset To, string Filter, int Count)? bar = null;
        foreach (var e in b.Entries.Where(e => e.Cmd is EntriesCmd.Expose or EntriesCmd.Expose_series))
        {
            var to = e.Cmd == EntriesCmd.Expose_series
                ? e.UntilUtc ?? b.EndUtc
                : e.AtUtc.AddSeconds((e.ExposureS ?? 0) + (e.DurationS is { } d && d > (e.ExposureS ?? 0) ? d - (e.ExposureS ?? 0) : 0));
            if (to <= now) continue;
            var from = Max(e.AtUtc, now);
            var filter = e.Filter ?? "";
            var count = e.Cmd == EntriesCmd.Expose_series && e.ExposureS is > 0 ? Math.Max(1, (int)((to - from).TotalSeconds / e.ExposureS.Value)) : 1;
            if (bar is { } x && x.Filter == filter) bar = (x.From, to, filter, x.Count + count);
            else
            {
                if (bar is { } y) yield return y;
                bar = (from, to, filter, count);
            }
        }
        if (bar is { } z) yield return z;
    }

    /// <summary>Höhe zur Zeit aus der Höhenkurve der Simulation (linear zwischen den Punkten, außerhalb leer).</summary>
    internal static double? Interpolate(IReadOnlyList<NinaSimulationAltitude> points, DateTimeOffset at)
    {
        for (var k = 1; k < points.Count; k++)
        {
            var a = points[k - 1];
            var b = points[k];
            if (at < a.AtUtc || at > b.AtUtc) continue;
            var span = (b.AtUtc - a.AtUtc).TotalSeconds;
            return span <= 0 ? a.AltDeg : a.AltDeg + (b.AltDeg - a.AltDeg) * (at - a.AtUtc).TotalSeconds / span;
        }
        return null;
    }
}
