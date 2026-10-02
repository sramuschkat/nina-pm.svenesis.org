using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Storage;

namespace NinaPm.Core.Session;

/// <summary>
/// Outbox-Grundfunktion (AP-16e, execution.md §8): Meldungen streng in FIFO-Reihenfolge senden – aufeinanderfolgende
/// Einträge derselben Art und Session als ein Paket (≤ 500), nach 2xx quittieren. Scheitert ein Paket, bleibt alles
/// liegen und der nächste Heartbeat versucht es wieder; Backoff, Dead-Letter, Nachmelden offline angelegter Sessions
/// folgen mit AP-16g. Meldungen scheitern nie an der Lease (§6).
/// </summary>
public sealed class OutboxSender(LocalStore store, ISessionApi api, NinaPmLog log)
{
    public const int MaxBatch = 500;
    private readonly SemaphoreSlim gate = new(1, 1);

    /// <summary>Alles Sendbare senden; <c>true</c>, wenn die Outbox danach leer ist. Läuft höchstens einmal gleichzeitig.</summary>
    public async Task<bool> FlushAsync(CancellationToken token)
    {
        if (!await gate.WaitAsync(0, token).ConfigureAwait(false)) return false;
        try
        {
            while (true)
            {
                var entries = store.OutboxPeek(MaxBatch);
                if (entries.Count == 0) return true;
                var head = entries[0];
                var run = entries.TakeWhile(e => e.Kind == head.Kind && e.SessionId == head.SessionId).ToList();
                if (!await SendAsync(head.Kind, head.SessionId, run, token).ConfigureAwait(false)) return false;
                store.OutboxAcknowledge(run);
                log.Event("OUTBOX", ("pending", store.OutboxCount()), ("dead", 0));
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task<bool> SendAsync(string kind, Guid? sessionId, IReadOnlyList<OutboxEntry> run, CancellationToken token)
    {
        // Ohne Session (offline angelegt, noch nicht nachgemeldet) wartet der Eintrag auf AP-16g.
        if (sessionId is not { } session) return false;
        var call = kind == OutboxKinds.Capture ? "captures" : "events";
        try
        {
            switch (kind)
            {
                case OutboxKinds.Capture:
                    await api.CapturesAsync(session, new NinaCaptureBatch { Captures = [.. run.Select(e => Read<Captures>(e.Payload))] }, token)
                        .ConfigureAwait(false);
                    break;
                case OutboxKinds.Event:
                    await api.EventsAsync(session, new NinaEventBatch { Events = [.. run.Select(e => Read<Events>(e.Payload))] }, token)
                        .ConfigureAwait(false);
                    break;
                default:
                    // Sessions und Session-PATCH über die Outbox: AP-16g.
                    return false;
            }
            log.Event("API", ("status", 200), ("call", call));
            return true;
        }
        catch (NinaApiException ex)
        {
            log.Warning("API", ("status", ex.StatusCode), ("code", NinaApi.ProblemCode(ex.Response)), ("call", call));
            return false;
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !token.IsCancellationRequested))
        {
            log.Warning("API", ("status", 0), ("code", ex is TaskCanceledException ? "timeout" : "network"), ("call", call));
            return false;
        }
    }

    private static T Read<T>(string json) => JsonConvert.DeserializeObject<T>(json, NinaJson.Settings())!;
}
