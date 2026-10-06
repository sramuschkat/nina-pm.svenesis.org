using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Planning;

/// <summary>Was der Container in diesem Aufruf tut (execution.md §2 „Ablauf je Aufruf“).</summary>
public enum NightAction
{
    /// <summary>Lokale Session veraltet: offene Flats der alten Nacht <c>skipped</c>, Session/Plan/Blockindex/tonight verwerfen.</summary>
    ResetStaleSession,

    /// <summary>Plan holen (<see cref="NightStep.Reason"/>); die 5-min-Sperre wird vor dem Versuch gesetzt.</summary>
    FetchPlan,

    /// <summary>Kein Plan bzw. alle Blöcke vorbei, Sperre aktiv: bis <see cref="NightStep.WaitUntilUtc"/> warten (Heartbeat <c>idle</c>).</summary>
    Idle,

    /// <summary>Bis zum Blockstart warten (10-s-Takt, Heartbeat <c>idle</c>).</summary>
    WaitForBlock,

    /// <summary>Block <see cref="NightStep.BlockIndex"/> ausführen.</summary>
    RunBlock,

    /// <summary>Gesperrter Zustand: 60 s warten (abbrechbar), dann erneut aufrufen.</summary>
    BlockedWait,

    /// <summary>Nachtende, Flats ausstehend, aber noch vor <c>flatsNotBeforeUtc</c>: warten.</summary>
    WaitForFlats,

    /// <summary>Flats und Dark-Flats ausführen (AP-50).</summary>
    RunFlats,

    /// <summary>Nachtende bei <c>sessionEndUtc</c>: ausstehende Flat-Kombinationen <c>skipped</c>.</summary>
    SkipFlats,

    /// <summary><c>PATCH /sessions/{id} {status: completed, endedAtUtc, outboxPending}</c> – auch bei voller Outbox (NIN5-7).</summary>
    CompleteSession,

    /// <summary><c>nightFinished</c> setzen; dieser Aufruf endet noch mit <c>true</c>.</summary>
    FinishNight,

    /// <summary>Nachtschleife ist falsch: NINA führt den Ende-Bereich aus (bzw. Sequenz endet geordnet bei <c>blocked</c>).</summary>
    Stop,

    /// <summary>
    /// Nachtende mit <c>lease_lost</c> (Lease freigegeben bzw. anderes Rig aktiv): keine Flats, Session als abgebrochen
    /// melden und vergessen, Sperre aufheben – danach schließt die Nacht wie sonst (Ende-Bereich, Parken).
    /// </summary>
    AbandonSession,

    /// <summary>
    /// Tagesschleife (AP-52): die Nacht ist beendet und die nächste angefordert, sie beginnt aber erst mit dem Wechsel von
    /// <c>currentNight</c> (Nachtfensterende, NT-01) – bis <see cref="NightStep.WaitUntilUtc"/> warten (Heartbeat <c>idle</c>).
    /// </summary>
    WaitForNight,
}

public sealed record NightStep(NightAction Action, int? BlockIndex = null, DateTimeOffset? WaitUntilUtc = null, NinaPlanRequestReason? Reason = null);

