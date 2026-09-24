-- Migration 0006 – Speicherbedarf je Mandant (AP-07d, FA-SU-03).
-- Nur additiv: eigene Tabelle statt neuer Spalten an `tenant`, damit `app_job` ohne nachträgliches
-- Spaltenrecht schreiben kann (TK 6.2). Der `daily`-Lauf des `worker` summiert die Objekte unter
-- `tenant/<id>/` im Daten-Bucket; `api` liest für S-80 und löscht beim Mandanten-Löschen (FA-MAN-03).
-- statement
CREATE TABLE tenant_storage (
    tenant_id       uuid PRIMARY KEY REFERENCES tenant(id),
    file_bytes      bigint NOT NULL,
    file_count      integer NOT NULL,
    measured_at     timestamptz NOT NULL
);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_storage TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE ON tenant_storage TO app_job;
