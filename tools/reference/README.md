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

**Ephemeride:** `de432s` lädt astropy beim ersten Lauf (≈ 10 MB) aus dem JPL-Archiv nach. TK 9.1 sieht vor, den Kernel mit Prüfsumme unter `kernels/` einzuchecken; bis dahin lädt ihn der CI-Job.
