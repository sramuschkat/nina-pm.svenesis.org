### AP-16a (Teil 2): NINA-Test-Server (2026-10-01)

Anforderungen: AP-16a, execution.md §9, ops/plugin-test-protocol.md (Testbetrieb tagsüber), NT-01, NT-35, NIN-17

- `pnpm nina-test-server --scenario <name> [--port 8787] [--host 0.0.0.0]` (`tools/nina-test-server`): die NINA-API `/api/nina/v1` (Bootstrap, Targets mit ETag/304, Plan, Sessions, Aufnahmen, Ereignisse, Heartbeat) mit Plänen relativ zu „jetzt“, Header `X-NPM-Test: 1`, Token `npm_test` (Szenario `lease` zusätzlich `npm_test2`). Jede Antwort wird vor dem Senden gegen die zod-Verträge aus `packages/shared` geprüft; Anfragen ebenso (`422 validation.failed`).
- 14 Szenarien unter `scenarios/` (`one-night`, `replan`, `replan-transit`, `transit`, `flip`, `delay`, `night-end`, `flats`, `multi-night`, `lease`, `mosaic-flip`, `transit-flip`, `current-night`, `safety`). Flip-Ziele kulminieren zur vorgegebenen Minute (Engine `meridianTransitUtc`, NT-35); `current-night` liefert die echte Nachttabelle Starfront und Blöcke ab astronomischer Dunkelheit; `night` in Plan/Session nur aktuelle oder folgende Nacht (sonst `422 nina.night_invalid`).
- `POST /test/actions {action}` mit allen Aktionen aus dem Protokoll (`targets_change`, `pause_project`, `lock_transit`, `skip_block`, `lease_release`, `rig_busy`, `revoke_token`, `drop_responses`/`restore_responses`, `clock_skew`, `filter_wheel_changed`, `clear`), auch als Szenario-Zeitleiste; `GET /test/report` mit Plänen, Sessions, Aufnahmen, Ereignissen, Heartbeats und Aktionen.
- 43 Tests (jedes Szenario gegen die Verträge, Anmeldung, ETag, Nacht, Session-Ablauf, Lease, alle Aktionen, HTTP).
- Protokoll: Server darf auch auf einem anderen Rechner im lokalen Netz laufen (private Adressen gelten als lokal).
- Folgt nach dem Landen von Teil 1 (#179): Integrationstest des C#-API-Clients gegen den Test-Server im CI.
