using Newtonsoft.Json;
using NinaPm.Core.Api;
using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Time;

namespace NinaPm.Core.Planning;

/// <summary>Die Aufrufe der NINA-API, die die Planung braucht (für Tests austauschbar).</summary>
public interface IPlanApi
{
    Task<NinaBootstrap> BootstrapAsync(CancellationToken token);

    Task<NinaPlanResponse> PlanAsync(NinaPlanRequest request, CancellationToken token);

    /// <summary><c>GET /targets</c> mit <c>If-None-Match</c>; <c>null</c> bei <c>304</c> (unverändert).</summary>
    Task<(NinaTargets? Targets, string? Etag)> TargetsAsync(string? etag, CancellationToken token);
}

/// <summary><see cref="IPlanApi"/> über den generierten Client.</summary>
public sealed class NinaPlanApi(NinaApiClient client) : IPlanApi
{
    public Task<NinaBootstrap> BootstrapAsync(CancellationToken token) => client.ApiNinaV1BootstrapAsync(token);

    public Task<NinaPlanResponse> PlanAsync(NinaPlanRequest request, CancellationToken token) => client.ApiNinaV1PlanAsync(request, token);

    public async Task<(NinaTargets? Targets, string? Etag)> TargetsAsync(string? etag, CancellationToken token)
    {
        try
        {
            var targets = await client.ApiNinaV1TargetsAsync(etag, token).ConfigureAwait(false);
            return (targets, NinaApi.OpaqueEtag(client.LastEtag ?? etag));
        }
        catch (NinaApiException ex) when (ex.StatusCode == 304)
        {
            return (null, NinaApi.OpaqueEtag(etag));
        }
    }
}

/// <summary>Eingaben je Planaufbau (execution.md §3.1/§3.2).</summary>
public sealed record PlanRequestInput(
    NinaPlanRequestReason Reason,
    DateTimeOffset? StartAtUtc,
    Guid? SessionId,
    string? TargetsEtag,
    Tonight? Tonight,
    IReadOnlyList<PendingCaptures> PendingCaptures);

/// <summary>
/// Ergebnis eines Planaufbaus. <see cref="Blocked"/> gesetzt → kein Plan (<c>blockedReasons</c>, execution.md §2);
/// <see cref="Unreachable"/> → Server nicht erreichbar, der Aufrufer plant offline (§6, NT-14).
/// <see cref="Bootstrap"/> ist der zuletzt geladene (nach <c>night_invalid</c> der neue).
/// </summary>
public sealed record PlanOutcome(NinaPlanResponse? Plan, string? Night, NinaBootstrap Bootstrap, NinaHeartbeatBlockedReason? Blocked, bool Unreachable)
{
    public bool Ok => Plan is not null;
}

/// <summary>
/// Planaufbau online (execution.md §3.1, §8, TK 10.3 Nr. 2): <c>night = currentNight(site, now)</c> aus der
/// Nacht-Tabelle des Bootstraps (NT-01) → <c>POST /plan</c>. Fehlerbehandlung nach der Tabelle in §8:
/// <c>422 nina.night_invalid</c> bzw. eine zu kurze Tabelle → Bootstrap neu laden, Nacht neu bestimmen, **einmal**
/// wiederholen, sonst <c>plan_failed</c>; <c>401</c> → <c>token_invalid</c>; <c>403 tenant.locked</c>;
/// <c>409 engine.incompatible</c>; Netzfehler/5xx/Timeout → offline weiter.
/// </summary>
public sealed class PlanService(IPlanApi api, IClock clock, NinaPmLog log)
{
    public async Task<PlanOutcome> RequestAsync(NinaBootstrap bootstrap, PlanRequestInput input, CancellationToken token)
    {
        for (var attempt = 1; ; attempt++)
        {
            string night;
            try
            {
                night = NightCalendar.CurrentNight(NightCalendar.FromBootstrap(bootstrap), clock.UtcNow);
            }
            catch (NightTableException)
            {
                log.Warning("PLAN", ("reason", Reason(input.Reason)), ("code", "engine.input_invalid"));
                if (attempt > 1) return new PlanOutcome(null, null, bootstrap, NinaHeartbeatBlockedReason.Plan_failed, false);
                var reloaded = await ReloadAsync(token).ConfigureAwait(false);
                if (reloaded is null) return new PlanOutcome(null, null, bootstrap, null, true);
                bootstrap = reloaded;
                continue;
            }

            try
            {
                var plan = await api.PlanAsync(Build(night, input), token).ConfigureAwait(false);
                log.Event("API", ("status", 200), ("call", "plan"));
                log.Event("PLAN",
                    ("reason", Reason(input.Reason)), ("plan", plan.NightPlanId), ("source", "server"), ("night", plan.Night));
                return new PlanOutcome(plan, night, bootstrap, null, false);
            }
            catch (NinaApiException ex)
            {
                var code = NinaApi.ProblemCode(ex.Response);
                log.Warning("API", ("status", ex.StatusCode), ("code", code), ("call", "plan"));
                switch (ex.StatusCode, code)
                {
                    case (422, "nina.night_invalid") when attempt == 1:
                        var reloaded = await ReloadAsync(token).ConfigureAwait(false);
                        if (reloaded is null) return new PlanOutcome(null, night, bootstrap, null, true);
                        bootstrap = reloaded;
                        continue;
                    case (401, _):
                        return new PlanOutcome(null, night, bootstrap, NinaHeartbeatBlockedReason.Token_invalid, false);
                    case (403, "tenant.locked"):
                        return new PlanOutcome(null, night, bootstrap, NinaHeartbeatBlockedReason.Tenant_locked, false);
                    case (409, "engine.incompatible"):
                        return new PlanOutcome(null, night, bootstrap, NinaHeartbeatBlockedReason.Engine_incompatible, false);
                    case (408 or 429 or >= 500, _):
                        return new PlanOutcome(null, night, bootstrap, null, true);
                    default:
                        return new PlanOutcome(null, night, bootstrap, NinaHeartbeatBlockedReason.Plan_failed, false);
                }
            }
            catch (Exception ex) when (IsNetwork(ex, token))
            {
                log.Warning("API", ("status", 0), ("code", ex is TaskCanceledException ? "timeout" : "network"), ("call", "plan"));
                return new PlanOutcome(null, night, bootstrap, null, true);
            }
        }
    }

