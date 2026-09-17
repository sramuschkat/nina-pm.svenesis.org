# Regeln: Datenbank (Aurora DSQL)

Quelle: TK 6.0–6.10 (Fakten geprüft 17.09.2026). Bei Widerspruch zu Trainingswissen gilt **diese Datei** – DSQL hat sich 2025/2026 stark verändert.

## Erlaubt (bestätigt)
- Fremdschlüssel (seit 27.08.2026); nachträglich hinzugefügte Constraints nur `NOT VALID` + asynchrone Validierung.
- `jsonb` (≤ 1 MiB komprimiert je Wert), `ALTER TABLE … ADD COLUMN … DEFAULT …`.
- `SELECT … FOR UPDATE` (nimmt Zeilen in die OCC-Konfliktprüfung auf).
- `INSERT … ON CONFLICT` (in AP-S1 bestätigen; Fallback in TK 6.6).
- Isolation: Repeatable Read, optimistische Nebenläufigkeit.

## Verboten bzw. bei uns nicht genutzt
- Trigger, PL/pgSQL, Sequenzen als Primärschlüssel (UUID v7 verwenden), `TRUNCATE`, `TEMP TABLE`, `ON DELETE/ON UPDATE`-Aktionen (von DSQL unterstützt, bei uns nicht genutzt – Löschen in Stapeln im Repository), `ALTER COLUMN TYPE`, Extensions.
- Indizes nur `CREATE INDEX ASYNC` (Migration wartet auf Abschluss über die Wartefunktion aus AP-S1).
- Eine DDL je Transaktion; DDL und DML nicht mischen.
- > 3.000 geänderte Zeilen je Transaktion (Stapel ≤ 2.500).

## Muster
- `withTx(ctx, fn, {guard})` mit OCC-Retry (40001/OC000; 3 Versuche, Jitter 50/150/400 ms); `fn` wiederholbar formulieren.
- Invarianten über mehrere Zeilen: Wächterzeile per `guard` (`SELECT … FOR UPDATE`): `tenant` (Owner), `project` (Stimmen vs. Entscheidung, Rang), `app_user` (Rollenablauf), **`rig_lease`** (Lease – nicht `rig`, DAT5-18).
- Jede Abfrage mandantengebunden (`tenant_id = $ctx`), nur in `packages/db/src/repositories`. Isolationstest je Methode.
- Zähler inkrementell im Ingest + nächtlicher Abgleich.
- Migrationen: nur additiv (Expand/Contract), laufen **vor** dem Code (Stack Migrate), jede neue Tabelle mit GRANT (Vorlage am Ende von `schema_aurora_dsql.sql`).
- Lokal/CI: PostgreSQL 16 mit `default_transaction_isolation = 'repeatable read'`; DSQL-Lint (`packages/db/lint`) lehnt obige Verbote ab; `CREATE INDEX ASYNC` wird lokal zu `CREATE INDEX` umgeschrieben.
- Verbindung: offizieller DSQL-Node-Connector (IAM-Token), `pool.on('error')`, max. 2 Verbindungen je Lambda-Container.
- **Wächter (`guard`, `SELECT … FOR UPDATE`) Pflicht für:** `tenant` (Owner-Invarianten), `project` (Abstimmen vs. Entscheiden), `app_user` (Rollenablauf, Rang beim Einreicher), `rig_lease` (Lease; die `rig`-Zeile wird nie gesperrt), `exposure_line` (Zähler). Zählerpfade schreiben die Wächterzeile immer (`updated_at`), auch bei unverändertem Wert.
- **Sperrreihenfolge (DAT5-20):** mehrere Wächterzeilen derselben Tabelle **aufsteigend nach ID** sperren (Aufnahmen-Ingest: `exposure_line_id`, dann `transit_observation.id`), damit parallele Pakete nicht verklemmen.
- **Grenzen je Transaktion:** ≤ 3.000 geänderte Zeilen sowie begrenztes Datenvolumen und Laufzeit (~5 min). Import-, Lösch- und Abgleichläufe arbeiten in Stapeln **mit Fortschrittsmarker im Job** (`job.input.cursor`), damit ein Abbruch wiederaufsetzbar ist.
- `capture_night` hat genau **eine** Zeile je (Zeile, Nacht); `rejected_count` ist der wirksame Wert `max(rejected_individual, rejected_correction)` und wird nie summiert.
- Jeder schreibende Pfad über Fremd-IDs prüft die ganze Kette gegen `tenant_id` (und bei NINA-Token `rig_id`), bevor Zähler geändert werden.
- Löschen: weich (`deleted_at`) wenn Aufnahmen existieren; hart von Blatt zu Wurzel in Stapeln.
