using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Planning;
using NinaPm.Core.Session;
using NinaPm.Core.Simulator;
using NinaPm.Core.Status;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Fenster im Imaging-Reiter (AP-53b, execution.md §10): Nachtjournal in <c>ninapm.db</c>, Grafik aus Journal (bis jetzt,
/// blass) und gespeichertem Plan (ab jetzt, kräftig), Lücken mit Grund, Protokoll mit Spalte „Ist“, Zähler, laufende
/// Belichtung, „Danach“. Regression Rig-Nacht 06./07.10.2026: nach einer Neuplanung bleibt der Transit sichtbar.
/// </summary>
public sealed class NightViewTests : IDisposable
{
    private readonly DirectoryInfo dir = Directory.CreateTempSubdirectory("ninapm-view-");
    private readonly FixedClock clock = new(UtcText.Parse("2026-09-18T01:00:00Z"));
    private readonly LocalStore store;
    private readonly NightJournal journal;

    public NightViewTests()
    {
        store = LocalStore.Open(Path.Combine(dir.FullName, "ninapm.db"), clock);
        journal = new NightJournal(store);
    }

    public void Dispose()
    {
        store.Dispose();
        dir.Delete(true);
    }

    private static T Example<T>(string name) => JsonConvert.DeserializeObject<T>(ContractExamples.Json(name), NinaJson.Settings())!;

    private static readonly NinaPlanResponse Plan = Example<NinaPlanResponse>("plan.response");
    private static readonly NinaTargets Targets = Example<NinaTargets>("targets.response");
    private static readonly NinaBootstrap Bootstrap = Example<NinaBootstrap>("bootstrap.response");
    private static readonly Blocks Transit = Plan.Blocks[0];
    private static readonly Blocks Regular = Plan.Blocks[1];
    private const string Night = "2026-09-17";

    private static DateTimeOffset T(string hhmmss) => UtcText.Parse($"2026-09-18T{hhmmss}Z");

    private void Add(string at, string kind, JournalData data) => journal.Append(Night, T(at), kind, data);

    private static JournalData Start(Blocks b, string title) =>
        new() { BlockId = b.Id, ProjectId = b.ProjectId, Title = title, Transit = b.Kind == BlocksKind.Transit, RaDeg = b.RaDeg, DecDeg = b.DecDeg };

    private static JournalData Capture(Blocks b, string filter, double exposureS, string startUtc, string result = "saved", int seq = 2) =>
        new() { BlockId = b.Id, ProjectId = b.ProjectId, Filter = filter, ExposureS = exposureS, StartUtc = T(startUtc), Result = result, Seq = seq };

    /// <summary>Nacht wie am 06./07.10.: Transit mit drei Aufnahmen, danach drei leere Blöcke (transit_interrupt), Neuplanung, regulärer Block läuft.</summary>
    private NightView TransitNight(string now = "07:44:40")
    {
        Add("01:50:00", JournalKinds.Plan, new JournalData { PlanId = Plan.NightPlanId, Revision = 1, Reason = "initial" });
        Add("02:05:30", JournalKinds.BlockStart, Start(Transit, "HAT-P-17 b"));
        Add("02:09:00", JournalKinds.Capture, Capture(Transit, "R", 60, "02:08:00"));
        Add("02:10:00", JournalKinds.Capture, Capture(Transit, "R", 60, "02:09:00"));
        Add("02:11:00", JournalKinds.Capture, Capture(Transit, "R", 60, "02:10:00"));
        Add("07:34:00", JournalKinds.BlockEnd, new JournalData { BlockId = Transit.Id, Reason = "completed", Exposures = 3 });
        for (var k = 0; k < 3; k++)
        {
            var id = Guid.NewGuid();
            var s = T("07:34:30").AddSeconds(35 * k);
            journal.Append(Night, s, JournalKinds.BlockStart, new JournalData { BlockId = id, ProjectId = Transit.ProjectId, Title = "HAT-P-17 b", Transit = true });
            journal.Append(Night, s.AddSeconds(5), JournalKinds.BlockEnd, new JournalData { BlockId = id, Reason = "transit_interrupt", Exposures = 0 });
        }
        // Neuplanung ab jetzt: der neue Plan enthält nur noch den regulären Block (Revision 2).
        var replanned = JsonConvert.DeserializeObject<NinaPlanResponse>(JsonConvert.SerializeObject(Plan, NinaJson.Settings()), NinaJson.Settings())!;
        replanned.Blocks.RemoveAt(0);
        replanned.Revision = 2;
        Add("07:37:00", JournalKinds.Plan, new JournalData { PlanId = replanned.NightPlanId, Revision = 2, Reason = "refresh" });
        Add("07:38:00", JournalKinds.BlockStart, Start(Regular, "NGC 281 Pacman"));
        var current = Regular.Entries.First(e => e.Seq == 4);
        return NightViewBuilder.Build(new NightViewInputs(Night, journal.Read(Night), replanned, new HashSet<Guid>(), (Regular, T("07:38:00")),
            current, T("07:42:40"), Targets, Bootstrap, null, SiteTime.Utc, T(now)));
    }

    [Fact]
    public void Journal_ueberlebt_den_Neustart_und_haelt_nur_die_juengsten_Naechte()
    {
        journal.Append("2026-09-14", T("02:00:00"), JournalKinds.Plan, new JournalData { Revision = 1 });
        journal.Append("2026-09-15", T("02:00:00"), JournalKinds.Plan, new JournalData { Revision = 1 });
        journal.Append("2026-09-16", T("02:00:00"), JournalKinds.Plan, new JournalData { Revision = 1 });
        var head = journal.Append(Night, T("02:00:00"), JournalKinds.Capture, Capture(Regular, "Ha", 300, "01:55:00"));
        journal.Append(Night, T("02:01:00"), JournalKinds.Plan, new JournalData { Revision = 2, Reason = "refresh" });

        Assert.Empty(store.Journal("2026-09-14"));
        Assert.Single(store.Journal("2026-09-15"));
        var read = new NightJournal(store).Read(Night);
        Assert.Equal([JournalKinds.Capture, JournalKinds.Plan], read.Select(e => e.Kind));
        Assert.Equal(head, read[0].Id);
        Assert.Equal(T("01:55:00"), read[0].Data.StartUtc);
        Assert.Equal("Ha", read[0].Data.Filter);
        Assert.Equal(read[^1].Id, journal.Head(Night));
        Assert.Equal(0, journal.Append(null, T("02:00:00"), JournalKinds.Plan, new JournalData()));
    }

    [Fact]
    public void Nach_der_Neuplanung_bleibt_der_Transit_sichtbar_blass_und_der_Plan_ab_jetzt_kraeftig()
    {
        var view = TransitNight();
        var chart = view.Chart!;
        var past = chart.Blocks.Where(b => b.Tense == ChartTense.Past).ToList();
        var planned = chart.Blocks.Where(b => b.Tense == ChartTense.Planned).ToList();

        Assert.Contains(past, b => b.Transit && b.Label == "HAT-P-17 b" && Math.Abs(b.X - chart.At(T("02:05:30"))) < 1e-9);
        Assert.Contains(past, b => b.Label == "NGC 281 Pacman" && Math.Abs(b.X + b.Width - chart.At(T("07:44:40"))) < 1e-9);
        var rest = Assert.Single(planned);
        Assert.Equal("NGC 281 Pacman", rest.Label);
        Assert.Equal(chart.At(T("07:44:40")), rest.X, 9);
        Assert.Equal(chart.At(T("07:44:40")), chart.NowX!.Value, 9);

        // Leere Blöcke als eine Lücke mit Grund und Anzahl, nicht als Blöcke.
        var gap = Assert.Single(chart.Gaps, g => g.Kind == ChartGapKind.EmptyBlocks);
        Assert.Equal(("transit_interrupt", 3), (gap.Reason, gap.Count));
        Assert.DoesNotContain(past, b => b.X >= gap.X && b.X < gap.X + gap.Width);

        // Filterleiste: R ×3 blass in Filterfarbe, Ha kräftig ab jetzt.
        var r = Assert.Single(chart.FilterBars, f => f.Tense == ChartTense.Past);
        Assert.Equal(("R ×3", "#e53935"), (r.Label, r.Color));
        Assert.Equal(chart.At(T("02:08:00")), r.X, 9);
        Assert.All(chart.FilterBars.Where(f => f.Tense == ChartTense.Planned), f => Assert.StartsWith("Ha ×", f.Label));
        Assert.True(chart.FilterBars.Where(f => f.Tense == ChartTense.Planned).Min(f => f.X) >= chart.At(T("07:44:40")) - 1e-9);

        // Fußzeile: Plan-ID, Revision und Grund der letzten Neuplanung.
        Assert.Equal((2, "refresh", T("07:37:00")), (view.Revision!.Value, view.PlanReason!, view.PlanAtUtc!.Value));
    }

    [Fact]
    public void Protokoll_Ist_Spalte_Zaehler_laufende_Belichtung_und_Danach()
    {
        var view = TransitNight();

        Assert.Equal((3, 0, 0), (view.Saved, view.Skipped, view.Failed));
        var saved = view.Rows.Where(r => r.State == ActualState.Saved).ToList();
        Assert.Equal(3, saved.Count);
        Assert.All(saved, r => Assert.True(r.Past && r.Cmd == "expose_series" && r.Filter == "R" && r.Target == "HAT-P-17 b"));
        var gapRow = Assert.Single(view.Rows, r => r.State == ActualState.Gap);
        Assert.Equal(("transit_interrupt", 3), (gapRow.Reason, gapRow.Count));
        // Die leeren Blöcke erscheinen nicht einzeln als Anfahren.
        Assert.Equal(2, view.Rows.Count(r => r.Cmd == "slew_center" && r.Past));

        var running = Assert.Single(view.Rows, r => r.Current);
        // Nr. wie im Simulator: laufende Belichtungsnummer je Zeile (nicht die Eintragsnummer 4).
        Assert.Equal((ActualState.Running, "expose", "Ha", 1), (running.State, running.Cmd, running.Filter, running.No!.Value));
        Assert.Equal(2, view.Rows.SkipWhile(r => !r.Current).Skip(1).First(r => r.Cmd == "expose").No);
        Assert.Equal(0.4, running.Progress!.Value, 6);
        Assert.Equal(new ExposureProgress(1, Regular.Entries.Count(e => e.Cmd == EntriesCmd.Expose), 300, TimeSpan.FromMinutes(3), 0.4), view.Progress);

        // Danach: Zeilen des laufenden Blocks ab Nr. 5, geplant und kräftig, in Zeitfolge; zuletzt die Flats.
        var after = view.Rows.SkipWhile(r => !r.Current).Skip(1).ToList();
        Assert.All(after, r => Assert.Equal(ActualState.Planned, r.State));
        Assert.All(after, r => Assert.False(r.Past));
        Assert.Equal("flats", after[^1].Cmd);
        Assert.Equal(view.Rows.OrderBy(r => r.AtUtc).Select(r => r.AtUtc), view.Rows.Select(r => r.AtUtc));

        // Nächstes: kein Block mehr → Flats ab Nachtende (im Rig eingeschaltet).
        Assert.Equal(new NextUp("", Plan.FlatsNotBeforeUtc, true), view.Next);
        Assert.Equal([ActualState.Done, ActualState.Running, ActualState.Planned], view.Blocks.Select(b => b.State));
        Assert.True(view.Blocks[^1].Flats);
    }

    [Fact]
    public void Safety_Pause_Flip_und_uebersprungene_Bloecke_als_Luecken_mit_Grund()
    {
        Add("02:05:30", JournalKinds.BlockStart, Start(Transit, "HAT-P-17 b"));
        Add("02:09:00", JournalKinds.Capture, Capture(Transit, "R", 60, "02:08:00"));
        Add("02:30:00", JournalKinds.BlockEnd, new JournalData { BlockId = Transit.Id, Reason = "interrupted", Exposures = 1 });
        Add("02:30:00", JournalKinds.SafetyPause, new JournalData());
        Add("03:10:00", JournalKinds.SafetyResume, new JournalData());
        Add("03:12:00", JournalKinds.BlockStart, Start(Regular, "NGC 281 Pacman"));
        Add("03:20:00", JournalKinds.Capture, Capture(Regular, "Ha", 300, "03:15:00", seq: 4));
        Add("03:40:00", JournalKinds.Flip, new JournalData { BlockId = Regular.Id, DurationS = 780 });
        Add("03:45:00", JournalKinds.Capture, Capture(Regular, "Ha", 300, "03:40:00", "failed", seq: 8));
        Add("03:46:00", JournalKinds.Skipped, new JournalData { BlockId = Regular.Id, ProjectId = Regular.ProjectId, Seq = 10, Filter = "Ha", ExposureS = 300, Reason = "late" });
        Add("03:50:00", JournalKinds.BlockEnd, new JournalData { BlockId = Regular.Id, Reason = "completed", Exposures = 1 });
        Add("04:10:00", JournalKinds.BlockSkipped, new JournalData { BlockId = Guid.NewGuid(), ProjectId = Regular.ProjectId, Title = "NGC 281 Pacman", Reason = "center_failed" });
        var third = Guid.NewGuid();
        Add("04:30:00", JournalKinds.BlockStart, Start(Regular, "NGC 281 Pacman") with { BlockId = third });
        Add("04:40:00", JournalKinds.Capture, Capture(Regular, "Ha", 300, "04:35:00", seq: 4) with { BlockId = third });
        Add("04:41:00", JournalKinds.BlockEnd, new JournalData { BlockId = third, Reason = "completed", Exposures = 1 });

        var view = NightViewBuilder.Build(new NightViewInputs(Night, journal.Read(Night), Plan, Plan.Blocks.Select(b => b.Id).ToHashSet(), null, null,
            null, Targets, Bootstrap, null, SiteTime.Utc, T("05:00:00")));
        var gaps = view.Chart!.Gaps;

        var safety = Assert.Single(gaps, g => g.Kind == ChartGapKind.Safety);
        Assert.Equal(view.Chart.At(T("02:30:00")), safety.X, 9);
        Assert.Equal(view.Chart.At(T("03:12:00")), safety.X + safety.Width, 9);
        var flip = Assert.Single(gaps, g => g.Kind == ChartGapKind.Flip);
        Assert.Equal(view.Chart.At(T("03:27:00")), flip.X, 9);
        var skipped = Assert.Single(gaps, g => g.Kind == ChartGapKind.Skipped);
        Assert.Equal(("center_failed", 1), (skipped.Reason, skipped.Count));

        Assert.Equal((3, 1, 1), (view.Saved, view.Skipped, view.Failed));
        Assert.Contains(view.Rows, r => r is { State: ActualState.Skipped, Reason: "late", Filter: "Ha", No: null });
        Assert.Contains(view.Rows, r => r is { State: ActualState.Skipped, Cmd: "block_skipped", Reason: "center_failed" });
        Assert.Contains(view.Rows, r => r is { State: ActualState.Failed, Reason: "failed" });
        Assert.Contains(view.Rows, r => r is { Cmd: "meridian_flip", State: ActualState.Done, DurationS: 780 });
        Assert.Contains(view.Rows, r => r is { State: ActualState.Gap, Reason: "safety" });
        // Plan vollständig erledigt: nichts Geplantes außer den Flats.
        Assert.DoesNotContain(view.Chart.Blocks, b => b.Tense == ChartTense.Planned);
        Assert.Equal(["flats"], view.Rows.Where(r => r.State == ActualState.Planned).Select(r => r.Cmd));
    }

    [Fact]
    public void Ohne_Simulation_keine_Kurven_mit_Simulation_Hoehen_und_Zielfarben()
    {
        var without = TransitNight();
        Assert.Empty(without.Chart!.Curves);
        Assert.Null(without.Chart.Moon);
        Assert.All(without.Rows, r => Assert.Null(r.AltDeg));

        var sim = Example<NinaSimulation>("simulation.response");
        journal.Append(Night, T("07:45:00"), JournalKinds.Plan, new JournalData());
        var with = NightViewBuilder.Build(new NightViewInputs(Night, journal.Read(Night), Plan, new HashSet<Guid>(), null, null, null, Targets,
            Bootstrap, sim, SiteTime.From(sim), T("07:44:40")));
        Assert.Equal(sim.Targets.Count, with.Chart!.Curves.Count);
        var transitSeries = sim.Targets.Single(t => t.ProjectId == Transit.ProjectId).SeriesIndex;
        Assert.All(with.Chart.Blocks.Where(b => b.Transit), b => Assert.Equal(transitSeries, b.SeriesIndex));
        Assert.Contains(with.Rows, r => r.AltDeg is not null);
    }

    [Fact]
    public void Leere_Nacht_ohne_Plan_ohne_Grafik_und_ohne_Zeilen()
    {
        var view = NightViewBuilder.Build(new NightViewInputs(Night, [], null, new HashSet<Guid>(), null, null, null, null, null, null, SiteTime.Utc, T("02:00:00")));
        Assert.Null(view.Chart);
        Assert.Empty(view.Rows);
        Assert.Null(view.Next);
        Assert.Null(view.PlanId);
    }

    [Fact]
    public void Geplante_Filterabschnitte_der_Transit_Serie_zaehlen_die_Belichtungen()
    {
        var bars = NightViewBuilder.PlannedBars(Transit, T("07:00:00")).ToList();
        var bar = Assert.Single(bars);
        Assert.Equal(("R", T("07:00:00"), T("07:34:00"), 34), (bar.Filter, bar.From, bar.To, bar.Count));
    }

    [Fact]
    public async Task NightRunner_schreibt_Plan_Blockstart_Aufnahmen_und_Blockende_ins_Journal()
    {
        var nina = new FakeNina(clock) { ExposureScale = 0.02, DownloadS = 1 };
        var runner = new NightRunner(new JournalApi(), new JournalApi(), store, nina, nina, clock, new NinaPmLog(new ListSink()));
        await runner.RunOnceAsync(default); // Plan + Session
        clock.UtcNow = T("07:35:00");
        await runner.RunOnceAsync(default); // regulärer Block

        var entries = runner.Journal.Read(runner.JournalNight!);
        Assert.Equal(JournalKinds.Plan, entries[0].Kind);
        Assert.Equal("initial", entries[0].Data.Reason);
        var start = Assert.Single(entries, e => e.Kind == JournalKinds.BlockStart);
        Assert.Equal("NGC 281 Pacman", start.Data.Title);
        var end = Assert.Single(entries, e => e.Kind == JournalKinds.BlockEnd);
        Assert.True(end.Data.Exposures > 0);
        Assert.True(start.AtUtc <= end.AtUtc);

        var inputs = runner.NightViewInputs(null)!;
        var view = NightViewBuilder.Build(inputs);
        Assert.Contains(view.Chart!.Blocks, b => b.Tense == ChartTense.Past && b.Label == "NGC 281 Pacman");
    }

    [Fact]
    public void Server_Ist_wird_zu_Journaleintraegen_mit_Anzahl_und_ergaenzt_das_lokale_Journal_davor()
    {
        // AP-53c: Ist vom Server (z. B. Plugin erst mitten in der Nacht aktualisiert) – Transit 3 Aufnahmen, Schleife aus
        // 212 leeren Blöcken, Flip; danach schreibt das Plugin lokal mit.
        var executed = new ExecutedNight
        {
            Night = Night,
            Sessions = 1,
            Blocks =
            [
                new ExecutedBlock
                {
                    BlockId = Transit.Id, ProjectId = Transit.ProjectId, Title = "HAT-P-17 b", Kind = ExecutedBlockKind.Transit,
                    StartUtc = T("02:05:30"), EndUtc = T("07:34:00"), EndReason = "completed", Exposures = 558,
                },
            ],
            Segments =
            [
                new ExecutedSegment { BlockId = Transit.Id, ProjectId = Transit.ProjectId, Filter = "R", StartUtc = T("02:08:00"), EndUtc = T("07:33:00"), Saved = 558, Failed = 1, ExposureS = 30 },
            ],
            Events = [new ExecutedEvent { Kind = ExecutedEventKind.Flip, AtUtc = T("05:00:00"), BlockId = Transit.Id, DurationS = 600 }],
            Gaps =
            [
                new ExecutedGap { Kind = ExecutedGapKind.Empty_blocks, FromUtc = T("07:35:00"), ToUtc = T("07:47:00"), Reason = "transit_interrupt", Count = 212 },
            ],
            Counters = new ExecutedCounters { Saved = 558, Skipped = 0, Failed = 1 },
        };
        var server = ExecutedJournal.From(executed);
        Assert.Equal(server.OrderBy(e => e.AtUtc).Select(e => e.AtUtc), server.Select(e => e.AtUtc));

        Add("07:48:00", JournalKinds.BlockStart, Start(Regular, "NGC 281 Pacman"));
        Add("07:55:00", JournalKinds.Capture, Capture(Regular, "Ha", 300, "07:50:00", seq: 4));
        Add("07:56:00", JournalKinds.BlockEnd, new JournalData { BlockId = Regular.Id, Reason = "completed", Exposures = 1 });
        // Ein Server-Eintrag nach dem ersten lokalen zählt nicht doppelt.
        var merged = ExecutedJournal.Merge(journal.Read(Night), [.. server, new JournalEntry(-99, T("07:57:00"), JournalKinds.Capture, new JournalData { Result = "saved" })]);
        Assert.Equal(server.Count + 3, merged.Count);
        Assert.Same(server, ExecutedJournal.Merge([], server));

        var view = NightViewBuilder.Build(new NightViewInputs(Night, merged, Plan, Plan.Blocks.Select(b => b.Id).ToHashSet(), null, null, null,
            Targets, Bootstrap, null, SiteTime.Utc, T("08:00:00")));
        Assert.Equal((559, 0, 1), (view.Saved, view.Skipped, view.Failed));
        var r = Assert.Single(view.Chart!.FilterBars, f => f.Label.StartsWith("R", StringComparison.Ordinal));
        Assert.Equal("R ×558", r.Label);
        var gap = Assert.Single(view.Chart.Gaps, g => g.Kind == ChartGapKind.EmptyBlocks);
        Assert.Equal(("transit_interrupt", 212), (gap.Reason, gap.Count));
        Assert.Contains(view.Chart.Gaps, g => g.Kind == ChartGapKind.Flip);
        Assert.Contains(view.Rows, x => x is { State: ActualState.Saved, Filter: "R", Count: 558 });
        Assert.Contains(view.Chart.Blocks, b => b.Transit && b.Tense == ChartTense.Past);
    }

    [Fact]
    public async Task NightRunner_meldet_Plan_Blockstart_und_Blockende_an_den_Server()
    {
        // AP-53c: dieselben Ereignisse wie das lokale Journal gehen in die Outbox (block_start mit Beginn des Anfahrens).
        var nina = new FakeNina(clock) { ExposureScale = 0.02, DownloadS = 1 };
        var runner = new NightRunner(new JournalApi(), new JournalApi(), store, nina, nina, clock, new NinaPmLog(new ListSink()));
        await runner.RunOnceAsync(default);
        clock.UtcNow = T("07:35:00");
        await runner.RunOnceAsync(default);
        var events = store.OutboxPayloads(OutboxKinds.Event).Select(p => JsonConvert.DeserializeObject<Events>(p, NinaJson.Settings())!).ToList();
        var kinds = events.Select(e => e.Kind).ToList();
        Assert.Contains(EventsKind.Plan_built, kinds);
        var start = Assert.Single(events, e => e.Kind == EventsKind.Block_start);
        Assert.Equal((Regular.Id, Regular.ProjectId), (start.BlockId!.Value, start.ProjectId!.Value));
        Assert.Equal("NGC 281 Pacman", start.Data!["title"]);
        // AP-65 (Plugin 0.4.19): Dauer von Anfahren + Zentrieren bis zum Blockstart-Bericht, vor jedem Warten auf den Plan.
        Assert.True(start.Data!.ContainsKey("slewCenterS"));
        Assert.True(Convert.ToDouble(start.Data["slewCenterS"], System.Globalization.CultureInfo.InvariantCulture) >= 0);
        var end = Assert.Single(events, e => e.Kind == EventsKind.Block_end);
        Assert.Equal("completed", end.Code);
        Assert.True(start.OccurredAtUtc <= end.OccurredAtUtc);
    }

    /// <summary>Server für den Journal-Test: Bootstrap, Ziele, Plan aus den Vertragsbeispielen, Session ohne Fehler.</summary>
    private sealed class JournalApi : IPlanApi, ISessionApi
    {
        public Task<NinaBootstrap> BootstrapAsync(CancellationToken token) => Task.FromResult(Example<NinaBootstrap>("bootstrap.response"));

        public Task<NinaPlanResponse> PlanAsync(NinaPlanRequest request, CancellationToken token)
        {
            var p = Example<NinaPlanResponse>("plan.response");
            p.Night = request.Night;
            return Task.FromResult(p);
        }

        public Task<(NinaTargets? Targets, string? Etag)> TargetsAsync(string? etag, CancellationToken token) =>
            Task.FromResult<(NinaTargets?, string?)>(etag == "\"t-9b41\"" ? (null, etag) : (Example<NinaTargets>("targets.response"), "\"t-9b41\""));

        public Task<NinaSessionCreated> CreateAsync(NinaSessionCreate body, CancellationToken token) =>
            Task.FromResult(new NinaSessionCreated { SessionId = body.Id, PlanLogUploadUrl = "http://x" });

        public Task<NinaSessionPatched> PatchAsync(Guid sessionId, NinaSessionPatch body, CancellationToken token) =>
            Task.FromResult(new NinaSessionPatched { SessionId = sessionId, Lease = new Lease3 { LeaseLost = false } });

        public Task<NinaCaptureResults> CapturesAsync(Guid sessionId, NinaCaptureBatch body, CancellationToken token) =>
            Task.FromResult(new NinaCaptureResults { Results = [.. body.Captures.Select(c => new Results { Id = c.Id, Status = ResultsStatus.Accepted })] });

        public Task EventsAsync(Guid sessionId, NinaEventBatch body, CancellationToken token) => Task.CompletedTask;

        public Task<NinaHeartbeatResponse> HeartbeatAsync(NinaHeartbeat body, CancellationToken token) =>
            Task.FromResult(new NinaHeartbeatResponse { ServerTimeUtc = DateTimeOffset.UnixEpoch, Lease = new Lease { LeaseLost = false } });
    }

    // ---- Plugin 0.4.18 (Analyse 07.10.2026) -------------------------------------------------------------------------

    private NightView RegularRunning(string now, BlockActivity? activity, Entries? last, NinaPlanResponse? plan = null, NinaBootstrap? bootstrap = null) =>
        NightViewBuilder.Build(new NightViewInputs(Night, journal.Read(Night), plan ?? Plan, new HashSet<Guid>(), (Regular, T("07:35:00")),
            null, null, Targets, bootstrap ?? Bootstrap, null, SiteTime.Utc, T(now), Activity: activity, LastEntry: last));

    [Fact]
    public void Ohne_laufende_Belichtung_zeigt_die_Ansicht_Flip_bzw_Zentrieren_statt_100_Prozent()
    {
        // Befund 10: nach der Belichtung stand sie bis zum Blockende als „▶ läuft 100 %“ da (auch beim Warten, Flip, Zentrieren).
        Add("07:35:00", JournalKinds.BlockStart, Start(Regular, "NGC 281 Pacman"));
        Add("07:47:45", JournalKinds.Capture, Capture(Regular, "Ha", 300, "07:42:40", seq: 4));
        var last = Regular.Entries.Single(e => e.Seq == 4);

        var flip = RegularRunning("07:49:00", new BlockActivity(BlockActivityKind.Flip, T("07:48:00"), Seq: 6), last);
        Assert.Null(flip.Progress);
        Assert.Equal(BlockActivityKind.Flip, flip.Activity!.Kind);
        var current = Assert.Single(flip.Rows, r => r.Current);
        Assert.Equal(("meridian_flip", ActualState.Running, T("07:48:00")), (current.Cmd, current.State, current.AtUtc));
        Assert.DoesNotContain(flip.Rows, r => r.State == ActualState.Running && r.IsExposure);
        Assert.DoesNotContain(flip.Rows, r => !r.Past && r.Cmd == "dither" && r.AtUtc < T("07:48:00")); // Dither davor ist erledigt

        // Zentrieren nach einem ungeplanten Flip hat keinen Plan-Eintrag: eigene laufende Zeile.
        var centering = RegularRunning("07:49:00", new BlockActivity(BlockActivityKind.Centering, T("07:48:30")), last);
        var row = Assert.Single(centering.Rows, r => r.Current);
        Assert.Equal(("slew_center", ActualState.Running), (row.Cmd, row.State));
    }

    [Fact]
    public void Nummern_je_Belichtungszeile_nur_gespeicherte_im_Plan_weitergezaehlt()
    {
        // Befund 15: Vergangenes war je Projekt|Filter mit fehlgeschlagenen gezählt, Geplantes je Zeile – die Nummern sprangen.
        var line = Regular.Entries.First(e => e.Cmd == EntriesCmd.Expose).ExposureLineId;
        Add("07:35:00", JournalKinds.BlockStart, Start(Regular, "NGC 281 Pacman"));
        Add("07:47:45", JournalKinds.Capture, Capture(Regular, "Ha", 300, "07:42:40", seq: 4)); // ohne Zeile (Server-Ist): über die Ziele
        Add("07:58:30", JournalKinds.Capture, Capture(Regular, "Ha", 300, "07:53:28", result: "failed", seq: 8) with { LineId = line });
        Add("08:03:50", JournalKinds.Capture, Capture(Regular, "Ha", 300, "07:58:46", seq: 10) with { LineId = line });

        var view = RegularRunning("08:04:00", null, Regular.Entries.Single(e => e.Seq == 10));

        Assert.Equal([1, null, 2], view.Rows.Where(r => r.Past && r.IsExposure).Select(r => r.No));
        var planned = view.Rows.Where(r => !r.Past && r.Cmd == "expose").ToList();
        Assert.Equal([3, 4], planned.Take(2).Select(r => r.No));
    }

    [Fact]
    public void Panel_Flats_beginnen_am_Nachtende_Himmelsflats_ab_flatsNotBeforeUtc()
    {
        // Befund 15: der Hinweis nannte immer flatsNotBeforeUtc, Panel-Flats laufen aber mit dem Nachtende (NightLoop).
        var plan = JsonConvert.DeserializeObject<NinaPlanResponse>(JsonConvert.SerializeObject(Plan, NinaJson.Settings()), NinaJson.Settings())!;
        plan.FlatsNotBeforeUtc = T("12:15:00");
        var panel = RegularRunning("08:00:00", null, null, plan);
        Assert.Equal(new NextUp("", plan.DarknessEndUtc!.Value, true), panel.Next);

        var sky = JsonConvert.DeserializeObject<NinaBootstrap>(JsonConvert.SerializeObject(Bootstrap, NinaJson.Settings()), NinaJson.Settings())!;
        sky.Rig.Scheduler.Flats.Source = FlatsSource.Sky;
        Assert.Equal(new NextUp("", T("12:15:00"), true), RegularRunning("08:00:00", null, null, plan, sky).Next);
    }
}
