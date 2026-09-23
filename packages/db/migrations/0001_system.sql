-- Migration 0001 – A. System (mandantenübergreifend)
-- Erzeugt aus docs/concept/schema_aurora_dsql.sql v1.19 (scripts/generate-migrations.ts, AP-03).
-- Eine Anweisung je Abschnitt, jede in eigener Transaktion (DSQL: eine DDL je Transaktion).
-- GRANTs je Tabelle für app_rw und app_job nach TK 6.2 (src/grants.ts).
-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON identity TO app_rw;

-- statement
GRANT SELECT ON identity TO app_job;

-- statement
CREATE TABLE super_user (
    identity_id     uuid PRIMARY KEY REFERENCES identity(id),
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_by      uuid REFERENCES identity(id),  -- null = Bootstrap über Deployment-Parameter
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON super_user TO app_rw;

-- statement
GRANT SELECT ON super_user TO app_job;

-- statement
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

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO app_rw;

-- statement
GRANT SELECT ON tenant TO app_job;

-- statement
CREATE TABLE system_audit (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor           text NOT NULL CHECK (actor IN ('super_user','ops_cli')),  -- einfache Tabelle, kein manipulationssicherer Nachweis (SV-11)
    super_user_id   uuid REFERENCES super_user(identity_id),   -- null bei ops_cli
    tenant_id       uuid REFERENCES tenant(id),
    action          text NOT NULL,                 -- tenant.create, tenant.lock, invitation.create, super_user.add ...
    details         jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- statement
CREATE INDEX ASYNC ix_system_audit_tenant ON system_audit (tenant_id, created_at);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON system_audit TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON system_audit TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_dso_object_type ON dso_object (object_type, constellation);

-- statement
GRANT SELECT ON dso_object TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON dso_object TO app_job;

-- statement
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

-- statement
CREATE INDEX ASYNC ix_exo_catalog_planet ON exo_catalog_entry (planet);

-- statement
GRANT SELECT ON exo_catalog_entry TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON exo_catalog_entry TO app_job;

-- statement
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

-- statement
GRANT SELECT ON weather_cache TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON weather_cache TO app_job;
