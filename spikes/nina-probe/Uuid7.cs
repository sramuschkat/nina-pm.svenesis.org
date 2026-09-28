using System.Security.Cryptography;

namespace NinaPm.Probe;

/// <summary>UUID Version 7 (RFC 9562) für Aufnahme- und Block-IDs; .NET 8 kennt <c>Guid.CreateVersion7</c> noch nicht.</summary>
public static class Uuid7
{
    public static string New()
    {
        Span<byte> b = stackalloc byte[16];
        RandomNumberGenerator.Fill(b);
        var ms = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        for (var i = 0; i < 6; i++) b[i] = (byte)(ms >> (8 * (5 - i)));
        b[6] = (byte)((b[6] & 0x0F) | 0x70);
        b[8] = (byte)((b[8] & 0x3F) | 0x80);
        var hex = Convert.ToHexString(b).ToLowerInvariant();
        return $"{hex[..8]}-{hex[8..12]}-{hex[12..16]}-{hex[16..20]}-{hex[20..]}";
    }
}
