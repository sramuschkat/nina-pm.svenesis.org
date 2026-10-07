-- Migration 0014 – Vorhersage je Standort und Nacht (AP-64b, FA-AUS-16/17, Entscheidung Sven 07.10.2026).
-- Die Standort-Statistik markiert eine Nacht als „klar, aber nicht genutzt“, wenn die Vorhersage gut oder besser war,
-- aber unter 1 h belichtet wurde. Bisher lag die Vorhersage nur am Wetter-Schnappschuss einer Session; Nächte ohne
-- Session hatten keine. `site_night_stat` kann sie nicht aufnehmen (CHECK auf `source`, Constraints in DSQL nicht
-- änderbar) – daher eine eigene Tabelle.
-- - Eine Zeile je (Standort, Nacht): Bewertung 0…4 (FA-WET-03, wie `ratingIndex` im Schnappschuss), Mittel 0…1
--   (`nightMean`), Modellsatz und Abrufzeit der `weather_cache`-Zeile. Der worker schreibt sie im `tick-5min` aus dem
--   Wetter-Cache für die kommende Nacht; die letzte Vorhersage vor Beginn der astronomischen Dunkelheit gilt, danach
--   wird die Zeile nicht mehr geändert.
-- - Additiv nach ADR-S1: neue Tabelle mit NOT NULL/CHECK nur im CREATE TABLE, FKs ohne ON-DELETE-Aktion (Löschen im
--   Repository: Standort löschen, Mandant löschen), kein Index über den Primärschlüssel hinaus.
-- statement
CREATE TABLE site_night_forecast (                 -- Vorhersage je Standort und Nacht (FA-AUS-16/17, AP-64b)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    site_id         uuid NOT NULL REFERENCES site(id),
    night           date NOT NULL,
    rating_index    smallint NOT NULL CHECK (rating_index BETWEEN 0 AND 4),
    overall_score   real,
    model_set       text,
    recorded_at     timestamptz NOT NULL,
    PRIMARY KEY (site_id, night)
);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON site_night_forecast TO app_rw;

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON site_night_forecast TO app_job;
