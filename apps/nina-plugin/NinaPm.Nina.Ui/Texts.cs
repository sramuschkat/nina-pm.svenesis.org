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
    public static string FlatsBefore => T("Vor Flats (einmal, z. B. Guiding stoppen, warten bis, parken, Panel schließen, Licht an)", "Before flats (once, e.g. stop guiding, wait for time, park, close panel, light on)");
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
    public static string Telescope => T("Teleskop", "Telescope");
    public static string Camera => T("Kamera", "Camera");
    public static string ApplySite => T("Standort aus NINA-PM übernehmen", "Use location from NINA-PM");
    public static string ApplySiteCaption => T("NINA-Profil ändern", "Change NINA profile");
    public static string ApplySiteConfirm(string site, double lat, double lon, double elevationM) => T(
        $"Standort des aktiven NINA-Profils auf den Rig-Standort {site} setzen?\n\nBreite {lat:0.0000}°, Länge {lon:0.0000}°, Höhe {elevationM:0} m",
        $"Set the location of the active NINA profile to the rig site {site}?\n\nLatitude {lat:0.0000}°, longitude {lon:0.0000}°, elevation {elevationM:0} m");

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
    public static string RequeueDeadLetters => T("Dead-Letter erneut senden", "Resend dead letters");
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

    // ---- Simulator (FA-NIN-18, AP-53; Texte wie S-40 in packages/i18n) ----
    public static string SimulatorHeader => T("Nacht-Simulator", "Night simulator");
    public static string SimulatorInfo => T(
        "So funktioniert es: Der Server rechnet die Nacht mit derselben Engine und denselben Eingaben wie den Plan für NINA – " +
        "ohne etwas zu speichern. Ohne Verbindung ist der Simulator nicht verfügbar; das Plugin plant nie selbst.",
        "How it works: the server computes the night with the same engine and inputs as the plan for NINA – without " +
        "saving anything. Without a connection the simulator is not available; the plugin never plans by itself.");
    public static string SamplesDownload => T("Beispielsequenzen herunterladen:", "Download sample sequences:");
    public static string SampleName(string file) => file switch
    {
        "one-night-safety.json" => T("Eine Nacht mit Safety", "One night with safety"),
        "one-night.json" => T("Eine Nacht ohne Safety", "One night without safety"),
        "multi-night.json" => T("Mehrere Nächte", "Multiple nights"),
        "with-flats.json" => T("mit Flats", "with flats"),
        _ => file,
    };
    public static string Step1 => T("Schritt 1 – Strategie & Einstellungen", "Step 1 – Strategy & settings");
    public static string Step2 => T("Schritt 2 – Zielkarten", "Step 2 – Target cards");
    public static string Step3 => T("Schritt 3 – Plan", "Step 3 – Plan");
    public static string LockedTitle => T("Gesteuert von NINA-PM – Änderungen in der Web-App", "Controlled by NINA-PM – change it in the web app");
    public static string LockedHint => T(
        "Die Einstellungen des Rigs kommen aus der Web-App (Rig → Scheduler) und gelten sofort. Im Plugin sind sie nicht änderbar – auch nicht im Offline-Modus.",
        "The rig settings come from the web app (Rig → Scheduler) and apply immediately. They cannot be changed in the plugin – not even in offline mode.");
    public static string NoSettings => T("Noch kein Bootstrap – „Speichern & Verbindung testen“ bzw. „Aktualisieren“.", "No bootstrap yet – use “Save & test connection” or “Refresh”.");
    public static string SettingsVersion(int v) => T($"Einstellungsversion {v}", $"Settings version {v}");
    public static string SetStrategy => T("Strategie", "Strategy");
    public static string SetPlayback => T("Wiedergabe", "Playback");
    public static string SetBonus => T("Bonus / Überschuss", "Bonus / overshoot");
    public static string SetMosaic => T("Mosaik-Panels getrennt planen", "Plan mosaic panels independently");
    public static string SetDither => T("Dither", "Dither");
    public static string SetFilterSwitch => T("Filterwechsel", "Filter switch");
    public static string SetFlats => T("Flats", "Flats");
    public static string SetFullFlatSet => T("Vollständiger Flat-Satz", "Full flat set");
    public static string SetDarkFlats => T("Dark-Flats", "Dark flats");
    public static string SetFlip => T("Meridian-Flip", "Meridian flip");
    public static string SetSortChain => T("Sortierkette", "Sort chain");
    public static string On => T("an", "on");
    public static string Off => T("aus", "off");
    public static string Strategy(string code) => code switch
    {
        "proportional" => T("Proportionale Zeit", "Proportional time"),
        "manual_priority" => T("Manuelle Priorität", "Manual priority"),
        _ => code,
    };
    public static string Playback(string code) => code switch
    {
        "time_aware" => T("Zeitgeführt", "Time-aware"),
        "sequential" => T("Sequenziell", "Sequential"),
        _ => code,
    };
    public static string BonusValue(bool on, string overshootPct) => T($"Bonus {(on ? "an" : "aus")} · Überschuss {overshootPct} %", $"Bonus {(on ? "on" : "off")} · overshoot {overshootPct} %");
    public static string DitherValue(bool on, int every) => on ? T($"alle {every} Belichtungen", $"every {every} exposures") : Off;
    public static string FilterSwitchValue(bool on, int every, string tol) => on ? T($"alle {every} ± {tol} %", $"every {every} ± {tol} %") : Off;
    public static string FlatsValue(bool on, int count, string source) => on
        ? T($"an · {count} je Kombination · Quelle {(source == "sky" ? "Himmel" : "Panel")}", $"on · {count} per combination · source {(source == "sky" ? "sky" : "panel")}")
        : Off;
    public static string DarkFlatsValue(bool on, int? count)
    {
        if (!on) return Off;
        var n = count?.ToString(CultureInfo.InvariantCulture);
        return T($"an · {n ?? "wie Flats"}", $"on · {n ?? "as flats"}");
    }
    public static string FlipValue(bool on, string after, string max, string pause, string duration) => on
        ? T($"an · nach {after} min, max. {max} min, Pause {pause} min, Dauer {duration} s", $"on · after {after} min, max {max} min, pause {pause} min, duration {duration} s")
        : Off;
    public static string SortKey(string code) => code switch
    {
        "lowest_peak_altitude" => T("geringste Maximalhöhe", "lowest peak altitude"),
        "setting_soonest" => T("bald untergehend", "setting soonest"),
        "most_remaining" => T("meiste Restarbeit", "most remaining work"),
        "constrained" => T("knappes Zeitfenster", "constrained window"),
        "most_moon_limited" => T("meiste Mondvermeidungs-Arbeit", "most moon-limited work"),
        "mosaic_grouping" => T("Mosaik zusammenhalten", "keep mosaics together"),
        "card_order" => T("Priorität", "priority"),
        "due_soonest" => T("Zieltermin am nächsten", "due soonest"),
        _ => code,
    };
    public static string Yes => T("ja", "yes");
    public static string No => T("nein", "no");
    public static string Night => T("Nacht", "Night");
    public static string PrevNight => T("Vorige Nacht", "Previous night");
    public static string NextNight => T("Nächste Nacht", "Next night");
    public static string Tonight => T("Heute Nacht", "Tonight");
    public static string Simulate => T("Simulieren", "Simulate");
    public static string SimLoadingSettings => T("Lade Rig-Einstellungen …", "Loading rig settings …");
    public static string SimRunning => T("Simulation läuft …", "Simulating …");
    public static string TargetsFetched(string? when) => when is null
        ? T("Ziele zuletzt abgerufen: noch nie", "Targets last fetched: never")
        : T($"Ziele zuletzt abgerufen: {when}", $"Targets last fetched: {when}");
    public static string SimStats(string darkHours, int targets, int frames, string moonPct) =>
        T($"dunkel {darkHours} h · Ziele {targets} · Frames {frames} · Mond {moonPct} %", $"dark {darkHours} h · targets {targets} · frames {frames} · moon {moonPct} %");
    public static string SimComputed(string when, int settingsVersion) =>
        T($"Gerechnet vom Server {when} mit Einstellungsversion {settingsVersion}", $"Computed by the server {when} with settings version {settingsVersion}");
    public static string SimUnavailable(string reason) => T($"Simulator nicht verfügbar: {reason}", $"Simulator not available: {reason}");
    public static string SimOffline => T("Offline-Modus aktiv – der Simulator braucht die Verbindung zum Server", "Offline mode on – the simulator needs the connection to the server");
    public static string SimNoNights => T("keine Nacht-Tabelle – zuerst Verbindung testen", "no night table – test the connection first");
    public static string SimNightInvalid => T("Nacht liegt außerhalb der Nacht-Tabelle", "Night is outside the night table");
    public static string SimEmpty => T("Keine aktiven, freigegebenen Projekte an diesem Rig.", "No active, approved projects on this rig.");
    public static string CardHours(string hours) => T($"Zugeteilt {hours} h", $"Allocated {hours} h");
    public static string CardWindow => T("Zeitfenster", "Window");
    public static string CardAltitude => T("Höhe", "Altitude");
    public static string CardMoonSep => T("Mondabstand", "Moon separation");
    public static string CardLine(string filter, string exposure, int need, int tonight) =>
        T($"{filter} {exposure} s · verbleibend {need} · heute {tonight}", $"{filter} {exposure} s · remaining {need} · tonight {tonight}");
    public static string CardMoon(string name) => T($"Mond: {name}", $"Moon: {name}");
    public static string CardAllocated => T("Zugeteilt", "Allocated");
    public static string CardLinesHeader => T("BELICHTUNGSPLAN", "EXPOSURE PLAN");
    public static string CardLineDetail(int need, int tonight, string exposure) =>
        T($"verbleibend {need} · heute {tonight} · {exposure} s", $"remaining {need} · tonight {tonight} · {exposure} s");
    public static string MoonWord => T("Mond", "Moon");
    public static string TwilightWord(string kind) => kind switch
    {
        "civil" => T("Bürgerl.", "Civil"),
        "nautical" => T("Naut.", "Nautical"),
        _ => T("Astro.", "Astro"),
    };
    public static string CardMoonDown => T("Mond unter dem Horizont", "moon below horizon");
    public static string CardLineOff => T("aus", "off");
    public static string CardFlip(string time, int minutes) => T($"Flip {time} ({minutes} min)", $"Flip {time} ({minutes} min)");
    public static string CardFlipInWindow(string time) => T($"Flip im Transitfenster {time}", $"Flip in the transit window {time}");
    public static string TransitBox => T("Transit-Lauf: Dither aus, Filterwechsel aus, Vorrang", "Transit run: dither off, filter switch off, priority");
    public static string Check(string key) => key switch
    {
        "altitude" => T("Höhe (Maximum ≥ Mindesthöhe)", "Altitude (maximum ≥ minimum altitude)"),
        "time" => T("Zeit (≥ Mindestzeit am Ziel)", "Time (≥ minimum time on target)"),
        "moon" => T("Mond (sicher, Abstand)", "Moon (safe, separation)"),
        "darkness" => T("Dunkelheit (Sonne unter der Grenze)", "Darkness (sun below the limit)"),
        "rotation" => T("Rotation", "Rotation"),
        _ => key,
    };
    public static string Unallocated => T("Nicht zugeteilt", "Not allocated");
    public static string DiagnosticReason(string code) => code switch
    {
        "start_date" => T("Startdatum noch nicht erreicht", "start date not reached yet"),
        "not_visible" => T("nie über der Mindesthöhe", "never above the minimum altitude"),
        "below_min_time" => T("unter der Mindestzeit am Ziel", "below the minimum time on target"),
        "moon_blocked" => T("Mond blockiert", "blocked by the moon"),
        "prefiltered" => T("erreichbare Zeit unter der Mindestzeit", "reachable time below the minimum time"),
        "outranked" => T("keine Zeit zugeteilt", "no time allocated"),
        "no_need" => T("kein Bedarf", "no need"),
        "transit_conflict" => T("Transitkonflikt", "transit conflict"),
        "flip_in_transit" => T("Meridian-Flip im Transit", "meridian flip during the transit"),
        "filter_not_found" => T("Filter nicht im Filterrad bestätigt", "filter not confirmed in the filter wheel"),
        "rotation_mismatch" => T("Rotation passt nicht", "rotation mismatch"),
        _ => code,
    };
    public static string PlanZone(string zone) => T($"Nachtplan (Standortzeit {zone})", $"Night plan (site time {zone})");
    public static string Protocol => T("Planprotokoll", "Plan log");
    public static string CopyProtocol => T("Protokoll kopieren", "Copy log");
    public static string Copied => T("Protokoll kopiert.", "Log copied.");
    public static string Warnings => T("Plausibilitätswarnungen", "Plausibility warnings");
    public static string Warning(string code) => code switch
    {
        "idle_gap" => T("Leerlauf ≥ 10 min, obwohl ein Ziel möglich wäre", "idle ≥ 10 min although a target would be possible"),
        "la_unsafe" => T("Mondvermeidungs-Filter unsicher belichtet", "moon-avoidance filter exposed unsafely"),
        "total_min" => T("Ziel unter der Mindestzeit", "target below the minimum time"),
        "no_alloc" => T("Arbeit und nutzbare Zeit, aber keine Belichtung", "work and usable time, but no exposure"),
        "la_miss" => T("Mondvermeidungs-Arbeit ohne Nutzung der mondfreien Zeit", "moon-avoidance work without using the moon-free time"),
        "filter_stuck" => T("mehr als 30 gleiche Belichtungen in Folge", "more than 30 identical exposures in a row"),
        "past_mismatch" => T("bisher belichtete Zeit weicht von den vergangenen Blöcken ab", "exposed time differs from past blocks"),
        "panel_rotation_mismatch" => T("Panel-Rotation weicht ohne Rotator ab", "panel rotation differs without rotator"),
        "twilight_grazing" => T("streifende Dämmerungsgrenze", "grazing twilight limit"),
        _ => code,
    };
    public static string MoonProfile(string raw) => raw switch
    {
        "moonProfile.none" => T("Kein Mond", "No moon"),
        "moonProfile.strict" => T("Streng", "Strict"),
        "moonProfile.moderate" => T("Moderat", "Moderate"),
        "moonProfile.relaxed" => T("Entspannt", "Relaxed"),
        _ => raw,
    };
    public static string Command(string code) => code switch
    {
        "slew_center" => T("Slew/Zentrieren", "Slew/center"),
        "slew_center_rotate" => T("Slew/Zentrieren/Rotieren", "Slew/center/rotate"),
        "filter" => T("Filter", "Filter"),
        "expose" => T("Belichtung", "Exposure"),
        "expose_series" => T("Belichtungsreihe", "Exposure series"),
        "dither" => T("Dither", "Dither"),
        "autofocus_hint" => T("Autofokus", "Autofocus"),
        "wait" => T("Warten", "Wait"),
        "meridian_flip" => T("Meridian-Flip", "Meridian flip"),
        "end" => T("Ende", "End"),
        _ => code,
    };
    public static string Until(string time) => T($"bis {time}", $"until {time}");
    public static string Bonus => T("Bonus", "Bonus");
    public static string LogColumn(string column) => column switch
    {
        "time" => T("Zeit", "Time"),
        "cmd" => T("Befehl", "Command"),
        "target" => T("Ziel", "Target"),
        "panel" => T("Panel", "Panel"),
        "no" => T("Nr.", "No."),
        "filter" => T("Filter", "Filter"),
        "exposure" => T("Belichtung", "Exposure"),
        "gain" => T("Gain", "Gain"),
        "offset" => T("Offset", "Offset"),
        "binning" => T("Binning", "Binning"),
        "readout" => T("Auslesemodus", "Readout mode"),
        "rotation" => T("Rotation", "Rotation"),
        "ra" => "RA",
        "dec" => "Dec",
        "alt" => T("Höhe", "Altitude"),
        "moonSep" => T("Mondabstand", "Moon sep."),
        "moonOk" => T("Mond ok", "Moon ok"),
        "required" => T("gefordert", "required"),
        "dark" => T("dunkel", "dark"),
        "la" => T("Mondvermeidung", "Moon avoidance"),
        "profile" => T("Mondprofil", "Moon profile"),
        _ => column,
    };

    // Spaltenköpfe des Planprotokolls für x:Static.
    public static string LogTime => LogColumn("time");
    public static string LogCmd => LogColumn("cmd");
    public static string LogTarget => LogColumn("target");
    public static string LogPanel => LogColumn("panel");
    public static string LogNo => LogColumn("no");
    public static string LogFilter => LogColumn("filter");
    public static string LogExposure => LogColumn("exposure");
    public static string LogGain => LogColumn("gain");
    public static string LogOffset => LogColumn("offset");
    public static string LogBinning => LogColumn("binning");
    public static string LogReadout => LogColumn("readout");
    public static string LogRotation => LogColumn("rotation");
    public static string LogRa => LogColumn("ra");
    public static string LogDec => LogColumn("dec");
    public static string LogAlt => LogColumn("alt");
    public static string LogMoonSep => LogColumn("moonSep");
    public static string LogMoonOk => LogColumn("moonOk");
    public static string LogRequired => LogColumn("required");
    public static string LogDark => LogColumn("dark");
    public static string LogLa => LogColumn("la");
    public static string LogProfile => LogColumn("profile");

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

    // ---- Tagesschleife und Warten auf Zeit (AP-52, FA-NIN-07, FA-NIN-26) ----
    public static string DayLoopHint => T(
        "Nacht für Nacht, solange NINA-PM für eine der nächsten 3 Nächte Ziele liefert.",
        "Night after night while NINA-PM delivers targets for one of the next 3 nights.");
    public static string DayLoopEndNightLabel => T("Letzte Nacht", "Last night");
    public static string DayLoopEndNightPlaceholder => T("JJJJ-MM-TT, leer = ohne", "YYYY-MM-DD, empty = none");
    public static string DayLoopMaxNightsLabel => T("Höchstens Nächte", "Max. nights");
    public static string DayLoopEndNightInvalid => T("Datum ungültig – gilt nicht", "Invalid date – ignored");
    public static string DayLoopStatus(int nights, string? endReason) => endReason switch
    {
        null => nights == 0 ? "" : T($"{nights}. Nacht", $"Night {nights}"),
        "end_date" => T("beendet: Enddatum erreicht", "ended: end night reached"),
        "max_nights" => T("beendet: Höchstzahl Nächte erreicht", "ended: max. nights reached"),
        _ => T("beendet: keine Ziele in den nächsten 3 Nächten", "ended: no targets in the next 3 nights"),
    };

    public static string WaitForTimeHint => T("Standortzeit des Rigs", "Rig site time");
    public static string WaitSourceTime => T("Uhrzeit", "Time");
    public static string WaitSourceCivil => T("Bürgerliche Dämmerung", "Civil dusk");
    public static string WaitSourceNautical => T("Nautische Dämmerung", "Nautical dusk");
    public static string WaitSourceAstronomical => T("Astronomische Dämmerung", "Astronomical dusk");
    public static string WaitTimeLabel => T("Uhrzeit", "Time");
    public static string WaitOffsetLabel => T("Versatz (min)", "Offset (min)");
    public static string WaitRolloverLabel => T("Tageswechsel", "Day rollover");
    public static string WaitRolloverNotNoon => T(
        "Tageswechsel weicht vom lokalen Mittag ab (Nacht-Definition)",
        "Day rollover differs from local noon (night definition)");
    public static string WaitTargetText(string siteTime, string night) => T($"bis {siteTime} (Nacht {night})", $"until {siteTime} (night {night})");
    public static string WaitNoTwilight(string night) => T($"Nacht {night} ohne diese Dämmerung – kein Warten", $"Night {night} has no such twilight – no wait");
    public static string WaitingFor(TimeSpan left) =>
        T($"Warten noch {(int)left.TotalHours:00}:{left.Minutes:00}:{left.Seconds:00}", $"Waiting {(int)left.TotalHours:00}:{left.Minutes:00}:{left.Seconds:00}");
}