    /// <summary>Anfrage <c>POST /plan</c>; <c>tonight</c> nur, wenn vorhanden (Erstplan: nur <c>lastAutofocusUtc</c>).</summary>
    public static NinaPlanRequest Build(string night, PlanRequestInput input) => new()
    {
        Night = night,
        Reason = input.Reason,
        StartAtUtc = input.StartAtUtc,
        SessionId = input.SessionId,
        TargetsEtag = input.TargetsEtag,
        PendingCaptures = [.. input.PendingCaptures],
        Tonight = input.Tonight,
    };

    private async Task<NinaBootstrap?> ReloadAsync(CancellationToken token)
    {
        try
        {
            var b = await api.BootstrapAsync(token).ConfigureAwait(false);
            log.Event("API", ("status", 200), ("call", "bootstrap"));
            return b;
        }
        catch (NinaApiException ex)
        {
            log.Warning("API", ("status", ex.StatusCode), ("code", NinaApi.ProblemCode(ex.Response)), ("call", "bootstrap"));
            return null;
        }
        catch (Exception ex) when (IsNetwork(ex, token))
        {
            log.Warning("API", ("status", 0), ("code", ex is TaskCanceledException ? "timeout" : "network"), ("call", "bootstrap"));
            return null;
        }
    }

    private static bool IsNetwork(Exception ex, CancellationToken token) =>
        ex is HttpRequestException || (ex is TaskCanceledException && !token.IsCancellationRequested);

    private static string Reason(NinaPlanRequestReason r) => r switch
    {
        NinaPlanRequestReason.Initial => "initial",
        NinaPlanRequestReason.Refresh => "refresh",
        NinaPlanRequestReason.Resume => "resume",
        _ => "reset",
    };

    // ---- pendingCaptures (NT-20) ------------------------------------------------------------------------

    /// <summary>Höchstwerte aus dem Vertrag (<c>NinaPlanRequest.pendingCaptures</c>): 500 Gruppen à 500 IDs.</summary>
    public const int MaxPendingGroups = 500;
    public const int MaxPendingIdsPerGroup = 500;

    /// <summary>
    /// <c>pendingCaptures</c> aus der Outbox (execution.md §3.1, NT-20): alle gespeicherten Light-Aufnahmen
    /// (<c>result: saved</c>), deren Meldung noch nicht mit 2xx quittiert ist, gruppiert nach Zeile und
    /// Transit-Beobachtung. Dead-Letter liegt in einer eigenen Tabelle und zählt nicht.
    /// </summary>
    public static List<PendingCaptures> PendingFromOutbox(IEnumerable<string> capturePayloads)
    {
        var groups = new List<PendingCaptures>();
        foreach (var json in capturePayloads)
        {
            var c = JsonConvert.DeserializeObject<Captures>(json, NinaJson.Settings());
            if (c is not { FrameType: CapturesFrameType.Light, Result: CapturesResult.Saved, ExposureLineId: { } lineId }) continue;
            var g = groups.FirstOrDefault(x => x.ExposureLineId == lineId && x.TransitObservationId == c.TransitObservationId);
            if (g is null)
            {
                if (groups.Count == MaxPendingGroups) continue;
                g = new PendingCaptures { ExposureLineId = lineId, TransitObservationId = c.TransitObservationId };
                groups.Add(g);
            }
            if (g.CaptureIds.Count < MaxPendingIdsPerGroup && !g.CaptureIds.Contains(c.Id)) g.CaptureIds.Add(c.Id);
        }
        return groups;
    }
}
