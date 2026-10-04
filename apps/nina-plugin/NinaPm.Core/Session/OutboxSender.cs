using System.Globalization;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Execution;
using NinaPm.Core.Logging;
using NinaPm.Core.Storage;
using NinaPm.Core.Time;

namespace NinaPm.Core.Session;

/// <summary>Antworten der Outbox an den Nachtlauf (Lease, Abschluss, gesperrte Zustände), umgesetzt von <see cref="NightRunner"/>.</summary>
public interface IOutboxListener
{
    /// <summary><c>2xx</c> auf <c>PATCH /sessions/{id}</c>.</summary>
    void SessionPatched(Guid sessionId, NinaSessionPatch sent, NinaSessionPatched response);

    /// <summary><c>409</c> auf <c>PATCH /sessions/{id}</c> (<c>session.rig_busy</c>, <c>session.closed</c>, <c>session.unknown</c>).</summary>
    void SessionPatchRejected(Guid sessionId, NinaSessionPatch sent, string? code);

    /// <summary>Ein wartendes <c>PATCH running</c> noch senden? Nach Abschluss, Stopp oder Session-Wechsel veraltet.</summary>
    bool ShouldResume(Guid sessionId);

    /// <summary>Offline angelegte Session ist beim Server angekommen (<c>POST /sessions</c> aus der Outbox).</summary>
    void SessionReported(Guid sessionId);

    /// <summary>Anlage-Daten einer Session für das Nachmelden nach <c>409 session.unknown</c>; <c>null</c> = unbekannt.</summary>
    NinaSessionCreate? SessionCreateFor(Guid sessionId);

    /// <summary><c>401</c>, <c>403 tenant.locked</c> oder <c>409 engine.incompatible</c>: gesperrter Zustand (§2).</summary>
    void Rejected(NinaHeartbeatBlockedReason reason);

    /// <summary>Senden angehalten (gesperrter Zustand ohne Senden, Offline-Modus) – die Warteschlange bleibt.</summary>
    bool Paused { get; }
}

/// <summary>
/// Outbox (execution.md §8, AP-16e/AP-16g): Meldungen streng in FIFO-Reihenfolge senden – aufeinanderfolgende Aufnahmen
/// bzw. Ereignisse derselben Session als ein Paket (≤ 500), Session-Anlage und Session-PATCHes einzeln; nach 2xx
/// quittieren (<c>sent_history</c>, 14 Tage). Fehlerklassen nach der Tabelle „Fehlercode → Aktion“ (NIN-10):
/// Wiederholung mit Backoff 1, 2, 5, 15, 60 min (unbegrenzt) bei 408/429/5xx/Netz; <c>409 session.unknown</c> → Session
/// nachmelden, dann wiederholen; <c>409 session.closed</c> → Dead-Letter mit Hinweis; <c>413</c> → Paket halbieren;
/// <c>422</c> mit <c>errors[]</c> → nur die beanstandeten Meldungen ins Dead-Letter; <c>401</c>, <c>403 tenant.locked</c>,
/// <c>409 engine.incompatible</c> → anhalten (gesperrter Zustand, kein Dead-Letter); übrige 4xx → Dead-Letter.
/// Nach dem Nachtende meldet jedes weitere Leeren <c>PATCH {status: completed, outboxPending}</c> bis 0 (NIN5-7).
/// Meldungen scheitern nie an der Lease (§6).
/// </summary>
public sealed class OutboxSender(LocalStore store, ISessionApi api, NinaPmLog log, IClock? clock = null)
{
    public const int MaxBatch = 500;

    /// <summary>Backoff-Leiter in Minuten (§8); ab dem fünften Fehlschlag bleibt es bei 60 min.</summary>
    public static readonly int[] BackoffMinutes = [1, 2, 5, 15, 60];

    /// <summary>Aufbewahrung der gesendeten Meldungen (*Erneut hochladen ab Datum*).</summary>
    public static readonly TimeSpan History = TimeSpan.FromDays(14);

    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly IClock time = clock ?? SystemClock.Instance;
    private int batchLimit = MaxBatch;

    /// <summary>Empfänger der Antworten (die Laufzeit setzt den <see cref="NightRunner"/>).</summary>
    public IOutboxListener? Listener { get; init; }

