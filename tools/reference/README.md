# Referenzwerte mit astropy (TK 9)

Python läuft **nie produktiv**. Die Skripte erzeugen Fixtures für `packages/engine/test/reference.spec.ts`.

- `gen_sun_moon.py` – Dämmerung (−6/−12/−18°), Sonnenauf-/-untergang (−0,8333°), Himmelsflats (−8/−2°), Mondauf-/-untergang (scheinbare Mitte = 0°), Mond RA/Dec/Höhe/Beleuchtung je 30 min; zwölf Nächte je Standort plus die Referenznächte Starfront 2026-09-15/-17 (WS-28) und Nächte am Rand der Polarnacht. Durchgänge über Sonnen-Transit/-Antitransit wie die Engine (night.md §2).
- `gen_targets.py` – Zielhöhen je 15 min (geometrisch und scheinbar über Saemundsson), erster oberer Meridiandurchgang; Nächte 2026, 1995 und 2045.
- `gen_season.py` – Saison je Ziel und Standort über 365 Nächte, mit Polartag/-nacht und der Mittag-bis-Mittag-Begrenzung des Nachtfensters (night.md §3).
- `gen_exo_epochs.py` – Katalog-Epochen → BJD_TDB (transit.md §1, AP-40): TAI−UTC und TDB−UTC zur Epoche, Sonnenversatz BJD − HJD (`light_travel_time` baryzentrisch minus heliozentrisch, de432s) für Epochen 1999–2030 und Ziele über die ganze Sphäre.
- Standorte (`sites.yaml`) seit der Astronomie-Prüfung 28.09.2026 auch in hohen Breiten: Tromsø 69,6° N, Longyearbyen 78,2° N, Casey 66,3° S.
- Konventionen wie die Engine: UT1 = UTC, Höhe 0 m (AST-N13), Refraktion geometrisch aus astropy plus **Saemundsson** (AST-D30), Mondbeleuchtung aus der **geozentrischen** Elongation.

## Erzeugen

Standard ist der CI-Job `reference.yml` (Artefakt `reference-fixtures`; die Fixtures werden eingecheckt, der Job prüft danach nur auf Unverändertheit). Lokal (optional, H-10):

```
cd tools/reference && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && python gen_all.py
```

**Ephemeride:** `kernels/de432s.bsp` liegt im Repository (Prüfsumme `kernels/SHA256SUMS`, Herkunft in `kernels/README.md`); der Generator prüft sie und lädt sie aus der Datei – kein Netzzugriff zur Laufzeit (TK 9.1, AST-T11).
