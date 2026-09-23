# AP-14b – NINA-API: Sessions, Lease, Offline, Ingest, Heartbeat

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-14a · **Menschliche Aufgaben:** –

## Ziel
Sessions, Lease, Offline-Modus, Aufnahmen, Ereignisse und Heartbeat funktionieren idempotent und konsistent mit den Zählern.

## Anforderungen
FA-SYN-04…09, FA-RIG-06, FA-NIN-04, FA-NIN-17, TK 5.6, 6.6

## Lesen (nur diese Abschnitte)
- TK 5.6, 6.6 (Aufnahmen-Upload, Korrekturen, abweichende Einstellungen)
- TK 7.3, 7.6 (Session-Regeln, Heartbeat)
- TK 13 (`session_report`, `report_due_at`)
- specs/nina/execution.md §6 (Lease-Zustände, Heartbeat-Inhalte)
- contracts/nina/README.md
- FK 8.1 (Zeitschwellen)
- contracts/errors.json, contracts/enums.json
- rules/dsql.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- **Zugehörigkeitsprüfung je Pfadparameter (SEC-53):** jede Route mit `{sessionId}` filtert zusätzlich `session.tenant_id = token.tenant_id AND session.rig_id = token.rig_id` und antwortet sonst `404` (nicht `409`); die Idempotenz von `POST /sessions` gilt nur für `(id, rig_id)`
- **`POST /sessions/{id}/events` mit Mengengrenze** ≤ 200 Ereignisse, `message` ≤ 2 KiB, `data` ≤ 8 KiB und Tiefe ≤ 8 → sonst `413`/`422` (SEC-52)
- `POST /sessions` **idempotent** (gleiche `id` → 200) mit Lease 3 min (guard `rig_lease`); `night` nur aktuelle oder folgende Nacht (`422 nina.night_invalid`, NT-01); je Session `session_end_utc` = `sessionEndUtc` der **letzten** Planrevision speichern (NT-09); `PATCH /sessions/{id}` mit `status: running` und `resumedAtUtc` erneuert die Lease und liefert `{lease}` – nur für Sessions mit Status `running` oder `stale` (einziger Rückweg `stale → running`), eine mit `completed` oder `aborted` abgeschlossene wird nicht wieder geöffnet (`409 session.closed`; NT-11, NT-15, M6), eigene Session fortsetzen, `offline: true` ohne Lease, `offlinePlan` nachreichen (`night_plan(origin=plugin_offline)`)
- `POST /captures` (≤ 500, idempotent, Statuswerte, `nightPlanId` – `null` nur bei offline angelegter Session vor dem Nachmelden, `flatsPlanned`/`darkFlatsPlanned` aus der ersten Meldung, Lights/Flats/Dark-Flats, `flat_combination` nach **`rotator_mech_deg_dg` (Zehntelgrad-Ganzzahl)** + Auslesemodus-**Index**, Sperrreihenfolge aufsteigend nach `exposure_line_id`, `capture_night` als **eine** Zeile je Nacht mit `rejected_individual`/`rejected_correction`/`rejected_count = max(...)`, Zähler mit `exposure_line`-Wächter, Prüfung der ganzen Kette `line→panel→project→rig→tenant`, geteilte Transits über die primäre Beobachtung)
- **Ingest-Abweichungen:** `exposureMidUtc` Pflicht → `capture.exposure_mid_utc` (NT-10); `temperatureDeviation` → `capture.temperature_deviation` (NT-E2); weicht eine Light-Meldung in Filter, Belichtungszeit, Binning, Gain oder Offset von ihrer Zeile ab → speichern, zählen, `capture.settings_deviation = true` (NT-E3); `capture_night.integration_s` = Σ `capture.exposure_s` der akzeptierten Aufnahmen
- **Lease und Meldungen (NT-14):** `captures`/`events` werden in jedem Lease-Zustand angenommen und gespeichert (nach Lease-Verlust mit Warnung markiert) – auch aus dem Plugin-Zustand `unreachable`, in dem die Lease serverseitig verfallen kann; ein Lease-Fehlercode als Antwort auf Pakete existiert nicht, der Verlust kommt nur als `leaseLost` in der Heartbeat- bzw. PATCH-Antwort
- `POST /events`
- `PATCH /captures/{id}/assign` (nachträgliche Zuordnung; legt `capture_night` an, DAT5-12)
- Planprotokoll-Upload als **presigned POST** mit `content-length-range` (SEC-23)
- `POST /heartbeat` (Lease in `rig_lease` verlängern **bzw. zurückholen**, wenn `active_session_id IS NULL OR = sessionId`, die Session nicht per Admin-Freigabe ausgeschlossen ist (`rig_lease.released_session_id`) und ihr Status `running`/`stale` ist – dann `leaseLost: false` und `stale → running` (M5, M6); `leaseLost`, Offline-Modus über `rig_lease.offline_until` + `session.offline_since`, Zustand `blocked` + `blockedReason`, `commands[]` und `ackedCommandIds[]`, Antwort mit `serverTimeUtc` – NT-05)
- **NINA-Einstellungen im Heartbeat (NT-22):** `meridianFlip`, `rotator`, `plateSolve`, `mount`, `sequenceTriggers`, `camera`, `filterWheel` speichern und gegen Vorgaben und Rig-Werte prüfen → Alarm `alert.nina_settings_mismatch` mit Code-Liste (u. a. `filter_wheel_changed` – betroffene Plätze gelten als unbestätigt, die nächsten `targets` liefern dort `ninaFilterName = null` (NT-E1) –, `mount_site_mismatch`, `nina_dither_trigger_present`, `rotator_range_quarter` bei `RangeType = QUARTER` (M2), `af_time_trigger_missing`/`af_time_mismatch` für *Autofokus nach Zeit* (M7); Codes aus `enums.json` `ninaSettingsMismatchCodes`); Auslesemodi-Abgleich → Hinweise
- Sessionende legt Jobs an; `session_report` frühestens bei `max(ended_at, darknessEndUtc ?? sessionEndUtc)` der letzten Planrevision, `report_due_at` = `session_end_utc` + 2 h (NT-09)

