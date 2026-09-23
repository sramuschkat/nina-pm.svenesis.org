-- Migration 0003 – C. Ausrüstung
-- Erzeugt aus docs/concept/schema_aurora_dsql.sql v1.19 (scripts/generate-migrations.ts, AP-03).
-- Eine Anweisung je Abschnitt, jede in eigener Transaktion (DSQL: eine DDL je Transaktion).
-- GRANTs je Tabelle für app_rw und app_job nach TK 6.2 (src/grants.ts).
-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON site TO app_rw;

-- statement
GRANT SELECT, INSERT ON site TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_site_link_site ON site_link (tenant_id, site_id);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON site_link TO app_rw;

-- statement
GRANT SELECT, INSERT ON site_link TO app_job;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON telescope TO app_rw;

-- statement
GRANT SELECT, INSERT ON telescope TO app_job;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON camera TO app_rw;

-- statement
GRANT SELECT, INSERT ON camera TO app_job;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON moon_profile TO app_rw;

-- statement
GRANT SELECT, INSERT ON moon_profile TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_filter_telescope ON filter (tenant_id, telescope_id);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON filter TO app_rw;

-- statement
GRANT SELECT, INSERT ON filter TO app_job;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON exposure_template TO app_rw;

-- statement
GRANT SELECT, INSERT ON exposure_template TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_template_line_template ON exposure_template_line (tenant_id, template_id, order_index);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON exposure_template_line TO app_rw;

-- statement
GRANT SELECT, INSERT ON exposure_template_line TO app_job;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON rig TO app_rw;

-- statement
GRANT SELECT, INSERT ON rig TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_rig_lease_tenant ON rig_lease (tenant_id, lease_until);

-- statement
CREATE INDEX ASYNC ix_rig_lease_due ON rig_lease (lease_until);  -- Job-Index (Ausnahme von der tenant_id-Regel, TK 6.1): Lease-Sweep in tick-5min laeuft ueber alle Mandanten

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON rig_lease TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE ON rig_lease TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_nina_instance_rig ON nina_instance (tenant_id, rig_id);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON nina_instance TO app_rw;

-- statement
GRANT SELECT ON nina_instance TO app_job;
