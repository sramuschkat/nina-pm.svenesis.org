# SPICE-Kerne für den Referenzgenerator (TK 9.1)

| Datei | Quelle | Abruf | SHA-256 |
|---|---|---|---|
| `de432s.bsp` | JPL Planetary and Lunar Ephemeris DE432 (gekürzt, 1950–2050), NAIF-Archiv: `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de432s.bsp` | 24.09.2026 | siehe `SHA256SUMS` |

**Lizenz/Herkunft:** Erzeugt vom Jet Propulsion Laboratory (NASA) und über das NAIF-Archiv frei verteilt; als Arbeit einer US-Bundesbehörde gemeinfrei. Keine Änderung an der Datei.

`common.py` prüft die Prüfsumme vor jedem Lauf und lädt den Kern **aus dieser Datei** (`solar_system_ephemeris.set(<pfad>)`) – kein Netzzugriff zur Laufzeit.