## Nicht im Umfang
- UI

## Automatisierte Abnahme
- [ ] Isolationstest je `/nina/v1`-Route: Token von Rig A auf eine Session von Rig B → 404 (SEC-53)
- [ ] Ereignis-Paket mit 201 Einträgen → 413, mit übergroßem `data` → 422 (SEC-52)
- [ ] Doppel-Upload zählt einmal
- [ ] Späte Meldung zu `stale`/`completed` → neu ausgewertet
- [ ] Zweite Instanz → 409 session.rig_busy; eigene abgelaufene Lease → fortsetzen; `POST /sessions` zweimal mit gleicher `id` → 200
- [ ] Offline-Session ohne Lease angenommen; Offline-Modus friert Lease ein; Admin-Freigabe beendet das Einfrieren
- [ ] Fremde `projectId`/`exposureLineId` (anderer Mandant oder anderes Rig) → `rejected_invalid` (DAT-3)
- [ ] Korrektur unter der Anzahl einzeln verworfener → 409 `correction.conflict`; Zähler bleibt `max`
- [ ] `fileName` nur bei `saved` Pflicht
- [ ] Batch 501 → 413
- [ ] `POST /sessions` für eine vergangene Nacht → `422 nina.night_invalid`
- [ ] Light-Meldung mit abweichender Belichtungszeit → gespeichert und gezählt, `settings_deviation = true`, `integration_s` mit der gemeldeten `exposureS`
- [ ] Aufnahmen nach Lease-Verfall werden gespeichert und markiert, nie wegen der Lease abgelehnt
- [ ] Heartbeat mit umbenanntem Filter an einem bestätigten Platz → Platz unbestätigt, Alarmcode `filter_wheel_changed`, nächste `targets` mit `ninaFilterName = null`
- [ ] Planrevision 2 → `session.session_end_utc` aus Revision 2; `PATCH running` auf eine `completed`- oder `aborted`-Session → `409 session.closed` (nur `stale → running`, M6)
- [ ] Lease verfallen, niemand hat übernommen → nächster Heartbeat derselben Session `leaseLost: false`, Lease erneuert (M5); nach Admin-Freigabe → `leaseLost: true`
- [ ] Heartbeat mit `rotator.rangeType = QUARTER` → Alarmcode `rotator_range_quarter`; ohne *Autofokus nach Zeit* → `af_time_trigger_missing`
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
