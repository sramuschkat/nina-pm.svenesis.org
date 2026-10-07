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
/// gespeichertem Plan. Höhenkurven kommen aus <c>GET /simulation</c> – je Nacht höchstens einmal, erneut nur bei einem
/// Planwechsel mit einem Ziel, das die Simulation noch nicht kennt (und nicht öfter als alle 10 min). Ohne Verbindung
/// bleibt die Grafik ohne Kurven. <see cref="DockSnapshot.Key"/> ändert sich nur, wenn sich Inhalt ändert (Journal, Plan,
/// laufender Block, Belichtung, Simulation, Minute) – die Fenster bauen Grafik und Protokoll nur dann neu.
/// </summary>
internal sealed class NightDockModel
{
    public static readonly NightDockModel Instance = new();

    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(2);

    public static readonly TimeSpan SimulationRetry = TimeSpan.FromMinutes(10);

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
            inputs.CurrentEntry?.Seq, simulation?.GeneratedAtUtc.ToUnixTimeSeconds(), inputs.Now.ToUnixTimeSeconds() / 60, inputs.Done.Count);
        return new DockSnapshot(live, view, inputs.Site, temperature, runner.TargetsFetchedUtc, inputs.Now, key) { Stored = simulation?.StoredPlan };
    }

    /// <summary>Simulation der Nacht aus dem Cache; fehlt sie oder kam ein neues Ziel hinzu, im Hintergrund abrufen.</summary>
    private NinaSimulation? Simulation(NinaPmRuntime runtime, string night, NinaPlanResponse? plan)
    {
        var now = NinaPm.Core.Time.SystemClock.Instance.UtcNow;
        simulations.TryGetValue(night, out var entry);
        var unknownTarget = plan is not null && entry?.Simulation is { } known && entry.PlanId != plan.NightPlanId
            && plan.Blocks.Any(b => known.Targets.All(t => t.ProjectId != b.ProjectId));
        var due = entry is null
            || entry.Simulation is null && now - entry.AttemptUtc >= SimulationRetry
            || unknownTarget && now - entry!.AttemptUtc >= SimulationRetry;
        if (due && !runtime.Options.OfflineMode && entry is not { Running: true })
        {
            simulations[night] = new SimulationEntry(entry?.Simulation, now, plan?.NightPlanId, true);
            _ = Task.Run(async () =>
            {
                var outcome = await SimulatorService.RunAsync(runtime.SimulationApi, runtime.Options.OfflineMode, night, runtime.Log,
                    CancellationToken.None).ConfigureAwait(false);
                simulations[night] = new SimulationEntry(outcome.Ok ? outcome.Simulation : entry?.Simulation, now, plan?.NightPlanId, false);
            });
        }
        else if (entry is not null && unknownTarget is false && plan is not null && entry.PlanId != plan.NightPlanId && !entry.Running)
            simulations[night] = entry with { PlanId = plan.NightPlanId };
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
