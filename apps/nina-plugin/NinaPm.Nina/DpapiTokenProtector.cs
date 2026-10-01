using System.Security.Cryptography;
using System.Text;
using NinaPm.Core.Options;

namespace NinaPm.Nina;

/// <summary>
/// Sync-Token per DPAPI, Geltungsbereich <c>CurrentUser</c> (SV-08): nur derselbe Windows-Benutzer auf demselben
/// Rechner kann es lesen. Gespeichert wird Base64 der geschützten Bytes; der Klartext erscheint in keinem Log.
/// </summary>
internal sealed class DpapiTokenProtector : ITokenProtector
{
    // Zusätzliche Entropie: trennt NINA-PM-Werte von anderen DPAPI-Nutzern desselben Benutzers.
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Svenesis.NinaPm.SyncToken.v1");

    public string Protect(string token) =>
        Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.CurrentUser));

    public string? Unprotect(string protectedToken)
    {
        if (string.IsNullOrEmpty(protectedToken)) return null;
        try
        {
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(protectedToken), Entropy, DataProtectionScope.CurrentUser));
        }
        catch (Exception ex) when (ex is CryptographicException or FormatException)
        {
            return null;
        }
    }
}
