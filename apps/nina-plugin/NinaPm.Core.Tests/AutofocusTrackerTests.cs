using NinaPm.Core.Execution;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Autofokus-Läufe erkennen (AP-65, execution.md §10.2): Beginn, Erfolg, gescheiterte Läufe über Settle.</summary>
public sealed class AutofocusTrackerTests
{
    private readonly FixedClock clock = new(UtcText.Parse("2026-10-07T03:00:00Z"));
    private readonly List<AutofocusRun> runs = [];
    private (Guid BlockId, Guid ProjectId)? block = (Guid.Parse("0192a1b2-0000-7000-8000-000000000001"), Guid.Parse("0192a1b2-0000-7000-8000-0000000000aa"));

    private AutofocusTracker Tracker() => new(clock, () => block, runs.Add);

    [Fact]
    public void Erfolgreicher_Lauf_mit_Dauer_Filter_und_Block_beim_Beginn()
    {
        var t = Tracker();
        var start = clock.UtcNow;
        t.Starting("L");
        clock.Advance(TimeSpan.FromSeconds(90));
        t.Point();
        block = null; // Block endet, bevor NINA den Erfolg meldet: der Block beim Beginn zählt
        clock.Advance(TimeSpan.FromSeconds(90.4));
        t.Completed(null);

        var run = Assert.Single(runs);
        Assert.True(run.Ok);
        Assert.Equal(start, run.StartUtc);
        Assert.Equal(start.AddSeconds(180.4), run.EndUtc);
        Assert.Equal(180, run.DurationS);
        Assert.Equal("L", run.Filter);
        Assert.Equal(Guid.Parse("0192a1b2-0000-7000-8000-000000000001"), run.BlockId);
        Assert.Equal(Guid.Parse("0192a1b2-0000-7000-8000-0000000000aa"), run.ProjectId);
        Assert.False(t.Running);
    }

    [Fact]
    public void Filter_der_Erfolgsmeldung_gilt_vor_dem_beim_Beginn()
    {
        var t = Tracker();
        t.Starting(" ");
        clock.Advance(TimeSpan.FromSeconds(60));
        t.Completed("Ha");
        Assert.Equal("Ha", Assert.Single(runs).Filter);
    }

    [Fact]
    public void Gescheitert_nach_dem_Trigger_endet_jetzt()
    {
        var t = Tracker();
        t.Starting("L");
        clock.Advance(TimeSpan.FromSeconds(40));
        t.Point();
        clock.Advance(TimeSpan.FromSeconds(20));
        t.Settle(exact: true);

        var run = Assert.Single(runs);
        Assert.False(run.Ok);
        Assert.Equal(60, run.DurationS);
    }

    [Fact]
    public void Gescheitert_beim_Settle_ohne_exakt_endet_mit_dem_letzten_Messpunkt()
    {
        var t = Tracker();
        t.Starting(null);
        clock.Advance(TimeSpan.FromSeconds(75));
        t.Point();
        clock.Advance(TimeSpan.FromSeconds(300)); // Recenter, Belichtung … – gehört nicht zum Autofokus
        t.Settle(exact: false);

        var run = Assert.Single(runs);
        Assert.False(run.Ok);
        Assert.Equal(75, run.DurationS);
        Assert.Null(run.Filter);
    }

    [Fact]
    public void Gescheitert_ohne_Messpunkt_hat_Dauer_null()
    {
        var t = Tracker();
        t.Starting("L");
        clock.Advance(TimeSpan.FromSeconds(30));
        t.Settle(exact: false);
        Assert.Equal(0, Assert.Single(runs).DurationS);
    }

    [Fact]
    public void Neuer_Beginn_schliesst_den_offenen_Lauf_als_gescheitert()
    {
        var t = Tracker();
        t.Starting("L");
        clock.Advance(TimeSpan.FromSeconds(50));
        t.Point();
        clock.Advance(TimeSpan.FromSeconds(10));
        t.Starting("L");
        clock.Advance(TimeSpan.FromSeconds(120));
        t.Completed("L");

        Assert.Equal(2, runs.Count);
        Assert.False(runs[0].Ok);
        Assert.Equal(50, runs[0].DurationS);
        Assert.True(runs[1].Ok);
        Assert.Equal(120, runs[1].DurationS);
    }

    [Fact]
    public void Ohne_offenen_Lauf_meldet_weder_Erfolg_noch_Settle_etwas()
    {
        var t = Tracker();
        t.Completed("L");
        t.Settle(exact: true);
        t.Point();
        t.Starting("L");
        t.Completed("L");
        t.Settle(exact: false);
        Assert.Single(runs);
    }
}
