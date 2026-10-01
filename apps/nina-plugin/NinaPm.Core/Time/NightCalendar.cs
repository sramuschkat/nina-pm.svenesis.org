using NinaPm.Core.Api.Generated;

namespace NinaPm.Core.Time;

/// <summary>Zeile der Nacht-Tabelle aus <c>bootstrap.nights[]</c> (night.md §1, NT-02).</summary>
public sealed record NightRow(string Night, DateTimeOffset NoonStartUtc, DateTimeOffset NoonEndUtc, DateTimeOffset NightWindowEndUtc);

/// <summary>Nacht-Tabelle zu kurz oder leer (<c>engine.input_invalid</c>, night.md §1.1): Bootstrap nachladen.</summary>
public sealed class NightTableException(string message) : Exception(message)
{
    public string Code => "engine.input_invalid";
}

/// <summary>
/// Aktuelle Nacht <c>currentNight(site, now)</c> (NT-01, night.md §1.1, execution.md §2) – zweite Fassung neben
/// <c>packages/shared/src/night.ts</c>, geprüft mit denselben Testvektoren
/// (<c>packages/shared/contracts/test-vectors/current-night.json</c>). Rechnet nur über die Tabelle des Servers,
/// nie über die Windows-Uhr oder eine eigene Dämmerungssuche (H1).
/// </summary>
public static class NightCalendar
{
    /// <summary>Weniger künftige Nächte als diese → Bootstrap nachladen (night.md §1 „Horizont“, AST-N10).</summary>
    public const int MinFutureNights = 14;

    /// <summary>Rückfall ohne Tabelle: Session veraltet ab <c>sessionEndUtc + 2 h</c> (execution.md §2, NIN5-4).</summary>
    public static readonly TimeSpan StaleAfterSessionEnd = TimeSpan.FromHours(2);

    public static IReadOnlyList<NightRow> FromBootstrap(NinaBootstrap bootstrap) =>
        bootstrap.Nights.Select(n => new NightRow(n.Night, n.NoonStartUtc, n.NoonEndUtc, n.NightWindowEndUtc)).ToList();

    public static NightRow CurrentRow(IReadOnlyList<NightRow> nights, DateTimeOffset now)
    {
        if (nights.Count == 0) throw new NightTableException("Nacht-Tabelle ist leer");
        var index = -1;
        for (var i = 0; i < nights.Count; i++)
            if (nights[i].NoonStartUtc <= now && now < nights[i].NoonEndUtc)
            {
                index = i;
                break;
            }
        // Tabelle beginnt nach der Mittagsnacht (z. B. Web mit from = morgen): dann gilt nights[0] (H1).
        if (index < 0 && now < nights[0].NoonStartUtc) index = 0;
        if (index < 0) throw new NightTableException("now liegt hinter dem Ende der Nacht-Tabelle");
        if (nights[index].NightWindowEndUtc > now) return nights[index];
        // Morgen nach Nachtfensterende: die kommende Nacht ist „heute“.
        if (index + 1 >= nights.Count) throw new NightTableException("Folgenacht fehlt in der Nacht-Tabelle");
        return nights[index + 1];
    }

    public static string CurrentNight(IReadOnlyList<NightRow> nights, DateTimeOffset now) => CurrentRow(nights, now).Night;

    /// <summary>
    /// Bootstrap nachladen, sobald weniger als <see cref="MinFutureNights"/> Nächte der Tabelle in der Zukunft
    /// liegen (Mittag nach <paramref name="now"/>) – auch ohne gestiegene <c>settingsVersion</c>.
    /// </summary>
    public static bool NeedsReload(IReadOnlyList<NightRow> nights, DateTimeOffset now) =>
        nights.Count(n => n.NoonStartUtc > now) < MinFutureNights;

    /// <summary>
    /// Lokale Session veraltet (execution.md §2, NIN5-4): <c>currentNight</c> weicht vom gespeicherten Nacht-Schlüssel
    /// ab; ohne verwendbare Tabelle gilt <c>now ≥ sessionEndUtc + 2 h</c>.
    /// </summary>
    public static bool IsSessionStale(string storedNight, IReadOnlyList<NightRow>? nights, DateTimeOffset now, DateTimeOffset? sessionEndUtc)
    {
        if (nights is { Count: > 0 })
        {
            try
            {
                return CurrentNight(nights, now) != storedNight;
            }
            catch (NightTableException)
            {
                // Tabelle zu kurz → Rückfall unten.
            }
        }
        return sessionEndUtc is { } end && now >= end + StaleAfterSessionEnd;
    }
}
