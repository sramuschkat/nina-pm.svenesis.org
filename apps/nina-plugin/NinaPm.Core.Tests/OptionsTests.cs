using NinaPm.Core.Api;
using NinaPm.Core.Options;
using NinaPm.Core.Time;
using Xunit;

namespace NinaPm.Core.Tests;

/// <summary>Optionen und Zeittext: Server-URL, lokale Gegenstelle (NIN-17), UTC-Zeitpunkte (NT-05).</summary>
public sealed class OptionsTests
{
    [Theory]
    [InlineData("http://localhost:8787/api", true)]
    [InlineData("http://127.0.0.1:8787/api", true)]
    [InlineData("http://192.168.64.1:8787/api", true)]
    [InlineData("http://10.0.0.5/api", true)]
    [InlineData("http://172.20.1.1/api", true)]
    [InlineData("http://172.32.1.1/api", false)]
    [InlineData("https://nina-pm.svenesis.org/api", false)]
    [InlineData("ftp://localhost/api", false)]
    [InlineData("kein url", false)]
    public void Lokale_Gegenstelle(string url, bool local) =>
        Assert.Equal(local, new PluginOptions { ServerUrl = url }.IsLocalServer);

    /// <summary>Dreifachsperre (execution.md §9, NIN-17, AP-16h): nur alle drei Bedingungen schalten die Prüfungen ab.</summary>
    [Theory]
    [InlineData(true, "http://localhost:8787/api", true, true)]
    [InlineData(false, "http://localhost:8787/api", true, false)]
    [InlineData(true, "https://nina-pm.svenesis.org/api", true, false)]
    [InlineData(true, "http://192.168.64.1:8787/api", false, false)]
    [InlineData(false, "https://nina-pm.svenesis.org/api", true, false)]
    [InlineData(false, "http://localhost:8787/api", false, false)]
    [InlineData(true, "https://nina-pm.svenesis.org/api", false, false)]
    [InlineData(false, "https://nina-pm.svenesis.org/api", false, false)]
    public void Testbetrieb_nur_mit_Schalter_lokaler_URL_und_Test_Header(bool testMode, string url, bool testHeader, bool off) =>
        Assert.Equal(off, new PluginOptions { TestMode = testMode, ServerUrl = url }.SafetyChecksOff(testHeader));

    [Theory]
    [InlineData("https://nina-pm.svenesis.org/api", "https://nina-pm.svenesis.org")]
    [InlineData("https://nina-pm.svenesis.org/api/", "https://nina-pm.svenesis.org")]
    [InlineData("http://localhost:8787/api", "http://localhost:8787")]
    [InlineData("http://localhost:8787", "http://localhost:8787")]
    public void Origin_ohne_api(string url, string origin) =>
        Assert.Equal(origin, NinaApi.Origin(new PluginOptions { ServerUrl = url }.ApiBase!));

    [Fact]
    public void Standard_ist_prod() =>
        Assert.Equal("https://nina-pm.svenesis.org/api", new PluginOptions().ServerUrl);

    [Fact]
    public void UtcText_liest_nur_Zeitpunkte_mit_Z()
    {
        Assert.Equal(new DateTimeOffset(2026, 9, 18, 1, 0, 0, TimeSpan.Zero), UtcText.Parse("2026-09-18T01:00:00Z"));
        Assert.Throws<FormatException>(() => UtcText.Parse("2026-09-18T01:00:00+02:00"));
        Assert.True(UtcText.IsNightKey("2026-09-17"));
        Assert.False(UtcText.IsNightKey("2026-9-17"));
        Assert.False(UtcText.IsNightKey(null));
    }

    [Fact]
    public void FixedClock_ist_immer_UTC()
    {
        var clock = new FixedClock(new DateTimeOffset(2026, 9, 17, 20, 0, 0, TimeSpan.FromHours(-5)));
        Assert.Equal(TimeSpan.Zero, clock.UtcNow.Offset);
        Assert.Equal(1, clock.UtcNow.Hour);
    }
}
