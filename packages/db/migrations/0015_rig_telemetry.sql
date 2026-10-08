-- Migration 0015 – Rig-Telemetrie (AP-67, FA-RIG-15 … 18, Entscheidung Sven 08.10.2026).
-- Die Skripte am Rig (Mini-PC über Core Temp, Powerbox über Pegasus Unity) laden ihre Messpunkte mit dem Token einer
-- NINA-Instanz hoch (`POST /nina/v1/telemetry`). Rohwerte bleiben 90 Tage, danach nur Stundenwerte.
-- - `rig_telemetry_sample`: ein Messpunkt je (Rig, Quelle, Zeitpunkt); Werte als `jsonb` (Messgröße → Zahl, nur
--   die gemessenen – fehlt ein Wert, fehlt der Schlüssel). Idempotent über den Primärschlüssel
--   (`ON CONFLICT DO NOTHING`).
-- - `rig_telemetry_hourly`: je (Rig, Quelle, Stunde) Minimum, Mittel, Maximum und Anzahl je Messgröße (`stats`) und
--   die Anzahl Rohwerte der Stunde (`samples`, Vergleich für die Neuverdichtung spät eintreffender Werte). Der worker
--   schreibt sie im `tick-hourly` und löscht danach Rohwerte älter als 90 Tage in Stapeln.
-- - Quelle ohne CHECK (Werte aus `enums.json` `telemetrySources`, zod prüft): ein CHECK wäre in DSQL nicht änderbar.
-- - Additiv nach ADR-S1: neue Tabellen, NOT NULL nur im CREATE TABLE, FKs ohne ON-DELETE-Aktion (Löschen im
--   Repository: Rig löschen, Mandant löschen), kein Index über den Primärschlüssel hinaus (alle Abfragen laufen über
--   Rig, Quelle und Zeit).
-- statement
CREATE TABLE rig_telemetry_sample (                -- Rohwerte der Rig-Telemetrie (AP-67)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    rig_id          uuid NOT NULL REFERENCES rig(id),
    source          text NOT NULL,
    at_utc          timestamptz NOT NULL,
    metrics         jsonb NOT NULL,
    received_at     timestamptz NOT NULL,
    PRIMARY KEY (rig_id, source, at_utc)
);

-- statement
CREATE TABLE rig_telemetry_hourly (                -- Stundenwerte der Rig-Telemetrie (AP-67), dauerhaft
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    rig_id          uuid NOT NULL REFERENCES rig(id),
    source          text NOT NULL,
    hour_utc        timestamptz NOT NULL,
    samples         integer NOT NULL CHECK (samples >= 0),
    stats           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL,
    PRIMARY KEY (rig_id, source, hour_utc)
);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON rig_telemetry_sample TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON rig_telemetry_sample TO app_job;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON rig_telemetry_hourly TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON rig_telemetry_hourly TO app_job;
