-- Migration 0010 – Exoplaneten-Kataloge: Herkunft der Epoche und der Tiefe, TIC-Kennung (AP-40, transit.md §1).
-- Additiv nach ADR-S1: Spalten ohne DEFAULT/Constraint, danach SET DEFAULT für neue Zeilen. Kein Nachfüllen: die
-- Tabelle ist bis zu diesem Paket leer (erster Import mit AP-40).
-- - `time_system_source`: Quell-Zeitsystem nach der Zuordnung (enums.json `exoTimeSystemSources`, wie
--   `ephemeris.time_system_source`); `unknown` ⇒ Fensterpuffer + 10 min und Kennzeichen „Zeitsystem unsicher“.
-- - `time_system_raw` und `t0_raw`: Angabe der Quelle unverändert (z. B. NASA `pl_tranmid_systemref = 'JD'`),
--   damit `t0_bjd_tdb` gegen die Quelle prüfbar bleibt.
-- - `depth_raw`/`depth_unit`: Rohwert und Einheit der Tiefe (`percent`/`ppm`/`mmag`, AST-D1/D2);
--   `depth_estimated`: Tiefe aus `(Rp/R★)²` statt aus dem Katalog.
-- - `tic_id`: TESS-Input-Catalog-Kennung (nur Ziffern) zum Zusammenführen von TOI und NASA (FA-EXO-03).
-- statement
ALTER TABLE exo_catalog_entry ADD COLUMN time_system_source text;

-- statement
ALTER TABLE exo_catalog_entry ADD COLUMN time_system_raw text;

-- statement
ALTER TABLE exo_catalog_entry ADD COLUMN t0_raw double precision;

-- statement
ALTER TABLE exo_catalog_entry ADD COLUMN depth_raw double precision;

-- statement
ALTER TABLE exo_catalog_entry ADD COLUMN depth_unit text;

-- statement
ALTER TABLE exo_catalog_entry ADD COLUMN depth_estimated boolean;

-- statement
ALTER TABLE exo_catalog_entry ALTER COLUMN depth_estimated SET DEFAULT false;

-- statement
ALTER TABLE exo_catalog_entry ADD COLUMN tic_id text;

-- statement
CREATE INDEX ASYNC ix_exo_catalog_tic ON exo_catalog_entry (tic_id);
