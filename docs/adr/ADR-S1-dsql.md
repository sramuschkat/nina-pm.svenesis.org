# ADR-S1 – Aurora DSQL: Eigenschaften aus TK 6.0 nachweisen

| | |
|---|---|
| Status | **angenommen** – Go für Aurora DSQL durch Sven am 23.09.2026 (H-22) |
| Datum | 2026-09-23 |
| Arbeitspaket | AP-S1 |
| Anforderungen | TK 6.0 (Reihenfolge = Risiko), TK 6.5, 6.6, 6.8, TK 17, `rules/dsql.md` |
| Protokolle | `docs/test-runs/2026-09-23/ap-s1/protocol.md` (Lauf 1, vollständig inkl. 5-Minuten-Test), `protocol-2.md` (Lauf 2, Nachprüfung der Ersatzwege, `--skip-long`) |

## Kontext
Schema und Regeln stützen sich auf DSQL-Eigenschaften, die bisher nur aus der Doku geprüft waren (Stand 17.09.2026). Bevor AP-03 Migrationen schreibt, wurden sie an zwei **kurzlebigen Clustern** in `eu-central-1` nachgewiesen. Gestartet wurde lokal durch Sven mit `pnpm test:dsql --spike` (H-22, E1). Jeder Cluster trug `purpose=ci` und wurde im `finally` gelöscht. Latenzen sind vom Rechner aus gemessen, nicht aus Lambda (CC-6). Nach Lauf 1 wurden für drei Abweichungen Ersatzwege ergänzt und in Lauf 2 geprüft.

## Geprüft

