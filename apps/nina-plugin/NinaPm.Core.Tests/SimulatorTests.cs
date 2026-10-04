using System.Text.RegularExpressions;
using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Simulator;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Simulator im Plugin (FA-NIN-18, AP-53): gesperrte Einstellungen aus dem Bootstrap, Verfügbarkeit nur mit Verbindung
/// (der Server rechnet, nie lokal), Datumsauswahl über die Nacht-Tabelle, Standortzeit mit Kürzel, Zielkarten,
/// Plangrafik (Anteile der Zeitachse), Planprotokoll zum Kopieren, Zielfarben und Beispielsequenzen.
/// </summary>
public sealed class SimulatorTests
{
    private static T Example<T>(string name) => JsonConvert.DeserializeObject<T>(ContractExamples.Json(name), NinaJson.Settings())!;

    private static readonly NinaSimulation Sim = Example<NinaSimulation>("simulation.response");
    private static readonly NinaBootstrap Bootstrap = Example<NinaBootstrap>("bootstrap.response");
    private static readonly SiteTime Site = SiteTime.From(Sim);

    private sealed class FakeApi(Func<string, NinaSimulation>? answer = null) : ISimulationApi
    {
        public List<string> Calls { get; } = [];

        public Task<NinaSimulation> SimulateAsync(string night, CancellationToken token)
        {
            Calls.Add(night);
            return Task.FromResult((answer ?? (_ => Sim))(night));
        }
    }

    private sealed class Texts : IPlanLogTexts
    {
        public IReadOnlyList<string> Headers => PlanLog.Columns;
        public string Command(string code) => code switch { "expose_series" => "Belichtungsreihe", "expose" => "Belichtung", _ => code };
        public string Until(string time) => $"bis {time}";
        public string Bonus => "Bonus";
        public string Yes => "ja";
        public string No => "nein";
        public string MoonProfile(string raw) => raw == "moonProfile.moderate" ? "Moderat" : raw;
    }

    private static NinaApiException Problem(int status, string code) =>
        new("x", status, $"{{\"code\":\"{code}\"}}", new Dictionary<string, IEnumerable<string>>(), null);

    // ---- Schritt 1: gesperrte Einstellungen ----

    [Fact]
    public void Einstellungen_kommen_gesperrt_aus_dem_Bootstrap()
    {
        var s = LockedSettings.From(Bootstrap)!;
        Assert.True(s.Locked);
        Assert.Equal("proportional", s.Strategy);
        Assert.Equal("time_aware", s.Playback);
        Assert.Equal(["lowest_peak_altitude", "setting_soonest", "most_remaining", "constrained"], s.SortChain);
        Assert.False(s.BonusEnabled);
        Assert.Equal(0, s.OvershootPct);
        Assert.True(s.MosaicPanelsIndependent);
        Assert.Equal((true, 1), (s.DitherEnabled, s.DitherEvery));
        Assert.Equal((true, 40, 50.0), (s.FilterSwitchEnabled, s.FilterSwitchEvery, s.FilterSwitchTolerancePct));
        Assert.Equal((true, "panel", 20, false), (s.FlatsEnabled, s.FlatsSource, s.FlatCount, s.FullFlatSet));
        Assert.Equal((true, (int?)null), (s.DarkFlatsEnabled, s.DarkFlatCount));
        Assert.Equal((true, 5.0, 15.0, 0.0, 240.0), (s.FlipEnabled, s.FlipAfterMin, s.FlipMaxAfterMin, s.FlipPauseBeforeMin, s.FlipDurationS));
        Assert.Null(LockedSettings.From(null));
    }

    // ---- Verfügbarkeit: der Server rechnet ----

    [Fact]
    public async Task Ohne_Optionen_oder_im_Offline_Modus_kein_Aufruf_und_kein_lokaler_Plan()
    {
        var log = new NinaPmLog(new ListSink());
        var api = new FakeApi();
        var notConfigured = await SimulatorService.RunAsync(null, false, "2026-09-17", log, CancellationToken.None);
        Assert.Equal(SimulatorState.NotConfigured, notConfigured.State);
        var offline = await SimulatorService.RunAsync(api, true, "2026-09-17", log, CancellationToken.None);
        Assert.Equal(SimulatorState.Offline, offline.State);
        Assert.Null(offline.Simulation);
        Assert.Empty(api.Calls);
    }

