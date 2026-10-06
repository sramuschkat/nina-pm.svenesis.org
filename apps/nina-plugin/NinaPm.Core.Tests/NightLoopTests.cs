using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Planning;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Nachtschleife als Zustandsmaschine mit simulierter Zeit (NT-11, NIN-6, NIN5-2, execution.md §2) an der Beispielnacht
/// 2026-09-17: Transitblock 02:08–07:34 (Vorlauf ab 02:05:30), regulärer Block 07:35–09:20:01,
/// <c>darknessEndUtc</c> = <c>flatsNotBeforeUtc</c> = 11:30:42, <c>sessionEndUtc</c> 13:00. Dazu der gespeicherte Plan.
/// </summary>
public sealed class NightLoopTests
{
    private static DateTimeOffset T(string iso) => UtcText.Parse(iso);

    private static StoredPlan Stored(Action<NinaPlanResponse>? change = null)
    {
        var plan = JsonConvert.DeserializeObject<NinaPlanResponse>(ContractExamples.Json("plan.response"), NinaJson.Settings())!;
        change?.Invoke(plan);
        return new StoredPlan(plan.Night, "\"t-9b41\"", 7, plan);
    }

    private static NightContext At(string now, StoredPlan? plan, bool session = true, bool flatsPending = false, bool flatsEnabled = true,
        bool stale = false, bool resuming = false, bool sky = false) =>
        new(T(now), plan, T("2026-09-18T13:00:00Z"), stale, session, flatsEnabled, flatsPending, resuming, SkyFlats: sky);

    // ---- Planaufbau und Sperre ------------------------------------------------------------------------------

    [Fact]
    public void Ohne_Plan_Erstplan_bzw_resume_nach_Neustart()
    {
        var loop = new NightLoop();
        Assert.Equal(new NightStep(NightAction.FetchPlan, Reason: NinaPlanRequestReason.Initial), loop.Decide(At("2026-09-18T01:00:00Z", null, session: false)));
        Assert.Equal(NinaPlanRequestReason.Resume, loop.Decide(At("2026-09-18T01:00:00Z", null, resuming: true)).Reason);
    }

    [Fact]
    public void Fehlgeschlagener_Planaufbau_sperrt_5_Minuten_ab_dem_Versuch()
    {
        var loop = new NightLoop();
        var t0 = T("2026-09-18T01:00:00Z");
        loop.PlanAttempt(t0);
        loop.PlanFailedAt(t0.AddSeconds(20));

        var idle = loop.Decide(At("2026-09-18T01:04:59Z", null));
        Assert.Equal(NightAction.Idle, idle.Action);
        Assert.Equal(t0.AddMinutes(5), idle.WaitUntilUtc);
        Assert.Equal(NinaHeartbeatState.Blocked, loop.HeartbeatState(false, false, false, false));
        Assert.True(loop.HasBlocksRemaining(false, false));

        Assert.Equal(NightAction.FetchPlan, loop.Decide(At("2026-09-18T01:05:00Z", null)).Action);
        loop.PlanAttempt(T("2026-09-18T01:05:00Z"));
        loop.PlanReceived();
        Assert.Null(loop.Blocked);
        Assert.Equal(NinaHeartbeatState.Idle, loop.HeartbeatState(false, false, false, false));
    }

    [Fact]
    public void Plan_mit_Bloecken_hebt_die_Sperre_nicht_auf()
    {
        var loop = new NightLoop();
        var plan = Stored();
        var regular = plan.Plan.Blocks[1].Id;
        loop.PlanAttempt(T("2026-09-18T09:19:30Z"));
        loop.PlanReceived();

        // Block im neuen Plan sofort erledigt (keine Belichtung passt mehr): kein neuer Abruf vor Ablauf der Sperre.
        var idle = loop.Decide(At("2026-09-18T09:19:31Z", plan) with { DoneBlocks = new HashSet<Guid> { regular } });
        Assert.Equal((NightAction.Idle, T("2026-09-18T09:24:30Z")), (idle.Action, idle.WaitUntilUtc));
        Assert.Equal(NightAction.FetchPlan, loop.Decide(At("2026-09-18T09:24:30Z", plan)).Action);
    }

