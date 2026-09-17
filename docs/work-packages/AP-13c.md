# AP-13c – Engine: Ablauf (`walk`/`pick`), Blöcke, `planNight`

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-13b · **Menschliche Aufgaben:** –

## Ziel
`planNight` liefert den Nachtplan mit Belichtungsfolge, Overheads, Blöcken und Neuplanung – im Kompatibilitätsmodus identisch zum Orakel. Hier entsteht auch `buildPlanInput`, der einzige Weg von Rig und Projekten zur Planeingabe.

## Anforderungen
FA-SCH-04…16, FA-SCH-18, FK 8.3

## Lesen (nur diese Abschnitte)
- specs/engine/allocation.md §5.3, §8 (ohne Flip), §8.1, §9, §10 (A-4, A-7, A-18, A-23, A-24, A-26, A-29; A-30 entfällt)
- specs/engine/night.md
- TK 7.6 (NightPlan, Zeitmarken)
- contracts/nina/plan.request.example.json, plan.response.example.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `walk` mit Uhr inkl. Overheads, Slew nach Leerlauf, sicherer Blockanfang-Ersatz, Freigabe leerer Blockreste (A-29), Nachtende-Kulanz, **hartes Blockende ohne Überhang** (§8.1; A-30 entfällt)
- `pick` ohne Seiteneffekte (Headroom, Mond steigend/sinkend, Restbedarf, Filterwechsel-Toleranz, Zyklus je Zeile, zeitkritischer Schutz, Mosaik-Panel-Rotation); `probe` mit Blockrestzeit minus Slew (ENG-6)
- `parseBlocks` (Block-UUIDs, `end`-Eintrag, `lastOfNight`), Zeitmarken `darknessEndUtc`/`flatsNotBeforeUtc`/`sessionEndUtc`, Neuplanung mit `startAtUtc`/`tonight`
- `planNight` gesamt; zod-Schemas `PlanInput` (inkl. `mode`, `tonight`, Panel-Koordinaten) und `NightPlan` in `packages/shared` (vor der Implementierung)
- **`buildPlanInput(rig, projects, moonProfiles, nights, options)`** in `packages/shared` – eine **reine Funktion ohne Datenbankzugriff**, die aus schon geladenen Daten das `PlanInput` baut (der **einzige** Ort dieser Abbildung, CC-15/A5-2). Das Laden der Daten liegt bei den Aufrufern: AP-14a (Server, `/plan`) und AP-13f (Simulator, Browser)
- Orakel-Vergleich auf die Belichtungsfolge erweitern

## Nicht im Umfang
- Flip, Transit, Diagnose, Ablauf-Soll-Pläne (AP-13d); Aufwand (AP-13e); UI (AP-13f)

## Automatisierte Abnahme
- [ ] Kompatibilitätsmodus: identische Belichtungsfolge zum Orakel für alle Grids + ≥ 500 Zufallsgrids
- [ ] Eigenschaftstests §11.3 (Budgetsumme, Mosaik-Deckel, kein zugeteilter Slot ohne `expose`, `end` je Block)
- [ ] Neuplanungs-Fairness-Test (zwei gleiche Ziele, Neuplanung vor Block 2 → Anteile bleiben ±1 Slot)
- [ ] Sonderfälle: leere Nacht, nur Transit, alles vorgefiltert
- [ ] Determinismus (`outputHash`), ≤ 300 ms Benchmarkfall
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
