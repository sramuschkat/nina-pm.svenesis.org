# pnpm test:dsql – Protokoll (AP-03)

| | |
|---|---|
| Beginn / Ende | 2026-09-24T12:06:43.178Z / 2026-09-24T12:21:10.424Z |
| Commit | 1edef1a |
| Migrationsstand | 387475bdb1135fb0 |
| Cluster | ufudjs2p2v2jmtriq2tfzpwkbi (eu-central-1), ACTIVE nach 5405 ms |
| Aufrufer | arn:aws:iam::509219055019:user/sramuschkat-portfolio-dev |
| Ergebnis | **grün** |

| Nr. | Prüfung | Ergebnis | Zusammenfassung | ms |
|---|---|---|---|---|
| D-01 | Migration 0000 und Migrationen, idempotent | ✔ | 0000: 7 Änderungen, danach 0; Migrationen: 197 Anweisungen angewandt, zweiter Lauf 0; 52 Tabellen | 846713 |
| D-02 | Rechte-Matrix je DB-Rolle nach TK 6.2 | ✔ | 420 Rechte geprüft, alle wie TK 6.2 | 8592 |
| D-03 | SEC-4: app_job schreibt keine Sitzungen/Tokens, app_rw keine Kataloge | ✔ | 10 verbotene Zugriffe mit 42501 abgelehnt, erlaubte Lesezugriffe ok | 1445 |
| D-04 | withTx: OCC-Konflikt über Wächterzeile wird wiederholt | ✔ | beide Transaktionen erfolgreich, 1 Wiederholung(en) nach 40001 | 979 |
| D-05 | Grenze 3.000 geänderte Zeilen je Transaktion | ✔ | 3.001 Zeilen abgelehnt (DSQL 54000), nichts übernommen | 318 |
| D-06 | Mandantenisolation (TenantRepository) und Gegenprobe | ✔ | fremder Mandant unsichtbar; fehlender Filter wird erkannt | 338 |
| D-07 | Jobs: dedupe_active, höchstens 3 offene Jobs je Mitglied, Übernahme (AP-05) | ✔ | 3 offene Jobs, 4. → auth.rate_limited; Dedupe über dedupe_active; claim/finish/fail; Vorrang in stale() | 2053 |
