### Referenz-Fixtures parallel erzeugen (2026-10-01)

- `tools/reference`: `gen_season.py` und `gen_sun_moon.py` rechnen jede Nacht in einem eigenen Prozess (`parallel_map`, so viele wie Kerne, Reihenfolge erhalten). Bisher dauerte der Job `reference` etwa 16 min, davon `gen_season` 11 min und `gen_sun_moon` 5 min; mit 4 vCPU etwa ein Viertel. Rechnung und Fixtures unverändert – der Job prüft sie wie bisher auf Byte-Gleichheit.
- `REFERENCE_WORKERS=1` rechnet seriell; Zeitlimit des Jobs 45 → 25 min.
