using NinaPm.Core.Api.Generated;
using NinaPm.Core.Planning;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// <em>NINA-PM Warten auf Zeit</em> und <em>NINA-PM Tagesschleife</em> (AP-52, FA-NIN-07, FA-NIN-26, execution.md §1) am
/// Standort Starfront (<c>America/Chicago</c>): Standortzeit nur aus der Übergangsliste (NT-06), Zeitumstellung L2,
/// Enddatum einschließlich, Nachtschleife über zwei Nächte ohne NINA-Neustart.
/// </summary>
public sealed class DayLoopTests
{
    private static DateTimeOffset T(string iso) => UtcText.Parse(iso);

    /// <summary>Übergänge wie <c>bootstrap.timeZoneTransitions</c>: erster Eintrag = letzter Übergang vor Tabellenbeginn.</summary>
    private static readonly SiteClock Chicago = new([
        new ZoneTransition(T("2025-11-02T07:00:00Z"), -360),
        new ZoneTransition(T("2026-03-08T08:00:00Z"), -300),
        new ZoneTransition(T("2026-11-01T07:00:00Z"), -360),
    ]);

    /// <summary>Nacht-Tabelle Mittag bis Mittag in Standortzeit, Nachtfensterende 08:00 Standortzeit, Dämmerungen fest gegen Mittag.</summary>
    private static List<NightRow> Nights(string first, int count)
    {
        var start = DateOnly.Parse(first);
        return Enumerable.Range(0, count).Select(i =>
        {
            var d = start.AddDays(i);
            var noon = Chicago.ToUtc(d, new TimeOnly(12, 0));
            var twilight = new NightTwilight(
                new TwilightCrossing(noon.AddHours(7.5), noon.AddHours(18)),
                new TwilightCrossing(noon.AddHours(8), noon.AddHours(17.5)),
                new TwilightCrossing(noon.AddHours(8.5), noon.AddHours(17)));
            return new NightRow(d.ToString("yyyy-MM-dd"), noon, Chicago.ToUtc(d.AddDays(1), new TimeOnly(12, 0)),
                Chicago.ToUtc(d.AddDays(1), new TimeOnly(8, 0)), twilight);
        }).ToList();
    }

    // ---- Standortzeit und Zeitumstellung (L2) ----------------------------------------------------------------

    [Fact]
    public void Doppelte_Standortzeit_gilt_in_der_ersten_Instanz()
    {
        // 01:30 am 01.11.2026 kommt zweimal vor (CDT, dann CST): erste Instanz = CDT.
        Assert.Equal(T("2026-11-01T06:30:00Z"), Chicago.ToUtc(new DateOnly(2026, 11, 1), new TimeOnly(1, 30)));
    }

    [Fact]
    public void Ausgefallene_Standortzeit_wird_um_die_Luecke_nach_vorn_verschoben()
    {
        // 02:30 am 08.03.2026 gibt es nicht → 03:30 CDT.
        Assert.Equal(T("2026-03-08T08:30:00Z"), Chicago.ToUtc(new DateOnly(2026, 3, 8), new TimeOnly(2, 30)));
    }

    [Fact]
    public void Warten_auf_Zeit_mit_L2_ueber_die_Nacht_des_Vorabends()
    {
        // Uhrzeit vor dem Tageswechsel (12:00) gehört zum Morgen nach dem Abend des Nacht-Schlüssels.
        var fall = WaitForTime.Target(new WaitForTimeSpec(WaitSource.Time, new TimeOnly(1, 30)), Nights("2026-10-31", 1)[0], Chicago);
        Assert.Equal(T("2026-11-01T06:30:00Z"), fall.UntilUtc);
        var spring = WaitForTime.Target(new WaitForTimeSpec(WaitSource.Time, new TimeOnly(2, 30)), Nights("2026-03-07", 1)[0], Chicago);
        Assert.Equal(T("2026-03-08T08:30:00Z"), spring.UntilUtc);
    }

