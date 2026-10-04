using Moq;
using NINA.Profile.Interfaces;
using NinaPm.Core.Api;
using NinaPm.Core.Options;
using NinaPm.Nina.Ui;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// Optionsseite (P-04): Anzeige nach dem Verbindungstest; Testbetrieb nur mit lokaler URL **und** X-NPM-Test
/// (NIN-17); falsches Token → „ungültig“.
/// </summary>
public sealed class OptionsTests
{
    private static NinaPmPlugin NewPlugin()
    {
        var profile = new Mock<IProfileService> { DefaultValue = DefaultValue.Mock };
        return new NinaPmPlugin(profile.Object, new PlainProtector());
    }

    private static ConnectionResult Ok(bool test, double? km) =>
        new(true, 200, null, "Demo", "Rig A NINA", "Rig A", "Starfront", km, DateTimeOffset.UnixEpoch, test);

    [Fact]
    public void Zielbrowser_ohne_Laufzeit_leer_mit_Hinweis()
    {
        var plugin = NewPlugin();
        plugin.Targets.Rebuild();
        Assert.Empty(plugin.Targets.Rows);
        Assert.Equal(3, plugin.Targets.Types.Count);
    }

    [Fact]
    public void Erfolg_zeigt_Mandant_Rig_und_Standort()
    {
        var plugin = NewPlugin();
        plugin.ApplyResult(Ok(test: false, km: 0.4), new PluginOptions());
        Assert.Equal(Texts.Connected, plugin.ConnectionStatus);
        Assert.Equal("Demo", plugin.TenantName);
        Assert.Equal("Rig A · Starfront", plugin.RigName);
        Assert.Equal(Texts.SiteOk(0.4), plugin.SiteCheck);
    }

    /// <summary>Profil mit beschreibbarem Standort (München, weit weg von Starfront).</summary>
    private static (NinaPmPlugin Plugin, Mock<IAstrometrySettings> Astro) PluginWithProfileAt(double lat, double lon)
    {
        var astro = new Mock<IAstrometrySettings>();
        astro.SetupAllProperties();
        astro.Object.Latitude = lat;
        astro.Object.Longitude = lon;
        var profile = new Mock<IProfile> { DefaultValue = DefaultValue.Mock };
        profile.SetupGet(p => p.AstrometrySettings).Returns(astro.Object);
        var service = new Mock<IProfileService> { DefaultValue = DefaultValue.Mock };
        service.SetupGet(s => s.ActiveProfile).Returns(profile.Object);
        return (new NinaPmPlugin(service.Object, new PlainProtector()), astro);
    }

    [Fact]
    public void Rig_mit_Teleskop_und_Kamera_aus_dem_Bootstrap_Standort_weit_weg_zeigt_den_Knopf()
    {
        var b = SimulatorModelTests.Bootstrap;
        var (plugin, astro) = PluginWithProfileAt(48.137, 11.575);
        plugin.ApplyResult(Ok(test: false, km: null) with { Bootstrap = b }, new PluginOptions());
        Assert.Equal($"{b.Rig.Name} · {b.Rig.Site.Name}", plugin.RigName);
        Assert.Equal(b.Rig.Telescope.Name, plugin.TelescopeName);
        Assert.Equal(b.Rig.Camera.Name, plugin.CameraName);
        Assert.True(plugin.SiteMismatch);
        Assert.Equal(Texts.SiteFar(Geo.DistanceKm(48.137, 11.575, b.Rig.Site.LatDeg, b.Rig.Site.LonDeg)), plugin.SiteCheck);

        // Nein: Profil bleibt unverändert.
        plugin.Confirm = (_, _) => false;
        plugin.ApplySite();
        Assert.Equal(48.137, astro.Object.Latitude);

        // Ja: Rig-Standort im Profil, danach kein Knopf mehr.
        plugin.Confirm = (_, _) => true;
        plugin.ApplySite();
        Assert.Equal((b.Rig.Site.LatDeg, b.Rig.Site.LonDeg, b.Rig.Site.ElevationM),
            (astro.Object.Latitude, astro.Object.Longitude, astro.Object.Elevation));
        Assert.False(plugin.SiteMismatch);
        Assert.Equal(Texts.SiteOk(0), plugin.SiteCheck);
    }

    [Fact]
    public void Standort_weit_weg_warnt()
    {
        var plugin = NewPlugin();
        plugin.ApplyResult(Ok(test: false, km: 250), new PluginOptions());
        Assert.Equal(Texts.SiteFar(250), plugin.SiteCheck);
    }

    [Theory]
    [InlineData("http://localhost:8787/api", true, true)]
    [InlineData("https://nina-pm.svenesis.org/api", true, false)]
    [InlineData("http://localhost:8787/api", false, false)]
    public void Testserver_nur_lokal_und_mit_Kopfzeile(string url, bool header, bool testServer)
    {
        var plugin = NewPlugin();
        plugin.ApplyResult(Ok(test: header, km: null), new PluginOptions { ServerUrl = url });
        Assert.Equal(testServer ? Texts.ConnectedTestServer : Texts.Connected, plugin.ConnectionStatus);
    }

    [Theory]
    [InlineData(401, "nina.token_invalid")]
    [InlineData(403, "tenant.locked")]
    [InlineData(409, "engine.incompatible")]
    [InlineData(0, "network")]
    public void Fehler_werden_benannt(int status, string code)
    {
        var plugin = NewPlugin();
        plugin.ApplyResult(ConnectionResult.Failed(status, code), new PluginOptions());
        var expected = status switch
        {
            401 => Texts.TokenInvalid,
            403 => Texts.TenantLocked,
            409 => Texts.UpdateNeeded,
            _ => Texts.Unreachable,
        };
        Assert.Equal(expected, plugin.ConnectionStatus);
        Assert.Equal("", plugin.TenantName);
    }

    internal sealed class PlainProtector : ITokenProtector
    {
        public string Protect(string token) => "p:" + token;
        public string? Unprotect(string protectedToken) => protectedToken.StartsWith("p:") ? protectedToken[2..] : null;
    }
}
