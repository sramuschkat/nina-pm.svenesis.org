using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Planning;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Planaufbau online (execution.md §3.1, §8): Nacht aus <c>currentNight</c>, <c>422 nina.night_invalid</c> →
/// Bootstrap neu, einmal wiederholen, sonst <c>plan_failed</c>; Fehlercodes → gesperrte Zustände bzw. offline;
/// <c>pendingCaptures</c> aus der Outbox (NT-20); <c>tonight</c> aus dem lokalen Protokoll (allocation.md §5.3).
/// </summary>
public sealed class PlanServiceTests
{
    private static T Example<T>(string name) => JsonConvert.DeserializeObject<T>(ContractExamples.Json(name), NinaJson.Settings())!;

    private sealed class FakeApi : IPlanApi
    {
        public Queue<Func<NinaPlanRequest, NinaPlanResponse>> PlanReplies { get; } = new();
        public Queue<Func<NinaBootstrap>> BootstrapReplies { get; } = new();
        public List<NinaPlanRequest> Requests { get; } = [];
        public int BootstrapCalls { get; private set; }

        public Task<NinaBootstrap> BootstrapAsync(CancellationToken token)
        {
            BootstrapCalls++;
            return Task.FromResult(BootstrapReplies.Dequeue()());
        }

        public Task<NinaPlanResponse> PlanAsync(NinaPlanRequest request, CancellationToken token)
        {
            Requests.Add(request);
            return Task.FromResult(PlanReplies.Dequeue()(request));
        }

        public Task<(NinaTargets? Targets, string? Etag)> TargetsAsync(string? etag, CancellationToken token) =>
            Task.FromResult<(NinaTargets?, string?)>((Example<NinaTargets>("targets.response"), "\"t-9b41\""));
    }

    private static NinaApiException Problem(int status, string code) =>
        new($"Fehler {status}", status, $$"""{"type":"about:blank","title":"x","status":{{status}},"code":"{{code}}"}""",
            new Dictionary<string, IEnumerable<string>>(), null);

    private static NinaPlanResponse Plan(NinaPlanRequest r)
    {
        var p = Example<NinaPlanResponse>("plan.response");
        p.Night = r.Night;
        return p;
    }

    private static PlanRequestInput Initial(DateTimeOffset? af = null) =>
        new(NinaPlanRequestReason.Initial, null, null, "\"t-9b41\"", new TonightLog().ToContract(af, initial: true), []);

    private static (PlanService Service, FakeApi Api, ListSink Sink, FixedClock Clock) Setup(string now)
    {
        var api = new FakeApi();
        var sink = new ListSink();
        var clock = new FixedClock(UtcText.Parse(now));
        return (new PlanService(api, clock, new NinaPmLog(sink)), api, sink, clock);
    }

    [Fact]
    public async Task Erstplan_mit_der_Nacht_aus_der_Tabelle_und_PLAN_Zeile()
    {
        var (service, api, sink, _) = Setup("2026-09-18T07:00:00Z");
        api.PlanReplies.Enqueue(Plan);

        var r = await service.RequestAsync(Example<NinaBootstrap>("bootstrap.response"), Initial(UtcText.Parse("2026-09-18T01:12:30Z")), default);

        Assert.True(r.Ok);
        Assert.Equal("2026-09-17", r.Night);
        var req = Assert.Single(api.Requests);
        Assert.Equal("2026-09-17", req.Night);
        Assert.Equal(NinaPlanRequestReason.Initial, req.Reason);
        Assert.Null(req.StartAtUtc);
        // Erstplan: tonight trägt nur den Autofokus aus dem Start-Bereich (M7).
        Assert.Equal(UtcText.Parse("2026-09-18T01:12:30Z"), req.Tonight!.LastAutofocusUtc);
        Assert.Null(req.Tonight.PastBlocks);
        Assert.Null(req.Tonight.ExposedSecByUnit);
        Assert.Contains($"I NINA-PM | PLAN reason=initial plan={r.Plan!.NightPlanId} source=server night=2026-09-17", sink.Lines);
    }

