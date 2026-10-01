# AP-16e – Plugin: Aufnahme-Zuordnung, Heartbeat, Lease

**Release:** RP · **Größe:** M · **Abhängigkeiten:** AP-16d · **Menschliche Aufgaben:** H-15

## Ziel
Jede gespeicherte Belichtung wird genau einmal korrekt gemeldet, der Heartbeat läuft unabhängig von der Sequenz, und die Lease-Zustandsmaschine mit allen Übergängen verhindert Doppelbetrieb.

## Anforderungen
FA-SYN-04…07, FA-RIG-06, FA-NIN-14

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §4.1 Nr. 3 (Kühlung), §4.3, §6
- TK 5.6, 7.6 (Captures, Heartbeat)
- contracts/nina/README.md (`heartbeat.request`, `captures`)
- ops/plugin-test-protocol.md P-10, P-17, P-22, P-34
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `CaptureReporter`: captureId vor der Belichtung, `Image.Id` → captureId vor `Enqueue`, `ImageSaved` → `saved`, 120-s-Timeout → `failed`, Abbruch → `aborted`; Meldungsfelder (`nightPlanId` des ausgeführten Plans, `blockId`, `capturedAtUtc` = `ExposureStart`, Pflichtfeld `exposureMidUtc` = `ExposureMidPoint` (NT-10), `pierSide` nach fester ASCOM-Zuordnung `west`/`east`/`null` (NT-34), `rotatorMechDeg`, `raDeg/decDeg` = Soll-Koordinaten des Panels (NT-36), `temperatureDeviation`, `metrics` mit `sensorTempC`/`setPointC`, wenn die Kamera sie liefert)
- **Kühlung nur warnen (NT-E2):** vor Blockstart und vor jeder Belichtung `CoolerOn` und `|Temperatur − Soll| ≤ camera.toleranceC` prüfen (nur bei gesetztem `camera.setpointC`); bei Abweichung weiter belichten, `warning` `camera_temperature` höchstens einmal je Block, Aufnahme mit `temperatureDeviation: true`
- `HeartbeatService` (Hintergrund-Timer 60 s; Zustände nach NT-17: `idle` beim Warten und leerem Plan, `paused` bei Safety; NINA-Einstellungen des aktiven Profils `meridianFlip`, `rotator`, `plateSolve`, `mount`, `sequenceTriggers`, `camera`, `filterWheel` nach NT-22; Uhrabgleich über `serverTimeUtc` der Antwort, NT-05)
- `LeaseStateMachine` mit allen Übergängen aus `execution.md` §6: none → acquiring → held ⇄ **`unreachable`** (3 Heartbeats ohne Serverantwort; Blöcke laufen nach dem gespeicherten Plan weiter, AP-16b); held → lost → reacquiring bzw. **lost → held**, wenn eine Heartbeat-Antwort `leaseLost: false` meldet (Server hat die Lease zurückgegeben, M5); `lost` nur auf Serverantwort `leaseLost: true` bzw. `409 session.rig_busy` (NT-14); `leaseLost` → keine neuen Blöcke
- Outbox-Grundfunktion (Senden in Reihenfolge)

## Nicht im Umfang
- Offline-Modus und Fehlerklassen (AP-16g)

## Automatisierte Abnahme
- [ ] Zuordnungstests inkl. schneller Folgen und Timeout (Core)
- [ ] LeaseStateMachine-Tabellentests inkl. `held → unreachable → held` ohne `lost` und `lost → held` bei `leaseLost: false` (M5)
- [ ] Kühlungs-Test: Abweichung → genau eine Warnung je Block, alle betroffenen Aufnahmen mit `temperatureDeviation: true`
- [ ] Meldung trägt `exposureMidUtc` aus `ExposureMidPoint` und `capturedAtUtc` aus `ExposureStart`
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-10, P-17, P-22, P-34 (Temperaturabweichung)
