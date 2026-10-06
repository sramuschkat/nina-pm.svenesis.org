using NinaPm.Core.Flats;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Clustern der mechanischen Winkel (flip-rotation.md §4) und Kombinationsbildung (execution.md §7, AP-50).</summary>
public sealed class FlatPlanningTests
{
    private static readonly Guid M31 = Guid.Parse("00000000-0000-0000-0000-000000000031");
    private static readonly Guid Ngc7000 = Guid.Parse("00000000-0000-0000-0000-000000007000");

    private static IEnumerable<(int, int)> Angles(params double[] deg) => deg.Select(d => (FlatClustering.Dg(d), 1));

    // ---- Pflicht-Tests flip-rotation.md §4 ----

    [Fact]
    public void Zwoelf_Winkel_um_90_Grad_ergeben_eine_Kombination_mit_90_Grad()
    {
        var c = FlatClustering.Cluster(Angles(88.0, 88.4, 88.8, 89.2, 89.6, 90.0, 90.0, 90.4, 90.8, 91.2, 91.6, 92.0), FlatClustering.ToleranceDg(5));
        Assert.Single(c);
        Assert.Equal(900, c[0].RepresentativeDg);
    }

    [Fact]
    public void Dieselben_Winkel_plus_180_Grad_ergeben_zwei_Kombinationen()
    {
        double[] near = [88.0, 88.4, 88.8, 89.2, 89.6, 90.0, 90.0, 90.4, 90.8, 91.2, 91.6, 92.0];
        var c = FlatClustering.Cluster(Angles([.. near, .. near.Select(d => d + 180)]), FlatClustering.ToleranceDg(5));
        Assert.Equal([900, 2700], c.Select(x => x.RepresentativeDg).ToArray());
    }

    [Fact]
    public void Wrap_ueber_null_Grad_nimmt_den_Median_der_entrollten_Kette()
    {
        var c = FlatClustering.Cluster(Angles(359.0, 0.5, 1.0), FlatClustering.ToleranceDg(5));
        Assert.Single(c);
        Assert.Equal(5, c[0].RepresentativeDg); // 0,5°, nicht 1,0° (AST-G06)
    }

    [Fact]
    public void Gegenprobe_Wrap_um_null_Grad()
    {
        var c = FlatClustering.Cluster(Angles(358, 359, 0, 1, 2), FlatClustering.ToleranceDg(5));
        Assert.Single(c);
        Assert.Equal(0, c[0].RepresentativeDg);
    }

    [Fact]
    public void Toleranz_ist_mindestens_ein_Grad()
    {
        Assert.Equal(10, FlatClustering.ToleranceDg(0.5));
        Assert.Equal(25, FlatClustering.ToleranceDg(5));
    }

    // ---- Kombinationen ----

    private static LightObservation Light(string filter, double mechDeg, Guid project, long seq, int bin = 1, int gain = 100, int offset = 10, int count = 1,
        string? readout = null, int readoutIndex = 0) =>
        new(filter, filter.ToUpperInvariant(), gain, offset, bin, readoutIndex, readout, FlatClustering.Dg(mechDeg),
            new FlatTarget(project, null, project == M31 ? "M 31" : "NGC 7000"), seq, count);

    private static readonly FlatPlanOptions Panel = new(5, false, false,
        [new RigFilter("L", "L", 1, "luminance"), new RigFilter("R", "R", 2, "broadband"), new RigFilter("Ha", "HA", 5, "narrowband")]);

    [Fact]
    public void Zwei_Ziele_mit_zwei_Winkeln_ergeben_je_Filter_zwei_Kombinationen_der_Flip_keine_weitere()
    {
        // M 31 bei 0°, mit Flip: der mechanische Winkel bleibt (NT-E4) – nach dem Flip dieselben Winkel.
        var lights = new[]
        {
            Light("L", 0.1, M31, 1, count: 5), Light("Ha", 0.0, M31, 2, count: 5),
            Light("L", 359.9, M31, 3, count: 5), Light("Ha", 0.2, M31, 4, count: 5),
            Light("L", 45.0, Ngc7000, 5, count: 5), Light("Ha", 45.1, Ngc7000, 6, count: 5),
        };
        var combos = FlatPlanner.Update(lights, [], Panel);
        Assert.Equal(4, combos.Count);
        // Median 0,05° bzw. 45,05° → q(·, 10) = 0,1° bzw. 45,1° (kaufmännisch gerundet).
        Assert.Equal([1, 1, 451, 451], combos.Select(c => c.MechDg).ToArray());
        Assert.Equal(["L", "Ha", "L", "Ha"], combos.Select(c => c.FilterShort).ToArray());
        Assert.All(combos, c => Assert.Equal(FlatStatus.Pending, c.Status));
    }

    [Fact]
    public void Bin_1_und_Bin_2_sind_getrennte_Kombinationen_Gain_null_steht_als_minus_1()
    {
        var lights = new[] { Light("L", 0, M31, 1, bin: 1), Light("L", 0, M31, 2, bin: 2, gain: -1, offset: -1) };
        var combos = FlatPlanner.Update(lights, [], Panel);
        Assert.Equal(2, combos.Count);
        Assert.Equal("L|100|10|1|0|0", combos[0].Key);
        Assert.Equal("L|-1|-1|2|0|0", combos[1].Key);
    }

