# Regeln: Datenbank (Aurora DSQL)

Quelle: TK 6.0–6.10 (Fakten geprüft 17.09.2026, im Spike AP-S1 am 23.09.2026 nachgewiesen, `docs/adr/ADR-S1-dsql.md`). Bei Widerspruch zu Trainingswissen gilt **diese Datei** – DSQL hat sich 2025/2026 stark verändert.

## Erlaubt (bestätigt)
- Fremdschlüssel (seit 27.08.2026); nachträglich hinzugefügte Constraints nur `NOT VALID` + asynchrone Validierung.
- `jsonb` (≤ 1 MiB komprimiert je Wert, nicht indexierbar).
- `ALTER TABLE … ADD COLUMN` **ohne** `DEFAULT` und Constraint; danach `ALTER COLUMN … SET DEFAULT` (neue Zeilen erhalten den Wert) und Bestand in Stapeln nachfüllen. Außerdem `SET/DROP DEFAULT`, `DROP NOT NULL`, `RENAME`, `DROP COLUMN`.
- `SELECT … FOR UPDATE` (nimmt Zeilen in die OCC-Konfliktprüfung auf).
- `INSERT … ON CONFLICT` (`DO NOTHING RETURNING`, `DO UPDATE … EXCLUDED`; bestätigt in AP-S1).
- Isolation: Repeatable Read, optimistische Nebenläufigkeit.

## Verboten bzw. bei uns nicht genutzt
- Trigger, PL/pgSQL, Sequenzen als Primärschlüssel (UUID v7 verwenden), `TRUNCATE`, `TEMP TABLE`, `ON DELETE/ON UPDATE`-Aktionen (von DSQL unterstützt, bei uns nicht genutzt – Löschen in Stapeln im Repository), `ALTER COLUMN TYPE`, Extensions.
- Indizes nur `CREATE INDEX ASYNC`; die Migration wartet mit **`CALL sys.wait_for_job('<job_id>')`** (Prozedur, nicht `SELECT`) auf den Abschluss, Status in `sys.jobs`.
- `ADD COLUMN` mit `DEFAULT`, `NOT NULL` oder `CHECK` und `ALTER COLUMN … SET NOT NULL` (DSQL: `0A000`). Nachträglich hinzugefügte Spalten bleiben nullbar; die Pflicht sichert zod. `NOT NULL`, `DEFAULT` und `CHECK` nur beim `CREATE TABLE`.
- `GRANT … ON SCHEMA public` (DSQL: `0A000`, nicht nötig).
- Eine DDL je Transaktion; DDL und DML nicht mischen.
- > 3.000 geänderte Zeilen je Transaktion (Stapel ≤ 2.500).

## Muster
- `withTx(ctx, fn, {guard})` mit OCC-Retry (40001/OC000; 3 Versuche, Jitter 50/150/400 ms); `fn` wiederholbar formulieren.
- Invarianten über mehrere Zeilen: Wächterzeile per `guard` (`SELECT … FOR UPDATE`): `tenant` (Owner), `project` (Stimmen vs. Entscheidung, Rang), `app_user` (Rang beim Einreicher), **`rig_lease`** (Lease – nicht `rig`, DAT5-18).
- Jede Abfrage mandantengebunden (`tenant_id = $ctx`), nur in `packages/db/src/repositories`. Isolationstest je Methode.
- Zähler inkrementell im Ingest + nächtlicher Abgleich.
- Migrationen: nur additiv (Expand/Contract), laufen **vor** dem Code (Stack Migrate), jede neue Tabelle mit GRANT an `app_rw`/`app_job` (Vorlage am Ende von `schema_aurora_dsql.sql`). `migrate` verbindet als `admin` und führt auch Migration 0000 (DB-Rollen, `AWS IAM GRANT`) idempotent selbst aus (SV-13, SV-14; `specs/infra/iam.md` §4).
- Lokal/CI: PostgreSQL 16 mit `default_transaction_isolation = 'repeatable read'`; gegen echtes DSQL nur `pnpm test:dsql` lokal bei Sven (H-22); DSQL-Lint (`packages/db/lint`) lehnt obige Verbote ab; `CREATE INDEX ASYNC` wird lokal zu `CREATE INDEX` umgeschrieben.
- Verbindung: offizieller DSQL-Node-Connector (IAM-Token), `pool.on('error')`, max. 2 Verbindungen je Lambda-Container.
- **Wächter (`guard`, `SELECT … FOR UPDATE`) Pflicht für:** `tenant` (Owner-Invarianten), `project` (Abstimmen vs. Entscheiden), `app_user` (Rang beim Einreicher; Rollenablauf entfällt, E2), `rig_lease` (Lease; die `rig`-Zeile wird nie gesperrt), `exposure_line` (Zähler). Zählerpfade schreiben die Wächterzeile immer (`updated_at`), auch bei unverändertem Wert.
- **Sperrreihenfolge (DAT5-20):** mehrere Wächterzeilen derselben Tabelle **aufsteigend nach ID** sperren (Aufnahmen-Ingest: `exposure_line_id`, dann `transit_observation.id`), damit parallele Pakete nicht verklemmen.
- **Grenzen je Transaktion:** ≤ 3.000 geänderte Zeilen (Abbruch schon beim Statement), **≤ 10 MiB** Datenvolumen, **≤ 300 s** Laufzeit (Abbruch beim Commit). Import-, Lösch- und Abgleichläufe arbeiten in Stapeln **mit Fortschrittsmarker im Job** (`job.input.cursor`), damit ein Abbruch wiederaufsetzbar ist.
- `capture_night` hat genau **eine** Zeile je (Zeile, Nacht); `rejected_count` ist der wirksame Wert `max(rejected_individual, rejected_correction)` und wird nie summiert.
- Jeder schreibende Pfad über Fremd-IDs prüft die ganze Kette gegen `tenant_id` (und bei NINA-Token `rig_id`), bevor Zähler geändert werden.
- Löschen: weich (`deleted_at`) wenn Aufnahmen existieren; hart von Blatt zu Wurzel in Stapeln.
