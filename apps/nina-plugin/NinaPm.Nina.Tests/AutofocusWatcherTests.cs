using System.Net.Http;
using Moq;
using Newtonsoft.Json.Linq;
using NINA.Equipment.Interfaces.Mediator;
using NINA.Equipment.Model;
using NinaPm.Core.Storage;
using NinaPm.Nina.Adapters;
using NinaPm.Nina.Sequencer;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// Autofokus-Läufe aus NINAs Fokussierer-Mediator (AP-65, execution.md §10.2): die Laufzeit registriert sich als
/// Verbraucher, meldet <c>af</c> mit Filter des Filterrads und entfernt sich beim Abbau; Fehler stören NINA nie.
/// </summary>
public sealed class AutofocusWatcherTests
{
    [Fact]
    public void Laufzeit_meldet_NINAs_Autofokus_als_af_und_meldet_sich_ab()
    {
        IFocuserConsumer? consumer = null;
        var focuser = new Mock<IFocuserMediator>();
        focuser.Setup(f => f.RegisterConsumer(It.IsAny<IFocuserConsumer>())).Callback<IFocuserConsumer>(c => consumer = c);
        var wheel = new Mock<IFilterWheelMediator>();
        wheel.Setup(w => w.GetInfo()).Returns(new NINA.Equipment.Equipment.MyFilterWheel.FilterWheelInfo
        {
            SelectedFilter = new NINA.Core.Model.Equipment.FilterInfo { Name = "Luminance" },
        });
        var m = Mediators(wheel.Object, focuser.Object);
        var dbPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"ninapm-af-{Guid.NewGuid():N}.db");
        var store = LocalStore.Open(dbPath, NinaPm.Core.Time.SystemClock.Instance);
        var host = new NinaHost(m);
        var runtime = new NinaPmRuntime(new NinaPm.Core.Options.PluginOptions(),
            new NinaPm.Core.Api.NinaApi(new Uri("http://127.0.0.1:9/api"), "npm_test", "0.0.0", new NoNetwork()), store, host,
            new NullSink(), startHeartbeat: false);
        store.SetState(StateKeys.SessionId, Guid.NewGuid().ToString());

        Assert.NotNull(consumer);
        consumer!.AutoFocusRunStarting();
        consumer.NewAutoFocusPoint(new OxyPlot.DataPoint(1000, 3.2));
        consumer.UpdateEndAutoFocusRun(new AutoFocusInfo(-5, 1000, null, DateTime.UnixEpoch));

        var af = store.OutboxPayloads(OutboxKinds.Event).Select(JObject.Parse).Single(e => (string?)e["kind"] == "af");
        Assert.Equal("ok", (string?)af["data"]!["result"]);
        Assert.Equal("Luminance", (string?)af["data"]!["filter"]);
        // AP-70: Endposition und Temperatur aus NINAs Bericht (AutoFocusInfo(temperature, position, …)).
        Assert.Equal(1000, (double)af["data"]!["position"]!);
        Assert.Equal(-5, (double)af["data"]!["temperatureC"]!);
        Assert.Null((string?)af["code"]);

        // Filterrad wirft: NINAs Autofokus läuft ungestört weiter, der Lauf zählt ohne Filter.
        wheel.Setup(w => w.GetInfo()).Throws(new InvalidOperationException("Filterrad getrennt"));
        consumer.AutoFocusRunStarting();
        runtime.Runner.Autofocus.Settle(exact: true);
        Assert.Equal(2, store.OutboxPayloads(OutboxKinds.Event).Count(p => p.Contains("\"af\"", StringComparison.Ordinal)));

        runtime.Dispose();
        focuser.Verify(f => f.RemoveConsumer(consumer), Times.Once);
    }

    [Theory]
    [InlineData("AutofocusAfterTimeTrigger", true)]
    [InlineData("AutofocusAfterHFRIncreaseTrigger", true)]
    [InlineData("AutofocusAfterFilterChange", true)]
    [InlineData("MeridianFlipTrigger", false)]
    [InlineData("CenterAfterDriftTrigger", false)]
    public void Autofokus_Trigger_am_Typnamen(string type, bool expected) =>
        Assert.Equal(expected, TriggerWalker.IsAutofocusTrigger(type));

    private static NinaMediators Mediators(IFilterWheelMediator wheel, IFocuserMediator focuser) =>
        new(Mock.Of<NINA.Profile.Interfaces.IProfileService>(), Mock.Of<ITelescopeMediator>(), Mock.Of<IImagingMediator>(),
            Mock.Of<ICameraMediator>(), wheel, Mock.Of<IRotatorMediator>(), Mock.Of<IGuiderMediator>(), Mock.Of<IDomeMediator>(),
            Mock.Of<NINA.Equipment.Interfaces.IDomeFollower>(), Mock.Of<NINA.PlateSolving.Interfaces.IPlateSolverFactory>(),
            Mock.Of<NINA.Core.Utility.WindowService.IWindowServiceFactory>(), Mock.Of<NINA.WPF.Base.Interfaces.Mediator.IImageSaveMediator>(),
            Mock.Of<NINA.WPF.Base.Interfaces.ViewModel.IImageHistoryVM>(), Mock.Of<ISafetyMonitorMediator>(), focuser);

    private sealed class NullSink : NinaPm.Core.Logging.ILogSink
    {
        public void Info(string line) { }
        public void Warning(string line) { }
        public void Error(string line) { }
    }

    private sealed class NoNetwork : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException("kein Netz im Test");
    }
}