    [Fact]
    public void Gleiche_Kombination_zweier_Ziele_wird_einmal_aufgenommen_mit_Zielliste()
    {
        var lights = new[] { Light("L", 10, M31, 1), Light("L", 10.4, Ngc7000, 2) };
        var combos = FlatPlanner.Update(lights, [], Panel);
        var c = Assert.Single(combos);
        Assert.Equal(["M 31", "NGC 7000"], c.Targets.Select(t => t.Name).ToArray());
    }

    [Fact]
    public void Eingefrorener_Winkel_bleibt_auch_wenn_weitere_Lights_den_Median_verschieben()
    {
        var first = FlatPlanner.Update([Light("L", 10.0, M31, 1)], [], Panel);
        Assert.Equal(100, first[0].MechDg);
        var second = FlatPlanner.Update([Light("L", 10.0, M31, 1), Light("L", 11.5, M31, 2, count: 9)], first, Panel);
        var c = Assert.Single(second);
        Assert.Equal(100, c.MechDg);
        Assert.Equal(115, c.MedianDg);
    }

    [Fact]
    public void Neue_Kombination_nach_erledigten_Flats_ist_wieder_offen()
    {
        var first = FlatPlanner.Update([Light("L", 0, M31, 1)], [], Panel);
        first[0].Status = FlatStatus.Done;
        var second = FlatPlanner.Update([Light("L", 0, M31, 1), Light("R", 0, M31, 2)], first, Panel);
        Assert.Equal([FlatStatus.Done, FlatStatus.Pending], second.Select(c => c.Status).ToArray());
    }

    [Fact]
    public void Vollstaendiger_Flat_Satz_ergaenzt_je_Winkel_alle_Filter_mit_NINA_Namen()
    {
        var lights = new[] { Light("L", 0, M31, 1), Light("L", 45, Ngc7000, 2) };
        var combos = FlatPlanner.Update(lights, [], Panel with { FullSet = true });
        Assert.Equal(6, combos.Count);
        Assert.Equal(3, combos.Count(c => c.MechDg == 0));
        Assert.Equal(["R", "Ha"], combos.Where(c => c.FullSet && c.MechDg == 0).Select(c => c.FilterShort).ToArray());
        Assert.All(combos.Where(c => c.MechDg == 450), c => Assert.Equal("NGC 7000", Assert.Single(c.Targets).Name));
    }

    [Fact]
    public void Panelflats_je_Winkel_zusammen_Himmelsflats_Schmalband_vor_Breitband_vor_L()
    {
        var lights = new[] { Light("L", 0, M31, 1), Light("Ha", 45, Ngc7000, 2), Light("R", 0, M31, 3), Light("Ha", 0, M31, 4) };
        var combos = FlatPlanner.Update(lights, [], Panel);
        var panel = FlatPlanner.ExecutionOrder(combos, Panel);
        Assert.Equal(["L@0", "R@0", "Ha@0", "Ha@450"], panel.Select(c => $"{c.FilterShort}@{c.MechDg}").ToArray());
        var sky = FlatPlanner.ExecutionOrder(combos, Panel with { Sky = true });
        Assert.Equal(["Ha@0", "Ha@450", "R@0", "L@0"], sky.Select(c => $"{c.FilterShort}@{c.MechDg}").ToArray());
    }

    [Theory]
    [InlineData("OIII", 0)]
    [InlineData("L", 2)]
    [InlineData("G", 1)]
    public void Bandrang_ohne_Filtertyp_nach_Kurzname(string shortName, int rank) =>
        Assert.Equal(rank, FlatPlanner.BandRank(shortName, []));

    // ---- Kopie (NIN-16b) ----

    [Theory]
    [InlineData(@"D:\Astro\2026-10-03\M 31\FLAT\L_0001.fits", "M 31", "NGC 7000", @"D:\Astro\2026-10-03\NGC 7000\FLAT\L_0001.fits")]
    [InlineData("/data/M 31/FLAT/x.fits", "M 31", "M 31 – P2", "/data/M 31 – P2/FLAT/x.fits")]
    [InlineData(@"D:\Astro\M 310\FLAT\x.fits", "M 31", "NGC 7000", null)] // kein Teilstring-Ersatz
    [InlineData(@"D:\Astro\FLAT\M 31_x.fits", "M 31", "NGC 7000", null)] // Ziel nicht als ganzes Segment
    [InlineData(@"D:\Astro\Sh2_132\FLAT\x.fits", "Sh2:132", "M 31", @"D:\Astro\M 31\FLAT\x.fits")] // sanitisiert wie NINA
    // NINA-Standardmuster wie in Starfront ($$DATEMINUS12$$\$$IMAGETYPE$$\…): kein Zielordner, keine Kopie (05.10.2026)
    [InlineData(@"C:\Users\admin\Documents\N.I.N.A\2026-10-05\FLAT\2026-10-05_03-09-31_RED_-10.00_1.00s_0000.fits", "Bench LRGB", "Bench RGB", null)]
    public void Kopie_ersetzt_nur_ein_ganzes_Pfadsegment(string source, string primary, string other, string? expected) =>
        Assert.Equal(expected, FlatFiles.PathFor(source, primary, other));
}
