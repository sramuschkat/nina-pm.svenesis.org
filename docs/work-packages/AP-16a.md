# AP-16a – Plugin: Lösung, Core, Kopplung, NINA-Test-Server

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-S2b, AP-14a · **Menschliche Aufgaben:** H-14, H-15

## Ziel
Die Plugin-Lösung mit testbarem Kern, lokalem SQLite-Speicher und Kopplung steht. Der NINA-Test-Server macht alle weiteren Plugin-Tests tagsüber möglich.

## Anforderungen
FA-NIN-01, FA-NIN-03, FA-NIN-19

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §8–9
- TK 10.1–10.2
- contracts/nina/README.md
- ops/plugin-test-protocol.md (Ablauf, `result.json`, P-04)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `NinaPm.sln`: `NinaPm.Core` (net8.0: ApiClient aus `openapi.yaml` per NSwag, Optionsmodell, `LocalStore` SQLite `ninapm.db` mit Tabellen laut execution.md §8, Logging `NINA-PM | EVENT key=value`), `NinaPm.Nina` (net8.0-windows: Plugin-Manifest, Optionsseite *Verbindung testen*); das Testprojekt `NinaPm.Core.Tests` **existiert schon aus AP-08c** und wird hier nur erweitert (CC5-16)
- `tools/nina-test-server` (Node): NINA-API mit Plänen relativ zu „jetzt“ (Blöcke ab now + 2 min, Flip-Ziel, Transitfenster), Header `X-NPM-Test: 1`, Szenario-Dateien (`one-night`, `replan`, `replan-transit`, `transit`, `flip`, `delay`, `night-end`, `flats`, `multi-night`, `lease`), `POST /test/actions` mit allen Aktionen der Tabelle in `ops/plugin-test-protocol.md` (inkl. `lease_release`, `rig_busy`, `revoke_token`, `clear`) und `GET /test/report`
- `plugin.yml` (windows-latest), Core-Tests zusätzlich auf Linux

## Nicht im Umfang
- Ausführung

## Automatisierte Abnahme
- [ ] Core-Tests grün (Linux + Windows)
- [ ] ApiClient gegen `nina-test-server` (Integrationstest)
- [ ] LocalStore-Migrationstest
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-04
