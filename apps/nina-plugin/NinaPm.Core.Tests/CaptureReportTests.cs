using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Reporting;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Aufnahme-Zuordnung und -Meldung (AP-16e, execution.md §4.3, NT-10, NT-34, NT-36).</summary>
public sealed class CaptureReportTests
{
    private static readonly DateTimeOffset T0 = UtcText.Parse("2026-09-18T07:42:40Z");

    private static Blocks Block() =>
        JsonConvert.DeserializeObject<NinaPlanResponse>(ContractExamples.Json("plan.response"), NinaJson.Settings())!
            .Blocks.Single(b => b.Kind == BlocksKind.Regular);

    private static CaptureFacts Facts(Guid? id = null, bool deviation = false, CapturesPierSide? pier = CapturesPierSide.West)
    {
        var block = Block();
        var entry = block.Entries.First(e => e.Cmd == EntriesCmd.Expose);
        return new CaptureFacts(id ?? Guid.NewGuid(), "2026-09-17", Guid.NewGuid(), block, entry, T0, T0.AddSeconds(150),
            "Ha 3nm", 300, null, null, 1, "High Gain Mode", 0, 12.5, pier, deviation, null);
    }

    [Fact]
    public void Meldung_Zeitpunkte_aus_ExposureStart_und_ExposureMidPoint_Soll_Koordinaten_des_Panels()
    {
        var f = Facts(deviation: true);
        var c = CaptureMapper.Build(f, CapturesResult.Saved, "M31_Ha_0001.fits");

        Assert.Equal(T0, c.CapturedAtUtc);
        Assert.Equal(T0.AddSeconds(150), c.ExposureMidUtc);
        Assert.Equal(("2026-09-17", f.NightPlanId, f.Block.Id), (c.Night, c.NightPlanId, c.BlockId));
        Assert.Equal((f.Block.RaDeg, f.Block.DecDeg, f.Block.RotationDeg), (c.RaDeg, c.DecDeg, c.RotationDeg));
        Assert.Equal(("Ha", "Ha 3nm", f.Entry.ExposureLineId), (c.FilterShortName, c.FilterActual, c.ExposureLineId));
        Assert.Equal((CapturesFrameType.Light, CapturesPierSide.West, 12.5, true), (c.FrameType, c.PierSide, c.RotatorMechDeg, c.TemperatureDeviation));
        Assert.Equal("M31_Ha_0001.fits", c.FileName);
        // Dateiname nur bei saved.
        Assert.Null(CaptureMapper.Build(f, CapturesResult.Failed, "x.fits").FileName);
        // gemessener Positionswinkel vor dem Soll
        Assert.Equal(91.2, CaptureMapper.Build(f with { RotationDeg = 91.2 }, CapturesResult.Saved, "a").RotationDeg);
    }

    [Theory]
    [InlineData("pierWest", CapturesPierSide.West)]
    [InlineData("pierEast", CapturesPierSide.East)]
    [InlineData("pierUnknown", null)]
    [InlineData(null, null)]
    public void Pier_Seite_feste_ASCOM_Zuordnung(string? ascom, CapturesPierSide? expected) =>
        Assert.Equal(expected, CaptureMapper.PierSide(ascom));

    [Fact]
    public void Schnelle_Folge_jede_Aufnahme_genau_einmal_auch_in_anderer_Reihenfolge()
    {
        var registry = new CaptureRegistry();
        var ids = Enumerable.Range(1, 20).ToDictionary(i => i, _ => Guid.NewGuid());
        foreach (var (imageId, captureId) in ids) registry.Register(imageId, Facts(captureId), T0);

        foreach (var imageId in ids.Keys.Reverse())
            Assert.Equal(ids[imageId], registry.Saved(imageId)?.CaptureId);
        Assert.Equal(0, registry.Pending);
        Assert.Null(registry.Saved(5)); // zweites ImageSaved derselben ID
        Assert.Null(registry.Saved(999)); // fremdes Bild (z. B. Flat aus NINA selbst)
    }

    [Fact]
    public void Ohne_ImageSaved_nach_120_s_failed_spaeteres_ImageSaved_zaehlt_nicht()
    {
        var registry = new CaptureRegistry();
        var f = Facts();
        registry.Register(7, f, T0);
        Assert.Empty(registry.Expire(T0.AddSeconds(119)));
        var expired = Assert.Single(registry.Expire(T0.AddSeconds(120)));
        Assert.Equal(f.CaptureId, expired.CaptureId);
        Assert.Null(registry.Saved(7));
    }
}
