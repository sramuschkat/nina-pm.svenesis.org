using System.Windows;
using System.Net.Http;
using Moq;
using NINA.Core.Utility;
using NINA.Equipment.Model;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Sequencer.Conditions;
using NINA.Core.Model;
using NINA.Sequencer.Container;
using NINA.Sequencer.SequenceItem;
using NINA.Sequencer.Trigger;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Nina.Adapters;
using NinaPm.Nina.Sequencer;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// NINA-Adapter von AP-16c gegen NINA-Typen und Attrappen (execution.md §1, §4.1, §4.6): Koordinaten in Grad (NT-28),
/// Unterbrechung über <c>SafetyMonitorCondition</c> eines Vorfahren, Ansichten der Sequenz-Bausteine je Typ.
/// </summary>
[Collection(WpfCollection.Name)]
public sealed class SequencerTests
{
    [Fact]
    public void Koordinaten_in_Grad_nicht_in_Stunden()
    {
        // NT-28: raDeg = 198,069 → RA 13,2046 h (das Original rechnete mit Angle.ByHours).
        var c = NinaHost.Coordinates(new Blocks { RaDeg = 198.069, DecDeg = 56.6297 });
        Assert.Equal(13.2046, c.RA, 4);
        Assert.Equal(56.6297, c.Dec, 4);
        Assert.Equal(NINA.Astrometry.Epoch.J2000, c.Epoch);
    }

    private static (SequentialContainer Outer, SequentialContainer Inner) Nested(bool withSafety)
    {
        var outer = new SequentialContainer();
        var inner = new SequentialContainer();
        outer.Add(inner);
        if (withSafety) outer.Add(new SafetyMonitorCondition(new Mock<ISafetyMonitorMediator>().Object));
        return (outer, inner);
    }

    [Theory]
    [InlineData(true, false, true, CancelKind.Interrupt)]
    [InlineData(true, true, true, CancelKind.UserAbort)]
    [InlineData(false, false, true, CancelKind.UserAbort)]
    [InlineData(true, false, false, CancelKind.Interrupt)]
    public void Unterbrechung_nur_mit_Safety_Bedingung_am_Vorfahren_und_unsicherem_Monitor(
        bool withSafety, bool safe, bool connected, CancelKind expected)
    {
        var (_, inner) = Nested(withSafety);
        var child = new SequentialContainer();
        inner.Add(child);
        var state = new SafetyState(NinaHost.AncestorHasSafetyCondition(child), connected, safe);
        Assert.Equal(expected, Interruption.Classify(ownCancel: false, state));
    }

    [Fact]
    public void Ansichten_je_Typ_und_Mini_Ansichten_je_Schluessel() => Sta.Run(() =>
    {
        var resources = new NinaPmResources();
        foreach (var type in NinaPmResources.TemplateTypes.Values)
            Assert.IsType<DataTemplate>(resources[new DataTemplateKey(type)]);
        foreach (var type in new[] { typeof(NinaPmContainer), typeof(NightLoopCondition), typeof(SafetyWaitInstruction),
                     typeof(BeforeExposureTrigger), typeof(AfterExposureTrigger), typeof(BeforeTargetChangeTrigger),
                     typeof(AfterTargetChangeTrigger), typeof(RefreshTargetsInstruction), typeof(DayLoopCondition),
                     typeof(WaitForTimeInstruction) })
            Assert.IsType<DataTemplate>(resources[$"{type.FullName}_Mini"]);
        Assert.IsType<DataTemplate>(resources["NINA-PM_Options"]);
    });

    // ---- AP-16d: Trigger-Walk und Trigger-Sets (execution.md §4.3, NT-23, FA-NIN-16) ---------------------------

    /// <summary>Zählt Ausführungen; der Typname entscheidet über die Dither-Unterdrückung.</summary>
    private class CountingTrigger : SequenceTrigger
    {
        public int Runs { get; private set; }

        public override Task Execute(ISequenceContainer context, IProgress<ApplicationStatus> progress, CancellationToken token)
        {
            Runs++;
            return Task.CompletedTask;
        }

        public override bool ShouldTrigger(ISequenceItem previousItem, ISequenceItem nextItem) => true;

        public override bool ShouldTriggerAfter(ISequenceItem previousItem, ISequenceItem nextItem) => false;

        public override object Clone() => this;
    }

    private sealed class FakeDitherAfterExposures : CountingTrigger;

    private sealed class FakeAutofocusAfterTimeTrigger : CountingTrigger;

