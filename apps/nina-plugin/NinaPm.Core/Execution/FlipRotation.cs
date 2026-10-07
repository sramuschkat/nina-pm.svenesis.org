namespace NinaPm.Core.Execution;

/// <summary>
/// Rotation modulo 180° (flip-rotation.md §3, NT-E4): PA und PA + 180° ergeben dasselbe Bildfeld. Winkel werden vor
/// dem Vergleich auf 1e-6 gerundet; Normalisierung nach dem Runden (NT-31).
/// </summary>
public static class Rotation
{
    public static double Round6(double x) => Math.Round(x, 6, MidpointRounding.AwayFromZero);

    /// <summary><c>0 ≤ x &lt; 360</c> nach dem Runden: <c>x ≥ 360 → x − 360</c>, <c>−0 → 0</c> (NT-31).</summary>
    public static double Normalize(double deg)
    {
        var r = Round6(((deg % 360) + 360) % 360);
        if (r >= 360) r -= 360;
        return r == 0 ? 0 : r;
    }

    /// <summary><c>r = |ist − soll| mod 180; Δ = min(r, 180 − r)</c>.</summary>
    public static double Delta180(double actualDeg, double targetDeg)
    {
        var r = Math.Abs(Round6(actualDeg) - Round6(targetDeg)) % 180;
        return Round6(Math.Min(r, 180 - r));
    }

    public static bool WithinTolerance(double actualDeg, double targetDeg, double toleranceDeg) =>
        Delta180(actualDeg, targetDeg) <= toleranceDeg;
}

/// <summary>Ergebnis der Flip-Erkennung (execution.md §4.5, NIN5-1).</summary>
public enum FlipDetection
{
    /// <summary>Pier-Seite gewechselt, bzw. ohne Pier-Seite PA-Sprung ≈ 180° und lange genug.</summary>
    Flipped,

    /// <summary>Pier-Seite bekannt und unverändert.</summary>
    NotFlipped,

    /// <summary>Pier-Seite unbekannt und kein eindeutiger PA-Sprung: <c>flip_undetected</c>, Plan-Flip bleibt offen.</summary>
    Undetected,
}

/// <summary>Einstellungen des Rigs für den Flip (bootstrap <c>rig.scheduler.meridianFlip</c>).</summary>
public sealed record FlipSettings(double AfterMin, double MaxAfterMin, double PauseBeforeMin, double DurationS);

/// <summary>Flip-Regeln des Plugins (flip-rotation.md §2, execution.md §4.5).</summary>
public static class FlipRules
{
    /// <summary>Meridiandurchgang <c>tM</c> aus der geplanten Flipzeit <c>plannedUtc = tM + afterMin</c>.</summary>
    public static DateTimeOffset MeridianUtc(DateTimeOffset plannedUtc, FlipSettings s) => plannedUtc.AddMinutes(-s.AfterMin);

    /// <summary><c>limitEnd = pauseBefore &gt; 0 ? tM − pauseBefore : tM + maxAfter</c>.</summary>
    public static DateTimeOffset LimitEnd(DateTimeOffset plannedUtc, FlipSettings s)
    {
        var tM = MeridianUtc(plannedUtc, s);
        return s.PauseBeforeMin > 0 ? tM.AddMinutes(-s.PauseBeforeMin) : tM.AddMinutes(s.MaxAfterMin);
    }

    /// <summary>
    /// Pier-Seite vor/nach dem Trigger-Aufruf; ist eine unbekannt (<c>null</c>), zählt nur ein PA-Sprung
    /// <c>|Δ| mod 360 ∈ [150°, 210°]</c> mit Triggerlaufzeit ≥ 0,5 × Flipdauer (NIN5-1). Stundenwinkel allein nie.
    /// </summary>
    public static FlipDetection Detect(string? pierBefore, string? pierAfter, double? paBefore, double? paAfter,
        double triggerS, double flipDurationS)
    {
        if (pierBefore is not null && pierAfter is not null)
            return pierBefore == pierAfter ? FlipDetection.NotFlipped : FlipDetection.Flipped;
        if (paBefore is { } a && paAfter is { } b)
        {
            var d = Math.Abs(b - a) % 360;
            if (d is >= 150 and <= 210 && triggerS >= 0.5 * flipDurationS) return FlipDetection.Flipped;
        }
        return FlipDetection.Undetected;
    }

    /// <summary>NINAs früheste Flipzeit ab <paramref name="now"/> (<c>minutesToEarliestFlip</c> ≤ 0 = jetzt); unbekannt = <c>null</c>.</summary>
    public static DateTimeOffset? EarliestUtc(DateTimeOffset now, double? minutesToEarliestFlip) =>
        minutesToEarliestFlip is { } m ? now.AddSeconds(Math.Max(0, Math.Round(m * 60))) : null;

    /// <summary>
    /// Eigentlicher Flip (AP-65, <c>data.flipActionS</c>): gemeldete Dauer ab <paramref name="triggerStart"/> abzüglich
    /// NINAs Warten bis zur frühesten Flipzeit; unbekannte Flipzeit → <c>null</c>. Autofokus nach dem Flip bleibt darin
    /// (der Server zieht die <c>af</c>-Läufe ab).
    /// </summary>
    public static double? ActionS(double durationS, DateTimeOffset triggerStart, DateTimeOffset? earliestFlipUtc)
    {
        if (earliestFlipUtc is not { } e) return null;
        var waitS = Math.Max(0, (e - triggerStart).TotalSeconds);
        return Math.Max(0, Math.Round(durationS - waitS));
    }

    /// <summary>Gemeldete Dauer <c>now − max(tTriggerStart, tM + afterMin)</c> (NT-21), nie negativ.</summary>
    public static double DurationS(DateTimeOffset now, DateTimeOffset triggerStart, DateTimeOffset plannedUtc)
    {
        var from = triggerStart > plannedUtc ? triggerStart : plannedUtc;
        return Math.Max(0, Math.Round((now - from).TotalSeconds));
    }
}
