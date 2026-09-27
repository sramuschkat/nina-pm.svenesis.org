# pnpm test:dsql – Protokoll (AP-03)

| | |
|---|---|
| Beginn / Ende | 2026-09-27T20:31:02.669Z / 2026-09-27T20:44:04.165Z |
| Commit | bb0ead3 |
| Migrationsstand | f39a0f37422363d7 |
| Cluster | jzudshon42ecms7by3b2yexyee (eu-central-1), ACTIVE nach 5455 ms |
| Aufrufer | arn:aws:iam::509219055019:user/sramuschkat-portfolio-dev |
| Ergebnis | **grün** |

| Nr. | Prüfung | Ergebnis | Zusammenfassung | ms |
|---|---|---|---|---|
| D-01 | Migration 0000 und Migrationen, idempotent | ✔ | 0000: 7 Änderungen, danach 0; Migrationen: 200 Anweisungen angewandt, zweiter Lauf 0; 52 Tabellen | 763499 |
| D-02 | Rechte-Matrix je DB-Rolle nach TK 6.2 | ✔ | 421 Rechte geprüft, alle wie TK 6.2 | 6767 |
| D-03 | SEC-4: app_job schreibt keine Sitzungen/Tokens, app_rw keine Kataloge | ✔ | 11 verbotene Zugriffe mit 42501 abgelehnt, erlaubte Lesezugriffe und Rig-Sperre ok | 1360 |
| D-04 | withTx: OCC-Konflikt über Wächterzeile wird wiederholt | ✔ | beide Transaktionen erfolgreich, 1 Wiederholung(en) nach 40001 | 967 |
| D-05 | Grenze 3.000 geänderte Zeilen je Transaktion | ✔ | 3.001 Zeilen abgelehnt (DSQL 54000), nichts übernommen | 297 |
| D-06 | Mandantenisolation (TenantRepository) und Gegenprobe | ✔ | fremder Mandant unsichtbar; fehlender Filter wird erkannt | 291 |
| D-07 | Jobs: dedupe_active, höchstens 3 offene Jobs je Mitglied, Übernahme (AP-05) | ✔ | 3 offene Jobs, 4. → auth.rate_limited; Dedupe über dedupe_active; claim/finish/fail; Vorrang in stale() | 1672 |
