-- =====================================================================
-- Svenesis NINA-PM – Datenbankschema für Amazon Aurora DSQL
-- Version 1.18 – Stand 23.09.2026 – abgestimmt mit Fachkonzept und Technischem Konzept (Uebernahme des aktualisierten Website-Codes 23.09.2026)
--   (1.18: Uebernahme des aktualisierten Website-Codes (WS-01 ... WS-31, WS-E1 ... E4) – KEINE neuen Spalten,
--    nur Kommentare: weather_cache.model_set mit den neuen Modellketten und dem Hinweis, dass der Satz Teil des
--    UNIQUE-Schluessels ist (WS-16); weather_cache.payload mit dem Aufbau (Rohwerte je Stunde, jetKmh, shearKmh,
--    modelId, cloudSrc, nest, aerosolMissing, Teil- und Gesamtbewertung, coveredSec, bestes Fenster);
--    dso_object.object_type auf das OpenNGC-Vokabular statt der Website-Kurzcodes (WS-26, Anzeigegruppen in
--    contracts/enums.json), Herkunft von mag_v/mag_b/surf_br_mag_arcsec2 und der Groessen ausdruecklich OpenNGC
--    NGC.csv (der Website-Auszug ngc.json liefert nur Namen, Aliase, Vorschaubilder und Wikipedia-Titel, WS-E4),
--    Objektzahl einheitlich 13.957 (WS-27); position_angle_deg-Kommentar unveraendert (AST-D21).
--    Nachtrag nach Gegenpruefung: weather_cache.payload um moonAltDeg, seeingIncomplete, ratingIndex,
--    darknessSec und den Hinweis auf die ungerundete Speicherung ergaenzt (B-06/B-08/B-10); catalogs mit
--    Verweis auf contracts/enums.json dsoCatalogPrefixes (B-34); position_angle_deg CHECK von
--    "<= 180" auf "< 180" geaendert (Achsenwinkel-Konvention [0, 180), PosAng mod 180, NULL ohne
--    MajAx/MinAx, B-28/B-29); Objektzahl praezisiert als 13.957 Zeilen aus NGC.csv + n_addendum aus
--    addendum.csv (B-25))
--   (1.17: Nachtablauf-Pruefung (NT-01 ... NT-48, NT-E1 ... E4) – camera.cooling_setpoint_c (nullable) und
--    camera.cooling_tolerance_c (DEFAULT 1, CHECK > 0) fuer die Kuehlungswarnung (NT-E2); capture.temperature_deviation
--    und capture.settings_deviation (boolean NOT NULL DEFAULT false, NT-E2/NT-E3), capture.exposure_mid_utc (Belichtungs-
--    mitte fuer BJD_TDB, NT-10); filter.photometric_band mit CHECK (NT-41); rig.filter_wheel je Platz um ninaFilterName/
--    ninaConfirmedAt/ninaConfirmedBy erweitert (jsonb, bestaetigte NINA-Zuordnung statt Laufzeit-Heuristik, NT-E1),
--    rig.nina_filter_wheel mit focusOffset/reportedAt; rig.flats_source panel/sky (DEFAULT panel, NT-40);
--    session.session_end_utc (massgebliches Sessionende der letzten Planrevision fuer Stale und Nachtbericht, NT-09);
--    Gain/Offset in camera, exposure_template_line, exposure_line und capture nullable (null = NINA-Standard -1),
--    im Schluessel von flat_combination bleibt NOT NULL mit -1 (NT-38); Kommentare zu filter.telescope_id (NT-43),
--    exposure_line (Sperre bei Aufnahmen, NT-E3) und capture_night.integration_s = Summe capture.exposure_s (NT-E3).
--    Nachtrag nach Gegenpruefung: rig_lease.released_session_id (Admin-Freigabe schliesst die alte Session vom Zurueckholen
--    der Lease per Heartbeat aus, M5); Kommentar session.status: nur stale -> running, aborted/completed endgueltig (M6))
--   (1.16: Security-Vereinfachung – auth_session als Sitzung mit session_hash statt Refresh-Rotation, created_at/
--    last_seen_at/expires_at fuer 14 Tage Leerlauf und 30 Tage Hoechstdauer, Logout loescht die Zeile (SV-01);
--    entfallen: auth_session.refresh_hash/prev_refresh_hash/rotated_at/new_token_used_at/discord_login_at/last_used_at/
--    revoked_at und ix_auth_session_prev, app_user.member_version (SV-01), befristeter Admin mit app_user.role_expires_at/
--    role_expiry_notified_at/role_granted_by/role_reason, CHECK und ix_app_user_role_expiry sowie invitation.role_duration_hours (E2),
--    tenant.owner_state/owner_transfer_to/owner_transfer_expires_at (E2: Uebertragung sofort), Tabelle login_audit (SV-11),
--    system_audit.aws_principal und Akteur bootstrap (SV-11), nina_instance.expires_at/token_last_used_at und
--    ix_nina_instance_due (SV-08), Sicherheitsschluessel in tenant.settings (SV-03); discord_channel.webhook_url statt
--    webhook_ssm_name (SV-10); project.deleted_at als Papierkorb mit ix_project_deleted (E4); GRANT-Vorlage ohne
--    db-bootstrap, ohne app_migrate und ohne Audit-Ausnahmen (SV-13/SV-14, SEC-59 entfaellt).
--    Nachtrag nach Gegenpruefung: invitation mit CHECK (role = 'user' OR max_uses = 1); discord_channel.webhook_url
--    und webhook_hint nullable mit CHECK (webhook_url IS NOT NULL OR NOT enabled) fuer den Import ohne URL;
--    GRANT-Vorlage mit INSERT fuer app_job (Mandanten-Import), kein Recht auf auth_session; Kommentare zu
--    change_log (Rollenwechsel mit diff.reason), app_user.last_login_at und Systembenachrichtigungen)
--   (1.15: Gegenpruefung des Astronomie-Durchgangs – min_aperture_mm und distance_pc sind jetzt WIRKLICH so benannt
--    (1.14 hatte es nur im Kommentar behauptet, AST-D13/D14), dso_object erhaelt mag_b, mag_band_used und
--    surf_br_mag_arcsec2 (AST-D6/D7 – dieselbe Luecke))
--   (1.14: Astronomie-Durchgang – ephemeris mit time_system_source/O-C-Feldern (AST-T5), duration_h nullable plus
--    duration_estimated (AST-T18), Winkelspalten auf double precision wegen der 1e-6-Zusage (AST-G07), Laenge OST POSITIV
--    kommentiert (AST-G04/D12), Pole ausgeschlossen (AST-N18), echte OpenNGC-Typcodes und getrennte Baender mag_b/mag_v/
--    surf_br (AST-D6/D7), min_aperture_mm statt _in (AST-D13), distance_pc statt _ly (AST-D14), bandtreue Wirtstern-
--    Helligkeiten (AST-D15), quantum_efficiency_pct (AST-D22), disposition mit sechs TFOPWG-Werten (AST-D5),
--    project.moon_must_be_down (AST-M7), Wertebereiche fuer RA/Dec/Periode/Winkel/Prozente (AST-D20/M12))
--   (1.13: Sicherheits-Durchgang – nina_instance.expires_at und token_last_used_at mit Ablauf-Index (SEC-54),
--    CHECK auf invitation.max_uses, GRANT-Vorlage nach Umfang statt pauschal mit system_audit/login_audit
--    nur SELECT,INSERT (SEC-59))
--   (1.12: Logik-Durchgang – UNIQUE (tenant_id, short_name) auf filter, UNIQUE (session_id, revision) auf night_plan,
--    change_request.version fuer ETag/If-Match, Indizes ix_night_plan_session und ix_rig_lease_due (Job-Index),
--    Obergrenze fuer invitation.role_duration_hours, Kommentar zu capture.project_id)
--   (1.11: Sicherheits-Review – DB-Rollen app_rw (api) / app_job (worker) getrennt, app_ro entfaellt,
--    GRANT-Vorlage mit beiden Anwendungsrollen und den IAM-Rollennamen je Lambda, mfaRequiredForAdmins Standard true)
--   (1.10: Review 5 – job.dedupe_active mit UNIQUE statt deterministischer job.id, discord_delivery.tenant_id + Index,
--    flat_combination mit rotator_mech_deg_dg (Zehntelgrad-Ganzzahl) im Schlüssel + median_deg, capture.readout_mode_index NOT NULL,
--    capture.rotator_mech_deg NOT NULL, seed/import-Zähler mit Nacht, Kommentare zu Karenz und Wächtern)
--   (1.9: Review 4 – capture_night eine Zeile je Nacht mit rejected_individual/_correction/bonus_rejected, rig_lease eigene Tabelle,
--    notification auch an Identitäten (Super User), flat_combination mit status + readout_mode_index, session.created_offline/offline_since,
--    Indizes capture(project_id)/capture(transit_observation_id), ra_deg/dec_deg double precision, auth_session.discord_login_at, discord_delivery)
--   (1.8: Review 3 – capture.night_plan_id/ra_deg/dec_deg, session_event.night_plan_id, transit_observation.locked_at,
--    session.offline, rig.offline_until (beide in 1.9/1.10 ersetzt), dark_flat_count nullable, exposure_line.disabled_for_night, tenant owner_state, Kommentare)
--   (1.7: Planung nach Astro-PM-Plugin – Standard-Sortierkette, Mosaik-Panels getrennt planen standardmäßig an, Kommentare Überschuss/Bonus)
--   (1.6: Review 2 – Flat-Kombination ohne Projekt mit Auslesemodus, filter_short_name für alle Aufnahmetypen, block_id,
--    Session 1:n Nachtplan, mehrere/geteilte Transit-Beobachtungen, Filterradbelegung, Toleranz in Prozent,
--    vollständige Sortierkette, notification ohne Discord-Zustellspalten, Job-Indizes, GRANT-Vorlage)
--   (1.5: geteilte Flats; 1.4: Discord-Kanäle, Aufnahmetypen; 1.3: Review 1)
--
-- Grundlage: Fachkonzept v1.20 (Kap. 7), Technisches Konzept v1.20 (Kapitel „Datenbank“) und Abgleich mit dem
-- Astro-PM-1.6.0-Export logbook.db.sql (SQLite).
--
-- DSQL-Regeln, die dieses Schema berücksichtigt:
--  * Primärschlüssel UUID (gen_random_uuid()), keine Sequenzen nötig
--  * keine Trigger, kein PL/pgSQL -> Zähler/Audit in der Anwendung
--  * keine Row-Level-Security -> tenant_id in JEDER Mandantentabelle,
--    Pflicht-Filter im Repository-Layer (NFA-16); Indizes für Mandanten-
--    abfragen beginnen mit tenant_id (ausgenommen: PK/UNIQUE auf global
--    eindeutigen UUIDs und identitätsbezogene Indizes)
--  * max. 3.000 geänderte Zeilen je Transaktion -> Löschkaskaden und
--    Massenimporte in der Anwendung stapelweise; Planprotokolle als Datei in S3
--  * json/jsonb als Spaltentyp unterstützt, je Wert max. 1 MiB (komprimiert), nicht indexierbar
--  * DDL und DML in getrennten Transaktionen, je Transaktion 1 DDL
--  * Indizes mit CREATE INDEX ASYNC
--  * Fremdschlüssel: von Aurora DSQL seit 27.08.2026 unterstützt. ON DELETE-Aktionen
--    werden bewusst NICHT genutzt (3.000-Zeilen-Grenze), Löschen erfolgt in der Anwendung
--    in Stapeln. Nachträglich hinzugefügte FK-/CHECK-Constraints nur mit NOT VALID und
--    anschließendem ALTER TABLE ASYNC … VALIDATE CONSTRAINT.
--  * Isolation fest REPEATABLE READ mit optimistischer Konfliktprüfung; Invarianten über
--    mehrere Zeilen mit SELECT … FOR UPDATE auf Wächterzeilen absichern.
--  * Dieses Referenz-DDL enthält KEINE GRANTs. Die Migrationen (packages/db/migrations) ergänzen je Tabelle
--    die GRANTs nach der Vorlage am Dateiende; lokal (PostgreSQL) werden AWS IAM GRANT übersprungen.
--  * Aufzählungen als text + CHECK (keine CREATE TYPE ... AS ENUM)
--
-- Jede CREATE-Anweisung muss in einer eigenen Transaktion laufen
-- (Migrationstool entsprechend konfigurieren). Die Tabelle schema_migration
-- legt der Migrations-Runner selbst an; sie ist nicht Teil dieses DDL.
-- Verweise auf später definierte Tabellen (z. B. session) sind bewusst ohne
-- Fremdschlüssel und im Kommentar mit „ohne FK“ markiert.
-- =====================================================================


