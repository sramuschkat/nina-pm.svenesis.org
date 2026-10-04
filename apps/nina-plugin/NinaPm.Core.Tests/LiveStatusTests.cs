using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Status;
using NinaPm.Core.Targets;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Live-Status und Zielbrowser (FA-NIN-02, FA-NIN-13, AP-16h): Blockliste aus dem Plan, gesperrter Zustand je Grund,
/// Zähler und Banner, Zielzeilen, Framing-Übergabe und Panel-Nummerierung NT-32 (geometry.md §2.1, §2.3).
/// </summary>
public sealed class LiveStatusTests
{
    private static T Example<T>(string name) => JsonConvert.DeserializeObject<T>(ContractExamples.Json(name), NinaJson.Settings())!;

    private static readonly NinaPlanResponse Plan = Example<NinaPlanResponse>("plan.response");
    private static readonly NinaTargets Targets = Example<NinaTargets>("targets.response");
    private static readonly NinaBootstrap Bootstrap = Example<NinaBootstrap>("bootstrap.response");

    private static LiveInputs Inputs(string now, Blocks? running = null, IReadOnlySet<Guid>? done = null,
        NinaHeartbeatBlockedReason? blocked = null, bool finished = false) =>
        new(Plan, done ?? new HashSet<Guid>(), running, running?.Entries.First(e => e.Cmd == EntriesCmd.Expose_series), Targets,
            blocked, finished, OutboxPending: 3, DeadLetters: 1, Offline: false, TestBanner: false, UtcText.Parse(now));

    [Fact]
    public void Flats_zeigen_Zustand_Primaerziel_Filter_Kamera_und_mechanischen_Winkel()
    {
        var flat = new NinaPm.Core.Flats.FlatCombination
        {
            FilterShort = "Ha", NinaFilter = "HA", Gain = -1, Offset = -1, Binning = 2, ReadoutIndex = 0, ReadoutName = "Low Noise",
            MechDg = 451, Targets = [new NinaPm.Core.Flats.FlatTarget(Guid.NewGuid(), null, "NGC 7000")],
        };
        var s = LiveStatusBuilder.Build(Inputs("2026-09-18T11:00:00Z") with { FlatsRunning = true, Flat = flat });
        Assert.Equal(LiveState.Flats, s.State);
        Assert.Equal("NGC 7000", s.Target);
        Assert.Equal(45.1, s.RotationDeg);
        Assert.Equal(new LiveExposure("Ha", null, null, null, 2, "Low Noise"), s.Exposure);
    }

    [Fact]
    public void Blockliste_aus_dem_Plan_mit_Zustaenden_und_Namen()
    {
        var transit = Plan.Blocks[0];
        var regular = Plan.Blocks[1];

        // Vor der Nacht: beide offen, nächster Block = Transit.
        var before = LiveStatusBuilder.Build(Inputs("2026-09-18T01:00:00Z"));
        Assert.Equal(LiveState.Waiting, before.State);
        Assert.Equal([LiveBlockState.Pending, LiveBlockState.Pending], before.Blocks.Select(b => b.State));
        Assert.Equal(["HAT-P-17 b", "NGC 281 Pacman"], before.Blocks.Select(b => b.Title));
        Assert.True(before.Blocks[0].Transit);
        Assert.Equal(transit.StartUtc, before.NextBlock);
        Assert.Null(before.Exposure);

        // Transit läuft: Ziel, Koordinaten, Belichtung.
        var running = LiveStatusBuilder.Build(Inputs("2026-09-18T03:00:00Z", running: transit));
        Assert.Equal(LiveState.Running, running.State);
        Assert.Equal(("HAT-P-17 b", transit.RaDeg), (running.Target, running.RaDeg));
        Assert.Equal(("R", 60.0), (running.Exposure!.Filter, running.Exposure.ExposureS));
        Assert.Equal([LiveBlockState.Running, LiveBlockState.Pending], running.Blocks.Select(b => b.State));

        // Transit erledigt, zweiter Block vorbei ohne Lauf: erledigt bzw. verstrichen.
        var after = LiveStatusBuilder.Build(Inputs("2026-09-18T09:30:00Z", done: new HashSet<Guid> { transit.Id }));
        Assert.Equal([LiveBlockState.Done, LiveBlockState.Elapsed], after.Blocks.Select(b => b.State));
        Assert.Null(after.NextBlock);
        Assert.Equal(regular.EndUtc, after.Blocks[1].End);

        // Mit Bootstrap in Standortzeit (Starfront CDT, UTC−5; NT-06), derselbe Zeitpunkt.
        var site = LiveStatusBuilder.Build(Inputs("2026-09-18T01:00:00Z") with { Bootstrap = Bootstrap });
        Assert.Equal(TimeSpan.FromHours(-5), site.Blocks[0].Start.Offset);
        Assert.Equal(transit.StartUtc, site.Blocks[0].Start);

        Assert.Equal(LiveState.Finished, LiveStatusBuilder.Build(Inputs("2026-09-18T09:30:00Z", finished: true)).State);

        // Safety-Pause (§4.6, VM-Prüfstand 03.10.2026): pausiert statt „Warten“, wie der Heartbeat paused; gesperrt geht vor.
        Assert.Equal(LiveState.Paused, LiveStatusBuilder.Build(Inputs("2026-09-18T03:00:00Z") with { SafetyPaused = true }).State);
        Assert.Equal(LiveState.Blocked,
            LiveStatusBuilder.Build(Inputs("2026-09-18T03:00:00Z", blocked: NinaHeartbeatBlockedReason.Rig_busy) with { SafetyPaused = true }).State);
    }

