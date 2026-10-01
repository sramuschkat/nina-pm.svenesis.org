using System.Globalization;

namespace NinaPm.Nina.Ui;

/// <summary>
/// Texte des Plugins in Deutsch und Englisch (Regel 8): Sprache nach NINAs Oberflächensprache
/// (<see cref="CultureInfo.CurrentUICulture"/>), Englisch für alles außer Deutsch. Kein „Astro PM“ (Regel 14).
/// </summary>
public static class Texts
{
    private static bool De => CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "de";

    private static string T(string de, string en) => De ? de : en;

    public static string Intro => T(
        "NINA-PM plant deine Projekte auf dem Server und führt sie in NINA aus. Server-URL und Sync-Token stehen in der Web-App unter Rig → NINA-Instanzen.",
        "NINA-PM plans your projects on the server and runs them in NINA. Server URL and sync token are shown in the web app under Rig → NINA instances.");
    public static string ConnectionHeader => T("Verbindung", "Connection");
    public static string ServerUrl => T("Server-URL", "Server URL");
    public static string Token => T("Sync-Token", "Sync token");
    public static string TokenStored => T("Token gespeichert (verschlüsselt)", "Token stored (encrypted)");
    public static string TokenMissing => T("Noch kein Token gespeichert", "No token stored yet");
    public static string SaveAndConnect => T("Speichern & Verbindung testen", "Save & test connection");
    public static string TestConnection => T("Verbindung testen", "Test connection");
    public static string TestMode => T("Testbetrieb", "Test mode");
    public static string TestModeHint => T("nur mit lokalem Test-Server", "local test server only");
    public static string Status => T("Status", "Status");
    public static string Tenant => T("Mandant", "Tenant");
    public static string Instance => T("NINA-Instanz", "NINA instance");
    public static string Rig => T("Rig", "Rig");
    public static string Site => T("Standort-Abgleich", "Site check");

    public static string Testing => T("Verbindung wird getestet …", "Testing connection …");
    public static string NotConfigured => T("Server-URL und Token eintragen.", "Enter server URL and token.");
    public static string InvalidUrl => T("Server-URL ungültig (http oder https).", "Invalid server URL (http or https).");
    public static string Connected => T("Verbunden", "Connected");
    public static string ConnectedTestServer => T("Verbunden mit dem Test-Server", "Connected to the test server");
    public static string TokenInvalid => T("Token ungültig oder widerrufen", "Token invalid or revoked");
    public static string TokenUnreadable => T("Gespeichertes Token nicht lesbar – bitte neu eintragen.", "Stored token unreadable – please enter it again.");
    public static string TenantLocked => T("Mandant gesperrt", "Tenant locked");
    public static string UpdateNeeded => T("Plugin-Update nötig (Engine-Version)", "Plugin update required (engine version)");
    public static string Unreachable => T("Server nicht erreichbar", "Server unreachable");
    public static string Failed(int status, string? code) => T($"Fehler {status}", $"Error {status}") + (code is null ? "" : $" ({code})");

    public static string SiteOk(double km) => T($"Profil-Standort passt ({km:0.0} km)", $"Profile location matches ({km:0.0} km)");
    public static string SiteFar(double km) => T(
        $"Profil-Standort {km:0} km vom Rig-Standort entfernt – NINA-Profil prüfen.",
        $"Profile location is {km:0} km from the rig site – check the NINA profile.");
    public static string SiteUnknown => T("Profil-Standort unbekannt", "Profile location unknown");
}