    [Fact]
    public void Benutzerabbruch_und_Zuruecksetzen_heben_die_Sperre_auf_Safety_nicht()
    {
        var loop = new NightLoop();
        loop.PlanAttempt(T("2026-09-18T01:00:00Z"));
        loop.PlanFailedAt(T("2026-09-18T01:00:10Z"));
        // Safety-Unterbrechung: keine Ereignismethode – die Sperre bleibt.
        Assert.Equal(NightAction.Idle, loop.Decide(At("2026-09-18T01:01:00Z", null)).Action);
        loop.UserAbortOrReset();
        Assert.Equal(NightAction.FetchPlan, loop.Decide(At("2026-09-18T01:01:00Z", null)).Action);
    }

    // ---- Blöcke ---------------------------------------------------------------------------------------------

    [Theory]
    [InlineData("2026-09-18T01:00:00Z", NightAction.WaitForBlock, 0, "2026-09-18T02:05:30Z")]
    [InlineData("2026-09-18T02:05:30Z", NightAction.RunBlock, 0, null)]
    [InlineData("2026-09-18T07:34:30Z", NightAction.WaitForBlock, 1, "2026-09-18T07:35:00Z")]
    [InlineData("2026-09-18T08:00:00Z", NightAction.RunBlock, 1, null)]
    public void Block_nach_der_Uhr(string now, NightAction action, int index, string? until)
    {
        var step = new NightLoop().Decide(At(now, Stored()));
        Assert.Equal(action, step.Action);
        Assert.Equal(index, step.BlockIndex);
        Assert.Equal(until is null ? null : T(until), step.WaitUntilUtc);
    }

    [Fact]
    public void Erledigte_Bloecke_werden_uebersprungen()
    {
        var plan = Stored();
        var transit = plan.Plan.Blocks[0].Id;
        var regular = plan.Plan.Blocks[1].Id;
        var loop = new NightLoop();

        var next = loop.Decide(At("2026-09-18T03:00:00Z", plan) with { DoneBlocks = new HashSet<Guid> { transit } });
        Assert.Equal((NightAction.WaitForBlock, 1), (next.Action, next.BlockIndex));

        var refresh = loop.Decide(At("2026-09-18T08:00:00Z", plan) with { DoneBlocks = new HashSet<Guid> { transit, regular } });
        Assert.Equal((NightAction.FetchPlan, NinaPlanRequestReason.Refresh), (refresh.Action, refresh.Reason));
    }

    [Fact]
    public void Alle_Bloecke_vorbei_vor_Dunkelheitsende_alle_5_Minuten_neu_planen_danach_Nachtende()
    {
        var loop = new NightLoop();
        var plan = Stored();
        var refresh = loop.Decide(At("2026-09-18T10:00:00Z", plan));
        Assert.Equal((NightAction.FetchPlan, NinaPlanRequestReason.Refresh), (refresh.Action, refresh.Reason));

        loop.PlanAttempt(T("2026-09-18T10:00:00Z"));
        loop.PlanReceived(); // leerer Plan: Sperre bleibt, kein plan_failed
        var idle = loop.Decide(At("2026-09-18T10:02:00Z", plan));
        Assert.Equal((NightAction.Idle, T("2026-09-18T10:05:00Z")), (idle.Action, idle.WaitUntilUtc));
        Assert.Equal(NinaHeartbeatState.Idle, loop.HeartbeatState(false, false, false, false));

        // Sperre endet nach darknessEndUtc: nicht länger warten als bis zum Nachtende.
        loop.PlanAttempt(T("2026-09-18T11:28:00Z"));
        Assert.Equal(T("2026-09-18T11:30:42Z"), loop.Decide(At("2026-09-18T11:29:00Z", plan)).WaitUntilUtc);

        // Nach darknessEndUtc: Nachtende statt plan_failed.
        Assert.Equal(NightAction.CompleteSession, loop.Decide(At("2026-09-18T11:31:00Z", plan, flatsEnabled: false)).Action);
    }

    // ---- Nachtende (NT-11) ----------------------------------------------------------------------------------

    [Fact]
    public void Nachtende_Reihenfolge_Flats_PATCH_nightFinished_und_erst_dann_false()
    {
        var loop = new NightLoop();
        var plan = Stored();
        Assert.Equal(NightAction.RunFlats, loop.Decide(At("2026-09-18T11:31:00Z", plan, flatsPending: true)).Action);
        Assert.True(loop.HasBlocksRemaining(blockRunning: false, flatsRunning: true));

        Assert.Equal(NightAction.CompleteSession, loop.Decide(At("2026-09-18T11:50:00Z", plan)).Action);
        loop.SessionCompleted();
        Assert.Equal(NightAction.FinishNight, loop.Decide(At("2026-09-18T11:50:01Z", plan)).Action);
        // Der Aufruf, der nightFinished setzt, endet noch mit true …
        Assert.True(loop.HasBlocksRemaining(false, false));
        loop.NightFinishedSet();
        // … erst der nächste liefert false; ein Wiederöffnen gibt es nicht.
        Assert.False(loop.HasBlocksRemaining(false, false));
        Assert.Equal(NightAction.Stop, loop.Decide(At("2026-09-18T11:50:02Z", plan)).Action);
    }

