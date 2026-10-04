using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Simulator;
using NinaPm.Core.Tests;
using NinaPm.Core.Time;
using NinaPm.Nina.Simulator;
using NinaPm.Nina.Ui;
using Xunit;

namespace NinaPm.Nina.Tests;

/// <summary>
/// Simulator der Optionsseite (FA-NIN-18, AP-53): gesperrte Einstellungen aus dem Bootstrap, nicht verfügbar ohne
/// Laufzeit bzw. im Offline-Modus (kein Aufruf), Server-Ergebnis als Zielkarten, Plangrafik und kopierbares Protokoll.
/// </summary>
[Collection(WpfCollection.Name)]
public sealed class SimulatorModelTests
{
    internal static T Example<T>(string name) => JsonConvert.DeserializeObject<T>(ContractExamples.Json(name), NinaJson.Settings())!;

    internal static readonly NinaSimulation Sim = Example<NinaSimulation>("simulation.response");
    internal static readonly NinaBootstrap Bootstrap = Example<NinaBootstrap>("bootstrap.response");
    internal static readonly FixedClock Clock = new(UtcText.Parse("2026-09-17T19:00:00Z"));

    internal sealed class FakeApi : ISimulationApi
    {
        public List<string> Calls { get; } = [];

        public Task<NinaSimulation> SimulateAsync(string night, CancellationToken token)
        {
            Calls.Add(night);
            return Task.FromResult(Sim);
        }
    }

    private sealed class NullSink : ILogSink
    {
        public void Info(string line) { }
        public void Warning(string line) { }
        public void Error(string line) { }
    }

    /// <summary>Antwortet erst nach <see cref="Release"/> – eine Simulation „läuft“ solange.</summary>
    internal sealed class BlockingApi : ISimulationApi
    {
        private readonly TaskCompletionSource<NinaSimulation> gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls { get; private set; }

        public Task<NinaSimulation> SimulateAsync(string night, CancellationToken token)
        {
            Calls++;
            return gate.Task;
        }

        public void Release() => gate.SetResult(Sim);
    }

    internal static SimulatorModel Model(ISimulationApi api, bool offline = false) => new(
        () => new SimulatorContext(api, Bootstrap, offline, UtcText.Parse("2026-09-17T18:02:00Z"), new NinaPmLog(new NullSink())), Clock);

    [Fact]
    public void Ohne_Laufzeit_nicht_verfuegbar() => Sta.Run(() =>
    {
        var model = new SimulatorModel(() => null, Clock);
        model.Refresh();
        Assert.False(model.Available);
        Assert.Equal(Texts.SimUnavailable(Texts.NotConfigured), model.Status);
        Assert.False(model.HasSettings);
    });

    [Fact]
    public void Offline_Modus_kein_Aufruf_und_Einstellungen_bleiben_gesperrt_sichtbar() => Sta.Run(() =>
    {
        var api = new FakeApi();
        var model = Model(api, offline: true);
        model.SimulateAsync(CancellationToken.None).GetAwaiter().GetResult();
        Assert.Empty(api.Calls);
        Assert.False(model.Available);
        Assert.Equal(Texts.SimUnavailable(Texts.SimOffline), model.Status);
        Assert.Equal(11, model.Settings.Count);
        Assert.False(model.HasResults);
    });

    [Fact]
    public void Waehrend_einer_Simulation_sind_alle_Lauf_Knoepfe_gesperrt_und_ein_zweiter_Lauf_startet_nicht() => Sta.Run(() =>
    {
        var api = new BlockingApi();
        var model = Model(api);
        var first = model.SimulateAsync(CancellationToken.None);
        Assert.True(model.IsRunning);
        foreach (var c in new[] { model.PrevCommand, model.NextCommand, model.TonightCommand, model.SimulateCommand })
            Assert.False(c.CanExecute(null));
        var night = model.NightText;
        model.SimulateAsync(CancellationToken.None).GetAwaiter().GetResult();
        model.NextCommand.Execute(null);
        Assert.Equal(1, api.Calls);
        Assert.Equal(night, model.NightText);
        api.Release();
        first.GetAwaiter().GetResult();
        Assert.False(model.IsRunning);
        foreach (var c in new[] { model.PrevCommand, model.NextCommand, model.TonightCommand, model.SimulateCommand })
            Assert.True(c.CanExecute(null));
    });

    [Fact]
    public void Simulieren_zeigt_Karten_Grafik_und_Protokoll_des_Servers() => Sta.Run(() =>
    {
        var api = new FakeApi();
        var model = Model(api);
        model.SimulateAsync(CancellationToken.None).GetAwaiter().GetResult();
        Assert.Equal(["2026-09-17"], api.Calls);
        Assert.True(model.Available);
        Assert.True(model.HasResults);
        Assert.Equal(2, model.Cards.Count);
        Assert.Single(model.Unallocated);
        Assert.Equal(Sim.Protocol.Count, model.Log.Count);
        Assert.NotNull(model.Chart);
        Assert.Equal(PlanChartView.Width, model.Chart!.ChartWidth);
        Assert.Equal(Sim.Protocol.Count + 1, model.ProtocolText.Split('\n').Length);
        Assert.Equal(Texts.TargetsFetched("17.09. 13:02 CDT"), model.FetchedText);
        Assert.Equal("17./18.09.2026", model.NightText);
    });
}