    [Fact]
    public async Task Start_am_Morgen_nach_dem_Nachtfenster_plant_die_kommende_Nacht()
    {
        // 18.09. 09:00 CDT (14:00Z): nightWindowEndUtc der Nacht 17.09. ist vorbei → 2026-09-18 (P-29).
        var (service, api, _, _) = Setup("2026-09-18T14:00:00Z");
        api.PlanReplies.Enqueue(Plan);
        var r = await service.RequestAsync(Example<NinaBootstrap>("bootstrap.response"), Initial(), default);
        Assert.Equal("2026-09-18", Assert.Single(api.Requests).Night);
        Assert.Equal("2026-09-18", r.Night);
    }

    [Fact]
    public async Task Night_invalid_laedt_Bootstrap_neu_und_wiederholt_einmal()
    {
        var (service, api, sink, _) = Setup("2026-09-18T07:00:00Z");
        api.PlanReplies.Enqueue(_ => throw Problem(422, "nina.night_invalid"));
        api.PlanReplies.Enqueue(Plan);
        api.BootstrapReplies.Enqueue(() => Example<NinaBootstrap>("bootstrap.response"));

        var r = await service.RequestAsync(Example<NinaBootstrap>("bootstrap.response"), Initial(), default);

        Assert.True(r.Ok);
        Assert.Equal(2, api.Requests.Count);
        Assert.Equal(1, api.BootstrapCalls);
        Assert.Contains("W NINA-PM | API status=422 code=nina.night_invalid call=plan", sink.Lines);
    }

    [Fact]
    public async Task Night_invalid_zweimal_ergibt_plan_failed()
    {
        var (service, api, _, _) = Setup("2026-09-18T07:00:00Z");
        api.PlanReplies.Enqueue(_ => throw Problem(422, "nina.night_invalid"));
        api.PlanReplies.Enqueue(_ => throw Problem(422, "nina.night_invalid"));
        api.BootstrapReplies.Enqueue(() => Example<NinaBootstrap>("bootstrap.response"));

        var r = await service.RequestAsync(Example<NinaBootstrap>("bootstrap.response"), Initial(), default);

        Assert.False(r.Ok);
        Assert.Equal(NinaHeartbeatBlockedReason.Plan_failed, r.Blocked);
        Assert.Equal(2, api.Requests.Count);
    }

    [Fact]
    public async Task Zu_kurze_Nacht_Tabelle_wird_einmal_nachgeladen()
    {
        // Tabelle endet mit der Nacht 19.09.; am 21.09. liegt now dahinter → nachladen, neue Tabelle ab 20.09.
        var (service, api, _, _) = Setup("2026-09-21T03:00:00Z");
        var later = Example<NinaBootstrap>("bootstrap.response");
        later.Nights = [new Nights
        {
            Night = "2026-09-20",
            NoonStartUtc = UtcText.Parse("2026-09-20T17:00:00Z"),
            NoonEndUtc = UtcText.Parse("2026-09-21T17:00:00Z"),
            NightWindowEndUtc = UtcText.Parse("2026-09-21T13:05:00Z"),
        }];
        api.BootstrapReplies.Enqueue(() => later);
        api.PlanReplies.Enqueue(Plan);

        var r = await service.RequestAsync(Example<NinaBootstrap>("bootstrap.response"), Initial(), default);

        Assert.True(r.Ok);
        Assert.Equal("2026-09-20", r.Night);
        Assert.Same(later, r.Bootstrap);
    }

    public static TheoryData<int, string, NinaHeartbeatBlockedReason?, bool> ErrorCases() => new()
    {
        { 401, "nina.token_invalid", NinaHeartbeatBlockedReason.Token_invalid, false },
        { 403, "tenant.locked", NinaHeartbeatBlockedReason.Tenant_locked, false },
        { 409, "engine.incompatible", NinaHeartbeatBlockedReason.Engine_incompatible, false },
        { 422, "engine.input_invalid", NinaHeartbeatBlockedReason.Plan_failed, false },
        { 429, "rate_limited", null, true },
        { 503, "server.unavailable", null, true },
    };