    public static TheoryData<NinaHeartbeatBlockedReason> Reasons() => [.. Enum.GetValues<NinaHeartbeatBlockedReason>()];

    [Theory]
    [MemberData(nameof(Reasons))]
    public void Gesperrt_je_Grund_mit_Code_aus_enums_json(NinaHeartbeatBlockedReason reason)
    {
        var codes = JObject.Parse(File.ReadAllText(Path.Combine(ContractExamples.RepoRoot(), "docs", "contracts", "enums.json")))["blockedReasons"]!
            .Values<string>().ToList();
        var s = LiveStatusBuilder.Build(Inputs("2026-09-18T03:00:00Z", running: Plan.Blocks[0], blocked: reason));
        Assert.Equal(LiveState.Blocked, s.State);
        Assert.Contains(s.BlockedReason, codes);
        Assert.Equal(reason is NinaHeartbeatBlockedReason.Lease_lost or NinaHeartbeatBlockedReason.Clock_skew
            or NinaHeartbeatBlockedReason.Plan_failed, s.BlockedRecoverable);
    }

    [Fact]
    public void Zaehler_Offline_und_Banner_werden_durchgereicht()
    {
        var s = LiveStatusBuilder.Build(Inputs("2026-09-18T01:00:00Z") with { Offline = true, TestBanner = true });
        Assert.Equal((3, 1, true, true), (s.OutboxPending, s.DeadLetters, s.Offline, s.TestBanner));
        Assert.True(LiveStatusBuilder.Build(Inputs("2026-09-18T01:00:00Z") with { Plan = null }).NoPlan);
    }

    // ---- Zielbrowser (FA-NIN-02) ----------------------------------------------------------------------------

    [Fact]
    public void Zielzeilen_mit_Rig_Sensor_und_Brennweite_Filter_nach_Typ()
    {
        var rows = TargetBrowser.Rows(Targets, Bootstrap);
        var ngc = rows.Single(r => r.Name == "NGC 281 Pacman");
        Assert.Equal(("deep_sky", 13.2046, 56.6297, 90.0, 1), (ngc.Type, ngc.RaDeg, ngc.DecDeg, ngc.RotationDeg, ngc.Panels));
        Assert.Equal((382.0, 6248, 4176, 3.76), (ngc.FocalLengthMm!.Value, ngc.SensorWidthPx!.Value, ngc.SensorHeightPx!.Value, ngc.PixelSizeUm!.Value));
        Assert.Equal(57.5, ngc.ProgressPct); // 23 von 40 angenommen
        Assert.Equal(["HAT-P-17 b"], TargetBrowser.Rows(Targets, Bootstrap, type: "exoplanet").Select(r => r.Name));
    }

