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

    public static string BeforeExposureHint => T("Läuft vor jeder NINA-PM-Belichtung", "Runs before each NINA-PM exposure");
    public static string AfterExposureHint => T("Läuft nach jeder NINA-PM-Belichtung", "Runs after each NINA-PM exposure");
    public static string BeforeTargetChangeHint => T(
        "Läuft je neuem NINA-PM-Ziel nach Slew und Zentrieren, vor dem Guiding", "Runs on each new NINA-PM target after slew and centering, before guiding");
    public static string AfterTargetChangeHint => T("Läuft nach jedem NINA-PM-Block", "Runs after each NINA-PM block");
    public static string RefreshTargetsHint => T("Lädt Rig-Einstellungen und Ziele in den Cache", "Loads rig settings and targets into the cache");
    public static string TargetsRefreshed(int projects, bool offline) => offline
        ? T($"Offline-Modus – {projects} Ziele im Cache", $"Offline mode – {projects} targets in cache")
        : T($"{projects} Ziele im Cache", $"{projects} targets in cache");
    public static string DropInstructionsHint => T("Anweisungen hierher ziehen …", "Drag instructions here …");

    // Flat-Handling (FA-NIN-17, AP-50)
    public static string FlatsHeader => T("Flats am Nachtende", "Flats at night end");
    public static string FlatsHint => T(
        "Laufen nach der Nacht, wenn im Rig eingeschaltet. Filter, Rotator, Gain, Offset, Binning und Auslesemodus je Kombination setzt NINA-PM; Anzahlen kommen aus dem Rig.",
        "Run after the night when enabled in the rig. NINA-PM sets filter, rotator, gain, offset, binning and readout mode per combination; counts come from the rig.");
    public static string FlatsBefore => T("Vor Flats (einmal, z. B. parken, Panel schließen, Licht an)", "Before flats (once, e.g. park, close panel, light on)");
    public static string FlatsPerCombination => T(
        "Je Kombination (z. B. Trained Flat Exposure, danach Trained Dark Flat Exposure)", "Per combination (e.g. Trained Flat Exposure, then Trained Dark Flat Exposure)");
    public static string FlatsAfter => T("Nach Flats (einmal, z. B. Licht aus, Panel öffnen)", "After flats (once, e.g. light off, open panel)");

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

    // ---- Betrieb (AP-16g) ----
    public static string OperationHeader => T("Betrieb", "Operation");
    public static string OfflineMode => T("Offline-Modus", "Offline mode");
    public static string OfflineModeHint => T(
        "gespeicherter Plan der laufenden Nacht, Meldungen warten in der Outbox",
        "stored plan of the current night, reports wait in the outbox");
    public static string Reset => T("Zurücksetzen", "Reset");
    public static string SkipBlock => T("Block überspringen", "Skip block");
    public static string ReuploadFrom => T("Erneut hochladen ab", "Re-upload from");
    public static string Reupload => T("Erneut hochladen", "Re-upload");
    public static string Refresh => T("Aktualisieren", "Refresh");
    public static string ClockSkew => T("Uhr weicht mehr als 60 s ab – keine Blöcke", "Clock off by more than 60 s – no blocks");
    public static string ClockUnchecked => T("Uhrzeit ungeprüft", "Clock not checked");
    public static string Blocked(string reason) => T($"Gesperrt: {reason}", $"Blocked: {reason}");
    public static string Outbox(int pending, int dead) => T($"Outbox {pending} offen, {dead} Dead-Letter", $"Outbox {pending} pending, {dead} dead letters");

    /// <summary>Kurze Erklärung zu Outbox und Dead-Letter für Benutzer (Tooltip im Live-Status, Optionsseite).</summary>
    public static string OutboxHelp => T(
        "Outbox: Meldungen an NINA-PM (Aufnahmen, Ereignisse), die der Server noch nicht bestätigt hat. " +
        "Ohne Internet sammeln sie sich hier und gehen später der Reihe nach raus – es geht nichts verloren.\n" +
        "Dead-Letter: Meldungen, die der Server endgültig abgelehnt hat. Sie werden nicht wiederholt und zählen " +
        "nicht zum Fortschritt; die Admins bekommen einen Hinweis.",
        "Outbox: reports to NINA-PM (captures, events) the server has not confirmed yet. " +
        "Without internet they collect here and are sent later in order – nothing is lost.\n" +
        "Dead letters: reports the server rejected for good. They are not retried and do not count " +
        "toward progress; the admins are notified.");

    /// <summary>Text je Grund aus <c>blockedReasons</c> (execution.md §2); unbekannte Codes unverändert.</summary>
    public static string BlockedReason(string code) => code switch
    {
        "lease_lost" => T("Reservierung verloren – ein anderer Rechner nutzt das Rig", "Lease lost – another computer uses the rig"),
        "rig_busy" => T("Rig belegt – eine andere Session läuft", "Rig busy – another session is running"),
        "token_invalid" => T("Token ungültig oder widerrufen – neues Token eintragen", "Token invalid or revoked – enter a new token"),
        "clock_skew" => T("Uhr weicht mehr als 60 s ab – keine Blöcke", "Clock off by more than 60 s – no blocks"),
        "plan_failed" => T("Plan konnte nicht erstellt werden – neuer Versuch in 5 min", "Plan could not be built – retrying in 5 min"),
        "engine_incompatible" => T("Plugin-Update nötig (Engine-Version)", "Plugin update required (engine version)"),
        "tenant_locked" => T("Mandant gesperrt", "Tenant locked"),
        _ => code,
    };

    // ---- Live-Status (FA-NIN-13, AP-16h) ----
    public static string TestBanner => T("Testbetrieb – Sicherheitsprüfungen aus", "Test mode – safety checks off");
    public static string LiveWaiting => T("Warten", "Waiting");
    public static string LiveRunning => T("Läuft", "Running");
    public static string LiveFlats => T("Flats", "Flats");
    public static string LivePaused => T("Pausiert – unsicher", "Paused – unsafe");
    public static string LiveBlocked => T("Gesperrt", "Blocked");
    public static string LiveFinished => T("Beendet", "Finished");
    public static string LiveOffline => T("Offline-Modus", "Offline mode");
    public static string PlanAtStart => T("Plan wird beim Sequenzstart erstellt …", "Plan is built when the sequence starts …");
    public static string NextBlock(string time) => T($"Nächster Block {time}", $"Next block {time}");
    public static string TodayTargets => T("Heutige Ziele", "Today's targets");
    public static string BlockPending => T("offen", "pending");
    public static string BlockRunning => T("läuft", "running");
    public static string BlockDone => T("erledigt", "done");
    public static string BlockElapsed => T("verstrichen", "elapsed");
    public static string Transit => T("Transit", "Transit");

    // ---- Zielbrowser (FA-NIN-02, AP-16h) ----
    public static string TargetsHeader => T("An NINA ausgeliefert", "Delivered to NINA");
    public static string TargetsHint => T(
        "Ziele des Rigs aus der Web-App. „In Framing-Assistent laden“ übernimmt Zentrum, Rotation, Sensor, Brennweite und Mosaik-Raster.",
        "Targets of the rig from the web app. “Load into Framing Assistant” transfers center, rotation, sensor, focal length and mosaic grid.");
    public static string LoadIntoFraming => T("In Framing-Assistent laden", "Load into Framing Assistant");
    public static string TypeAll => T("Alle Typen", "All types");
    public static string TypeDeepSky => T("Deep-Sky", "Deep sky");
    public static string TypeExoplanet => T("Exoplanet", "Exoplanet");
    public static string OpenOnly => T("nur offene", "open only");
    public static string ColTarget => T("Ziel", "Target");
    public static string ColRotation => T("Rotation", "Rotation");
    public static string ColPanels => T("Panels", "Panels");
    public static string ColFocalLength => T("Brennweite", "Focal length");
    public static string ColSensor => T("Sensor (px)", "Sensor (px)");
    public static string ColPixel => T("Pixel (µm)", "Pixel (µm)");
    public static string ColPriority => T("Priorität", "Priority");
    public static string ColType => T("Typ", "Type");
    public static string ColProgress => T("Fortschritt", "Progress");
    public static string ColNextTransit => T("Nächster Transit", "Next transit");
    public static string TargetsCount(int n) => T($"{n} Ziele", $"{n} targets");
    public static string FramingLoaded(string name) => T($"„{name}“ an den Framing-Assistenten übergeben", $"“{name}” sent to the Framing Assistant");
    public static string FramingUnavailable => T("Framing-Assistent nicht verfügbar", "Framing Assistant not available");

    // ---- Sequenz-Bausteine (execution.md §1) ----
    public static string ContainerHint => T(
        "Führt den NINA-PM-Plan aus: je Aufruf ein Block. Bedingungen an den umgebenden Container hängen.",
        "Runs the NINA-PM plan: one block per call. Put conditions on the surrounding container.");
    public static string NightLoopHint => T(
        "Wahr bis zum Nachtende der NINA-PM-Nacht.",
        "True until the NINA-PM night ends.");
    public static string SafetyWaitHint => T(
        "Wartet bis sicher, höchstens bis zum Nachtende; danach wird die Nacht abgeschlossen.",
        "Waits until safe, at most until the night end; then the night is closed.");
}