    [Theory]
    [MemberData(nameof(ErrorCases))]
    public async Task Fehlercodes(int status, string code, NinaHeartbeatBlockedReason? blocked, bool unreachable)
    {
        var (service, api, _, _) = Setup("2026-09-18T07:00:00Z");
        api.PlanReplies.Enqueue(_ => throw Problem(status, code));
        var r = await service.RequestAsync(Example<NinaBootstrap>("bootstrap.response"), Initial(), default);
        Assert.False(r.Ok);
        Assert.Equal(blocked, r.Blocked);
        Assert.Equal(unreachable, r.Unreachable);
    }

    [Fact]
    public async Task Netzfehler_heisst_offline_weiter()
    {
        var (service, api, sink, _) = Setup("2026-09-18T07:00:00Z");
        api.PlanReplies.Enqueue(_ => throw new HttpRequestException("kein Netz"));
        var r = await service.RequestAsync(Example<NinaBootstrap>("bootstrap.response"), Initial(), default);
        Assert.True(r.Unreachable);
        Assert.Null(r.Blocked);
        Assert.Contains("W NINA-PM | API status=0 code=network call=plan", sink.Lines);
    }

    [Fact]
    public void Anfrage_besteht_den_Vertrag_als_JSON()
    {
        var tonight = new TonightLog();
        var unit = TonightLog.UnitId(Guid.Parse("a91f0000-0000-4000-8000-000000000001"), 0, 1, true);
        tonight.BlockStarted(unit);
        tonight.ExposureSaved(unit, Guid.Parse("10010000-0000-4000-8000-000000000001"), 300);
        tonight.BlockFinished(unit, UtcText.Parse("2026-09-18T02:05:30Z"), UtcText.Parse("2026-09-18T07:34:00Z"));
        var req = PlanService.Build("2026-09-17", new PlanRequestInput(
            NinaPlanRequestReason.Refresh, UtcText.Parse("2026-09-18T07:35:00Z"), Guid.NewGuid(), "\"t-9b41\"",
            tonight.ToContract(UtcText.Parse("2026-09-18T01:12:30Z"), initial: false), []));

        var json = JsonConvert.SerializeObject(req, NinaJson.Settings());
        Assert.Contains("\"night\":\"2026-09-17\"", json);
        Assert.Contains("\"reason\":\"refresh\"", json);
        Assert.Contains("\"startAtUtc\":\"2026-09-18T07:35:00Z\"", json);
        Assert.Contains("\"pastBlocks\":[{\"unitId\":\"a91f0000-0000-4000-8000-000000000001\",\"fromUtc\":\"2026-09-18T02:05:30Z\",\"toUtc\":\"2026-09-18T07:34:00Z\"}]", json);
        Assert.Contains("\"exposedSecByUnit\":{\"a91f0000-0000-4000-8000-000000000001\":300.0}", json);
    }

    // ---- pendingCaptures ----------------------------------------------------------------------------------

    [Fact]
    public void PendingCaptures_nur_gespeicherte_Lights_je_Zeile_und_Beobachtung()
    {
        var batch = Example<NinaCaptureBatch>("captures.request");
        var light = batch.Captures.Single(c => c.FrameType == CapturesFrameType.Light);
        string Json(Action<Captures> change)
        {
            var c = JsonConvert.DeserializeObject<Captures>(JsonConvert.SerializeObject(light, NinaJson.Settings()), NinaJson.Settings())!;
            change(c);
            return JsonConvert.SerializeObject(c, NinaJson.Settings());
        }

        var transit = Guid.NewGuid();
        var payloads = new[]
        {
            Json(c => c.Id = Guid.Parse("00000000-0000-7000-8000-000000000001")),
            Json(c => c.Id = Guid.Parse("00000000-0000-7000-8000-000000000002")),
            Json(c => c.Id = Guid.Parse("00000000-0000-7000-8000-000000000002")), // doppelt in der Outbox
            Json(c => { c.Id = Guid.NewGuid(); c.Result = CapturesResult.Aborted; }),
            Json(c => { c.Id = Guid.Parse("00000000-0000-7000-8000-000000000003"); c.TransitObservationId = transit; }),
            JsonConvert.SerializeObject(batch.Captures.Single(c => c.FrameType == CapturesFrameType.Flat), NinaJson.Settings()),
        };

        var groups = PlanService.PendingFromOutbox(payloads);

        Assert.Equal(2, groups.Count);
        Assert.Equal(light.ExposureLineId, groups[0].ExposureLineId);
        Assert.Null(groups[0].TransitObservationId);
        Assert.Equal(["00000000-0000-7000-8000-000000000001", "00000000-0000-7000-8000-000000000002"], groups[0].CaptureIds.Select(g => g.ToString()));
        Assert.Equal(transit, groups[1].TransitObservationId);
    }

