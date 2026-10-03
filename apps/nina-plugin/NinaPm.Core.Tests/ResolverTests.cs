using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>
/// Filter- und Auslesemodus-Auflösung (AP-16d, execution.md §4.3/§4.4, NT-E1, NT-37) und die Drossel für Hinweise.
/// Tabellentests aus §4.4.
/// </summary>
public sealed class ResolverTests
{
    private static readonly string[] Wheel = ["L", "R", "G", "B", "Ha 3nm", "OIII 3nm"];

    private static T Example<T>(string name) => JsonConvert.DeserializeObject<T>(ContractExamples.Json(name), NinaJson.Settings())!;

    [Theory]
    [InlineData("Ha 3nm", FilterResolutionKind.Found, 4)]
    [InlineData("Ha", FilterResolutionKind.NotFound, -1)] // kein Präfix-Treffer gegen „Ha 3nm“
    [InlineData("ha 3nm", FilterResolutionKind.NotFound, -1)] // Groß-/Kleinschreibung zählt
    [InlineData(null, FilterResolutionKind.NotFound, -1)] // nicht zugeordnet/bestätigt
    public void Filter_nur_exakt_ueber_den_bestaetigten_Namen(string? name, FilterResolutionKind kind, int index)
    {
        var r = FilterResolver.Resolve(name, Wheel);
        Assert.Equal((kind, index), (r.Kind, r.Index));
    }

    [Fact]
    public void Ohne_Filterrad_belichten_ohne_Wechsel()
    {
        Assert.Equal(FilterResolutionKind.NoWheel, FilterResolver.Resolve("Ha 3nm", []).Kind);
        Assert.Equal(FilterResolutionKind.NoWheel, FilterResolver.Resolve(null, null).Kind);
    }

    [Fact]
    public void Name_aus_der_Zeile_in_targets_sonst_aus_dem_Bootstrap()
    {
        var targets = Example<NinaTargets>("targets.response");
        var bootstrap = Example<NinaBootstrap>("bootstrap.response");
        var line = targets.Projects.SelectMany(p => p.Panels).SelectMany(p => p.Lines).First(l => l.Filter == "Ha");

        Assert.Equal("Ha 3nm", FilterResolver.NinaNameFor(new Entries { ExposureLineId = line.Id, Filter = "Ha" }, targets, bootstrap));
        // Zeile nicht bestätigt → null, kein Rückfall auf den Bootstrap.
        line.NinaFilterName = null;
        Assert.Null(FilterResolver.NinaNameFor(new Entries { ExposureLineId = line.Id, Filter = "Ha" }, targets, bootstrap));
        // Ohne targets (bzw. ohne Zeile): Rig-Filter des Bootstraps.
        Assert.Equal("Ha 3nm", FilterResolver.NinaNameFor(new Entries { ExposureLineId = line.Id, Filter = "Ha" }, null, bootstrap));
        Assert.Equal("Red", FilterResolver.NinaNameFor(new Entries { Filter = "R" }, targets, bootstrap));
        Assert.Null(FilterResolver.NinaNameFor(new Entries { Filter = "SII" }, targets, bootstrap));
    }

    [Fact]
    public void Beim_Planaufbau_fehlende_Namen_im_Profil_melden_nur_aktive_Projekte()
    {
        var targets = Example<NinaTargets>("targets.response");
        Assert.Equal(["Ha 3nm", "Red"], FilterResolver.MissingInProfile(targets, ["L"]));
        Assert.Empty(FilterResolver.MissingInProfile(targets, ["Ha 3nm", "Red"]));
        Assert.Empty(FilterResolver.MissingInProfile(targets, [])); // ohne Filterrad nichts
        foreach (var p in targets.Projects) p.Status = ProjectsStatus.On_hold;
        Assert.Empty(FilterResolver.MissingInProfile(targets, ["L"]));
    }

    [Theory]
    [InlineData("High Gain Mode", new[] { "Low Noise", "high gain mode" }, ReadoutResolutionKind.Found, 1)] // ohne Groß-/Kleinschreibung
    [InlineData("Extended", new[] { "Low Noise", "High Gain Mode" }, ReadoutResolutionKind.NotFound, -1)] // nie über den Index
    [InlineData("Extended", new[] { "Default" }, ReadoutResolutionKind.Found, 0)] // genau ein Modus → dieser
    [InlineData(null, new[] { "Low Noise", "High Gain Mode" }, ReadoutResolutionKind.Unchanged, -1)]
    [InlineData("High Gain Mode", new string[0], ReadoutResolutionKind.NotFound, -1)]
    public void Auslesemodus_nach_Name(string? name, string[] modes, ReadoutResolutionKind kind, int index)
    {
        var r = ReadoutResolver.Resolve(name, modes);
        Assert.Equal((kind, index), (r.Kind, r.Index));
    }

    [Fact]
    public void Hinweise_hoechstens_einmal_je_12_Stunden_und_Schluessel()
    {
        var t = new DateTimeOffset(2026, 9, 18, 1, 0, 0, TimeSpan.Zero);
        var throttle = new HintThrottle(HintThrottle.TwelveHours);
        Assert.True(throttle.ShouldEmit("filter_not_found:Ha 3nm", t));
        Assert.False(throttle.ShouldEmit("filter_not_found:Ha 3nm", t.AddHours(11.9)));
        Assert.True(throttle.ShouldEmit("filter_not_found:OIII 3nm", t.AddHours(1)));
        Assert.True(throttle.ShouldEmit("filter_not_found:Ha 3nm", t.AddHours(12)));
    }
    private static Blocks Block(params (string? Filter, string? Readout)[] lines) => new()
    {
        Entries = [.. lines.Select(l => new Entries { Cmd = EntriesCmd.Expose, Filter = l.Filter, ReadoutMode = l.Readout, ExposureS = 60 })],
    };

    [Fact]
    public void Block_ohne_belichtbare_Zeile_vor_dem_Slew_ueberspringen()
    {
        // P-05 prod 03.10.2026: Zeilen mit „M1“, die Simulator-Kamera kennt nur normal1/normal2 → Block saß leer bis zum Ende.
        var rules = new HostRules(new FixedClock(DateTimeOffset.Parse("2026-10-03T20:00:00Z")), () => null, () => null);
        string[] modes = ["normal1", "normal2"];
        Assert.Equal("readout_mode_not_found", rules.UnexposableReason(Block(("R", "M1"), ("G", "M1")), [], modes));
        Assert.Null(rules.UnexposableReason(Block(("R", "M1"), ("G", "normal1")), [], modes)); // eine Zeile reicht
        Assert.Null(rules.UnexposableReason(Block(("R", null)), [], modes)); // ohne Modus: Kamera-Einstellung bleibt
        Assert.Null(rules.UnexposableReason(Block(("R", "M1")), [], ["Only Mode"])); // genau ein Modus → belichten (NT-37)
        Assert.Null(rules.UnexposableReason(new Blocks(), [], modes)); // ohne Belichtung entscheidet no_exposures
        // Mit Filterrad und ohne bestätigten Namen (kein Plan im Test) zuerst der Filter.
        Assert.Equal("filter_not_found", rules.UnexposableReason(Block(("R", "M1")), ["RED"], modes));
    }
}