    /// <summary>Profil nur mit Standort (Breite/Länge 0, kein Horizont) – mehr liest der Container im Konstruktor nicht.</summary>
    private static NINA.Profile.Interfaces.IProfileService Profile()
    {
        var astro = new Mock<NINA.Profile.Interfaces.IAstrometrySettings>();
        var profile = new Mock<NINA.Profile.Interfaces.IProfile>();
        profile.SetupGet(p => p.AstrometrySettings).Returns(astro.Object);
        var service = new Mock<NINA.Profile.Interfaces.IProfileService>();
        service.SetupGet(s => s.ActiveProfile).Returns(profile.Object);
        return service.Object;
    }

    internal static NinaPmContainer NewContainer() => new(
        Profile(),
        Mock.Of<ITelescopeMediator>(), Mock.Of<IImagingMediator>(), Mock.Of<ICameraMediator>(), Mock.Of<IFilterWheelMediator>(),
        Mock.Of<IRotatorMediator>(), Mock.Of<IGuiderMediator>(), Mock.Of<IDomeMediator>(), Mock.Of<NINA.Equipment.Interfaces.IDomeFollower>(),
        Mock.Of<NINA.PlateSolving.Interfaces.IPlateSolverFactory>(), Mock.Of<NINA.Core.Utility.WindowService.IWindowServiceFactory>(),
        Mock.Of<NINA.WPF.Base.Interfaces.Mediator.IImageSaveMediator>(), Mock.Of<NINA.WPF.Base.Interfaces.ViewModel.IImageHistoryVM>(),
        Mock.Of<ISafetyMonitorMediator>(), Mock.Of<NINA.Astrometry.Interfaces.INighttimeCalculator>(), Mock.Of<IFocuserMediator>());

    [Fact]
    public async Task Dither_Trigger_der_Vorfahren_laufen_nie_andere_schon()
    {
        var outer = new SequentialContainer();
        var middle = new SequentialContainer();
        var box = NewContainer();
        outer.Add(middle);
        middle.Add(box);
        var dither = new FakeDitherAfterExposures();
        var af = new FakeAutofocusAfterTimeTrigger();
        outer.Add(dither); // zwei Ebenen über dem Container – der Walk geht alle Vorfahren durch
        middle.Add(af);

        await TriggerWalker.RunAsync(box, after: false, null, box, new Progress<ApplicationStatus>(), runtime: null, transit: null, default);
        await TriggerWalker.RunAsync(box, after: false, null, box, new Progress<ApplicationStatus>(), runtime: null, transit: null, default);

        Assert.Equal(0, dither.Runs);
        Assert.Equal(2, af.Runs);
        Assert.Contains(nameof(FakeDitherAfterExposures), box.SuppressedLogged);

        // Im Transit ohne Erlaubnis der Beobachtung (§5, AP-44): Autofokus unterdrückt, Dither weiterhin.
        await TriggerWalker.RunAsync(box, after: false, null, box, new Progress<ApplicationStatus>(), runtime: null,
            transit: new NinaPm.Core.Execution.TransitTriggerContext(false, false), default);
        Assert.Equal(2, af.Runs);
        Assert.Contains(nameof(FakeAutofocusAfterTimeTrigger), box.SuppressedLogged);
        await TriggerWalker.RunAsync(box, after: false, null, box, new Progress<ApplicationStatus>(), runtime: null,
            transit: new NinaPm.Core.Execution.TransitTriggerContext(true, false), default);
        Assert.Equal(3, af.Runs);
        Assert.Equal(0, dither.Runs);
    }

    [Fact]
    public void Trigger_Sets_feuern_nur_rund_um_die_Plugin_Belichtung()
    {
        var exposure = (TakeExposureItem)System.Runtime.CompilerServices.RuntimeHelpers.GetUninitializedObject(typeof(TakeExposureItem));
        var other = new PlaceholderItem();
        var before = new BeforeExposureTrigger();
        var after = new AfterExposureTrigger();

        Assert.True(before.ShouldTrigger(other, exposure));
        Assert.False(before.ShouldTrigger(exposure, other));
        Assert.False(before.ShouldTriggerAfter(exposure, other));
        Assert.True(after.ShouldTriggerAfter(exposure, other));
        Assert.False(after.ShouldTriggerAfter(other, exposure));
        Assert.False(after.ShouldTrigger(other, exposure));
    }

    // ---- AP-16h: Trigger-Sets Zielwechsel, Sequenzbaum (FA-NIN-16, execution.md §1) -------------------------

    private sealed class CountingItem : SequenceItem
    {
        public int Runs { get; private set; }

        public override Task Execute(IProgress<ApplicationStatus> progress, CancellationToken token)
        {
            Runs++;
            return Task.CompletedTask;
        }

        public override object Clone() => this;
    }