| Nr. | Punkt (TK 6.0) | Befehl / Versuch | Ergebnis |
|---|---|---|---|
| S1-01 | (1) Fremdschlüssel | `REFERENCES` beim Anlegen; Verletzung; nachträglich ohne und mit `NOT VALID`; `ALTER TABLE ASYNC … VALIDATE CONSTRAINT`; Warten | ✔ Verletzung → 23503. Nachträglich ohne `NOT VALID` → 0A000, mit `NOT VALID` ok und danach wirksam. `VALIDATE` liefert eine Job-ID. |
| S1-02 | (2) `jsonb` als Spaltentyp | Spalte, `->>`, `->`, `@>`, `jsonb_typeof`; 2 MiB gut komprimierbar; 0,8 und 1,6 MiB zufällig; Index | ✔ Spaltentyp und Operatoren ok. 2 MiB komprimierbar und 0,8 MiB zufällig ok, 1,6 MiB zufällig → 54000 („limit greater than 1048576 bytes“). Index auf `jsonb` → 0A000. |
| S1-03 | `ALTER TABLE ADD COLUMN` | mit `DEFAULT`, mit `NOT NULL DEFAULT`; ohne Default, danach `SET DEFAULT`, Nachfüllen, `SET NOT NULL`, `DROP NOT NULL`, `DROP DEFAULT`, `RENAME`, `DROP COLUMN`, `ALTER COLUMN TYPE` | ✘ **Abweichung:** `ADD COLUMN … DEFAULT` und `… NOT NULL DEFAULT` → 0A000 („with constraint not supported“). ✔ Ersatzweg: `ADD COLUMN` ohne Default ok, `SET DEFAULT` ok (neue Zeilen erhalten den Wert), `UPDATE` zum Nachfüllen ok. ✘ `SET NOT NULL` → 0A000. ✔ `DROP NOT NULL`, `DROP DEFAULT`, `RENAME`, `DROP COLUMN` ok. `ALTER COLUMN TYPE` → 0A000 wie erwartet. |
| S1-04 | `SELECT … FOR UPDATE` bei Schreib-Schiefe | zwei Verbindungen, gleiche Wächterzeile, verschiedene Zielzeilen, ohne und mit `FOR UPDATE`; Grundfall gleiche Zeile | ✔ Ohne `FOR UPDATE` beide Commits ok (Schreib-Schiefe möglich). Mit `FOR UPDATE` zweiter Commit → 40001. Gleiche Zeile → 40001. Isolation `repeatable read`. |
| S1-05 | (3) `INSERT … ON CONFLICT` | `DO NOTHING RETURNING` neu und doppelt; `DO UPDATE … EXCLUDED` | ✔ Neu 1 Zeile, Duplikat 0 Zeilen, `DO UPDATE` ergibt n = 2. Der Rückfall aus TK 6.6 wird nicht gebraucht. |
| S1-06 | (4) Wartefunktion für `CREATE INDEX ASYNC` | Funktionen in `sys`; Job-ID; `SELECT sys.wait_for_job`; `CALL sys.wait_for_job`; `sys.jobs`; `CREATE INDEX` ohne `ASYNC` | ✘ **Abweichung im Aufruf:** `SELECT sys.wait_for_job(…)` → 42809 („is a procedure“). ✔ `CALL sys.wait_for_job('<job_id>')` ok. Status steht in `sys.jobs` (`job_type = INDEX_BUILD`). Job-IDs sind base32-Kleinbuchstaben. Ohne `ASYNC` → 0A000 („please use CREATE INDEX ASYNC“). |
| S1-07 | (5) Rollen und Grants | `CREATE ROLE`, `AWS IAM GRANT` an den Aufrufer (IAM-Benutzer), `sys.iam_pg_role_mappings`, `GRANT USAGE ON SCHEMA public`, `GRANT SELECT`, Anmeldung als Rolle, `INSERT` ohne Recht, zweites `CREATE ROLE`, `AWS IAM REVOKE` | ✔ `AWS IAM GRANT` ok, auch für einen IAM-Benutzer. Die Zuordnung ist in `sys.iam_pg_role_mappings` sichtbar. `GRANT SELECT` ok. Die Rolle meldet sich per IAM-Token an, `SELECT` ok, `INSERT` → 42501. ✘ **Abweichung:** `GRANT USAGE ON SCHEMA public` → 0A000 („feature not supported on system entity“), wird aber nicht gebraucht. Zweites `CREATE ROLE` → 42710, also vorher `pg_roles` prüfen. `AWS IAM REVOKE` ok. |
| S1-08 | Node-Connector (TK 6.5) | `AuroraDSQLClient`; node-postgres + `DsqlSigner`; 30 × `SELECT 1`; Verbindungsaufbau | ✔ Beide Wege ok. Abfrage-Latenz vom Rechner p50 17 ms, p95 20–94 ms, max ≈ 100 ms. Verbindungsaufbau 100–330 ms. PostgreSQL 16. |
| S1-09 | (6) Grenzen je Transaktion | 3.000 / 3.001 Zeilen; 1–32 MiB zufällig; zwei DDL; DDL + DML; Transaktion 310 s | ✔ 3.000 Zeilen ok, 3.001 → 54000 („transaction row limit exceeded“) **schon beim Statement**. Volumen 8 MiB ok, 16 MiB → 54000 („transaction size limit 10mb exceeded“) beim Commit. Laufzeit: `pg_sleep(310)` läuft, der Commit → 54000 („transaction age limit of 300s exceeded“). Zwei DDL → 0A000, DDL + DML → 0A000. |
| S1-10 | Nicht unterstützt | `TRUNCATE`, `TEMP TABLE`, PL/pgSQL, Trigger, Extension, Sequenz, `ON DELETE CASCADE` | ✔ Alle abgelehnt (0A000). Sequenzen gehen nur mit `CACHE ≥ 65536` oder `= 1` (bei uns nicht genutzt). `ON DELETE CASCADE` ist möglich (bei uns nicht genutzt). |

## Entscheidung
**Go für Aurora DSQL** (Sven, 23.09.2026). Alle Punkte mit hohem Risiko halten: Fremdschlüssel, `jsonb` als Spaltentyp, `FOR UPDATE` als Wächter, `ON CONFLICT`, `AWS IAM GRANT` mit getrennten DB-Rollen und der offizielle Node-Connector. Die Rückfälle aus TK 6.0 (FKs weglassen, `jsonb` als `text`) entfallen. Verbindlich ab jetzt:

1. **Neue Spalten in Folge-Migrationen** werden ohne `DEFAULT` und ohne Constraint angelegt. Danach setzt `ALTER COLUMN … SET DEFAULT` den Standard für neue Zeilen, und der Bestand wird in Stapeln ≤ 2.500 nachgefüllt. Nachträglich ist **kein `NOT NULL`** möglich. Solche Spalten sind in der Datenbank nullbar, die Pflicht sichert das zod-Schema. `NOT NULL`, `DEFAULT` und `CHECK` gibt es nur beim `CREATE TABLE`.
2. **Warten auf asynchrone Jobs** mit `CALL sys.wait_for_job('<job_id>')`. Das gilt für `CREATE INDEX ASYNC` und `ALTER TABLE ASYNC … VALIDATE CONSTRAINT`.
3. **Migration 0000 ohne `GRANT USAGE ON SCHEMA public`.** Idempotent über `pg_roles` vor `CREATE ROLE` und `sys.iam_pg_role_mappings` vor `AWS IAM GRANT`.
4. **Grenzen je Transaktion:** 3.000 geänderte Zeilen (Abbruch schon beim Statement), **10 MiB** Datenvolumen, **300 s** Laufzeit; eine DDL, nicht mit DML gemischt.

