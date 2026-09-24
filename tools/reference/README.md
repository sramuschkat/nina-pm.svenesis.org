# Referenzwerte mit astropy (TK 9)

Python läuft **nie produktiv**. Die Skripte erzeugen Fixtures für `packages/engine/test/reference.spec.ts`.

- `gen_sun_moon.py` – Dämmerung (−6/−12/−18°), Sonnenauf-/-untergang (−0,8333°), Himmelsflats (−8/−2°), Mondauf-/-untergang (scheinbare Mitte = 0°), Mond RA/Dec/Höhe/Beleuchtung je 30 min; zwölf Nächte je Standort plus die Referenznächte Starfront 2026-09-15/-17 (WS-28).
- `gen_targets.py` – Zielhöhen je 15 min (geometrisch und scheinbar ab 15°), erster oberer Meridiandurchgang.
- Konventionen wie die Engine: UT1 = UTC, Höhe 0 m (AST-N13), Refraktion geometrisch aus astropy plus **Saemundsson** (AST-D30), Mondbeleuchtung aus der **geozentrischen** Elongation.

## Erzeugen

Standard ist der CI-Job `reference.yml` (Artefakt `reference-fixtures`; die Fixtures werden eingecheckt, der Job prüft danach nur auf Unverändertheit). Lokal (optional, H-10):

```
cd tools/reference && python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt && python gen_all.py
```

**Ephemeride:** `kernels/de432s.bsp` liegt im Repository (Prüfsumme `kernels/SHA256SUMS`, Herkunft in `kernels/README.md`); der Generator prüft sie und lädt sie aus der Datei – kein Netzzugriff zur Laufzeit (TK 9.1, AST-T11).
