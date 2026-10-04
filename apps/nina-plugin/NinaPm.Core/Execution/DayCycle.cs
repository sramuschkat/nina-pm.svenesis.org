using NinaPm.Core.Api.Generated;
using NinaPm.Core.Logging;
using NinaPm.Core.Planning;
using NinaPm.Core.Time;

namespace NinaPm.Core.Execution;

/// <summary>
/// Abläufe von <em>NINA-PM Tagesschleife</em> und <em>NINA-PM Warten auf Zeit</em> (AP-52, FA-NIN-07, FA-NIN-26) über dem
/// <see cref="NightRunner"/> – vom Adapter und vom kopflosen Nachtlauf (<c>NinaPm.Sim</c>) gleich genutzt.
/// </summary>
public static class DayCycle
{
    /// <summary>Takt der Warte-Anweisung (abbrechbar, Fortschritt); das letzte Stück wird exakt gewartet.</summary>
    public static readonly TimeSpan WaitTick = TimeSpan.FromSeconds(10);

    /// <summary>Ohne Nacht-Tabelle (nie verbunden) erneut versuchen – nicht entparken, solange die Nacht unbekannt ist (H3).</summary>
    public static readonly TimeSpan NoTableRetry = TimeSpan.FromSeconds(60);

    /// <summary>
    /// Ältere Lieferangaben (<c>deliveryNights</c> im Ziel-Cache) gelten als unbekannt – die Schleife läuft dann weiter, statt
    /// mit „keine Ziele“ zu enden: Eine Freigabe tagsüber sieht der Cache von gestern nicht (Analyse 04.10.2026). Am Morgen
    /// frischt der Nachtabschluss die Ziele auf, die Entscheidung am Rundenende ist also aktuell.
    /// </summary>
    public static readonly TimeSpan DeliveryMaxAge = TimeSpan.FromHours(6);

    /// <summary>
    /// Rundengrenze der Tagesschleife (Anfang <paramref name="starting"/> bzw. Ende einer Runde): Entscheidung für die
    /// nächste Nacht; beginnt eine Runde, fordert sie bei beendeter Nacht die nächste an (Nachtschleife wieder wahr).
    /// Ohne Nacht-Tabelle weiterlaufen – die Runde wartet dann in <em>Warten auf Zeit</em>.
    /// </summary>
    public static DayLoopDecision Boundary(NightRunner runner, DayLoopState state, DayLoopSettings settings, DateTimeOffset now,
        bool starting, NinaPmLog log)
    {
        var finished = runner.Loop.FinishedNight;
        string? next = null;
        if (runner.Bootstrap is { } b)
        {
            try
            {
                next = DayLoopState.NextNight(NightCalendar.FromBootstrap(b), now, finished);
            }
            catch (NightTableException)
            {
                next = null;
            }
        }
        // Ohne Nacht-Tabelle nur die Höchstzahl; Warten auf Zeit wartet dann, bis die Tabelle geladen ist.
        var decision = next is null
            ? state.EvaluateWithoutTable(settings, finished)
            : state.Evaluate(settings, next, FreshDeliveryNights(runner, now), finished);
        if (decision != DayLoopDecision.Continue)
        {
            if (state.LoggedEnd != (next ?? "", decision))
                log.Event("DAYLOOP_END", ("reason", decision.ToString().ToLowerInvariant()), ("night", next), ("nights", state.Nights.Count));
            state.LoggedEnd = (next ?? "", decision);
            return decision;
        }
        if (starting)
        {
            runner.Loop.RequestNextNight();
            // Je Runde einmal; vor dem ersten Bootstrap (Sequenzstart) ohne Nacht – Warten auf Zeit lädt ihn.
            var key = next ?? $"?{state.Nights.Count}";
            if (state.LoggedStart != key)
            {
                if (next is null) log.Event("DAYLOOP", ("nights", state.Nights.Count));
                else log.Event("DAYLOOP", ("night", next), ("nights", state.Nights.Count));
            }
            state.LoggedStart = key;
        }
        return decision;
    }

    private static List<DeliveryNights>? FreshDeliveryNights(NightRunner runner, DateTimeOffset now) =>
        runner.TargetsFetchedUtc is { } fetched && now - fetched <= DeliveryMaxAge ? runner.Targets?.DeliveryNights : null;

    /// <summary>
    /// <em>Warten auf Zeit</em>: Bootstrap und Ziele auffrischen, Zielzeit für die nächste Nacht bestimmen (Standortzeit,
    /// L2, Dämmerung vom Server) und bis dahin warten. Fehlt die Dämmerung in der Nacht (Polartag), kein Warten.
    /// </summary>
    public static async Task<WaitTarget?> WaitAsync(NightRunner runner, WaitForTimeSpec spec, IClock clock, NinaPmLog log,
        Func<DateTimeOffset, CancellationToken, Task> delayUntil, Action<WaitTarget, TimeSpan>? progress, CancellationToken token)
    {
        while (true)
        {
            await runner.RefreshAsync(token).ConfigureAwait(false);
            if (Target(runner, spec, clock.UtcNow) is { } target)
                return await WaitUntilAsync(target, spec, clock, log, delayUntil, progress, token).ConfigureAwait(false);
            log.Warning("WAIT_TIME", ("status", "unavailable"), ("reason", "no_night_table"));
            await delayUntil(clock.UtcNow + NoTableRetry, token).ConfigureAwait(false);
        }
    }

    /// <summary>Zielzeit aus dem geladenen Bootstrap (Anzeige in der Anweisung); <c>null</c> ohne verwendbare Nacht-Tabelle.</summary>
    public static WaitTarget? Target(NightRunner runner, WaitForTimeSpec spec, DateTimeOffset now)
    {
        if (runner.Bootstrap is not { } b) return null;
        try
        {
            return WaitForTime.Target(spec, NightCalendar.FromBootstrap(b), SiteClock.From(b), now, runner.Loop.FinishedNight);
        }
        catch (NightTableException)
        {
            return null;
        }
    }

    private static async Task<WaitTarget> WaitUntilAsync(WaitTarget target, WaitForTimeSpec spec, IClock clock, NinaPmLog log,
        Func<DateTimeOffset, CancellationToken, Task> delayUntil, Action<WaitTarget, TimeSpan>? progress, CancellationToken token)
    {
        var source = spec.Source.ToString().ToLowerInvariant();
        if (target.UntilUtc is not { } until)
        {
            log.Event("WAIT_TIME", ("status", "skipped"), ("reason", "no_twilight"), ("source", source), ("night", target.Night));
            return target;
        }
        log.Event("WAIT_TIME", ("source", source), ("night", target.Night), ("untilUtc", until));
        while (WaitForTime.Remaining(target, clock.UtcNow) is var left && left > TimeSpan.Zero)
        {
            token.ThrowIfCancellationRequested();
            progress?.Invoke(target, left);
            await delayUntil(left > WaitTick ? clock.UtcNow + WaitTick : until, token).ConfigureAwait(false);
        }
        log.Event("WAIT_TIME_END", ("night", target.Night), ("atUtc", clock.UtcNow));
        return target;
    }
}