## Folgen
Änderungsvorschläge. Die Masterdateien liegen im Projektordner, Sven entscheidet.

| Datei, Abschnitt | heute | Vorschlag |
|---|---|---|
| `CLAUDE.md`, Harte Regel 1 | „FKs, jsonb, `ADD COLUMN … DEFAULT` sind erlaubt.“ | „FKs und jsonb sind erlaubt. `ADD COLUMN` nur ohne `DEFAULT` und Constraint (Default danach per `SET DEFAULT`, Bestand in Stapeln nachfüllen, nachträglich kein `NOT NULL`).“ |
| TK 6.0, Zeile `ALTER TABLE` | `ADD COLUMN` (mit DEFAULT), …, `DROP NOT NULL` | `ADD COLUMN` nur ohne DEFAULT/Constraint; `SET DEFAULT`, `DROP DEFAULT`, `DROP NOT NULL`, `RENAME`, `DROP COLUMN` ok; **kein** `SET NOT NULL`, kein `ALTER COLUMN TYPE` (AP-S1) |
| TK 6.0, Zeile `Grenzen` | „begrenztes Datenvolumen und Laufzeit (~5 min)“ | „max. 3.000 geänderte Zeilen (Abbruch beim Statement), **10 MiB** Datenvolumen, **300 s** Laufzeit je Transaktion (AP-S1)“ |
| TK 6.0, Absatz „In AP-S1 zwingend zuerst zu prüfen“ | offene Prüfliste mit Rückfällen | „Geprüft in AP-S1 (ADR-S1): alles bestätigt, Rückfälle entfallen; Abweichungen siehe ADR-S1“ |
| TK 6.8, Migrationen | „Systemfunktion zum Warten auf Index-Jobs laut DSQL-Doku“ | „`CALL sys.wait_for_job('<job_id>')` (Prozedur), Status in `sys.jobs`“; DSQL-Lint zusätzlich: `ADD COLUMN` mit `DEFAULT`/`NOT NULL`/`CHECK`, `SET NOT NULL`, `GRANT … ON SCHEMA` |
| `rules/dsql.md`, Erlaubt | „`ALTER TABLE … ADD COLUMN … DEFAULT …`“; „`INSERT … ON CONFLICT` (in AP-S1 bestätigen)“ | Eintrag streichen; `ON CONFLICT` als bestätigt; neu: `CALL sys.wait_for_job` |
| `rules/dsql.md`, Verboten | – | neu: `ADD COLUMN` mit `DEFAULT`/`NOT NULL`/`CHECK`, `SET NOT NULL`, `GRANT … ON SCHEMA public`; Grenzen 10 MiB / 300 s |
| `schema_aurora_dsql.sql`, GRANT-Vorlage | `GRANT USAGE ON SCHEMA public TO app_rw, app_job;` | Zeile streichen (0A000, nicht nötig); Idempotenz über `pg_roles` und `sys.iam_pg_role_mappings` ergänzen |

Weitere Folgen:
- AP-03 übernimmt die vier Punkte der Entscheidung in Runner, DSQL-Lint und `withTx` (Zähler bricht bei 3.000 ab; lange Läufe in Stapeln mit Fortschrittsmarker bleiben Pflicht wegen 300 s).
- `pnpm test:dsql` ohne `--spike` baut AP-03 auf `tools/deploy/src/test-dsql.ts` und `withEphemeralCluster` auf.
- Neues Risiko: nachträglich nullbare Pflichtfelder. Die Pflicht hängt dann an zod und an Repository-Tests; der DSQL-Lint verhindert, dass jemand es anders versucht.

## Alternativen
- **Prüfen im CI:** entfällt, GitHub hat keinen AWS-Zugang (E1).
- **Neue Spalten per Tabellenkopie mit `NOT NULL`:** zu teuer bei der 3.000-Zeilen-Grenze und ohne `TRUNCATE`; nur für Einzelfälle.
- **Nur der Doku vertrauen:** hat sich bei `ADD COLUMN DEFAULT`, `GRANT USAGE` und der Wartefunktion als falsch erwiesen.
