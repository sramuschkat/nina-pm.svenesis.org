using Newtonsoft.Json;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Flats;
using NinaPm.Core.Logging;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Flat-Ablauf (execution.md §7, AP-50): seriell, Meldungen, Dark-Flat-Gruppen, Fortsetzen, Trained Flats, Kopie.</summary>
public sealed class FlatExecutorTests : IDisposable
{
    private const string Night = "2026-10-03";
    private static readonly Guid M31 = Guid.Parse("00000000-0000-0000-0000-000000000031");
    private static readonly Guid Ngc7000 = Guid.Parse("00000000-0000-0000-0000-000000007000");
    private static readonly Guid PlanId = Guid.Parse("00000000-0000-0000-0000-0000000000aa");

    private readonly string dir = Directory.CreateTempSubdirectory("ninapm-flats-").FullName;
    private readonly FixedClock clock = new(new DateTimeOffset(2026, 10, 4, 11, 0, 0, TimeSpan.Zero));
    private readonly ListSink sink = new();
    private readonly LocalStore store;
    private readonly FakeFlatHost host;
    private readonly FlatExecutor flats;
    private readonly List<Captures> captures = [];
    private readonly List<(EventsKind Kind, string? Code)> events = [];

    private static readonly FlatPlanOptions Options = new(5, false, false,
        [new RigFilter("L", "L", 1, "luminance"), new RigFilter("Ha", "HA", 2, "narrowband")]);

    public FlatExecutorTests()
    {
        store = LocalStore.Open(Path.Combine(dir, "ninapm.db"), clock);
        host = new FakeFlatHost(clock);
        flats = new FlatExecutor(host, store, clock, new NinaPmLog(sink))
        {
            ReportCapture = captures.Add,
            ReportEvent = (k, c, _) => events.Add((k, c)),
        };
    }

    public void Dispose()
    {
        store.Dispose();
        try { Directory.Delete(dir, true); } catch (IOException) { }
    }

    private void Light(string filter, double mechDeg, Guid project, string name, int count = 3) =>
        store.RecordFlatLight(Night, new LightObservation(filter, filter.ToUpperInvariant(), 100, 10, 1, 0, null,
            FlatClustering.Dg(mechDeg), new FlatTarget(project, null, name), 0, count));

    private FlatRunSettings Settings(DateTimeOffset? notAfter = null, int darks = 5) => new(Night, PlanId, 5, darks, notAfter, Options);

    private IEnumerable<string> Log(string evt) => sink.Lines.Where(l => l.Contains($"| {evt} "));

    [Fact]
    public async Task Kombinationen_laufen_seriell_und_melden_eingefrorenen_Winkel_Zielliste_und_Sollwerte()
    {
        Light("L", 0, M31, "M 31");
        Light("L", 0.3, Ngc7000, "NGC 7000");
        Light("Ha", 45, Ngc7000, "NGC 7000");

        await flats.RunAsync(Settings(), CancellationToken.None);

        Assert.Equal(["L@0", "HA@45"], host.Runs.Select(r => $"{host.Filters[r.FilterIndex]}@{host.MechAt[host.Runs.IndexOf(r)]}").ToArray());
        var l = captures.Where(c => c.FilterShortName == "L").ToList();
        Assert.Equal(10, l.Count); // 5 Flats + 5 Dark-Flats
        Assert.All(l, c =>
        {
            Assert.Equal(0.2, c.RotatorMechDeg); // Median 0,15° → 0,2°, eingefroren
            Assert.Equal([M31, Ngc7000], c.ProjectIds);
            Assert.Equal(5, c.FlatsPlanned);
            Assert.Equal(5, c.DarkFlatsPlanned);
            Assert.Equal(PlanId, c.NightPlanId);
        });
        Assert.Equal(5, l.Count(c => c.FrameType == CapturesFrameType.Dark_flat));
        Assert.All(store.FlatCombinations(Night), c => Assert.Equal(FlatStatus.Done, c.Status));
        Assert.Equal((EventsKind.Flats_start, (string?)null), events.First());
        Assert.Equal((EventsKind.Flats_end, (string?)null), events.Last());
        // Geteilte Kombination: Dateien des Primärziels in den Ordner von NGC 7000 kopiert, Kopien nicht gemeldet.
        Assert.Equal(10, host.Copies.Count);
        Assert.All(host.Copies, c => Assert.Contains("/NGC 7000/", c.Destination));
    }

