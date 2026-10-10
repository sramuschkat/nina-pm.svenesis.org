-- Migration 0016 – Indizes für die häufigsten Abfragen (Performance-Analyse 10.10.2026, Paket A).
-- Das Datenmodell (docs/concept/schema_aurora_dsql.sql) sah `ix_capture_session` und `ix_capture_project` vor, keine
-- Migration legte sie an: Session-Detail, Nächte-Zusammenfassung, Reiter „Bilder“, letzte Aufnahme auf „Heute“,
-- Bildbewertung (Bezug je Projekt) und das Ist der Nacht lasen dadurch alle Aufnahmen des Mandanten.
-- `ix_night_plan_rig_origin`: `forecastNights` filtert auf `origin = 'forecast_job'`; `ix_night_plan_rig_night`
-- enthält `origin` nicht, also wurden je Aufruf von `/tonight` und `/forecast` alle Planrevisionen des Rigs gelesen.
-- Nur additive Indizes nach ADR-S1 (`CREATE INDEX ASYNC`, eine DDL je Transaktion, der Runner wartet mit
-- `sys.wait_for_job`).
-- statement
CREATE INDEX ASYNC ix_capture_session ON capture (tenant_id, session_id, captured_at);

-- statement
CREATE INDEX ASYNC ix_capture_project ON capture (tenant_id, project_id, captured_at);

-- statement
CREATE INDEX ASYNC ix_night_plan_rig_origin ON night_plan (tenant_id, rig_id, origin, night);