    private enum Result
    {
        Sent,
        Retry,
        Pause,
        Continue,
    }

    /// <summary>
    /// Alles Sendbare senden; <c>true</c>, wenn die Outbox danach leer ist. Läuft höchstens einmal gleichzeitig. Ohne
    /// <paramref name="force"/> wartet ein gescheiterter Kopf den Backoff ab.
    /// </summary>
    public async Task<bool> FlushAsync(CancellationToken token, bool force = false)
    {
        if (Listener?.Paused == true) return false;
        if (!await gate.WaitAsync(0, token).ConfigureAwait(false)) return false;
        var acked = false;
        try
        {
            store.PruneSentHistory(time.UtcNow - History);
            while (true)
            {
                if (Listener?.Paused == true) return false;
                var head = store.OutboxHead();
                if (head is null) return true;
                if (!force && head.Value.NextAttemptUtc > time.UtcNow) return false;
                var entries = store.OutboxPeek(batchLimit);
                var first = entries[0];
                var single = first.Kind is OutboxKinds.SessionPatch or OutboxKinds.Session;
                var run = single
                    ? new List<OutboxEntry> { first }
                    : entries.TakeWhile(e => e.Kind == first.Kind && e.SessionId == first.SessionId).ToList();
                switch (await SendAsync(run, token).ConfigureAwait(false))
                {
                    case Result.Sent:
                        store.OutboxAcknowledge(run);
                        acked = true;
                        batchLimit = MaxBatch;
                        LogState();
                        break;
                    case Result.Continue:
                        LogState();
                        break;
                    case Result.Retry:
                        var step = BackoffMinutes[Math.Min(head.Value.Attempts, BackoffMinutes.Length - 1)];
                        store.OutboxRetryLater(run, time.UtcNow.AddMinutes(step));
                        return false;
                    default:
                        return false;
                }
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

    private void LogState() => log.Event("OUTBOX", ("pending", store.OutboxCount()), ("dead", store.DeadLetterCount()));

    /// <summary>
    /// Abgeschlossene Session mit offenen Meldungen (<see cref="StateKeys.CompletedSession"/>): nach jedem Leeren den
    /// neuen Stand melden; bei 0 ist die Nachmeldung beendet. Liegt der Abschluss-PATCH selbst noch in der Outbox,
    /// meldet er den Stand beim Senden.
    /// </summary>
    private async Task ReportCompletedAsync(bool acked, CancellationToken token)
    {
        if (Listener?.Paused == true || ClosedSession(store) is not { } completed) return;
        var pending = store.OutboxCount();
        if (!acked && pending > 0) return;
        if (store.OutboxPeek(MaxBatch).Any(e => e.Kind == OutboxKinds.SessionPatch && e.SessionId == completed.Id)) return;
        var patch = new NinaSessionPatch { Status = completed.Status, EndedAtUtc = completed.EndedAtUtc, OutboxPending = pending };
        try
        {
            await api.PatchAsync(completed.Id, patch, token).ConfigureAwait(false);
            log.Event("API", ("status", 200), ("call", "sessions"));
            log.Event("SESSION", ("session", completed.Id), ("status", completed.Status == NinaSessionPatchStatus.Aborted ? "aborted" : "completed"),
                ("pending", pending));
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

    private async Task<Result> SendAsync(IReadOnlyList<OutboxEntry> run, CancellationToken token)
    {
        var head = run[0];
        var call = head.Kind switch
        {
            OutboxKinds.Capture => "captures",
            OutboxKinds.Event => "events",
            _ => "sessions",
        };
        // Ohne Session gibt es keinen Empfänger: ins Dead-Letter, statt die FIFO zu blockieren.
        if (head.SessionId is not { } session)
        {
            store.OutboxDeadLetter(run, null, null, "Meldung ohne Session");
            return Result.Continue;
        }
        NinaSessionPatch? patch = null;
        try
        {
            switch (head.Kind)
            {
                case OutboxKinds.Capture:
                    await api.CapturesAsync(session, new NinaCaptureBatch { Captures = [.. run.Select(e => Read<Captures>(e.Payload))] }, token)
                        .ConfigureAwait(false);
                    break;
                case OutboxKinds.Event:
                    await api.EventsAsync(session, new NinaEventBatch { Events = [.. run.Select(e => Read<Events>(e.Payload))] }, token)
                        .ConfigureAwait(false);
                    break;
                case OutboxKinds.Session:
                    // Ohne Serverantwort angelegte Session (§6): immer mit offline: true nachmelden.
                    var create = Read<NinaSessionCreate>(head.Payload);
                    create.Offline = true;
                    await api.CreateAsync(create, token).ConfigureAwait(false);
                    log.Event("API", ("status", 200), ("call", call));
                    log.Event("SESSION", ("session", session), ("status", "running"), ("night", create.Night));
                    Listener?.SessionReported(session);
                    return Result.Sent;
                case OutboxKinds.SessionPatch:
                    patch = Read<NinaSessionPatch>(head.Payload);
                    if (patch.Status == NinaSessionPatchStatus.Running && Listener?.ShouldResume(session) == false)
                    {
                        log.Note($"Fortsetzen der Session {session} entfällt (inzwischen abgeschlossen oder gewechselt).");
                        return Result.Sent;
                    }
                    // Abschluss meldet den Stand beim Senden (alles davor ist quittiert, NIN5-7).
                    if (patch.Status is NinaSessionPatchStatus.Completed or NinaSessionPatchStatus.Aborted)
                        patch.OutboxPending = Math.Max(0, store.OutboxCount() - 1);
                    var response = await api.PatchAsync(session, patch, token).ConfigureAwait(false);
                    log.Event("API", ("status", 200), ("call", call));
                    if (patch.Status != NinaSessionPatchStatus.Running)
                    {
                        log.Event("SESSION", ("session", session), ("status", patch.Status == NinaSessionPatchStatus.Completed ? "completed" : "aborted"),
                            ("pending", patch.OutboxPending ?? 0));
                        if (patch.OutboxPending == 0 && ClosedSession(store)?.Id == session) store.SetState(StateKeys.CompletedSession, null);
                    }
                    Listener?.SessionPatched(session, patch, response);
                    return Result.Sent;
                default:
                    store.OutboxDeadLetter(run, null, null, $"Unbekannte Meldungsart {head.Kind}");
                    return Result.Continue;
            }
            log.Event("API", ("status", 200), ("call", call));
            return Result.Sent;
        }
        catch (NinaApiException ex)
        {
            var code = NinaApi.ProblemCode(ex.Response);
            log.Warning("API", ("status", ex.StatusCode), ("code", code), ("call", call));
            return Classify(run, session, patch, ex, code);
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !token.IsCancellationRequested))
        {
            log.Warning("API", ("status", 0), ("code", ex is TaskCanceledException ? "timeout" : "network"), ("call", call));
            return Result.Retry;
        }
    }

    /// <summary>Tabelle „Fehlercode → Aktion“ (execution.md §8, NIN-10).</summary>
    private Result Classify(IReadOnlyList<OutboxEntry> run, Guid session, NinaSessionPatch? patch, NinaApiException ex, string? code)
    {
        var status = ex.StatusCode;
        switch (status)
        {
            case 408 or 429 or >= 500:
                return Result.Retry;
            case 401:
                Listener?.Rejected(NinaHeartbeatBlockedReason.Token_invalid);
                return Result.Pause;
            case 403 when code == "tenant.locked":
                Listener?.Rejected(NinaHeartbeatBlockedReason.Tenant_locked);
                return Result.Pause;
            case 409 when code == "engine.incompatible":
                Listener?.Rejected(NinaHeartbeatBlockedReason.Engine_incompatible);
                return Result.Pause;
            case 409 when code == "session.rig_busy" && run[0].Kind == OutboxKinds.Session:
                // Offline angelegte Session, anderes Rig aktiv: mit offline: true erneut senden, nie Dead-Letter (§6).
                return Result.Retry;
            case 409 when patch is not null:
                // 409 auf einen Session-PATCH ist endgültig (Rig belegt, Session abgeschlossen/unbekannt): nicht wiederholen.
                Listener?.SessionPatchRejected(session, patch, code);
                return Result.Sent;
            case 409 when code == "session.unknown" && run[0].Kind != OutboxKinds.Session:
                if (Listener?.SessionCreateFor(session) is { } create)
                {
                    create.Offline = true;
                    store.EnqueueOutboxFront(OutboxKinds.Session, JsonConvert.SerializeObject(create, NinaJson.Settings()), session, create.NightPlanId);
                    return Result.Continue;
                }
                store.OutboxDeadLetter(run, status, code, "Session dem Server unbekannt");
                return Result.Continue;
            case 409 when code == "session.closed":
                store.OutboxDeadLetter(run, status, code, $"Nacht seit {Night(run)} abgeschlossen – erneut hochladen");
                return Result.Continue;
            case 413:
                if (run.Count == 1)
                {
                    store.OutboxDeadLetter(run, status, code, "Meldung zu groß");
                    batchLimit = MaxBatch;
                    return Result.Continue;
                }
                batchLimit = Math.Max(1, run.Count / 2);
                return Result.Continue;
            case 422 when ProblemIndices(ex.Response) is { Count: > 0 } bad:
                var dead = run.Where((_, i) => bad.Contains(i)).ToList();
                store.OutboxDeadLetter(dead.Count > 0 ? dead : run, status, code, "Vom Server beanstandet (422)");
                return Result.Continue;
            default:
                store.OutboxDeadLetter(run, status, code, $"Vom Server abgelehnt ({status} {code})");
                return Result.Continue;
        }
    }

    /// <summary>Indizes der beanstandeten Meldungen aus <c>errors[].path</c> (<c>captures.3.exposureMidUtc</c> → 3).</summary>
    public static HashSet<int> ProblemIndices(string? body)
    {
        var result = new HashSet<int>();
        if (string.IsNullOrWhiteSpace(body)) return result;
        try
        {
            if (JObject.Parse(body)["errors"] is not JArray errors) return result;
            foreach (var e in errors)
            {
                var parts = (e.Value<string>("path") ?? "").Split('.');
                if (parts.Length >= 2 && int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var i)) result.Add(i);
            }
        }
        catch (JsonException)
        {
        }
        return result;
    }

    private static string Night(IReadOnlyList<OutboxEntry> run)
    {
        try
        {
            return JObject.Parse(run[0].Payload).Value<string>("night") ?? "?";
        }
        catch (JsonException)
        {
            return "?";
        }
    }

    /// <summary>Gespeicherter Abschluss (<c>sessionId|endedAtUtc</c>) oder <c>null</c>.</summary>
    public static (Guid Id, DateTimeOffset EndedAtUtc)? CompletedSession(LocalStore store) =>
        ClosedSession(store) is { } c ? (c.Id, c.EndedAtUtc) : null;

    /// <summary>Gemerkter Abschluss mit Status (<c>sessionId|endedAtUtc[|aborted]</c>; ohne Zusatz <c>completed</c>).</summary>
    public static (Guid Id, DateTimeOffset EndedAtUtc, NinaSessionPatchStatus Status)? ClosedSession(LocalStore store)
    {
        var parts = store.GetState(StateKeys.CompletedSession)?.Split('|');
        if (parts is null || parts.Length is < 2 or > 3) return null;
        var status = parts.Length == 3 && parts[2] == "aborted" ? NinaSessionPatchStatus.Aborted : NinaSessionPatchStatus.Completed;
        return Guid.TryParse(parts[0], out var g) && DateTimeOffset.TryParse(parts[1], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var e)
            ? (g, e, status)
            : null;
    }

    /// <summary>
    /// Abschluss (<c>completed</c> bzw. <c>aborted</c>) merken, solange Meldungen offen sind: die Outbox meldet den Stand nach
    /// jedem Leeren nach, bis 0 – auch nach einem Abbruch, sonst liefen Abschluss und Bericht erst nach 6 h (Analyse 04.10.2026).
    /// </summary>
    public static void RememberCompleted(LocalStore store, Guid id, DateTimeOffset endedAtUtc,
        NinaSessionPatchStatus status = NinaSessionPatchStatus.Completed) =>
        store.SetState(StateKeys.CompletedSession,
            $"{id}|{UtcText.Format(endedAtUtc)}{(status == NinaSessionPatchStatus.Aborted ? "|aborted" : "")}");

    private static T Read<T>(string json) => JsonConvert.DeserializeObject<T>(json, NinaJson.Settings())!;
}
