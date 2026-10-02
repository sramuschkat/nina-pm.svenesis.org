namespace NinaPm.Core.Execution;

/// <summary>Woher ein abgebrochener Token kommt (execution.md §4.6, NT-15, NT-16).</summary>
public enum CancelKind
{
    /// <summary>Eigener Abbruch (Transit, Neuplanung) über eine eigene <c>CancellationTokenSource</c> (§2).</summary>
    Own,

    /// <summary>NINA unterbricht: ein Vorfahr trägt <c>SafetyMonitorCondition</c> und der Monitor ist nicht verbunden und sicher.</summary>
    Interrupt,

    /// <summary>Sonst: der Benutzer hat die Sequenz gestoppt.</summary>
    UserAbort,
}

/// <summary>Lage des Safety-Monitors und der Sequenz beim Abbruch (vom Adapter gelesen).</summary>
public sealed record SafetyState(bool AncestorHasSafetyCondition, bool MonitorConnected, bool MonitorSafe);

/// <summary>Ergebnis eines Takts von <em>NINA-PM Warten bis sicher oder Nachtende</em> (H2, execution.md §4.6).</summary>
public enum SafetyWaitResult
{
    /// <summary>Weiter warten (10-s-Takt, Heartbeat <c>paused</c>).</summary>
    Wait,

    /// <summary>Sicher vor dem Nachtende: Anweisung endet sofort, der normale Weg gilt (Wiederaufnahme bzw. Nachtende mit Flats).</summary>
    Safe,

    /// <summary>
    /// Nachtende erreicht und weiterhin unsicher: Nacht ohne Wiederaufnahme abschließen – ausstehende Flats
    /// <c>skipped</c>, <c>PATCH completed</c>, <c>nightFinished</c>; <em>Unpark</em> entfällt, Ende-Bereich folgt.
    /// </summary>
    CloseNight,

}

public static class Interruption
{
    /// <summary>
    /// Unterbrechung vs. Benutzerabbruch (§4.6): beide kommen als abgebrochener Token an. Unterbrechung = Vorfahr mit
    /// <c>SafetyMonitorCondition</c> **und** Monitor nicht <c>Connected &amp;&amp; IsSafe</c>; eigene Abbrüche zuerst.
    /// </summary>
    public static CancelKind Classify(bool ownCancel, SafetyState safety)
    {
        if (ownCancel) return CancelKind.Own;
        return safety.AncestorHasSafetyCondition && !(safety.MonitorConnected && safety.MonitorSafe)
            ? CancelKind.Interrupt
            : CancelKind.UserAbort;
    }

    /// <summary>
    /// Ein Takt von <em>Warten bis sicher oder Nachtende</em> (H2): Nachtende = <c>darknessEndUtc ?? sessionEndUtc</c>
    /// des gespeicherten Plans, ohne Plan <c>nightWindowEndUtc</c> der aktuellen Nacht. Sicher (verbunden und sicher)
    /// hat Vorrang vor dem Nachtende (dann gilt der normale Weg mit Flats, §2). Ein **getrennter** Monitor zählt wie
    /// unsicher: NINAs <em>Loop While Unsafe</em> hält ihn ebenfalls für unsicher – kehrte die Anweisung sofort zurück,
    /// parkte und entparkte NINA im Takt (P-25-Lauf 02.10.2026: 13 × Park in 2,5 min).
    /// </summary>
    public static SafetyWaitResult SafetyWaitStep(DateTimeOffset now, DateTimeOffset nightEndUtc, bool monitorConnected, bool monitorSafe)
    {
        if (monitorConnected && monitorSafe) return SafetyWaitResult.Safe;
        return now >= nightEndUtc ? SafetyWaitResult.CloseNight : SafetyWaitResult.Wait;
    }
}
