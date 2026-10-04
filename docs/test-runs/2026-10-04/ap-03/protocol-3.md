# pnpm test:dsql – Protokoll (AP-03)

| | |
|---|---|
| Beginn / Ende | 2026-10-04T11:32:48.548Z / 2026-10-04T11:44:57.475Z |
| Commit | 30f5fe9 |
| Migrationsstand | eca74aea262c75a9 |
| Cluster | zzt5dbcojhlcctheqcpmcixf3e (eu-central-1), ACTIVE nach 5392 ms |
| Aufrufer | arn:aws:iam::509219055019:user/sramuschkat-portfolio-dev |
| Ergebnis | **grün** |

| Nr. | Prüfung | Ergebnis | Zusammenfassung | ms |
|---|---|---|---|---|
| D-01 | Migration 0000 und Migrationen, idempotent | ✔ | 0000: 7 Änderungen, danach 0; Migrationen: 221 Anweisungen angewandt, zweiter Lauf 0; 53 Tabellen | 707635 |
| D-02 | Rechte-Matrix je DB-Rolle nach TK 6.2 | ✔ | 430 Rechte geprüft, alle wie TK 6.2 | 8528 |
| D-03 | SEC-4: app_job schreibt keine Sitzungen/Tokens, app_rw keine Kataloge | ✔ | 12 verbotene Zugriffe mit 42501 abgelehnt, erlaubte Lesezugriffe, Rig-Sperre und Antragsrang ok | 1666 |
| D-04 | withTx: OCC-Konflikt über Wächterzeile wird wiederholt | ✔ | beide Transaktionen erfolgreich, 1 Wiederholung(en) nach 40001 | 1000 |
| D-05 | Grenze 3.000 geänderte Zeilen je Transaktion | ✔ | 3.001 Zeilen abgelehnt (DSQL 54000), nichts übernommen | 345 |
| D-06 | Mandantenisolation (TenantRepository) und Gegenprobe | ✔ | fremder Mandant unsichtbar; fehlender Filter wird erkannt | 323 |
| D-07 | Jobs: dedupe_active, höchstens 3 offene Jobs je Mitglied, Übernahme (AP-05) | ✔ | 3 offene Jobs, 4. → auth.rate_limited; Dedupe über dedupe_active; claim/finish/fail; Vorrang in stale() | 2274 |
