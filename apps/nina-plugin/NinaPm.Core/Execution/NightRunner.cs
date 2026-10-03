using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Planning;
using NinaPm.Core.Reporting;
using NinaPm.Core.Session;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;

namespace NinaPm.Core.Execution;

/// <summary>Session-Aufrufe der NINA-API (TK 7.3): Session, Meldungen (Outbox, AP-16e) und Heartbeat.</summary>
public interface ISessionApi
{
    Task<NinaSessionCreated> CreateAsync(NinaSessionCreate body, CancellationToken token);

    Task<NinaSessionPatched> PatchAsync(Guid sessionId, NinaSessionPatch body, CancellationToken token);

    Task CapturesAsync(Guid sessionId, NinaCaptureBatch body, CancellationToken token);

    Task EventsAsync(Guid sessionId, NinaEventBatch body, CancellationToken token);

    Task<NinaHeartbeatResponse> HeartbeatAsync(NinaHeartbeat body, CancellationToken token);
}

/// <summary><see cref="ISessionApi"/> über den generierten Client.</summary>
public sealed class NinaSessionApi(NinaApiClient client) : ISessionApi
{
    public Task<NinaSessionCreated> CreateAsync(NinaSessionCreate body, CancellationToken token) => client.ApiNinaV1SessionsPostAsync(body, token);

    public Task<NinaSessionPatched> PatchAsync(Guid sessionId, NinaSessionPatch body, CancellationToken token) =>
        client.ApiNinaV1SessionsPatchAsync(sessionId, body, token);

    public Task CapturesAsync(Guid sessionId, NinaCaptureBatch body, CancellationToken token) =>
        client.ApiNinaV1SessionsCapturesAsync(sessionId, body, token);

    public Task EventsAsync(Guid sessionId, NinaEventBatch body, CancellationToken token) =>
        client.ApiNinaV1SessionsEventsAsync(sessionId, body, token);

    public Task<NinaHeartbeatResponse> HeartbeatAsync(NinaHeartbeat body, CancellationToken token) => client.ApiNinaV1HeartbeatAsync(body, token);
}

/// <summary>Was die Nachtschleife außerhalb des Blocks von NINA braucht (vom Adapter gelesen).</summary>
public interface INightHost
{
    /// <summary>Safety-Lage zum Zeitpunkt eines Abbruchs (§4.6).</summary>
    SafetyState ReadSafety();

    /// <summary>Letzter Autofokus aus NINAs AF-Historie in UTC (NT-24, M7), <c>null</c> ohne AF.</summary>
    DateTimeOffset? LastAutofocusUtc { get; }

    /// <summary>Safety-Unterbrechung: der nächste Block slewt und zentriert immer neu (NT-16).</summary>
    void OnInterrupted();

    /// <summary>
    /// Nach einem Planaufbau online (§4.3/§4.4): Sequenz und Profil prüfen – vorhandener Dither-Trigger
    /// (<c>nina_dither_trigger_present</c>, einmal je Nacht), NINA-Filternamen aus <paramref name="targets"/>, die im
    /// Profil fehlen (<c>filter_wheel_changed</c>).
    /// </summary>
    void PlanBuilt(NinaTargets? targets);
}