    [Fact]
    public void Uhrzeit_21_Uhr_gilt_in_Standortzeit_nicht_in_der_PC_Zone()
    {
        // NINA-PC in Europe/Berlin, Standort America/Chicago: 21:00 = 21:00 CDT (02:00Z), nicht 21:00 MESZ (19:00Z).
        // Der Kern kennt die PC-Zone nicht (TimeZoneInfo.Local ist per BannedApiAnalyzers verboten, BannedSymbols.txt).
        var nights = Nights("2026-09-17", 3);
        var now = T("2026-09-18T15:00:00Z"); // 17:00 MESZ = 10:00 CDT → currentNight 2026-09-18
        var target = WaitForTime.Target(new WaitForTimeSpec(WaitSource.Time, new TimeOnly(21, 0)), nights, Chicago, now, null);
        Assert.Equal(("2026-09-18", T("2026-09-19T02:00:00Z")), (target.Night, target.UntilUtc!.Value));
        Assert.Equal(TimeSpan.FromHours(11), WaitForTime.Remaining(target, now));
    }

    // ---- Tabellentests: Quelle, Versatz, Tageswechsel --------------------------------------------------------

    [Theory]
    // Quelle, Uhrzeit, Versatz [min], Tageswechsel → erwartetes Ende (UTC); Nacht 2026-09-18, Mittag = 17:00Z.
    [InlineData(WaitSource.Time, "20:45", 0, "12:00", "2026-09-19T01:45:00Z")]
    [InlineData(WaitSource.Time, "20:45", 15, "12:00", "2026-09-19T02:00:00Z")]
    [InlineData(WaitSource.Time, "11:00", 0, "12:00", "2026-09-19T16:00:00Z")] // vor dem Tageswechsel → Folgetag
    [InlineData(WaitSource.Time, "11:00", 0, "10:00", "2026-09-18T16:00:00Z")] // Tageswechsel 10:00 → am Abenddatum
    [InlineData(WaitSource.CivilDusk, "00:00", 0, "12:00", "2026-09-19T00:30:00Z")]
    [InlineData(WaitSource.NauticalDusk, "00:00", 0, "12:00", "2026-09-19T01:00:00Z")]
    [InlineData(WaitSource.AstronomicalDusk, "00:00", 0, "12:00", "2026-09-19T01:30:00Z")]
    [InlineData(WaitSource.AstronomicalDusk, "00:00", 15, "12:00", "2026-09-19T01:45:00Z")] // P-24: Dämmerung + 15 min
    [InlineData(WaitSource.NauticalDusk, "00:00", -30, "12:00", "2026-09-19T00:30:00Z")]
    public void Zielzeit_je_Quelle_Versatz_und_Tageswechsel(WaitSource source, string time, int offset, string rollover, string expected)
    {
        var spec = new WaitForTimeSpec(source, TimeOnly.Parse(time), offset, TimeOnly.Parse(rollover));
        var target = WaitForTime.Target(spec, Nights("2026-09-18", 1)[0], Chicago);
        // ±30 s (P-24): die Rechnung selbst ist exakt.
        Assert.InRange((target.UntilUtc!.Value - T(expected)).Duration(), TimeSpan.Zero, TimeSpan.FromSeconds(30));
        Assert.Equal(rollover != "12:00", spec.RolloverDiffersFromNoon);
    }

    [Fact]
    public void Ohne_Daemmerung_in_der_Nacht_kein_Zielzeitpunkt()
    {
        var row = Nights("2026-06-20", 1)[0] with
        {
            Twilight = new NightTwilight(new TwilightCrossing(null, null), new TwilightCrossing(null, null), new TwilightCrossing(null, null)),
        };
        var target = WaitForTime.Target(new WaitForTimeSpec(WaitSource.AstronomicalDusk, default), row, Chicago);
        Assert.Null(target.UntilUtc);
        Assert.Equal(TimeSpan.Zero, WaitForTime.Remaining(target, T("2026-06-20T20:00:00Z")));
    }