-- =====================================================================
-- A. SYSTEM (mandantenübergreifend)
-- =====================================================================

CREATE TABLE identity (                            -- eine Person = ein Discord-Konto (mandantenübergreifend)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    discord_user_id text NOT NULL UNIQUE,          -- Snowflake-ID aus /users/@me
    discord_username text NOT NULL,
    discord_global_name text,
    avatar_hash     text,
    email           text,                          -- nur falls Scope 'email' genutzt wird (optional)
    mfa_enabled     boolean NOT NULL DEFAULT false,-- von Discord gemeldet, bei jedem Login aktualisiert
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
    last_login_at   timestamptz,                   -- letzte Discord-Anmeldung; ersetzt login_audit (SV-11)
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE super_user (
    identity_id     uuid PRIMARY KEY REFERENCES identity(id),
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_by      uuid REFERENCES identity(id),  -- null = Bootstrap über Deployment-Parameter
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_key      text NOT NULL UNIQUE,          -- Mandanten-ID (Kurzname, URL/Einladung/Auswahl), lower-case, 3-32 Zeichen, 'system' reserviert
    display_name    text NOT NULL,
    contact         text,
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','locked')),
    settings        jsonb NOT NULL DEFAULT '{}',   -- Schlüssel ausschließlich aus contracts/enums.json tenantSettingsKeys (DAT5-22):
                                                   -- userCorrections, exoUserLockNeedsAdmin (Standard true), exoUserMaxOpenLocks (Standard 3),
                                                   -- autoReactivateOnRemaining, autoReadyToProcess (Standard false), adminSelfApproval,
                                                   -- approvalDeadlineDays, defaultLanguage.
                                                   -- Keine Sicherheitsschluessel (SV-03): 2FA-Pflicht fuer Owner/Admin und Sitzungsdauer sind feste Regeln.
                                                   -- Unbekannte Schlüssel lehnt PATCH /web/v1/tenant/settings mit 422 validation.failed ab
    owner_member_id uuid,                          -- app_user.id des Owners (FA-BEN-06); FK nicht möglich (app_user folgt), Prüfung im Repository; null nur bis zur Annahme der Owner-Einladung;
                                                   -- Owner-Uebertragung (FA-BEN-09) setzt die Spalte sofort um, ohne Annahmefrist (E2)
    discord_guild_name text,                       -- FA-DIS-01 (nur Anzeige)
    discord_guild_id text,
    discord_invite_url text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (tenant_key <> 'system')
);

CREATE TABLE system_audit (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor           text NOT NULL CHECK (actor IN ('super_user','ops_cli')),  -- einfache Tabelle, kein manipulationssicherer Nachweis (SV-11)
    super_user_id   uuid REFERENCES super_user(identity_id),   -- null bei ops_cli
    tenant_id       uuid REFERENCES tenant(id),
    action          text NOT NULL,                 -- tenant.create, tenant.lock, invitation.create, super_user.add ...
    details         jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_system_audit_tenant ON system_audit (tenant_id, created_at);

-- Globale Referenzdaten -------------------------------------------------

CREATE TABLE dso_object (                          -- Objektkatalog aus OpenNGC: 13.957 Zeilen aus NGC.csv, dazu die Zeilen
                                                   -- der verwendeten addendum.csv-Version (13.957 + n_addendum; Dup/NonEx
                                                   -- werden nicht als eigene Zeile gefuehrt),
                                                   -- Feldabbildung und Importtests: specs/catalog/dso-import.md (WS-25/WS-27).
                                                   -- Der Website-Auszug (ngc.json, dso-catalog.js) liefert nur zusaetzliche
                                                   -- Namen/Aliase, Vorschaubilder und Wikipedia-Titel (WS-E4)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_id      text NOT NULL UNIQUE,          -- 'NGC 7380'
    names           jsonb NOT NULL DEFAULT '[]',   -- Aliase: ["Sh2-142","LBN 511","Zauberer-Nebel"]
    catalogs        jsonb NOT NULL DEFAULT '[]',   -- ["NGC","Sh2","LBN"] - Katalogkuerzel der Bezeichnungen, Grundlage des
                                                   -- Katalogfilters. Erlaubte Werte AUSSCHLIESSLICH aus
                                                   -- contracts/enums.json dsoCatalogPrefixes (M, NGC, IC, C, Sh2, LBN,
                                                   -- LDN, B, PGC, UGC, ESO, Mel, Cl); ein unbekanntes Kuerzel wird nicht
                                                   -- geschrieben, sondern erzeugt eine Importwarnung
                                                   -- (specs/catalog/dso-import.md 2)
    object_type     text NOT NULL,                 -- OpenNGC-Typcode aus NGC.csv Spalte Type, Vokabular in
                                                   -- contracts/enums.json dsoObjectTypes (WS-26):
                                                   -- G, GPair, GTrpl, GGroup, OCl, GCl, Cl+N, PN, HII, DrkN, EmN, Neb,
                                                   -- RfN, SNR, *, **, *Ass, Nova, Dup, NonEx, Other.
                                                   -- NICHT die Website-Kurzcodes (Gx, EN, RN, ...) - die Oberflaeche
                                                   -- zeigt Anzeigegruppen nach dsoObjectTypeGroups.
                                                   -- Dup/NonEx werden beim Import nicht als eigene Zeile gefuehrt
                                                   -- (Aliasaufloesung, specs/catalog/dso-import.md 3)
    constellation   text,
    ra_deg          double precision NOT NULL,     -- J2000
    dec_deg         double precision NOT NULL,
    mag_v           real,                          -- OpenNGC NGC.csv Spalte V-Mag (Johnson V); KEIN B-Wert hier eintragen
                                                   -- (AST-D6). Helligkeiten des Website-Auszugs sind gerundete Richtwerte
                                                   -- ohne Bandangabe und werden NICHT uebernommen (WS-E4)
    mag_b           real,                          -- OpenNGC NGC.csv Spalte B-Mag. Getrennt, weil B-V bei Emissionsnebeln > 1 mag betraegt: ein
                                                   -- gemischtes Feld verschiebt jede Helligkeitsfilterung und die Filterempfehlung
    mag_band_used   text CHECK (mag_band_used IS NULL OR mag_band_used IN ('V','B')),
                                                   -- welches Band die Anzeige benutzt, wenn nur eines vorliegt (AST-D6)
    surf_br_mag_arcsec2 real,                      -- OpenNGC NGC.csv Spalte SurfBr, mag/arcsec^2 - NUR fuer Flaechenobjekte sinnvoll. Die Sichtbarkeit
                                                   -- eines ausgedehnten Nebels haengt an der FLAECHENhelligkeit, nicht an mag_v: NGC 7000
                                                   -- hat mag_v 4, ist aber flaechig schwach (AST-D7). Regel des Schedulers ist es nicht; Anzeige,
                                                   -- Filterempfehlung und Zielvorschlaege duerfen mag_b und die
                                                   -- Flaechenhelligkeit nutzen (FK FA-FRM-13/15, WS-E4)
    size_major_arcmin real,                        -- OpenNGC NGC.csv Spalte MajAx, Bogenminuten
    size_minor_arcmin real,                        -- OpenNGC NGC.csv Spalte MinAx, Bogenminuten
    position_angle_deg real CHECK (position_angle_deg IS NULL OR (position_angle_deg >= 0 AND position_angle_deg < 180)),
                                                   -- Grossachsen-PA von Nord ueber Ost, Konvention [0, 180) - 180 Grad bezeichnet dieselbe
                                                   -- ACHSE wie 0 Grad und ist deshalb kein eigener Wert: der Import rechnet
                                                   -- PosAng mod 180 (180 -> 0), specs/catalog/dso-import.md 2 / T-KAT-01/03.
                                                   -- NULL, wenn MajAx oder MinAx fehlt (ohne beide Achsen keine Ellipse).
                                                   -- ANDERE Winkelart als der Kamera-PA in flip-rotation.md 3 (0..360,
                                                   -- Bild-Oberkante); nicht verwechseln (AST-D21)
    source          text NOT NULL,                 -- Herkunft der Zeile: 'openngc:NGC.csv <Version>' bzw.
                                                   -- 'openngc:addendum.csv <Version>'; die Version und das Abrufdatum
                                                   -- der verwendeten OpenNGC-Auslieferung stehen in
                                                   -- specs/catalog/dso-import.md 1 und im Importlauf. Namen, Aliase und
                                                   -- Bilder aus dem Website-Auszug aendern die Herkunft nicht
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_dso_object_type ON dso_object (object_type, constellation);

CREATE TABLE exo_catalog_entry (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog         text NOT NULL CHECK (catalog IN ('exoclock','nasa','toi')),
    planet          text NOT NULL,                 -- 'HAT-P-17b', 'TOI-4007.01'
    star            text NOT NULL,
    disposition     text CHECK (disposition IS NULL OR disposition IN ('APC','CP','FA','FP','KP','PC')),
                                                   -- TFOPWG: APC ambiguous, CP confirmed, FA false alarm, FP false positive, KP known,
                                                   -- PC candidate. FP/FA werden beim Import VERWORFEN und gezaehlt (AST-D5)
    ra_deg          double precision NOT NULL,
    dec_deg         double precision NOT NULL,
    mag_v_johnson   real,                          -- NASA sy_vmag (Johnson V)
    mag_r_cousins   real,                          -- NUR ExoClock: das NASA-Archiv hat kein Johnson-R (AST-D15)
    mag_sdss_g      real,                          -- NASA sy_gmag ist SDSS g, NICHT Gaia G
    mag_gaia_g      real,                          -- NASA sy_gaiamag
    mag_tess        real,                          -- NASA sy_tmag
    mag_band_used   text,                          -- Fallback-Kette: NASA V -> Gaia G -> TESS T; ExoClock V -> R (AST-D15)
    teff_k          real,
    distance_pc     real CHECK (distance_pc IS NULL OR distance_pc > 0),
                                                   -- PARSEC, die native Einheit von NASA sy_dist bzw. ExoClock. Nicht in
                                                   -- Lichtjahren speichern (AST-D14): die UI zeigt Lj = pc * 3,26156, die
                                                   -- Umrechnung gehoert in die Anzeige, nicht in die Ablage
    t0_bjd_tdb      double precision NOT NULL,
    t0_sigma_d      double precision,
    period_d        double precision NOT NULL CHECK (period_d > 0),  -- Tage; ohne > 0 gibt n0 = (JD - T0)/P unendlich (AST-D20)
    period_sigma_d  double precision,
    duration_h      real CHECK (duration_h IS NULL OR duration_h > 0),  -- T14 in STUNDEN (pl_trandur); nullable, weil oft leer -
                                                   -- T14 wird dann aus a_over_rs/inclination_deg/rp_over_rs gerechnet (AST-T18)
    duration_estimated boolean NOT NULL DEFAULT false,  -- true = aus Geometrie gerechnet, nicht aus dem Katalog (AST-T18)
    depth_mmag      real,
    rp_over_rs      real,
    a_over_rs       real,
    inclination_deg real CHECK (inclination_deg IS NULL OR inclination_deg BETWEEN 0 AND 180),  -- Grad (AST-D20)
    planet_radius_re real,
    eq_temp_k       real,
    exoclock_priority text,                        -- alert/high/medium/low
    o_minus_c_min   real,
    min_aperture_mm real CHECK (min_aperture_mm IS NULL OR min_aperture_mm > 0),
                                                   -- MILLIMETER. ExoClock liefert Zoll; beim Import mit 25,4 multiplizieren
                                                   -- (AST-D13). Teleskope stehen ueberall in mm (FA-TEL-01), deshalb ist der
                                                   -- Vergleich aus FA-EXO-07 nur ohne Einheitenwechsel verlaesslich
    min_aperture_estimated boolean NOT NULL DEFAULT false,
    amateur_reachable boolean NOT NULL DEFAULT true,
    fetched_at      timestamptz NOT NULL,
    UNIQUE (catalog, planet)
);
CREATE INDEX ASYNC ix_exo_catalog_planet ON exo_catalog_entry (planet);

CREATE TABLE weather_cache (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lat_round       numeric(6,3) NOT NULL,
    lon_round       numeric(7,3) NOT NULL,
    model_set       text NOT NULL,                 -- Modellsatz des Laufs, Teil des UNIQUE-Schluessels unten: ein Standort
                                                   -- haelt je Modellsatz EINE Zeile, ein Wechsel der Kette legt also eine
                                                   -- neue Zeile an und macht die alte nicht ungueltig (WS-16).
                                                   -- Europa: 'icon-d2+harmonie+icon+ecmwf+gem+cams'
                                                   -- sonst:  'hrrr+gem+gfs+ecmwf+nbm+cams'
    payload         jsonb NOT NULL,                -- Aufbau (Einheiten und Formeln: specs/engine/weather.md):
                                                   --  hours[]: Rohwerte je Stunde (cloudTotalPct + low/mid/high, tempC,
                                                   --   dewPointC, humidityPct, wind10Kmh, gust10Kmh, windDir10Deg,
                                                   --   wind250/500/700/850Kmh mit Richtungen, surfacePressureHPa,
                                                   --   visibilityM, precipMm, precipProbPct, weatherCode, aod, dustUgM3,
                                                   --   pwvMm), abgeleitet jetKmh, shearKmh und moonAltDeg (geometrische
                                                   --   topozentrische Mondhoehe in Grad zum Stundenmittelpunkt
                                                   --   tUnix + 1800, Grundlage von moonFreeSec - NICHT die
                                                   --   Planungs-Mondhoehe aus specs/engine/moon.md), Herkunft modelId
                                                   --   (d2|eu|global|dini|hrrr|gem|gfs), cloudSrc (dini|gem|null),
                                                   --   nest (bool), aerosolMissing (bool, WS-E2), seeingIncomplete
                                                   --   (bool, WS-04a), dazu cloudScore, seeingScore,
                                                   --   transparencyScore (null ohne Aerosol), overallScore und
                                                   --   ratingIndex (0..4, ganzzahlig)
                                                   --  nights[]: je Nacht nightMean ueber die astronomische Dunkelheit
                                                   --   mit coveredSec, darknessSec und coverage sowie bestes Fenster
                                                   --   (Beginn, Ende, Dauer, mondfreier Anteil in Sekunden, meanScore,
                                                   --   fair) und die Kennzeichen aerosolMissing/seeingIncomplete
                                                   --   (WS-09/WS-10)
                                                   -- Scores werden UNGERUNDET gespeichert; q(x, 1e3) erst unmittelbar
                                                   -- vor Vergleich, outputHash und Ausgabe (WS-08)
                                                   -- Niederschlag wird gespeichert und angezeigt, geht aber in KEINE
                                                   -- Bewertung ein (WS-E1)
    fetched_at      timestamptz NOT NULL,
    expires_at      timestamptz NOT NULL,
    UNIQUE (lat_round, lon_round, model_set)
);


-- =====================================================================
-- B. MANDANT, BENUTZER, BERECHTIGUNG
-- =====================================================================

CREATE TABLE app_user (                            -- Mitgliedschaft einer Identität in einem Mandanten (Rolle je Mandant)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    identity_id     uuid NOT NULL REFERENCES identity(id),
    display_name    text NOT NULL,                 -- Vorbelegung aus Discord, im Mandanten änderbar
    role            text NOT NULL CHECK (role IN ('admin','user')),   -- Owner = tenant.owner_member_id (immer role='admin'); keine Befristung (E2),
                                                   -- Rollenwechsel wirken ab der naechsten Anfrage (Sitzung liest die Mitgliedschaft je Anfrage, SV-01)
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','removed')),
    invited_by      uuid REFERENCES app_user(id),
    last_login_at   timestamptz,                   -- letzte Anmeldung im Mandanten (POST /auth/context bzw. Callback mit direkter Mandantenwahl, FA-SU-03)
    allowed_rig_ids jsonb,                         -- optional (FA-BEN-05), null = alle
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, identity_id)
);
CREATE INDEX ASYNC ix_app_user_identity ON app_user (identity_id, status);

CREATE TABLE invitation (                          -- Einladungslink (FA-BEN-01)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    token_hash      text NOT NULL UNIQUE,          -- SHA-256 des Link-Tokens (256 Bit zufaellig, base64url); nie exportiert
    role            text NOT NULL CHECK (role IN ('owner','admin','user')),  -- 'owner' nur vom Super User bzw. ops-cli
    discord_user_id text,                          -- optional: nur für dieses Discord-Konto gültig
    note            text,
    max_uses        smallint NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 50),
    used_count      smallint NOT NULL DEFAULT 0,
    expires_at      timestamptz NOT NULL,
    created_by_member uuid REFERENCES app_user(id),
    created_by_super uuid REFERENCES super_user(identity_id),
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (role = 'user' OR max_uses = 1)          -- Owner- und Admin-Einladungen genau einmal; Owner-Einladung bei vorhandenem Owner -> invitation.invalid (TK 5.2)
);
CREATE INDEX ASYNC ix_invitation_tenant ON invitation (tenant_id, expires_at);
CREATE INDEX ASYNC ix_invitation_expiry ON invitation (expires_at);   -- Job-Index

CREATE TABLE auth_session (                        -- Anmeldesitzung (Cookie __Host-npm_sid, SV-01); Logout/Widerruf = Zeile loeschen
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_hash    text NOT NULL UNIQUE,          -- SHA-256 des Cookie-Werts (256 Bit zufaellig), Klartext nie gespeichert; je Anfrage eine indizierte Abfrage
    identity_id     uuid NOT NULL REFERENCES identity(id),
    tenant_id       uuid REFERENCES tenant(id),    -- gewaehlter Mandant (POST /auth/context); null = System-Kontext bzw. noch keine Auswahl
    context         text NOT NULL CHECK (context IN ('tenant','system','select')),
    user_agent      text,                          -- Anzeige in der Sitzungsliste
    ip_truncated    text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),  -- hoechstens alle 5 min geschrieben; Leerlauf-Ablauf: last_seen_at + 14 Tage (feste Konstante)
    expires_at      timestamptz NOT NULL           -- Hoechstdauer: created_at + 30 Tage (feste Konstante), nie verlaengert
);
CREATE INDEX ASYNC ix_auth_session_identity ON auth_session (identity_id);   -- Sitzungsliste, alle Sitzungen einer Identitaet beenden
CREATE INDEX ASYNC ix_auth_session_expiry ON auth_session (expires_at);   -- Aufraeumen abgelaufener Zeilen durch api bei der Anmeldung (Hoechstdauer oder Leerlauf)

