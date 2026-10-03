namespace NinaPm.Core.Options;

/// <summary>
/// Einstellungen des Plugins (Optionsseite, FA-NIN-01): Server-URL und Sync-Token. Das Token liegt nur geschützt vor
/// (<see cref="ITokenProtector"/>, DPAPI <c>CurrentUser</c>, SV-08) und wird nie geloggt.
/// </summary>
public sealed class PluginOptions
{
    /// <summary>Standard: prod. Für Tests tagsüber <c>http://localhost:8787/api</c> (ops/plugin-test-protocol.md).</summary>
    public const string DefaultServerUrl = "https://nina-pm.svenesis.org/api";

    public string ServerUrl { get; set; } = DefaultServerUrl;

    /// <summary>Geschütztes Token (Base64 der DPAPI-Ausgabe); leer = noch nicht gekoppelt.</summary>
    public string ProtectedToken { get; set; } = "";

    /// <summary>Sichtbarer Schalter *Testbetrieb* (NIN-17): nur zusammen mit lokaler URL und <c>X-NPM-Test: 1</c> wirksam.</summary>
    public bool TestMode { get; set; }

    /// <summary>Offline-Modus (FA-NIN-04): kein Serverkontakt, gespeicherter Plan der laufenden Nacht, Outbox wartet.</summary>
    public bool OfflineMode { get; set; }

    /// <summary>Basis-URI der API ohne abschließenden Schrägstrich; <c>null</c> bei ungültiger Eingabe.</summary>
    public Uri? ApiBase =>
        Uri.TryCreate(ServerUrl.Trim().TrimEnd('/'), UriKind.Absolute, out var uri) &&
        (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
            ? uri
            : null;

    /// <summary>
    /// Lokale Gegenstelle (NIN-17 Bedingung b): <c>localhost</c>, Loopback oder private IPv4 (10/8, 172.16/12,
    /// 192.168/16). Nur dann darf <see cref="TestMode"/> Sicherheitsprüfungen abschalten.
    /// </summary>
    public bool IsLocalServer
    {
        get
        {
            var uri = ApiBase;
            if (uri is null) return false;
            if (uri.IsLoopback || string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase)) return true;
            if (!System.Net.IPAddress.TryParse(uri.Host, out var ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
                return false;
            var b = ip.GetAddressBytes();
            return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168);
        }
    }

    /// <summary>
    /// Dreifachsperre des Testbetriebs (execution.md §9, NIN-17): Dunkelheits- und Höhenprüfung entfallen nur mit
    /// sichtbarem Schalter <see cref="TestMode"/>, lokaler Server-URL (<see cref="IsLocalServer"/>) <b>und</b> Antwort mit
    /// <c>X-NPM-Test: 1</c>; zwei von drei lassen die Prüfungen an. Dann zeigt der Live-Status das rote Banner.
    /// </summary>
    public bool SafetyChecksOff(bool lastResponseWasTestServer) => TestMode && IsLocalServer && lastResponseWasTestServer;
}

/// <summary>
/// Schutz des Sync-Tokens (SV-08): im Plugin DPAPI mit Geltungsbereich <c>CurrentUser</c> (NinaPm.Nina), in Tests eine
/// umkehrbare Attrappe. Klartext nur im Speicher, nie in Logs, Diagnoseausgaben oder Fehlermeldungen.
/// </summary>
public interface ITokenProtector
{
    string Protect(string token);

    /// <summary>Klartext oder <c>null</c>, wenn der Wert nicht (mehr) lesbar ist – z. B. anderer Windows-Benutzer.</summary>
    string? Unprotect(string protectedToken);
}