/// <summary>
/// Ein Aufruf von <em>NINA-PM-Anweisungen</em> (execution.md §2 „Ablauf je Aufruf“, TK 10.3): verbindet
/// <see cref="NightLoop"/>, Planaufbau (<see cref="PlanService"/>, gespeicherter Plan), Session-Aufrufe und
/// <see cref="BlockExecutor"/>. Je Aufruf genau ein Schritt der Nachtschleife; Warten (Blockstart, Sperre, gesperrter
/// Zustand 60 s) geschieht hier, damit NINA den Container nicht in Dauerschleife aufruft.
/// Abbrüche werden nach §4.6 eingeordnet: Unterbrechung → <c>interrupted</c>/<c>SAFETY_PAUSE</c>, beim nächsten Aufruf
/// <c>SAFETY_RESUME</c> und <c>reason: resume</c>; Benutzer-Stopp → <c>user_skip</c>, <c>PATCH aborted</c>, Sperre aufgehoben.
/// </summary>
public sealed class NightRunner(
    IPlanApi planApi,
    ISessionApi sessionApi,
    LocalStore store,
    IBlockHost blockHost,
    INightHost nightHost,
    IClock clock,
    NinaPmLog log) : IOutboxListener
{
    public const string BootstrapCacheKey = "bootstrap";
    public const string TargetsCacheKey = "targets";
    public static readonly TimeSpan BootstrapMaxAge = TimeSpan.FromDays(7);

    private readonly PlanService planService = new(planApi, clock, log);
    private NinaBootstrap? bootstrap;
    private Blocks? runningBlock;
    private bool bootstrapReload;

    /// <summary>
    /// Plan beim nächsten Aufruf erzwingen: <c>resume</c> beim ersten Aufruf mit Session aus <c>ninapm.db</c> und nach
    /// einer Unterbrechung (§3.2, §4.6); <c>initial</c> nach einem Benutzer-Stopp (neue Session, NT-15) und beim ersten
    /// Aufruf **ohne** Session – auch wenn für die Nacht noch ein gespeicherter Plan liegt (Sven 02.10.2026: vorher
    /// <c>refresh</c> bzw. bei offenen Blöcken gar kein Abruf und damit keine neue Session). Ohne Verbindung gilt danach
    /// der gespeicherte Plan.
    /// </summary>
    private NinaPlanRequestReason? forcedPlan = NinaPlanRequestReason.Resume;
    private bool interrupted;

    /// <summary>Erster Aufruf nach dem Start geprüft (Neustart mit Session → <c>PATCH running</c>, §6).</summary>
    private bool resumeChecked;

    /// <summary><c>409 session.rig_busy</c> während eines Blocks: Session erst nach dem Block beenden (NIN5-2).</summary>
    private bool abortSessionAfterBlock;
    private readonly object sessionGate = new();

    public NightLoop Loop { get; } = new();

    /// <summary>Lease aus Sicht des Plugins (execution.md §6).</summary>
    public LeaseStateMachine Lease { get; } = new();

    /// <summary>Plan, nach dem gerade belichtet wird (Nacht, <c>nightPlanId</c>) – Pflicht in jeder Meldung (NIN5-14).</summary>
    public (string Night, Guid NightPlanId)? ExecutingPlan { get; internal set; }

    public Guid? RunningBlockId => runningBlock?.Id;

    public int OutboxPending => store.OutboxCount();

    public BlockExecutor Executor { get; init; } = null!;

    public bool BlockRunning => runningBlock is not null;

    /// <summary>Schleifenbedingung <em>NINA-PM Nachtschleife</em>.</summary>
    public bool HasBlocksRemaining => Loop.HasBlocksRemaining(BlockRunning, flatsRunning: false);

    public NinaHeartbeatState HeartbeatState(bool offline) => Loop.HeartbeatState(BlockRunning, false, interrupted, offline);

    public Guid? SessionId => Guid.TryParse(store.GetState(StateKeys.SessionId), out var id) ? id : null;

    /// <summary>Zuletzt geladener Bootstrap (Nacht-Tabelle, Rig, Filterzuordnung).</summary>
    public NinaBootstrap? Bootstrap => bootstrap;

    /// <summary>Zuletzt geladene Ziele (Projektnamen, Panels) aus <c>cache.targets</c>.</summary>
    public NinaTargets? Targets
    {
        get
        {
            var entry = store.GetCache(TargetsCacheKey);
            return entry is null ? null : JsonConvert.DeserializeObject<NinaTargets>(entry.Value, NinaJson.Settings());
        }
    }

    public async Task RunOnceAsync(CancellationToken token)
    {
        cancelHandled = false;
        try
        {
            var started = clock.UtcNow;
            await StepAsync(token).ConfigureAwait(false);
            await GuardLoopAsync(started, token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested && !cancelHandled)
        {
            // Abbruch außerhalb eines Blocks (Warten auf Blockstart, Sperre, gesperrter Zustand): gleiche Einordnung (§4.6).
            if (Interruption.Classify(ownCancel: false, nightHost.ReadSafety()) == CancelKind.Interrupt)
            {
                log.Event("SAFETY_PAUSE", ("atUtc", clock.UtcNow));
                interrupted = true;
                nightHost.OnInterrupted();
            }
            else if (SessionId is not null)
            {
                UserStopped();
            }
            throw;
        }
    }

    private bool cancelHandled;

    /// <summary>Aufrufe in Folge, die ohne Warten oder Belichten zurückkehren, bevor der Schleifenschutz greift.</summary>
    public const int LoopGuardCalls = 25;

    /// <summary>Ein Aufruf kürzer als das gilt als „sofort zurück“.</summary>
    public static readonly TimeSpan LoopGuardFast = TimeSpan.FromSeconds(2);

    /// <summary>Wartezeit des Schleifenschutzes.</summary>
    public static readonly TimeSpan LoopGuardWait = TimeSpan.FromSeconds(30);

    private int fastCalls;

    /// <summary>
    /// Letzte Sicherung gegen Dauerschleifen (NINA ruft den Container sofort wieder auf): kehren
    /// <see cref="LoopGuardCalls"/> Aufrufe in Folge jeweils in weniger als <see cref="LoopGuardFast"/> zurück, wartet
    /// der Aufruf <see cref="LoopGuardWait"/> (abbrechbar) und meldet <c>WARNING code=loop_guard</c>. Regulär folgen
    /// höchstens Planabruf, Session und übersprungene Blöcke aufeinander.
    /// </summary>
    private async Task GuardLoopAsync(DateTimeOffset started, CancellationToken token)
    {
        if (clock.UtcNow - started >= LoopGuardFast)
        {
            fastCalls = 0;
            return;
        }
        if (++fastCalls < LoopGuardCalls) return;
        fastCalls = 0;
        log.Warning("WARNING", ("code", "loop_guard"), ("untilUtc", clock.UtcNow + LoopGuardWait));
        await blockHost.DelayAsync(clock.UtcNow + LoopGuardWait, token).ConfigureAwait(false);
    }

    private async Task StepAsync(CancellationToken token)
    {
        var executor = Executor ?? new BlockExecutor(blockHost, clock, log);
        if (interrupted)
        {
            interrupted = false;
            log.Event("SAFETY_RESUME", ("atUtc", clock.UtcNow));
            forcedPlan = NinaPlanRequestReason.Resume;
        }

        var b = await EnsureBootstrapAsync(token).ConfigureAwait(false);
        if (b is null)
        {
            // Ohne Bootstrap keine Nacht (NT-01): kurz warten, nicht in Dauerschleife zurückkehren.
            await blockHost.DelayAsync(clock.UtcNow + NightLoop.BlockedWait, token).ConfigureAwait(false);
            return;
        }
        var nights = NightCalendar.FromBootstrap(b);
        NightRow row;
        try
        {
            row = NightCalendar.CurrentRow(nights, clock.UtcNow);
        }
        catch (NightTableException)
        {
            bootstrap = null;
            await blockHost.DelayAsync(clock.UtcNow + NightLoop.BlockedWait, token).ConfigureAwait(false);
            return;
        }

        var stored = PlanStore.Load(store, row.Night);
        var stateNight = store.GetState(StateKeys.Night);
        var stale = stateNight is not null && NightCalendar.IsSessionStale(stateNight, nights, clock.UtcNow, null);
        var hasSession = SessionId is not null && !stale;
        // Ohne Session gibt es nichts wiederaufzunehmen: neue Session, erster Plan der Session (§3.2).
        if (forcedPlan == NinaPlanRequestReason.Resume && !hasSession) forcedPlan = NinaPlanRequestReason.Initial;
        var nightRunning = clock.UtcNow < (stored?.Plan is { } running ? running.DarknessEndUtc ?? running.SessionEndUtc : row.NightWindowEndUtc);
        if (!resumeChecked)
        {
            resumeChecked = true;
            // Nur fortsetzen, solange die Nacht läuft; danach schließt der nächste Schritt die Session ab (P-22).
            if (hasSession && forcedPlan == NinaPlanRequestReason.Resume && nightRunning) QueueResume(SessionId!.Value);
        }
        var context = new NightContext(clock.UtcNow, stale ? null : stored, row.NightWindowEndUtc, stale, hasSession,
            FlatsEnabled: false, FlatsPending: false, Resuming: forcedPlan == NinaPlanRequestReason.Resume && hasSession,
            DoneBlocks: DoneBlocks(stored));

        // Nach Neustart/Unterbrechung (resume, mit Session) bzw. Benutzer-Stopp oder Start ohne Session (initial) online
        // neu planen, solange die Nacht läuft; offline gilt danach der gespeicherte Plan.
        var forced = forcedPlan is not null && !stale && Loop.Blocked is null && !Loop.NightFinished && nightRunning;
        var step = forced ? new NightStep(NightAction.FetchPlan, Reason: forcedPlan) : Loop.Decide(context);
        forcedPlan = null;

        switch (step.Action)
        {
            case NightAction.ResetStaleSession:
                foreach (var key in new[] { StateKeys.SessionId, StateKeys.NightPlanId, StateKeys.BlockIndex, StateKeys.Night, StateKeys.DoneBlocks })
                    store.SetState(key, null);
                TonightLog.Clear(store);
                Loop.NewNight();
                return;
            case NightAction.FetchPlan:
                await FetchPlanAsync(b, row.Night, step.Reason ?? NinaPlanRequestReason.Initial, stored, token).ConfigureAwait(false);
                return;
            case NightAction.Idle:
            case NightAction.WaitForBlock:
            case NightAction.BlockedWait:
            case NightAction.WaitForFlats:
                await blockHost.DelayAsync(step.WaitUntilUtc ?? clock.UtcNow + NightLoop.BlockedWait, token).ConfigureAwait(false);
                return;
            case NightAction.RunBlock:
                if (await RefreshBeforeBlockAsync(b, row.Night, context.Plan!, step.BlockIndex!.Value, token).ConfigureAwait(false))
                    return;
                await RunBlockAsync(executor, context.Plan!, step.BlockIndex!.Value, token).ConfigureAwait(false);
                return;
            case NightAction.CompleteSession:
                await PatchSessionAsync(NinaSessionPatchStatus.Completed, token).ConfigureAwait(false);
                Loop.SessionCompleted();
                // Abgeschlossen ist endgültig (NT-11): danach Heartbeats ohne Session, nichts mehr fortsetzen.
                store.SetState(StateKeys.SessionId, null);
                return;
            case NightAction.FinishNight:
                Loop.NightFinishedSet();
                log.Event("SESSION", ("status", "finished"), ("night", row.Night));
                return;
            default:
                // Stop, RunFlats, SkipFlats: Flats folgen mit AP-50; Stop beendet die Schleife über HasBlocksRemaining.
                return;
        }
    }

    // ---- Plan und Session -----------------------------------------------------------------------------

    private async Task FetchPlanAsync(NinaBootstrap b, string night, NinaPlanRequestReason reason, StoredPlan? stored, CancellationToken token,
        DateTimeOffset? startAtUtc = null)
    {
        Loop.PlanAttempt(clock.UtcNow);
        var etag = await RefreshTargetsAsync(token).ConfigureAwait(false);
        var tonight = TonightLog.Load(store);
        var initial = reason == NinaPlanRequestReason.Initial;
        var input = new PlanRequestInput(reason, initial ? null : startAtUtc ?? clock.UtcNow, SessionId, etag,
            tonight.ToContract(nightHost.LastAutofocusUtc, initial), PlanService.PendingFromOutbox(store.OutboxPayloads(OutboxKinds.Capture)));
        var outcome = await planService.RequestAsync(b, input, token).ConfigureAwait(false);
        bootstrap = outcome.Bootstrap;

        if (outcome.Ok)
        {
            var plan = outcome.Plan!;
            // Planwechsel (§3.2): Ereignis plan_rebuilt mit alter und neuer nightPlanId.
            if (stored is not null && stored.Plan.NightPlanId != plan.NightPlanId)
                log.Event("PLAN_REBUILT", ("id", stored.Plan.NightPlanId), ("plan", plan.NightPlanId),
                    ("reason", reason.ToString().ToLowerInvariant()));
            PlanStore.Save(store, new StoredPlan(plan.Night, etag, SettingsVersion(outcome.Bootstrap), plan));
            store.SetState(StateKeys.DoneBlocks, null);
            Loop.PlanReceived();
            await EnsureSessionAsync(plan, token).ConfigureAwait(false);
            // Nach der Session: Hinweise des Planaufbaus (SiteCheck, Sequenz) erreichen dann auch den Server.
            nightHost.PlanBuilt(Targets);
            return;
        }
        if (outcome.Unreachable)
        {
            // Ohne Verbindung: gespeicherter Plan der Nacht weiter (execution.md §8); ohne ihn keine Blöcke.
            if (stored is not null) Loop.PlanReceived();
            else Loop.PlanFailedAt(clock.UtcNow);
            return;
        }
        if (outcome.Blocked == NinaHeartbeatBlockedReason.Plan_failed) Loop.PlanFailedAt(clock.UtcNow);
        else if (outcome.Blocked is { } reasonBlocked) Loop.Block(reasonBlocked, clock.UtcNow);
    }

    private static int SettingsVersion(NinaBootstrap b) => b.Rig.SettingsVersion;

    // ---- Neuplanung (execution.md §3.2, FA-SYN-03) --------------------------------------------------------

    /// <summary>
    /// Vor jedem Block: neue Ziele (ETag), gestiegene <c>settingsVersion</c> oder Verzug &gt; 10 min → <c>refresh</c> mit
    /// <c>startAtUtc = max(now, geplanter Blockstart)</c>; der Block läuft dann aus dem neuen Plan. Nicht während der
    /// 5-min-Sperre – sonst plante das Plugin bei einem Server, der den Verzug nicht auflösen kann oder nicht erreichbar
    /// ist, vor jedem Aufruf neu.
    /// </summary>
    private async Task<bool> RefreshBeforeBlockAsync(NinaBootstrap b, string night, StoredPlan stored, int index, CancellationToken token)
    {
        if (Loop.PlanLocked(clock.UtcNow)) return false;
        var etag = await RefreshTargetsAsync(token).ConfigureAwait(false);
        var block = stored.Plan.Blocks[index];
        var decision = ReplanPolicy.BeforeBlock(stored.TargetsEtag, etag, stored.SettingsVersion, SettingsVersion(b),
            ReplanPolicy.PlannedStart(block), clock.UtcNow);
        if (!decision.Refresh) return false;
        log.Note($"Neuplanung vor Block {block.Id}: {decision.Cause}");
        await FetchPlanAsync(b, night, NinaPlanRequestReason.Refresh, stored, token, decision.StartAtUtc).ConfigureAwait(false);
        return true;
    }

    /// <summary>
    /// Im Block alle 15 min (§3.2): <c>GET /targets</c>; bei neuem ETag Fall (a) Projekt/Panel/Zeile entfällt →
    /// <c>target_removed</c>, (b) neuer <c>locked</c> Transit vor Blockende → <c>transit_interrupt</c> (Ablauf AP-44),
    /// (c) übrige Änderung → Block läuft weiter, die Neuplanung vor dem nächsten Block sieht das neue ETag.
    /// </summary>
    private async Task<string?> InBlockCheckAsync(Blocks block, Entries next, CancellationToken token)
    {
        var previous = Targets;
        var previousEtag = store.GetCache(TargetsCacheKey)?.Etag;
        var etag = await RefreshTargetsAsync(token).ConfigureAwait(false);
        var current = Targets;
        if (previous is null || current is null || etag is null || etag == previousEtag) return null;
        var leadS = (bootstrap?.Rig.Scheduler.Overhead.SlewCenterS ?? 0) + 60;
        var running = new RunningBlock(block.ProjectId, block.PanelId ?? Guid.Empty, next.ExposureLineId, block.EndUtc,
            block.TransitObservationId);
        return ReplanPolicy.InBlock(previous, current, running, leadS) switch
        {
            InBlockCase.TargetRemoved => "target_removed",
            InBlockCase.TransitInterrupt => "transit_interrupt",
            _ => null,
        };
    }

    /// <summary>
    /// <c>GET /targets</c> mit dem ETag des Caches (execution.md §3.1, NT-19); neue Ziele landen in <c>cache.targets</c>.
    /// Ohne Verbindung bleibt der Cache, der Planaufbau entscheidet dann über offline (§8).
    /// </summary>
    private async Task<string?> RefreshTargetsAsync(CancellationToken token)
    {
        var cached = store.GetCache(TargetsCacheKey);
        try
        {
            var (targets, etag) = await planApi.TargetsAsync(cached?.Etag, token).ConfigureAwait(false);
            log.Event("API", ("status", targets is null ? 304 : 200), ("call", "targets"));
            if (targets is not null) store.PutCache(TargetsCacheKey, JsonConvert.SerializeObject(targets, NinaJson.Settings()), etag);
            if (targets is not null || etag != cached?.Etag) log.Event("TARGETS", ("etag", etag ?? ""));
            return etag;
        }
        catch (NinaApiException ex)
        {
            log.Warning("API", ("status", ex.StatusCode), ("code", NinaApi.ProblemCode(ex.Response)), ("call", "targets"));
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !token.IsCancellationRequested)
        {
            log.Warning("API", ("status", 0), ("code", "network"), ("call", "targets"));
        }
        return cached?.Etag;
    }

    /// <summary><c>POST /sessions</c> nach dem ersten Plan (Lease, §6); <c>409 session.rig_busy</c> → nur Simulation.</summary>
    private async Task EnsureSessionAsync(NinaPlanResponse plan, CancellationToken token)
    {
        if (SessionId is { } existing)
        {
            store.SetState(StateKeys.Night, plan.Night);
            return;
        }
        var id = Uuid7.New(clock);
        Lease.SessionPostSent();
        try
        {
            await sessionApi.CreateAsync(new NinaSessionCreate
            {
                Id = id,
                Night = plan.Night,
                NightPlanId = plan.NightPlanId,
                StartedAtUtc = clock.UtcNow,
                Offline = false,
            }, token).ConfigureAwait(false);
            store.SetState(StateKeys.SessionId, id.ToString());
            store.SetState(StateKeys.Night, plan.Night);
            Lease.SessionCreated();
            log.Event("SESSION", ("session", id), ("status", "running"), ("night", plan.Night));
            log.Event("LEASE", ("state", "held"));
        }
        catch (NinaApiException ex)
        {
            var code = NinaApi.ProblemCode(ex.Response);
            log.Warning("API", ("status", ex.StatusCode), ("code", code), ("call", "sessions"));
            if (ex.StatusCode == 409 && code == "session.rig_busy") ApplyLease(Lease.RigBusy());
        }
        catch (HttpRequestException)
        {
            // Ohne Antwort: Session in AP-16g über die Outbox nachmelden; Blöcke laufen nach dem Plan (execution.md §6).
            log.Warning("API", ("status", 0), ("code", "network"), ("call", "sessions"));
        }
    }

    /// <summary>
    /// Session beenden (<c>completed</c>/<c>aborted</c>) – sofort, auch mit offenen Meldungen (NIN5-7). Ohne Serverantwort
    /// wandert der PATCH in die Outbox (hinter die offenen Meldungen, §8 Sendereihenfolge); mit offenen Meldungen meldet
    /// die Outbox nach jedem Leeren den neuen Stand, bis 0.
    /// </summary>
    private async Task PatchSessionAsync(NinaSessionPatchStatus status, CancellationToken token)
    {
        if (SessionId is not { } id) return;
        var patch = new NinaSessionPatch { Status = status, EndedAtUtc = clock.UtcNow, OutboxPending = store.OutboxCount() };
        if (status == NinaSessionPatchStatus.Completed && patch.OutboxPending > 0) OutboxSender.RememberCompleted(store, id, patch.EndedAtUtc!.Value);
        try
        {
            await sessionApi.PatchAsync(id, patch, token).ConfigureAwait(false);
            log.Event("API", ("status", 200), ("call", "sessions"));
            log.Event("SESSION", ("session", id), ("status", status == NinaSessionPatchStatus.Completed ? "completed" : "aborted"),
                ("pending", patch.OutboxPending));
        }
        catch (NinaApiException ex) when (ex.StatusCode is 408 or 429 or >= 500)
        {
            log.Warning("API", ("status", ex.StatusCode), ("code", NinaApi.ProblemCode(ex.Response)), ("call", "sessions"));
            store.EnqueueOutbox(OutboxKinds.SessionPatch, JsonConvert.SerializeObject(patch, NinaJson.Settings()), id, null);
        }
        catch (NinaApiException ex)
        {
            log.Warning("API", ("status", ex.StatusCode), ("code", NinaApi.ProblemCode(ex.Response)), ("call", "sessions"));
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !token.IsCancellationRequested))
        {
            log.Warning("API", ("status", 0), ("code", ex is TaskCanceledException ? "timeout" : "network"), ("call", "sessions"));
            store.EnqueueOutbox(OutboxKinds.SessionPatch, JsonConvert.SerializeObject(patch, NinaJson.Settings()), id, null);
        }
    }

    /// <summary>
    /// Neustart mit Session aus <c>ninapm.db</c> (§6 „Neustart“): <c>PATCH {status: running, resumedAtUtc}</c> über die
    /// Outbox – hinter allem, was vor dem Neustart offen war; die Blöcke warten nicht darauf. Lease → <c>reacquiring</c>.
    /// </summary>
    private void QueueResume(Guid sessionId)
    {
        var patch = new NinaSessionPatch { Status = NinaSessionPatchStatus.Running, ResumedAtUtc = clock.UtcNow };
        store.EnqueueOutbox(OutboxKinds.SessionPatch, JsonConvert.SerializeObject(patch, NinaJson.Settings()), sessionId, null);
        ApplyLease(Lease.ResumeSent());
        log.Event("LEASE", ("session", sessionId), ("state", "reacquiring"));
    }

    // ---- Antworten auf Session-PATCHes aus der Outbox (IOutboxListener) --------------------------------

    /// <summary><c>PATCH running</c> aus der Outbox nur für die aktuelle Session (nach Abschluss oder Stopp veraltet).</summary>
    public bool ShouldResume(Guid sessionId) => SessionId == sessionId;

    /// <summary><c>PATCH running</c> beantwortet: Lease wie eine Heartbeat-Antwort (<c>reacquiring → held</c> bzw. <c>lost</c>).</summary>
    public void SessionPatched(Guid sessionId, NinaSessionPatch sent, NinaSessionPatched response)
    {
        if (sent.Status != NinaSessionPatchStatus.Running || SessionId != sessionId) return;
        ApplyLease(Lease.HeartbeatAnswered(response.Lease?.LeaseLost ?? false));
    }

    /// <summary>
    /// <c>409</c> auf <c>PATCH running</c>: <c>session.rig_busy</c> → eine andere Instanz hat übernommen (§6
    /// <c>reacquiring → none</c>): gesperrt <c>rig_busy</c>, laufende Belichtung und Block zuerst zu Ende (NIN5-2), dann
    /// Session beenden (<c>PATCH aborted</c>). <c>session.closed</c>/<c>session.unknown</c> → Session vergessen, der
    /// nächste Plan legt eine neue an (NT-11).
    /// </summary>
    public void SessionPatchRejected(Guid sessionId, NinaSessionPatch sent, string? code)
    {
        if (sent.Status != NinaSessionPatchStatus.Running || SessionId != sessionId) return;
        if (code == "session.rig_busy")
        {
            ApplyLease(Lease.RigBusy());
            lock (sessionGate)
            {
                if (BlockRunning)
                {
                    abortSessionAfterBlock = true;
                    return;
                }
            }
            AbortSession();
            return;
        }
        log.Note($"Session {sessionId} wird nicht fortgesetzt ({code}); der nächste Plan legt eine neue an.");
        store.SetState(StateKeys.SessionId, null);
        forcedPlan = NinaPlanRequestReason.Initial;
    }

    /// <summary>Session beenden ohne Benutzer-Stopp (Rig belegt): <c>PATCH aborted</c>, Session vergessen, Sperre bleibt.</summary>
    private void AbortSession()
    {
        _ = PatchSessionAsync(NinaSessionPatchStatus.Aborted, CancellationToken.None);
        store.SetState(StateKeys.SessionId, null);
    }

    // ---- Block --------------------------------------------------------------------------------------

    private async Task RunBlockAsync(BlockExecutor executor, StoredPlan stored, int index, CancellationToken token)
    {
        var block = stored.Plan.Blocks[index];
        store.SetState(StateKeys.BlockIndex, index.ToString(System.Globalization.CultureInfo.InvariantCulture));
        runningBlock = block;
        ExecutingPlan = (stored.Plan.Night, stored.Plan.NightPlanId);
        var unit = UnitId(block);
        var startedAt = clock.UtcNow;
        var tonight = TonightLog.Load(store);
        tonight.BlockStarted(unit);
        tonight.Save(store);
        try
        {
            var camera = bootstrap?.Rig.Camera;
            var scheduler = bootstrap?.Rig.Scheduler;
            var flip = scheduler?.MeridianFlip;
            var rotator = bootstrap?.Rig.Rotator;
            var outcome = await executor.RunAsync(block, stored.Plan.DarknessEndUtc, token, new BlockRunOptions(
                (next, t) => InBlockCheckAsync(block, next, t),
                camera?.SetpointC is { } setpoint ? new CoolingTarget(setpoint, camera.ToleranceC) : null,
                b => ReportEvent(EventsKind.Warning, "camera_temperature", b.Id),
                // Lease verloren bzw. Rig belegt (§6, P-10/P-17): laufende Belichtung zu Ende, dann block_end lease_lost.
                () => Lease.State == LeaseState.Lost || Loop.Blocked == NinaHeartbeatBlockedReason.Rig_busy ? "lease_lost" : null,
                flip is { Enabled: true } ? new FlipSettings(flip.AfterMin, flip.MaxAfterMin, flip.PauseBeforeMin, flip.DurationS) : null,
                rotator is null ? null : new RotationSettings(rotator.ToleranceDeg, rotator.SkipOnMismatch),
                scheduler is null ? null : scheduler.Playback == SchedulerPlayback.Sequential ? PlaybackMode.Sequential : PlaybackMode.TimeAware,
                (kind, code, b) => ReportEvent(kind, code, b.Id),
                b =>
                {
                    // flipDoneByPanel (flip-rotation.md §1): die Neuplanung plant für dieses Panel keinen zweiten Flip.
                    var t = TonightLog.Load(store);
                    t.FlipDone(UnitId(b));
                    t.Save(store);
                }))
                .ConfigureAwait(false);
            if (outcome.Started) RecordBlockEnd(unit, startedAt);
            // Fall a/b im Block: sofort neu planen ab jetzt (§3.2), unabhängig von der 5-min-Sperre.
            if (outcome.Reason is "target_removed" or "transit_interrupt") forcedPlan = NinaPlanRequestReason.Refresh;
            // Gelaufen oder übersprungen: in diesem Plan nicht noch einmal (Unterbrechung → neuer Plan, §4.6).
            MarkDone(stored, block.Id);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            RecordBlockEnd(unit, startedAt);
            HandleCancel(block);
            cancelHandled = true;
            throw;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Unbehandelter Fehler im Block (§4.1, Grund error): Block beenden und als erledigt markieren, damit NINA
            // den Container nicht in eine Fehlerschleife über denselben Block schickt; die Nacht läuft weiter.
            log.Event("BLOCK_END", ("id", block.Id), ("reason", "error"));
            log.Warning("ERROR", ("code", "block_failed"), ("block", block.Id));
            log.Note($"Block {block.Id}: {ex.GetType().Name}: {ex.Message}");
            RecordBlockEnd(unit, startedAt);
            MarkDone(stored, block.Id);
        }
        finally
        {
            bool abort;
            lock (sessionGate)
            {
                runningBlock = null;
                abort = abortSessionAfterBlock;
                abortSessionAfterBlock = false;
            }
            if (abort) AbortSession();
        }
    }

    // ---- erledigte Blöcke je Plan ------------------------------------------------------------------------

    /// <summary>Erledigte Blöcke des gespeicherten Plans (<c>state.doneBlocks</c>: <c>nightPlanId</c> + IDs, übersteht Neustarts).</summary>
    private HashSet<Guid> DoneBlocks(StoredPlan? stored)
    {
        var json = store.GetState(StateKeys.DoneBlocks);
        if (stored is null || json is null) return [];
        var done = JsonConvert.DeserializeObject<DoneBlocksState>(json);
        return done?.NightPlanId == stored.Plan.NightPlanId ? [.. done.Blocks] : [];
    }

    private void MarkDone(StoredPlan stored, Guid blockId)
    {
        var done = DoneBlocks(stored);
        done.Add(blockId);
        store.SetState(StateKeys.DoneBlocks, JsonConvert.SerializeObject(new DoneBlocksState(stored.Plan.NightPlanId, [.. done])));
    }

    private sealed record DoneBlocksState(Guid NightPlanId, List<Guid> Blocks);

    // ---- tonight (allocation.md §5.3) -----------------------------------------------------------------

    private void RecordBlockEnd(string unit, DateTimeOffset startedAt)
    {
        var tonight = TonightLog.Load(store);
        tonight.BlockFinished(unit, startedAt, clock.UtcNow);
        tonight.Save(store);
    }

    /// <summary>Gespeicherte Light-Aufnahme (nach <c>ImageSaved</c>): Sekunden und Filterzyklus der Einheit fortschreiben.</summary>
    // ---- Meldungen (AP-16e, execution.md §4.3, contracts/nina/README.md) --------------------------------

    /// <summary>
    /// Aufnahme melden: in die Outbox (FIFO je Session); ohne Session wird nicht gemeldet (AP-16g meldet offline
    /// angelegte Sessions nach). <c>saved</c> zählt zusätzlich in <c>tonight</c>.
    /// </summary>
    public void ReportCapture(CaptureFacts facts, CapturesResult result, string? fileName)
    {
        if (result == CapturesResult.Saved) ExposureSaved(facts.Block, facts.Entry);
        if (SessionId is not { } session) return;
        var capture = CaptureMapper.Build(facts, result, fileName);
        store.EnqueueOutbox(OutboxKinds.Capture, JsonConvert.SerializeObject(capture, NinaJson.Settings()), session, facts.NightPlanId);
    }

    /// <summary>Ereignis melden (<c>sessionEventKinds</c>; bei <c>warning</c> ein Code aus <c>pluginWarningCodes</c>).</summary>
    public void ReportEvent(EventsKind kind, string? code, Guid? blockId = null, string? message = null)
    {
        if (SessionId is not { } session) return;
        var planId = ExecutingPlan?.NightPlanId ?? (Guid.TryParse(store.GetState(StateKeys.NightPlanId), out var p) ? p : null);
        var e = new Events { Id = Uuid7.New(clock), OccurredAtUtc = clock.UtcNow, Kind = kind, Code = code, Message = message, NightPlanId = planId, BlockId = blockId };
        store.EnqueueOutbox(OutboxKinds.Event, JsonConvert.SerializeObject(e, NinaJson.Settings()), session, planId);
    }

    // ---- Heartbeat und Lease (AP-16e, execution.md §6) -------------------------------------------------

    /// <summary>
    /// Heartbeat beantwortet: Uhrabgleich (NT-05, Laufzeit halbiert), Lease (nur mit Session), gestiegene
    /// <c>settingsVersion</c> → Bootstrap neu laden (die Neuplanung vor dem nächsten Block sieht sie, §3.2).
    /// </summary>
    public void HeartbeatAnswered(NinaHeartbeatResponse response, DateTimeOffset sentUtc)
    {
        var now = clock.UtcNow;
        var serverNow = response.ServerTimeUtc + (now - sentUtc) / 2;
        Loop.ClockChecked(serverNow - now, now);
        if (SessionId is not null) ApplyLease(Lease.HeartbeatAnswered(response.Lease?.LeaseLost ?? false));
        if (bootstrap is not null && response.SettingsVersion > SettingsVersion(bootstrap)) bootstrapReload = true;
    }

    /// <summary>Heartbeat ohne Serverantwort (Netzfehler, Timeout, 5xx).</summary>
    public void HeartbeatUnanswered() => ApplyLease(Lease.HeartbeatUnanswered());

    /// <summary><c>409 session.rig_busy</c> auf einen Session- oder Heartbeat-Aufruf: eine andere Instanz hält das Rig.</summary>
    public void LeaseRigBusy() => ApplyLease(Lease.RigBusy());

    /// <summary>Wirkung eines Lease-Übergangs: gesperrter Zustand, Ereignis, Log (execution.md §6 Tabelle).</summary>
    private void ApplyLease(LeaseEffect effect)
    {
        var now = clock.UtcNow;
        switch (effect)
        {
            case LeaseEffect.LeaseLost:
                // rig_busy ist endgültig (nicht wiederherstellbar) und bleibt die Sperre.
                if (Loop.Blocked != NinaHeartbeatBlockedReason.Rig_busy) Loop.Block(NinaHeartbeatBlockedReason.Lease_lost, now);
                log.Event("LEASE", ("state", "lost"));
                log.Event("LEASE_LOST", ("atUtc", now));
                log.Event("BLOCKED", ("reason", "lease_lost"));
                ReportEvent(EventsKind.Lease_lost, null, runningBlock?.Id);
                break;
            case LeaseEffect.LeaseRegained:
                if (Loop.Blocked == NinaHeartbeatBlockedReason.Lease_lost) Loop.Unblock();
                store.SetState(StateKeys.DoneBlocks, null);
                log.Event("LEASE", ("state", "held"));
                log.Event("LEASE_REGAINED", ("atUtc", now));
                ReportEvent(EventsKind.Lease_regained, null);
                break;
            case LeaseEffect.OfflineStart:
                log.Event("LEASE", ("state", "unreachable"));
                log.Event("OFFLINE_START", ("atUtc", now));
                ReportEvent(EventsKind.Offline_start, null);
                break;
            case LeaseEffect.OfflineEnd:
                log.Event("LEASE", ("state", "held"));
                log.Event("OFFLINE_END", ("atUtc", now));
                ReportEvent(EventsKind.Offline_end, null);
                break;
            case LeaseEffect.RigBusy:
                Loop.Block(NinaHeartbeatBlockedReason.Rig_busy, now);
                log.Event("LEASE", ("state", "none"));
                log.Event("BLOCKED", ("reason", "rig_busy"));
                break;
        }
    }

    public void ExposureSaved(Blocks block, Entries entry)
    {
        if (entry.ExposureLineId is not { } line) return;
        var tonight = TonightLog.Load(store);
        tonight.ExposureSaved(UnitId(block), line, entry.ExposureS ?? 0);
        tonight.Save(store);
    }

    /// <summary>Einheiten-ID des Blocks (ENG5-14) aus Targets (Panelzahl, Panel-Index) und Mosaik-Einstellung.</summary>
    public string UnitId(Blocks block)
    {
        var targets = Targets;
        var project = targets?.Projects.FirstOrDefault(p => p.Id == block.ProjectId);
        var panel = project?.Panels.FirstOrDefault(p => p.Id == block.PanelId);
        return TonightLog.UnitId(block.ProjectId, panel?.Index ?? 0, project?.Panels.Count ?? 1, targets?.MosaicPanelsIndependent ?? false);
    }

    /// <summary>§4.6: Unterbrechung oder Benutzer-Stopp (eigene Abbrüche kommen mit AP-16d/AP-44).</summary>
    private void HandleCancel(Blocks block)
    {
        var kind = Interruption.Classify(ownCancel: false, nightHost.ReadSafety());
        if (kind == CancelKind.Interrupt)
        {
            log.Event("BLOCK_END", ("id", block.Id), ("reason", "interrupted"));
            log.Event("SAFETY_PAUSE", ("atUtc", clock.UtcNow));
            interrupted = true;
            nightHost.OnInterrupted();
            return;
        }
        log.Event("BLOCK_END", ("id", block.Id), ("reason", "user_skip"));
        UserStopped();
    }

    /// <summary>
    /// Benutzer-Stopp (NT-15): <c>PATCH aborted</c> (ohne Warten auf die abgebrochene Sequenz), Session vergessen –
    /// danach Heartbeats ohne <c>sessionId</c>; ein Neustart in derselben Nacht legt eine neue Session an. Sperre aufgehoben.
    /// </summary>
    public void UserStopped()
    {
        _ = PatchSessionAsync(NinaSessionPatchStatus.Aborted, CancellationToken.None);
        store.SetState(StateKeys.SessionId, null);
        Loop.UserAbortOrReset();
        forcedPlan = NinaPlanRequestReason.Initial;
    }

    /// <summary>Anweisung <em>Warten bis sicher oder Nachtende</em> hat die Nacht abgeschlossen (H2).</summary>
    public async Task CloseNightUnsafeAsync(CancellationToken token)
    {
        await PatchSessionAsync(NinaSessionPatchStatus.Completed, token).ConfigureAwait(false);
        Loop.SessionCompleted();
        Loop.NightFinishedSet();
        store.SetState(StateKeys.SessionId, null);
        log.Event("SESSION", ("status", "finished"), ("reason", "unsafe"));
    }

    /// <summary>Nachtende für <em>Warten bis sicher oder Nachtende</em>: <c>darknessEndUtc ?? sessionEndUtc</c>, ohne Plan das Nachtfensterende.</summary>
    public DateTimeOffset? NightEndUtc()
    {
        if (bootstrap is null) return null;
        try
        {
            var row = NightCalendar.CurrentRow(NightCalendar.FromBootstrap(bootstrap), clock.UtcNow);
            var plan = PlanStore.Load(store, row.Night)?.Plan;
            return plan is null ? row.NightWindowEndUtc : plan.DarknessEndUtc ?? plan.SessionEndUtc;
        }
        catch (NightTableException)
        {
            return null;
        }
    }

    // ---- Bootstrap ----------------------------------------------------------------------------------

    private async Task<NinaBootstrap?> EnsureBootstrapAsync(CancellationToken token)
    {
        if (bootstrap is not null && !bootstrapReload && !NightCalendar.NeedsReload(NightCalendar.FromBootstrap(bootstrap), clock.UtcNow))
            return bootstrap;
        try
        {
            bootstrap = await planApi.BootstrapAsync(token).ConfigureAwait(false);
            bootstrapReload = false;
            log.Event("API", ("status", 200), ("call", "bootstrap"));
            store.PutCache(BootstrapCacheKey, JsonConvert.SerializeObject(bootstrap, NinaJson.Settings()), null);
            return bootstrap;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !token.IsCancellationRequested)
        {
            log.Warning("API", ("status", 0), ("code", "network"), ("call", "bootstrap"));
        }
        catch (NinaApiException ex)
        {
            log.Warning("API", ("status", ex.StatusCode), ("code", NinaApi.ProblemCode(ex.Response)), ("call", "bootstrap"));
            // 401: Cache nicht verwenden, keine Blöcke (execution.md §8).
            if (ex.StatusCode == 401)
            {
                Loop.Block(NinaHeartbeatBlockedReason.Token_invalid, clock.UtcNow);
                return null;
            }
        }
        var cached = store.GetCache(BootstrapCacheKey);
        if (cached is null || clock.UtcNow - cached.UpdatedUtc > BootstrapMaxAge) return bootstrap;
        return bootstrap ??= JsonConvert.DeserializeObject<NinaBootstrap>(cached.Value, NinaJson.Settings());
    }
}