    [Fact]
    public async Task Dark_Flat_Gruppe_nur_einmal_je_Nacht_zweite_Kombination_meldet_darkFlatsPlanned_0()
    {
        Light("L", 0, M31, "M 31");
        Light("L", 45, Ngc7000, "NGC 7000");
        host.Trained[(0, 1, 100, 10)] = 2.0;

        await flats.RunAsync(Settings(), CancellationToken.None);

        Assert.Equal([5, 0], host.Runs.Select(r => r.DarkFlats).ToArray());
        Assert.All(captures.Where(c => c.RotatorMechDeg == 45), c => Assert.Equal(0, c.DarkFlatsPlanned));
        Assert.Single(Log("DARKFLAT_GROUP"));
    }

    [Fact]
    public async Task Dark_Flats_der_Gruppe_kommen_einmal_in_die_Ordner_der_Ziele_anderer_Kombinationen()
    {
        // Rig-Nacht 06.10.2026: L von M 31 nahm die Dark-Flats (alle Kombinationen 3 s), Ha/OIII/SII von NGC 7380 nicht –
        // die Dark-Flats lagen nur im Ordner von M 31.
        Light("L", 0, M31, "M 31");
        Light("Ha", 0, Ngc7000, "NGC 7000");
        Light("Ha", 45, Ngc7000, "NGC 7000");

        await flats.RunAsync(Settings(), CancellationToken.None);

        Assert.Equal([5, 0, 0], host.Runs.Select(r => r.DarkFlats).ToArray());
        var copies = host.Copies.Where(c => c.Source.Contains("/DARK/")).ToList();
        Assert.Equal(5, copies.Count); // einmal je Ziel, nicht je Kombination
        Assert.All(copies, c =>
        {
            Assert.StartsWith("D:/Astro/M 31/DARK/", c.Source);
            Assert.StartsWith("D:/Astro/NGC 7000/DARK/", c.Destination);
        });
        Assert.DoesNotContain(captures, c => c.FrameType == CapturesFrameType.Dark_flat && c.ProjectIds!.Contains(Ngc7000));
    }

    [Fact]
    public async Task Abbruch_waehrend_der_zweiten_Kombination_setzt_nur_mit_den_fehlenden_Aufnahmen_fort()
    {
        Light("L", 0, M31, "M 31");
        Light("Ha", 0, M31, "M 31");
        host.CancelAfterFlats = (1, 3); // zweite Kombination: nach 3 Flats abbrechen
        using var cts = new CancellationTokenSource();
        host.Cancel = cts;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => flats.RunAsync(Settings(darks: 0), cts.Token));

        var ha = store.FlatCombinations(Night).Single(c => c.FilterShort == "Ha");
        Assert.Equal(FlatStatus.Running, ha.Status);
        Assert.Equal(3, ha.FlatsSaved);

        host.CancelAfterFlats = null;
        host.Runs.Clear();
        await flats.RunAsync(Settings(darks: 0), CancellationToken.None);

