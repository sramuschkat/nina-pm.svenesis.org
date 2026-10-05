using System.Globalization;

namespace NinaPm.Core.Time;

/// <summary>
/// Zeitpunkte als Text (NT-05): ISO 8601 in UTC mit <c>Z</c> – im LocalStore, in Log-Zeilen und Meldungen.
/// Nacht-Schlüssel bleiben <c>YYYY-MM-DD</c>-Zeichenketten und werden nie in Zeitpunkte umgewandelt.
/// </summary>
public static class UtcText
{
    private const string MillisFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";
    private const string SecondsFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'";

    /// <summary>Millisekunden, z. B. <c>2026-09-18T01:13:05.000Z</c> (Speicher, Meldungen).</summary>
    public static string Format(DateTimeOffset t) => t.ToUniversalTime().ToString(MillisFormat, CultureInfo.InvariantCulture);

    /// <summary>Ganze Sekunden, z. B. <c>2026-09-18T01:13:05Z</c> (Log-Grammatik).</summary>
    public static string Seconds(DateTimeOffset t) =>
        t.ToUniversalTime().ToString(SecondsFormat, CultureInfo.InvariantCulture);

    /// <summary>Liest nur UTC-Zeitpunkte mit <c>Z</c>; alles andere ist ein Fehler.</summary>
    public static DateTimeOffset Parse(string text)
    {
        if (!text.EndsWith('Z'))
            throw new FormatException($"Instant without Z: {text}");
        return DateTimeOffset.Parse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
    }

    /// <summary>Prüft einen Nacht-Schlüssel <c>YYYY-MM-DD</c> (NT-02).</summary>
    public static bool IsNightKey(string? night) =>
        night is { Length: 10 } &&
        DateOnly.TryParseExact(night, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);
}
