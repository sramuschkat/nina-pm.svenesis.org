# AP-16g – Plugin: Outbox, Offline-Modus, Bedienung

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-16f · **Menschliche Aufgaben:** H-15

## Ziel
Meldungen gehen auch bei Netzproblemen, Offline-Modus, Neustart oder widerrufenem Token nicht verloren und erzeugen keine Endlosschleifen; Bedienung (Zurücksetzen, Block überspringen) funktioniert.

## Anforderungen
FA-NIN-04, FA-NIN-13, FA-NIN-14, FA-SYN-08/09

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §6, §8
- TK 10.3 (Outbox-Regeln), 10.4
- TK 6.6 (Statuswerte)
- ops/plugin-test-protocol.md P-09, P-16, P-18, P-20
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Outbox FIFO mit Fehlerklassen (inkl. `session.rig_busy` bei Offline-Session, `401` stoppt), Dead-Letter, 14-Tage-Historie, *Erneut hochladen ab Datum*
- Offline-Modus einschalten (Heartbeat `offline`), Cache max. 7 Tage online, widerrufenes Token → kein Cache
- *Zurücksetzen*/*Block überspringen* (inkl. rekursivem Zurücksetzen), Neustart im Block mit persistiertem Zustand, Lease-Konflikt → nur Simulation

## Nicht im Umfang
- –

## Automatisierte Abnahme
- [ ] Outbox-Tests je Fehlerklasse (Core)
- [ ] Neustart-Test: Zustand aus `ninapm.db` → gleicher Blockindex
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-09, P-16, P-18, P-20