        var run = Assert.Single(host.Runs);
        Assert.Equal(2, run.Flats);
        Assert.Contains(sink.Lines, l => l.Contains("FLATS_RESUME combination=Ha_b1_g100_o10_r0 mechDg=0 missing=2"));
        Assert.Equal(2, store.FlatCombinations(Night).Count); // keine zweite Zeile für dieselbe Kombination
        Assert.All(captures.Where(c => c.FilterShortName == "Ha"), c => Assert.Equal(5, c.FlatsPlanned));
        Assert.Equal(5, captures.Count(c => c.FilterShortName == "Ha"));
    }

    [Fact]
    public async Task Geaenderte_Filterposition_bei_Trained_Flats_ueberspringt_die_Kombination_mit_Warnung()
    {
        store.SetState(StateKeys.TrainedFlatPositions, JsonConvert.SerializeObject(new Dictionary<string, int> { ["HA"] = 5, ["L"] = 1 }));
        Light("L", 0, M31, "M 31");
        Light("Ha", 0, M31, "M 31");

        await flats.RunAsync(Settings(), CancellationToken.None);

        Assert.Single(host.Runs);
        Assert.Equal(FlatStatus.Skipped, store.FlatCombinations(Night).Single(c => c.FilterShort == "Ha").Status);
        Assert.Contains(sink.Lines, l => l.StartsWith("W ") && l.Contains("WARNING code=trained_flat_position_changed filter=HA"));
        Assert.Contains((EventsKind.Warning, (string?)"trained_flat_position_changed"), events);
        // Nach dem Lauf gilt die aktuelle Position.
        var positions = JsonConvert.DeserializeObject<Dictionary<string, int>>(store.GetState(StateKeys.TrainedFlatPositions)!)!;
        Assert.Equal(1, positions["L"]);
        Assert.Equal(5, positions["HA"]);

        // Folgenacht: kein dauerhaftes Überspringen – die neue Position gilt, Ha läuft (Analyse 04.10.2026).
        const string next = "2026-10-04";
        store.RecordFlatLight(next, new LightObservation("Ha", "HA", 100, 10, 1, 0, null, FlatClustering.Dg(0),
            new FlatTarget(M31, null, "M 31"), 0, 3));
        sink.Lines.Clear();
        await flats.RunAsync(Settings() with { Night = next }, CancellationToken.None);
        Assert.Equal(FlatStatus.Done, store.FlatCombinations(next).Single(c => c.FilterShort == "Ha").Status);
        Assert.DoesNotContain(sink.Lines, l => l.Contains("trained_flat_position_changed"));
        positions = JsonConvert.DeserializeObject<Dictionary<string, int>>(store.GetState(StateKeys.TrainedFlatPositions)!)!;
        Assert.NotEqual(5, positions["HA"]);
    }

    [Fact]
    public async Task Zu_helle_erste_Flat_Aufnahme_meldet_flat_exposure_off_und_laeuft_weiter()
    {
        Light("L", 0, M31, "M 31");
        host.MeanAduShare = 0.9;

        await flats.RunAsync(Settings(darks: 0), CancellationToken.None);

        Assert.Single(sink.Lines, l => l.Contains("WARNING code=flat_exposure_off"));
        Assert.Equal(5, captures.Count);
        Assert.Equal(FlatStatus.Done, store.FlatCombinations(Night).Single().Status);
    }

    [Fact]
    public async Task Nach_flatsNotAfterUtc_beginnt_keine_Kombination_mehr()
    {
        Light("L", 0, M31, "M 31");
        await flats.RunAsync(Settings(notAfter: clock.UtcNow.AddMinutes(-1)), CancellationToken.None);
        Assert.Empty(host.Runs);
        Assert.Contains(sink.Lines, l => l.Contains("FLATS_END combination=L_b1_g100_o10_r0 mechDg=0 status=skipped reason=flats_not_after"));
    }

    [Fact]
    public async Task Gescheiterte_Box_ohne_Dateien_ueberspringt_ohne_Wartezeit_und_gibt_die_Dark_Flat_Gruppe_frei()
    {
        Light("L", 0, M31, "M 31");
        Light("Ha", 0, M31, "M 31");
        host.Trained[(0, 1, 100, 10)] = 2.0;
        host.Trained[(1, 1, 100, 10)] = 2.0;
        host.FailRuns.Add(0);
        var start = clock.UtcNow;

        await flats.RunAsync(Settings(), CancellationToken.None);

        var combos = store.FlatCombinations(Night);
        Assert.Equal(FlatStatus.Skipped, combos.Single(c => c.FilterShort == "L").Status);
        Assert.Contains(sink.Lines, l => l.Contains("FLATS_END combination=L_b1_g100_o10_r0 mechDg=0 status=skipped reason=box_failed"));
        Assert.True(clock.UtcNow - start < FlatExecutor.SaveGrace, "keine 120 s Wartezeit nach einer gescheiterten Box");
        // Die Dark-Flats nimmt die nächste Kombination mit derselben Gruppe (Ha, gleiche Belichtung) auf.
        Assert.Equal([5, 5], host.Runs.Select(r => r.DarkFlats).ToArray());
        Assert.Equal(5, captures.Count(c => c.FrameType == CapturesFrameType.Dark_flat && c.FilterShortName == "Ha"));
        Assert.Single(sink.Lines, l => l.Contains("DARKFLAT_GROUP") && l.Contains("Ha_b1"));
    }

    [Fact]
    public async Task Unbekannte_Anzahl_wartet_120_s_nach_dem_letzten_Bild()
    {
        Light("L", 0, M31, "M 31");
        host.BoxesValue = host.BoxesValue with { CountsKnown = false, UsesTrainedTable = false, HasDarkFlats = false };
        var start = clock.UtcNow;
        await flats.RunAsync(Settings(darks: 0), CancellationToken.None);
        Assert.Equal(5, captures.Count);
        Assert.True(clock.UtcNow - start >= FlatExecutor.SaveGrace);
        Assert.All(captures, c => Assert.Null(c.FlatsPlanned));
    }
}

