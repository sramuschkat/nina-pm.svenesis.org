using NinaPm.Core.Session;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Lease-Zustandsmaschine (AP-16e, execution.md §6 Tabelle, NT-14, M5): alle Übergänge.</summary>
public sealed class LeaseStateMachineTests
{
    private static LeaseStateMachine Held()
    {
        var m = new LeaseStateMachine();
        m.SessionPostSent();
        m.SessionCreated();
        return m;
    }

    [Fact]
    public void None_acquiring_held_und_rig_busy_beim_Anlegen()
    {
        var m = new LeaseStateMachine();
        Assert.Equal(LeaseEffect.None, m.SessionPostSent());
        Assert.Equal(LeaseState.Acquiring, m.State);
        Assert.False(m.BlocksAllowed);
        Assert.Equal(LeaseEffect.None, m.SessionCreated());
        Assert.Equal(LeaseState.Held, m.State);
        Assert.True(m.BlocksAllowed);

        var busy = new LeaseStateMachine();
        busy.SessionPostSent();
        Assert.Equal(LeaseEffect.RigBusy, busy.RigBusy());
        Assert.Equal(LeaseState.None, busy.State);
    }

    [Fact]
    public void Held_unreachable_erst_nach_drei_Heartbeats_ohne_Antwort_und_zurueck_ohne_lost()
    {
        var m = Held();
        Assert.Equal(LeaseEffect.None, m.HeartbeatUnanswered());
        Assert.Equal(LeaseEffect.None, m.HeartbeatUnanswered());
        Assert.Equal(LeaseState.Held, m.State);
        Assert.Equal(LeaseEffect.OfflineStart, m.HeartbeatUnanswered());
        Assert.Equal(LeaseState.Unreachable, m.State);
        Assert.True(m.BlocksAllowed); // Blöcke laufen nach dem gespeicherten Plan weiter
        Assert.Equal(LeaseEffect.None, m.HeartbeatUnanswered()); // nie lost ohne Serverantwort
        Assert.Equal(LeaseState.Unreachable, m.State);

        Assert.Equal(LeaseEffect.OfflineEnd, m.HeartbeatAnswered(leaseLost: false));
        Assert.Equal(LeaseState.Held, m.State);
    }

    [Fact]
    public void Eine_Antwort_setzt_den_Zaehler_der_Fehlversuche_zurueck()
    {
        var m = Held();
        m.HeartbeatUnanswered();
        m.HeartbeatUnanswered();
        m.HeartbeatAnswered(false);
        m.HeartbeatUnanswered();
        m.HeartbeatUnanswered();
        Assert.Equal(LeaseState.Held, m.State);
    }

    [Fact]
    public void Lost_nur_auf_leaseLost_true_und_zurueck_auf_false_M5()
    {
        var m = Held();
        Assert.Equal(LeaseEffect.LeaseLost, m.HeartbeatAnswered(leaseLost: true));
        Assert.Equal(LeaseState.Lost, m.State);
        Assert.False(m.BlocksAllowed);
        Assert.Equal(LeaseEffect.None, m.HeartbeatAnswered(leaseLost: true)); // bleibt, kein zweites Ereignis
        Assert.Equal(LeaseEffect.None, m.HeartbeatUnanswered());
        Assert.Equal(LeaseState.Lost, m.State);

        Assert.Equal(LeaseEffect.LeaseRegained, m.HeartbeatAnswered(leaseLost: false));
        Assert.Equal(LeaseState.Held, m.State);
    }

    [Fact]
    public void Unreachable_dann_leaseLost_true_wird_lost()
    {
        var m = Held();
        for (var i = 0; i < 3; i++) m.HeartbeatUnanswered();
        Assert.Equal(LeaseEffect.LeaseLost, m.HeartbeatAnswered(leaseLost: true));
        Assert.Equal(LeaseState.Lost, m.State);
    }

    [Fact]
    public void Lost_reacquiring_held_bzw_none_bei_rig_busy()
    {
        var m = Held();
        m.HeartbeatAnswered(true);
        m.PatchRunningSent();
        Assert.Equal(LeaseState.Reacquiring, m.State);
        Assert.Equal(LeaseEffect.LeaseRegained, m.HeartbeatAnswered(false));
        Assert.Equal(LeaseState.Held, m.State);

        var busy = Held();
        busy.HeartbeatAnswered(true);
        busy.PatchRunningSent();
        Assert.Equal(LeaseEffect.RigBusy, busy.RigBusy());
        Assert.Equal(LeaseState.None, busy.State);
    }

    [Fact]
    public void Nach_Neustart_mit_Session_holt_der_Heartbeat_die_Lease_zurueck()
    {
        var m = new LeaseStateMachine();
        Assert.Equal(LeaseEffect.LeaseRegained, m.HeartbeatAnswered(false));
        Assert.Equal(LeaseState.Held, m.State);
        Assert.Equal(LeaseEffect.None, m.HeartbeatAnswered(false)); // gehalten: kein weiteres Ereignis
    }

    // ---- vorgezogen aus AP-16g: Neustart über die Outbox, Rig belegt (P-10, P-22) -----------------------------

    [Fact]
    public void Neustart_mit_Session_reacquiring_bis_zur_ersten_Antwort()
    {
        var m = new LeaseStateMachine();
        m.ResumeSent();
        Assert.Equal(LeaseState.Reacquiring, m.State);
        Assert.Equal(LeaseEffect.LeaseRegained, m.HeartbeatAnswered(leaseLost: false));
        Assert.Equal(LeaseState.Held, m.State);
    }

    [Fact]
    public void Ohne_Lease_aendert_leaseLost_nichts_rig_busy_bleibt()
    {
        var m = Held();
        Assert.Equal(LeaseEffect.RigBusy, m.RigBusy());
        Assert.Equal(LeaseEffect.None, m.HeartbeatAnswered(leaseLost: true));
        Assert.Equal(LeaseState.None, m.State);
    }
}