    [Fact]
    public void Nach_der_beendeten_Nacht_wartet_die_Anweisung_auf_die_folgende()
    {
        var nights = Nights("2026-09-17", 3);
        // 06:00 CDT, vor dem Nachtfensterende (08:00): currentNight ist noch 2026-09-17, die ist aber beendet.
        var morning = T("2026-09-18T11:00:00Z");
        var spec = new WaitForTimeSpec(WaitSource.AstronomicalDusk, default);
        // Auch ohne beendete Nacht (Start am Morgen nach der Dunkelheit): die folgende Nacht, nicht die vorbeigegangene
        // Dämmerung der alten – sonst entparkte die Sequenz im Morgengrauen (Analyse 04.10.2026).
        Assert.Equal("2026-09-18", WaitForTime.Target(spec, nights, Chicago, morning, null).Night);
        // Mitten in der Nacht (vor der Morgendämmerung) bleibt es die laufende Nacht.
        Assert.Equal("2026-09-17", WaitForTime.Target(spec, nights, Chicago, T("2026-09-18T07:00:00Z"), null).Night);
        var next = WaitForTime.Target(spec, nights, Chicago, morning, finishedNight: "2026-09-17");
        Assert.Equal(("2026-09-18", T("2026-09-19T01:30:00Z")), (next.Night, next.UntilUtc!.Value));
    }

    // ---- Tagesschleife ---------------------------------------------------------------------------------------

    private static List<DeliveryNights> Delivery(params (string Night, int Projects)[] rows) =>
        rows.Select(r => new DeliveryNights { Night = r.Night, Projects = r.Projects }).ToList();

    [Fact]
    public void Enddatum_letzter_Nacht_Schluessel_einschliesslich_auch_ueber_die_25_Stunden_Nacht()
    {
        var nights = Nights("2026-10-30", 4);
        var night31 = nights.Single(n => n.Night == "2026-10-31");
        Assert.Equal(TimeSpan.FromHours(25), night31.NoonEndUtc - night31.NoonStartUtc);
        var settings = new DayLoopSettings(EndNight: "2026-10-31");
        var loop = new DayLoopState();

        // Nacht 30.10. beendet, am Morgen (06:00 CDT, vor dem Nachtfensterende): nächste Nacht 31.10. läuft noch.
        var next = DayLoopState.NextNight(nights, T("2026-10-31T11:00:00Z"), finishedNight: "2026-10-30");
        Assert.Equal("2026-10-31", next);
        Assert.Equal(DayLoopDecision.Continue, loop.Evaluate(settings, next, null, finishedNight: "2026-10-30"));

        // Nacht 31.10. beendet: am Morgen des 01.11. – vor (05:00 CST) und nach dem Nachtfensterende (09:00 CST).
        foreach (var morning in new[] { "2026-11-01T11:00:00Z", "2026-11-01T15:00:00Z" })
        {
            next = DayLoopState.NextNight(nights, T(morning), finishedNight: "2026-10-31");
            Assert.Equal("2026-11-01", next);
            Assert.Equal(DayLoopDecision.End_date, loop.Evaluate(settings, next, null, finishedNight: "2026-10-31"));
        }
    }

    [Fact]
    public void Hoechstzahl_Naechte_zaehlt_beendete_Naechte()
    {
        var loop = new DayLoopState();
        var settings = new DayLoopSettings(MaxNights: 2);
        // Sequenzstart: noch keine beendete Nacht.
        Assert.Equal(DayLoopDecision.Continue, loop.Evaluate(settings, "2026-09-17", null));
        // Ende der 1. Nacht und Beginn der 2. Runde sehen dieselbe beendete Nacht – sie zählt einmal.
        Assert.Equal(DayLoopDecision.Continue, loop.Evaluate(settings, "2026-09-18", null, "2026-09-17"));
        Assert.Equal(DayLoopDecision.Continue, loop.Evaluate(settings, "2026-09-18", null, "2026-09-17"));
        Assert.Equal(DayLoopDecision.Max_nights, loop.Evaluate(settings, "2026-09-19", null, "2026-09-18"));
        Assert.Equal(2, loop.Nights.Count);
        // Ohne Nacht-Tabelle zählt die Höchstzahl genauso.
        Assert.Equal(DayLoopDecision.Max_nights, new DayLoopState().EvaluateWithoutTable(new DayLoopSettings(MaxNights: 1), "2026-09-17"));
        loop.Reset();
        Assert.Equal(DayLoopDecision.Continue, loop.Evaluate(settings, "2026-09-19", null));
    }

