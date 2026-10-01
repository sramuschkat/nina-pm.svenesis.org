namespace NinaPm.Core.Time;

/// <summary>
/// Einzige Uhr des Plugins (NT-05, execution.md §2): Zeitpunkte als <see cref="DateTimeOffset"/> in UTC.
/// <c>DateTime.Now</c>, <c>UtcNow</c>, <c>TimeZoneInfo.Local</c> und <c>ToLocalTime</c> sind in Kern und Adapter
/// verboten (BannedSymbols.txt); Tests setzen eine feste Uhr ein.
/// </summary>
public interface IClock
{
    /// <summary>Jetzt, Offset immer 0.</summary>
    DateTimeOffset UtcNow { get; }
}

/// <summary>Systemuhr – die einzige Stelle mit <c>DateTimeOffset.UtcNow</c>.</summary>
public sealed class SystemClock : IClock
{
    public static readonly SystemClock Instance = new();

    private SystemClock() { }

#pragma warning disable RS0030 // einzige erlaubte Stelle (BannedSymbols.txt)
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
#pragma warning restore RS0030
}

/// <summary>Feste Uhr für Tests und Simulation.</summary>
public sealed class FixedClock(DateTimeOffset utcNow) : IClock
{
    public DateTimeOffset UtcNow { get; set; } = utcNow.ToUniversalTime();

    public void Advance(TimeSpan by) => UtcNow += by;
}
