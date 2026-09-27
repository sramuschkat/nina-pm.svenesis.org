### Doku – Query-Parameter `rigId` statt `rig` (2026-09-27)

Entscheidung Sven 27.09.2026

- TK 7.2 nennt die Rig-Parameter der API jetzt so, wie sie in den Verträgen schon heißen: `sessions?rigId=`, `tonight?rigId=`, `forecast?rigId=`, `reports/projects?…&rigId=`, `catalog/suggestions?rigId=`, `exoplanets/transits?rigId=`. Ebenso in den Briefs AP-35 und AP-13f (`projects?rigId=`).
- Neue Regel in `docs/rules/api.md`: Query-Parameter mit IDs heißen wie das Vertragsfeld (`rigId`, `siteId`, `projectId`). Adressen der Oberfläche (`/planung/objekte?rig=`) sind ausgenommen.
- Keine Code-Änderung: Alle umgesetzten Routen verwenden bereits `rigId`.
