# Erste Rig-Nacht Starfront – 05./06.10.2026

Beaufsichtigter Minimaltest am echten Rig („SFRO-Rig“, Instanz „SFRO-Mini-PC“, neuer Produktions-Mandant). Gelaufen sind Plugin **0.4.7** und Svens Starfront-Sequenz, zuerst v1.0 mit Änderungen, ab dem Neustart um 03:47 CDT v1.1.

Das NINA-Log liegt nicht im Repository: Seine Pfade enthalten den Windows-Benutzernamen des Rig-PCs. Ausgewertet wurde es aus `.vm-bench/starfront/`.

## Ergebnis `pnpm rig-night:check`

**GO** (alle Muss-Prüfungen grün):

- 20 Pläne vom Server; Session `completed`; Outbox am Ende leer (`pending=0`, `dead=0`)
- keine NINA-PM-ERROR-Zeile, keine Sperre, keine abgelehnte Anfrage
- 9 Lights gespeichert, keine abgebrochen: LUMINOS 4, RED 2 (M 31, 60 s), HA 1, OIII 1, SII 1 (NGC 7380, 600 s)
- 5 Flat-Kombinationen `done` (je 25 Flats) und eine Dark-Flat-Gruppe (25 × 3 s)
- erste Flat um 06:42:30 CDT, nach der nautischen Dämmerung um 06:42:07

Hinweise:
- **5 Blöcke ohne Aufnahme trotz `completed`** (05:37–05:57 CDT), dazu ein Block `user_skip` beim ersten Start
- `WAIT_PLAN` 4×, zusammen 11 min; `sequence_template_deviation` 1×

## Ablauf (CDT)

| Zeit | Ereignis |
|---|---|
| 02:42 | Sequenzstart (v1.0). Der Autofokus scheitert, weil das Panel noch geschlossen ist („Too many failed points“). |
| 03:35 | Abbruch durch Sven (`user_skip`, Session `aborted`) |
| 03:47 | Neustart mit v1.1 (*Set Tracking* und *Open Cover* vor dem Autofokus); Autofokus 04:00–04:02 erfolgreich |
| 04:03–04:13 | M 31: 4 × L, 2 × R |
| 04:39–05:01 | NGC 7380: Ha, OIII. SII war wegen Mindesthöhe 30° ausgeschlossen; Sven senkte sie auf 20°. |
| 05:16 | Neuplanung nach Ablauf der 5-min-Sperre; Block SII mit `WAIT_PLAN` 250 s, NINA-Autofokus 05:21–05:26 (SII, 294 s) |
| 05:26–05:36 | SII #1 |
| 05:37–05:57 | **Schleife:** alle 5 min Slew, 2 × Plate-Solve, Winkel-Solve, Guiding-Start (≈ 52 s), `BLOCK_START`, nach 10 s `BLOCK_END completed` ohne Belichtung |
| 06:13 | Nachtende → `FLATS_START`; „Vor Flats“: Stop Guiding, Find Home, Discord, *Wait for Time* bis 06:42 |
| 06:42–06:51 | Flats L, R, Ha, OIII, SII; Dark-Flats einmal (3 s) |
| 06:51 | Session `completed` mit `pending=10`, nachgemeldet um 06:52 (`pending=0`) |
| 06:51–07:06 | Ende-Bereich: Warm Camera (12 min einschließlich Nachlauf), Schalter aus, Cover zu, Find Home, Disconnect |

## Befunde und Folgen

| Befund | Ursache | Folge |
|---|---|---|
| Schleife mit leeren Blöcken | Block mit genau einer Belichtung endet mit deren Ende; Plugin rechnete fest mit 3 s Download (Rig 1 s); Plan 35 s Slew/Zentrieren, real 52 s; Montierung steht ohne Sync ≈ 22′ neben der Zielkoordinate, deshalb nie „Slew entfällt“ | Plugin 0.4.8 (#280): Download aus dem Rig, weiches Blockende, sofort neu planen nach leerem Block, Slew-Entfall nach Zentrierposition. Overheads 90/10/18/5 s, Autofokus 180 s |
| SII erst nach 05:16 | Mindesthöhe 30°, Neuplanung erst nach der 5-min-Sperre | Einstellung; Sperre unverändert |
| `ROTATION_MISMATCH` vor jedem Block | Projektwinkel ≠ gemessene 136° (kein Rotator) | Projektwinkel auf 136° setzen (`rig-first-night.md`) |
| Dark-Flats nur im Ordner von M 31 | eine Gruppe je Nacht | Plugin 0.4.9 (#282): Kopie in die Ordner aller Ziele der Gruppe |
| „Aufnahmen ohne Lease“ um 06:52 | Lease mit dem Abschluss freigegeben, Outbox danach nachgemeldet | Server-Fix #283 |
| Flats/Guiding | Plugin wartete und stoppte Guiding selbst | ab 0.4.8 nur noch über die Box „Vor Flats“ (Entscheidung Sven) |
| `sequence_template_deviation` um 04:03 (`start_autofocus_missing`, `end_secure_missing`, `end_warm_missing`) | Offline-Prüfung der Sequenzdatei v1.1: keine Abweichung | in der nächsten Nacht beobachten |
