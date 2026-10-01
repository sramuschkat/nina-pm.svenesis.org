# AP-16b – Plugin Core: Planung, Neuplanung, gespeicherter Plan

**Release:** RP · **Größe:** M · **Abhängigkeiten:** AP-16a, AP-S2a, AP-13d · **Menschliche Aufgaben:** H-15

## Ziel
Der Plugin-Kern holt den Plan online, arbeitet ohne Verbindung den gespeicherten Server-Plan ab und entscheidet nachvollziehbar, wann neu geplant wird (Hysterese, Fälle a/b/c). Alles ist ohne NINA auf Linux getestet.

## Anforderungen
FA-NIN-04…12, FA-SYN-03, FA-SIM-05

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §2 (Nachtende, `currentNight`, Zeitmarken, veraltete Session, `blocked`), §3, §6 (Wechsel online → offline), §8
- specs/engine/allocation.md §5.3 (`tonight`)
- specs/engine/night.md §1, §1.1, §4 (Nacht-Tabelle, `currentNight`, Testvektoren)
- TK 10.3 Nr. 1–3, 10.4
- ADR-S2a
- ops/plugin-test-protocol.md P-29
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- PlanClient (`POST /plan`, Gründe initial/refresh/resume/reset), `ReplanPolicy` (vor jedem Block nur bei ETag/settingsVersion/Verzug > 10 min; im Block alle 15 min Fälle a/b/c; neuer Blockindex; kein Slew bei gleichem Panel)
- `tonight` aus dem lokalen Protokoll; `pendingCaptures` als Liste `[{exposureLineId, transitObservationId?, captureIds}]` aller noch nicht mit 2xx quittierten Meldungen, ohne Dead-Letter (NT-20); `422 nina.night_invalid` → Bootstrap neu laden, `currentNight` neu bestimmen, einmal wiederholen, sonst `blocked{plan_failed}`
- **`currentNight(site, now)`** in `NinaPm.Core` (`Time/NightCalendar`, NT-01) über `bootstrap.nights[]` mit **denselben Testvektoren** wie `packages/shared` (gemeinsame JSON-Datei aus AP-05); die lokale Session ist veraltet, sobald `currentNight` vom gespeicherten Nacht-Schlüssel abweicht; Tabelle nachladen, wenn weniger als 14 künftige Nächte übrig sind
- **Gespeicherter Plan statt Jint-Fallback** (geändert von Sven am 01.10.2026: das Plugin plant nie selbst, `execution.md` §8): jeder Server-Plan wird mit seiner Nacht in `ninapm.db` gespeichert; im Offline-Modus, im Lease-Zustand `unreachable` (NT-14) und nach einem Neustart ohne Verbindung wird er weiter abgearbeitet (Blockindex nach der Uhr, keine Neuplanung, Meldungen mit seiner `nightPlanId` in die Outbox); ohne gespeicherten Plan der aktuellen Nacht `blocked{plan_failed}` mit 5-min-Sperre; nach der Rückkehr bei Planbedarf `reason: resume`
- Nachtschleife als Zustandsmaschine (NT-11): Ende, sobald kein Block läuft, keine Flats ausstehen und `now ≥ (darknessEndUtc ?? sessionEndUtc)`, spätestens bei `sessionEndUtc`; ein leerer Plan nach `darknessEndUtc` ist kein `plan_failed`; Playback zeitgeführt/sequenziell als reine Logik

## Nicht im Umfang
- NINA-Adapter

## Automatisierte Abnahme
- [ ] ReplanPolicy-Tabellentests (a/b/c, Hysterese, Verzug)
- [ ] `currentNight`-Testvektoren aus `night.md` §4 identisch zur TS-Fassung
- [ ] Gespeicherter Plan: Rundreise über `ninapm.db` (Neustart), Blockindex nach der Uhr ohne Verbindung, nur für die eigene Nacht; ohne Plan der aktuellen Nacht `plan_failed`
- [ ] Zustandsmaschinen-Tests (Zeit simuliert): Nachtende-Reihenfolge Blöcke → Flats → `PATCH completed` → erst im nächsten Aufruf `false` (NT-11); leerer Plan vor `darknessEndUtc` → `idle` und Neuplanung alle 5 min, danach Nachtende statt `plan_failed`; `blocked` je Grund mit Austrittsregel (NIN5-2, `execution.md` §2)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-29 (Start zu beliebiger Tageszeit, Szenario `current-night`)
