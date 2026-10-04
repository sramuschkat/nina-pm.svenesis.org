### AP-50b Auto-Flats je Projekt (FA-SCH-08, FA-NIN-17)

- **Rig-Einstellung** *Auto-Flats je Projekt*: aus (Flats nach jeder Nacht) · einmal je Projekt · zeitbasiert mit Intervall 1–30 Tage (Standard 7); Migration 0013 (`rig.flats_auto_mode`, `rig.flats_auto_interval_days`, beide ohne Default, `NULL` = aus bzw. 7).
- **Server → Plugin:** Bootstrap `rig.scheduler.flats.auto`; `targets` liefert je Projekt `flatsOnRecord` aus `flat_combination` der Sessions dieses Rigs; neue Flats ändern das Targets-ETag.
- **Plugin:** am Morgen entfallen Kombinationen, für die alle Projekte der Zielliste gültige Flats haben (`reason=covered`); ohne verbleibende Kombination kein Flat-Lauf. Ausgefallene Flats werden mit Auto-Flats am nächsten Morgen nachgeholt (höchstens 3 Nächte, nur mit Session); ohne Auto `skipped`.
- **Web:** Rig-Seite mit Modus und Intervall; Belichtungsplan mit Spalte *Flats* je Zeile (vorhanden / zu alt / fehlt, Tooltip mit Datum und Anzahl) über `GET /projects/{id}/flats`.
- **Gemeinsame Regel** `packages/shared/src/flats-coverage.ts` und `NinaPm.Core/Flats/FlatCoverage.cs` (Muster Astro-PM `FlatsLedger.cs`, Commit edbb301).
- **Tests:** Kern-Tests, Shared-Tests, API-Test (PGlite), Web-Test; neues Protokoll **P-38** mit kopflosem Lauf über zwei Nächte (Test-Server: vorhandene Flats aus Flat-Meldungen, Folgenacht auch mit Uhr in Nacht 2).
- **Doku:** Spec-Ergänzung `execution.md` §7, FA-SCH-08 im Fachkonzept, Schema-Dokument; Schema-Teil von `docs/concept/INDEX.md` neu ausgerichtet (war ab `session` um eine Zeile verschoben).
