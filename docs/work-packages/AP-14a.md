# AP-14a – NINA-API: Instanz-Token, Bootstrap, Ziele, Plan

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-13c, AP-12a, AP-11a · **Menschliche Aufgaben:** –

## Ziel
Ein gekoppeltes Plugin kann Rig, Ziele und einen Server-Nachtplan abrufen; Tokens werden in der Web-App erzeugt und widerrufen.

## Anforderungen
FA-SYN-01…03, FA-SIM-05, FA-NIN-01, TK 5.6, 7.3, 7.6

## Lesen (nur diese Abschnitte)
- TK 5.6, 6.3 (isDeliverable), 7.3, 7.5, 7.6
- contracts/nina/README.md und *.example.json
- specs/engine/night.md §1, §1.1, §3 (Nacht-Tabelle, `currentNight`, Zeitmarken)
- contracts/errors.json, contracts/enums.json
- rules/api.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- zod-Schemas `packages/shared/src/contracts/nina/*.ts` (zuerst), daraus JSON-Schema und OpenAPI
- Token-API `GET/POST /web/v1/nina-instances`, `POST /web/v1/nina-instances/{id}/revoke` (Token einmalig, nur Hash gespeichert)
- Token-Auth für `/nina/v1`: jede Anfrage sucht den Hash über den eindeutigen Index, **kein Cache**, kein Ablaufdatum; ein Widerruf wirkt sofort (SV-08)
- `GET /bootstrap`: Nacht-Tabelle `nights[]` ab der **Mittagsnacht** (Nacht, deren Mittag-bis-Mittag-Intervall `serverTimeUtc` enthält; 60 Nächte, je `{night, noonStartUtc, noonEndUtc, nightWindowEndUtc}`, H1) mit `tzdataVersion` und `timeZoneTransitions` (NT-02), `serverTimeUtc` als einzige Uhrquelle (NT-05), `camera.setpointC`/`toleranceC` (NT-E2), Filter mit `position` und bestätigtem `ninaFilterName` (NT-E1), `scheduler.flats.source` (NT-40), `readoutModes {index,name}`, `leaseMinutes`; Übernahmestatus schreiben
- `GET /targets` (ETag/304, `planningNeed`, `isDeliverable` über Planungsbedarf, Discriminated Union je Projekttyp, je Zeile `ninaFilterName` – `null` = nicht zugeordnet); **ETag** = Hash über Projekt-`version`s, `settingsVersion`, Korrekturen/Verwerfungen, Transit-Festlegungen und Filterzuordnungen, **ohne** Zähler aus Aufnahmemeldungen (NT-19)
- `POST /plan`: **Datenladen im Use-Case** (Rig mit Scheduler-Einstellungen aus AP-09a, ausgelieferte Projekte mit Panels/Zeilen/Zählern aus AP-11a, Mondprofile, Nächte) → **`buildPlanInput(rig, projects, moonProfiles, nights, options)`** aus AP-13c → `planNight`; dazu `sessionId`, `tonight`, `night_plan`-Revision und die Zeitmarken `darknessEndUtc`/`flatsNotBeforeUtc`/`flatsNotAfterUtc`/`sessionEndUtc` (A5-2); `night` nur `currentNight` des Standorts oder die folgende Nacht, sonst `422 nina.night_invalid` (NT-01); `afEveryMin` nur, wenn der letzte Heartbeat *Autofokus nach Zeit* meldet, sonst `0` (M7); `tonight.lastAutofocusUtc` auch bei `reason: initial` (M7); je Block `twilightEndUtc` (M4); `pendingCaptures` als Liste `[{exposureLineId, transitObservationId?, captureIds}]` – abgezogen werden nur IDs, die noch nicht in `capture` stehen (NT-20)

## Nicht im Umfang
- Sessions/Ingest (AP-14b), UI S-42 (AP-14c)

## Automatisierte Abnahme
- [ ] Alle Beispiele in `contracts/nina/` validieren gegen die generierten Schemas
- [ ] Token eines Rigs sieht nur eigenes Rig; widerrufenes Token → schon die nächste Anfrage erhält `401 nina.token_invalid`
- [ ] `X-NPM-Engine-Version` Major-Abweichung → 409 `engine.incompatible`
- [ ] `POST /plan` mit `tonight` = Engine-Ergebnis gleicher Eingabe
- [ ] `POST /plan` mit einer Nacht außerhalb {aktuelle, folgende} → `422 nina.night_invalid` (Testvektoren `night.md` §4)
- [ ] Bootstrap um `2026-09-18T14:00Z` für Starfront: `nights[0].night = 2026-09-17` (Mittagsnacht, H1) mit `nightWindowEndUtc = 2026-09-18T13:00:00Z`, `currentNight` daraus = `2026-09-18`, `serverTimeUtc` gesetzt
- [ ] `POST /plan` ohne gemeldeten Trigger *Autofokus nach Zeit* → Plan ohne `autofocus_hint` (`afEveryMin = 0`, M7)
- [ ] `targets`-ETag bleibt nach einer Aufnahmemeldung gleich und ändert sich nach einer neuen Filterzuordnung (NT-19)
- [ ] `pendingCaptures` mit bereits gespeicherten `captureIds` wird nicht doppelt abgezogen (NT-20)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
