using NinaPm.Core.Time;

namespace NinaPm.Core.Execution;

/// <summary>
/// Ein abgeschlossener Autofokus-Lauf (execution.md §10.2, AP-65): Beginn und Ende, verwendeter Filter (falls bekannt),
/// Ergebnis und der Block, der beim Beginn lief (außerhalb eines Blocks <c>null</c>).
/// </summary>
public sealed record AutofocusRun(DateTimeOffset StartUtc, DateTimeOffset EndUtc, string? Filter, bool Ok, Guid? BlockId, Guid? ProjectId,
    double? Position = null, double? TemperatureC = null)
{
    /// <summary>Dauer vom Beginn bis zum Ende in ganzen Sekunden (wie beim Flip), nie negativ.</summary>
    public double DurationS => Math.Max(0, Math.Round((EndUtc - StartUtc).TotalSeconds));
}

/// <summary>
/// Autofokus-Läufe erkennen (AP-65, Plugin 0.4.19), plattformneutral: NINA meldet den Beginn jedes Laufs
/// (<see cref="Starting"/>), jeden Messpunkt (<see cref="Point"/>) und nur den <em>erfolgreichen</em> Abschluss
/// (<see cref="Completed"/>); ein gescheiterter oder abgebrochener Lauf meldet kein Ende. Er wird deshalb an Stellen
/// geschlossen, an denen der Autofokus sicher vorbei ist (<see cref="Settle"/>): nach jedem Trigger im eigenen Walk, vor
/// der eigenen Belichtung und am Blockende. Ein neuer Beginn schließt einen noch offenen Lauf ebenfalls als gescheitert.
/// Der Block beim Beginn zählt, auch wenn der Lauf erst nach dem Blockende abgeschlossen wird. Thread-sicher: NINA meldet
/// aus dem Autofokus-Thread, der Walk aus der Sequenz.
/// </summary>
public sealed class AutofocusTracker(IClock clock, Func<(Guid BlockId, Guid ProjectId)?> runningBlock, Action<AutofocusRun> report)
{
    private readonly object gate = new();
    private Open? open;

    private sealed record Open(DateTimeOffset StartUtc, string? Filter, Guid? BlockId, Guid? ProjectId)
    {
        public DateTimeOffset? LastActivityUtc { get; set; }
    }

    /// <summary>Ein Lauf ist offen (begonnen, noch nicht abgeschlossen).</summary>
    public bool Running
    {
        get
        {
            lock (gate) return open is not null;
        }
    }

    /// <summary>Autofokus beginnt (NINA <c>AutoFocusRunStarting</c>); ein noch offener Lauf endet vorher als gescheitert.</summary>
    public void Starting(string? filter)
    {
        AutofocusRun? previous;
        lock (gate)
        {
            previous = CloseFailed(exact: false);
            var block = runningBlock();
            open = new Open(clock.UtcNow, Blank(filter), block?.BlockId, block?.ProjectId);
        }
        if (previous is not null) report(previous);
    }

    /// <summary>Messpunkt des laufenden Autofokus (NINA <c>NewAutoFocusPoint</c>): letzte Tätigkeit für ein gescheitertes Ende.</summary>
    public void Point()
    {
        lock (gate)
        {
            if (open is not null) open.LastActivityUtc = clock.UtcNow;
        }
    }

    /// <summary>
    /// Autofokus erfolgreich (NINA <c>UpdateEndAutoFocusRun</c>): Ende = jetzt; Filter aus der Meldung, sonst der beim Beginn.
    /// Ohne offenen Lauf (Beginn nicht gesehen, z. B. Laufzeit erst währenddessen aufgebaut) keine Meldung – die Dauer ist unbekannt.
    /// Seit AP-70 mit Endposition und Temperatur des Fokussierers aus NINAs Bericht (für Filter-Offsets); nicht endlich → weg.
    /// </summary>
    public void Completed(string? filter, double? position = null, double? temperatureC = null)
    {
        AutofocusRun? run = null;
        lock (gate)
        {
            if (open is { } o)
            {
                run = new AutofocusRun(o.StartUtc, clock.UtcNow, Blank(filter) ?? o.Filter, true, o.BlockId, o.ProjectId,
                    Finite(position), Finite(temperatureC));
                open = null;
            }
        }
        if (run is not null) report(run);
    }

    /// <summary>
    /// Der Autofokus ist sicher vorbei: ein offener Lauf ist gescheitert. Ende = jetzt mit <paramref name="exact"/> (direkt
    /// nach einem Autofokus-Trigger), sonst die letzte Tätigkeit (letzter Messpunkt, ohne Messpunkt der Beginn).
    /// </summary>
    public void Settle(bool exact)
    {
        AutofocusRun? run;
        lock (gate) run = CloseFailed(exact);
        if (run is not null) report(run);
    }

    private static double? Finite(double? v) => v is { } x && double.IsFinite(x) ? x : null;

    private AutofocusRun? CloseFailed(bool exact)
    {
        if (open is not { } o) return null;
        open = null;
        var end = exact ? clock.UtcNow : o.LastActivityUtc ?? o.StartUtc;
        return new AutofocusRun(o.StartUtc, end, o.Filter, false, o.BlockId, o.ProjectId);
    }

    private static string? Blank(string? filter) => string.IsNullOrWhiteSpace(filter) ? null : filter;
}
