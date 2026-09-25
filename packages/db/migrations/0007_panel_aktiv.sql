-- Migration 0007 – Panel aktiv/inaktiv (AP-22, Mosaik-Editor; Entscheidung Sven 25.09.2026).
-- Additiv nach ADR-S1: Spalte ohne DEFAULT/Constraint, danach SET DEFAULT für neue Zeilen. Kein Nachfüllen:
-- NULL gilt als aktiv (Repository `enabled !== false`). Inaktive Panels fallen vor der Engine aus der
-- Planung und aus der NINA-Auslieferung heraus – wie deaktivierte Zeilen; der Scheduler bleibt unverändert.
-- statement
ALTER TABLE project_panel ADD COLUMN enabled boolean;

-- statement
ALTER TABLE project_panel ALTER COLUMN enabled SET DEFAULT true;
