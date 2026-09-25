# pnpm test:dsql – Protokoll (AP-03)

| | |
|---|---|
| Beginn / Ende | 2026-09-25T19:25:06.631Z / 2026-09-25T19:38:03.666Z |
| Commit | edbd931 |
| Migrationsstand | e38161262ad599cc |
| Cluster | cjudm653p6ct2frejsv26eyp2u (eu-central-1), ACTIVE nach 5402 ms |
| Aufrufer | arn:aws:iam::509219055019:user/sramuschkat-portfolio-dev |
| Ergebnis | **grün** |

| Nr. | Prüfung | Ergebnis | Zusammenfassung | ms |
|---|---|---|---|---|
| D-01 | Migration 0000 und Migrationen, idempotent | ✔ | 0000: 7 Änderungen, danach 0; Migrationen: 199 Anweisungen angewandt, zweiter Lauf 0; 52 Tabellen | 757522 |
| D-02 | Rechte-Matrix je DB-Rolle nach TK 6.2 | ✔ | 420 Rechte geprüft, alle wie TK 6.2 | 8042 |
| D-03 | SEC-4: app_job schreibt keine Sitzungen/Tokens, app_rw keine Kataloge | ✔ | 10 verbotene Zugriffe mit 42501 abgelehnt, erlaubte Lesezugriffe ok | 1275 |
| D-04 | withTx: OCC-Konflikt über Wächterzeile wird wiederholt | ✔ | beide Transaktionen erfolgreich, 1 Wiederholung(en) nach 40001 | 966 |
| D-05 | Grenze 3.000 geänderte Zeilen je Transaktion | ✔ | 3.001 Zeilen abgelehnt (DSQL 54000), nichts übernommen | 408 |
| D-06 | Mandantenisolation (TenantRepository) und Gegenprobe | ✔ | fremder Mandant unsichtbar; fehlender Filter wird erkannt | 221 |
| D-07 | Jobs: dedupe_active, höchstens 3 offene Jobs je Mitglied, Übernahme (AP-05) | ✔ | 3 offene Jobs, 4. → auth.rate_limited; Dedupe über dedupe_active; claim/finish/fail; Vorrang in stale() | 1985 |
