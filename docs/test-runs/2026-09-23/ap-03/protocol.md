# pnpm test:dsql – Protokoll (AP-03)

| | |
|---|---|
| Beginn / Ende | 2026-09-23T20:00:45.329Z / 2026-09-23T20:13:35.947Z |
| Commit | fb9f777 |
| Migrationsstand | 7c0962bb0335f4c3 |
| Cluster | mvudh4d2g5sfd55faphfqljmsm (eu-central-1), ACTIVE nach 5506 ms |
| Aufrufer | arn:aws:iam::509219055019:user/sramuschkat-portfolio-dev |
| Ergebnis | **grün** |

| Nr. | Prüfung | Ergebnis | Zusammenfassung | ms |
|---|---|---|---|---|
| D-01 | Migration 0000 und Migrationen, idempotent | ✔ | 0000: 7 Änderungen, danach 0; Migrationen: 194 Anweisungen angewandt, zweiter Lauf 0; 51 Tabellen | 753575 |
| D-02 | Rechte-Matrix je DB-Rolle nach TK 6.2 | ✔ | 412 Rechte geprüft, alle wie TK 6.2 | 7588 |
| D-03 | SEC-4: app_job schreibt keine Sitzungen/Tokens, app_rw keine Kataloge | ✔ | 10 verbotene Zugriffe mit 42501 abgelehnt, erlaubte Lesezugriffe ok | 1230 |
| D-04 | withTx: OCC-Konflikt über Wächterzeile wird wiederholt | ✔ | beide Transaktionen erfolgreich, 1 Wiederholung(en) nach 40001 | 798 |
| D-05 | Grenze 3.000 geänderte Zeilen je Transaktion | ✔ | 3.001 Zeilen abgelehnt (DSQL 54000), nichts übernommen | 318 |
| D-06 | Mandantenisolation (TenantRepository) und Gegenprobe | ✔ | fremder Mandant unsichtbar; fehlender Filter wird erkannt | 250 |