    [Fact]
    public void Himmelsflats_warten_bis_flatsNotBeforeUtc_und_entfallen_ab_sessionEndUtc()
    {
        var plan = Stored(p => p.FlatsNotBeforeUtc = T("2026-09-18T12:00:00Z"));
        var loop = new NightLoop();
        var wait = loop.Decide(At("2026-09-18T11:40:00Z", plan, flatsPending: true, sky: true));
        Assert.Equal((NightAction.WaitForFlats, T("2026-09-18T12:00:00Z")), (wait.Action, wait.WaitUntilUtc));
        Assert.Equal(NightAction.SkipFlats, loop.Decide(At("2026-09-18T13:00:00Z", plan, flatsPending: true, sky: true)).Action);
    }

    [Fact]
    public void Panel_Flats_beginnen_mit_dem_Nachtende_ohne_eigene_Wartezeit()
    {
        // Sven 06.10.2026: den Start bestimmt eine Warte-Anweisung in „Vor Flats“, nicht das Plugin.
        var plan = Stored(p => p.FlatsNotBeforeUtc = T("2026-09-18T12:00:00Z"));
        var loop = new NightLoop();
        Assert.Equal(NightAction.RunFlats, loop.Decide(At("2026-09-18T11:40:00Z", plan, flatsPending: true)).Action);
        Assert.Equal(NightAction.SkipFlats, loop.Decide(At("2026-09-18T13:00:00Z", plan, flatsPending: true)).Action);
    }

    [Fact]
    public void Ohne_Session_entfaellt_der_PATCH()
    {
        var step = new NightLoop().Decide(At("2026-09-18T11:31:00Z", Stored(), session: false, flatsEnabled: false));
        Assert.Equal(NightAction.FinishNight, step.Action);
    }

    [Fact]
    public void Ohne_Plan_gilt_das_Nachtfensterende_der_Tabelle()
    {
        var step = new NightLoop().Decide(At("2026-09-18T13:00:00Z", null, session: false, flatsEnabled: false));
        Assert.Equal(NightAction.FinishNight, step.Action);
    }

    [Fact]
    public void Ohne_darknessEndUtc_endet_die_Nacht_bei_sessionEndUtc()
    {
        var plan = Stored(p => p.DarknessEndUtc = null);
        var loop = new NightLoop();
        Assert.Equal(NightAction.FetchPlan, loop.Decide(At("2026-09-18T12:00:00Z", plan, flatsEnabled: false)).Action);
        Assert.Equal(NightAction.CompleteSession, loop.Decide(At("2026-09-18T13:00:00Z", plan, flatsEnabled: false)).Action);
    }

    [Fact]
    public void Veraltete_Session_zuerst_zuruecksetzen()
    {
        var loop = new NightLoop();
        Assert.Equal(NightAction.ResetStaleSession, loop.Decide(At("2026-09-18T14:00:00Z", Stored(), stale: true)).Action);
        loop.NightFinishedSet();
        loop.NewNight();
        Assert.True(loop.HasBlocksRemaining(false, false));
    }

    // ---- gesperrte Zustände (NIN-6, NIN5-2) -----------------------------------------------------------------

    [Theory]
    [InlineData(NinaHeartbeatBlockedReason.Rig_busy)]
    [InlineData(NinaHeartbeatBlockedReason.Token_invalid)]
    [InlineData(NinaHeartbeatBlockedReason.Engine_incompatible)]
    [InlineData(NinaHeartbeatBlockedReason.Tenant_locked)]
    public void Nicht_behebbar_erst_Block_zu_Ende_dann_im_naechsten_Aufruf_false(NinaHeartbeatBlockedReason reason)
    {
        var loop = new NightLoop();
        loop.Block(reason, T("2026-09-18T08:00:00Z"));
        Assert.True(loop.HasBlocksRemaining(blockRunning: true, flatsRunning: false));
        Assert.False(loop.HasBlocksRemaining(blockRunning: false, flatsRunning: false));
        Assert.Equal(NightAction.Stop, loop.Decide(At("2026-09-18T08:05:00Z", Stored())).Action);
        Assert.Equal(NinaHeartbeatState.Blocked, loop.HeartbeatState(false, false, false, false));
    }

