using System.Security.Cryptography;

namespace NinaPm.Core.Time;

/// <summary>
/// UUID Version 7 (RFC 9562) für Session-, Aufnahme- und Ereignis-IDs (TK 10.3 Nr. 5); Zeitanteil aus dem injizierten
/// <see cref="IClock"/> (NT-05). .NET 8 kennt <c>Guid.CreateVersion7</c> noch nicht. Wie im Probe-Plugin (AP-S2b).
/// </summary>
public static class Uuid7
{
    public static Guid New(IClock clock)
    {
        Span<byte> b = stackalloc byte[16];
        RandomNumberGenerator.Fill(b);
        var ms = clock.UtcNow.ToUnixTimeMilliseconds();
        for (var i = 0; i < 6; i++) b[i] = (byte)(ms >> (8 * (5 - i)));
        b[6] = (byte)((b[6] & 0x0F) | 0x70);
        b[8] = (byte)((b[8] & 0x3F) | 0x80);
        var hex = Convert.ToHexString(b).ToLowerInvariant();
        return Guid.Parse($"{hex[..8]}-{hex[8..12]}-{hex[12..16]}-{hex[16..20]}-{hex[20..]}");
    }
}
