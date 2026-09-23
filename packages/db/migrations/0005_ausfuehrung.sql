-- Migration 0005 – E. Ausführung, Aufnahmen, Auswertung
-- Erzeugt aus docs/concept/schema_aurora_dsql.sql v1.19 (scripts/generate-migrations.ts, AP-03).
-- Eine Anweisung je Abschnitt, jede in eigener Transaktion (DSQL: eine DDL je Transaktion).
-- GRANTs je Tabelle für app_rw und app_job nach TK 6.2 (src/grants.ts).
-- statement
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

-- statement
CREATE INDEX ASYNC ix_night_plan_rig_night ON night_plan (tenant_id, rig_id, night, created_at);

-- statement
CREATE INDEX ASYNC ix_night_plan_session ON night_plan (tenant_id, session_id, revision);  -- Session-Detail: Revisionen (TK 6.3)

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON night_plan TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON night_plan TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_session_rig_night ON session (tenant_id, rig_id, night);

-- statement
CREATE INDEX ASYNC ix_session_report ON session (report_status, report_due_at);   -- Job-Index

-- statement
CREATE INDEX ASYNC ix_session_running ON session (status, last_heartbeat_at);    -- Job-Index

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON session TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON session TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_session_event_session ON session_event (tenant_id, session_id, occurred_at);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON session_event TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON session_event TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_capture_line_night ON capture (tenant_id, exposure_line_id, night);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON capture TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON capture TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_capture_night_project ON capture_night (tenant_id, project_id, night);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON capture_night TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON capture_night TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_correction_line ON correction (tenant_id, exposure_line_id, night);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON correction TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON correction TO app_job;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON flat_combination TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON flat_combination TO app_job;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON session_log TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON session_log TO app_job;

-- statement
CREATE TABLE site_night_stat (                     -- Klarnacht-Statistik (FA-AUS-17)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    site_id         uuid NOT NULL REFERENCES site(id),
    night           date NOT NULL,
    usable          boolean NOT NULL,              -- aus Session oder manuell "bewölkt/nicht genutzt"
    usable_hours    real,
    source          text NOT NULL CHECK (source IN ('session','manual')),
    PRIMARY KEY (site_id, night)
);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON site_night_stat TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON site_night_stat TO app_job;

-- statement
CREATE TABLE command (                             -- reserviert für refresh_targets/reset_plan (keine Fernsteuerung, Fachkonzept 2.3)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    nina_instance_id uuid NOT NULL REFERENCES nina_instance(id),
    kind            text NOT NULL CHECK (kind IN ('refresh_targets','reset_plan')),
    created_by      uuid NOT NULL REFERENCES app_user(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz
);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON command TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON command TO app_job;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON discord_channel TO app_rw;

-- statement
GRANT SELECT, INSERT ON discord_channel TO app_job;

-- statement
GRANT UPDATE (enabled, last_delivery_at, last_error, last_error_at) ON discord_channel TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_discord_delivery_pending ON discord_delivery (status, created_at);   -- Job-Index tick-5min (DAT5-4)

-- statement
CREATE INDEX ASYNC ix_discord_delivery_tenant ON discord_delivery (tenant_id, created_at);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON discord_delivery TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON discord_delivery TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_job_pending ON job (status, run_after);                  -- Job-Index

-- statement
CREATE INDEX ASYNC ix_job_tenant ON job (tenant_id, created_at);

-- statement
CREATE UNIQUE INDEX ASYNC ux_job_dedupe_active ON job (dedupe_active);   -- offener Job je Schlüssel höchstens einmal (DAT5-1)

-- statement
CREATE INDEX ASYNC ix_job_dedupe ON job (dedupe_key, created_at);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON job TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON job TO app_job;

-- statement
CREATE TABLE system_setting (                      -- systemweite Einstellungen (Wartungsbanner, Abruf-Limits; FA-SU-08)
    key             text PRIMARY KEY,
    value           jsonb NOT NULL,
    updated_by      uuid REFERENCES super_user(identity_id),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON system_setting TO app_rw;

-- statement
GRANT SELECT ON system_setting TO app_job;