    [Fact]
    public async Task Mit_Verbindung_rechnet_der_Server_die_gewaehlte_Nacht()
    {
        var sink = new ListSink();
        var api = new FakeApi();
        var r = await SimulatorService.RunAsync(api, false, "2026-09-17", new NinaPmLog(sink), CancellationToken.None);
        Assert.True(r.Ok);
        Assert.Same(Sim, r.Simulation);
        Assert.Equal(["2026-09-17"], api.Calls);
        Assert.Equal(["I NINA-PM | API status=200 call=simulation night=2026-09-17"], sink.Lines);
    }

    [Theory]
    [InlineData(401, "nina.token_invalid", SimulatorState.TokenInvalid)]
    [InlineData(403, "tenant.locked", SimulatorState.TenantLocked)]
    [InlineData(409, "engine.incompatible", SimulatorState.UpdateNeeded)]
    [InlineData(422, "nina.night_invalid", SimulatorState.NightInvalid)]
    [InlineData(503, "internal.error", SimulatorState.Unreachable)]
    [InlineData(422, "engine.input_invalid", SimulatorState.Failed)]
    public async Task Fehler_des_Servers_werden_zum_Zustand(int status, string code, SimulatorState expected)
    {
        var sink = new ListSink();
        var api = new FakeApi(_ => throw Problem(status, code));
        var r = await SimulatorService.RunAsync(api, false, "2026-09-17", new NinaPmLog(sink), CancellationToken.None);
        Assert.Equal(expected, r.State);
        Assert.Equal((status, code), (r.Status, r.Code));
        Assert.Equal([$"W NINA-PM | API status={status} code={code} call=simulation"], sink.Lines);
    }

    [Fact]
    public async Task Netzfehler_heisst_nicht_verfuegbar_ungueltige_Nacht_wird_nicht_gesendet()
    {
        var api = new FakeApi(_ => throw new HttpRequestException("weg"));
        var log = new NinaPmLog(new ListSink());
        Assert.Equal(SimulatorState.Unreachable, (await SimulatorService.RunAsync(api, false, "2026-09-17", log, CancellationToken.None)).State);
        Assert.Equal(SimulatorState.NightInvalid, (await SimulatorService.RunAsync(api, false, "17.09.2026", log, CancellationToken.None)).State);
        Assert.Equal(["2026-09-17"], api.Calls);
    }

    // ---- Datum ----

    [Fact]
    public void Datum_nur_aus_der_Nacht_Tabelle_Heute_Nacht_und_Pfeile()
    {
        var dates = SimulatorDates.From(Bootstrap);
        var now = UtcText.Parse("2026-09-17T19:00:00Z");
        Assert.Equal("2026-09-17", dates.Tonight(now));
        // Morgens nach dem Nachtfensterende ist die kommende Nacht „heute“ (NT-01).
        Assert.Equal("2026-09-18", dates.Tonight(UtcText.Parse("2026-09-18T14:00:00Z")));
        Assert.Equal("2026-09-18", dates.Next("2026-09-17"));
        Assert.Equal("2026-09-19", dates.Next("2026-09-19"));
        Assert.False(dates.CanGoForward("2026-09-19"));
        Assert.Equal("2026-09-17", dates.Previous("2026-09-18", now));
        Assert.False(dates.CanGoBack("2026-09-17", now));
        Assert.Equal("17./18.09.2026", SimulatorDates.Label("2026-09-17"));
        Assert.Equal("30.09./01.10.2026", SimulatorDates.Label("2026-09-30"));
        Assert.Null(SimulatorDates.From(null).Tonight(now));
    }

    // ---- Standortzeit ----

    [Fact]
    public void Standortzeit_mit_Kuerzel_vom_Server_sonst_Offset_aus_dem_Bootstrap()
    {
        var t = UtcText.Parse("2026-09-18T02:08:00Z");
        Assert.Equal("21:08 CDT", Site.ClockZone(t));
        Assert.Equal("21:08:00 CDT", Site.ClockSeconds(t));
        var boot = SiteTime.From(Bootstrap);
        Assert.Equal("21:08 UTC−5", boot.ClockZone(t));
        Assert.Equal("20:08 UTC−6", boot.ClockZone(UtcText.Parse("2026-11-02T02:08:00Z")));
        var dst = new SiteTime([
            new ZoneSegment(UtcText.Parse("2026-10-31T23:00:00Z"), -300, "CDT"),
            new ZoneSegment(UtcText.Parse("2026-11-01T07:00:00Z"), -360, "CST"),
        ]);
        Assert.Equal("01:30 CDT", dst.ClockZone(UtcText.Parse("2026-11-01T06:30:00Z")));
        Assert.Equal("01:30 CST", dst.ClockZone(UtcText.Parse("2026-11-01T07:30:00Z")));
        Assert.Equal("12:00 UTC", SiteTime.From((NinaBootstrap?)null).ClockZone(UtcText.Parse("2026-09-18T12:00:00Z")));
    }

