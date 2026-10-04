-- Migration 0013 – Auto-Flats je Projekt (AP-50b, FA-SCH-08, Entscheidung Sven 04.10.2026).
-- Additiv nach ADR-S1: Spalten ohne DEFAULT/Constraint, kein Nachfüllen – NULL ist für bestehende Rigs der richtige
-- Bestand und wird von der Anwendung gelesen als:
-- - `flats_auto_mode` NULL = `off` (Flats nach jeder Nacht für alle Kombinationen, wie bisher); sonst
--   `once_per_project` oder `time_based` (Werte aus `enums.json flatsAutoModes`, geprüft in der Anwendung).
-- - `flats_auto_interval_days` NULL = 7 (nur bei `time_based`, 1–30).
-- statement
ALTER TABLE rig ADD COLUMN flats_auto_mode text;

-- statement
ALTER TABLE rig ADD COLUMN flats_auto_interval_days smallint;
