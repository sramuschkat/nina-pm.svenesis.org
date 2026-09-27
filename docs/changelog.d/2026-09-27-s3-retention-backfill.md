### S3 – einmalige Nachkennzeichnung der Aufbewahrung (2026-09-27)

Anforderungen: TK 12, FA-MAN-03 · Sicherheitsanalyse To-do 2 (Nachtrag zu #101) · Freigabe Sven 27.09.2026

- Neues Skript `pnpm s3:retention-backfill [--apply]` (nur Sven, Admin-Profil):
  - Es kennzeichnet im Daten-Bucket alle befristeten Objekte ohne Tag `npm-retention` nach. Das betrifft Objekte, die vor #101 geschrieben wurden: `jobs/` 2 Tage, `imports/` 7 Tage, `plans/` 400 Tage.
  - Ohne `--apply` läuft es nur als Probelauf mit Liste und Zahlen.
  - Transit-Ergebnisse (`results/`) bleiben unbefristet, ein vorhandenes Tag wird nie überschrieben.
- Danach löschen die Lebenszyklusregeln aus #101 abgelaufene Objekte beim nächsten Lauf; alte Versionen verschwinden nach weiteren 30 Tagen.
- Fristen und Tag-Werte kommen aus denselben Konstanten wie beim Schreiben (`packages/shared/src/contracts/files.ts`). Test: `tools/deploy/test/retention-backfill.test.ts`.