CREATE TABLE user_preference (                     -- ersetzt Astro PMs AppSettings (UI-Zustände, Filter, Einheiten)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    user_id         uuid NOT NULL REFERENCES app_user(id),   -- Einstellungen je Mitgliedschaft
    pref_key        text NOT NULL,                 -- 'exo.filters', 'weather.units', 'projects.viewMode', 'skyview.overlays' ...
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, pref_key)
);

CREATE TABLE identity_preference (                 -- mandantenübergreifende Einstellungen (Sprache, Theme; auch Super User)
    identity_id     uuid NOT NULL REFERENCES identity(id),
    pref_key        text NOT NULL,
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (identity_id, pref_key)
);

CREATE TABLE notification (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid REFERENCES tenant(id),     -- NULL = Systembenachrichtigung an einen Super User (z. B. alert.*, owner.reassigned)
    recipient_id    uuid REFERENCES app_user(id),   -- Mitglied im Mandanten ...
    recipient_identity_id uuid REFERENCES identity(id),  -- ... oder Identität (Super User ohne Mitgliedschaft); genau eines von beiden
    CHECK ((recipient_id IS NOT NULL) <> (recipient_identity_id IS NOT NULL)),
    kind            text NOT NULL,                 -- Werte ausschließlich aus contracts/enums.json notificationKinds (CI-Test prüft Schema gegen enums.json); u. a. submission.new, approval.approved, approval.returned, deadline.near, project.completed, vote.subject_resubmitted, submission.edited_by_admin, transit.confirmation_needed, alert.* (Betriebsalarme) ...  – Discord-Zustellung über job(kind='discord_post')
    project_id      uuid,                          -- ohne FK (Tabelle project folgt später)
    payload         jsonb NOT NULL DEFAULT '{}',
    read_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_notification_recipient ON notification (tenant_id, recipient_id, read_at);
CREATE INDEX ASYNC ix_notification_identity  ON notification (recipient_identity_id, read_at);

CREATE TABLE change_log (                          -- Änderungsverlauf je Objekt (FA-BER-03, NFA-12)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    entity          text NOT NULL,                 -- 'project','exposure_line','rig','app_user' (Rollenwechsel: diff.reason optional) ...
    entity_id       uuid NOT NULL,
    user_id         uuid REFERENCES app_user(id),   -- handelndes Mitglied; bei Rollenwechseln = Rolle vergeben von
    action          text NOT NULL,                 -- create/update/delete
    diff            jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_change_log_entity ON change_log (tenant_id, entity, entity_id, created_at);


-- =====================================================================
-- C. AUSRÜSTUNG
-- =====================================================================

CREATE TABLE site (                                -- Astro PM: ObservingSites
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    name            text NOT NULL,
    pier_name       text,
    observatory_type text NOT NULL DEFAULT 'open_air'
                    CHECK (observatory_type IN ('open_air','dome','roll_off_roof','fixed_pier','portable','remote_hosted')),
    latitude_deg    double precision NOT NULL CHECK (latitude_deg BETWEEN -89.9 AND 89.9),  -- Pole ausgeschlossen: bei |phi|=90 ist cos(phi)=0,
                                                   -- die Hoehe zeitunabhaengig und 'LHA=0' nicht eindeutig loesbar (AST-N18)
    longitude_deg   double precision NOT NULL CHECK (longitude_deg BETWEEN -180 AND 180),  -- OST POSITIV, West negativ (WGS84, lambda_Ost wie
                                                   -- flip-rotation.md 1.1). West-positiv importiert dreht den Stundenwinkel um 2*lambda:
                                                   -- in Texas 197 Grad = 13 h (AST-G04/D12). Plausibilitaetspruefung gegen die IANA-Zone:
                                                   -- |lambda/15h - mittlerer tz-Offset| > 3 h => Warnung 'Laenge vermutlich falsch signiert'
    elevation_m     real NOT NULL DEFAULT 0 CHECK (elevation_m BETWEEN -430 AND 9000),  -- Meter ueber NN; bewusst UNBENUTZT in der
                                                   -- Rechnung: keine Kimmtiefe, Druck fest 1010 hPa (night.md 2, AST-N13)
    bortle_class    real CHECK (bortle_class IS NULL OR bortle_class BETWEEN 1 AND 9),  -- Skala 1..9 (AST-D22)
    time_zone       text NOT NULL,                 -- IANA, z. B. 'America/Chicago' (Astro PM speichert Windows-Namen)
    weather_safety_url text,
    notes           text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);
-- Kein Custom Horizon (bewusst ausgeschlossen).

CREATE TABLE site_link (                           -- Remote-Verbindungen OHNE Passwörter (FA-STO-05)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    site_id         uuid NOT NULL REFERENCES site(id),
    service_type    text NOT NULL,                 -- anydesk, rustdesk, rdp, web, ...
    name            text NOT NULL,
    remote_id_or_url text NOT NULL,
    notes           text NOT NULL DEFAULT '',
    is_default      boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_site_link_site ON site_link (tenant_id, site_id);

CREATE TABLE telescope (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    name            text NOT NULL,
    brand           text NOT NULL DEFAULT '',
    model           text NOT NULL DEFAULT '',
    optical_design  text NOT NULL,                 -- apochromatic_refractor, achromat, newtonian, rc, sct, maksutov, cdk, cassegrain, rasa
    aperture_mm     real NOT NULL CHECK (aperture_mm > 0),
    focal_length_mm real NOT NULL CHECK (focal_length_mm > 0),
    reducer_factor  real NOT NULL DEFAULT 1.0 CHECK (reducer_factor > 0),  -- 1.0 = kein Reducer; Astro PM benutzt 0 = none, der Import
                                                   -- bildet 0 auf 1.0 ab - ein 0-Wert gaebe effFocalMm = 0 und damit Massstab unendlich (AST-G08)
    obstruction_pct real NOT NULL DEFAULT 0,
    image_circle_mm real, backfocus_mm real, spot_axis_um real, spot_edge_um real,
    weight_kg real, length_mm real, focuser_travel_mm real, focuser_mm_per_turn real,
    notes           text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE camera (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    name            text NOT NULL,
    brand           text NOT NULL DEFAULT '',
    model           text NOT NULL DEFAULT '',
    sensor_name     text NOT NULL DEFAULT '',
    width_px        integer NOT NULL CHECK (width_px > 0),        -- native Pixelzahl (AST-G08)
    height_px       integer NOT NULL CHECK (height_px > 0),       -- native Pixelzahl (AST-G08)
    pixel_size_um   real NOT NULL CHECK (pixel_size_um > 0),      -- Mikrometer (AST-G08)
    bit_depth       smallint NOT NULL DEFAULT 16,
    is_cooled       boolean NOT NULL DEFAULT true,
    cooling_setpoint_c real,                        -- Kuehl-Soll in Grad C (null = keine Pruefung); Plugin warnt nur, belichtet weiter (NT-E2)
    cooling_tolerance_c real NOT NULL DEFAULT 1 CHECK (cooling_tolerance_c > 0),  -- zulaessige |Temperatur - Soll| in K (NT-E2)
    is_color        boolean NOT NULL DEFAULT false,
    read_noise_e    real, full_well_e real, gain_e_per_adu real,
    quantum_efficiency_pct real DEFAULT 80 CHECK (quantum_efficiency_pct IS NULL OR quantum_efficiency_pct BETWEEN 0 AND 100),
                                                   -- PROZENT wie transmission_pct - vorher ein Bruch (0,8) neben Prozentspalten
                                                   -- und damit eine Faktor-100-Quelle in abgeleiteten Rechnungen (AST-D22)
    dark_current_e_s_20c real DEFAULT 0.005,
    default_gain    integer,                       -- null = NINA-Standard (-1) (NT-38)
    default_offset  integer,                       -- null = NINA-Standard (-1) (NT-38)
    default_binning smallint NOT NULL DEFAULT 1,
    default_readout_mode text NOT NULL DEFAULT 'Default',
    supported_binning jsonb NOT NULL DEFAULT '[1,2]',          -- [1,2,3,4]
    gain_modes      jsonb NOT NULL DEFAULT '[]',               -- [{name,gain,readNoiseE,fullWellE,ePerAdu}]
    readout_modes   jsonb NOT NULL DEFAULT '["Default"]',      -- exakt wie im Treiber
    nina_reported   jsonb,                                     -- vom Plugin gemeldete Modi/Gain-Grenzen (FA-KAM-07)
    nina_report_dismissed_hash text,
    notes           text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE moon_profile (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),   -- Built-ins werden je Mandant angelegt
    name            text NOT NULL,
    description     text NOT NULL DEFAULT '',
    separation_deg  real NOT NULL CHECK (separation_deg BETWEEN 0 AND 180),  -- Grad geforderter Abstand bei Vollmond (AST-M12)
    width_days      real NOT NULL CHECK (width_days >= 0),  -- Tage bis der geforderte Abstand auf die Haelfte faellt (AST-M12)
    relax_scale     real NOT NULL CHECK (relax_scale >= 0),  -- Grad geforderter Abstand je Grad Mondhoehe unter der Max-Hoehe;
                                                   -- KEIN Multiplikator (moon.md 1, AST-M2/M12)
    moon_min_alt_deg real NOT NULL CHECK (moon_min_alt_deg BETWEEN -90 AND 90),  -- Hoehe, unter der die Forderung ganz entfaellt (AST-M12)
    moon_max_alt_deg real NOT NULL CHECK (moon_max_alt_deg BETWEEN -90 AND 90),  -- Hoehe, AB DER der volle Abstand gilt - gegenueber
                                                   -- Astro PM INVERTIERTE Semantik, KEIN oberes Limit (moon.md 1, AST-M8)
    max_illumination_pct real NOT NULL CHECK (max_illumination_pct BETWEEN 0 AND 100),  -- Prozent (AST-M12)
    moon_must_be_down boolean NOT NULL DEFAULT false,  -- harte Regel: nur Stufe 1 (Built-in "Kein Mond", FK 8.2)
    is_built_in     boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name),
    CHECK (moon_min_alt_deg < moon_max_alt_deg)    -- bei min > max wird f negativ, We < 0 und der geforderte Abstand kollabiert
);
-- Seed je Mandant (Werte aus Astro PM):
-- No Moon 180/14/0/-90/-2/0 · Strict 90/8/0/-15/5/30 · Moderate 60/5/2/-15/5/60 · Relaxed 25/3/3/-15/5/80

CREATE TABLE filter (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    telescope_id    uuid REFERENCES telescope(id), -- optionale Zuordnung fuer Uebersichten, NICHT Filterrad (maszgeblich: rig.filter_wheel, NT-43)
    short_name      text NOT NULL,                 -- Anzeige-/Planungsschluessel: 'HA','OIII','LUMINOS'; NINA-Name kommt aus rig.filter_wheel (NT-E1)
    full_name       text NOT NULL DEFAULT '',
    brand           text NOT NULL DEFAULT '',
    filter_type     text NOT NULL CHECK (filter_type IN ('broadband','narrowband','luminance','uv_ir_cut','light_pollution','photometric','other')),
    size            text, shape text, mount_type text,
    bandwidth_nm    real,
    center_wavelength_nm real,
    photometric_band text NOT NULL DEFAULT 'none' CHECK (photometric_band IN ('U','B','V','Rc','Ic','g','r','i','z','clear','lum','none')),
                                                   -- Abbildung der Transit-Filterempfehlung auf das Filterrad (FA-EXO-08, NT-41)
    transmission_pct real,
    thickness_mm    real,
    color_hex       text NOT NULL DEFAULT '#CCCCCC',
    default_on_new_project boolean NOT NULL DEFAULT false,
    default_exposure_s real,
    default_moon_profile_id uuid REFERENCES moon_profile(id),
    notes           text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, short_name)                 -- Kurzname ist Planungsschluessel, steckt im PK von
                                                   -- flat_combination und in exposure_line.filter_short_name (FA-FIL-04);
                                                   -- die Verbindung zu NINA stellt rig.filter_wheel her (NT-E1)
);
CREATE INDEX ASYNC ix_filter_telescope ON filter (tenant_id, telescope_id);

CREATE TABLE exposure_template (                   -- Astro PM: ExposurePlanTemplates
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    name            text NOT NULL,                 -- 'LRGB Gain 125'
    telescope_id    uuid REFERENCES telescope(id),
    camera_id       uuid REFERENCES camera(id),
    notes           text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exposure_template_line (              -- Astro PM: ExposurePlanItems
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    template_id     uuid NOT NULL REFERENCES exposure_template(id),
    filter_id       uuid REFERENCES filter(id),
    filter_short_name text NOT NULL,               -- Fallback, falls Filter gelöscht
    exposure_s      real NOT NULL CHECK (exposure_s > 0),
    planned_count   integer NOT NULL CHECK (planned_count >= 0),
    gain            integer, offset_adu integer,   -- null = NINA-Standard (-1) (NT-38)
    binning         smallint NOT NULL DEFAULT 1,
    readout_mode    text,
    moon_mode       text NOT NULL DEFAULT 'profile' CHECK (moon_mode IN ('profile','project_default','none')),
    moon_profile_id uuid REFERENCES moon_profile(id),
    enabled         boolean NOT NULL DEFAULT true,
    order_index     smallint NOT NULL DEFAULT 0
);
CREATE INDEX ASYNC ix_template_line_template ON exposure_template_line (tenant_id, template_id, order_index);

CREATE TABLE rig (                                 -- Astro PM: ImagingSystems
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    name            text NOT NULL,
    site_id         uuid NOT NULL REFERENCES site(id),
    telescope_id    uuid NOT NULL REFERENCES telescope(id),
    camera_id       uuid NOT NULL REFERENCES camera(id),
    show_in_planning boolean NOT NULL DEFAULT true, -- "In Framing und Simulator anzeigen" (FA-RIG-05)
    nina_delivery_enabled boolean NOT NULL DEFAULT true,  -- "An NINA ausliefern" (Rig in Betrieb)
    filter_wheel    jsonb NOT NULL DEFAULT '[]',   -- Filterradbelegung (FA-RIG-14, NT-E1) je Platz:
                                                   -- [{position, filterId, ninaFilterName, ninaConfirmedAt, ninaConfirmedBy}]
                                                   -- ninaFilterName = bestaetigter NINA-Name (= nina_filter_name; null = nicht zugeordnet),
                                                   -- ninaConfirmedAt = Zeitpunkt der Bestaetigung (= nina_confirmed_at; null = unbestaetigt),
                                                   -- ninaConfirmedBy = app_user.id (Admin/Owner). Meldet der Heartbeat an einem Platz einen
                                                   -- anderen Namen, setzt die Anwendung ninaConfirmedAt = null (Alarm filter_wheel_changed).
                                                   -- Nur Zeilen mit bestaetigtem Namen werden geplant (Diagnose filter_not_found).
    nina_filter_wheel jsonb,                       -- vom Plugin gemeldete Belegung [{position, name, focusOffset}] + reportedAt (Heartbeat, NT-E1)
    default_template_id uuid REFERENCES exposure_template(id),
    default_rotation_deg double precision CHECK (default_rotation_deg IS NULL OR (default_rotation_deg >= 0 AND default_rotation_deg < 360)),  -- ohne Rotator: fester Kamerawinkel (FA-RIG-10); double wegen der 1e-6-Zusage (AST-G07)
    has_rotator     boolean NOT NULL DEFAULT false,
    rotation_tolerance_deg real NOT NULL DEFAULT 5 CHECK (rotation_tolerance_deg BETWEEN 0 AND 90),
    skip_on_rotation_mismatch boolean NOT NULL DEFAULT false,
    session_report_discord boolean NOT NULL DEFAULT false,  -- Nachtbericht nach Discord (FA-AUS-21)
    -- Scheduler-Einstellungen (Astro PM: SimSettingsJson) als Spalten
    strategy        text NOT NULL DEFAULT 'proportional' CHECK (strategy IN ('proportional','manual_priority')),
    playback        text NOT NULL DEFAULT 'time_aware'   CHECK (playback IN ('time_aware','sequential')),
    sort_chain      jsonb NOT NULL DEFAULT '["lowest_peak_altitude","setting_soonest","most_remaining","constrained"]',  -- Schlüssel: contracts/enums.json; Standard wie Astro PM (specs/engine/sort-chain.md)
    bonus_enabled   boolean NOT NULL DEFAULT false,      -- freie Zeit füllen, Bonus-Belichtungen ohne Obergrenze (FA-SCH-04)
    overshoot_pct   real NOT NULL DEFAULT 0,             -- garantierte Zusatzframes ⌈Geplant × %⌉, zählen als Planungsbedarf
    mosaic_panels_independent boolean NOT NULL DEFAULT true,  -- „Mosaik-Panels getrennt planen“ (Astro PM MosaicPanelPreference)
    dither_enabled  boolean NOT NULL DEFAULT true,
    dither_every    smallint NOT NULL DEFAULT 1,
    filter_switch_enabled boolean NOT NULL DEFAULT false,
    filter_switch_every smallint NOT NULL DEFAULT 10,
    filter_switch_tolerance_pct real NOT NULL DEFAULT 50 CHECK (filter_switch_tolerance_pct BETWEEN 0 AND 100),
    flats_enabled   boolean NOT NULL DEFAULT false,
    flats_full_set  boolean NOT NULL DEFAULT false,
    flat_count      smallint NOT NULL DEFAULT 20 CHECK (flat_count > 0),
    dark_flats_enabled boolean NOT NULL DEFAULT true,
    dark_flat_count smallint CHECK (dark_flat_count > 0),  -- null = wie flat_count (FA-SCH-08)
    flats_source    text NOT NULL DEFAULT 'panel' CHECK (flats_source IN ('panel','sky')),
                                                   -- panel: ab darknessEndUtc, geparkt; sky: Himmelsflats Sonne -8 bis -2 Grad,
                                                   -- flatsNotAfterUtc, nicht parken (FA-SCH-08, NT-40)
    -- Meridian-Flip (FA-SCH-17, Bedeutung wie NINA-Trigger)
    flip_enabled    boolean NOT NULL DEFAULT true,
    flip_after_meridian_min real NOT NULL DEFAULT 5,
    flip_max_after_meridian_min real NOT NULL DEFAULT 15,
    flip_pause_before_meridian_min real NOT NULL DEFAULT 0,
    flip_duration_s real NOT NULL DEFAULT 240,
    CHECK (flip_max_after_meridian_min >= flip_after_meridian_min),
    overhead        jsonb NOT NULL DEFAULT '{}',   -- slewCenterS, filterChangeS, ditherSettleS, afEveryMin, afDurationS, downloadS
    settings_version integer NOT NULL DEFAULT 1,   -- erhöht bei jeder Änderung (Sync an NINA)
    notes           text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

-- Lease in eigener Tabelle, damit der 60-s-Heartbeat nicht mit Einstellungsänderungen am Rig kollidiert (OCC, DAT-17)
CREATE TABLE rig_lease (
    rig_id          uuid PRIMARY KEY REFERENCES rig(id),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    active_session_id uuid,                        -- höchstens eine laufende Session je Rig (FA-RIG-06)
    lease_until     timestamptz,                   -- jetzt + 3 min, verlängert per Heartbeat (FA-RIG-06)
    offline_until   timestamptz,                   -- Offline-Modus des Plugins: Lease/Überwachung eingefroren bis (max. 14 Tage, FA-NIN-04)
    released_session_id uuid,                      -- per Admin-Freigabe (lease/release) ausgeschlossene Session: ihre Heartbeats holen die Lease nicht zurueck (M5);
                                                   -- ein Heartbeat mit sessionId uebernimmt die Lease sonst wieder, wenn active_session_id IS NULL OR = sessionId; neues POST /sessions setzt NULL
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_rig_lease_tenant ON rig_lease (tenant_id, lease_until);
CREATE INDEX ASYNC ix_rig_lease_due ON rig_lease (lease_until);  -- Job-Index (Ausnahme von der tenant_id-Regel, TK 6.1): Lease-Sweep in tick-5min laeuft ueber alle Mandanten

CREATE TABLE nina_instance (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    rig_id          uuid NOT NULL REFERENCES rig(id),
    name            text NOT NULL,
    token_hash      text NOT NULL UNIQUE,          -- SHA-256 des Sync-Tokens (ein Token = eine Instanz = genau ein Rig)
    token_prefix    text NOT NULL,                 -- erste Zeichen zur Anzeige
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
    plugin_version  text,
    engine_version  text,
    profile_lat     double precision,
    profile_lon     double precision,
    last_state      jsonb,                         -- letzter Heartbeat-Inhalt (inkl. Flip-Trigger-Einstellungen der Sequenz, zuletzt gemessener Positionswinkel)
    last_calls      jsonb,                         -- Ringpuffer letzter API-Aufrufe/Fehler (FA-ADM-06)
    last_seen_at    timestamptz,                   -- letzte Plugin-Anfrage; Token ohne Ablauf, Widerruf wirkt sofort (SV-08)
    settings_version_fetched integer,              -- zuletzt per /bootstrap abgerufene rig.settings_version (FA-SIM-09)
    settings_fetched_at timestamptz,
    created_by      uuid REFERENCES app_user(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_nina_instance_rig ON nina_instance (tenant_id, rig_id);


-- =====================================================================
-- D. PROJEKTE, FREIGABE, EXOPLANETEN
-- =====================================================================

CREATE TABLE project (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    rig_id          uuid REFERENCES rig(id),       -- bei Entwurf/Einreichung: Wunsch-Rig in requested_rig_id
    requested_rig_id uuid REFERENCES rig(id),
    created_by      uuid NOT NULL REFERENCES app_user(id),
    project_type    text NOT NULL DEFAULT 'deep_sky' CHECK (project_type IN ('deep_sky','exoplanet')),
    name            text NOT NULL,
    target_name     text,                          -- Pflicht ab Einreichung (Anwendung)
    target_type     text,                 -- galaxy, emission_nebula, reflection_nebula, dark_nebula, planetary_nebula, snr, open_cluster, globular_cluster, star, comet, exoplanet, other
    dso_object_id   uuid REFERENCES dso_object(id),
    catalog_names   text NOT NULL DEFAULT '',
    description_md  text NOT NULL DEFAULT '',      -- Markdown statt RTF (Astro PM)
    ra_deg          double precision,              -- J2000 (Astro PM: RaHours); Entwürfe dürfen unvollständig sein
    dec_deg         double precision,
    rotation_deg    double precision NOT NULL DEFAULT 0 CHECK (rotation_deg >= 0 AND rotation_deg < 360),  -- Positionswinkel Nord ueber Ost (AST-G07)
    panel_rows      smallint NOT NULL DEFAULT 1,
    panel_columns   smallint NOT NULL DEFAULT 1,
    panel_overlap_pct real NOT NULL DEFAULT 20,
    -- Bedingungen
    min_altitude_deg real NOT NULL DEFAULT 30 CHECK (min_altitude_deg BETWEEN 0 AND 90),  -- Grad, scheinbare Hoehe (AST-D20)
    min_time_on_target_h real NOT NULL DEFAULT 1.0,
    twilight        text NOT NULL DEFAULT 'astronomical' CHECK (twilight IN ('astronomical','nautical','civil')),
    moon_avoidance_enabled boolean NOT NULL DEFAULT false,
    moon_must_be_down boolean NOT NULL DEFAULT false,  -- Gegenstueck zu moon_profile.moon_must_be_down; ohne diese Spalte konnte
                                                   -- exposure_line.moon_mode = 'project_default' nie "Kein Mond" ausdruecken (AST-M7)
    moon_separation_deg real NOT NULL DEFAULT 60 CHECK (moon_separation_deg BETWEEN 0 AND 180),  -- Grad (AST-M12)
    moon_width_days real NOT NULL DEFAULT 5 CHECK (moon_width_days >= 0),        -- Tage (AST-M12)
    moon_relax_scale real NOT NULL DEFAULT 2 CHECK (moon_relax_scale >= 0),      -- Grad je Grad, KEIN Multiplikator; Vorgabe an das
                                                   -- Built-in "Moderat" angeglichen (vorher 1 = undokumentierte vierte Stufe, AST-M7/M2)
    moon_min_alt_deg real NOT NULL DEFAULT -15 CHECK (moon_min_alt_deg BETWEEN -90 AND 90),
    moon_max_alt_deg real NOT NULL DEFAULT 5 CHECK (moon_max_alt_deg BETWEEN -90 AND 90),
    moon_max_illumination_pct real NOT NULL DEFAULT 60 CHECK (moon_max_illumination_pct BETWEEN 0 AND 100),  -- Prozent; Vorgabe an
                                                   -- "Moderat" angeglichen (vorher 40, AST-M7)
    -- Status, Freigabe, Priorität
    approval_status text NOT NULL DEFAULT 'draft'
                    CHECK (approval_status IN ('draft','submitted','approved','returned','rejected')),
    status          text                           -- Projektstatus erst ab Freigabe (null davor)
                    CHECK (status IN ('planning','active','on_hold','ready_to_process','unfinished','completed','archived')),
    priority        integer NOT NULL DEFAULT 1000, -- Reihenfolge je Rig (1 = höchste)
    request_period_from date,
    request_period_to   date,
    submitter_rank  smallint CHECK (submitter_rank >= 1),  -- Rang beim Einreicher, nur im Status submitted (FA-FRG-15)
    content_changed_at timestamptz,                -- letzte inhaltliche Änderung: Admin-Änderung im Status submitted bzw. erneute Einreichung nach Überarbeitung
    effort_stale    boolean NOT NULL DEFAULT true, -- Aufwand-Kennzeichen neu berechnen (Worker)
    request_comment text,
    start_date      date,
    due_date        date,
    completed_at    timestamptz,
    -- Aufwand-Kennzeichen (FA-PRJ-23, FK 8.9), serverseitig berechnet
    effort_tag      text CHECK (effort_tag IN ('single_night','multi_night','not_feasible','transit')),
    effort_nights   smallint,                      -- geschätzte klare Nächte (multi_night, specs/engine/effort.md)
    effort_detail   jsonb,                         -- {requiredHours, bestNight, bestNightHoursByStage, earliestCompletion, achievablePct, limitingFactor, fullyObservable, coveragePct, stride}
    effort_input_hash text,                        -- Neuberechnung nur bei geänderter Eingabe
    effort_computed_at timestamptz,
    thumbnail_s3_key text,                         -- Vorschaubild aus HiPS (kein BLOB in der DB)
    notes_md        text NOT NULL DEFAULT '',
    version         integer NOT NULL DEFAULT 1,    -- optimistische Sperre / Sync
    deleted_at      timestamptz,                   -- Papierkorb (FA-PRJ-15, E4): Loeschen setzt IMMER deleted_at; Ansicht Geloescht mit Wiederherstellen
                                                   -- fuer Admin/Owner; kein automatisches Endloeschen; geloeschte Projekte nicht an NINA ausgeliefert
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK ((approval_status = 'approved') = (status IS NOT NULL))
);
CREATE INDEX ASYNC ix_project_rig_status ON project (tenant_id, rig_id, status, priority);
CREATE INDEX ASYNC ix_project_approval   ON project (tenant_id, approval_status, created_by);
CREATE INDEX ASYNC ix_project_deleted    ON project (tenant_id, deleted_at);   -- Ansicht Geloescht (E4)

CREATE TABLE favorite (
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    user_id         uuid NOT NULL REFERENCES app_user(id),
    project_id      uuid NOT NULL REFERENCES project(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, project_id)
);

CREATE TABLE project_panel (                       -- Astro PM: MosaicPanels
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    project_id      uuid NOT NULL REFERENCES project(id),
    panel_index     smallint NOT NULL,
    label           text NOT NULL DEFAULT 'Main',
    ra_deg          double precision NOT NULL,
    dec_deg         double precision NOT NULL,
    rotation_deg    double precision NOT NULL DEFAULT 0 CHECK (rotation_deg >= 0 AND rotation_deg < 360),  -- Positionswinkel Nord ueber Ost (AST-G07)
    notes           text NOT NULL DEFAULT '',
    deleted_at      timestamptz,                   -- Panels mit Aufnahmen weich loeschen, ohne Aufnahmen endgueltig (FA-PRJ-06, E4)
    UNIQUE (project_id, panel_index)
);

CREATE TABLE exposure_line (                       -- Astro PM: ExposureSets (ohne Ordner-/Remote-/Inspector-Felder)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    project_id      uuid NOT NULL REFERENCES project(id),
    panel_id        uuid NOT NULL REFERENCES project_panel(id),
    filter_id       uuid REFERENCES filter(id),
    filter_short_name text NOT NULL,
    exposure_s      real NOT NULL CHECK (exposure_s > 0),
    planned_count   integer NOT NULL CHECK (planned_count >= 0),
    gain            integer,                       -- null = NINA-Standard (-1) (NT-38)
    offset_adu      integer,                       -- null = NINA-Standard (-1) (NT-38)
    binning         smallint NOT NULL DEFAULT 1,
    readout_mode    text NOT NULL,
                                                   -- Sperre (NT-E3): hat die Zeile Aufnahmen (acquired_count + bonus_count > 0 bzw. capture vorhanden),
                                                   -- sind filter_id/filter_short_name, exposure_s, gain, offset_adu, binning und readout_mode unveraenderlich
                                                   -- (409 line.locked_by_captures); aenderbar: planned_count, moon_mode/moon_profile_id, enabled.
                                                   -- Aenderung ueber POST .../lines/{lineId}/duplicate (neue Zeile, Zaehler 0)
    moon_mode       text NOT NULL DEFAULT 'profile' CHECK (moon_mode IN ('profile','project_default','none')),
    moon_profile_id uuid REFERENCES moon_profile(id),
    enabled         boolean NOT NULL DEFAULT true,
    disabled_for_night date,                       -- nur für diese Nacht abgeschaltet (FA-FOL-05), danach automatisch wieder aktiv
    order_index     smallint NOT NULL DEFAULT 0,
    -- Zähler, von der Anwendung in derselben Transaktion wie capture/correction gepflegt
    acquired_count  integer NOT NULL DEFAULT 0,
    rejected_count  integer NOT NULL DEFAULT 0,
    bonus_count     integer NOT NULL DEFAULT 0,
    bonus_rejected_count integer NOT NULL DEFAULT 0,
    -- accepted = max(0, acquired - rejected) ; remaining = max(0, planned - accepted) ;
    -- planning_need = max(0, planned + ceil(planned * rig.overshoot_pct/100) - accepted)  (Fachkonzept 8.4)
    -- integration_s = Summe capture_night.integration_s (Summe der gemeldeten capture.exposure_s, NT-E3; Fachkonzept 8.4)
    -- Exoplaneten-Zeilen: Zähler je Transit-Beobachtung in transit_observation, hier nur Summen
    deleted_at      timestamptz,                   -- Zeilen mit Aufnahmen weich loeschen, ohne Aufnahmen endgueltig (FA-PRJ-07, E4)
    notes           text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_exposure_line_panel ON exposure_line (tenant_id, project_id, panel_id, order_index);

CREATE TABLE project_note (                        -- Notizverlauf (FA-PRJ-17)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    project_id      uuid NOT NULL REFERENCES project(id),
    user_id         uuid NOT NULL REFERENCES app_user(id),
    session_id      uuid,                          -- optional: Beobachtungsnotiz zu einer Nacht (ohne FK)
    body_md         text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_project_note_project ON project_note (tenant_id, project_id, created_at);

CREATE TABLE approval_event (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    project_id      uuid NOT NULL REFERENCES project(id),
    user_id         uuid REFERENCES app_user(id),  -- null bei automatischem Verfall
    action          text NOT NULL CHECK (action IN ('submitted','withdrawn','approved','returned','rejected','expired','edited_by_admin')),
    comment         text,
    snapshot        jsonb,                         -- Wunschangaben bzw. geänderte Felder; bei approved/rejected/expired Endstand der Stimmen {count, voterIds[]} und Rang
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_approval_event_project ON approval_event (tenant_id, project_id, created_at);

CREATE TABLE change_request (                      -- Änderungsantrag nach Freigabe (FA-FRG-08)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    project_id      uuid NOT NULL REFERENCES project(id),
    requested_by    uuid NOT NULL REFERENCES app_user(id),
    proposal        jsonb NOT NULL,                -- vorgeschlagene Fassung (Zeilen, Bedingungen)
    content_changed_at timestamptz,                -- letzte inhaltliche Änderung (User oder Admin)
    submitter_rank  smallint CHECK (submitter_rank >= 1),  -- Rang beim Einreicher, solange offen
    final_votes     jsonb,                         -- Endstand der Stimmen bei Entscheidung
    base_version    integer NOT NULL,              -- project.version bei Antragstellung (Konflikterkennung)
    version         integer NOT NULL DEFAULT 1,    -- eigene Version des Antrags fuer ETag/If-Match: Antragsteller und Admin
                                                   -- duerfen denselben offenen Antrag bearbeiten (FA-FRG-08/14) -> 412 bei Konflikt
    updated_at      timestamptz NOT NULL DEFAULT now(),
    status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','withdrawn')),
    decided_by      uuid REFERENCES app_user(id),
    decision_comment text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    decided_at      timestamptz
);
CREATE INDEX ASYNC ix_change_request_open ON change_request (tenant_id, status, created_at);
CREATE INDEX ASYNC ix_change_request_project ON change_request (tenant_id, project_id);

CREATE TABLE queue_vote (                          -- Stimmen in der Warteschlange (FA-FRG-14)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    subject_kind    text NOT NULL CHECK (subject_kind IN ('project','change_request')),
    subject_id      uuid NOT NULL,                 -- project.id bzw. change_request.id (polymorph, ohne FK)
    project_id      uuid NOT NULL REFERENCES project(id),
    voter_id        uuid NOT NULL REFERENCES app_user(id),  -- nie der Ersteller (Prüfung im Repository)
    created_at      timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz NOT NULL DEFAULT now(),  -- Stimme abgegeben bzw. Änderung zuletzt gesehen/bestätigt
    PRIMARY KEY (tenant_id, subject_kind, subject_id, voter_id)
);
-- Stimmen bleiben bei Zurückziehen/Zurückgeben gespeichert (ruhen) und zählen nur, solange der Gegenstand eingereicht/offen ist.
-- Beim Entfernen eines Mitglieds werden seine Stimmen gelöscht (Stapel ≤ 3.000 Zeilen).
CREATE INDEX ASYNC ix_queue_vote_voter ON queue_vote (tenant_id, voter_id);
CREATE INDEX ASYNC ix_queue_vote_project ON queue_vote (tenant_id, project_id);

-- Exoplaneten ---------------------------------------------------------

CREATE TABLE exo_project (                         -- 1:1 zu project (Typ exoplanet); Astro PM: ExoplanetJson
    project_id      uuid PRIMARY KEY REFERENCES project(id),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    planet          text NOT NULL,
    star            text NOT NULL,
    catalog         text NOT NULL,
    catalog_entry_id uuid REFERENCES exo_catalog_entry(id),
    baseline_before_min smallint NOT NULL DEFAULT 60,   -- Vorgaben für neue Festlegungen
    baseline_after_min  smallint NOT NULL DEFAULT 60,
    buffer_sigma    real NOT NULL DEFAULT 1,
    allow_autofocus boolean NOT NULL DEFAULT false,
    allow_recenter  boolean NOT NULL DEFAULT true,
    defocus_hint    text,
    catalog_snapshot jsonb NOT NULL DEFAULT '{}'   -- Tiefe, Dauer, Mag, Teff, Priorität, Mindestöffnung ...
);

CREATE TABLE ephemeris (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    project_id      uuid NOT NULL REFERENCES project(id),
    t0_bjd_tdb      double precision NOT NULL,
    t0_sigma_d      double precision,
    period_d        double precision NOT NULL CHECK (period_d > 0),  -- Tage; ohne > 0 gibt n0 = (JD - T0)/P unendlich (AST-D20)
    period_sigma_d  double precision,
    duration_h      real CHECK (duration_h IS NULL OR duration_h > 0),  -- T14 in STUNDEN; nullable wie in exo_catalog_entry (AST-T18)
    duration_estimated boolean NOT NULL DEFAULT false,
    time_system_source text NOT NULL DEFAULT 'bjd_tdb'  -- Quell-Zeitsystem der Epoche (transit.md 1, AST-T5)
        CHECK (time_system_source IN ('bjd_tdb','bjd_utc','hjd_utc','jd_utc','btjd','bkjd','unknown')),
    o_minus_c_min   real,                          -- letzte O-C in Minuten (verschiebt die Mitte, transit.md 2)
    o_minus_c_sigma_min real,                      -- deren eigener Fehler; geht in sigma ein (AST-T4)
    o_minus_c_epoch integer,                       -- Epochennummer n der O-C
    o_minus_c_source_id uuid,                      -- Bezugs-Ephemeride der O-C (sonst doppelte Anwendung, AST-T12)
    depth_mmag      real,
    rp_over_rs      real,
    source          text NOT NULL,
    source_date     date,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_ephemeris_project ON ephemeris (tenant_id, project_id, is_active);

CREATE TABLE transit_observation (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    project_id      uuid NOT NULL REFERENCES project(id),
    ephemeris_id    uuid NOT NULL REFERENCES ephemeris(id),
    epoch           integer NOT NULL,
    night           date NOT NULL,
    ingress_utc     timestamptz NOT NULL,
    mid_utc         timestamptz NOT NULL,
    egress_utc      timestamptz NOT NULL,
    window_start_utc timestamptz NOT NULL,
    window_end_utc  timestamptz NOT NULL,
    baseline_before_min smallint NOT NULL,
    baseline_after_min  smallint NOT NULL,
    buffer_min      real NOT NULL,
    session_id      uuid,                          -- ohne FK (Tabelle session folgt später)
    status          text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','locked','observed','missed','cancelled')),
                    -- requested = gewünscht bzw. zu bestätigen, locked = festgelegt; höchstens tenant.settings.exoUserMaxOpenLocks (Standard 3) offene je Projekt, nicht überlappend (Anwendung, guard)
    primary_observation_id uuid REFERENCES transit_observation(id),  -- geteilte Beobachtung: Aufnahmen hängen an der primären (FA-EXO-33)
    confirm_deadline_utc timestamptz,              -- Frist für Transit-Bestätigung (FA-FRG-09)
    locked_by       uuid REFERENCES app_user(id),  -- Admin bzw. Ersteller (FA-EXO-18)
    locked_at       timestamptz,                   -- Reihenfolge bei überlappenden Transits (allocation.md §7.1)
    planned_count   integer NOT NULL DEFAULT 0,    -- Zähler je Beobachtung (FA-EXO-20)
    acquired_count  integer NOT NULL DEFAULT 0,
    rejected_count  integer NOT NULL DEFAULT 0,
    coverage        jsonb,                         -- Baseline vor/nach (min), Ingress/Egress abgedeckt, Transit %, Lücken
    usable          boolean,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_transit_obs_status ON transit_observation (tenant_id, status, window_start_utc);
CREATE INDEX ASYNC ix_transit_obs_project ON transit_observation (tenant_id, project_id, epoch);
CREATE INDEX ASYNC ix_transit_obs_due ON transit_observation (status, window_end_utc);   -- Job-Index

CREATE TABLE transit_result (                      -- HOPS/EXOTIC-Import
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    observation_id  uuid NOT NULL REFERENCES transit_observation(id),
    imported_by     uuid NOT NULL REFERENCES app_user(id),
    format          text NOT NULL CHECK (format IN ('hops','exotic','manual')),
    file_s3_key     text,
    plot_s3_key     text,
    rp_over_rs      real, rp_over_rs_err real,
    depth_mmag      real,
    tc_bjd_tdb      double precision, tc_err_min real,
    epoch           integer,
    o_minus_c_min   real,
    residual_ppt    real, reduced_chi2 real,
    autocorr_ok     boolean, shapiro_ok boolean, outliers_removed integer,
    submittable     boolean,
    raw             jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_transit_result_obs ON transit_result (tenant_id, observation_id);


-- =====================================================================
-- E. AUSFÜHRUNG, AUFNAHMEN, AUSWERTUNG
-- =====================================================================

CREATE TABLE night_plan (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    rig_id          uuid NOT NULL REFERENCES rig(id),
    night           date NOT NULL,                 -- Nacht Mittag-Mittag, Standortdatum des Abends
    origin          text NOT NULL CHECK (origin IN ('web_simulation','plugin_offline','server_plan','forecast_job')),
    session_id      uuid,                          -- ohne FK (session folgt); Revisionen einer Session
    revision        smallint NOT NULL DEFAULT 1,
    reason          text NOT NULL DEFAULT 'initial' CHECK (reason IN ('initial','refresh','resume','reset','simulation','forecast')),
    engine_version  text NOT NULL,
    input_hash      text NOT NULL,                 -- Hash aller Eingaben (Determinismus, NFA-03)
    summary         jsonb NOT NULL,                -- dunkle Stunden, Ziele, Frames, Mond, Zuteilung je Projekt
    blocks          jsonb NOT NULL,                -- [{id,kind,projectId,panelId,transitObservationId,startUtc,endUtc,raDeg,decDeg,rotationDeg,rotationMode,
                                                   --   meridianFlip:{waitStartUtc,plannedUtc,durationS,inTransitWindow,planned}|null, entries[]}] (TK 7.6, ENG5-4…7)
    log_s3_key      text,                          -- Planprotokoll als .json.gz in S3 (tenant/<tid>/plans/<id>.json.gz)
    created_by      uuid REFERENCES app_user(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, revision)                  -- eine Revision je Session (TK 7.3); bei Prognose- und
                                                   -- Simulationsplaenen ist session_id NULL und damit frei
);
CREATE INDEX ASYNC ix_night_plan_rig_night ON night_plan (tenant_id, rig_id, night, created_at);
CREATE INDEX ASYNC ix_night_plan_session ON night_plan (tenant_id, session_id, revision);  -- Session-Detail: Revisionen (TK 6.3)

CREATE TABLE session (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    rig_id          uuid NOT NULL REFERENCES rig(id),
    nina_instance_id uuid REFERENCES nina_instance(id),
    night           date NOT NULL,
    night_plan_id   uuid REFERENCES night_plan(id),  -- erste Revision; weitere über night_plan.session_id
    started_at      timestamptz NOT NULL,
    ended_at        timestamptz,
    session_end_utc timestamptz,                   -- massgebliches Sessionende (sessionEndUtc) der LETZTEN Planrevision (NT-09);
                                                   -- Basis fuer stale (+ 2 h) und report_due_at; Nachtbericht fruehestens
                                                   -- max(ended_at, darknessEndUtc ?? session_end_utc) der letzten Revision
    status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','aborted','stale')),
                    -- stale = kein Heartbeat > 10 min während running (Prüfung tick-5min, nicht bei offline) bzw. nicht beendet 2 h nach session_end_utc (Ende Nachtfenster, FK 8.1, NT-09);
                    -- Uebergaenge: running -> completed | aborted | stale; einziger Rueckweg stale -> running (Heartbeat oder PATCH running derselben Session, M6);
                    -- aborted und completed sind endgueltig (NT-11, NT-15; PATCH running darauf -> 409 session.closed)
    last_heartbeat_at timestamptz,
    created_offline boolean NOT NULL DEFAULT false, -- offline angelegt: Lease-Konflikt beim Nachmelden erlaubt (bleibt dauerhaft gesetzt)
    offline_since   timestamptz,                   -- gesetzt, solange das Plugin im Offline-Modus ist (NULL = online); das Einfrieren steuert rig_lease.offline_until
    nina_conditions jsonb,                         -- Mittel/Min/Max aus NINA-Geräten (FA-AUS-15 b)
    reviewed        boolean NOT NULL DEFAULT false,
    reviewed_by     uuid REFERENCES app_user(id),
    kpis            jsonb,                         -- Effizienz, Overhead, Blockwechsel ... (nach Ende berechnet)
    forecast_snapshot jsonb,                       -- Wetterbewertung zum Sessionbeginn
    outbox_pending  integer,                       -- offene Plugin-Meldungen beim Sessionende
    report_status   text NOT NULL DEFAULT 'none' CHECK (report_status IN ('none','pending','sent','failed','skipped')),  -- Nachtbericht (FA-AUS-21)
    report_due_at   timestamptz,                   -- spaetester Versand = session_end_utc + 2 h (NT-09)
    report_sent_at  timestamptz,
    UNIQUE (rig_id, night, started_at)
);
CREATE INDEX ASYNC ix_session_rig_night ON session (tenant_id, rig_id, night);
CREATE INDEX ASYNC ix_session_report ON session (report_status, report_due_at);   -- Job-Index
CREATE INDEX ASYNC ix_session_running ON session (status, last_heartbeat_at);    -- Job-Index

CREATE TABLE session_event (
    id              uuid PRIMARY KEY,              -- vom Plugin erzeugt (idempotent)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    session_id      uuid NOT NULL REFERENCES session(id),
    occurred_at     timestamptz NOT NULL,
    kind            text NOT NULL,                 -- Werte: contracts/enums.json sessionEventKinds
    project_id      uuid,
    panel_id        uuid,
    night_plan_id   uuid,                          -- Planrevision, zu der block_id gehört
    block_id        text,                          -- UUID aus night_plan.blocks
    duration_s      real,
    message         text,
    data            jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ASYNC ix_session_event_session ON session_event (tenant_id, session_id, occurred_at);

CREATE TABLE capture (                             -- eine Zeile je Belichtung (FA-NIN-09)
    id              uuid PRIMARY KEY,              -- vom Plugin erzeugt (idempotent, FA-SYN-04)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    session_id      uuid NOT NULL REFERENCES session(id),
    project_id      uuid REFERENCES project(id),      -- null bei assignment='unassigned' UND bei frame_type flat/dark_flat   -- null nur bei assignment='unassigned'
    panel_id        uuid REFERENCES project_panel(id),
    exposure_line_id uuid REFERENCES exposure_line(id),
    transit_observation_id uuid REFERENCES transit_observation(id),  -- Exoplaneten (FA-EXO-20)
    frame_type      text NOT NULL DEFAULT 'light' CHECK (frame_type IN ('light','flat','dark_flat')),
    project_ids     jsonb,                         -- Flats/Dark-Flats: alle Projekte, für die die Aufnahme gilt (geteilte Kombination, FA-NIN-17)
    assignment      text NOT NULL DEFAULT 'assigned' CHECK (assignment IN ('assigned','unassigned')),
    CHECK (frame_type <> 'light' OR assignment = 'unassigned' OR (project_id IS NOT NULL AND panel_id IS NOT NULL AND exposure_line_id IS NOT NULL)),
    CHECK (frame_type = 'light' OR (exposure_line_id IS NULL AND project_ids IS NOT NULL AND assignment = 'assigned')),   -- Flats/Dark-Flats: Zielliste statt Zeile
    night           date NOT NULL,
    captured_at     timestamptz NOT NULL,          -- Belichtungsbeginn UTC (MetaData.Image.ExposureStart, NT-10)
    exposure_mid_utc timestamptz,                  -- Belichtungsmitte UTC (ExposureMidPoint, Pflicht im Vertrag; Basis BJD_TDB FA-EXO-29, NT-10);
                                                   -- nullable nur fuer Altbestand/Import
    night_plan_id   uuid,                          -- Planrevision (Lights), auch der lokale Jint-Plan; null nur bei session.created_offline (NT-14)
    block_id        text,                          -- Lights: UUID aus night_plan.blocks
    filter_short_name text NOT NULL,               -- Kurzname (Filterrad-Schlüssel) für alle Aufnahmetypen
    filter_actual   text,
    exposure_s      real NOT NULL,
    gain integer, offset_adu integer, binning smallint, readout_mode text,  -- gain/offset null = NINA-Standard (-1) (NT-38)
    ra_deg          double precision,                          -- Soll-Koordinaten des Panels (J2000)
    dec_deg         double precision,
    rotation_deg    double precision CHECK (rotation_deg IS NULL OR (rotation_deg >= 0 AND rotation_deg < 360)),  -- Positionswinkel des letzten Plate-Solve im Block, sonst Soll (AST-G07)
    pier_side       text CHECK (pier_side IN ('east','west')),   -- null = unbekannt
    rotator_mech_deg double precision NOT NULL DEFAULT 0 CHECK (rotator_mech_deg >= 0 AND rotator_mech_deg < 360),  -- Lights: gemessener mechanischer Winkel (ohne Rotator 0); Flats/Dark-Flats: eingefrorener Repraesentant (AST-G07)
    result          text NOT NULL CHECK (result IN ('saved','aborted','failed')),
    is_bonus        boolean NOT NULL DEFAULT false,
    temperature_deviation boolean NOT NULL DEFAULT false,  -- Kuehlung aus oder |Temperatur - Soll| > camera.cooling_tolerance_c; wird trotzdem gezaehlt (NT-E2)
    settings_deviation boolean NOT NULL DEFAULT false,     -- Filter/Belichtung/Binning/Gain/Offset weichen von der Zeile ab; gespeichert und gezaehlt (NT-E3)
    rejected        boolean NOT NULL DEFAULT false,
    reject_reason   text,
    file_name       text,                          -- nur bei result='saved'
    CHECK (result <> 'saved' OR file_name IS NOT NULL),
    readout_mode_index smallint NOT NULL DEFAULT 0,  -- Pflicht laut TK 7.6; Rückfall 0, wenn die Kamera nur einen Modus hat (DAT5-22)
    metrics         jsonb,                         -- hfr, stars, meanAdu, sensorTempC, setPointC, guidingRmsArcsec, altitudeDeg, airmass, focusPosition;
                                                   -- sensorTempC/setPointC Pflicht, wenn die Kamera sie liefert (NT-E2), uebrige optional
    received_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_capture_line_night ON capture (tenant_id, exposure_line_id, night);
CREATE INDEX ASYNC ix_capture_session    ON capture (tenant_id, session_id, captured_at);
CREATE INDEX ASYNC ix_capture_project    ON capture (tenant_id, project_id, captured_at);          -- Aufnahmeliste/CSV je Projekt (FA-AUS-12)
CREATE INDEX ASYNC ix_capture_transit    ON capture (tenant_id, transit_observation_id, captured_at);  -- captures.csv je Beobachtung

CREATE TABLE capture_night (                       -- Aggregat je Zeile und Nacht (Astro PM: CaptureNights); GENAU EINE Zeile je (Zeile, Nacht)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    exposure_line_id uuid NOT NULL REFERENCES exposure_line(id),
    night           date NOT NULL,
    project_id      uuid NOT NULL REFERENCES project(id),
    acquired_count  integer NOT NULL DEFAULT 0,     -- gemeldete Lights (result='saved', ohne Bonus)
    rejected_individual integer NOT NULL DEFAULT 0, -- einzeln verworfene Nicht-Bonus-Aufnahmen (FA-AUS-20)
    rejected_correction integer NOT NULL DEFAULT 0, -- Korrektur dieser Nacht (FA-AUS-06)
    rejected_count  integer NOT NULL DEFAULT 0,     -- WIRKSAM = max(rejected_individual, rejected_correction) -- nie summieren (FA-AUS-06)
    bonus_count     integer NOT NULL DEFAULT 0,
    bonus_rejected_count integer NOT NULL DEFAULT 0,-- einzeln verworfene Bonus-Aufnahmen (FA-AUS-20)
    integration_s   double precision NOT NULL DEFAULT 0,  -- Summe capture.exposure_s der akzeptierten Aufnahmen inkl. nicht verworfener Bonus-Aufnahmen
                                                   -- (NICHT Anzahl x Zeilen-Belichtung, NT-E3); Korrektur-Anzahlen ohne Einzelauswahl
                                                   -- werden mit exposure_line.exposure_s abgezogen
    sources         jsonb NOT NULL DEFAULT '["nina"]',    -- Menge aus contracts/enums.json correctionSources (nina | correction | import); nur Information.
                                                   -- Seed/Import = Basis für den Abgleich-Job (DAT-18); PATCH /captures/{id}/assign ergänzt 'nina' (DAT5-12)
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (exposure_line_id, night)
);
CREATE INDEX ASYNC ix_capture_night_project ON capture_night (tenant_id, project_id, night);

CREATE TABLE correction (                          -- manuelle Korrektur "verworfen" (FA-AUS-06)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    exposure_line_id uuid NOT NULL REFERENCES exposure_line(id),
    night           date NOT NULL,
    rejected_count  integer NOT NULL,              -- darf negativ sein (Rücknahme)
    reason          text CHECK (reason IN ('clouds','wind','focus','satellite','guiding','other')),  -- Fachkonzept FA-AUS-06
    comment         text,
    user_id         uuid NOT NULL REFERENCES app_user(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_correction_line ON correction (tenant_id, exposure_line_id, night);

CREATE TABLE flat_combination (                    -- Kalibrier-Kombination je Session (ohne Ziel, FA-NIN-17); Aggregat aus capture (frame_type flat/dark_flat)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    session_id      uuid NOT NULL REFERENCES session(id),
    filter_short_name text NOT NULL,
    rotator_mech_deg_dg integer NOT NULL DEFAULT 0,  -- Schlüssel: eingefrorener Repräsentant in ZEHNTELGRAD (round(deg*10)); 0 = Rig ohne Rotator.
                                                   -- Ganzzahl, weil ein real im Primärschlüssel nach Neustart/Rundung eine zweite Zeile erzeugen könnte (NIN5-8/DAT5-21)
    median_deg      double precision,              -- laufend beobachteter Median der gemessenen Winkel – reine Beobachtung, NICHT Teil des Schlüssels
    gain integer NOT NULL, offset_adu integer NOT NULL, binning smallint NOT NULL,  -- Schluessel: NINA-Standard als -1 gespeichert (NOT NULL bleibt, NT-38)
    readout_mode_index smallint NOT NULL DEFAULT 0,  -- Index der Kameraliste (Schlüssel; Name nur zur Anzeige, NIN-16c)
    readout_mode    text NOT NULL DEFAULT '',      -- gemeldeter Name (Anzeige)
    status          text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','skipped')),  -- Zeile entsteht beim ersten Flat ('running'); session_close setzt 'done'/'skipped' (DAT5-7).
                                                   -- 'pending' gibt es nur im Plugin (flat_combination_local), nicht serverseitig
    project_ids     jsonb NOT NULL DEFAULT '[]',   -- Ziele, deren Lights diese Kombination nutzen (Dateien in deren Ordner kopiert)
    flats_planned   integer NOT NULL DEFAULT 0,    -- aus der ERSTEN Meldung der Kombination (capture.flatsPlanned); Rückfall rig.flat_count (NIN5-9)
    flats_taken     integer NOT NULL DEFAULT 0,    -- aus capture (frame_type='flat') beim Ingest gezählt
    flat_exposure_s real,                          -- zuletzt gemeldete Flat-Belichtung (Dark-Flats nutzen dieselbe)
    dark_flats_planned integer NOT NULL DEFAULT 0, -- aus der ersten Meldung (darkFlatsPlanned; 0, wenn die Dark-Flat-Gruppe der Nacht schon erledigt war)
    dark_flats_taken integer NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, filter_short_name, rotator_mech_deg_dg, gain, offset_adu, binning, readout_mode_index)
);

CREATE TABLE session_log (                         -- Sitzungsprotokoll (Astro PM: ObservationLogs, dort je Projekt)
    session_id      uuid PRIMARY KEY REFERENCES session(id),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    start_time      timestamptz,
    end_time        timestamptz,
    seeing_arcsec   real,
    transparency_pct real,
    sqm             real CHECK (sqm IS NULL OR sqm BETWEEN 14 AND 23),  -- Himmelshelligkeit in mag/arcsec^2 (FA-AUS-14)
    temperature_c   real,
    humidity_pct    real,
    wind_kmh        real,
    clouds_note     text,
    weather_notes   text NOT NULL DEFAULT '',
    notes_md        text NOT NULL DEFAULT '',
    moon_illumination_pct real,
    value_sources   jsonb NOT NULL DEFAULT '{}',   -- {"seeing":"forecast","sqm":"nina","temperature":"manual"}
    updated_by      uuid REFERENCES app_user(id),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_night_stat (                     -- Klarnacht-Statistik (FA-AUS-17)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    site_id         uuid NOT NULL REFERENCES site(id),
    night           date NOT NULL,
    usable          boolean NOT NULL,              -- aus Session oder manuell "bewölkt/nicht genutzt"
    usable_hours    real,
    source          text NOT NULL CHECK (source IN ('session','manual')),
    PRIMARY KEY (site_id, night)
);

CREATE TABLE command (                             -- reserviert für refresh_targets/reset_plan (keine Fernsteuerung, Fachkonzept 2.3)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    nina_instance_id uuid NOT NULL REFERENCES nina_instance(id),
    kind            text NOT NULL CHECK (kind IN ('refresh_targets','reset_plan')),
    created_by      uuid NOT NULL REFERENCES app_user(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz
);

CREATE TABLE discord_channel (                     -- ausgehende Discord-Kanäle je Mandant (FA-DIS-02 … 05)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    name            text NOT NULL,                 -- Anzeige, z. B. '#freigaben'
    webhook_url     text,                          -- vollstaendige Webhook-URL (SV-10): nie ausgeliefert, nie geloggt, nie exportiert; Host nur discord.com/discordapp.com,
                                                   -- vor jedem Senden erneut geprueft; NULL nach Mandanten-Import (Kanal deaktiviert, bis ein Admin die URL neu eintraegt)
    webhook_hint    text,                          -- letzte 4 Zeichen zur Anzeige; NULL ohne URL
    categories      jsonb NOT NULL DEFAULT '[]',   -- ["approvals","sessions","alerts"]
    event_filter    jsonb NOT NULL DEFAULT '{}',   -- je Kategorie abgewählte Ereignisse, showMemberNames
    enabled         boolean NOT NULL DEFAULT true,
    last_delivery_at timestamptz,
    last_error      text,
    last_error_at   timestamptz,
    created_by      uuid REFERENCES app_user(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name),
    CHECK (webhook_url IS NOT NULL OR NOT enabled)  -- ohne URL nie aktiv
);

CREATE TABLE discord_delivery (                    -- Zustellzustand je Kanal und Ereignis (Deduplizierung, DAT-11)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),   -- Pflicht in jeder Mandantentabelle (NFA-16); nötig für Guard und Mandantenlöschen (DAT5-4)
    channel_id      uuid NOT NULL REFERENCES discord_channel(id),
    event_key       text NOT NULL,                 -- contracts/enums.json discordEventKeys
    object_id       uuid NOT NULL,                 -- Projekt, Session, Änderungsantrag ...
    job_id          uuid,                          -- letzter Job, der die Zustellung versucht hat
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
    attempts        smallint NOT NULL DEFAULT 0,
    last_error      text,
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, event_key, object_id)
    -- "Bericht erneut senden" (FA-AUS-21) ist ein expliziter Reset dieser Zeile: status='pending', attempts=0, last_error=NULL, sent_at=NULL (TK 7.7)
);
CREATE INDEX ASYNC ix_discord_delivery_pending ON discord_delivery (status, created_at);   -- Job-Index tick-5min (DAT5-4)
CREATE INDEX ASYNC ix_discord_delivery_tenant ON discord_delivery (tenant_id, created_at);

CREATE TABLE job (                                 -- asynchrone Arbeit für die Lambda worker (Technisches Konzept 7.4/13)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid REFERENCES tenant(id),    -- null = systemweit (Kataloge, Wetter)
    kind            text NOT NULL,                 -- Werte: contracts/enums.json jobKinds (multi_sim, impact, effort, session_close, session_report, discord_post, export, import, thumbnail, transit_result_parse, catalog_refresh, forecast, reconcile, weather)
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
    dedupe_key      text,                          -- z. B. effort:<projectId> – fachlicher Schlüssel, bleibt dauerhaft stehen (Diagnose)
    dedupe_active   text,                          -- = dedupe_key, solange status IN ('pending','running'); danach NULL.
                                                   -- UNIQUE darauf verhindert Doppel-Jobs, erlaubt aber jeden späteren Lauf mit gleichem Schlüssel (DAT5-1)
    input           jsonb NOT NULL DEFAULT '{}',   -- nur kleine Parameter; große Eingaben als S3-Schlüssel
    result_s3_key   text,
    error           text,
    attempts        smallint NOT NULL DEFAULT 0,
    run_after       timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    finished_at     timestamptz,
    created_by      uuid REFERENCES app_user(id),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC ix_job_pending ON job (status, run_after);                  -- Job-Index
CREATE INDEX ASYNC ix_job_tenant ON job (tenant_id, created_at);
CREATE UNIQUE INDEX ASYNC ux_job_dedupe_active ON job (dedupe_active);   -- offener Job je Schlüssel höchstens einmal (DAT5-1)
CREATE INDEX ASYNC ix_job_dedupe ON job (dedupe_key, created_at);

CREATE TABLE system_setting (                      -- systemweite Einstellungen (Wartungsbanner, Abruf-Limits; FA-SU-08)
    key             text PRIMARY KEY,
    value           jsonb NOT NULL,
    updated_by      uuid REFERENCES super_user(identity_id),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- Nicht übernommene Astro-PM-Tabellen (bewusst):
--   Accessories, CustomApps, Eyepieces, CompletedImages, ImageSubmissions,
--   SubFrameInspections, RemoteConnections.Password, AppSettings (-> user_preference),
--   ExposureSets.SubsFolderPath/RemoteFolderPath/RemoteAcquiredCount/InspectedCount/UnsyncedCount,
--   Projects.ThumbnailPng/FinalImagePng/ReferenceImagePng (BLOBs), ObservingSites.CustomHorizon*,
--   Cameras.CalibrationLibraryPath, Filters.ZeroPointJson (erst mit Belichtungsrechner, R6)
-- =====================================================================

-- =====================================================================
-- Vorlage für GRANTs je Tabellen-Migration (DSQL; lokal ohne AWS IAM GRANT)
-- =====================================================================
-- Die Lambda `migrate` (Ausfuehrungsrolle mit dsql:DbConnectAdmin, SV-13) verbindet als `admin` und
-- fuehrt Migration 0000 inkl. Rollen und GRANTs idempotent selbst aus; Schema-Eigentuemer ist `admin`.
-- Es gibt keine eigene Lambda `db-bootstrap` und keine DB-Rolle app_migrate (SV-14).
--
-- Migration 0000 (als admin, idempotent):
--   CREATE ROLE app_rw      WITH LOGIN;   -- Lambda api und ops-cli
--   CREATE ROLE app_job     WITH LOGIN;   -- Lambda worker  (getrennt: verarbeitet fremde Eingaben, SV-14)
--   AWS IAM GRANT app_rw      TO 'arn:aws:iam::<account>:role/NinaPmApi';
--   AWS IAM GRANT app_rw      TO 'arn:aws:iam::<account>:role/NinaPmOpsCli';
--   AWS IAM GRANT app_job     TO 'arn:aws:iam::<account>:role/NinaPmWorker';
--   GRANT USAGE ON SCHEMA public TO app_rw, app_job;
--   -- es gibt KEINE Rolle app_ro; lesender Ad-hoc-Zugriff laeuft ueber ops-cli
--   -- (Aufruf nur per aws lambda invoke mit Admin-Profil, SV-13).
--
-- je neue Tabelle <t> (eigene Transaktionen nach dem CREATE TABLE), BEIDE Saetze Pflicht,
-- jeweils mit dem Umfang aus TK 6.2 "Rechte je Gruppe":
--   GRANT <Umfang laut TK 6.2, Spalte app_rw>  ON <t> TO app_rw;
--   GRANT <Umfang laut TK 6.2, Spalte app_job> ON <t> TO app_job;
-- Audit-Tabellen (system_audit, change_log, approval_event) erhalten normale Rechte (SV-11).
-- app_job (Lambda worker) erhaelt fuer den Mandanten-Import (Job import) INSERT auf die fachlichen Mandantentabellen
-- nach TK 6.2 (Ausruestung ausser nina_instance, Projekte & Freigabe, exo_project, discord_channel ohne URL);
-- NIE INSERT auf identity, super_user, app_user, invitation, auth_session, nina_instance; auf auth_session gar kein Recht:
--   GRANT SELECT, INSERT ON site TO app_job;          -- Beispiel; Umfang je Tabelle laut TK 6.2
--   -- kein GRANT ... ON auth_session TO app_job
-- Ausnahme von "app_rw darf alles":
--   GRANT SELECT ON dso_object, exo_catalog_entry, weather_cache TO app_rw;  -- Kataloge pflegt app_job
-- Der DSQL-Lint in CI lehnt jede CREATE TABLE ohne beide GRANT-Saetze ab und vergleicht den
-- Umfang gegen die Tabelle in TK 6.2 (TK 6.8).
