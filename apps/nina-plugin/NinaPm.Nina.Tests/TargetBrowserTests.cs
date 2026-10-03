using Moq;
using NINA.Astrometry;
using NINA.Core.Enum;
using NINA.Profile.Interfaces;
using NINA.WPF.Base.Interfaces.Mediator;
using NINA.WPF.Base.Interfaces.ViewModel;
using NinaPm.Core.Status;
using NinaPm.Core.Targets;
using NinaPm.Nina.Adapters;
using NinaPm.Nina.Status;
using NinaPm.Nina.Ui;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// Zielbrowser und Live-Status gegen NINA-Attrappen (FA-NIN-02, FA-NIN-13, AP-16h): der Framing-Assistent erhält
/// Koordinaten, Positionswinkel, Sensor, Brennweite und Raster; Anzeigetexte je gesperrtem Grund und Banner.
/// </summary>
public sealed class TargetBrowserTests
{
    private static IProfileService Profile()
    {
        var astro = new Mock<IAstrometrySettings>();
        var profile = new Mock<IProfile>();
        profile.SetupGet(p => p.AstrometrySettings).Returns(astro.Object);
        var service = new Mock<IProfileService>();
        service.SetupGet(s => s.ActiveProfile).Returns(profile.Object);
        return service.Object;
    }

    [Fact]
    public async Task Framing_Assistent_erhaelt_Zentrum_Positionswinkel_Optik_und_2x2_Raster()
    {
        var framing = new Mock<IFramingAssistantVM>();
        DeepSkyObject? sent = null;
        framing.Setup(f => f.SetCoordinates(It.IsAny<DeepSkyObject>())).Callback<DeepSkyObject>(d => sent = d).ReturnsAsync(true);
        var application = new Mock<IApplicationMediator>();
        var loader = new FramingLoader(framing.Object, application.Object, Profile());

        var ok = await loader.LoadAsync(new FramingRequest("NGC 7000", 314.75, 44.33, 30, 2, 2, 15, 6248, 4176, 3.76, 382));

        Assert.True(ok);
        application.Verify(a => a.ChangeTab(ApplicationTab.FRAMINGASSISTANT));
        Assert.NotNull(sent);
        Assert.Equal("NGC 7000", sent!.Name);
        Assert.Equal(314.75 / 15, sent.Coordinates.RA, 6);   // Grad → Stunden (NT-28)
        Assert.Equal(44.33, sent.Coordinates.Dec, 6);
        Assert.Equal(Epoch.J2000, sent.Coordinates.Epoch);
        Assert.Equal(30, sent.RotationPositionAngle);           // NINA rechnet intern 360 − pa (NT-32)
        framing.VerifySet(f => f.CameraWidth = 6248);
        framing.VerifySet(f => f.CameraHeight = 4176);
        framing.VerifySet(f => f.CameraPixelSize = 3.76);
        framing.VerifySet(f => f.FocalLength = 382);
        framing.VerifySet(f => f.HorizontalPanels = 2);
        framing.VerifySet(f => f.VerticalPanels = 2);
        framing.VerifySet(f => f.OverlapPercentage = 15);
        // Panel 1 des NINA-Rasters ist Nordost = (i, j) = (1, 0) (geometry.md §2.1, NT-32).
        Assert.Equal((1, 0), PanelNumbering.Position(1, 2));
    }

    private static LiveStatus Status(string? reason, bool banner = false) => new(
        reason is null ? LiveState.Waiting : LiveState.Blocked, reason, false, null, null, null, null, null, null, [], 2, 1, false, banner);

    [Fact]
    public void Gesperrt_je_Grund_eigener_Text_und_Banner_nur_im_Testbetrieb()
    {
        string[] codes = ["lease_lost", "rig_busy", "token_invalid", "clock_skew", "plan_failed", "engine_incompatible", "tenant_locked"];
        var texts = codes.Select(c => new LiveStatusView(Status(c)).BlockedText).ToList();
        Assert.All(texts, t => Assert.False(string.IsNullOrWhiteSpace(t)));
        Assert.Equal(codes.Length, texts.Distinct().Count());
        Assert.DoesNotContain(texts, t => codes.Contains(t));
        Assert.Equal(Texts.LiveBlocked, new LiveStatusView(Status("rig_busy")).StateText);

        var waiting = new LiveStatusView(Status(null));
        Assert.False(waiting.IsBlocked);
        Assert.False(waiting.TestBanner);
        Assert.Equal(Texts.PlanAtStart, waiting.TargetText);
        Assert.Equal(Texts.Outbox(2, 1), waiting.CountersText);
        Assert.True(new LiveStatusView(Status(null, banner: true)).TestBanner);
    }
}
