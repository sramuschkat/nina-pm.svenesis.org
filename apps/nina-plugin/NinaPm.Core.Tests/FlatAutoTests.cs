using NinaPm.Core.Api.Generated;
using NinaPm.Core.Flats;
using NinaPm.Core.Logging;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Auto-Flats je Projekt (AP-50b): einmal je Projekt, zeitbasiert, mehrere Projekte je Kombination, Nachholen.</summary>
public sealed class FlatAutoTests : IDisposable
{
    private const string Night = "2026-10-03";
    private static readonly Guid M31 = Guid.Parse("00000000-0000-0000-0000-000000000031");
    private static readonly Guid Ngc7000 = Guid.Parse("00000000-0000-0000-0000-000000007000");

    private readonly string dir = Directory.CreateTempSubdirectory("ninapm-autoflats-").FullName;
    private readonly FixedClock clock = new(new DateTimeOffset(2026, 10, 4, 11, 0, 0, TimeSpan.Zero));
    private readonly ListSink sink = new();
    private readonly LocalStore store;
    private readonly FakeFlatHost host;
    private readonly FlatExecutor flats;
    private readonly Dictionary<Guid, List<FlatsOnRecord>> records = [];

    public FlatAutoTests()
    {
        store = LocalStore.Open(Path.Combine(dir, "ninapm.db"), clock);
        host = new FakeFlatHost(clock);
        flats = new FlatExecutor(host, store, clock, new NinaPmLog(sink)) { Records = id => records.GetValueOrDefault(id) };
    }

    public void Dispose()
    {
        store.Dispose();
        try { Directory.Delete(dir, true); } catch (IOException) { }
    }

    private static FlatPlanOptions Options(AutoMode mode, int days = 7) =>
        new(5, false, false, [new RigFilter("L", "L", 1, "luminance"), new RigFilter("Ha", "HA", 2, "narrowband")], new FlatAutoSettings(mode, days));

    private void Light(string night, string filter, double mechDeg, Guid project) =>
        store.RecordFlatLight(night, new LightObservation(filter, filter.ToUpperInvariant(), 100, 10, 1, 0, null,
            FlatClustering.Dg(mechDeg), new FlatTarget(project, null, project == M31 ? "M 31" : "NGC 7000"), 0, 3));

    private void Record(Guid project, string filter, double mechDeg, DateTimeOffset last) =>
        (records.TryGetValue(project, out var l) ? l : records[project] = []).Add(new FlatsOnRecord
        {
            FilterShortName = filter, RotatorMechDg = FlatClustering.Dg(mechDeg), Gain = 100, Offset = 10, Binning = 1,
            ReadoutModeIndex = 0, LastUtc = last, Count = 20,
        });

    private FlatRunSettings Settings(FlatPlanOptions o, string night = Night) => new(night, null, 5, 0, null, o);

    [Fact]
    public async Task Einmal_je_Projekt_nimmt_nur_Kombinationen_ohne_Flats_auf()
    {
        Light(Night, "L", 0, M31);
        Light(Night, "Ha", 0, M31);
        Record(M31, "L", 0.5, clock.UtcNow.AddDays(-60)); // innerhalb der Winkeltoleranz, beliebig alt

        await flats.RunAsync(Settings(Options(AutoMode.Once_per_project)), CancellationToken.None);

        Assert.Equal(["HA"], host.Runs.Select(r => host.Filters[r.FilterIndex]).ToArray());
        Assert.Contains(sink.Lines, l => l.Contains("FLATS_END combination=L_b1_g100_o10_r0 mechDg=0 status=skipped reason=covered"));
    }

    [Fact]
    public async Task Kombination_zweier_Projekte_laeuft_wenn_eines_keine_Flats_hat()
    {
        Light(Night, "L", 0, M31);
        Light(Night, "L", 0, Ngc7000);
        Record(M31, "L", 0, clock.UtcNow.AddDays(-2));

        await flats.RunAsync(Settings(Options(AutoMode.Once_per_project)), CancellationToken.None);

        Assert.Single(host.Runs);
    }

    [Theory]
    [InlineData(6.99, false)]
    [InlineData(7.0, true)]
    [InlineData(8.0, true)]
    public async Task Zeitbasiert_ab_genau_N_Tagen_neu(double ageDays, bool taken)
    {
        Light(Night, "L", 0, M31);
        Record(M31, "L", 0, clock.UtcNow.AddDays(-ageDays));

        await flats.RunAsync(Settings(Options(AutoMode.Time_based, 7)), CancellationToken.None);

        Assert.Equal(taken ? 1 : 0, host.Runs.Count);
    }

    [Fact]
    public async Task Aus_nimmt_alle_Kombinationen_auf()
    {
        Light(Night, "L", 0, M31);
        Record(M31, "L", 0, clock.UtcNow.AddDays(-1));
        await flats.RunAsync(Settings(Options(AutoMode.Off)), CancellationToken.None);
        Assert.Single(host.Runs);
    }

    [Fact]
    public async Task Ausgefallene_Flats_werden_am_naechsten_Morgen_nachgeholt()
    {
        Light(Night, "Ha", 45, Ngc7000);
        var o = Options(AutoMode.Once_per_project);
        Assert.True(flats.Pending(Night, o, includeCarryOver: true));
        flats.SkipOpen(Night, "unsafe", carryOver: true);

        // Dieselbe Nacht: nichts nachholen.
        Assert.False(flats.Pending(Night, o, includeCarryOver: true));
        // Nächste Nacht ohne eigene Lights: die Kombination ist offen, mit eigenem Winkel und Zielliste.
        const string next = "2026-10-04";
        Assert.True(flats.Pending(next, o, includeCarryOver: true));
        var carried = Assert.Single(store.FlatCombinations(next));
        Assert.Equal((450, Night, "NGC 7000"), (carried.MechDg, carried.CarriedFrom, carried.Targets[0].Name));

        await flats.RunAsync(Settings(o, next), CancellationToken.None);
        Assert.Equal(FlatStatus.Done, Assert.Single(store.FlatCombinations(next)).Status);
        Assert.Null(store.GetState(StateKeys.FlatCarryOver));
    }

    [Fact]
    public void Nachholen_verfaellt_nach_drei_Naechten_und_ohne_Session()
    {
        Light(Night, "Ha", 45, Ngc7000);
        var o = Options(AutoMode.Once_per_project);
        flats.Pending(Night, o);
        flats.SkipOpen(Night, "session_end", carryOver: true);

        // Ohne Session (includeCarryOver: false) bleibt es liegen.
        Assert.False(flats.Pending("2026-10-05", o, includeCarryOver: false));
        Assert.NotNull(store.GetState(StateKeys.FlatCarryOver));
        // Vier Nächte später: verworfen.
        Assert.False(flats.Pending("2026-10-07", o, includeCarryOver: true));
        Assert.Contains(sink.Lines, l => l.Contains("reason=carry_over_expired"));
        Assert.Null(store.GetState(StateKeys.FlatCarryOver));
    }

    [Fact]
    public void Ohne_Auto_wird_nicht_nachgeholt()
    {
        Light(Night, "Ha", 45, Ngc7000);
        flats.Pending(Night, Options(AutoMode.Off));
        flats.SkipOpen(Night, "session_end", carryOver: false);
        Assert.Null(store.GetState(StateKeys.FlatCarryOver));
        flats.DropCarryOver("aus");
        Assert.DoesNotContain(sink.Lines, l => l.Contains("verworfen"));
    }
}
