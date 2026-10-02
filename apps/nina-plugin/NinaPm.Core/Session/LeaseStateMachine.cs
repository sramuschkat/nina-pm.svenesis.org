namespace NinaPm.Core.Session;

/// <summary>Zustand der Lease aus Sicht des Plugins (execution.md §6, NIN-7).</summary>
public enum LeaseState
{
    None,
    Acquiring,
    Held,

    /// <summary>3 Heartbeats ohne Serverantwort: Blöcke laufen nach dem gespeicherten Plan weiter (FA-NIN-15, NT-14).</summary>
    Unreachable,

    /// <summary>Nur auf Serverantwort <c>leaseLost: true</c>: keine neuen Blöcke.</summary>
    Lost,
    Reacquiring,
}

/// <summary>Wirkung eines Übergangs, die der Aufrufer als Ereignis bzw. Zustand umsetzt.</summary>
public enum LeaseEffect
{
    None,

    /// <summary>Ereignis <c>lease_lost</c>, Zustand <c>blocked{lease_lost}</c>.</summary>
    LeaseLost,

    /// <summary>Ereignis <c>lease_regained</c>, gesperrten Zustand aufheben, Blockliste aus dem Plan neu.</summary>
    LeaseRegained,

    /// <summary>Ereignis <c>offline_start</c>.</summary>
    OfflineStart,

    /// <summary>Ereignis <c>offline_end</c>, Outbox sendet nach.</summary>
    OfflineEnd,

    /// <summary><c>409 session.rig_busy</c>: <c>blocked{rig_busy}</c> (nur Simulation).</summary>
    RigBusy,
}

/// <summary>
/// Lease-Zustandsmaschine (execution.md §6 Tabelle, NT-14, M5): <c>none → acquiring → held ⇄ unreachable</c>;
/// <c>held → lost</c> nur auf <c>leaseLost: true</c>; <c>lost → held</c>, sobald eine Heartbeat-Antwort
/// <c>leaseLost: false</c> meldet (der Heartbeat holt die Lease zurück); <c>lost → reacquiring</c> beim
/// <c>PATCH running</c>. Ausbleibende Antworten führen nie nach <c>lost</c>.
/// </summary>
public sealed class LeaseStateMachine
{
    /// <summary>Heartbeats ohne Antwort bis <c>unreachable</c> (≥ 3 min bei 60-s-Takt).</summary>
    public const int MissesForUnreachable = 3;

    private int misses;

    public LeaseState State { get; private set; } = LeaseState.None;

    /// <summary>Neue Blöcke erlaubt: Lease gehalten oder Server nur nicht erreichbar.</summary>
    public bool BlocksAllowed => State is LeaseState.Held or LeaseState.Unreachable;

    public LeaseEffect SessionPostSent()
    {
        if (State == LeaseState.None) State = LeaseState.Acquiring;
        return LeaseEffect.None;
    }

    /// <summary><c>201</c> auf <c>POST /sessions</c> bzw. Antwort auf <c>PATCH running</c> mit Lease.</summary>
    public LeaseEffect SessionCreated()
    {
        var wasLost = State is LeaseState.Lost or LeaseState.Reacquiring;
        State = LeaseState.Held;
        misses = 0;
        return wasLost ? LeaseEffect.LeaseRegained : LeaseEffect.None;
    }

    /// <summary><c>409 session.rig_busy</c> (beim Anlegen, beim Wiedererwerb oder nach der Rückkehr).</summary>
    public LeaseEffect RigBusy()
    {
        State = LeaseState.None;
        misses = 0;
        return LeaseEffect.RigBusy;
    }

    /// <summary>
    /// Neustart mit Session aus <c>ninapm.db</c>: <c>PATCH {status: running}</c> liegt in der Outbox (§6 „Neustart“) –
    /// <c>none</c>/<c>lost</c> → <c>reacquiring</c>; die erste Antwort (Heartbeat oder PATCH) entscheidet.
    /// </summary>
    public LeaseEffect ResumeSent()
    {
        if (State is LeaseState.None or LeaseState.Lost) State = LeaseState.Reacquiring;
        return LeaseEffect.None;
    }

    public LeaseEffect PatchRunningSent()
    {
        if (State == LeaseState.Lost) State = LeaseState.Reacquiring;
        return LeaseEffect.None;
    }

    /// <summary>Heartbeat mit Session beantwortet (<c>lease.leaseLost</c>).</summary>
    public LeaseEffect HeartbeatAnswered(bool leaseLost)
    {
        misses = 0;
        var before = State;
        if (leaseLost)
        {
            // Ohne Lease (Rig belegt, Session beendet) gibt es nichts zu verlieren – bleibt none (P-10).
            if (before == LeaseState.None) return LeaseEffect.None;
            State = LeaseState.Lost;
            return before is LeaseState.Lost ? LeaseEffect.None : LeaseEffect.LeaseLost;
        }
        State = LeaseState.Held;
        return before switch
        {
            LeaseState.Unreachable => LeaseEffect.OfflineEnd,
            // none: Neustart mit eigener Session – der Heartbeat setzt sie fort (§6, P-17).
            LeaseState.Lost or LeaseState.Reacquiring or LeaseState.None => LeaseEffect.LeaseRegained,
            _ => LeaseEffect.None,
        };
    }

    /// <summary>Heartbeat ohne Serverantwort (Netzfehler, Timeout).</summary>
    public LeaseEffect HeartbeatUnanswered()
    {
        if (State != LeaseState.Held) return LeaseEffect.None;
        if (++misses < MissesForUnreachable) return LeaseEffect.None;
        State = LeaseState.Unreachable;
        return LeaseEffect.OfflineStart;
    }
}