    [Fact]
    public void Framing_erhaelt_Zentrum_Positionswinkel_Raster_und_Optik()
    {
        var ngc = Targets.Projects.Single(p => p.Name == "NGC 281 Pacman");
        var f = TargetBrowser.Framing(Targets, Bootstrap, ngc.Id)!;
        // Bildfeld: 6248 px × 3,76 µm / 382 mm = 3,52° × 1,5 = 5,28° → 5,5°.
        Assert.Equal(new FramingRequest("NGC 281", 13.2046, 56.6297, 90, 1, 1, 20, 6248, 4176, 3.76, 382, 5.5), f);
        Assert.Null(TargetBrowser.Framing(Targets, Bootstrap, Guid.NewGuid()));
    }

    [Fact]
    public void Bildfeld_umfasst_das_Mosaik_mindestens_NINAs_3_Grad()
    {
        // P-11 (03.10.2026): M 31 2×2, 20 % am Svenesis-Texas-Rig (3008 px, 3,76 µm, 382,4 mm) – Panel 1,69°,
        // Mosaik 3,05° → 4,58° → 5°; mit NINAs 3° zeichnete der Framing-Assistent keine Panels.
        Assert.Equal(5, TargetBrowser.FieldOfViewDeg(2, 2, 20, 3008, 3008, 3.76, 382.4));
        Assert.Equal(3, TargetBrowser.FieldOfViewDeg(1, 1, 20, 3008, 3008, 3.76, 382.4)); // Einzelfeld 1,69° → 2,54° → 3°
        Assert.Equal(3, TargetBrowser.FieldOfViewDeg(3, 3, 20, null, 3008, 3.76, 382.4)); // ohne Sensor die Vorgabe
        Assert.Equal(7.5, TargetBrowser.FieldOfViewDeg(3, 1, 10, 3008, 3008, 3.76, 382.4)); // 1,69 × 2,8 = 4,75° → 7,13° → 7,5°
    }

    [Fact]
    public void Ohne_center_vom_Server_Mittelpunkt_der_Panels()
    {
        // Älterer Server ohne project.center: 2×2 um (10°, 40°), pa₀ = 0 → Zentrum aus den Panel-Richtungen.
        var json = JObject.Parse(ContractExamples.Json("targets.response"));
        var project = (JObject)json["projects"]![0]!;
        project.Remove("center");
        var template = (JObject)project["panels"]![0]!;
        var panels = new JArray();
        for (var n = 1; n <= 4; n++)
        {
            var (ra, dec) = PanelNumbering.Center(10, 40, 0, 2, 1.5, 10, 2, 2, n);
            var p = (JObject)template.DeepClone();
            p["id"] = Guid.NewGuid().ToString();
            p["index"] = n - 1;
            p["raDeg"] = ra;
            p["decDeg"] = dec;
            p["rotationDeg"] = 0.0;
            panels.Add(p);
        }
        project["panels"] = panels;
        var targets = JsonConvert.DeserializeObject<NinaTargets>(json.ToString(), NinaJson.Settings())!;
        var (raC, decC, rotC) = TargetBrowser.Center(targets.Projects[0]);
        Assert.Equal(10, raC, 6);
        Assert.Equal(40, decC, 6);
        Assert.Equal(0, rotC);
    }

    [Fact]
    public void Panel_1_im_2x2_ist_Nordost_Panel_4_Suedwest()
    {
        // geometry.md §2.3 (NT-32): Panel 1 = (i, j) = (1, 0) mit ξ > 0, η > 0; Werte aus der Pflichttabelle.
        Assert.Equal((1, 0), PanelNumbering.Position(1, 2));
        Assert.Equal((0, 1), PanelNumbering.Position(4, 2));
        Assert.Equal([1, 2, 3, 4], new[] { (1, 0), (0, 0), (1, 1), (0, 1) }.Select(p => PanelNumbering.NinaNumber(p.Item1, p.Item2, 2)));
        var (ra1, dec1) = PanelNumbering.Center(0, 0, 0, 1, 1, 10, 2, 2, 1);
        Assert.Equal(0.44999, ra1, 5);
        Assert.Equal(0.44998, dec1, 5);
        var (ra4, dec4) = PanelNumbering.Center(0, 0, 0, 1, 1, 10, 2, 2, 4);
        Assert.Equal(360 - 0.44999, ra4, 5);
        Assert.Equal(-0.44998, dec4, 5);
        // 3×2: Hin- und Rückrechnung n ↔ (i, j) identisch.
        for (var n = 1; n <= 6; n++)
        {
            var (i, j) = PanelNumbering.Position(n, 3);
            Assert.Equal(n, PanelNumbering.NinaNumber(i, j, 3));
        }
    }
}
