-- Migration 0011 – Rollenansicht „Als User ansehen“ (Wunsch Sven 30.09.2026, security-auth.md).
-- Additiv nach ADR-S1: Spalte ohne DEFAULT/Constraint, kein Nachfüllen. NULL = eigene Rolle; 'user' = diese
-- Sitzung wirkt im Mandanten mit User-Rechten (nur Herabstufung, nie mehr Rechte). Erlaubte Werte prüft die
-- Anwendung; POST /auth/context setzt die Spalte zurück. Rechte: Tabellenrecht von app_rw (0002) genügt.
-- statement
ALTER TABLE auth_session ADD COLUMN acting_role text;
