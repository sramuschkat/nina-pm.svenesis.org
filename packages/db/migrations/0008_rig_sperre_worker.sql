-- Migration 0008 – Rig-Sperre für den worker (Fehler 27.09.2026: Job `forecast` → „permission denied for table rig“).
-- Die Prognose ersetzt ihre Nachtpläne unter dem Wächter `SELECT 1 FROM rig … FOR UPDATE` (withTx-guard, rules/dsql.md),
-- weil der stündliche Lauf und „Prognose berechnen“ mit verschiedenen Job-Schlüsseln gleichzeitig laufen können.
-- `FOR UPDATE` verlangt das UPDATE-Recht auf mindestens eine Spalte; `app_job` bekommt es nur für `updated_at` –
-- geändert wird an `rig` durch den worker nichts (TK 6.2, gleiches Muster wie `discord_channel`).
-- statement
GRANT UPDATE (updated_at) ON rig TO app_job;