    [Fact]
    public async Task Trigger_Sets_Zielwechsel_feuern_nie_ueber_NINA_aber_je_Block_erneut()
    {
        var before = new BeforeTargetChangeTrigger();
        var after = new AfterTargetChangeTrigger();
        var other = new PlaceholderItem();
        Assert.False(before.ShouldTrigger(other, other));
        Assert.False(before.ShouldTriggerAfter(other, other));
        Assert.False(after.ShouldTrigger(other, other));
        Assert.False(after.ShouldTriggerAfter(other, other));

        // Zwei Blöcke: Fortschritt wird je Lauf zurückgesetzt (sonst liefe ab dem zweiten Block nichts).
        var item = new CountingItem();
        before.TriggerRunner.Add(item);
        await before.FireAsync(new Progress<ApplicationStatus>(), default);
        await before.FireAsync(new Progress<ApplicationStatus>(), default);
        Assert.Equal(2, item.Runs);
        await after.FireAsync(new Progress<ApplicationStatus>(), default); // leer: nichts zu tun
    }

    [Fact]
    public void Sequenzbaum_von_der_Wurzel_mit_Bedingungen_Triggern_und_deaktivierten_Anweisungen()
    {
        var (outer, inner) = Nested(withSafety: true);
        outer.Name = "Ziel";
        outer.Add(new FakeAutofocusAfterTimeTrigger());
        var disabled = new PlaceholderItem { Status = NINA.Core.Enum.SequenceEntityStatus.DISABLED };
        inner.Add(disabled);
        var leaf = new SequentialContainer { Name = "Blöcke" };
        inner.Add(leaf);

        var root = SequenceTree.FromAncestors(leaf)!;
        Assert.Equal(("SequentialContainer", "Ziel"), (root.Type, root.Name));
        Assert.True(root.HasCondition("SafetyMonitorCondition"));
        Assert.Equal("FakeAutofocusAfterTimeTrigger", Assert.Single(root.TriggerList).Type);
        var innerNode = Assert.Single(root.ItemList);
        Assert.True(innerNode.ItemList[0].Disabled);
        Assert.Equal("Blöcke", innerNode.ItemList[1].Name);
        Assert.Null(SequenceTree.FromAncestors(null));
    }

    // ---- AP-16e: Heartbeat-Einstellungen (execution.md §4.4/§6) ----------------------------------------------

    [Fact]
    public void Heartbeat_Filterrad_NINA_Platz_0_wird_Platz_1_Geraete_getrennt_ohne_Montierung_und_Kamera()
    {
        var wheel = new Mock<NINA.Profile.Interfaces.IFilterWheelSettings>();
        // Listen-Konstruktor: Add/InsertItem bräuchte NINAs UI-Synchronisationskontext (im Test nicht vorhanden).
        wheel.SetupGet(w => w.FilterWheelFilters).Returns(new NINA.Core.Utility.ObserveAllCollection<NINA.Core.Model.Equipment.FilterInfo>(
        [
            new("L", 0, 0),
            new("Ha 3nm", 15, 1),
        ]));
        var flip = new Mock<NINA.Profile.Interfaces.IMeridianFlipSettings>();
        flip.SetupGet(f => f.Recenter).Returns(true);
        var profile = new Mock<NINA.Profile.Interfaces.IProfile>();
        profile.SetupGet(p => p.FilterWheelSettings).Returns(wheel.Object);
        profile.SetupGet(p => p.MeridianFlipSettings).Returns(flip.Object);
        profile.SetupGet(p => p.RotatorSettings).Returns(Mock.Of<NINA.Profile.Interfaces.IRotatorSettings>());
        profile.SetupGet(p => p.AstrometrySettings).Returns(Mock.Of<NINA.Profile.Interfaces.IAstrometrySettings>());
        profile.SetupGet(p => p.PlateSolveSettings).Returns(Mock.Of<NINA.Profile.Interfaces.IPlateSolveSettings>());
        var service = new Mock<NINA.Profile.Interfaces.IProfileService>();
        service.SetupGet(x => x.ActiveProfile).Returns(profile.Object);
        var telescope = new Mock<ITelescopeMediator>();
        telescope.Setup(t => t.GetInfo()).Returns(new NINA.Equipment.Equipment.MyTelescope.TelescopeInfo { Connected = false });
        var camera = new Mock<ICameraMediator>();
        camera.Setup(c => c.GetInfo()).Returns(new NINA.Equipment.Equipment.MyCamera.CameraInfo { Connected = false });
        var rotator = new Mock<IRotatorMediator>();
        rotator.Setup(r => r.GetInfo()).Returns(new NINA.Equipment.Equipment.MyRotator.RotatorInfo { Connected = false });
        var m = new NinaMediators(service.Object, telescope.Object, Mock.Of<IImagingMediator>(), camera.Object, Mock.Of<IFilterWheelMediator>(),
            rotator.Object, Mock.Of<IGuiderMediator>(), Mock.Of<IDomeMediator>(), Mock.Of<NINA.Equipment.Interfaces.IDomeFollower>(),
            Mock.Of<NINA.PlateSolving.Interfaces.IPlateSolverFactory>(), Mock.Of<NINA.Core.Utility.WindowService.IWindowServiceFactory>(),
            Mock.Of<NINA.WPF.Base.Interfaces.Mediator.IImageSaveMediator>(), Mock.Of<NINA.WPF.Base.Interfaces.ViewModel.IImageHistoryVM>(),
            Mock.Of<ISafetyMonitorMediator>());

        var hb = new NinaSettingsSource(m, () => []).Snapshot();

        Assert.Equal([(1, "L"), (2, "Ha 3nm")], hb.FilterWheel!.Select(f => (f.Position, f.Name)));
        Assert.Equal(15, hb.FilterWheel![1].FocusOffset);
        Assert.True(hb.MeridianFlip!.Recenter);
        Assert.False(hb.MeridianFlip.TriggerPresent);
        Assert.Null(hb.SequenceTriggers!.AutofocusAfterTimeMin); // ohne Trigger: Server plant mit afEveryMin = 0
        Assert.Null(hb.Mount);
        Assert.Null(hb.Camera);
        Assert.False(hb.Rotator!.Connected);
        // AP-70: Gerätestatus auch ohne verbundene Geräte (Mocks liefern keine Info) – nichts verbunden, keine Werte.
        Assert.False(hb.Devices!.Connected.Camera);
        Assert.False(hb.Devices.Connected.Weather);
        Assert.Null(hb.Devices.MountState);
        Assert.Null(hb.Devices.Weather);
        Assert.Null(hb.Devices.Safe);
    }

