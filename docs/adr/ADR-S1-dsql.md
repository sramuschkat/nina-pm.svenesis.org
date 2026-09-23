# ADR-S1 – Aurora DSQL: Eigenschaften aus TK 6.0 nachweisen

| | |
|---|---|
| Status | **vorgeschlagen** – wartet auf das Protokoll aus H-22 |
| Datum | 2026-09-23 |
| Arbeitspaket | AP-S1 |
| Anforderungen | TK 6.0 (Reihenfolge = Risiko), TK 6.5, 6.6, 6.8, TK 17, `rules/dsql.md` |

## Kontext
Das Schema (`schema_aurora_dsql.sql`, 52 Tabellen) und die Regeln in `rules/dsql.md` stützen sich auf DSQL-Eigenschaften, die sich 2025/2026 geändert haben und nur aus der Doku geprüft sind (Stand 17.09.2026). Bevor AP-03 Migrationen schreibt, werden sie an einem **kurzlebigen Cluster** nachgewiesen. Die Prüfungen liegen unter `spikes/dsql/`, gestartet über `pnpm test:dsql --spike` (`tools/deploy/src/test-dsql.ts`). Das Skript legt den Cluster mit Tag `purpose=ci` ohne Löschschutz an und löscht ihn im `finally`, auch bei Fehler oder Ctrl-C. Latenzen werden vom Rechner aus gemessen, nicht aus Lambda (CC-6). Ausgeführt wird nur lokal durch Sven mit Admin-Profil (H-22, E1).

**Ausführen (Sven):**

```bash
pnpm test:dsql --spike
```

Dauer etwa 10–15 min, davon gut 5 min für den Laufzeittest; `--skip-long` lässt ihn weg. Das Protokoll landet in `docs/test-runs/<datum>/ap-s1/protocol.md` und `protocol.json`.

## Geprüft
Ergebnisse trägt Claude Code aus dem zurückgegebenen Protokoll ein.

| Nr. | Punkt (TK 6.0) | Befehl / Versuch | Erwartung laut Konzept | Ergebnis |
|---|---|---|---|---|
| S1-01 | (1) Fremdschlüssel | `REFERENCES` beim Anlegen; FK-Verletzung; nachträglich ohne und mit `NOT VALID`; `ALTER TABLE ASYNC … VALIDATE CONSTRAINT` | FK wirkt (23503); nachträglich nur `NOT VALID` + asynchrone Validierung | offen |
| S1-02 | (2) `jsonb` als Spaltentyp | Spalte, Operatoren `->>`, `@>`; 2 MiB gut komprimierbar, 0,8 und 1,6 MiB zufällig; Index auf `jsonb` | Spaltentyp ok; Grenze 1 MiB komprimiert; nicht indexierbar | offen |
| S1-03 | `ADD COLUMN … DEFAULT` | Spalte mit Default auf Bestandszeilen, `NOT NULL DEFAULT`, `ALTER COLUMN TYPE` | Default füllt Bestand; kein `ALTER COLUMN TYPE` | offen |
| S1-04 | `SELECT … FOR UPDATE` bei Schreib-Schiefe | zwei Verbindungen lesen dieselbe Wächterzeile und schreiben verschiedene Zeilen, ohne und mit `FOR UPDATE`; Grundfall gleiche Zeile | ohne: beide Commits ok; mit: zweiter Commit 40001/OC000 | offen |
| S1-05 | (3) `INSERT … ON CONFLICT` | `DO NOTHING RETURNING` neu und doppelt, `DO UPDATE` | verfügbar (sonst Rückfall TK 6.6) | offen |
| S1-06 | (4) Wartefunktion für `CREATE INDEX ASYNC` | Funktionen im Schema `sys` auflisten; Job-ID; `sys.wait_for_job`; `sys.jobs`; `CREATE INDEX` ohne `ASYNC` | Name der Wartefunktion für den Migrationsrunner | offen |
| S1-07 | (5) `GRANT` / `AWS IAM GRANT` | `CREATE ROLE`, `AWS IAM GRANT` an den Aufrufer, `GRANT USAGE`/`SELECT`, Verbindung als Rolle, `INSERT` ohne Recht, zweites `CREATE ROLE`, `AWS IAM REVOKE` | Syntax der Vorlage am Ende des Schemas; Migration 0000 idempotent | offen |
| S1-08 | Node-Connector (TK 6.5) | `AuroraDSQLClient` und Rückfall node-postgres + `DsqlSigner`; 30 × `SELECT 1`; Verbindungsaufbau | Connector bevorzugt; Latenz vom Rechner | offen |
| S1-09 | (6) Grenzen je Transaktion | 3.000 und 3.001 Zeilen; 1–32 MiB zufällige Daten; zwei DDL; DDL + DML; Transaktion > 5 min | ≤ 3.000 Zeilen, begrenztes Volumen, ~5 min, eine DDL, DDL/DML getrennt | offen |
| S1-10 | Nicht unterstützt | `TRUNCATE`, `TEMP TABLE`, PL/pgSQL, Trigger, Extension, Sequenz, `ON DELETE CASCADE` | laut `rules/dsql.md` abgelehnt bzw. bei uns nicht genutzt | offen |

## Entscheidung
Offen bis zum Protokoll. Go für DSQL, wenn S1-01, S1-02, S1-04 und S1-07 wie erwartet ausfallen; sonst greifen die Rückfälle aus TK 6.0 (FKs weglassen bzw. `jsonb` als `text`) und werden hier festgeschrieben.

## Folgen
- AP-03 übernimmt den Namen der Wartefunktion (S1-06), die Idempotenz-Prüfung für Migration 0000 (S1-07) und die gemessenen Grenzen (S1-09) in Runner und `withTx`.
- Abweichungen werden als Änderungsvorschlag für TK 6.0 und `rules/dsql.md` formuliert (Master im Projektordner).
- `pnpm test:dsql` ohne `--spike` baut AP-03 auf demselben Skript auf (Migrationen inkl. 0000, Repository- und OCC-Tests).

## Alternativen
- **Prüfen im CI:** entfällt, GitHub hat keinen AWS-Zugang (E1).
- **Nur Doku lesen:** reicht nicht, DSQL hat sich 2025/2026 stark verändert (`rules/dsql.md`).
