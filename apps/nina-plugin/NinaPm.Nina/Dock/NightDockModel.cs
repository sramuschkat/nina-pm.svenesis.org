using System.Collections.Concurrent;
using System.Windows.Threading;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Simulator;
using NinaPm.Core.Status;
using NinaPm.Nina.Sequencer;

namespace NinaPm.Nina.Dock;

/// <summary>Momentaufnahme für beide Fenster: Live-Status, Ansicht der Nacht, Zeitzone, Kamera, Änderungsschlüssel.</summary>
internal sealed record DockSnapshot(LiveStatus Live, NightView View, SiteTime Site, double? CameraTemperatureC, DateTimeOffset? TargetsFetchedUtc,
    DateTimeOffset Now, string Key)
{
    /// <summary>Planstand vom Server (AP-53c): „Rig plant noch mit Rev. n“, wenn sich die Eingabe geändert hat.</summary>
    public StoredPlanInfo? Stored { get; init; }
}

/// <summary>
/// Gemeinsame Quelle der Fenster im Imaging-Reiter (AP-53b, execution.md §10): ein 2-s-Takt für beide Fenster liest die
/// Laufzeit (<see cref="NinaPmRuntime.Current"/>), baut den Live-Status und die Ansicht der Nacht aus Nachtjournal und
/// gespeichertem Plan. Höhenkurven, Server-Ist und Planstand kommen aus <c>GET /simulation</c> – beim ersten Mal, nach
/// einem neuen Plan und sonst höchstens alle 10 min (<see cref="SimulationRefresh"/>, Plugin 0.4.18; vorher je Nacht
/// einmal, der Hinweis „Rig plant noch mit Rev. n“ fror ein). Ohne Verbindung bleibt die Grafik ohne Kurven. <see cref="DockSnapshot.Key"/> ändert sich nur, wenn sich Inhalt ändert (Journal, Plan,
/// laufender Block, Belichtung, Simulation, Minute) – die Fenster bauen Grafik und Protokoll nur dann neu.
/// </summary>
internal sealed class NightDockModel
{
    public static readonly NightDockModel Instance = new();

    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(2);

    private readonly ConcurrentDictionary<string, SimulationEntry> simulations = new();
    private DispatcherTimer? timer;
    private int subscribers;

    private sealed record SimulationEntry(NinaSimulation? Simulation, DateTimeOffset AttemptUtc, Guid? PlanId, bool Running);

    public DockSnapshot? Current { get; private set; }

    public event EventHandler? Updated;

    /// <summary>Fenster meldet sich an (Takt startet mit dem ersten Fenster).</summary>
    public void Subscribe(EventHandler handler)
    {
        Updated += handler;
        if (Interlocked.Increment(ref subscribers) == 1 && System.Windows.Application.Current?.Dispatcher is { } dispatcher)
        {
            timer = new DispatcherTimer(DispatcherPriority.Background, dispatcher) { Interval = Interval };
            timer.Tick += (_, _) => Poll();
            timer.Start();
        }
        Poll();
    }

    /// <summary>Einmal lesen (Takt und Tests).</summary>
    public void Poll()
    {
        try
        {
            Current = Read();
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            // Die Fenster dürfen NINA nie stören; der nächste Takt versucht es wieder.
            NINA.Core.Utility.Logger.Warning($"NINA-PM: dock: {ex.Message}");
        }
        Updated?.Invoke(this, EventArgs.Empty);
    }

    private DockSnapshot? Read()
    {
        if (NinaPmRuntime.Current is not { } runtime) return null;
        var runner = runtime.Runner;
        var night = runner.JournalNight;
        var simulation = night is null ? null : Simulation(runtime, night, runner.CurrentStoredPlan?.Plan);
        if (runner.NightViewInputs(simulation) is not { } inputs) return null;
        var view = NightViewBuilder.Build(inputs);
        var live = runner.LiveStatus(runtime.TestModeActive);
        double? temperature = null;
        try
        {
            temperature = runtime.Host.ReadCooling().TemperatureC;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            // Kamera nicht verbunden: ohne Temperatur.
        }
        var key = string.Join("|", inputs.Night, runner.Journal.Head(inputs.Night), view.PlanId, view.Revision, inputs.Running?.Block.Id,
            inputs.CurrentEntry?.Seq, simulation?.GeneratedAtUtc.ToUnixTimeSeconds(), inputs.Now.ToUnixTimeSeconds() / 60, inputs.Done.Count,
            view.Activity?.Kind, view.Activity?.Seq, view.Activity?.UntilUtc?.ToUnixTimeSeconds());
        return new DockSnapshot(live, view, inputs.Site, temperature, runner.TargetsFetchedUtc, inputs.Now, key) { Stored = simulation?.StoredPlan };
    }

    /// <summary>Simulation der Nacht aus dem Cache; erstmals, nach einem neuen Plan und alle 10 min im Hintergrund abrufen.</summary>
    private NinaSimulation? Simulation(NinaPmRuntime runtime, string night, NinaPlanResponse? plan)
    {
        var now = NinaPm.Core.Time.SystemClock.Instance.UtcNow;
        simulations.TryGetValue(night, out var entry);
        if (SimulationRefresh.Due(entry?.AttemptUtc, entry?.PlanId, plan?.NightPlanId, now, runtime.Options.OfflineMode, entry is { Running: true }))
        {
            simulations[night] = new SimulationEntry(entry?.Simulation, now, plan?.NightPlanId, true);
            _ = Task.Run(async () =>
            {
                var outcome = await SimulatorService.RunAsync(runtime.SimulationApi, runtime.Options.OfflineMode, night, runtime.Log,
                    CancellationToken.None).ConfigureAwait(false);
                simulations[night] = new SimulationEntry(outcome.Ok ? outcome.Simulation : entry?.Simulation, now, plan?.NightPlanId, false);
            });
        }
        // Ältere Nächte vergessen.
        foreach (var old in simulations.Keys.Where(k => string.CompareOrdinal(k, night) < 0)) simulations.TryRemove(old, out _);
        return simulations.TryGetValue(night, out var current) ? current.Simulation : null;
    }

    /// <summary>Fenster meldet sich ab.</summary>
    public void Unsubscribe(EventHandler handler)
    {
        Updated -= handler;
        if (Interlocked.Decrement(ref subscribers) == 0)
        {
            timer?.Stop();
            timer = null;
        }
    }
}