    // ---- Schritt 2: Zielkarten ----

    [Fact]
    public void Zielkarten_mit_Fenster_Stunden_Hoehe_Mond_Pruefliste_und_Flip()
    {
        var cards = SimulatorCards.Build(Sim, Site);
        Assert.Equal(["HAT-P-17 b", "NGC 281 Pacman"], cards.Select(c => c.Name));
        var transit = cards[0];
        Assert.True(transit.Transit);
        Assert.Equal("21:08–02:34 CDT", transit.Window);
        Assert.Equal(5.4, transit.AllocatedHours);
        Assert.Equal("52–78°", transit.Altitude);
        Assert.Equal("96°", transit.MoonSeparation);
        Assert.Equal([new CardFlip("23:33 CDT", 4, true)], transit.Flips);
        var ngc = cards[1];
        Assert.Equal(new CardLine("Ha", "#D32F2F", 300, 17, 17, "moonProfile.moderate", false, true), ngc.Lines[0]);
        Assert.Equal(["altitude", "time", "moon", "darkness", "rotation"], ngc.Checks.Select(c => c.Key));
        Assert.All(ngc.Checks, c => Assert.Equal("ok", c.State));
        Assert.Equal("✓", SimulatorCards.Symbol("ok"));
        Assert.Equal("⚠", SimulatorCards.Symbol("warn"));
        var un = Assert.Single(SimulatorCards.Unallocated(Sim));
        Assert.Equal("M 31", un.Name);
        Assert.Equal(["transit_conflict"], un.Reasons);
    }

    // ---- Schritt 3: Plangrafik ----

    [Fact]
    public void Plangrafik_als_Anteile_des_Nachtfensters_mit_Stunden_in_Standortzeit()
    {
        var chart = PlanChart.Build(Sim, Site, UtcText.Parse("2026-09-18T06:30:00Z"));
        Assert.Equal(13 * 3600, (chart.EndUtc - chart.StartUtc).TotalSeconds);
        var transit = chart.Blocks[0];
        Assert.Equal(2 * 3600 + 8 * 60, transit.X * 13 * 3600, 3);
        Assert.Equal((7 * 3600 + 34 * 60) - (2 * 3600 + 8 * 60), transit.Width * 13 * 3600, 3);
        Assert.True(transit.Transit);
        Assert.Equal("21:08–02:34 CDT", transit.Window);
        Assert.Equal(0, transit.SeriesIndex);
        // Volle Stunden 19 … 08 CDT (00:00Z … 13:00Z).
        Assert.Equal(14, chart.Ticks.Count);
        Assert.Equal(("19", 0.0), (chart.Ticks[0].Label, chart.Ticks[0].X));
        Assert.Equal(("08", 1.0), (chart.Ticks[^1].Label, chart.Ticks[^1].X));
        Assert.Equal(["Flip 23:33", "Flip 02:47"], chart.Flips.Select(f => f.Label));
        Assert.Equal(["R ×326", "Ha ×17"], chart.FilterBars.Select(f => f.Label));
        Assert.Equal([1, 2, 3], chart.Bands.Select(b => b.Level));
        Assert.Equal(6.5 / 13, chart.NowX!.Value, 6);
        Assert.Null(PlanChart.Build(Sim, Site, UtcText.Parse("2026-09-18T14:00:00Z")).NowX);
        Assert.Equal(1 - 30.0 / 90, chart.MinAltitudeY, 6);
        Assert.Equal("CDT", chart.Zone);
        // Höhe 90° oben (0), unter dem Horizont am Boden (1).
        var hat = chart.Curves[0];
        Assert.Equal(1 - 41.2 / 90, hat.Points[0].Y, 6);
        Assert.Equal(1.0, hat.Points[^1].Y);
        Assert.NotNull(chart.Moon);
    }

    // ---- Schritt 3: Planprotokoll ----

