using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Planning;
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
        public List<NinaSessionCreate> Created { get; } = [];
        public List<(Guid Id, NinaSessionPatch Patch)> Patches { get; } = [];
        public Func<NinaSessionCreate, NinaSessionCreated>? OnCreate { get; set; }

        public Task<NinaBootstrap> BootstrapAsync(CancellationToken token) =>
            Offline ? throw new HttpRequestException("offline") : Task.FromResult(Example<NinaBootstrap>("bootstrap.response"));

        public Task<NinaPlanResponse> PlanAsync(NinaPlanRequest request, CancellationToken token)
        {
            if (Offline) throw new HttpRequestException("offline");
            Plans.Add(request);
            var p = Example<NinaPlanResponse>("plan.response");
            p.Night = request.Night;
            p.NightPlanId = Guid.NewGuid();
            return Task.FromResult(p);
        }

        public Task<(NinaTargets? Targets, string? Etag)> TargetsAsync(string? etag, CancellationToken token) =>
            Offline
                ? throw new HttpRequestException("offline")
                : Task.FromResult<(NinaTargets?, string?)>(etag == "\"t-9b41\"" ? (null, etag) : (Example<NinaTargets>("targets.response"), "\"t-9b41\""));

        public Task<NinaSessionCreated> CreateAsync(NinaSessionCreate body, CancellationToken token)
        {
            Created.Add(body);
            return Task.FromResult(OnCreate?.Invoke(body) ?? new NinaSessionCreated { SessionId = body.Id, PlanLogUploadUrl = "http://x" });
        }

        public Task<NinaSessionPatched> PatchAsync(Guid sessionId, NinaSessionPatch body, CancellationToken token)
        {
            Patches.Add((sessionId, body));
            return Task.FromResult(new NinaSessionPatched { SessionId = sessionId });
        }
    }

    private NightRunner Runner() => new(api, api, store, nina, nina, clock, new NinaPmLog(sink));

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
    public async Task Unsicher_bis_Nachtende_schliesst_die_Nacht_ohne_Wiederaufnahme()
    {
        var runner = Runner();
        await runner.RunOnceAsync(default);
        Assert.Equal(UtcText.Parse("2026-09-18T11:30:42Z"), runner.NightEndUtc());

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
    [InlineData("2026-09-18T09:00:00Z", false, false, SafetyWaitResult.NotConnected)]
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
}
