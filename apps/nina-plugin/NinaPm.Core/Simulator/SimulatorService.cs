using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Time;

namespace NinaPm.Core.Simulator;

/// <summary><c>GET /simulation</c> der NINA-API (für Tests austauschbar).</summary>
public interface ISimulationApi
{
    Task<NinaSimulation> SimulateAsync(string night, CancellationToken token);
}

/// <summary><see cref="ISimulationApi"/> über den generierten Client.</summary>
public sealed class NinaSimulationApi(NinaApiClient client) : ISimulationApi
{
    public Task<NinaSimulation> SimulateAsync(string night, CancellationToken token) => client.ApiNinaV1SimulationAsync(night, token);
}

/// <summary>Ergebnis eines Simulationsaufrufs: verfügbar mit Simulation, sonst der Grund.</summary>
public enum SimulatorState
{
    Ok,

    /// <summary>Server-URL oder Token fehlen.</summary>
    NotConfigured,

    /// <summary>Offline-Modus aktiv: kein Server-Aufruf (FA-NIN-04), der Simulator rechnet nie lokal.</summary>
    Offline,

    /// <summary>Netzfehler, Zeitüberschreitung oder 5xx.</summary>
    Unreachable,
    TokenInvalid,
    TenantLocked,
    UpdateNeeded,

    /// <summary><c>422 nina.night_invalid</c>: Nacht nicht in der Nacht-Tabelle.</summary>
    NightInvalid,
    Failed,
}

public sealed record SimulationOutcome(SimulatorState State, NinaSimulation? Simulation, int Status = 0, string? Code = null)
{
    public bool Ok => State == SimulatorState.Ok && Simulation is not null;
}

/// <summary>
/// Simulator im Plugin (FA-NIN-18, AP-53): **es rechnet immer der Server** (<c>GET /simulation</c>, Entscheidung Sven
/// 01.10.2026) – ohne Verbindung ist der Simulator nicht verfügbar, es gibt keinen lokalen Ersatz und keine lokale
/// Änderung der Scheduler-Einstellungen. Der Aufruf hat keine Nebenwirkung auf Plan, Session oder Cache.
/// </summary>
public static class SimulatorService
{
    /// <summary>Verfügbarkeit vor dem Aufruf: ohne Optionen bzw. im Offline-Modus gar nicht erst fragen.</summary>
    public static SimulatorState? Precheck(bool configured, bool offlineMode) =>
        !configured ? SimulatorState.NotConfigured
        : offlineMode ? SimulatorState.Offline
        : null;

    public static async Task<SimulationOutcome> RunAsync(ISimulationApi? api, bool offlineMode, string night, NinaPmLog log,
        CancellationToken token)
    {
        if (Precheck(api is not null, offlineMode) is { } blocked) return new SimulationOutcome(blocked, null);
        if (!UtcText.IsNightKey(night)) return new SimulationOutcome(SimulatorState.NightInvalid, null, 422, "nina.night_invalid");
        try
        {
            var simulation = await api!.SimulateAsync(night, token).ConfigureAwait(false);
            log.Event("API", ("status", 200), ("call", "simulation"), ("night", night));
            return new SimulationOutcome(SimulatorState.Ok, simulation, 200);
        }
        catch (NinaApiException ex)
        {
            var code = NinaApi.ProblemCode(ex.Response);
            log.Warning("API", ("status", ex.StatusCode), ("code", code), ("call", "simulation"));
            return new SimulationOutcome(Classify(ex.StatusCode, code), null, ex.StatusCode, code);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !token.IsCancellationRequested)
        {
            log.Warning("API", ("status", 0), ("code", "network"), ("call", "simulation"));
            return new SimulationOutcome(SimulatorState.Unreachable, null, 0, "network");
        }
    }

    /// <summary>Statuscode und Code aus <c>errors.json</c> → Zustand (wie <em>Verbindung testen</em>).</summary>
    public static SimulatorState Classify(int status, string? code) => status switch
    {
        401 => SimulatorState.TokenInvalid,
        403 when code == "tenant.locked" => SimulatorState.TenantLocked,
        409 when code == "engine.incompatible" => SimulatorState.UpdateNeeded,
        422 when code == "nina.night_invalid" => SimulatorState.NightInvalid,
        408 or 429 or >= 500 => SimulatorState.Unreachable,
        _ => SimulatorState.Failed,
    };
}