/// <summary>NINA-Attrappe für den Flat-Ablauf: jede Kombination speichert ihre Flats/Dark-Flats sofort über den Handler.</summary>
internal sealed class FakeFlatHost(FixedClock clock) : IFlatHost
{
    public FlatBoxes BoxesValue { get; set; } = new(true, true, true, HasDarkFlats: true, UsesTrainedTable: true, CountsKnown: true);
    public List<string> Filters { get; } = ["L", "HA"];
    public Dictionary<(int, int, int, int), double> Trained { get; } = [];
    public List<FlatComboRun> Runs { get; } = [];
    public List<int> MechAt { get; } = [];
    public List<(string Source, string Destination)> Copies { get; } = [];
    public double MeanAduShare { get; set; } = 0.5;
    public (int Run, int Flats)? CancelAfterFlats { get; set; }

    /// <summary>Läufe (ab 0), deren Box ohne eine gespeicherte Datei scheitert (VM-Lauf 04.10.2026: „Index was out of range“).</summary>
    public HashSet<int> FailRuns { get; } = [];
    public CancellationTokenSource? Cancel { get; set; }
    private Action<FlatImage>? sinkAction;
    private double mech;
    private int frame;

    public FlatBoxes Boxes() => BoxesValue;
    public bool RotatorConnected => true;

    public Task MoveMechanicalAsync(double degrees, CancellationToken token)
    {
        mech = degrees;
        return Task.CompletedTask;
    }

    public IReadOnlyList<string> ProfileFilterNames() => Filters;
    public Task ChangeFilterAsync(int filterIndex, CancellationToken token) => Task.CompletedTask;
    public IReadOnlyList<string>? ReadoutModes() => ["Normal"];
    public void SetReadoutMode(int index) { }
    public double? TrainedFlatExposureS(int filterIndex, int binning, int gain, int offset) =>
        Trained.TryGetValue((filterIndex, binning, gain, offset), out var s) ? s : 1.5;
    public double? MaxAdu() => 65535;
    public Task RunSetupAsync(CancellationToken token) => Task.CompletedTask;
    public Task RunTeardownAsync(CancellationToken token) => Task.CompletedTask;

    public Task RunCombinationAsync(FlatComboRun run, CancellationToken token)
    {
        Runs.Add(run);
        MechAt.Add((int)Math.Round(mech));
        if (FailRuns.Contains(Runs.Count - 1)) throw new ArgumentOutOfRangeException("index");
        var filter = run.FilterIndex >= 0 ? Filters[run.FilterIndex] : null;
        for (var i = 0; i < run.Flats; i++)
        {
            if (CancelAfterFlats is { } c && c.Run == Runs.Count - 1 && i == c.Flats)
            {
                Cancel!.Cancel();
                token.ThrowIfCancellationRequested();
            }
            Save(run, filter, dark: false);
        }
        for (var i = 0; i < run.DarkFlats; i++) Save(run, filter, dark: true);
        return Task.CompletedTask;
    }

    private void Save(FlatComboRun run, string? filter, bool dark)
    {
        clock.Advance(TimeSpan.FromSeconds(3));
        frame++;
        sinkAction?.Invoke(new FlatImage($"D:/Astro/{run.TargetName}/{(dark ? "DARK" : "FLAT")}/{filter}_{frame:0000}.fits", dark, filter, run.Binning, 1.5,
            dark ? null : MeanAduShare * 65535, clock.UtcNow.AddSeconds(-2), clock.UtcNow.AddSeconds(-1.25), -10, -10));
    }

    public void BeginImages(Action<FlatImage> sink) => sinkAction = sink;
    public void EndImages() => sinkAction = null;

    public bool CopyFile(string source, string destination)
    {
        Copies.Add((source, destination));
        return true;
    }

    public Task DelayAsync(DateTimeOffset untilUtc, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        if (untilUtc > clock.UtcNow) clock.UtcNow = untilUtc;
        return Task.CompletedTask;
    }
}
