namespace NinaPm.Core.Simulator;

/// <summary>
/// Wann die Fenster im Imaging-Reiter die Simulation der Nacht (<c>GET /simulation</c>) neu abrufen (AP-53b/c, Plugin
/// 0.4.18): nur mit Verbindung und ohne laufenden Abruf; beim ersten Mal, nach einem neuen Plan (einmal je Plan) und sonst
/// höchstens alle <see cref="Interval"/>. Vorher genau einmal je Nacht – der Hinweis „Rig plant noch mit Rev. n“ und das
/// Server-Ist froren ein. Hat der Server die Nacht abgelehnt (<c>422 nina.night_invalid</c>, z. B. die vergangene Nacht ab
/// Mittag Standortzeit), fragt das Plugin für sie nicht mehr (AP-68: Rig-Log 07.10.2026, 33 Abrufe am Nachmittag).
/// </summary>
public static class SimulationRefresh
{
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    /// <param name="lastAttemptUtc">Letzter Abruf (auch gescheitert); <c>null</c> = noch keiner in dieser Nacht.</param>
    /// <param name="fetchedForPlan">Plan, für den zuletzt abgerufen wurde.</param>
    /// <param name="currentPlan">Gespeicherter Plan der Nacht jetzt.</param>
    /// <param name="nightInvalid">Der Server hat diese Nacht abgelehnt (<c>nina.night_invalid</c>).</param>
    public static bool Due(DateTimeOffset? lastAttemptUtc, Guid? fetchedForPlan, Guid? currentPlan, DateTimeOffset now, bool offline, bool running,
        bool nightInvalid = false) =>
        !offline && !running && !nightInvalid
        && (lastAttemptUtc is not { } last || now - last >= Interval || currentPlan is { } plan && plan != fetchedForPlan);
}