    [Fact]
    public void Wetter_jetzt_nur_mit_gelieferten_Werten()
    {
        // AP-70: SkyAlert liefert nicht jeden Wert – NaN bzw. außerhalb des Vertragsbereichs fehlt.
        var w = NinaSettingsSource.WeatherNow(new NINA.Equipment.Equipment.MyWeatherData.WeatherDataInfo
        {
            Connected = true,
            CloudCover = 12,
            SkyQuality = 21.4,
            Temperature = 17.1,
            DewPoint = 8.3,
            Humidity = 55,
            WindSpeed = 2.5,
            SkyBrightness = double.NaN,
            Pressure = double.NaN,
            WindDirection = 400,
            RainRate = double.NaN,
            StarFWHM = double.NaN,
            SkyTemperature = -18.5,
            WindGust = double.NaN,
        });
        Assert.Equal((12d, 21.4d, 17.1d, 8.3d, 55d, 2.5d, -18.5d), (w.CloudCoverPct!.Value, w.SkyQualityMag!.Value, w.TemperatureC!.Value,
            w.DewPointC!.Value, w.HumidityPct!.Value, w.WindSpeedMs!.Value, w.SkyTemperatureC!.Value));
        Assert.Null(w.SkyBrightnessLux);
        Assert.Null(w.PressureHpa);
        Assert.Null(w.WindDirectionDeg);
        Assert.Null(w.RainRateMmH);
    }

    [Fact]
    public void Messwerte_je_Aufnahme_aus_den_Bild_Metadaten()
    {
        // AP-70: RMS in Bogensekunden (Pixel × Bildmaßstab), Höhe, Luftmasse, Fokussierer, Wetter – NaN fehlt.
        var md = new NINA.Image.ImageData.ImageMetaData();
        md.Telescope.Altitude = 42.5;
        md.Telescope.Airmass = 1.47;
        md.Focuser.Position = 2050;
        md.Focuser.Temperature = 17.4;
        md.WeatherData.CloudCover = 0;
        md.WeatherData.SkyQuality = 21.6;
        md.WeatherData.Temperature = double.NaN;
        var metrics = new Metrics();
        NinaHost.AddMetaData(metrics, md);
        Assert.Equal((42.5d, 1.47d, 2050d, 17.4d, 0d, 21.6d), (metrics.AltitudeDeg!.Value, metrics.Airmass!.Value,
            metrics.FocusPosition!.Value, metrics.FocuserTemperatureC!.Value, metrics.CloudCoverPct!.Value, metrics.SkyQualityMag!.Value));
        Assert.Null(metrics.AirTemperatureC);
        Assert.Null(metrics.GuidingRmsArcsec); // ohne aufgezeichnetes Guiding
    }

