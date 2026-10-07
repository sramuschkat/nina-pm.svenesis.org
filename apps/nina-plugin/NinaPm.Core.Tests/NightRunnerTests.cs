using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Planning;
using NinaPm.Core.Reporting;
using NinaPm.Core.Sequence;
using NinaPm.Core.Status;
using NinaPm.Core.Session;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Ein Aufruf von <em>NINA-PM-Anweisungen</em> (execution.md §2, §4.6, TK 10.3) mit simulierter Zeit, NINA-Attrappe,
/// Attrappen von Plan- und Session-API und echter <c>ninapm.db</c>: Plan holen und speichern, Session anlegen, auf
/// Blöcke warten, gesperrter Zustand wartet 60 s, Nachtende mit <c>PATCH completed</c>, Unterbrechung und
/// Wiederaufnahme, Benutzer-Stopp, Start ohne Verbindung, <em>Warten bis sicher oder Nachtende</em> (H2).
/// </summary>
public sealed class NightRunnerTests : IDisposable
{
    private readonly DirectoryInfo dir = Directory.CreateTempSubdirectory("ninapm-runner-");
    private readonly FixedClock clock = new(UtcText.Parse("2026-09-18T01:00:00Z"));
    private readonly ListSink sink = new();
    private readonly FakeApi api = new();
    private readonly FakeNina nina;
    private readonly LocalStore store;

    public NightRunnerTests()
    {
        nina = new FakeNina(clock);
        store = LocalStore.Open(Path.Combine(dir.FullName, "ninapm.db"), clock);
        api.Now = () => clock.UtcNow;
    }

    public void Dispose()
    {
        store.Dispose();
        dir.Delete(true);
    }

    private static T Example<T>(string name) => JsonConvert.DeserializeObject<T>(ContractExamples.Json(name), NinaJson.Settings())!;

    private sealed class FakeApi : IPlanApi, ISessionApi
    {
        public bool Offline { get; set; }
        public List<NinaPlanRequest> Plans { get; } = [];
        public List<DateTimeOffset> PlanTimes { get; } = [];
        public Func<DateTimeOffset>? Now { get; set; }
        public List<NinaSessionCreate> Created { get; } = [];
        public List<(Guid Id, NinaSessionPatch Patch)> Patches { get; } = [];
        public Func<NinaSessionCreate, NinaSessionCreated>? OnCreate { get; set; }
        /// <summary>Plan-Antwort ändern (z. B. <c>darknessEndUtc = null</c>).</summary>
        public Action<NinaPlanResponse>? OnPlan { get; set; }
        /// <summary>Eigene Antwort auf <c>GET /targets</c> (ETag des Aufrufers → Ziele oder 304, neues ETag).</summary>
        public Func<string?, (NinaTargets?, string?)>? OnTargets { get; set; }

        public Task<NinaBootstrap> BootstrapAsync(CancellationToken token) =>
            Offline ? throw new HttpRequestException("offline") : Task.FromResult(Example<NinaBootstrap>("bootstrap.response"));

        public Task<NinaPlanResponse> PlanAsync(NinaPlanRequest request, CancellationToken token)
        {
            if (Offline) throw new HttpRequestException("offline");
            Plans.Add(request);
            if (Now is not null) PlanTimes.Add(Now());
            var p = Example<NinaPlanResponse>("plan.response");
            p.Night = request.Night;
            p.NightPlanId = Guid.NewGuid();
            OnPlan?.Invoke(p);
            return Task.FromResult(p);
        }

        public Task<(NinaTargets? Targets, string? Etag)> TargetsAsync(string? etag, CancellationToken token) =>
            Offline
                ? throw new HttpRequestException("offline")
                : Task.FromResult(OnTargets?.Invoke(etag)
                    ?? (etag == "\"t-9b41\"" ? (null, etag) : (Example<NinaTargets>("targets.response"), "\"t-9b41\"")));

        public Task<NinaSessionCreated> CreateAsync(NinaSessionCreate body, CancellationToken token)
        {
            if (Offline || SessionsFail) throw new HttpRequestException("offline");
            Created.Add(body);
            return Task.FromResult(OnCreate?.Invoke(body) ?? new NinaSessionCreated { SessionId = body.Id, PlanLogUploadUrl = "http://x" });
        }

        /// <summary>Eigene Antwort auf <c>PATCH /sessions/{id}</c> (wirft z. B. <c>409 session.rig_busy</c>).</summary>
        public Func<Guid, NinaSessionPatch, NinaSessionPatched>? OnPatch { get; set; }

        public Task<NinaSessionPatched> PatchAsync(Guid sessionId, NinaSessionPatch body, CancellationToken token)
        {
            if (Offline || ReportsFail) throw new HttpRequestException("offline");
            Patches.Add((sessionId, body));
            return Task.FromResult(OnPatch?.Invoke(sessionId, body) ?? new NinaSessionPatched
            {
                SessionId = sessionId,
                Lease = new Lease3 { LeaseLost = false },
            });
        }

        /// <summary><c>POST /sessions</c> scheitert mit Netzfehler, solange gesetzt.</summary>
        public bool SessionsFail { get; set; }

        /// <summary>Meldungen (captures/events) scheitern mit Netzfehler, solange gesetzt.</summary>
        public bool ReportsFail { get; set; }
        public List<(Guid Session, NinaCaptureBatch Batch)> CaptureBatches { get; } = [];
        public List<(Guid Session, NinaEventBatch Batch)> EventBatches { get; } = [];
        public List<NinaHeartbeat> Heartbeats { get; } = [];
        /// <summary>Antwort auf den Heartbeat; Standard: Serverzeit = Testuhr, Lease gehalten.</summary>
        public Func<NinaHeartbeat, NinaHeartbeatResponse>? OnHeartbeat { get; set; }

        /// <summary>Eigene Antwort auf <c>POST captures</c> (wirft z. B. <c>409 session.closed</c>); <c>null</c> = 2xx.</summary>
        public Func<NinaCaptureBatch, Exception?>? OnCaptures { get; set; }

        /// <summary>Status je Aufnahme in der Antwort; Standard <c>accepted</c>.</summary>
        public Func<Captures, ResultsStatus>? CaptureStatus { get; set; }

        public Task<NinaCaptureResults> CapturesAsync(Guid sessionId, NinaCaptureBatch body, CancellationToken token)
        {
            if (Offline || ReportsFail) throw new HttpRequestException("offline");
            if (OnCaptures?.Invoke(body) is { } ex) throw ex;
            CaptureBatches.Add((sessionId, body));
            return Task.FromResult(new NinaCaptureResults
            {
                Results = [.. body.Captures.Select(c => new Results { Id = c.Id, Status = CaptureStatus?.Invoke(c) ?? ResultsStatus.Accepted })],
            });
        }

        public Task EventsAsync(Guid sessionId, NinaEventBatch body, CancellationToken token)
        {
            if (Offline || ReportsFail) throw new HttpRequestException("offline");
            EventBatches.Add((sessionId, body));
            return Task.CompletedTask;
        }

        public Task<NinaHeartbeatResponse> HeartbeatAsync(NinaHeartbeat body, CancellationToken token)
        {
            if (Offline) throw new HttpRequestException("offline");
            Heartbeats.Add(body);
            return Task.FromResult(OnHeartbeat?.Invoke(body) ?? new NinaHeartbeatResponse
            {
                ServerTimeUtc = Now?.Invoke() ?? DateTimeOffset.UnixEpoch,
                Lease = new Lease { LeaseLost = false },
                SettingsVersion = 0,
                TargetsEtag = "\"t-9b41\"",
            });
        }
    }

    private NightRunner Runner() => new(api, api, store, nina, nina, clock, new NinaPmLog(sink));

    private static SeqNode SampleSequence(string file, Action<JObject>? change = null)
    {
        var json = JObject.Parse(File.ReadAllText(Path.Combine(ContractExamples.RepoRoot(), "apps", "nina-plugin", "NinaPm.Nina", "Samples", file)));
        change?.Invoke(json);
        return SequenceFile.Parse(json.ToString());
    }

    [Fact]
    public async Task Live_Status_aus_gespeichertem_Plan_und_Outbox()
    {
        // FA-NIN-13 (AP-16h): Blockliste aus dem gespeicherten Plan, Zähler aus ninapm.db, Banner nur auf Anfrage.
        var runner = Runner();
        Assert.True(runner.LiveStatus(testBanner: false).NoPlan);
        await runner.RunOnceAsync(default);
        store.EnqueueOutbox(OutboxKinds.Event, "{}", null, null);
        var s = runner.LiveStatus(testBanner: true);
        Assert.Equal(2, s.Blocks.Count);
        Assert.Equal(LiveState.Waiting, s.State);
        Assert.Equal(store.OutboxCount(), s.OutboxPending);
        Assert.True(s.OutboxPending >= 1);
        Assert.True(s.TestBanner);
    }

