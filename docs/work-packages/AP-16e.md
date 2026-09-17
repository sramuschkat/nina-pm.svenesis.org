# AP-16e – Plugin: Aufnahme-Zuordnung, Heartbeat, Lease

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-16d · **Menschliche Aufgaben:** H-15

## Ziel
Jede gespeicherte Belichtung wird genau einmal korrekt gemeldet, der Heartbeat läuft unabhängig von der Sequenz, und die Lease-Zustandsmaschine mit allen Übergängen verhindert Doppelbetrieb.

## Anforderungen
FA-SYN-04…07, FA-RIG-06, FA-NIN-14

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §4.3, §6
- TK 5.6, 7.6 (Captures, Heartbeat)
- ops/plugin-test-protocol.md P-10, P-17, P-22
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `CaptureReporter`: captureId vor der Belichtung, `Image.Id` → captureId vor `Enqueue`, `ImageSaved` → `saved`, 120-s-Timeout → `failed`, Abbruch → `aborted`; Meldungsfelder (`nightPlanId`, `blockId`, `pierSide`, `rotatorMechDeg`, `raDeg/decDeg`, `metrics`)
- `HeartbeatService` (Hintergrund-Timer 60 s), `LeaseStateMachine` (none → acquiring → held → lost → reacquiring), `leaseLost` → keine neuen Blöcke
- Outbox-Grundfunktion (Senden in Reihenfolge)

## Nicht im Umfang
- Offline-Modus und Fehlerklassen (AP-16g)

## Automatisierte Abnahme
- [ ] Zuordnungstests inkl. schneller Folgen und Timeout (Core)
- [ ] LeaseStateMachine-Tabellentests
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-10, P-17, P-22
