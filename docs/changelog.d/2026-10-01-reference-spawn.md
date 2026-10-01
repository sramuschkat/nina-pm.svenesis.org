### Referenz-Fixtures: Unterprozesse über spawn (2026-10-01)

- Der von Hand gestartete Job `reference` auf `main` brach in `gen_sun_moon` ab (`cannot reshape array …`). Ursache: Mit `fork` teilten sich die Unterprozesse von `parallel_map` den beim Import geöffneten Dateizeiger auf `de432s.bsp`; gleichzeitiges Lesen lieferte Bytes von der falschen Stelle. In den PR-Läufen von #172 ging es zufällig gut.
- `parallel_map` startet die Prozesse jetzt über `spawn`; jeder öffnet die Ephemeride selbst.