/// <summary>Lage der Nacht für einen Aufruf; alle Zeitpunkte UTC aus <c>IClock</c> (NT-05).</summary>
public sealed record NightContext(
    DateTimeOffset Now,
    StoredPlan? Plan,
    /// <summary>Nachtfensterende der aktuellen Nacht aus der Tabelle – Nachtende, solange kein Plan vorliegt.</summary>
    DateTimeOffset NightWindowEndUtc,
    bool SessionStale,
    bool HasSession,
    bool FlatsEnabled,
    bool FlatsPending,
    /// <summary>Erster Aufruf nach einem Neustart mit Session aus <c>ninapm.db</c> → <c>reason: resume</c>.</summary>
    bool Resuming = false,
    /// <summary>Nacht-Schlüssel nach <c>currentNight</c> (NT-01); Tagesschleife: Wechsel gegenüber der beendeten Nacht.</summary>
    string? Night = null,
    /// <summary>
    /// Blöcke des gespeicherten Plans, die schon ausgeführt oder übersprungen wurden. Ein Block läuft je Plan höchstens
    /// einmal – auch wenn seine Einträge vor <c>endUtc</c> abgearbeitet sind (Lauf 02.10.2026: Block 1703-mal neu
    /// gestartet, kurz vor dem Ende in Dauerschleife).
    /// </summary>
    IReadOnlySet<Guid>? DoneBlocks = null,
    /// <summary>
    /// Himmelsflats (<c>flats.source = sky</c>): nur dann wartet der Container bis <c>flatsNotBeforeUtc</c>. Panel-Flats
    /// beginnen mit dem Nachtende; einen späteren Start legt die Box <em>Vor Flats</em> fest (Entscheidung Sven 06.10.2026).
    /// </summary>
    bool SkyFlats = false);

/// <summary>
/// Nachtschleife als Zustandsmaschine (NT-11, NIN-6, NIN5-2, execution.md §2, TK 10.3 Nr. 3/10) – reine Logik ohne NINA:
/// <list type="bullet">
/// <item>Nachtende, sobald kein Block läuft und <c>now ≥ (darknessEndUtc ?? sessionEndUtc)</c>, spätestens bei
/// <c>sessionEndUtc</c>; Reihenfolge Flats (ab <c>flatsNotBeforeUtc</c>) → Abschluss-<c>PATCH</c> → <c>nightFinished</c>
/// → im **nächsten** Aufruf <c>false</c>.</item>
/// <item>Jeder Planabruf aus der Schleife sperrt 5 min weitere Abrufe (Zeitstempel vor dem Versuch) – ob leer,
/// fehlgeschlagen oder mit Blöcken; nur Benutzerabbruch und <em>Zurücksetzen</em> heben die Sperre auf. Ein leerer Plan
/// nach <c>darknessEndUtc</c> ist Nachtende.</item>
/// <item>Gesperrte Zustände je Grund mit Austrittsregel; nicht behebbare beenden zuerst den laufenden Block und setzen
/// die Schleife erst im nächsten Aufruf ohne laufenden Block auf <c>false</c>.</item>
/// </list>
/// Der Container ruft <see cref="Decide"/> nur auf, wenn kein Block läuft; <see cref="HasBlocksRemaining"/> ist die
/// Schleifenbedingung.
/// </summary>
public sealed class NightLoop
{
    public static readonly TimeSpan PlanLock = TimeSpan.FromMinutes(5);
    public static readonly TimeSpan BlockedWait = TimeSpan.FromSeconds(60);
    public const int MaxClockSkewAttempts = 10;

    private DateTimeOffset? planLockUntil;
    private bool sessionCompleted;
    private bool nightFinished;
    private string? finishedNight;
    private bool nextNightRequested;
    private int clockSkewAttempts;

    /// <summary>Gesperrter Zustand (<c>blockedReasons</c>) oder <c>null</c>.</summary>
    public NinaHeartbeatBlockedReason? Blocked { get; private set; }

    public DateTimeOffset? BlockedSince { get; private set; }

    /// <summary>Letzter Planaufbau fehlgeschlagen (Heartbeat <c>blocked{plan_failed}</c>, leerer Plan dagegen <c>idle</c>).</summary>
    public bool PlanFailed { get; private set; }

    public bool NightFinished => nightFinished;

    /// <summary>Nacht-Schlüssel der beendeten Nacht (Tagesschleife, AP-52); <c>null</c>, solange die Nacht läuft.</summary>
    public string? FinishedNight => nightFinished ? finishedNight : null;

    /// <summary>Tagesschleife hat die nächste Nacht angefordert; die Schleifenbedingung ist wieder wahr (AP-52).</summary>
    public bool NextNightRequested => nightFinished && nextNightRequested;