    [Fact]
    public void Bildstatistik_je_Aufnahme_mit_Saettigung()
    {
        // AP-71: Median, Streuung, MAD, Minimum, Maximum und der Anteil gesättigter Pixel aus NINAs ImageStatistics.
        var st = new Mock<NINA.Image.Interfaces.IImageStatistics>();
        st.SetupGet(x => x.Median).Returns(812);
        st.SetupGet(x => x.StDev).Returns(140.5);
        st.SetupGet(x => x.MedianAbsoluteDeviation).Returns(35.2);
        st.SetupGet(x => x.Min).Returns(410);
        st.SetupGet(x => x.Max).Returns(65535);
        st.SetupGet(x => x.MaxOccurrences).Returns(250);
        st.SetupGet(x => x.BitDepth).Returns(16);
        var metrics = new Metrics();
        NinaHost.AddStatistics(metrics, st.Object, 1_000_000);
        Assert.Equal((812d, 140.5d, 35.2d, 410d, 65535d, 0.025d), (metrics.MedianAdu!.Value, metrics.StdDevAdu!.Value,
            metrics.MadAdu!.Value, metrics.MinAdu!.Value, metrics.MaxAdu!.Value, metrics.SaturatedPct!.Value));
    }

    [Fact]
    public void Optik_aus_Profil_und_Kamera()
    {
        // AP-71: Brennweite und Öffnungsverhältnis aus dem Profil, Pixel- und Sensorgröße aus der verbundenen Kamera.
        var profile = new Mock<NINA.Profile.Interfaces.IProfile>();
        profile.SetupGet(p => p.TelescopeSettings.FocalLength).Returns(2938);
        profile.SetupGet(p => p.TelescopeSettings.FocalRatio).Returns(6.8);
        profile.SetupGet(p => p.TelescopeSettings.Name).Returns("CDK17");
        profile.SetupGet(p => p.CameraSettings.PixelSize).Returns(3.8);
        var camera = new NINA.Equipment.Equipment.MyCamera.CameraInfo { Connected = true, PixelSize = 3.76, XSize = 9576, YSize = 6388, Name = "ZWO ASI6200MM Pro" };
        var o = NinaSettingsSource.Optics(profile.Object, camera);
        Assert.Equal((2938d, 6.8d, 3.76d, 9576, 6388, "ZWO ASI6200MM Pro", "CDK17"),
            (o.FocalLengthMm!.Value, o.FocalRatio!.Value, o.PixelSizeUm!.Value, o.SensorWidthPx!.Value, o.SensorHeightPx!.Value, o.CameraName, o.TelescopeName));

        // Kamera getrennt: Pixelgröße aus dem Profil, Sensor und Kameraname unbekannt.
        var off = NinaSettingsSource.Optics(profile.Object, new NINA.Equipment.Equipment.MyCamera.CameraInfo { Connected = false });
        Assert.Equal(3.8d, off.PixelSizeUm);
        Assert.Null(off.SensorWidthPx);
        Assert.Null(off.CameraName);
    }

    // ---- Bildpipeline: Plugin-Belichtung durch NINAs Sequenz und ImageSaved (execution.md §4.3, NT-10, NT-34) ----

    private sealed class ListSink : NinaPm.Core.Logging.ILogSink
    {
        public List<string> Lines { get; } = [];
        public void Info(string line) { lock (Lines) Lines.Add(line); }
        public void Warning(string line) { lock (Lines) Lines.Add(line); }
        public void Error(string line) { lock (Lines) Lines.Add(line); }
    }

