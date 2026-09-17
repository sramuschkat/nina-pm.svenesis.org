# AP-13d – Engine: Flip, Transit, Diagnose + Soll-Pläne Ablauf

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-13c · **Menschliche Aufgaben:** H-13

## Ziel
Flip, Transit und Diagnose vervollständigen den Plan, und die Ablauf-Soll-Pläne machen ihn dauerhaft prüfbar. Merge erst nach Sichtprüfung der Soll-Pläne (H-13).

## Anforderungen
FA-SCH-17, FA-RIG-10/11, FA-SIM-03, FA-EXO-22…24, FK 8.8

## Lesen (nur diese Abschnitte)
- specs/engine/flip-rotation.md (inkl. §1.1 `tM`)
- specs/engine/transit.md §3
- specs/engine/geometry.md §2 (Panel-PA)
- specs/engine/allocation.md §7.1, §8.2, §10 (A-5, A-12, A-19, A-21), §12
- contracts/golden-plans/README.md
- contracts/enums.json (diagnosticReasons, simulatorWarnings)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Meridiandurchgang `tM` je Panel (scheinbare RA, GAST, siderische Rate), Flip-Planung vor der Filterwahl, Block-Metadaten `meridianFlip` inkl. `inTransitWindow`
- Transit-Reservierung (`preClaimTransits` nach `locked_at`, Konfliktregel), `expose_series` bis Fensterende
- Warnungen (§12) und **ein** Diagnose-Kanal `diagnostics[]` (auch je Zeile für das Aufwand-Kennzeichen)
- Ablauf-Soll-Pläne (`contracts/golden-plans/`) mit Erklärung und `oracleDiff`, inkl. Flip-, Transit- und Panel-Fällen

## Nicht im Umfang
- Aufwand (AP-13e), UI (AP-13f)

## Automatisierte Abnahme
- [ ] alle abgenommenen Soll-Pläne exakt
- [ ] Rotations-Grenzwerttabelle und Flip-Fälle (im Block / außerhalb / passt nicht / aus / Pause vor Meridian / im Transit)
- [ ] `tM`-Referenztest ±30 s
- [ ] Panel-PA-Tests aus `geometry.md`
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Soll-Pläne (Ablauf) abnehmen; **Merge erst nach Abnahme** (H-13)