    /// <summary>Behebbare Gründe (execution.md §2): <c>lease_lost</c>, <c>clock_skew</c>, <c>plan_failed</c>.</summary>
    public static bool Recoverable(NinaHeartbeatBlockedReason reason) => reason is
        NinaHeartbeatBlockedReason.Lease_lost or NinaHeartbeatBlockedReason.Clock_skew or NinaHeartbeatBlockedReason.Plan_failed;

    /// <summary>
    /// Schleifenbedingung (<c>NINA-PM Nachtschleife</c>): nie <c>false</c>, solange ein Block läuft oder Flats ausstehen
    /// (NINAs Watchdog bräche sonst die laufende Anweisung ab); sonst <c>false</c> nach <c>nightFinished</c> oder bei
    /// einem nicht behebbaren gesperrten Zustand (NIN5-2).
    /// </summary>
    public bool HasBlocksRemaining(bool blockRunning, bool flatsRunning)
    {
        if (blockRunning || flatsRunning) return true;
        if (Blocked is { } b && (!Recoverable(b) || ClockSkewExhausted)) return false;
        // Nach dem Nachtende falsch (Ende-Bereich, NT-11) – wieder wahr erst, wenn die Tagesschleife die nächste Nacht
        // anfordert (AP-52); ohne Tagesschleife bleibt es beim Ende der Sequenz.
        if (nightFinished) return nextNightRequested;
        return true;
    }

    private bool ClockSkewExhausted => Blocked == NinaHeartbeatBlockedReason.Clock_skew && clockSkewAttempts >= MaxClockSkewAttempts;

    public NightStep Decide(NightContext c)
    {
        if (nightFinished)
        {
            if (!nextNightRequested) return new NightStep(NightAction.Stop);
            // Nächste Nacht angefordert (Tagesschleife): beginnt mit dem Wechsel von currentNight (NT-01) – dann wie eine
            // veraltete Session neu aufbauen; vorher bis zum Nachtfensterende der beendeten Nacht warten.
            if (c.SessionStale || (c.Night is { } night && night != finishedNight)) return new NightStep(NightAction.ResetStaleSession);
            return new NightStep(NightAction.WaitForNight, WaitUntilUtc: c.NightWindowEndUtc);
        }
        if (Blocked is { } reason && reason != NinaHeartbeatBlockedReason.Plan_failed)
        {
            if (!Recoverable(reason) || ClockSkewExhausted) return new NightStep(NightAction.Stop);
            // lease_lost endet nicht von selbst, wenn die Lease freigegeben wurde oder ein anderes Rig sie hält: am Nachtende
            // trotzdem abschließen, sonst liefen weder Abschluss noch Ende-Bereich (Parken) – Analyse 04.10.2026.
            if (reason == NinaHeartbeatBlockedReason.Lease_lost && c.Now >= NightEndUtc(c))
                return new NightStep(c.HasSession ? NightAction.AbandonSession : NightAction.FinishNight);
            var wake = c.Now + BlockedWait;
            if (reason == NinaHeartbeatBlockedReason.Lease_lost && NightEndUtc(c) is var end && end < wake) wake = end;
            return new NightStep(NightAction.BlockedWait, WaitUntilUtc: wake);
        }
        if (c.SessionStale) return new NightStep(NightAction.ResetStaleSession);

        var plan = c.Plan?.Plan;
        var sessionEnd = plan?.SessionEndUtc ?? c.NightWindowEndUtc;
        var nightEnd = plan is null ? sessionEnd : plan.DarknessEndUtc ?? plan.SessionEndUtc;
        if (c.Now >= nightEnd || c.Now >= sessionEnd) return NightEnd(c, plan, sessionEnd);

        if (plan is null) return FetchOrIdle(c, c.Resuming ? NinaPlanRequestReason.Resume : NinaPlanRequestReason.Initial);

        var index = NextOpenBlock(plan.Blocks, c.Now, c.DoneBlocks);
        // Leerer Plan bzw. alle Blöcke vorbei, Nacht läuft noch: alle 5 min neu planen (Heartbeat idle).
        if (index < 0) return FetchOrIdle(c, NinaPlanRequestReason.Refresh, nightEnd);

        var block = plan.Blocks[index];
        var start = ReplanPolicy.PlannedStart(block);
        return start > c.Now
            ? new NightStep(NightAction.WaitForBlock, index, start)
            : new NightStep(NightAction.RunBlock, index);
    }

