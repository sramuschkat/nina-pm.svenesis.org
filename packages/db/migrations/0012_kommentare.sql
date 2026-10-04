-- Migration 0012 – Kommentare am Projekt (FA-PRJ-17, Ausbau der Notizen, Entscheidung Sven 04.10.2026).
-- Additiv nach ADR-S1: Spalten ohne DEFAULT/Constraint, kein Nachfüllen (bestehende Notizen sind Kommentare
-- der obersten Ebene, nie bearbeitet, nicht gelöscht – NULL ist für alle vier Spalten der richtige Bestand).
-- - `parent_id`: Antwort auf einen Kommentar der obersten Ebene (eine Ebene tief; die Anwendung hängt eine
--   Antwort auf eine Antwort an denselben Strang). Ohne FK (nachträglich nur NOT VALID, hier nicht nötig).
-- - `edited_at`: letzte Bearbeitung durch den Verfasser (höchstens 1 h nach dem Anlegen).
-- - `deleted_at`/`deleted_by`: weich gelöscht durch Admin/Owner; Text wird nicht mehr ausgeliefert,
--   Antworten bleiben.
-- - `project_note_reaction`: eine Zeile je (Kommentar, Mitglied, Emoji) aus `enums.json commentReactions`.
-- statement
ALTER TABLE project_note ADD COLUMN parent_id uuid;

-- statement
ALTER TABLE project_note ADD COLUMN edited_at timestamptz;

-- statement
ALTER TABLE project_note ADD COLUMN deleted_at timestamptz;

-- statement
ALTER TABLE project_note ADD COLUMN deleted_by uuid;

-- statement
CREATE TABLE project_note_reaction (               -- Reaktionen auf Kommentare (FA-PRJ-17)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    note_id         uuid NOT NULL REFERENCES project_note(id),
    user_id         uuid NOT NULL REFERENCES app_user(id),
    emoji           text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (note_id, user_id, emoji)
);

-- statement
CREATE INDEX ASYNC ix_project_note_reaction_tenant ON project_note_reaction (tenant_id, note_id);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON project_note_reaction TO app_rw;

-- statement
GRANT SELECT, INSERT ON project_note_reaction TO app_job;