    /// <summary>Netz gibt es im Test nicht: jede Anfrage scheitert sofort (die Meldungen bleiben in der Outbox).</summary>
    private sealed class NoNetwork : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException("kein Netz im Test");
    }

    /// <summary>
    /// Was die Simulation nicht kann (der kopflose Nachtlauf hat ein simuliertes NINA): eine Plugin-Belichtung läuft in
    /// einer echten Sequenz-Hierarchie durch den Trigger-Walk (Dither der Vorfahren unterdrückt, andere Trigger laufen),
    /// über <c>IImagingMediator</c> und <c>IImageSaveMediator.Enqueue</c>; NINAs <c>ImageSaved</c> mit derselben Bild-ID
    /// ergibt <c>CAPTURE result=saved</c> und eine Meldung mit NINAs Zeiten, Pier-Seite und Messwerten (P-02, P-28).
    /// </summary>
    [Fact]
    public async Task Belichtung_durch_NINAs_Bildpipeline_meldet_saved_mit_Messwerten_und_unterdrueckt_Dither()
    {
        var start = new DateTime(2026, 10, 3, 2, 0, 0, DateTimeKind.Utc);
        var camera = new Mock<ICameraMediator>();
        camera.Setup(c => c.GetInfo()).Returns(new NINA.Equipment.Equipment.MyCamera.CameraInfo { Connected = true, Temperature = -9.8, TemperatureSetPoint = -10, CoolerOn = true });
        var telescope = new Mock<ITelescopeMediator>();
        telescope.Setup(t => t.GetInfo()).Returns(new NINA.Equipment.Equipment.MyTelescope.TelescopeInfo { Connected = true, SideOfPier = NINA.Core.Enum.PierSide.pierWest });
        var rotator = new Mock<IRotatorMediator>();
        rotator.Setup(r => r.GetInfo()).Returns(new NINA.Equipment.Equipment.MyRotator.RotatorInfo { Connected = false });

        var exposure = new Mock<NINA.Image.Interfaces.IExposureData>();
        var meta = new NINA.Image.ImageData.ImageMetaData();
        meta.Image.Id = 42;
        meta.Image.ExposureStart = start;
        meta.Image.ExposureMidPoint = start.AddSeconds(150);
        exposure.SetupGet(e => e.MetaData).Returns(meta);
        var imageData = new Mock<NINA.Image.Interfaces.IImageData>();
        imageData.SetupGet(d => d.MetaData).Returns(new NINA.Image.ImageData.ImageMetaData());
        imageData.SetupGet(d => d.Statistics).Returns(new Nito.AsyncEx.AsyncLazy<NINA.Image.Interfaces.IImageStatistics>(
            () => Task.FromResult(Mock.Of<NINA.Image.Interfaces.IImageStatistics>())));
        exposure.Setup(e => e.ToImageData(It.IsAny<IProgress<ApplicationStatus>>(), It.IsAny<CancellationToken>())).ReturnsAsync(imageData.Object);
        var imaging = new Mock<IImagingMediator>();
        imaging.Setup(i => i.CaptureImage(It.IsAny<NINA.Equipment.Model.CaptureSequence>(), It.IsAny<CancellationToken>(),
                It.IsAny<IProgress<ApplicationStatus>>(), It.IsAny<string>()))
            .ReturnsAsync(exposure.Object);
        imaging.Setup(i => i.PrepareImage(It.IsAny<NINA.Image.Interfaces.IImageData>(), It.IsAny<PrepareImageParameters>(), It.IsAny<CancellationToken>()))
            .Returns(Task.FromResult(Mock.Of<NINA.Image.Interfaces.IRenderedImage>()));

        var imageSave = new Mock<NINA.WPF.Base.Interfaces.Mediator.IImageSaveMediator>();
        imageSave.Setup(s => s.Enqueue(It.IsAny<NINA.Image.Interfaces.IImageData>(), It.IsAny<Task<NINA.Image.Interfaces.IRenderedImage>>(),
                It.IsAny<IProgress<ApplicationStatus>>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask)
            .Callback(() =>
            {
                var saved = new NINA.Image.ImageData.ImageMetaData();
                saved.Image.Id = 42;
                saved.Camera.Temperature = -9.8;
                saved.Camera.SetPoint = -10;
                var stats = new Mock<NINA.Image.Interfaces.IImageStatistics>();
                stats.SetupGet(x => x.Mean).Returns(1234.5);
                var stars = new Mock<NINA.Image.Interfaces.IStarDetectionAnalysis>();
                stars.SetupGet(x => x.HFR).Returns(2.3);
                stars.SetupGet(x => x.DetectedStars).Returns(812);
                imageSave.Raise(x => x.ImageSaved += null, new NINA.WPF.Base.Interfaces.Mediator.ImageSavedEventArgs
                {
                    MetaData = saved,
                    Statistics = stats.Object,
                    StarDetectionAnalysis = stars.Object,
                    PathToImage = new Uri(@"C:\Bilder\M31_L_0001.fits"),
                });
            });

        // Profil mit Standort und leerem Filterrad (ohne Filterrad belichtet der Adapter ohne Filterwechsel).
        var wheel = new Mock<NINA.Profile.Interfaces.IFilterWheelSettings>();
        wheel.SetupGet(w => w.FilterWheelFilters).Returns(new ObserveAllCollection<NINA.Core.Model.Equipment.FilterInfo>(
            Array.Empty<NINA.Core.Model.Equipment.FilterInfo>()));
        var profile = new Mock<NINA.Profile.Interfaces.IProfile>();
        profile.SetupGet(p => p.AstrometrySettings).Returns(Mock.Of<NINA.Profile.Interfaces.IAstrometrySettings>());
        profile.SetupGet(p => p.FilterWheelSettings).Returns(wheel.Object);
        var profileService = new Mock<NINA.Profile.Interfaces.IProfileService>();
        profileService.SetupGet(x => x.ActiveProfile).Returns(profile.Object);

        var m = new NinaMediators(profileService.Object, telescope.Object, imaging.Object, camera.Object, Mock.Of<IFilterWheelMediator>(),
            rotator.Object, Mock.Of<IGuiderMediator>(), Mock.Of<IDomeMediator>(), Mock.Of<NINA.Equipment.Interfaces.IDomeFollower>(),
            Mock.Of<NINA.PlateSolving.Interfaces.IPlateSolverFactory>(), Mock.Of<NINA.Core.Utility.WindowService.IWindowServiceFactory>(),
            imageSave.Object, Mock.Of<NINA.WPF.Base.Interfaces.ViewModel.IImageHistoryVM>(), Mock.Of<ISafetyMonitorMediator>());
        var sink = new ListSink();
        var dbPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"ninapm-pipeline-{Guid.NewGuid():N}.db");
        using var store = NinaPm.Core.Storage.LocalStore.Open(dbPath, NinaPm.Core.Time.SystemClock.Instance);
        var host = new NinaHost(m);
        using var runtime = new NinaPmRuntime(new NinaPm.Core.Options.PluginOptions(),
            new NinaPm.Core.Api.NinaApi(new Uri("http://127.0.0.1:9/api"), "npm_test", "0.0.0", new NoNetwork()), store, host, sink, startHeartbeat: false);
        host.Runtime = runtime;
        var session = Guid.NewGuid();
        store.SetState(NinaPm.Core.Storage.StateKeys.SessionId, session.ToString());
        runtime.Runner.ExecutingPlan = ("2026-10-02", Guid.NewGuid());

        // Sequenz wie die Vorlage: Ziel (mit Dither- und AF-Trigger) → Blöcke → NINA-PM-Anweisungen.
        var target = new SequentialContainer();
        var blocks = new SequentialContainer();
        var box = new NinaPmContainer(profileService.Object, telescope.Object, imaging.Object, camera.Object, Mock.Of<IFilterWheelMediator>(),
            rotator.Object, Mock.Of<IGuiderMediator>(), Mock.Of<IDomeMediator>(), Mock.Of<NINA.Equipment.Interfaces.IDomeFollower>(),
            Mock.Of<NINA.PlateSolving.Interfaces.IPlateSolverFactory>(), Mock.Of<NINA.Core.Utility.WindowService.IWindowServiceFactory>(),
            imageSave.Object, Mock.Of<NINA.WPF.Base.Interfaces.ViewModel.IImageHistoryVM>(), Mock.Of<ISafetyMonitorMediator>(),
            Mock.Of<NINA.Astrometry.Interfaces.INighttimeCalculator>(), Mock.Of<IFocuserMediator>());
        target.Add(blocks);
        blocks.Add(box);
        var dither = new FakeDitherAfterExposures();
        var af = new FakeAutofocusAfterTimeTrigger();
        target.Add(dither);
        target.Add(af);
        host.Container = box;

        var block = new Blocks { Id = Guid.NewGuid(), ProjectId = Guid.NewGuid(), PanelId = Guid.NewGuid(), RaDeg = 10.68, DecDeg = 41.27, RotationDeg = 90 };
        var entry = new Entries { Seq = 1, Cmd = EntriesCmd.Expose, ExposureS = 300, Filter = "L", ExposureLineId = Guid.NewGuid() };

        var result = await host.ExposeAsync(block, entry, temperatureDeviation: false, default);

        Assert.Equal(ExposureResult.Saved, result);
        Assert.Equal(0, dither.Runs);
        Assert.True(af.Runs >= 1);
        Assert.Contains(sink.Lines, l => l.Contains("TRIGGER_SUPPRESSED type=FakeDitherAfterExposures"));
        Assert.Contains(sink.Lines, l => l.Contains("TRIGGER type=FakeAutofocusAfterTimeTrigger"));
        Assert.Contains(sink.Lines, l => l.Contains("CAPTURE") && l.Contains("result=saved") && l.Contains("file=M31_L_0001.fits"));

        // Zeitpunkte als Text lesen (sonst deutet Newtonsoft sie als DateTime um).
        var payload = Newtonsoft.Json.JsonConvert.DeserializeObject<Newtonsoft.Json.Linq.JObject>(
            Assert.Single(store.OutboxPayloads(NinaPm.Core.Storage.OutboxKinds.Capture)),
            new Newtonsoft.Json.JsonSerializerSettings { DateParseHandling = Newtonsoft.Json.DateParseHandling.None })!;
        Assert.Equal("saved", (string?)payload["result"]);
        Assert.Equal("west", (string?)payload["pierSide"]);
        Assert.Equal("2026-10-03T02:00:00Z", (string?)payload["capturedAtUtc"]);
        Assert.Equal("2026-10-03T02:02:30Z", (string?)payload["exposureMidUtc"]);
        Assert.Equal(2.3, (double?)payload["metrics"]?["hfr"]);
        Assert.Equal(812, (int?)payload["metrics"]?["stars"]);
        Assert.Equal(-9.8, (double?)payload["metrics"]?["sensorTempC"]);
        Assert.Equal(-10, (double?)payload["metrics"]?["setPointC"]);
        Assert.Equal(JTokenTypeNull, payload["gain"]?.Type); // Pflichtfeld mit null steht im JSON
    }

    private const Newtonsoft.Json.Linq.JTokenType JTokenTypeNull = Newtonsoft.Json.Linq.JTokenType.Null;

    [Theory]
    [InlineData(-1.0, null)]
    [InlineData(double.NaN, null)]
    [InlineData(150.0, null)]
    [InlineData(0.0, 0.0)]
    [InlineData(42.5, 42.5)]
    public void Kuehlerleistung_ausserhalb_0_bis_100_wird_weggelassen(double power, double? expected) =>
        Assert.Equal(expected, NinaSettingsSource.Percent(power));

    /// <summary>
    /// Früheste Flipzeit wie <c>MeridianFlipTrigger.CalculateMinimumTimeRemaining</c> (execution.md §4.5, AP-16f):
    /// <c>TimeToMeridianFlip − (MaxMinutesAfterMeridian − MinutesAfterMeridian)</c>, mit Pause zusätzlich
    /// <c>− MinutesAfterMeridian − PauseTimeBeforeMeridian</c>; ohne Montierung unbekannt.
    /// </summary>
    [Theory]
    [InlineData(true, 0.5, 0, 20.0)]
    [InlineData(true, 0.5, 10, 5.0)]
    [InlineData(true, 0.1, 0, -4.0)]
    [InlineData(false, 0.5, 0, null)]
    public void Frueheste_Flipzeit_wie_NINAs_Meridian_Flip_Trigger(bool connected, double timeToFlipH, double pauseMin, double? expectedMin)
    {
        var flip = new Mock<NINA.Profile.Interfaces.IMeridianFlipSettings>();
        flip.SetupGet(f => f.MinutesAfterMeridian).Returns(5);
        flip.SetupGet(f => f.MaxMinutesAfterMeridian).Returns(15);
        flip.SetupGet(f => f.PauseTimeBeforeMeridian).Returns(pauseMin);
        var profile = new Mock<NINA.Profile.Interfaces.IProfile>();
        profile.SetupGet(p => p.MeridianFlipSettings).Returns(flip.Object);
        profile.SetupGet(p => p.AstrometrySettings).Returns(Mock.Of<NINA.Profile.Interfaces.IAstrometrySettings>());
        var service = new Mock<NINA.Profile.Interfaces.IProfileService>();
        service.SetupGet(x => x.ActiveProfile).Returns(profile.Object);
        var telescope = new Mock<ITelescopeMediator>();
        telescope.Setup(t => t.GetInfo()).Returns(new NINA.Equipment.Equipment.MyTelescope.TelescopeInfo { Connected = connected, TimeToMeridianFlip = timeToFlipH });
        var m = new NinaMediators(service.Object, telescope.Object, Mock.Of<IImagingMediator>(), Mock.Of<ICameraMediator>(), Mock.Of<IFilterWheelMediator>(),
            Mock.Of<IRotatorMediator>(), Mock.Of<IGuiderMediator>(), Mock.Of<IDomeMediator>(), Mock.Of<NINA.Equipment.Interfaces.IDomeFollower>(),
            Mock.Of<NINA.PlateSolving.Interfaces.IPlateSolverFactory>(), Mock.Of<NINA.Core.Utility.WindowService.IWindowServiceFactory>(),
            Mock.Of<NINA.WPF.Base.Interfaces.Mediator.IImageSaveMediator>(), Mock.Of<NINA.WPF.Base.Interfaces.ViewModel.IImageHistoryVM>(),
            Mock.Of<ISafetyMonitorMediator>());

        var minutes = new NinaHost(m).MinutesToEarliestFlip();

        if (expectedMin is null) Assert.Null(minutes);
        else Assert.Equal(expectedMin.Value, minutes!.Value, 6);
    }
}

/// <summary>Container-Fabrik der Sequencer-Tests für andere Testklassen.</summary>
internal static class SequencerTestsAccess
{
    public static NinaPmContainer NewContainer() => SequencerTests.NewContainer();
}
