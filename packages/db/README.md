# @nina-pm/db

Datenbankzugriff für Aurora DSQL (prod) und PostgreSQL 16 (lokal, CI) – TK 6, `rules/dsql.md`, ADR-S1.

| Teil | Datei | Inhalt |
|---|---|---|
| Verbindung | `src/connection.ts` | offizieller DSQL-Connector (IAM-Token, max. 2 Verbindungen, `pool.on('error')`) bzw. `pg` mit Repeatable Read; **nur** aus `src/repositories` importierbar (ESLint) |
| Transaktionen | `src/tx.ts` | `withTx` mit OCC-Wiederholung (40001/OC000/OC001, 50/150/400 ms + Jitter), Wächter per `SELECT … FOR UPDATE` in fester Reihenfolge, Zeilenzähler (≤ 3.000) |
| Repositories | `src/repositories/` | `TenantRepo` (Mandanten-Guard), Beispiel `TenantRepository`, `openDatabase()` |
| Rechte | `src/grants.ts` | GRANTs je Tabelle für `app_rw` und `app_job` nach TK 6.2 – Quelle für Migrationen, Lint und Tests |
| Migrationen | `migrations/NNNN_*.sql`, `src/migrate/` | Runner (eine Anweisung je `-- statement`, Buchführung je Anweisung, `CALL sys.wait_for_job`), Migration 0000 (Rollen, `AWS IAM GRANT`, idempotent) |
| Lint | `lint/` | DSQL-Lint: Verbote aus TK 6.8/ADR-S1, GRANTs je neue Tabelle genau nach TK 6.2 |
| Prüfungen | `src/testing/` | Suites D-01…D-06 für CI (PostgreSQL) und `pnpm test:dsql` (DSQL) |
| Seed | `src/seed.ts` | Mandanten, Identitäten, Super User, Mitgliedschaften aus `docs/seed/seed-demo.json` |

## Lokal

```bash
pnpm db:up        # PostgreSQL 16 per Docker Compose
pnpm db:migrate   # Migration 0000 (ohne IAM) + alle Migrationen
pnpm db:seed      # Demo-Seed
pnpm db:lint      # DSQL-Lint (läuft auch in `pnpm lint`)
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ninapm pnpm test
```

Ohne `DATABASE_URL` überspringt Vitest die Datenbank-Suites; im CI laufen sie gegen einen PostgreSQL-16-Service-Container.

## Neue Migration

1. Datei `migrations/NNNN_beschreibung.sql`, jede Anweisung hinter `-- statement`, nur additiv (Expand/Contract).
2. Neue Tabelle: Eintrag in `src/grants.ts` (Gruppe nach TK 6.2) und beide GRANT-Sätze in der Migration.
3. Neue Spalte: ohne `DEFAULT`/Constraint anlegen, `SET DEFAULT` als eigene Anweisung, Bestand per Job in Stapeln nachfüllen (ADR-S1).
4. In `src/migrate/bundled.ts` eintragen (Test prüft den Abgleich).
5. Vor dem Merge: `pnpm test:dsql` durch Sven (H-22), Protokoll committen; `pnpm deploy:prod` verlangt es und sichert den Cluster vorher.

`scripts/generate-migrations.ts` hat die Migrationen 0001–0005 einmalig aus `docs/concept/schema_aurora_dsql.sql` erzeugt; seitdem sind die Migrationen die Quelle der Wahrheit.
