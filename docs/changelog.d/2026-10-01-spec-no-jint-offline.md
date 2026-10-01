### Spec-Änderung: Plugin plant nicht selbst, gespeicherter Server-Plan ohne Verbindung (2026-10-01)

Anforderungen: FA-NIN-04, FA-NIN-15, FA-NIN-18, NT-14, TK 10.4, ADR-10/16 · Entscheidung Sven 01.10.2026

- **Das NINA-Plugin plant nie selbst.** Jeder Server-Plan wird mit seiner Nacht in `ninapm.db` gespeichert. Ohne Verbindung (Offline-Modus, Lease-Zustand `unreachable`, Neustart ohne Netz) läuft der gespeicherte Plan der aktuellen Nacht weiter: Block nach Uhrzeit, zeitgeführtes Playback, keine Neuplanung, Meldungen mit seiner `nightPlanId` in die Outbox; nach der Rückkehr Nachsenden und bei Bedarf `POST /plan {reason: resume}`. Ohne gespeicherten Plan der Nacht laufen keine Blöcke (`plan_failed`).
- **Entfällt:** Offline-Planung mit Jint (`EngineHost`), Plugin-eigene `nightPlanId`, `PATCH {offline: true, offlinePlan}` als FIFO-Barriere, Offline-Betrieb über mehrere Nächte, lokal geänderte Scheduler-Einstellungen und der Simulator im Plugin ohne Verbindung. Der Server nimmt `offline`/`offlinePlan` weiter an (keine Vertragsänderung).
- Geändert: `execution.md` §2/§3/§4/§6/§8, TK (ADR-10, ADR-16, 10.3, 10.4, OT-07; in place, Zeilen unverändert für `INDEX.md`), FK FA-NIN-04/15/18, `contracts/nina/README.md`, Briefs AP-16b/e/g, Testprotokoll P-09/P-16/P-30 (Logwert `PLAN source=cache`), Nachtrag in ADR-S2a.
- Plugin: `Jint` nicht mehr in `NinaPm.Core` und nicht im ZIP (`nina-zip-check.sh` meldet es jetzt als Fehler); Bundle und Paritätstest Node ↔ Jint (AP-08c) bleiben als Test.