    [Fact]
    public void Planprotokoll_wie_S40_und_kopierbar_als_TSV()
    {
        var texts = new Texts();
        var rows = PlanLog.Build(Sim, Site, texts);
        Assert.Equal(Sim.Protocol.Count, rows.Count);
        Assert.Equal("21:05:30 CDT", rows[0].Cell("time"));
        Assert.Equal("slew_center_rotate (90 s)", rows[0].Cell("cmd"));
        Assert.Equal("Belichtungsreihe bis 02:34:00 CDT", rows[1].Cell("cmd"));
        var expose = rows[2];
        Assert.Equal(("1", "Ha", "300 s", "1×1", "High Gain Mode"),
            (expose.Cell("no"), expose.Cell("filter"), expose.Cell("exposure"), expose.Cell("binning"), expose.Cell("readout")));
        Assert.Equal(("13.2046", "56.6297", "61.4", "ja", "42.5", "ja", "Moderat"),
            (expose.Cell("ra"), expose.Cell("dec"), expose.Cell("alt"), expose.Cell("moonOk"), expose.Cell("required"), expose.Cell("la"),
                expose.Cell("profile")));
        Assert.Equal("", rows[0].Cell("moonOk"));
        var tsv = PlanLog.Tsv(rows, texts).Split('\n');
        Assert.Equal(rows.Count + 1, tsv.Length);
        Assert.Equal(string.Join('\t', PlanLog.Columns), tsv[0]);
        Assert.All(tsv, line => Assert.Equal(PlanLog.Columns.Count - 1, line.Count(c => c == '\t')));
    }

    // ---- Farben und Beispielsequenzen ----

    [Fact]
    public void Zielfarben_entsprechen_den_UI_Tokens()
    {
        var tokens = File.ReadAllText(Path.Combine(ContractExamples.RepoRoot(), "packages", "ui-tokens", "src", "tokens.ts"));
        var series = Regex.Matches(tokens, @"'chart-series-(\d)': '(#[0-9a-fA-F]{6})'")
            .OrderBy(m => int.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture))
            .Select(m => m.Groups[2].Value.ToLowerInvariant())
            .ToList();
        Assert.Equal(series, ChartPalette.Series);
        string Token(string key) => Regex.Match(tokens, $@"'{key}': '(#[0-9a-fA-F]{{6}})'").Groups[1].Value.ToLowerInvariant();
        Assert.Equal(ChartPalette.Marker, Token("chart-marker"));
        Assert.Equal(ChartPalette.Moon, Token("chart-moon"));
        Assert.Equal(ChartPalette.MinAltitude, Token("chart-min-alt"));
        Assert.Equal(ChartPalette.Frame, Token("chart-frame"));
        Assert.Equal(ChartPalette.Civil, Token("chart-mark-civil"));
        Assert.Equal(ChartPalette.Axis, Token("chart-axis"));
        Assert.Equal(ChartPalette.Now, Token("chart-now"));
        Assert.Equal(ChartPalette.Meridian, Token("chart-meridian"));
        Assert.Equal(ChartPalette.Ok, Token("chart-recommended"));
        Assert.Equal(ChartPalette.Warn, Token("chart-mark-sun"));
        var rgb = Regex.Match(tokens, @"'chart-sky-night': 'rgb\((\d+), (\d+), (\d+)\)'");
        Assert.Equal(ChartPalette.SkyNight,
            "#" + string.Concat(Enumerable.Range(1, 3).Select(i => int.Parse(rgb.Groups[i].Value, System.Globalization.CultureInfo.InvariantCulture).ToString("x2"))));
        Assert.Equal(ChartPalette.Series[1], ChartPalette.ForSeries(7));
        Assert.Equal(ChartPalette.Moon, ChartPalette.ForSeries(-1));
    }

    [Fact]
    public void Beispielsequenzen_wie_im_Samples_Ordner_mit_Download_Link_je_Version()
    {
        var dir = Path.Combine(ContractExamples.RepoRoot(), "apps", "nina-plugin", "NinaPm.Nina", "Samples");
        var files = Directory.GetFiles(dir, "*.json").Select(f => Path.GetFileName(f)).Order(StringComparer.Ordinal).ToList();
        Assert.Equal(files, SampleSequences.Files.Order(StringComparer.Ordinal).ToList());
        Assert.Equal("https://nina-pm.svenesis.org/downloads/nina-sequences/0.2.0/one-night.json", SampleSequences.Url("0.2.0", "one-night.json"));
    }
}