    [Fact]
    public void Leere_Auslieferung_der_naechsten_drei_Naechte_beendet_die_Schleife()
    {
        var loop = new DayLoopState();
        var settings = new DayLoopSettings();
        Assert.Equal(DayLoopDecision.No_delivery,
            loop.Evaluate(settings, "2026-09-18", Delivery(("2026-09-18", 0), ("2026-09-19", 0), ("2026-09-20", 0))));
        // Projekt mit Startdatum übermorgen: weiterlaufen (Nächte ohne Plan werden übersprungen).
        Assert.Equal(DayLoopDecision.Continue,
            loop.Evaluate(settings, "2026-09-18", Delivery(("2026-09-18", 0), ("2026-09-19", 0), ("2026-09-20", 1))));
        // Angabe von gestern (nur Nächte vor der nächsten) oder keine Ziele geladen: unbekannt → weiterlaufen.
        Assert.True(DayLoopState.HasDelivery("2026-09-21", Delivery(("2026-09-18", 0), ("2026-09-19", 0), ("2026-09-20", 0))));
        Assert.True(DayLoopState.HasDelivery("2026-09-18", null));
        // Nur Nächte ab der nächsten zählen: die laufende Nacht mit Arbeit hilft der folgenden nicht.
        Assert.False(DayLoopState.HasDelivery("2026-09-19", Delivery(("2026-09-18", 3), ("2026-09-19", 0), ("2026-09-20", 0))));
    }

    // ---- Nachtschleife über zwei Nächte (Zustandsmaschine) ---------------------------------------------------

    private static NightContext Ctx(string now, string night, DateTimeOffset windowEnd, bool stale = false) =>
        new(T(now), null, windowEnd, stale, HasSession: false, FlatsEnabled: false, FlatsPending: false, Night: night);

    [Fact]
    public void Nachtschleife_wartet_nach_der_Anforderung_auf_den_Nachtwechsel_und_beginnt_neu()
    {
        var loop = new NightLoop();
        var windowEnd = T("2026-09-18T13:00:00Z");
        Assert.Equal(NightAction.FinishNight, loop.Decide(Ctx("2026-09-18T13:00:00Z", "2026-09-17", windowEnd)).Action);
        loop.NightFinishedSet("2026-09-17");
        // Ohne Tagesschleife: falsch, Ende-Bereich (NT-11).
        Assert.False(loop.HasBlocksRemaining(false, false));
        Assert.Equal(NightAction.Stop, loop.Decide(Ctx("2026-09-18T13:00:01Z", "2026-09-17", windowEnd)).Action);

        // Tagesschleife fordert die nächste Nacht an: wieder wahr, warten bis zum Nachtwechsel (currentNight, NT-01).
        loop.RequestNextNight();
        Assert.True(loop.HasBlocksRemaining(false, false));
        Assert.Equal("2026-09-17", loop.FinishedNight);
        var wait = loop.Decide(Ctx("2026-09-18T12:59:00Z", "2026-09-17", windowEnd));
        Assert.Equal((NightAction.WaitForNight, windowEnd), (wait.Action, wait.WaitUntilUtc!.Value));
        Assert.Equal(NinaHeartbeatState.Idle, loop.HeartbeatState(false, false, false, false));

        // Neue Nacht: wie eine veraltete Session neu aufbauen, danach Erstplan für die neue Nacht.
        Assert.Equal(NightAction.ResetStaleSession, loop.Decide(Ctx("2026-09-18T13:00:00Z", "2026-09-18", T("2026-09-19T13:00:00Z"))).Action);
        loop.NewNight();
        Assert.False(loop.NightFinished);
        Assert.Equal(NightAction.FetchPlan, loop.Decide(Ctx("2026-09-18T23:00:00Z", "2026-09-18", T("2026-09-19T13:00:00Z"))).Action);
    }

    [Fact]
    public void Anforderung_ohne_beendete_Nacht_ist_ohne_Wirkung()
    {
        var loop = new NightLoop();
        loop.RequestNextNight();
        Assert.False(loop.NextNightRequested);
        loop.NightFinishedSet("2026-09-17");
        Assert.False(loop.NextNightRequested); // eine frühere Anforderung gilt nicht für die neue beendete Nacht
    }

    [Fact]
    public void Nicht_behebbarer_gesperrter_Zustand_bleibt_auch_mit_Anforderung_falsch()
    {
        var loop = new NightLoop();
        loop.NightFinishedSet("2026-09-17");
        loop.Block(NinaHeartbeatBlockedReason.Token_invalid, T("2026-09-18T13:00:00Z"));
        loop.RequestNextNight();
        Assert.False(loop.HasBlocksRemaining(false, false));
    }
}