    [Fact]
    public void Lease_lost_wartet_60_s_je_Aufruf_bis_leaseLost_false()
    {
        var loop = new NightLoop();
        loop.Block(NinaHeartbeatBlockedReason.Lease_lost, T("2026-09-18T08:00:00Z"));
        var step = loop.Decide(At("2026-09-18T08:00:10Z", Stored()));
        Assert.Equal((NightAction.BlockedWait, T("2026-09-18T08:01:10Z")), (step.Action, step.WaitUntilUtc));
        Assert.True(loop.HasBlocksRemaining(false, false));
        loop.Unblock();
        Assert.Equal(NightAction.RunBlock, loop.Decide(At("2026-09-18T08:01:10Z", Stored())).Action);
    }

    [Fact]
    public void Clock_skew_Austritt_bei_hoechstens_5_s_nach_10_Versuchen_false()
    {
        var loop = new NightLoop();
        var t = T("2026-09-18T08:00:00Z");
        loop.ClockChecked(TimeSpan.FromSeconds(90), t);
        Assert.Equal(NinaHeartbeatBlockedReason.Clock_skew, loop.Blocked);
        loop.ClockChecked(TimeSpan.FromSeconds(30), t); // zwischen 5 und 60 s: Zustand bleibt
        Assert.Equal(NinaHeartbeatBlockedReason.Clock_skew, loop.Blocked);
        loop.ClockChecked(TimeSpan.FromSeconds(-4), t);
        Assert.Null(loop.Blocked);

        for (var i = 0; i < 9; i++) loop.ClockChecked(TimeSpan.FromSeconds(-90), t);
        Assert.True(loop.HasBlocksRemaining(false, false));
        loop.ClockChecked(TimeSpan.FromSeconds(-90), t);
        Assert.False(loop.HasBlocksRemaining(false, false));
        Assert.True(loop.HasBlocksRemaining(blockRunning: true, flatsRunning: false));
    }

    [Fact]
    public void Heartbeat_Zustaende()
    {
        var loop = new NightLoop();
        Assert.Equal(NinaHeartbeatState.Running, loop.HeartbeatState(true, false, false, false));
        Assert.Equal(NinaHeartbeatState.Flats, loop.HeartbeatState(false, true, false, false));
        Assert.Equal(NinaHeartbeatState.Paused, loop.HeartbeatState(false, false, true, false));
        Assert.Equal(NinaHeartbeatState.Offline, loop.HeartbeatState(true, false, false, true));
        Assert.Equal(NinaHeartbeatState.Idle, loop.HeartbeatState(false, false, false, false));
    }

    // ---- gespeicherter Plan (execution.md §8) ---------------------------------------------------------------

    [Fact]
    public void Gespeicherter_Plan_ueberlebt_den_Neustart_und_gilt_nur_fuer_seine_Nacht()
    {
        var dir = Directory.CreateTempSubdirectory("ninapm-plan-");
        try
        {
            var path = Path.Combine(dir.FullName, "ninapm.db");
            var clock = new FixedClock(T("2026-09-18T07:40:00Z"));
            var stored = Stored();
            using (var store = LocalStore.Open(path, clock)) PlanStore.Save(store, stored);
            using (var store = LocalStore.Open(path, clock))
            {
                var loaded = PlanStore.Load(store, "2026-09-17");
                Assert.NotNull(loaded);
                Assert.Equal(stored.Plan.NightPlanId, loaded.Plan.NightPlanId);
                Assert.Equal(("\"t-9b41\"", 7), (loaded.TargetsEtag, loaded.SettingsVersion));
                Assert.Equal(stored.Plan.NightPlanId.ToString(), store.GetState(StateKeys.NightPlanId));
                Assert.Null(PlanStore.Load(store, "2026-09-18"));

                // Neustart ohne Verbindung um 07:40: weiter mit dem regulären Block (erster mit endUtc > now).
                Assert.Equal(1, PlanStore.ResumeIndex(loaded, clock.UtcNow));
                Assert.Equal(-1, PlanStore.ResumeIndex(loaded, T("2026-09-18T09:20:01Z")));
            }
        }
        finally
        {
            dir.Delete(true);
        }
    }
}