    /// <summary>Nachtende laut Plan (Ende der Dunkelheit, sonst Sessionende) bzw. ohne Plan das Nachtfensterende.</summary>
    private static DateTimeOffset NightEndUtc(NightContext c)
    {
        var plan = c.Plan?.Plan;
        var sessionEnd = plan?.SessionEndUtc ?? c.NightWindowEndUtc;
        var nightEnd = plan is null ? sessionEnd : plan.DarknessEndUtc ?? plan.SessionEndUtc;
        return nightEnd < sessionEnd ? nightEnd : sessionEnd;
    }

    /// <summary>Erster Block mit <c>endUtc &gt; now</c>, der in diesem Plan noch nicht gelaufen ist; -1 ohne.</summary>
    public static int NextOpenBlock(IReadOnlyList<Blocks> blocks, DateTimeOffset now, IReadOnlySet<Guid>? done)
    {
        for (var i = 0; i < blocks.Count; i++)
            if (blocks[i].EndUtc > now && (done is null || !done.Contains(blocks[i].Id))) return i;
        return -1;
    }

    private NightStep FetchOrIdle(NightContext c, NinaPlanRequestReason reason, DateTimeOffset? notAfter = null)
    {
        if (planLockUntil is { } until && c.Now < until)
            return new NightStep(NightAction.Idle, WaitUntilUtc: notAfter is { } n && n < until ? n : until);
        return new NightStep(NightAction.FetchPlan, Reason: reason);
    }

    private NightStep NightEnd(NightContext c, NinaPlanResponse? plan, DateTimeOffset sessionEnd)
    {
        if (c.FlatsEnabled && c.FlatsPending)
        {
            // Bei sessionEndUtc beginnt keine neue Kombination mehr (execution.md §2).
            if (c.Now >= sessionEnd) return new NightStep(NightAction.SkipFlats);
            if (!c.SkyFlats) return new NightStep(NightAction.RunFlats);
            var notBefore = plan?.FlatsNotBeforeUtc ?? sessionEnd;
            return c.Now < notBefore
                ? new NightStep(NightAction.WaitForFlats, WaitUntilUtc: notBefore)
                : new NightStep(NightAction.RunFlats);
        }
        if (c.HasSession && !sessionCompleted) return new NightStep(NightAction.CompleteSession);
        return new NightStep(NightAction.FinishNight);
    }

    // ---- Ereignisse ---------------------------------------------------------------------------------------

    /// <summary>Sperre aktiv (5 min ab dem letzten Abruf): auch die Neuplanung vor einem Block wartet (§3.2).</summary>
    public bool PlanLocked(DateTimeOffset now) => planLockUntil is { } until && now < until;

    /// <summary>Vor jedem Planabruf: Sperre setzen (Zeitstempel **vor** dem Versuch, execution.md §2).</summary>
    public void PlanAttempt(DateTimeOffset now) => planLockUntil = now + PlanLock;

    /// <summary>
    /// Plan erhalten (online oder gespeichert): <c>plan_failed</c> aufheben. Die Sperre aus <see cref="PlanAttempt"/>
    /// bleibt auch bei einem Plan mit Blöcken stehen – sind dessen Blöcke vor Ablauf der 5 min erledigt (gleicher Block
    /// erneut geliefert, vor dem Blockende passt keine Belichtung mehr, offline gespeicherter Plan), plant die Schleife
    /// erst nach Ablauf neu (Lauf 02.10.2026: 834 Pläne in 61 s).
    /// </summary>
    public void PlanReceived()
    {
        PlanFailed = false;
        if (Blocked == NinaHeartbeatBlockedReason.Plan_failed) Unblock();
    }

