# pnpm test:dsql – Protokoll (AP-03)

| | |
|---|---|
| Beginn / Ende | 2026-10-10T07:56:13.752Z / 2026-10-10T08:10:46.555Z |
| Commit | fa8a27b |
| Migrationsstand | 329aaaa3e9447996 |
| Cluster | svuesl5zlxtkxjicn2rbqkewge (eu-central-1), ACTIVE nach 5498 ms |
| Aufrufer | arn:aws:iam::<account>:user/<admin> |
| Ergebnis | **grün** |

| Nr. | Prüfung | Ergebnis | Zusammenfassung | ms |
|---|---|---|---|---|
| D-01 | Migration 0000 und Migrationen, idempotent | ✔ | 0000: 7 Änderungen, danach 0; Migrationen: 233 Anweisungen angewandt, zweiter Lauf 0; 56 Tabellen | 854393 |
| D-02 | Rechte-Matrix je DB-Rolle nach TK 6.2 | ✔ | 454 Rechte geprüft, alle wie TK 6.2 | 6888 |
| D-03 | SEC-4: app_job schreibt keine Sitzungen/Tokens, app_rw keine Kataloge | ✔ | 12 verbotene Zugriffe mit 42501 abgelehnt, erlaubte Lesezugriffe, Rig-Sperre und Antragsrang ok | 1402 |
| D-04 | withTx: OCC-Konflikt über Wächterzeile wird wiederholt | ✔ | beide Transaktionen erfolgreich, 1 Wiederholung(en) nach 40001 | 769 |
| D-05 | Grenze 3.000 geänderte Zeilen je Transaktion | ✔ | 3.001 Zeilen abgelehnt (DSQL 54000), nichts übernommen | 366 |
| D-06 | Mandantenisolation (TenantRepository) und Gegenprobe | ✔ | fremder Mandant unsichtbar; fehlender Filter wird erkannt | 206 |
| D-07 | Jobs: dedupe_active, höchstens 3 offene Jobs je Mitglied, Übernahme (AP-05) | ✔ | 3 offene Jobs, 4. → auth.rate_limited; Dedupe über dedupe_active; claim/finish/fail; Vorrang in stale() | 1838 |
