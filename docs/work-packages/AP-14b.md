# AP-14b – NINA-API: Sessions, Lease, Offline, Ingest, Heartbeat

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-14a · **Menschliche Aufgaben:** –

## Ziel
Sessions, Lease, Offline-Modus, Aufnahmen, Ereignisse und Heartbeat funktionieren idempotent und konsistent mit den Zählern.

## Anforderungen
FA-SYN-04…09, FA-RIG-06, FA-NIN-04, FA-NIN-17, TK 5.6, 6.6

## Lesen (nur diese Abschnitte)
- TK 5.6, 6.6 (Aufnahmen-Upload, Korrekturen)
- TK 7.3, 7.6
- FK 8.1 (Zeitschwellen)
- contracts/errors.json, contracts/enums.json
- rules/dsql.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `POST /sessions` **idempotent** (gleiche `id` → 200) mit Lease 3 min (guard `rig_lease`), `PATCH /sessions/{id}` mit `status: running` erneuert die Lease und liefert `{lease}`, eigene Session fortsetzen, `offline: true` ohne Lease, `offlinePlan` nachreichen (`night_plan(origin=plugin_offline)`)
- `POST /captures` (≤ 500, idempotent, Statuswerte, `nightPlanId` – `null` nur bei offline angelegter Session vor dem Nachmelden, `flatsPlanned`/`darkFlatsPlanned` aus der ersten Meldung, Lights/Flats/Dark-Flats, `flat_combination` nach **`rotator_mech_deg_dg` (Zehntelgrad-Ganzzahl)** + Auslesemodus-**Index**, Sperrreihenfolge aufsteigend nach `exposure_line_id`, `capture_night` als **eine** Zeile je Nacht mit `rejected_individual`/`rejected_correction`/`rejected_count = max(...)`, Zähler mit `exposure_line`-Wächter, Prüfung der ganzen Kette `line→panel→project→rig→tenant`, geteilte Transits über die primäre Beobachtung)
- `POST /events`
- `PATCH /captures/{id}/assign` (nachträgliche Zuordnung; legt `capture_night` an, DAT5-12)
- Planprotokoll-Upload als **presigned POST** mit `content-length-range` (SEC-23)
- `POST /heartbeat` (Lease in `rig_lease` verlängern, `leaseLost`, Offline-Modus über `rig_lease.offline_until` + `session.offline_since`, Zustand `blocked` + `blockedReason`, `commands[]` und `ackedCommandIds[]`, Abgleich Flip-Einstellungen/Filterrad/Auslesemodi → Hinweise)
- Sessionende legt Jobs an

## Nicht im Umfang
- UI

## Automatisierte Abnahme
- [ ] Doppel-Upload zählt einmal
- [ ] Späte Meldung zu `stale`/`completed` → neu ausgewertet
- [ ] Zweite Instanz → 409 session.rig_busy; eigene abgelaufene Lease → fortsetzen; `POST /sessions` zweimal mit gleicher `id` → 200
- [ ] Offline-Session ohne Lease angenommen; Offline-Modus friert Lease ein; Admin-Freigabe beendet das Einfrieren
- [ ] Fremde `projectId`/`exposureLineId` (anderer Mandant oder anderes Rig) → `rejected_invalid` (DAT-3)
- [ ] Korrektur unter der Anzahl einzeln verworfener → 409 `correction.conflict`; Zähler bleibt `max`
- [ ] `fileName` nur bei `saved` Pflicht
- [ ] Batch 501 → 413
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
