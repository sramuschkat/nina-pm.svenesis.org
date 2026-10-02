using System.Globalization;
using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;

namespace NinaPm.Core.Session;

/// <summary>Antworten auf Session-PATCHes aus der Outbox (Lease, Abschluss), umgesetzt von <see cref="NightRunner"/>.</summary>
public interface IOutboxListener
{
    /// <summary><c>2xx</c> auf <c>PATCH /sessions/{id}</c>.</summary>
    void SessionPatched(Guid sessionId, NinaSessionPatch sent, NinaSessionPatched response);

    /// <summary><c>409</c> auf <c>PATCH /sessions/{id}</c> (<c>session.rig_busy</c>, <c>session.closed</c>, <c>session.unknown</c>).</summary>
    void SessionPatchRejected(Guid sessionId, NinaSessionPatch sent, string? code);

    /// <summary>Ein wartendes <c>PATCH running</c> noch senden? Nach Abschluss, Stopp oder Session-Wechsel veraltet.</summary>
    bool ShouldResume(Guid sessionId);
}

/// <summary>
/// Outbox (AP-16e, execution.md §8): Meldungen streng in FIFO-Reihenfolge senden – aufeinanderfolgende Aufnahmen bzw.
/// Ereignisse derselben Session als ein Paket (≤ 500), Session-PATCHes einzeln; nach 2xx quittieren. Scheitert ein
/// Paket, bleibt alles liegen und der nächste Heartbeat versucht es wieder. Nach dem Nachtende meldet jedes weitere
/// Leeren den neuen Stand mit <c>PATCH {status: completed, outboxPending}</c> (NIN5-7), bis 0 gemeldet ist.
/// Backoff, Dead-Letter und offline angelegte Sessions folgen mit AP-16g. Meldungen scheitern nie an der Lease (§6).
/// </summary>
public sealed class OutboxSender(LocalStore store, ISessionApi api, NinaPmLog log)
{
    public const int MaxBatch = 500;
    private readonly SemaphoreSlim gate = new(1, 1);

    /// <summary>Empfänger der PATCH-Antworten (die Laufzeit setzt den <see cref="NightRunner"/>).</summary>
    public IOutboxListener? Listener { get; init; }

    /// <summary>Alles Sendbare senden; <c>true</c>, wenn die Outbox danach leer ist. Läuft höchstens einmal gleichzeitig.</summary>
    public async Task<bool> FlushAsync(CancellationToken token)
    {
        if (!await gate.WaitAsync(0, token).ConfigureAwait(false)) return false;
        var acked = false;
        try
        {
            while (true)
            {
                var entries = store.OutboxPeek(MaxBatch);
                if (entries.Count == 0) return true;
                var head = entries[0];
                var run = head.Kind == OutboxKinds.SessionPatch
                    ? [head]
                    : entries.TakeWhile(e => e.Kind == head.Kind && e.SessionId == head.SessionId).ToList();
                if (!await SendAsync(head.Kind, head.SessionId, run, token).ConfigureAwait(false)) return false;
                store.OutboxAcknowledge(run);
                acked = true;
                log.Event("OUTBOX", ("pending", store.OutboxCount()), ("dead", 0));
            }
        }
        finally
        {
            try
            {
                await ReportCompletedAsync(acked, token).ConfigureAwait(false);
            }
            finally
            {
                gate.Release();
            }
        }
    }