    [Fact]
    public void PendingCaptures_aus_der_Outbox_ohne_Dead_Letter()
    {
        var dir = Directory.CreateTempSubdirectory("ninapm-pending-");
        try
        {
            using var store = LocalStore.Open(Path.Combine(dir.FullName, "ninapm.db"), new FixedClock(UtcText.Parse("2026-09-18T08:00:00Z")));
            var light = Example<NinaCaptureBatch>("captures.request").Captures.Single(c => c.FrameType == CapturesFrameType.Light);
            store.EnqueueOutbox(OutboxKinds.Capture, JsonConvert.SerializeObject(light, NinaJson.Settings()), Guid.NewGuid(), light.NightPlanId);
            store.EnqueueOutbox(OutboxKinds.Event, "{}", null, null);

            var groups = PlanService.PendingFromOutbox(store.OutboxPayloads(OutboxKinds.Capture));

            Assert.Equal(light.Id, Assert.Single(Assert.Single(groups).CaptureIds));
        }
        finally
        {
            dir.Delete(true);
        }
    }

    // ---- tonight --------------------------------------------------------------------------------------------

    [Theory]
    [InlineData(1, true, "a91f0000-0000-4000-8000-000000000001")]
    [InlineData(4, false, "a91f0000-0000-4000-8000-000000000001")]
    [InlineData(4, true, "a91f0000-0000-4000-8000-000000000001/p2")]
    public void Einheiten_ID(int panelCount, bool independent, string expected) =>
        Assert.Equal(expected, TonightLog.UnitId(Guid.Parse("a91f0000-0000-4000-8000-000000000001"), 2, panelCount, independent));

    [Fact]
    public void Filterzyklus_zaehlt_Folgebelichtungen_je_Zeile()
    {
        var log = new TonightLog();
        var (l1, l2) = (Guid.NewGuid(), Guid.NewGuid());
        log.ExposureSaved("u", l1, 300);
        log.ExposureSaved("u", l1, 300);
        log.ExposureSaved("u", l2, 120);
        log.FlipDone("u");
        var t = log.ToContract(null, initial: false);
        var cycle = Assert.Single(t.FilterCycle!);
        Assert.Equal((l2.ToString(), 1), (cycle.LineId, cycle.SubsOnLine));
        Assert.Equal(720, t.ExposedSecByUnit!["u"]);
        Assert.True(t.FlipDoneByPanel!["u"]);
    }

    [Fact]
    public void Tonight_ueberlebt_einen_Neustart_in_ninapm_db()
    {
        var dir = Directory.CreateTempSubdirectory("ninapm-tonight-");
        try
        {
            var path = Path.Combine(dir.FullName, "ninapm.db");
            var clock = new FixedClock(UtcText.Parse("2026-09-18T08:00:00Z"));
            using (var store = LocalStore.Open(path, clock))
            {
                var log = new TonightLog();
                log.BlockStarted("u");
                log.ExposureSaved("u", Guid.Parse("10010000-0000-4000-8000-000000000001"), 300);
                log.BlockFinished("u", UtcText.Parse("2026-09-18T02:05:30Z"), UtcText.Parse("2026-09-18T07:34:00Z"));
                log.Save(store);
            }
            using (var store = LocalStore.Open(path, clock))
            {
                var t = TonightLog.Load(store).ToContract(null, initial: false);
                Assert.Equal("u", t.CurrentUnitId);
                Assert.Equal(300, t.ExposedSecByUnit!["u"]);
                Assert.Equal(UtcText.Parse("2026-09-18T07:34:00Z"), Assert.Single(t.PastBlocks!).ToUtc);
                TonightLog.Clear(store);
                Assert.Null(TonightLog.Load(store).ToContract(null, initial: false).CurrentUnitId);
            }
        }
        finally
        {
            dir.Delete(true);
        }
    }
}
