-- Migration 0002 – B. Mandant, Benutzer, Berechtigung
-- Erzeugt aus docs/concept/schema_aurora_dsql.sql v1.19 (scripts/generate-migrations.ts, AP-03).
-- Eine Anweisung je Abschnitt, jede in eigener Transaktion (DSQL: eine DDL je Transaktion).
-- GRANTs je Tabelle für app_rw und app_job nach TK 6.2 (src/grants.ts).
-- statement
CREATE TABLE app_user (                            -- Mitgliedschaft einer Identität in einem Mandanten (Rolle je Mandant)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    identity_id     uuid NOT NULL REFERENCES identity(id),
    display_name    text NOT NULL,                 -- Vorbelegung aus Discord, im Mandanten änderbar
    role            text NOT NULL CHECK (role IN ('admin','user')),   -- Owner = tenant.owner_member_id (immer role='admin'); keine Befristung (E2),
                                                   -- Rollenwechsel wirken ab der naechsten Anfrage (Sitzung liest die Mitgliedschaft je Anfrage, SV-01)
    status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','removed')),
    invited_by      uuid REFERENCES app_user(id),
    last_login_at   timestamptz,                   -- letzte Anmeldung im Mandanten (POST /auth/context bzw. Callback mit direkter Mandantenwahl, FA-SU-03)
    allowed_rig_ids jsonb,                         -- optional (FA-BEN-05), null = alle
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, identity_id)
);

-- statement
CREATE INDEX ASYNC ix_app_user_identity ON app_user (identity_id, status);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON app_user TO app_rw;

-- statement
GRANT SELECT ON app_user TO app_job;

-- statement
CREATE TABLE invitation (                          -- Einladungslink (FA-BEN-01)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    token_hash      text NOT NULL UNIQUE,          -- SHA-256 des Link-Tokens (256 Bit zufaellig, base64url); nie exportiert
    role            text NOT NULL CHECK (role IN ('owner','admin','user')),  -- 'owner' nur vom Super User bzw. ops-cli
    discord_user_id text,                          -- optional: nur für dieses Discord-Konto gültig
    note            text,
    max_uses        smallint NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 50),
    used_count      smallint NOT NULL DEFAULT 0,
    expires_at      timestamptz NOT NULL,
    created_by_member uuid REFERENCES app_user(id),
    created_by_super uuid REFERENCES super_user(identity_id),
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (role = 'user' OR max_uses = 1)          -- Owner- und Admin-Einladungen genau einmal; Owner-Einladung bei vorhandenem Owner -> invitation.invalid (TK 5.2)
);

-- statement
CREATE INDEX ASYNC ix_invitation_tenant ON invitation (tenant_id, expires_at);

-- statement
CREATE INDEX ASYNC ix_invitation_expiry ON invitation (expires_at);   -- Job-Index

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON invitation TO app_rw;

-- statement
GRANT SELECT, DELETE ON invitation TO app_job;

-- statement
CREATE TABLE auth_session (                        -- Anmeldesitzung (Cookie __Host-npm_sid, SV-01); Logout/Widerruf = Zeile loeschen
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_hash    text NOT NULL UNIQUE,          -- SHA-256 des Cookie-Werts (256 Bit zufaellig), Klartext nie gespeichert; je Anfrage eine indizierte Abfrage
    identity_id     uuid NOT NULL REFERENCES identity(id),
    tenant_id       uuid REFERENCES tenant(id),    -- gewaehlter Mandant (POST /auth/context); null = System-Kontext bzw. noch keine Auswahl
    context         text NOT NULL CHECK (context IN ('tenant','system','select')),
    user_agent      text,                          -- Anzeige in der Sitzungsliste
    ip_truncated    text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),  -- hoechstens alle 5 min geschrieben; Leerlauf-Ablauf: last_seen_at + 14 Tage (feste Konstante)
    expires_at      timestamptz NOT NULL           -- Hoechstdauer: created_at + 30 Tage (feste Konstante), nie verlaengert
);

-- statement
CREATE INDEX ASYNC ix_auth_session_identity ON auth_session (identity_id);   -- Sitzungsliste, alle Sitzungen einer Identitaet beenden

-- statement
CREATE INDEX ASYNC ix_auth_session_expiry ON auth_session (expires_at);   -- Aufraeumen abgelaufener Zeilen durch api bei der Anmeldung (Hoechstdauer oder Leerlauf)

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_session TO app_rw;

-- statement
CREATE TABLE user_preference (                     -- ersetzt Astro PMs AppSettings (UI-Zustände, Filter, Einheiten)
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    user_id         uuid NOT NULL REFERENCES app_user(id),   -- Einstellungen je Mitgliedschaft
    pref_key        text NOT NULL,                 -- 'exo.filters', 'weather.units', 'projects.viewMode', 'skyview.overlays' ...
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, pref_key)
);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON user_preference TO app_rw;

-- statement
CREATE TABLE identity_preference (                 -- mandantenübergreifende Einstellungen (Sprache, Theme; auch Super User)
    identity_id     uuid NOT NULL REFERENCES identity(id),
    pref_key        text NOT NULL,
    value           jsonb NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (identity_id, pref_key)
);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON identity_preference TO app_rw;

-- statement
CREATE TABLE notification (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid REFERENCES tenant(id),     -- NULL = Systembenachrichtigung an einen Super User (z. B. alert.*, owner.reassigned)
    recipient_id    uuid REFERENCES app_user(id),   -- Mitglied im Mandanten ...
    recipient_identity_id uuid REFERENCES identity(id),  -- ... oder Identität (Super User ohne Mitgliedschaft); genau eines von beiden
    CHECK ((recipient_id IS NOT NULL) <> (recipient_identity_id IS NOT NULL)),
    kind            text NOT NULL,                 -- Werte ausschließlich aus contracts/enums.json notificationKinds (CI-Test prüft Schema gegen enums.json); u. a. submission.new, approval.approved, approval.returned, deadline.near, project.completed, vote.subject_resubmitted, submission.edited_by_admin, transit.confirmation_needed, alert.* (Betriebsalarme) ...  – Discord-Zustellung über job(kind='discord_post')
    project_id      uuid,                          -- ohne FK (Tabelle project folgt später)
    payload         jsonb NOT NULL DEFAULT '{}',
    read_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- statement
CREATE INDEX ASYNC ix_notification_recipient ON notification (tenant_id, recipient_id, read_at);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON notification TO app_rw;

-- statement
GRANT INSERT ON notification TO app_job;

-- statement
CREATE TABLE change_log (                          -- Änderungsverlauf je Objekt (FA-BER-03, NFA-12)
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id),
    entity          text NOT NULL,                 -- 'project','exposure_line','rig','app_user' (Rollenwechsel: diff.reason optional) ...
    entity_id       uuid NOT NULL,
    user_id         uuid REFERENCES app_user(id),   -- handelndes Mitglied; bei Rollenwechseln = Rolle vergeben von
    action          text NOT NULL,                 -- create/update/delete
    diff            jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- statement
CREATE INDEX ASYNC ix_change_log_entity ON change_log (tenant_id, entity, entity_id, created_at);

-- statement
GRANT SELECT, INSERT, UPDATE, DELETE ON change_log TO app_rw;

-- statement
GRANT INSERT ON change_log TO app_job;