    [Fact]
    public async Task Ziele_aktualisieren_laedt_Bootstrap_und_Ziele_offline_nur_Cache()
    {
        // FA-NIN-08 (AP-16h): Anweisung NINA-PM Ziele aktualisieren.
        var runner = Runner();
        var r = await runner.RefreshAsync(default);
        Assert.Equal(new TargetsRefresh(2, "\"t-9b41\"", false), r);
        Assert.Contains(sink.Lines, l => l.EndsWith("API status=200 call=bootstrap", StringComparison.Ordinal));
        Assert.Contains(sink.Lines, l => l.EndsWith("API status=200 call=targets", StringComparison.Ordinal));

        sink.Lines.Clear();
        runner.OfflineMode = true;
        Assert.Equal(new TargetsRefresh(2, "\"t-9b41\"", true), await runner.RefreshAsync(default));
        Assert.DoesNotContain(sink.Lines, l => l.Contains("API ", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Sequenzvorlage_Abweichung_einmal_je_Nacht_und_Safety_ohne_Monitor()
    {
        // AP-16h (execution.md §1, NT-44): Hinweis kein Abbruch, warning sequence_template_deviation 1×/12 h mit checks,
        // Safety-Bedingungen ohne verbundenen Monitor → safety_monitor_not_connected; Vorlage ohne Safety bleibt still.
        var runner = Runner();
        await runner.RunOnceAsync(default); // Bootstrap (afEveryMin 60, Flip an) und Session
        var rules = new HostRules(clock, () => new NinaPmLog(sink), () => runner);
        sink.Lines.Clear();

        Assert.Empty(rules.CheckSequence(SampleSequence("one-night.json"), safetyMonitorConnected: false));
        Assert.Empty(sink.Lines);

        var deviating = SampleSequence("one-night-safety.json", s =>
            s.SelectTokens("$..[?(@.$type =~ /.*AutofocusAfterTimeTrigger.*/)]").OfType<JObject>().Single()["Amount"] = 30.0);
        var found = rules.CheckSequence(deviating, safetyMonitorConnected: false);
        Assert.Equal("af_time_mismatch", Assert.Single(found).Check);
        Assert.Single(sink.Lines, l => l.Contains("WARNING code=sequence_template_deviation checks=af_time_mismatch", StringComparison.Ordinal));
        Assert.Single(sink.Lines, l => l.Contains("WARNING code=safety_monitor_not_connected", StringComparison.Ordinal));
        var deviation = store.OutboxPayloads(OutboxKinds.Event).Select(JObject.Parse)
            .Single(e => (string?)e["code"] == "sequence_template_deviation");
        Assert.Equal(["af_time_mismatch"], deviation["data"]!["checks"]!.Values<string>());

        sink.Lines.Clear();
        clock.UtcNow = clock.UtcNow.AddHours(1);
        Assert.Single(rules.CheckSequence(deviating, safetyMonitorConnected: false)); // Hinweis bleibt für die Optionsseite
        Assert.Empty(sink.Lines);                                                     // Meldung gedrosselt
        clock.UtcNow = clock.UtcNow.AddHours(12);
        rules.CheckSequence(deviating, safetyMonitorConnected: true);
        Assert.Single(sink.Lines, l => l.Contains("sequence_template_deviation", StringComparison.Ordinal));
        Assert.DoesNotContain(sink.Lines, l => l.Contains("safety_monitor_not_connected", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Erster_Aufruf_holt_den_Plan_speichert_ihn_und_legt_die_Session_an()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);

        var plan = Assert.Single(api.Plans);
        Assert.Equal(("2026-09-17", NinaPlanRequestReason.Initial), (plan.Night, plan.Reason));
        var session = Assert.Single(api.Created);
        Assert.Equal(session.Id, runner.SessionId);
        Assert.NotNull(PlanStore.Load(store, "2026-09-17"));
        Assert.True(runner.HasBlocksRemaining);
        // Ziele vor dem Plan abgerufen (§3.1), ETag im Plan und im gespeicherten Plan.
        Assert.Equal("\"t-9b41\"", plan.TargetsEtag);
        Assert.Equal("\"t-9b41\"", PlanStore.Load(store, "2026-09-17")!.TargetsEtag);
        Assert.Equal(2, runner.Targets!.Projects.Count);

        // Zweiter Aufruf: auf den Transitblock warten (Vorlauf 02:05:30), Heartbeat idle.
        await runner.RunOnceAsync(default);
        Assert.Equal("delay:2026-09-18T02:05:30.000Z", nina.Calls[^1]);
        Assert.Equal(NinaHeartbeatState.Idle, runner.HeartbeatState(offline: false));
    }

    // ---- Analyse 04.10.2026, Paket 2: Nachtablauf -----------------------------------------------------------------

    [Fact]
    public async Task Neue_Ziele_waehrend_des_Wartens_auf_einen_spaeten_Block_planen_sofort_neu()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default); // Plan 01:00, nächster Block (Transit) erst 02:05:30, Sperre bis 01:05
        clock.UtcNow = UtcText.Parse("2026-09-18T01:10:00Z");
        var changed = Example<NinaTargets>("targets.response");
        api.OnTargets = e => Serve(e, changed, "\"t-2\"");
        // Freigabe im Web: der Heartbeat meldet ein neues ETag.
        runner.HeartbeatAnswered(new NinaHeartbeatResponse { ServerTimeUtc = clock.UtcNow, TargetsEtag = "\"t-2\"" }, clock.UtcNow);

        await runner.RunOnceAsync(default);

        Assert.Equal(2, api.Plans.Count);
        Assert.Equal(NinaPlanRequestReason.Refresh, api.Plans[^1].Reason);
        Assert.True(clock.UtcNow < UtcText.Parse("2026-09-18T02:05:30Z")); // nicht bis zum Blockstart gewartet
    }

    [Fact]
    public async Task Leerer_Plan_neue_Ziele_im_Web_wirken_nach_einer_Minute_statt_fuenf()
    {
        // Rig-Nacht 06.10.2026: SII war wegen der Mindesthöhe ausgeschlossen, der Plan leer; die gesenkte Mindesthöhe kam
        // erst mit dem nächsten 5-min-Abruf an (Plugin 0.4.12: höchstens 1 min).
        api.OnPlan = p => p.Blocks.Clear();
        var runner = Runner();
        await runner.RunOnceAsync(default); // Plan 01:00 ohne Blöcke, Sperre bis 01:05
        var changed = Example<NinaTargets>("targets.response");
        api.OnTargets = e => Serve(e, changed, "\"t-2\"");
        runner.HeartbeatAnswered(new NinaHeartbeatResponse { ServerTimeUtc = clock.UtcNow, TargetsEtag = "\"t-2\"" }, clock.UtcNow);

        await runner.RunOnceAsync(default); // wartet höchstens bis 1 min nach dem letzten Abruf
        await runner.RunOnceAsync(default);

        Assert.Equal(2, api.Plans.Count);
        Assert.Equal(NinaPlanRequestReason.Refresh, api.Plans[^1].Reason);
        Assert.True(clock.UtcNow < UtcText.Parse("2026-09-18T01:02:00Z"), clock.UtcNow.ToString("O"));
    }

    [Fact]
    public async Task Zuruecksetzen_beendet_das_Warten_auf_einen_spaeten_Block()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        nina.OnDelay = until => runner.Reset(); // während des Wartens im Plugin auf Zurücksetzen gedrückt
        await runner.RunOnceAsync(default);
        nina.OnDelay = null;
        Assert.True(clock.UtcNow < UtcText.Parse("2026-09-18T02:05:30Z"));
        await runner.RunOnceAsync(default);
        Assert.Equal(NinaPlanRequestReason.Reset, api.Plans[^1].Reason);
    }

    [Fact]
    public async Task Lease_lost_bis_zum_Nachtende_bricht_die_Session_ab_und_beendet_die_Nacht()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var session = runner.SessionId!.Value;
        runner.HeartbeatAnswered(new NinaHeartbeatResponse { ServerTimeUtc = clock.UtcNow, Lease = new Lease { LeaseLost = true } }, clock.UtcNow, session);
        Assert.Equal(NinaHeartbeatBlockedReason.Lease_lost, runner.Loop.Blocked);

        var plan = PlanStore.Load(store, "2026-09-17")!.Plan;
        clock.UtcNow = (plan.DarknessEndUtc ?? plan.SessionEndUtc).AddMinutes(1);
        await runner.RunOnceAsync(default); // Nachtende: Session abbrechen
        Assert.Equal((session, NinaSessionPatchStatus.Aborted), (api.Patches[^1].Id, api.Patches[^1].Patch.Status));
        Assert.Null(runner.SessionId);
        Assert.Null(runner.Loop.Blocked);

        await runner.RunOnceAsync(default); // Nacht schließen → Ende-Bereich (Parken)
        Assert.False(runner.HasBlocksRemaining);
    }

