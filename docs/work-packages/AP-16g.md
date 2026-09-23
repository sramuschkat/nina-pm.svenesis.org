# AP-16g – Plugin: Outbox, Offline-Modus, Bedienung

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-16f · **Menschliche Aufgaben:** H-15

## Ziel
Meldungen gehen auch bei Netzproblemen, Offline-Modus, Neustart oder widerrufenem Token nicht verloren und erzeugen keine Endlosschleifen; Bedienung (Zurücksetzen, Block überspringen) funktioniert.

## Anforderungen
FA-NIN-04, FA-NIN-13, FA-NIN-14, FA-SYN-08/09

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §2 (blocked-Gründe und Austrittsregeln), §6, §8
- TK 10.3 (Outbox-Regeln), 10.4
- TK 6.6 (Statuswerte)
- ops/plugin-test-protocol.md P-09, P-16, P-18, P-20, P-30, P-37
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Outbox FIFO mit Fehlerklassen (inkl. `session.rig_busy` bei Offline-Session, `401` stoppt), Dead-Letter, 14-Tage-Historie, *Erneut hochladen ab Datum*; **FIFO-Barriere (NT-14):** Meldungen eines Offline- bzw. `unreachable`-Plans erst nach quittiertem `PATCH {offline: true, offlinePlan}`; Pakete scheitern nie an der Lease
- Offline-Modus einschalten (Heartbeat `offline`; ein dadurch ersetzter laufender Block endet mit `block_end` Grund `replanned`), Cache max. 7 Tage online, widerrufenes Token → kein Cache
- *Zurücksetzen*/*Block überspringen* (inkl. rekursivem Zurücksetzen); **Neustart:** `sessionId` aus `ninapm.db`, Plan `reason: resume`, **Blockindex aus dem neuen Plan** (erster Block mit `endUtc > now`), dessen `nightPlanId` ab dann in allen Meldungen steht (NT-18); **Benutzer-Stopp:** `PATCH` mit Status `aborted`, danach Heartbeats ohne `sessionId` (NT-15); Lease-Konflikt → nur Simulation
- `blocked{clock_skew}` bei Uhrabweichung > 60 s: keine neuen Blöcke, 60-s-Takt, Austritt bei ≤ 5 s; offline keine Prüfung, Hinweis „Uhrzeit ungeprüft“ (NT-05)

## Nicht im Umfang
- –

## Automatisierte Abnahme
- [ ] Outbox-Tests je Fehlerklasse (Core)
- [ ] Outbox-Barriere: eine Meldung mit Offline-`nightPlanId` bleibt liegen, bis der `PATCH` mit `offlinePlan` quittiert ist
- [ ] Neustart-Test: `sessionId` aus `ninapm.db`, Blockindex = erster Block des neuen Plans mit `endUtc > now` (nicht der gespeicherte), neue `nightPlanId` in allen folgenden Meldungen
- [ ] Benutzer-Stopp → `PATCH` `aborted`, nächster Heartbeat ohne `sessionId`
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-09, P-16, P-18, P-20, P-30 (Online → Offline mitten in der Nacht), P-37 (Uhrabweichung > 60 s)
