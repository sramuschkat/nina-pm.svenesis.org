using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>SiteCheck (AP-16f, NT-06, NT-22): PC-Zone gegen Standortzone, Montierung gegen Rig-Standort.</summary>
public sealed class SiteCheckTests
{
    private static NinaBootstrap Bootstrap() =>
        JsonConvert.DeserializeObject<NinaBootstrap>(ContractExamples.Json("bootstrap.response"), NinaJson.Settings())!;

    [Fact]
    public void PC_Zone_Berlin_bei_Standort_Chicago_meldet_pc_timezone_differs()
    {
        var b = Bootstrap();
        var now = UtcText.Parse("2026-09-18T03:00:00Z");
        var site = SiteCheck.SiteOffset(b, now)!.Value;
        Assert.Equal(TimeSpan.FromHours(-5), site); // CDT
        var berlin = TimeSpan.FromHours(2);         // MESZ
        Assert.True(SiteCheck.TimezoneDiffers(berlin, site));
        Assert.False(SiteCheck.TimezoneDiffers(TimeSpan.FromHours(-5), site));
        var text = SiteCheck.TimezoneMessage(berlin, site, b.Rig.Site.TimeZone);
        Assert.Contains("$$DATEMINUS12$$", text);
        Assert.Contains("America/Chicago", text);
        Assert.Contains("UTC+02:00", text);
        Assert.Contains("UTC-05:00", text);
    }

    [Fact]
    public void Standort_Offset_wechselt_mit_der_Zeitumstellung()
    {
        var b = Bootstrap();
        Assert.Equal(TimeSpan.FromHours(-6), SiteCheck.SiteOffset(b, UtcText.Parse("2026-11-02T03:00:00Z")));
    }

    [Theory]
    [InlineData(31.5471, -99.3823, 0.0, false)]
    [InlineData(31.5471, -99.3823, 75.0, true)]   // LST > 60 s daneben
    [InlineData(48.1, 11.6, 0.0, true)]            // Montierung in München
    [InlineData(31.55, -99.38, -30.0, false)]
    public void Montierung_gegen_Rig_Standort(double lat, double lon, double lstDeltaS, bool mismatch) =>
        Assert.Equal(mismatch, SiteCheck.MountSiteMismatch(lat, lon, lstDeltaS, 31.5471, -99.3823));
}
