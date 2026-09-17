# AP-14a – NINA-API: Instanz-Token, Bootstrap, Ziele, Plan

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-13c, AP-12a, AP-11a · **Menschliche Aufgaben:** –

## Ziel
Ein gekoppeltes Plugin kann Rig, Ziele und einen Server-Nachtplan abrufen; Tokens werden in der Web-App erzeugt und widerrufen.

## Anforderungen
FA-SYN-01…03, FA-SIM-05, FA-NIN-01, TK 5.6, 7.3, 7.6

## Lesen (nur diese Abschnitte)
- TK 5.6, 6.3 (isDeliverable), 7.3, 7.5, 7.6
- contracts/nina/README.md und *.example.json
- specs/engine/night.md (Zeitmarken, Nacht-Schlüssel)
- contracts/errors.json, contracts/enums.json
- rules/api.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- zod-Schemas `packages/shared/src/contracts/nina/*.ts` (zuerst), daraus JSON-Schema und OpenAPI
- Token-API `GET/POST /web/v1/nina-instances`, `POST /web/v1/nina-instances/{id}/revoke` (Token einmalig, nur Hash gespeichert)
- Token-Auth für `/nina/v1`
- `GET /bootstrap` (inkl. Zeitzonenübergänge **mit tzdata-Version** für 60 Nächte, `readoutModes {index,name}`, `leaseMinutes`, Übernahmestatus schreiben), `GET /targets` (ETag/304, `planningNeed`, `isDeliverable` über Planungsbedarf, Discriminated Union je Projekttyp)
- `POST /plan`: **Datenladen im Use-Case** (Rig mit Scheduler-Einstellungen aus AP-09a, ausgelieferte Projekte mit Panels/Zeilen/Zählern aus AP-11a, Mondprofile, Nächte) → **`buildPlanInput(rig, projects, moonProfiles, nights, options)`** aus AP-13c → `planNight`; dazu `sessionId`, `tonight`, `night_plan`-Revision und die Zeitmarken `darknessEndUtc`/`flatsNotBeforeUtc`/`sessionEndUtc` (A5-2)

## Nicht im Umfang
- Sessions/Ingest (AP-14b), UI S-42 (AP-14c)

## Automatisierte Abnahme
- [ ] Alle Beispiele in `contracts/nina/` validieren gegen die generierten Schemas
- [ ] Token eines Rigs sieht nur eigenes Rig; widerrufenes Token → 401 `nina.token_invalid`
- [ ] `X-NPM-Engine-Version` Major-Abweichung → 409 `engine.incompatible`
- [ ] `POST /plan` mit `tonight` = Engine-Ergebnis gleicher Eingabe
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