    [Fact]
    public async Task Heartbeat_Antwort_einer_frueheren_Session_bzw_ohne_Lease_sperrt_nicht()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var lost = new NinaHeartbeatResponse { ServerTimeUtc = clock.UtcNow, Lease = new Lease { LeaseLost = true } };
        runner.HeartbeatAnswered(lost, clock.UtcNow, Guid.NewGuid()); // gesendet mit der abgeschlossenen Session
        Assert.Null(runner.Loop.Blocked);
        runner.HeartbeatAnswered(new NinaHeartbeatResponse { ServerTimeUtc = clock.UtcNow, Lease = null }, clock.UtcNow, runner.SessionId);
        Assert.Null(runner.Loop.Blocked); // Server kennt die Session (noch) nicht
    }

    [Fact]
    public async Task Veraltete_offene_Session_wird_vor_dem_Zuruecksetzen_abgeschlossen()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var session = runner.SessionId!.Value;
        clock.UtcNow = UtcText.Parse("2026-09-19T20:00:00Z"); // nächster Abend, Nacht gewechselt

        await runner.RunOnceAsync(default);

        Assert.Equal((session, NinaSessionPatchStatus.Completed), (api.Patches[^1].Id, api.Patches[^1].Patch.Status));
        Assert.NotEqual(session, runner.SessionId);
    }

    [Fact]
    public async Task Nachtende_ueber_sessionEndUtc_schliesst_die_Nacht_ab_ohne_Session_der_naechsten_Nacht()
    {
        // Plan ohne darknessEndUtc (Engine < 0.16.0: alle Projekte fertig): Nachtende erst bei sessionEndUtc = Nachtfensterende,
        // im selben Augenblick wechselt currentNight. Die offene Session gehört bis zum Mittag noch zu ihrer Nacht – sie wird
        // regulär abgeschlossen, statt als veraltet verworfen und durch eine Session der nächsten Nacht ersetzt zu werden
        // (kopfloser Lauf real-all-done, 05.10.2026).
        api.OnPlan = p => p.DarknessEndUtc = null;
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var session = runner.SessionId!.Value;
        clock.UtcNow = UtcText.Parse("2026-09-18T13:00:00Z");

        for (var i = 0; i < 5 && runner.HasBlocksRemaining; i++) await runner.RunOnceAsync(default);

        Assert.Equal((session, NinaSessionPatchStatus.Completed), (api.Patches[^1].Id, api.Patches[^1].Patch.Status));
        Assert.False(runner.HasBlocksRemaining);
        Assert.Single(api.Created);
        Assert.DoesNotContain(api.Plans, p => p.Night == "2026-09-18");
    }

    [Fact]
    public async Task Tagesschleife_endet_nicht_mit_veralteten_Lieferangaben()
    {
        var empty = Example<NinaTargets>("targets.response");
        empty.DeliveryNights = [new() { Night = "2026-09-17", Projects = 0 }, new() { Night = "2026-09-18", Projects = 0 }, new() { Night = "2026-09-19", Projects = 0 }];
        api.OnTargets = e => Serve(e, empty, "\"t-0\"");
        var runner = Runner();
        await runner.RefreshAsync(default);
        var settings = new DayLoopSettings();
        var log = new NinaPmLog(sink);

        Assert.Equal(DayLoopDecision.No_delivery, DayCycle.Boundary(runner, new DayLoopState(), settings, clock.UtcNow, starting: true, log));
        // Cache von gestern (älter als 6 h): unbekannt → weiter; Warten auf Zeit frischt die Ziele danach auf.
        var later = clock.UtcNow + DayCycle.DeliveryMaxAge + TimeSpan.FromMinutes(1);
        Assert.Equal(DayLoopDecision.Continue, DayCycle.Boundary(runner, new DayLoopState(), settings, later, starting: true, log));
    }

    [Fact]
    public async Task Abgearbeiteter_Block_laeuft_nicht_noch_einmal_auch_vor_seinem_Ende()
    {
        // Lauf 02.10.2026: Sky-Simulator-Kamera ignoriert die Belichtungszeit, der Block war nach 1,5 min durch und
        // startete danach 1703-mal neu. Jetzt: einmal je Plan, danach Warten auf den nächsten Block.
        nina.ExposureScale = 0.02;
        nina.DownloadS = 1;
        var runner = Runner();
        await runner.RunOnceAsync(default); // Plan + Session
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");

        await runner.RunOnceAsync(default); // regulärer Block; zeitgeführt (Rig) wartet er bis zu den Planzeiten
        Assert.True(clock.UtcNow <= UtcText.Parse("2026-09-18T09:20:01Z")); // spätestens Blockende
        var starts = sink.Lines.Count(l => l.Contains("BLOCK_START"));
        var plans = api.Plans.Count;

        // Neustart ohne Verbindung: gespeicherter Plan, der Block ist darin erledigt und läuft nicht noch einmal.
        api.Offline = true;
        var restarted = Runner();
        await restarted.RunOnceAsync(default); // resume scheitert → gespeicherter Plan
        await restarted.RunOnceAsync(default);
        await restarted.RunOnceAsync(default);
        Assert.Equal(starts, sink.Lines.Count(l => l.Contains("BLOCK_START")));

        // Wieder online: kein offener Block mehr in diesem Plan → neu planen (refresh) statt Wiederholung.
        api.Offline = false;
        clock.Advance(TimeSpan.FromMinutes(6)); // 5-min-Sperre der fehlgeschlagenen Versuche vorbei
        await runner.RunOnceAsync(default);
        Assert.Equal(plans + 1, api.Plans.Count);
        Assert.Equal(NinaPlanRequestReason.Refresh, api.Plans[^1].Reason);
    }

    [Fact]
    public async Task Server_liefert_den_erledigten_Block_erneut_neu_planen_hoechstens_alle_5_Minuten()
    {
        // Lauf 02.10.2026: kurz vor dem Blockende passte keine Belichtung mehr, der Block war sofort erledigt; der
        // Test-Server lieferte ihn im neuen Plan erneut, der Plan mit Blöcken hob die Sperre auf → 834 Pläne in 61 s.
        api.Now = () => clock.UtcNow;
        var runner = Runner();
        await runner.RunOnceAsync(default); // Plan + Session um 01:00, Sperre bis 01:05
        clock.UtcNow = UtcText.Parse("2026-09-18T09:19:30Z"); // regulärer Block endet 09:20:01

        for (var i = 0; i < 40 && runner.HasBlocksRemaining; i++) await runner.RunOnceAsync(default);

        // Einzige Ausnahme: nach dem leeren Block einmal sofort neu planen (EmptyBlock, Plugin 0.4.8).
        var early = Enumerable.Range(1, api.PlanTimes.Count - 1).Count(i => api.PlanTimes[i] - api.PlanTimes[i - 1] < NightLoop.PlanLock);
        Assert.True(early <= sink.Lines.Count(l => l.Contains("EmptyBlock")), $"{early} Pläne vor Ablauf der Sperre");
        Assert.True(sink.Lines.Count(l => l.Contains("EmptyBlock")) <= 1);
        Assert.Contains(nina.Calls, c => c.StartsWith("delay:", StringComparison.Ordinal));
        Assert.DoesNotContain(sink.Lines, l => l.Contains("loop_guard"));
    }

    [Fact]
    public async Task Schleifenschutz_nach_25_sofortigen_Aufrufen_30_s_Pause()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        // Nicht behebbarer Zustand: jeder Aufruf kehrt sofort zurück (NINA hört normalerweise über HasBlocksRemaining auf).
        runner.Loop.Block(NinaHeartbeatBlockedReason.Rig_busy, clock.UtcNow);
        var start = clock.UtcNow;

        // Der erste Aufruf (Plan, Session) kehrte ebenfalls sofort zurück und zählt mit.
        for (var i = 2; i < NightRunner.LoopGuardCalls; i++) await runner.RunOnceAsync(default);
        Assert.Equal(start, clock.UtcNow);
        Assert.DoesNotContain(sink.Lines, l => l.Contains("loop_guard"));

        await runner.RunOnceAsync(default);
        Assert.Equal(start + NightRunner.LoopGuardWait, clock.UtcNow);
        Assert.Contains(sink.Lines, l => l.Contains("WARNING code=loop_guard"));

        // Zähler beginnt neu.
        for (var i = 1; i < NightRunner.LoopGuardCalls; i++) await runner.RunOnceAsync(default);
        Assert.Equal(start + NightRunner.LoopGuardWait, clock.UtcNow);
    }

    // ---- Neuplanung vor und im Block (AP-16d, execution.md §3.2, FA-SYN-03) -----------------------------------

    /// <summary>Antwort auf <c>GET /targets</c> mit festen Zielen unter <paramref name="etag"/> (304 bei gleichem ETag).</summary>
    private static (NinaTargets?, string?) Serve(string? callerEtag, NinaTargets targets, string etag) =>
        callerEtag == etag ? (null, callerEtag) : (targets, etag);

    [Fact]
    public async Task Neue_Ziele_vor_dem_Block_refresh_ab_Blockstart_danach_laeuft_der_Block()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default); // Plan 01:00, Sperre bis 01:05
        Assert.Single(nina.PlansBuilt);
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z"); // regulärer Block beginnt
        var changed = Example<NinaTargets>("targets.response");
        api.OnTargets = e => Serve(e, changed, "\"t-2\"");

        await runner.RunOnceAsync(default);

        Assert.Equal(2, api.Plans.Count);
        Assert.Equal(NinaPlanRequestReason.Refresh, api.Plans[^1].Reason);
        Assert.Equal(UtcText.Parse("2026-09-18T07:35:00Z"), api.Plans[^1].StartAtUtc);
        Assert.DoesNotContain(sink.Lines, l => l.Contains("BLOCK_START"));
        Assert.Contains(sink.Lines, l => l.Contains("PLAN_REBUILT") && l.Contains("reason=refresh"));

        // Keine Änderung mehr (ETag des neuen Plans = aktuelles) → kein neuer Plan, der Block startet.
        nina.ExposureScale = 0.02;
        await runner.RunOnceAsync(default);
        Assert.Equal(2, api.Plans.Count);
        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_START"));
    }

    /// <summary>
    /// Plan mit Lücke wie im VM-Lauf real-full-night (05.10.2026): regulärer Block 07:35–08:00, der nächste erst 08:35.
    /// </summary>
    private static void WithGap(NinaPlanResponse p)
    {
        var regular = p.Blocks.Single(b => b.Kind == BlocksKind.Regular);
        p.Blocks.RemoveAll(b => b.Kind == BlocksKind.Transit);
        var later = JsonConvert.DeserializeObject<Blocks>(JsonConvert.SerializeObject(regular, NinaJson.Settings()), NinaJson.Settings())!;
        later.Id = Guid.NewGuid();
        later.StartUtc = later.StartUtc.AddMinutes(60);
        later.EndUtc = later.EndUtc.AddMinutes(60);
        foreach (var e in later.Entries) e.AtUtc = e.AtUtc.AddMinutes(60);
        var cut = UtcText.Parse("2026-09-18T08:00:00Z");
        regular.Entries.RemoveAll(e => e.AtUtc >= cut);
        regular.EndUtc = cut;
        p.Blocks.Add(later);
    }

    [Fact]
    public async Task Luecke_vor_dem_naechsten_Block_einmal_ab_jetzt_neu_planen()
    {
        // Analyse 05.10.2026: ein Projekt war vor dem Ende seines Laufs fertig, die Engine gab den Rest frei (idle_gap);
        // die Neuplanung ab dem geplanten Blockstart ließ 10 von 40 min leer.
        api.OnPlan = WithGap;
        var runner = Runner();
        await runner.RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");
        nina.ExposureScale = 0.02;
        await runner.RunOnceAsync(default); // Block 07:35–08:00
        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_END"));
        var plans = api.Plans.Count;

        await runner.RunOnceAsync(default); // Lücke bis 08:35 → refresh ab jetzt
        Assert.Equal(plans + 1, api.Plans.Count);
        Assert.Equal(NinaPlanRequestReason.Refresh, api.Plans[^1].Reason);
        Assert.True(api.Plans[^1].StartAtUtc < UtcText.Parse("2026-09-18T08:35:00Z"), api.Plans[^1].StartAtUtc?.ToString("O"));
        Assert.Contains(sink.Lines, l => l.Contains("IdleAhead"));

        // Der neue Plan hat wieder eine Lücke (nichts anderes zu tun): nicht noch einmal planen, sondern warten.
        clock.UtcNow = clock.UtcNow.AddMinutes(6);
        await runner.RunOnceAsync(default);
        Assert.Equal(plans + 1, api.Plans.Count);
    }

    /// <summary>
    /// Wie in der Rig-Nacht 06.10.2026: Block mit einer einzigen Belichtung, Plan rechnet 30 s Zentrieren (Attrappe 90 s),
    /// Blockende = Ende der Belichtung; der nächste Block beginnt direkt danach (kein weiches Blockende möglich).
    /// </summary>
    private static void SingleTightExposure(NinaPlanResponse p)
    {
        var regular = p.Blocks.Single(b => b.Kind == BlocksKind.Regular);
        p.Blocks.RemoveAll(b => b.Kind == BlocksKind.Transit);
        var slew = regular.Entries.Single(e => e.Seq == 1);
        var filter = regular.Entries.Single(e => e.Seq == 3);
        var expose = regular.Entries.Single(e => e.Seq == 4);
        var end = regular.Entries.Single(e => e.Cmd == EntriesCmd.End);
        slew.DurationS = 30;
        filter.AtUtc = UtcText.Parse("2026-09-18T07:35:30Z");
        expose.AtUtc = UtcText.Parse("2026-09-18T07:35:40Z");
        end.AtUtc = UtcText.Parse("2026-09-18T07:40:43Z");
        regular.Entries = [slew, filter, expose, end];
        regular.EndUtc = end.AtUtc;
        regular.MeridianFlip = null;
        var shift = end.AtUtc - regular.StartUtc;
        var next = JsonConvert.DeserializeObject<Blocks>(JsonConvert.SerializeObject(regular, NinaJson.Settings()), NinaJson.Settings())!;
        next.Id = Guid.NewGuid();
        next.StartUtc += shift;
        next.EndUtc += shift;
        foreach (var e in next.Entries) e.AtUtc += shift;
        p.Blocks.Add(next);
    }

    [Fact]
    public async Task Leerer_Block_sofort_neu_planen_einmal_je_Einheit()
    {
        // Rig-Nacht 06.10.2026: nach Slew und Zentrieren passte die einzige Belichtung nicht mehr; das Plugin fuhr bis zum
        // Morgen alle 5 min (Sperre) neu an, ohne zu belichten.
        api.OnPlan = SingleTightExposure;
        var runner = Runner();
        await runner.RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");
        await runner.RunOnceAsync(default);
        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_END") && l.Contains("reason=completed"));
        Assert.Equal(0, nina.Exposures);
        Assert.Contains(sink.Lines, l => l.Contains("EmptyBlock"));
        var plans = api.Plans.Count;

        await runner.RunOnceAsync(default); // trotz Sperre sofort ab jetzt
        Assert.Equal(plans + 1, api.Plans.Count);
        Assert.Equal(NinaPlanRequestReason.Refresh, api.Plans[^1].Reason);
        Assert.Equal(clock.UtcNow, api.Plans[^1].StartAtUtc);

        await runner.RunOnceAsync(default); // derselbe Block wieder leer – kein zweites Mal ohne Sperre
        Assert.Single(sink.Lines, l => l.Contains("EmptyBlock"));
        await runner.RunOnceAsync(default);
        Assert.Equal(plans + 1, api.Plans.Count);
    }

    [Fact]
    public async Task Vor_dem_ersten_Block_der_Nacht_keine_Lueckenplanung()
    {
        // Abends wartet das Plugin auf den ersten Block – das ist keine Lücke.
        api.OnPlan = WithGap;
        var runner = Runner();
        await runner.RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T06:00:00Z");
        await runner.RunOnceAsync(default);
        Assert.Single(api.Plans);
    }

    [Fact]
    public async Task Verzug_ueber_10_min_refresh_ab_jetzt_ohne_Dauerschleife()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T07:50:00Z"); // 15 min hinter dem Blockstart 07:35

        await runner.RunOnceAsync(default);
        Assert.Equal(2, api.Plans.Count);
        Assert.Equal(UtcText.Parse("2026-09-18T07:50:00Z"), api.Plans[^1].StartAtUtc);

        // Der Server liefert denselben (weiter verspäteten) Block: während der 5-min-Sperre nicht noch einmal planen.
        nina.ExposureScale = 0.02;
        await runner.RunOnceAsync(default);
        Assert.Equal(2, api.Plans.Count);
        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_START"));
    }

    [Fact]
    public async Task Im_Block_Projekt_pausiert_Fall_a_target_removed_und_sofort_refresh()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var block = PlanStore.Load(store, "2026-09-17")!.Plan.Blocks[1];
        var original = Example<NinaTargets>("targets.response");
        var paused = Example<NinaTargets>("targets.response");
        paused.Projects.First(p => p.Id == block.ProjectId).Status = ProjectsStatus.On_hold;
        // Ab 07:55 ist das Projekt pausiert (neues ETag); vorher die ursprünglichen Ziele.
        api.OnTargets = e => clock.UtcNow >= UtcText.Parse("2026-09-18T07:55:00Z")
            ? Serve(e, paused, "\"t-3\"")
            : Serve(e, original, "\"t-9b41\"");
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");

        await runner.RunOnceAsync(default);

        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_END") && l.EndsWith("reason=target_removed", StringComparison.Ordinal));
        Assert.True(clock.UtcNow < UtcText.Parse("2026-09-18T08:20:00Z")); // nicht bis Blockende 09:20 weiterbelichtet
        var plans = api.Plans.Count;

        await runner.RunOnceAsync(default); // sofort, trotz Sperre
        Assert.Equal(plans + 1, api.Plans.Count);
        Assert.Equal(NinaPlanRequestReason.Refresh, api.Plans[^1].Reason);
        Assert.Equal(clock.UtcNow, api.Plans[^1].StartAtUtc);
    }

    [Fact]
    public async Task Im_Block_andere_Aenderung_Fall_c_Block_laeuft_weiter()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var block = PlanStore.Load(store, "2026-09-17")!.Plan.Blocks[1];
        var original = Example<NinaTargets>("targets.response");
        var other = Example<NinaTargets>("targets.response");
        other.Projects.First(p => p.Id != block.ProjectId).Status = ProjectsStatus.On_hold; // anderes Projekt
        api.OnTargets = e => clock.UtcNow >= UtcText.Parse("2026-09-18T07:55:00Z")
            ? Serve(e, other, "\"t-4\"")
            : Serve(e, original, "\"t-9b41\"");
        nina.ExposureScale = 0.2;
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");

        await runner.RunOnceAsync(default);

        Assert.DoesNotContain(sink.Lines, l => l.Contains("reason=target_removed"));
        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_END") && l.Contains("reason=completed"));
        Assert.Single(api.Plans); // im Block kein neuer Plan; das neue ETag sieht die Neuplanung vor dem nächsten Block
    }

    // ---- Heartbeat, Lease, Outbox, Meldungen (AP-16e, execution.md §4.3/§6) ------------------------------------

    private sealed class NoSettings : INinaSettingsSource
    {
        public NinaHeartbeat Snapshot() => new();
    }

    private HeartbeatService Heartbeat(NightRunner runner) =>
        new(api, runner, new NoSettings(), new OutboxSender(store, api, new NinaPmLog(sink), clock) { Listener = runner }, clock, new NinaPmLog(sink), "0.2.0");

    private CaptureFacts Facts(NightRunner runner, int n)
    {
        var plan = PlanStore.Load(store, "2026-09-17")!.Plan;
        var block = plan.Blocks[1];
        var entry = block.Entries.First(e => e.Cmd == EntriesCmd.Expose);
        var start = UtcText.Parse("2026-09-18T07:42:40Z").AddMinutes(5 * n);
        return new CaptureFacts(Guid.NewGuid(), plan.Night, plan.NightPlanId, block, entry, start, start.AddSeconds(150),
            "Ha 3nm", 300, null, null, 1, null, null, 0, CapturesPierSide.West, false, null);
    }

    [Fact]
    public async Task Heartbeat_meldet_Zustand_und_Session_unabhaengig_von_der_Sequenz()
    {
        var runner = Runner();
        var hb = Heartbeat(runner);
        await hb.TickAsync(default); // vor dem ersten Aufruf: ohne Session
        await runner.RunOnceAsync(default); // Plan + Session
        await hb.TickAsync(default);

        Assert.Null(api.Heartbeats[0].SessionId);
        // Vor dem ersten Bootstrap (NINA läuft am Nachmittag, Sequenz wartet aufs Dach): eigene Engine-Version, kein "" (422).
        Assert.Equal(EngineVersionInfo.Version, api.Heartbeats[0].EngineVersion);
        Assert.Matches(@"^\d+\.\d+\.\d+", api.Heartbeats[0].EngineVersion);
        Assert.Equal(NinaHeartbeatState.Idle, api.Heartbeats[1].State); // wartet auf den Block
        Assert.Equal(runner.SessionId, api.Heartbeats[1].SessionId);
        Assert.Equal("0.2.0", api.Heartbeats[1].PluginVersion);
        Assert.Equal(LeaseState.Held, runner.Lease.State);
        Assert.Contains(sink.Lines, l => l.Contains("HEARTBEAT state=idle"));
    }

    [Fact]
    public async Task Neues_targets_ETag_im_Heartbeat_markiert_Ziele_als_geaendert_bis_zum_Abruf()
    {
        // P-05 prod 03.10.2026: im Web bestätigte Filternamen sollen die laufende Prüfung im Block sofort erreichen.
        var runner = Runner();
        var hb = Heartbeat(runner);
        await runner.RunOnceAsync(default); // Ziele mit "t-9b41" im Cache
        var etag = "\"t-9b41\"";
        api.OnHeartbeat = _ => new NinaHeartbeatResponse
        {
            ServerTimeUtc = clock.UtcNow, Lease = new Lease { LeaseLost = false }, SettingsVersion = 0, TargetsEtag = etag,
        };
        await hb.TickAsync(default);
        Assert.False(runner.TargetsChanged);

        etag = "\"t-2\"";
        await hb.TickAsync(default);
        Assert.True(runner.TargetsChanged);

        var changed = Example<NinaTargets>("targets.response");
        api.OnTargets = e => Serve(e, changed, "\"t-2\"");
        await runner.RefreshAsync(default);
        Assert.False(runner.TargetsChanged);
        await hb.TickAsync(default); // Cache hat jetzt "t-2"
        Assert.False(runner.TargetsChanged);
    }

    [Fact]
    public async Task LeaseLost_sperrt_neue_Bloecke_leaseLost_false_holt_die_Lease_zurueck()
    {
        var runner = Runner();
        var hb = Heartbeat(runner);
        await runner.RunOnceAsync(default);
        var lost = true;
        api.OnHeartbeat = _ => new NinaHeartbeatResponse
        {
            ServerTimeUtc = clock.UtcNow, Lease = new Lease { LeaseLost = lost }, SettingsVersion = 0, TargetsEtag = "\"t-9b41\"",
        };

        await hb.TickAsync(default);
        Assert.Equal(NinaHeartbeatBlockedReason.Lease_lost, runner.Loop.Blocked);
        Assert.Contains(api.EventBatches.SelectMany(b => b.Batch.Events), e => e.Kind == EventsKind.Lease_lost);
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");
        await runner.RunOnceAsync(default); // gesperrt: 60 s warten statt Block
        Assert.DoesNotContain(sink.Lines, l => l.Contains("BLOCK_START"));

        lost = false;
        await hb.TickAsync(default);
        Assert.Null(runner.Loop.Blocked);
        Assert.Equal(LeaseState.Held, runner.Lease.State);
        Assert.Contains(api.EventBatches.SelectMany(b => b.Batch.Events), e => e.Kind == EventsKind.Lease_regained);
    }

    [Fact]
    public async Task Drei_Heartbeats_ohne_Antwort_unreachable_Ereignisse_in_Reihenfolge_nachgesendet()
    {
        var runner = Runner();
        var hb = Heartbeat(runner);
        await runner.RunOnceAsync(default);
        api.Offline = true;
        for (var i = 0; i < 3; i++) await hb.TickAsync(default);
        Assert.Equal(LeaseState.Unreachable, runner.Lease.State);
        Assert.Null(runner.Loop.Blocked); // Blöcke laufen weiter
        Assert.Contains(sink.Lines, l => l.Contains("LEASE state=unreachable"));

        api.Offline = false;
        await hb.TickAsync(default);
        Assert.Equal(LeaseState.Held, runner.Lease.State);
        var kinds = api.EventBatches.SelectMany(b => b.Batch.Events).Select(e => e.Kind).ToList();
        Assert.Equal([EventsKind.Offline_start, EventsKind.Offline_end], kinds);
    }

    [Fact]
    public async Task Aufnahmen_in_der_Outbox_FIFO_scheitern_nie_endgueltig_OUTBOX_pending_0()
    {
        var runner = Runner();
        var hb = Heartbeat(runner);
        await runner.RunOnceAsync(default);
        var first = Facts(runner, 0);
        var second = Facts(runner, 1);
        runner.ReportCapture(first, CapturesResult.Saved, "a.fits");
        runner.ReportCapture(second, CapturesResult.Failed, null);
        api.ReportsFail = true;

        await hb.TickAsync(default);
        Assert.Empty(api.CaptureBatches);
        Assert.Equal(2, runner.OutboxPending);

        api.ReportsFail = false;
        clock.Advance(TimeSpan.FromMinutes(1)); // Backoff 1 min nach dem ersten Fehlschlag (§8)
        await hb.TickAsync(default);
        Assert.Equal(2, api.Heartbeats[^1].OutboxPending); // Stand beim Senden des Heartbeats
        var batch = Assert.Single(api.CaptureBatches);
        Assert.Equal(runner.SessionId, batch.Session);
        Assert.Equal([first.CaptureId, second.CaptureId], batch.Batch.Captures.Select(c => c.Id));
        Assert.Equal(first.ExposureMidUtc, batch.Batch.Captures[0].ExposureMidUtc);
        Assert.Equal((CapturesResult.Saved, "a.fits"), (batch.Batch.Captures[0].Result, batch.Batch.Captures[0].FileName));
        Assert.Equal(0, runner.OutboxPending);
        Assert.Contains(sink.Lines, l => l.Contains("OUTBOX pending=0"));
    }

    [Fact]
    public async Task Uhrabweichung_ueber_60_s_aus_der_Heartbeat_Antwort_sperrt()
    {
        var runner = Runner();
        var hb = Heartbeat(runner);
        await runner.RunOnceAsync(default);
        api.OnHeartbeat = _ => new NinaHeartbeatResponse
        {
            ServerTimeUtc = clock.UtcNow.AddMinutes(2), Lease = new Lease { LeaseLost = false }, SettingsVersion = 0, TargetsEtag = "x",
        };
        await hb.TickAsync(default);
        Assert.Equal(NinaHeartbeatBlockedReason.Clock_skew, runner.Loop.Blocked);
    }

    [Fact]
    public async Task Uhrabweichung_5_bis_60_s_warnt_clock_drift_einmal_und_sperrt_nicht()
    {
        var runner = Runner();
        var hb = Heartbeat(runner);
        await runner.RunOnceAsync(default);
        api.OnHeartbeat = _ => new NinaHeartbeatResponse
        {
            ServerTimeUtc = clock.UtcNow.AddSeconds(20), Lease = new Lease { LeaseLost = false }, SettingsVersion = 0, TargetsEtag = "x",
        };
        await hb.TickAsync(default);
        await hb.TickAsync(default);
        Assert.Null(runner.Loop.Blocked);
        Assert.Single(sink.Lines, l => l.Contains("WARNING code=clock_drift"));
        Assert.Contains(api.EventBatches.SelectMany(b => b.Batch.Events), e => e.Code == "clock_drift");
    }

    [Fact]
    public async Task Fehler_im_Block_beendet_ihn_mit_error_ohne_Wiederholung()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");
        nina.FailAtExposure = 2;

        await runner.RunOnceAsync(default); // kein Wurf nach außen

        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_END") && l.EndsWith("reason=error", StringComparison.Ordinal));
        Assert.Contains(sink.Lines, l => l.Contains("ERROR code=block_failed"));
        var starts = sink.Lines.Count(l => l.Contains("BLOCK_START"));
        await runner.RunOnceAsync(default);
        Assert.Equal(starts, sink.Lines.Count(l => l.Contains("BLOCK_START")));
    }

    [Fact]
    public async Task Gesperrter_Zustand_wartet_60_s_statt_sofort_zurueckzukehren()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        runner.Loop.Block(NinaHeartbeatBlockedReason.Lease_lost, clock.UtcNow);

        await runner.RunOnceAsync(default);

        Assert.Equal($"delay:{UtcText.Format(clock.UtcNow)}", nina.Calls[^1]);
        Assert.Equal(UtcText.Parse("2026-09-18T01:01:00Z"), clock.UtcNow);
        Assert.Equal(NinaHeartbeatState.Blocked, runner.HeartbeatState(false));
    }

    [Fact]
    public async Task Rig_busy_bei_der_Session_nur_Simulation_Schleife_endet()
    {
        api.OnCreate = _ => throw new NinaApiException("busy", 409,
            """{"type":"about:blank","title":"x","status":409,"code":"session.rig_busy"}""", new Dictionary<string, IEnumerable<string>>(), null);
        var runner = Runner();
        await runner.RunOnceAsync(default);
        Assert.Equal(NinaHeartbeatBlockedReason.Rig_busy, runner.Loop.Blocked);
        Assert.False(runner.HasBlocksRemaining);
    }

    [Fact]
    public async Task Abschluss_zaehlt_nur_offene_Meldungen_der_eigenen_Session()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        // Rest einer früheren Session (z. B. nach langem Offline-Betrieb) hält den Abschluss nicht auf.
        store.EnqueueOutbox(OutboxKinds.Event, "{}", Guid.NewGuid(), null);
        clock.UtcNow = UtcText.Parse("2026-09-18T11:31:00Z");

        await runner.RunOnceAsync(default);
        var patch = Assert.Single(api.Patches);
        Assert.Equal(NinaSessionPatchStatus.Completed, patch.Patch.Status);
        Assert.Equal(0, patch.Patch.OutboxPending);
        Assert.Equal(1, runner.OutboxPending); // Heartbeat und Anzeige zählen weiter alles
    }

    [Fact]
    public async Task Nachtende_PATCH_completed_dann_nightFinished_dann_false()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T11:31:00Z");

        await runner.RunOnceAsync(default);
        var patch = Assert.Single(api.Patches);
        Assert.Equal(NinaSessionPatchStatus.Completed, patch.Patch.Status);
        Assert.Equal(0, patch.Patch.OutboxPending);
        Assert.True(runner.HasBlocksRemaining);

        await runner.RunOnceAsync(default);
        Assert.False(runner.HasBlocksRemaining);
        Assert.Single(api.Patches); // kein Wiederöffnen
    }

    [Fact]
    public async Task Unterbrechung_SAFETY_PAUSE_dann_SAFETY_RESUME_und_reason_resume()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");
        nina.CancelAtExposure = 2;
        nina.Safety = new SafetyState(AncestorHasSafetyCondition: true, MonitorConnected: true, MonitorSafe: false);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => runner.RunOnceAsync(nina.Sequence.Token));

        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_END") && l.EndsWith("reason=interrupted", StringComparison.Ordinal));
        Assert.Contains(sink.Lines, l => l.Contains("SAFETY_PAUSE"));
        Assert.Equal(NinaHeartbeatState.Paused, runner.HeartbeatState(false));
        Assert.Equal(1, nina.Interruptions);
        Assert.Empty(api.Patches); // Session und Lease bleiben

        await runner.RunOnceAsync(default);
        Assert.Contains(sink.Lines, l => l.Contains("SAFETY_RESUME"));
        Assert.Equal(NinaPlanRequestReason.Resume, api.Plans[^1].Reason);
        Assert.NotNull(runner.SessionId);
    }

    [Fact]
    public async Task Benutzer_Stopp_user_skip_PATCH_aborted_Session_vergessen()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var session = runner.SessionId;
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");
        nina.CancelAtExposure = 1;
        nina.Safety = new SafetyState(true, true, MonitorSafe: true);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => runner.RunOnceAsync(nina.Sequence.Token));

        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_END") && l.EndsWith("reason=user_skip", StringComparison.Ordinal));
        var patch = Assert.Single(api.Patches);
        Assert.Equal((session!.Value, NinaSessionPatchStatus.Aborted), (patch.Id, patch.Patch.Status!.Value));
        Assert.Null(runner.SessionId);

        // Neustart in derselben Nacht → neue Session.
        await runner.RunOnceAsync(default);
        Assert.Equal(2, api.Created.Count);
        Assert.NotEqual(session, runner.SessionId);
    }

    [Fact]
    public async Task Benutzer_Stopp_beim_Warten_auf_den_Block_PATCH_aborted()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        nina.Sequence.Cancel();
        nina.Safety = new SafetyState(true, true, MonitorSafe: true);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => runner.RunOnceAsync(nina.Sequence.Token));

        Assert.Equal(NinaSessionPatchStatus.Aborted, Assert.Single(api.Patches).Patch.Status);
        Assert.Null(runner.SessionId);
    }

    [Fact]
    public async Task Unterbrechung_beim_Warten_auf_den_Block_SAFETY_PAUSE_ohne_PATCH()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        nina.Sequence.Cancel();
        nina.Safety = new SafetyState(true, true, MonitorSafe: false);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => runner.RunOnceAsync(nina.Sequence.Token));

        Assert.Empty(api.Patches);
        Assert.Contains(sink.Lines, l => l.Contains("SAFETY_PAUSE"));
        Assert.Equal(NinaHeartbeatState.Paused, runner.HeartbeatState(false));
    }

    [Fact]
    public async Task Start_ohne_Verbindung_und_ohne_gespeicherten_Plan_keine_Bloecke()
    {
        api.Offline = true;
        store.PutCache(NightRunner.BootstrapCacheKey, ContractExamples.Json("bootstrap.response"), null);
        var runner = Runner();

        await runner.RunOnceAsync(default);

        Assert.True(runner.Loop.PlanFailed);
        Assert.Equal(NinaHeartbeatState.Blocked, runner.HeartbeatState(false));
        Assert.Empty(api.Created);
    }

    [Fact]
    public async Task Neustart_ohne_Verbindung_arbeitet_den_gespeicherten_Plan_weiter_ab()
    {
        await Runner().RunOnceAsync(default); // online: Plan und Session gespeichert
        api.Offline = true;
        clock.UtcNow = UtcText.Parse("2026-09-18T07:40:00Z");
        var restarted = Runner();

        await restarted.RunOnceAsync(default); // resume scheitert ohne Netz → gespeicherter Plan
        Assert.False(restarted.Loop.PlanFailed);
        await restarted.RunOnceAsync(default); // regulärer Block nach der Uhr

        Assert.Contains(nina.Calls, c => c.StartsWith("expose:", StringComparison.Ordinal));
        Assert.Equal("1", store.GetState(StateKeys.BlockIndex));
        // tonight: der ausgeführte Block steht als vergangener Block der Einheit drin (allocation.md §5.3).
        var tonight = TonightLog.Load(store).ToContract(null, initial: false);
        Assert.Equal(restarted.UnitId(PlanStore.Load(store, "2026-09-17")!.Plan.Blocks[1]), Assert.Single(tonight.PastBlocks!).UnitId);
    }

    [Fact]
    public async Task Neustart_online_mit_Session_plant_mit_reason_resume()
    {
        await Runner().RunOnceAsync(default);
        var session = Assert.Single(api.Created).Id;
        clock.UtcNow = UtcText.Parse("2026-09-18T05:00:00Z");

        await Runner().RunOnceAsync(default);

        Assert.Equal(NinaPlanRequestReason.Resume, api.Plans[^1].Reason);
        Assert.Equal(session, api.Plans[^1].SessionId);
        Assert.Single(api.Created); // dieselbe Session aus ninapm.db (NIN-8)
    }

    [Fact]
    public async Task Neustart_ohne_Session_mit_gespeichertem_Plan_plant_initial_und_legt_neue_Session_an()
    {
        // Lauf 02.10.2026: Benutzer-Stopp am Mittag, NINA neu gestartet – der Plan der Nacht lag noch in ninapm.db.
        // Vorher: Grund refresh bzw. bei offenen Blöcken gar kein Abruf und Blöcke ohne Session.
        var first = Runner();
        await first.RunOnceAsync(default);
        var oldSession = Assert.Single(api.Created).Id;
        first.UserStopped();
        Assert.Null(first.SessionId);
        Assert.NotNull(PlanStore.Load(store, "2026-09-17")); // Plan mit offenen Blöcken bleibt gespeichert

        var restarted = Runner();
        await restarted.RunOnceAsync(default);

        Assert.Equal(NinaPlanRequestReason.Initial, api.Plans[^1].Reason);
        Assert.Null(api.Plans[^1].SessionId);
        Assert.Equal(2, api.Created.Count);
        Assert.NotEqual(oldSession, restarted.SessionId);
    }

    [Fact]
    public async Task Unsicher_bis_Nachtende_schliesst_die_Nacht_ohne_Wiederaufnahme()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        Assert.Equal(UtcText.Parse("2026-09-18T11:30:42Z"), runner.NightEndUtc());
        // Offline-Modus gilt nur für diese Nacht: offlineUntil = Ende des Nachtfensters (Flats eingeschlossen).
        Assert.Equal(UtcText.Parse("2026-09-18T13:00:00Z"), runner.OfflineUntilUtc());

        await runner.CloseNightUnsafeAsync(default);

        Assert.Equal(NinaSessionPatchStatus.Completed, Assert.Single(api.Patches).Patch.Status);
        Assert.False(runner.HasBlocksRemaining);
        Assert.Null(runner.SessionId);
    }

    // ---- Warten bis sicher oder Nachtende (H2), Einordnung des Abbruchs (§4.6) -------------------------------

    [Theory]
    [InlineData("2026-09-18T09:00:00Z", true, false, SafetyWaitResult.Wait)]
    [InlineData("2026-09-18T09:00:00Z", true, true, SafetyWaitResult.Safe)]
    [InlineData("2026-09-18T11:30:42Z", true, false, SafetyWaitResult.CloseNight)]
    [InlineData("2026-09-18T11:30:42Z", true, true, SafetyWaitResult.Safe)]
    // Getrennt zählt wie unsicher: warten bzw. am Nachtende abschließen, nie sofort zurück (Park/Unpark im Takt, 02.10.2026).
    [InlineData("2026-09-18T09:00:00Z", false, false, SafetyWaitResult.Wait)]
    [InlineData("2026-09-18T09:00:00Z", false, true, SafetyWaitResult.Wait)]
    [InlineData("2026-09-18T11:30:42Z", false, false, SafetyWaitResult.CloseNight)]
    public void Warten_bis_sicher_oder_Nachtende(string now, bool connected, bool safe, SafetyWaitResult expected) =>
        Assert.Equal(expected, Interruption.SafetyWaitStep(UtcText.Parse(now), UtcText.Parse("2026-09-18T11:30:42Z"), connected, safe));

    [Theory]
    [InlineData(false, true, true, false, CancelKind.Interrupt)]
    [InlineData(false, true, false, false, CancelKind.Interrupt)]
    [InlineData(false, true, true, true, CancelKind.UserAbort)]
    [InlineData(false, false, true, false, CancelKind.UserAbort)]
    [InlineData(true, true, true, false, CancelKind.Own)]
    public void Unterbrechung_oder_Benutzerabbruch(bool own, bool safetyCondition, bool connected, bool safe, CancelKind expected) =>
        Assert.Equal(expected, Interruption.Classify(own, new SafetyState(safetyCondition, connected, safe)));

    // ---- vorgezogen aus AP-16g: Session-PATCH über die Outbox (execution.md §6 Neustart, §8 NIN5-7) ------------

    private static NinaApiException Problem(int status, string code) =>
        new("Problem", status, $"{{\"code\":\"{code}\"}}", new Dictionary<string, IEnumerable<string>>(), null);

    private OutboxSender Outbox(NightRunner runner) => new(store, api, new NinaPmLog(sink), clock) { Listener = runner };

    [Fact]
    public async Task Neustart_mit_Session_stellt_PATCH_running_in_die_Outbox_die_Antwort_haelt_die_Lease()
    {
        await Runner().RunOnceAsync(default);
        var session = Assert.Single(api.Created).Id;
        clock.UtcNow = UtcText.Parse("2026-09-18T05:00:00Z");
        var restarted = Runner();

        await restarted.RunOnceAsync(default);

        Assert.Equal(LeaseState.Reacquiring, restarted.Lease.State);
        Assert.Empty(api.Patches); // die Blöcke warten nicht darauf
        await Outbox(restarted).FlushAsync(default);
        var (id, patch) = Assert.Single(api.Patches);
        Assert.Equal((session, NinaSessionPatchStatus.Running), (id, patch.Status));
        Assert.NotNull(patch.ResumedAtUtc);
        Assert.Equal(LeaseState.Held, restarted.Lease.State);
        Assert.Contains(sink.Lines, l => l.Contains("LEASE_REGAINED"));
    }

    [Fact]
    public async Task Rig_belegt_beim_Fortsetzen_sperrt_rig_busy_und_beendet_die_Session()
    {
        await Runner().RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T05:00:00Z");
        var restarted = Runner();
        await restarted.RunOnceAsync(default);
        api.OnPatch = (_, p) => p.Status == NinaSessionPatchStatus.Running ? throw Problem(409, "session.rig_busy") : new NinaSessionPatched();

        await Outbox(restarted).FlushAsync(default);

        Assert.Equal(NinaHeartbeatBlockedReason.Rig_busy, restarted.Loop.Blocked);
        Assert.Null(restarted.SessionId);
        Assert.Contains(api.Patches, p => p.Patch.Status == NinaSessionPatchStatus.Aborted);
        Assert.Equal(0, store.OutboxCount()); // 409 wird nicht wiederholt
        Assert.False(restarted.HasBlocksRemaining);
        // Eine spätere Heartbeat-Antwort „Lease weg“ macht daraus keine wiederherstellbare Sperre (P-10).
        restarted.HeartbeatAnswered(new NinaHeartbeatResponse { ServerTimeUtc = clock.UtcNow, Lease = new Lease { LeaseLost = true } }, clock.UtcNow);
        Assert.Equal(NinaHeartbeatBlockedReason.Rig_busy, restarted.Loop.Blocked);
    }

    [Fact]
    public async Task Veraltetes_PATCH_running_nach_Abschluss_wird_verworfen()
    {
        await Runner().RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T05:00:00Z");
        var restarted = Runner();
        await restarted.RunOnceAsync(default);
        restarted.UserStopped(); // Session vergessen, bevor die Outbox das Fortsetzen sendet

        await Outbox(restarted).FlushAsync(default);

        Assert.DoesNotContain(api.Patches, p => p.Patch.Status == NinaSessionPatchStatus.Running);
        Assert.Equal(0, store.OutboxCount());
    }

    [Fact]
    public async Task Abschluss_ohne_Antwort_wandert_in_die_Outbox_und_meldet_den_Stand_beim_Senden()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var session = runner.SessionId!.Value;
        runner.ReportCapture(Facts(runner, 0), CapturesResult.Saved, "a.fits");
        api.ReportsFail = true; // Netz weg: auch der PATCH scheitert

        await runner.CloseNightUnsafeAsync(default);

        Assert.Equal(2, store.OutboxCount()); // Aufnahme + Abschluss-PATCH, in dieser Reihenfolge
        api.ReportsFail = false;
        await Outbox(runner).FlushAsync(default);
        var completed = Assert.Single(api.Patches);
        Assert.Equal((session, NinaSessionPatchStatus.Completed, 0), (completed.Id, completed.Patch.Status, completed.Patch.OutboxPending));
        Assert.Single(api.CaptureBatches);
        Assert.Contains(sink.Lines, l => l.Contains("SESSION") && l.Contains("status=completed") && l.Contains("pending=0"));
        Assert.Null(OutboxSender.CompletedSession(store));
    }

    [Fact]
    public async Task Abschluss_mit_offenen_Meldungen_meldet_nach_dem_Leeren_pending_0()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        runner.ReportCapture(Facts(runner, 0), CapturesResult.Saved, "a.fits");
        api.ReportsFail = true;
        await Outbox(runner).FlushAsync(default); // scheitert, Aufnahme bleibt
        api.ReportsFail = false;
        api.OnPatch = null;

        await runner.CloseNightUnsafeAsync(default); // PATCH sofort mit pending=1 (NIN5-7)
        Assert.Equal(1, api.Patches[^1].Patch.OutboxPending);
        clock.Advance(TimeSpan.FromMinutes(1)); // Backoff nach dem Fehlschlag
        await Outbox(runner).FlushAsync(default);

        Assert.Equal(2, api.Patches.Count);
        Assert.Equal((NinaSessionPatchStatus.Completed, 0), (api.Patches[^1].Patch.Status, api.Patches[^1].Patch.OutboxPending));
        Assert.Null(OutboxSender.CompletedSession(store));
    }

    [Fact]
    public async Task Abbruch_mit_offenen_Meldungen_meldet_aborted_nach_dem_Leeren_pending_0()
    {
        // Analyse 04.10.2026: vorher nur für completed – nach einem Benutzer-Stopp liefen Abschluss und Bericht erst nach 6 h.
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var session = runner.SessionId!.Value;
        runner.ReportCapture(Facts(runner, 0), CapturesResult.Saved, "a.fits");
        api.ReportsFail = true;
        await Outbox(runner).FlushAsync(default);
        api.ReportsFail = false;

        runner.UserStopped();
        await Task.Delay(50); // PATCH aborted läuft ohne Warten (wie im Adapter)
        Assert.Equal((session, NinaSessionPatchStatus.Aborted, 1), (api.Patches[^1].Id, api.Patches[^1].Patch.Status, api.Patches[^1].Patch.OutboxPending));
        clock.Advance(TimeSpan.FromMinutes(1));
        await Outbox(runner).FlushAsync(default);

        Assert.Equal((session, NinaSessionPatchStatus.Aborted, 0), (api.Patches[^1].Id, api.Patches[^1].Patch.Status, api.Patches[^1].Patch.OutboxPending));
        Assert.Null(OutboxSender.CompletedSession(store));
    }

    [Fact]
    public async Task Abschluss_im_Offline_Modus_ruft_nichts_auf_und_wartet_in_der_Outbox()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        runner.OfflineMode = true;
        var patches = api.Patches.Count;

        await runner.CloseNightUnsafeAsync(default);

        Assert.Equal(patches, api.Patches.Count);
        Assert.Contains(store.OutboxPeek(50), e => e.Kind == OutboxKinds.SessionPatch);
    }

    // ---- AP-16g: Fehlerklassen der Outbox, Offline-Session, Offline-Modus, Bedienung (execution.md §2, §6, §8) ----

    private static NinaApiException ProblemWithErrors(int status, string code, params string[] paths) =>
        new("Problem", status,
            JsonConvert.SerializeObject(new { code, errors = paths.Select(p => new { path = p, message = "x" }) }),
            new Dictionary<string, IEnumerable<string>>(), null);

    [Fact]
    public async Task Netzfehler_Backoff_1_2_5_15_60_min_und_danach_gesendet()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        runner.ReportCapture(Facts(runner, 0), CapturesResult.Saved, "a.fits");
        var outbox = Outbox(runner);
        api.ReportsFail = true;
        foreach (var minutes in new[] { 1, 2, 5, 15, 60, 60 })
        {
            await outbox.FlushAsync(default);
            var head = store.OutboxHead()!.Value;
            Assert.Equal(clock.UtcNow.AddMinutes(minutes), head.NextAttemptUtc);
            await outbox.FlushAsync(default); // vor Ablauf: kein Versuch
            Assert.Equal(head, store.OutboxHead());
            clock.UtcNow = head.NextAttemptUtc;
        }
        api.ReportsFail = false;
        Assert.True(await outbox.FlushAsync(default));
        Assert.Single(api.CaptureBatches);
        Assert.Equal(0, store.DeadLetterCount());
    }

    [Fact]
    public async Task Session_closed_ins_Dead_Letter_mit_Hinweis_413_halbiert_422_nur_beanstandete()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var facts = Enumerable.Range(0, 4).Select(i => Facts(runner, i)).ToList();
        foreach (var f in facts) runner.ReportCapture(f, CapturesResult.Saved, $"{f.CaptureId}.fits");
        // 413 halbiert das Paket (4 → 2); 422 beanstandet die Meldungen 2 und 4 – nur sie gehen ins Dead-Letter.
        var bad = new HashSet<Guid> { facts[1].CaptureId, facts[3].CaptureId };
        api.OnCaptures = b =>
        {
            if (b.Captures.Count > 2) return Problem(413, "payload.too_large");
            var paths = b.Captures.Select((c, i) => (c, i)).Where(x => bad.Contains(x.c.Id)).Select(x => $"captures.{x.i}.exposureMidUtc").ToArray();
            return paths.Length > 0 ? ProblemWithErrors(422, "validation.failed", paths) : null;
        };
        await Outbox(runner).FlushAsync(default);
        Assert.Equal(0, store.OutboxCount());
        Assert.Equal(2, store.DeadLetterCount());          // je Zweierpaket die beanstandete Meldung
        Assert.Equal([facts[0].CaptureId, facts[2].CaptureId], api.CaptureBatches.SelectMany(b => b.Batch.Captures).Select(c => c.Id));

        runner.ReportCapture(Facts(runner, 5), CapturesResult.Saved, "5.fits");
        api.OnCaptures = _ => Problem(409, "session.closed");
        await Outbox(runner).FlushAsync(default);
        Assert.Equal(3, store.DeadLetterCount());
        Assert.Contains(store.DeadLetterReasons(1), r => r.StartsWith("Night closed since 2026-09-17", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Token_widerrufen_401_haelt_die_Outbox_an_sperrt_token_invalid_kein_Dead_Letter()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        runner.ReportCapture(Facts(runner, 0), CapturesResult.Saved, "a.fits");
        api.OnCaptures = _ => Problem(401, "nina.token_invalid");

        await Outbox(runner).FlushAsync(default);

        Assert.Equal(NinaHeartbeatBlockedReason.Token_invalid, runner.Loop.Blocked);
        Assert.True(runner.Paused);
        Assert.Equal((1, 0), (store.OutboxCount(), store.DeadLetterCount()));
        Assert.False(runner.HasBlocksRemaining); // nicht behebbar, kein Block läuft
        Assert.False(await Outbox(runner).FlushAsync(default)); // angehalten
    }

    [Fact]
    public async Task Session_unknown_meldet_die_Session_offline_nach_und_wiederholt()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var session = runner.SessionId!.Value;
        runner.ReportCapture(Facts(runner, 0), CapturesResult.Saved, "a.fits");
        var first = true;
        api.OnCaptures = _ =>
        {
            if (!first) return null;
            first = false;
            return Problem(409, "session.unknown");
        };

        await Outbox(runner).FlushAsync(default);

        Assert.Equal(2, api.Created.Count);
        Assert.True(api.Created[^1].Offline);
        Assert.Equal(session, api.Created[^1].Id);
        Assert.Single(api.CaptureBatches);
        Assert.Equal(0, store.OutboxCount());
    }

    [Fact]
    public async Task Session_ohne_Serverantwort_wird_lokal_angelegt_und_offline_nachgemeldet()
    {
        api.SessionsFail = true;
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var session = runner.SessionId;
        Assert.NotNull(session); // Blöcke melden Aufnahmen, nichts geht verloren
        Assert.Contains(sink.Lines, l => l.Contains("SESSION") && l.Contains("state=offline"));
        runner.ReportCapture(Facts(runner, 0), CapturesResult.Saved, "a.fits");

        api.SessionsFail = false;
        await Outbox(runner).FlushAsync(default);

        var created = Assert.Single(api.Created);
        Assert.Equal((session!.Value, true), (created.Id, created.Offline));
        Assert.Single(api.CaptureBatches); // Session vor den Aufnahmen (FIFO)
    }

    // ---- Analyse 04.10.2026: kein Datenverlust zwischen Plugin und Server ----------------------------------------

    [Theory]
    [InlineData(500)]
    [InlineData(503)]
    [InlineData(429)]
    [InlineData(408)]
    public async Task Session_Anlage_mit_5xx_legt_die_Session_offline_an_statt_ohne_Session_zu_belichten(int status)
    {
        api.OnCreate = _ => throw Problem(status, "internal.error");
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var session = runner.SessionId;
        Assert.NotNull(session);
        runner.ReportCapture(Facts(runner, 0), CapturesResult.Saved, "a.fits");
        Assert.Equal(2, store.OutboxCount()); // Session-Anlage + Aufnahme

        api.OnCreate = null;
        await Outbox(runner).FlushAsync(default);
        Assert.Equal((session!.Value, true), (api.Created[^1].Id, api.Created[^1].Offline));
        Assert.Single(api.CaptureBatches);
    }

    [Fact]
    public void Fehlerpfade_im_Serverformat_und_in_Punktform()
    {
        string Body(params string[] paths) => JsonConvert.SerializeObject(new { errors = paths.Select(p => new { path = p, message = "x" }) });
        Assert.Equal([1, 3], OutboxSender.ProblemIndices(Body("$.captures[1].pierSide", "$.captures[3].panelId")).Order());
        Assert.Equal([2], OutboxSender.ProblemIndices(Body("$.events[2].code")));
        Assert.Equal([3], OutboxSender.ProblemIndices(Body("captures.3.exposureMidUtc")));
        Assert.Empty(OutboxSender.ProblemIndices(Body("$.captures", "night")));
    }

    [Fact]
    public async Task Rejected_invalid_je_Aufnahme_ins_Dead_Letter_die_uebrigen_quittiert()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var facts = Enumerable.Range(0, 3).Select(i => Facts(runner, i)).ToList();
        foreach (var f in facts) runner.ReportCapture(f, CapturesResult.Saved, $"{f.CaptureId}.fits");
        api.CaptureStatus = c => c.Id == facts[1].CaptureId ? ResultsStatus.Rejected_invalid : ResultsStatus.Accepted;

        Assert.True(await Outbox(runner).FlushAsync(default));

        Assert.Equal((0, 1), (store.OutboxCount(), store.DeadLetterCount()));
        Assert.Contains(store.DeadLetterReasons(1), r => r.Contains("rejected_invalid", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(403, "permission.denied")]
    [InlineData(403, null)]
    [InlineData(404, null)]
    public async Task Fehler_ohne_Bezug_zur_Meldung_wird_wiederholt_statt_die_Outbox_ins_Dead_Letter_zu_leeren(int status, string? code)
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        foreach (var i in Enumerable.Range(0, 3)) runner.ReportCapture(Facts(runner, i), CapturesResult.Saved, $"{i}.fits");
        api.OnCaptures = _ => code is null
            ? new NinaApiException("Gateway", status, "", new Dictionary<string, IEnumerable<string>>(), null)
            : Problem(status, code);

        Assert.False(await Outbox(runner).FlushAsync(default));

        Assert.Equal((3, 0), (store.OutboxCount(), store.DeadLetterCount()));
        Assert.Equal(clock.UtcNow.AddMinutes(1), store.OutboxHead()!.Value.NextAttemptUtc);
    }

    [Fact]
    public async Task Session_unknown_nach_abgelehnter_Anlage_dreht_sich_nicht_im_Kreis()
    {
        api.SessionsFail = true;
        var runner = Runner();
        await runner.RunOnceAsync(default);
        runner.ReportCapture(Facts(runner, 0), CapturesResult.Saved, "a.fits");
        api.SessionsFail = false;
        // Anlage endgültig abgelehnt (z. B. 422 nina.night_invalid nach > 21 Tagen), Meldungen danach session.unknown.
        api.OnCreate = _ => throw Problem(422, "nina.night_invalid");
        api.OnCaptures = _ => Problem(409, "session.unknown");

        Assert.True(await Outbox(runner).FlushAsync(default));

        Assert.Equal((0, 2), (store.OutboxCount(), store.DeadLetterCount()));
        Assert.Single(api.Created); // keine zweite Anlage
    }

    [Fact]
    public async Task Ereignisse_in_Paketen_bis_200()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var before = api.EventBatches.Count;
        foreach (var _ in Enumerable.Range(0, 250)) runner.ReportEvent(EventsKind.Warning, "test");
        await Outbox(runner).FlushAsync(default);
        Assert.All(api.EventBatches.Skip(before), b => Assert.True(b.Batch.Events.Count <= OutboxSender.MaxEventBatch));
        Assert.Equal(250, api.EventBatches.Skip(before).Sum(b => b.Batch.Events.Count(e => e.Code == "test")));
    }

    [Fact]
    public async Task Spaetes_ImageSaved_nach_Sessionende_geht_an_die_Session_der_Belichtung()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        var session = runner.SessionId!.Value;
        var facts = Facts(runner, 0) with { SessionId = session };
        store.SetState(StateKeys.SessionId, null); // Session inzwischen abgeschlossen

        runner.ReportCapture(facts, CapturesResult.Saved, "spaet.fits");

        var entry = Assert.Single(store.OutboxPeek(10), e => e.Kind == OutboxKinds.Capture);
        Assert.Equal(session, entry.SessionId);
    }

    [Fact]
    public async Task Dead_Letter_erneut_senden_stellt_Aufnahmen_wieder_in_die_Outbox()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        runner.ReportCapture(Facts(runner, 0), CapturesResult.Saved, "a.fits");
        api.OnCaptures = _ => Problem(409, "session.closed");
        await Outbox(runner).FlushAsync(default);
        Assert.Equal(1, store.DeadLetterCount());

        Assert.Equal(1, store.DeadLetterRequeue());
        api.OnCaptures = null;
        Assert.True(await Outbox(runner).FlushAsync(default));
        Assert.Equal((0, 0), (store.OutboxCount(), store.DeadLetterCount()));
        Assert.Single(api.CaptureBatches);
    }

    [Fact]
    public async Task Offline_Modus_gespeicherter_Plan_kein_Planabruf_Heartbeat_einmal_offline()
    {
        var runner = Runner();
        var hb = Heartbeat(runner);
        await runner.RunOnceAsync(default);
        var plans = api.Plans.Count;
        runner.OfflineMode = true;
        await hb.TickAsync(default);
        await hb.TickAsync(default);
        Assert.Single(api.Heartbeats, h => h.State == NinaHeartbeatState.Offline); // ein letzter Heartbeat, danach still

        // Neustart im Offline-Modus: gespeicherter Server-Plan (source=cache), kein Abruf.
        var restarted = Runner();
        restarted.OfflineMode = true;
        await restarted.RunOnceAsync(default);
        Assert.Equal(plans, api.Plans.Count);
        Assert.Contains(sink.Lines, l => l.Contains("PLAN reason=resume") && l.Contains("source=cache"));
        Assert.True(restarted.Paused);
    }

    [Fact]
    public async Task Offline_ohne_gespeicherten_Plan_plan_failed_keine_Bloecke()
    {
        // Gegenprobe P-16: Bootstrap im Speicher (früherer Lauf), aber kein Plan dieser Nacht.
        await Runner().RunOnceAsync(default);
        store.PutCache(PlanStore.CacheKey, JsonConvert.SerializeObject(new { night = "2026-09-16" }), null);
        store.SetState(StateKeys.SessionId, null);
        api.Offline = true;
        var runner = Runner();
        runner.OfflineMode = true;
        await runner.RunOnceAsync(default);
        Assert.Contains(sink.Lines, l => l.Contains("BLOCKED reason=plan_failed"));
        Assert.DoesNotContain(sink.Lines, l => l.Contains("BLOCK_START"));
    }

    [Fact]
    public async Task Zuruecksetzen_plant_mit_reset_Block_ueberspringen_vor_dem_Start_user_skip()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        runner.Reset();
        await runner.RunOnceAsync(default);
        Assert.Equal(NinaPlanRequestReason.Reset, api.Plans[^1].Reason);

        runner.SkipBlock();
        await runner.RunOnceAsync(default); // wartet auf den Blockstart
        await runner.RunOnceAsync(default); // der fällige Block wird übersprungen
        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_SKIPPED") && l.Contains("reason=user_skip"));
    }

    [Fact]
    public async Task Zuruecksetzen_im_laufenden_Block_beendet_ihn_nach_der_Belichtung_mit_replanned()
    {
        // Lauf real-commands (05.10.2026): reset_plan aus dem Web kam mitten in einem Block, der bis zum Nachtende lief –
        // der Reset wäre in dieser Nacht nie wirksam geworden.
        var runner = Runner();
        await runner.RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");
        nina.OnExposure = n =>
        {
            if (n == 2) runner.Reset();
        };

        await runner.RunOnceAsync(default);
        Assert.Contains(sink.Lines, l => l.Contains("BLOCK_END") && l.EndsWith("reason=replanned", StringComparison.Ordinal));
        Assert.Equal(2, nina.Exposures);

        nina.OnExposure = null;
        await runner.RunOnceAsync(default);
        Assert.Equal(NinaPlanRequestReason.Reset, api.Plans[^1].Reason);
    }

    [Fact]
    public async Task Neuplanung_wartet_bis_NINA_die_letzte_Belichtung_gespeichert_hat()
    {
        // VM-Lauf real-night-flats 05.10.2026: der Plan kam, bevor die 12. von 12 Aufnahmen gemeldet war → Block für eine
        // schon fertige Zeile, 309 s Warten, dann target_removed.
        var runner = Runner();
        await runner.RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");
        runner.Reset();
        nina.PendingImageSaves = 1;
        var plansBefore = api.Plans.Count;
        var pendingAtPlan = -1;
        nina.OnDelay = _ =>
        {
            if (clock.UtcNow >= UtcText.Parse("2026-09-18T07:35:02Z")) nina.PendingImageSaves = 0;
        };
        api.OnPlan = _ => pendingAtPlan = nina.PendingImageSaves;

        await runner.RunOnceAsync(default);

        Assert.Equal(NinaPlanRequestReason.Reset, api.Plans[plansBefore].Reason);
        Assert.Equal(0, pendingAtPlan);
    }

    [Fact]
    public async Task Neuplanung_wartet_hoechstens_15_s_auf_das_Speichern()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        clock.UtcNow = UtcText.Parse("2026-09-18T07:35:00Z");
        runner.Reset();
        nina.PendingImageSaves = 1;
        api.Now = () => clock.UtcNow;
        var plansBefore = api.Plans.Count;

        await runner.RunOnceAsync(default);

        Assert.Equal(NinaPlanRequestReason.Reset, api.Plans[plansBefore].Reason);
        Assert.Equal(UtcText.Parse("2026-09-18T07:35:15Z"), api.PlanTimes[^1]);
    }

    [Fact]
    public async Task Heartbeat_Kommando_reset_plan_wird_ausgefuehrt_und_quittiert()
    {
        var runner = Runner();
        var hb = Heartbeat(runner);
        await runner.RunOnceAsync(default);
        var id = Guid.NewGuid();
        api.OnHeartbeat = _ => new NinaHeartbeatResponse
        {
            ServerTimeUtc = clock.UtcNow, Lease = new Lease { LeaseLost = false }, SettingsVersion = 0, TargetsEtag = "x",
            Commands = [new Commands { Id = id, Command = CommandsCommand.Reset_plan }],
        };
        await hb.TickAsync(default);
        api.OnHeartbeat = null;
        await hb.TickAsync(default);
        Assert.Contains(id, api.Heartbeats[^1].AckedCommandIds!);
        await runner.RunOnceAsync(default);
        Assert.Equal(NinaPlanRequestReason.Reset, api.Plans[^1].Reason);
    }

    [Fact]
    public async Task Heartbeat_Kommando_genau_einmal_Quittung_ueberlebt_gescheiterten_Heartbeat()
    {
        var runner = Runner();
        var hb = Heartbeat(runner);
        await runner.RunOnceAsync(default);
        var id = Guid.NewGuid();
        NinaHeartbeatResponse WithCommand(NinaHeartbeat _) => new()
        {
            ServerTimeUtc = clock.UtcNow, Lease = new Lease { LeaseLost = false }, SettingsVersion = 0, TargetsEtag = "x",
            Commands = [new Commands { Id = id, Command = CommandsCommand.Refresh_targets }],
        };
        api.OnHeartbeat = WithCommand;
        await hb.TickAsync(default);
        // Antwort mit der Quittung geht verloren: Quittung bleibt für den nächsten Heartbeat.
        api.OnHeartbeat = _ => throw new HttpRequestException("weg");
        await hb.TickAsync(default);
        Assert.Contains(id, api.Heartbeats[^1].AckedCommandIds!);
        // Server liefert das unquittierte Kommando erneut: quittieren, nicht noch einmal ausführen.
        api.OnHeartbeat = WithCommand;
        await hb.TickAsync(default);
        Assert.Contains(id, api.Heartbeats[^1].AckedCommandIds!);
        api.OnHeartbeat = null;
        await hb.TickAsync(default);
        Assert.Contains(id, api.Heartbeats[^1].AckedCommandIds!);
        await hb.TickAsync(default);
        Assert.Empty(api.Heartbeats[^1].AckedCommandIds!);
        Assert.Single(sink.Lines, l => l.Contains($"Heartbeat command Refresh_targets ({id}) executed"));
    }

    [Fact]
    public async Task Uhr_ueber_60_s_meldet_ERROR_clock_skew_und_erholt_sich_unter_5_s()
    {
        var runner = Runner();
        var hb = Heartbeat(runner);
        await runner.RunOnceAsync(default);
        api.OnHeartbeat = _ => new NinaHeartbeatResponse
        {
            ServerTimeUtc = clock.UtcNow.AddSeconds(90), Lease = new Lease { LeaseLost = false }, SettingsVersion = 0, TargetsEtag = "x",
        };
        await hb.TickAsync(default);
        Assert.Contains(sink.Lines, l => l.Contains("ERROR code=clock_skew"));
        Assert.Contains(sink.Lines, l => l.Contains("BLOCKED reason=clock_skew"));
        api.OnHeartbeat = null;
        api.Now = () => clock.UtcNow;
        await hb.TickAsync(default);
        Assert.Null(runner.Loop.Blocked);
    }
}