    /// <summary>Planaufbau fehlgeschlagen: <c>blocked{plan_failed}</c>, die Sperre aus <see cref="PlanAttempt"/> gilt.</summary>
    public void PlanFailedAt(DateTimeOffset now)
    {
        PlanFailed = true;
        Block(NinaHeartbeatBlockedReason.Plan_failed, now);
    }

    /// <summary>Benutzerabbruch (NT-15) oder <em>Zurücksetzen</em> (§3.2): Sperre aufheben. Eine Safety-Unterbrechung ändert nichts.</summary>
    public void UserAbortOrReset()
    {
        planLockUntil = null;
        if (Blocked == NinaHeartbeatBlockedReason.Plan_failed) Unblock();
        PlanFailed = false;
    }

    public void Block(NinaHeartbeatBlockedReason reason, DateTimeOffset now)
    {
        if (Blocked != reason) BlockedSince = now;
        Blocked = reason;
    }

    /// <summary>Austritt aus dem gesperrten Zustand (Heartbeat <c>leaseLost: false</c>, neues Token, Sperre aufgehoben …).</summary>
    public void Unblock()
    {
        Blocked = null;
        BlockedSince = null;
        clockSkewAttempts = 0;
    }

    /// <summary>
    /// Uhrabgleich (NT-05): Abweichung &gt; 60 s → <c>blocked{clock_skew}</c> und Versuch zählen; ≤ 5 s → Zustand gelöscht.
    /// Nach 10 Versuchen wird die Schleife im nächsten Aufruf ohne laufenden Block falsch.
    /// </summary>
    public void ClockChecked(TimeSpan skew, DateTimeOffset now)
    {
        var abs = skew.Duration();
        if (abs > TimeSpan.FromSeconds(60))
        {
            Block(NinaHeartbeatBlockedReason.Clock_skew, now);
            clockSkewAttempts++;
        }
        else if (abs <= TimeSpan.FromSeconds(5) && Blocked == NinaHeartbeatBlockedReason.Clock_skew)
        {
            Unblock();
        }
    }

    public void SessionCompleted() => sessionCompleted = true;

    /// <summary><c>nightFinished</c> setzen; <paramref name="night"/> = beendete Nacht (Tagesschleife, AP-52).</summary>
    public void NightFinishedSet(string? night = null)
    {
        nightFinished = true;
        finishedNight = night;
        nextNightRequested = false;
    }

    /// <summary>
    /// Tagesschleife beginnt eine neue Runde (AP-52): nach einer beendeten Nacht die nächste anfordern – die
    /// Nachtschleife wird wieder wahr und wartet auf den Wechsel von <c>currentNight</c>. Ohne beendete Nacht ohne Wirkung.
    /// </summary>
    public void RequestNextNight()
    {
        if (nightFinished) nextNightRequested = true;
    }

    /// <summary>Neue Nacht (veraltete Session verworfen): Zustand der alten Nacht zurücksetzen.</summary>
    public void NewNight()
    {
        planLockUntil = null;
        sessionCompleted = false;
        nightFinished = false;
        finishedNight = null;
        nextNightRequested = false;
        PlanFailed = false;
        if (Blocked == NinaHeartbeatBlockedReason.Plan_failed) Unblock();
    }

    /// <summary>Heartbeat-Zustand (NT-17).</summary>
    public NinaHeartbeatState HeartbeatState(bool blockRunning, bool flatsRunning, bool safetyPaused, bool offline)
    {
        if (offline) return NinaHeartbeatState.Offline;
        if (Blocked is { } b && (b != NinaHeartbeatBlockedReason.Plan_failed || PlanFailed)) return NinaHeartbeatState.Blocked;
        if (safetyPaused) return NinaHeartbeatState.Paused;
        if (flatsRunning) return NinaHeartbeatState.Flats;
        if (blockRunning) return NinaHeartbeatState.Running;
        return NinaHeartbeatState.Idle;
    }
}
