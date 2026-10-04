using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Time;

namespace NinaPm.Core.Session;

/// <summary>NINA-Einstellungen des aktiven Profils für den Heartbeat (NT-22, NT-E1, NT-E2), vom Adapter gelesen.</summary>
public interface INinaSettingsSource
{
    /// <summary>Heartbeat mit den Gruppen <c>meridianFlip</c>, <c>rotator</c>, <c>plateSolve</c>, <c>mount</c>,
    /// <c>sequenceTriggers</c>, <c>camera</c>, <c>filterWheel</c> (Plätze ab 1), <c>cameraReadoutModes</c>,
    /// <c>profileLocation</c>; Zustand, Session und Zähler setzt <see cref="HeartbeatService"/>.</summary>
    NinaHeartbeat Snapshot();
}

/// <summary>
/// Heartbeat (execution.md §6, TK 5.6): läuft **unabhängig von der Sequenz** im 60-s-Takt, sobald das Plugin verbunden
/// ist. Zustand nach NT-17 (<c>running</c>, <c>idle</c>, <c>paused</c>, <c>blocked</c> mit Grund), Session und
/// laufender Block, Outbox-Zähler; die Antwort steuert Uhrabgleich (NT-05), Lease (M5, NT-14) und Bootstrap-Neuladen.
/// Danach sendet die Outbox, was ansteht. Ein Tick wirft nie (der Takt läuft weiter).
/// </summary>
public sealed class HeartbeatService(
    ISessionApi api,
    NightRunner runner,
    INinaSettingsSource settings,
    OutboxSender outbox,
    IClock clock,
    NinaPmLog log,
    string pluginVersion)
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(60);

    public async Task TickAsync(CancellationToken token)
    {
        // Offline-Modus (FA-NIN-04): ein letzter Heartbeat meldet offline, danach keine Aufrufe bis zum Ende des Modus.
        if (runner.OfflineMode && runner.OfflineAnnounced) return;
        NinaHeartbeat body;
        try
        {
            body = settings.Snapshot();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // NINA-Einstellungen nicht lesbar (z. B. Profilwechsel): Heartbeat ohne diese Gruppen.
            log.Note($"Heartbeat ohne NINA-Einstellungen: {ex.Message}");
            body = new NinaHeartbeat();
        }
        var state = runner.HeartbeatState(offline: false);
        body.State = state;
        body.BlockedReason = state == NinaHeartbeatState.Blocked ? runner.Loop.Blocked : null;
        body.SessionId = runner.SessionId;
        body.BlockId = runner.RunningBlockId;
        body.PluginVersion = pluginVersion;
        // Eigene Engine-Version wie im Kopf X-NPM-Engine-Version (TK 7.3), auch vor dem ersten Bootstrap – NINA läuft
        // oft Stunden vor dem Sequenzstart (Szenario starfront-roof).
        body.EngineVersion = EngineVersionInfo.Version;
        body.SettingsVersion = runner.Bootstrap?.Rig.SettingsVersion;
        body.OutboxPending = runner.OutboxPending;
        body.DeadLetters = runner.DeadLetters;
        body.AckedCommandIds = runner.TakeCommandAcks();

        var sent = clock.UtcNow;
        try
        {
            var response = await api.HeartbeatAsync(body, token).ConfigureAwait(false);
            if (runner.OfflineMode)
            {
                // Offline: keine Uhr- und Lease-Prüfung, Lease bleibt serverseitig eingefroren (§6).
                runner.OfflineAnnounced = true;
                log.Event("HEARTBEAT", ("state", "offline"), ("status", 200));
                return;
            }
            runner.HeartbeatAnswered(response, sent, body.SessionId);
            log.Event("HEARTBEAT", ("state", Name(state)), ("status", 200));
        }
        catch (NinaApiException ex) when (ex.StatusCode is 408 or 429 or >= 500)
        {
            log.Warning("API", ("status", ex.StatusCode), ("code", NinaApi.ProblemCode(ex.Response)), ("call", "heartbeat"));
            runner.HeartbeatUnanswered();
        }
        catch (NinaApiException ex)
        {
            // Antwort des Servers: 409 rig_busy → Lease weg; token_invalid/tenant_locked ordnet AP-16g ein.
            var code = NinaApi.ProblemCode(ex.Response);
            log.Warning("API", ("status", ex.StatusCode), ("code", code), ("call", "heartbeat"));
            if (ex.StatusCode == 409 && code == "session.rig_busy") runner.LeaseRigBusy();
            else if (ex.StatusCode == 401) runner.Rejected(NinaHeartbeatBlockedReason.Token_invalid);
            else if (ex.StatusCode == 403 && code == "tenant.locked") runner.Rejected(NinaHeartbeatBlockedReason.Tenant_locked);
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !token.IsCancellationRequested))
        {
            log.Warning("API", ("status", 0), ("code", ex is TaskCanceledException ? "timeout" : "network"), ("call", "heartbeat"));
            runner.HeartbeatUnanswered();
        }

        try
        {
            await outbox.FlushAsync(token).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.Note($"Outbox: {ex.Message}");
        }
    }

    private static string Name(NinaHeartbeatState s) => s switch
    {
        NinaHeartbeatState.Running => "running",
        NinaHeartbeatState.Idle => "idle",
        NinaHeartbeatState.Paused => "paused",
        NinaHeartbeatState.Flats => "flats",
        NinaHeartbeatState.Offline => "offline",
        _ => "blocked",
    };
}
