# pnpm test:dsql – Protokoll (AP-03)

| | |
|---|---|
| Beginn / Ende | 2026-10-08T07:23:00.369Z / 2026-10-08T07:35:16.669Z |
| Commit | 7c08d5e |
| Migrationsstand | 18cf14ffcc0f48d2 |
| Cluster | fzuenfbkiz6lz5tg37l3gmytvi (eu-central-1), ACTIVE nach 5399 ms |
| Aufrufer | arn:aws:iam::509219055019:user/<admin> |
| Ergebnis | **grün** |

| Nr. | Prüfung | Ergebnis | Zusammenfassung | ms |
|---|---|---|---|---|
| D-01 | Migration 0000 und Migrationen, idempotent | ✔ | 0000: 7 Änderungen, danach 0; Migrationen: 230 Anweisungen angewandt, zweiter Lauf 0; 56 Tabellen | 714427 |
| D-02 | Rechte-Matrix je DB-Rolle nach TK 6.2 | ✔ | 454 Rechte geprüft, alle wie TK 6.2 | 8861 |
| D-03 | SEC-4: app_job schreibt keine Sitzungen/Tokens, app_rw keine Kataloge | ✔ | 12 verbotene Zugriffe mit 42501 abgelehnt, erlaubte Lesezugriffe, Rig-Sperre und Antragsrang ok | 1569 |
| D-04 | withTx: OCC-Konflikt über Wächterzeile wird wiederholt | ✔ | beide Transaktionen erfolgreich, 1 Wiederholung(en) nach 40001 | 1028 |
| D-05 | Grenze 3.000 geänderte Zeilen je Transaktion | ✔ | 3.001 Zeilen abgelehnt (DSQL 54000), nichts übernommen | 408 |
| D-06 | Mandantenisolation (TenantRepository) und Gegenprobe | ✔ | fremder Mandant unsichtbar; fehlender Filter wird erkannt | 240 |
| D-07 | Jobs: dedupe_active, höchstens 3 offene Jobs je Mitglied, Übernahme (AP-05) | ✔ | 3 offene Jobs, 4. → auth.rate_limited; Dedupe über dedupe_active; claim/finish/fail; Vorrang in stale() | 2050 |
