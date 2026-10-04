using NinaPm.Core.Api.Generated;
using NinaPm.Core.Time;

namespace NinaPm.Core.Planning;

/// <summary>Einstellungen der <em>NINA-PM Tagesschleife</em> (FA-NIN-07): Enddatum (letzter Nacht-Schlüssel einschließlich) und Höchstzahl Nächte.</summary>
public sealed record DayLoopSettings(string? EndNight = null, int MaxNights = DayLoopSettings.DefaultMaxNights)
{
    public const int DefaultMaxNights = 14;
}

/// <summary>Entscheidung an der Rundengrenze der Tagesschleife.</summary>
public enum DayLoopDecision
{
    /// <summary>Nächste Runde (Nacht) beginnt.</summary>
    Continue,

    /// <summary>Nächste Nacht liegt nach dem Enddatum.</summary>
    End_date,

    /// <summary>Höchstzahl Nächte erreicht.</summary>
    Max_nights,

    /// <summary>Auslieferungsmenge für die nächste und die zwei folgenden Nächte leer.</summary>
    No_delivery,
}

/// <summary>
/// <em>NINA-PM Tagesschleife</em> als Zustandsmaschine (AP-52, FA-NIN-07, execution.md §1). Muster nach dem Astro-PM-Plugin
/// (MIT), <c>Instructions/AstroPMDailyLoopCondition.cs</c>, Commit 5dd621d: Weiterlaufen, solange es Arbeit gibt; ohne
/// geladene Ziele weiterlaufen (die nächste Nacht lädt sie); das Zurücksetzen auf eine neue Nacht gehört nicht der
/// Bedingung, sondern der Nachtschleife (veraltete Session, NT-01). Abweichend:
/// <list type="bullet">
/// <item>Entscheidung **nur an der Rundengrenze** (Anfang und Ende einer Runde): NINA prüft die Bedingungen aller
/// Vorfahren vor jeder Anweisung (<c>SequentialStrategy.CanContinue</c>) – eine mitten in der Nacht falsche Tagesschleife
/// bräche die Nacht ab und übersprünge das Parken.</item>
/// <item>„Arbeit“ = Auslieferungsmenge des Rigs für mindestens eine der nächsten 3 Nächte (<c>targets.deliveryNights</c>),
/// dazu Enddatum (Nacht-Schlüssel einschließlich, Standortzeit) und Höchstzahl Nächte (Standard 14).</item>
/// </list>
/// </summary>
public sealed class DayLoopState
{
    private readonly HashSet<string> nights = [];

    /// <summary>Nächte, die in dieser Ausführung der Sequenz beendet wurden (Höchstzahl Nächte).</summary>
    public IReadOnlyCollection<string> Nights => nights;

    /// <summary>Letzte Entscheidung (für Log und Anzeige).</summary>
    public DayLoopDecision? Last { get; private set; }

    /// <summary>Zuletzt gemeldetes Ende (Nacht, Grund) – Ende der Runde und der nächste Prüfpunkt melden es nur einmal.</summary>
    public (string Night, DayLoopDecision Decision)? LoggedEnd { get; set; }

    /// <summary>Zuletzt gemeldeter Rundenbeginn (nächste Nacht).</summary>
    public string? LoggedStart { get; set; }

    /// <summary>Sequenzstart: Zählung neu.</summary>
    public void Reset()
    {
        nights.Clear();
        Last = null;
        LoggedEnd = null;
        LoggedStart = null;
    }

    /// <summary>
    /// Rundengrenze: soll die Runde für <paramref name="nextNight"/> laufen? <paramref name="finishedNight"/> = gerade
    /// beendete Nacht der Nachtschleife (zählt für die Höchstzahl; der Bootstrap muss dafür nicht geladen sein).
    /// </summary>
    public DayLoopDecision Evaluate(DayLoopSettings settings, string nextNight, IReadOnlyList<DeliveryNights>? delivery,
        string? finishedNight = null)
    {
        if (finishedNight is not null) nights.Add(finishedNight);
        var decision = Decide(settings, nextNight, delivery);
        Last = decision;
        return decision;
    }

    /// <summary>Ohne Nacht-Tabelle: beendete Nacht zählen und nur die Höchstzahl prüfen (sonst weiterlaufen).</summary>
    public DayLoopDecision EvaluateWithoutTable(DayLoopSettings settings, string? finishedNight)
    {
        if (finishedNight is not null) nights.Add(finishedNight);
        Last = nights.Count >= Math.Max(1, settings.MaxNights) ? DayLoopDecision.Max_nights : DayLoopDecision.Continue;
        return Last.Value;
    }

    private DayLoopDecision Decide(DayLoopSettings settings, string nextNight, IReadOnlyList<DeliveryNights>? delivery)
    {
        // Nacht-Schlüssel YYYY-MM-DD: ordinaler Vergleich = zeitlicher.
        if (settings.EndNight is { } end && string.CompareOrdinal(nextNight, end) > 0) return DayLoopDecision.End_date;
        if (!nights.Contains(nextNight) && nights.Count >= Math.Max(1, settings.MaxNights)) return DayLoopDecision.Max_nights;
        return HasDelivery(nextNight, delivery) ? DayLoopDecision.Continue : DayLoopDecision.No_delivery;
    }

    /// <summary>
    /// Auslieferung ab <paramref name="nextNight"/> in einer der gemeldeten Nächte; ohne Angabe bzw. ohne Nacht ab
    /// <paramref name="nextNight"/> (Ziele noch von gestern) „unbekannt“ → weiterlaufen.
    /// </summary>
    public static bool HasDelivery(string nextNight, IReadOnlyList<DeliveryNights>? delivery)
    {
        if (delivery is null) return true;
        var ahead = delivery.Where(d => string.CompareOrdinal(d.Night, nextNight) >= 0).ToList();
        return ahead.Count == 0 || ahead.Any(d => d.Projects > 0);
    }

    /// <summary>Nächste auszuführende Nacht: <c>currentNight</c>, nach deren Ende die folgende (wie <see cref="WaitForTime.TargetRow"/>).</summary>
    public static string NextNight(IReadOnlyList<NightRow> nights, DateTimeOffset now, string? finishedNight) =>
        WaitForTime.TargetRow(nights, now, finishedNight).Night;
}
