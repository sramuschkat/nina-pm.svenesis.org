-- Migration 0004 – D. Projekte, Freigabe, Exoplaneten
-- Erzeugt aus docs/concept/schema_aurora_dsql.sql v1.19 (scripts/generate-migrations.ts, AP-03).
-- Eine Anweisung je Abschnitt, jede in eigener Transaktion (DSQL: eine DDL je Transaktion).
-- GRANTs je Tabelle für app_rw und app_job nach TK 6.2 (src/grants.ts).
-- statement
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

-- statement
CREATE INDEX ASYNC ix_project_rig_status ON project (tenant_id, rig_id, status, priority);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON project TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE ON project TO app_job;

-- statement
CREATE TABLE favorite (
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    user_id         uuid NOT NULL REFERENCES app_user(id),
    project_id      uuid NOT NULL REFERENCES project(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, project_id)
);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON favorite TO app_rw;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON project_panel TO app_rw;

-- statement
GRANT SELECT, INSERT ON project_panel TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_exposure_line_panel ON exposure_line (tenant_id, project_id, panel_id, order_index);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON exposure_line TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE ON exposure_line TO app_job;

-- statement
CREATE TABLE project_note (                        -- Notizverlauf (FA-PRJ-17)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    project_id      uuid NOT NULL REFERENCES project(id),
    user_id         uuid NOT NULL REFERENCES app_user(id),
    session_id      uuid,                          -- optional: Beobachtungsnotiz zu einer Nacht (ohne FK)
    body_md         text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- statement
CREATE INDEX ASYNC ix_project_note_project ON project_note (tenant_id, project_id, created_at);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON project_note TO app_rw;

-- statement
GRANT SELECT, INSERT ON project_note TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_approval_event_project ON approval_event (tenant_id, project_id, created_at);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON approval_event TO app_rw;

-- statement
GRANT SELECT, INSERT ON approval_event TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_change_request_open ON change_request (tenant_id, status, created_at);

-- statement
CREATE INDEX ASYNC ix_change_request_project ON change_request (tenant_id, project_id);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON change_request TO app_rw;

-- statement
GRANT SELECT, INSERT ON change_request TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_queue_vote_voter ON queue_vote (tenant_id, voter_id);

-- statement
CREATE INDEX ASYNC ix_queue_vote_project ON queue_vote (tenant_id, project_id);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON queue_vote TO app_rw;

-- statement
GRANT SELECT, INSERT ON queue_vote TO app_job;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON exo_project TO app_rw;

-- statement
GRANT SELECT, INSERT ON exo_project TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_ephemeris_project ON ephemeris (tenant_id, project_id, is_active);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON ephemeris TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE ON ephemeris TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_transit_obs_status ON transit_observation (tenant_id, status, window_start_utc);

-- statement
CREATE INDEX ASYNC ix_transit_obs_project ON transit_observation (tenant_id, project_id, epoch);

-- statement
CREATE INDEX ASYNC ix_transit_obs_due ON transit_observation (status, window_end_utc);   -- Job-Index

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON transit_observation TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE ON transit_observation TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_transit_result_obs ON transit_result (tenant_id, observation_id);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON transit_result TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE ON transit_result TO app_job;