    /// <summary>
    /// Abgeschlossene Session mit offenen Meldungen (<see cref="StateKeys.CompletedSession"/>): nach jedem Leeren den
    /// neuen Stand melden; bei 0 ist die Nachmeldung beendet. Liegt der Abschluss-PATCH selbst noch in der Outbox,
    /// meldet er den Stand beim Senden.
    /// </summary>
    private async Task ReportCompletedAsync(bool acked, CancellationToken token)
    {
        if (CompletedSession(store) is not { } completed) return;
        var pending = store.OutboxCount();
        if (!acked && pending > 0) return;
        if (store.OutboxPeek(MaxBatch).Any(e => e.Kind == OutboxKinds.SessionPatch && e.SessionId == completed.Id)) return;
        var patch = new NinaSessionPatch { Status = NinaSessionPatchStatus.Completed, EndedAtUtc = completed.EndedAtUtc, OutboxPending = pending };
        try
        {
            await api.PatchAsync(completed.Id, patch, token).ConfigureAwait(false);
            log.Event("API", ("status", 200), ("call", "sessions"));
            log.Event("SESSION", ("session", completed.Id), ("status", "completed"), ("pending", pending));
            if (pending == 0) store.SetState(StateKeys.CompletedSession, null);
        }
        catch (NinaApiException ex)
        {
            log.Warning("API", ("status", ex.StatusCode), ("code", NinaApi.ProblemCode(ex.Response)), ("call", "sessions"));
            // Session dem Server unbekannt oder anders abgeschlossen: nichts mehr nachzumelden.
            if (ex.StatusCode is >= 400 and < 500 and not 408 and not 429) store.SetState(StateKeys.CompletedSession, null);
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !token.IsCancellationRequested))
        {
            log.Warning("API", ("status", 0), ("code", ex is TaskCanceledException ? "timeout" : "network"), ("call", "sessions"));
        }
    }

    private async Task<bool> SendAsync(string kind, Guid? sessionId, IReadOnlyList<OutboxEntry> run, CancellationToken token)
    {
        // Ohne Session (offline angelegt, noch nicht nachgemeldet) wartet der Eintrag auf AP-16g.
        if (sessionId is not { } session) return false;
        var call = kind switch
        {
            OutboxKinds.Capture => "captures",
            OutboxKinds.Event => "events",
            _ => "sessions",
        };
        NinaSessionPatch? patch = null;
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
                case OutboxKinds.SessionPatch:
                    patch = Read<NinaSessionPatch>(run[0].Payload);
                    if (patch.Status == NinaSessionPatchStatus.Running && Listener?.ShouldResume(session) == false)
                    {
                        log.Note($"Fortsetzen der Session {session} entfällt (inzwischen abgeschlossen oder gewechselt).");
                        return true;
                    }
                    // Abschluss meldet den Stand beim Senden (alles davor ist quittiert, NIN5-7).
                    if (patch.Status == NinaSessionPatchStatus.Completed) patch.OutboxPending = Math.Max(0, store.OutboxCount() - 1);
                    var response = await api.PatchAsync(session, patch, token).ConfigureAwait(false);
                    log.Event("API", ("status", 200), ("call", call));
                    if (patch.Status != NinaSessionPatchStatus.Running)
                    {
                        log.Event("SESSION", ("session", session), ("status", patch.Status == NinaSessionPatchStatus.Completed ? "completed" : "aborted"),
                            ("pending", patch.OutboxPending ?? 0));
                        if (patch.Status == NinaSessionPatchStatus.Completed && patch.OutboxPending == 0) store.SetState(StateKeys.CompletedSession, null);
                    }
                    Listener?.SessionPatched(session, patch, response);
                    return true;
                default:
                    // POST /sessions über die Outbox (offline angelegt): AP-16g.
                    return false;
            }
            log.Event("API", ("status", 200), ("call", call));
            return true;
        }
        catch (NinaApiException ex)
        {
            var code = NinaApi.ProblemCode(ex.Response);
            log.Warning("API", ("status", ex.StatusCode), ("code", code), ("call", call));
            // 409 auf einen Session-PATCH ist endgültig (Rig belegt, Session abgeschlossen/unbekannt): nicht wiederholen.
            if (patch is not null && ex.StatusCode == 409)
            {
                Listener?.SessionPatchRejected(session, patch, code);
                return true;
            }
            return false;
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !token.IsCancellationRequested))
        {
            log.Warning("API", ("status", 0), ("code", ex is TaskCanceledException ? "timeout" : "network"), ("call", call));
            return false;
        }
    }

    /// <summary>Gespeicherter Abschluss (<c>sessionId|endedAtUtc</c>) oder <c>null</c>.</summary>
    public static (Guid Id, DateTimeOffset EndedAtUtc)? CompletedSession(LocalStore store)
    {
        var value = store.GetState(StateKeys.CompletedSession);
        if (value?.Split('|') is not [var id, var ended]) return null;
        return Guid.TryParse(id, out var g) && DateTimeOffset.TryParse(ended, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var e)
            ? (g, e)
            : null;
    }

    /// <summary>Abschluss merken, solange Meldungen offen sind.</summary>
    public static void RememberCompleted(LocalStore store, Guid id, DateTimeOffset endedAtUtc) =>
        store.SetState(StateKeys.CompletedSession, $"{id}|{UtcText.Format(endedAtUtc)}");

    private static T Read<T>(string json) => JsonConvert.DeserializeObject<T>(json, NinaJson.Settings())!;
}
