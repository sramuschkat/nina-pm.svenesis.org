# AP-13b – Engine: Zuteilung (`paint`) + Soll-Pläne Paint

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-13a · **Menschliche Aufgaben:** H-13

## Ziel
Die Zuteilung der Nacht auf Einheiten (Paint-Phase) ist in TypeScript portiert, im Kompatibilitätsmodus identisch zum Original und im Produktivmodus durch Soll-Pläne abgesichert. Merge erst nach Sichtprüfung der Soll-Pläne (H-13).

## Anforderungen
FA-SCH-01…16, FA-SCH-19, FK 8.2, 8.3

## Lesen (nur diese Abschnitte)
- specs/engine/allocation.md §3–7, §10 (A-6, A-9, A-10, A-13…A-17, A-19, A-20, A-27, A-28), §11
- specs/engine/sort-chain.md
- specs/engine/moon.md (Restriktivität)
- specs/engine/geometry.md §2 (Panel-Koordinaten und Panel-PA für Mosaik-Einheiten)
- specs/engine/night.md (Slotraster, Nachtgrenzen)
- contracts/golden-plans/README.md
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `buildProfiles`, `buildMatrix` (inkl. Blockfixkosten `fix`), Proportional-Passes 0–3a mit Neuberechnung nach 3a, `fairShare` mit Nachtfairness und Mosaik-Deckel (§5.2), `paintChunks`, manuelle Priorität, Nacharbeiten §7, Sortierkette – jeweils mit Kompatibilitätsschaltern
- Vergleichstest TS ↔ Orakel (Slot-Zuteilung)
- Soll-Plan-Grids und Erwartungen für alle Paint-Pflichtfälle (Produktivmodus) mit Erklärung und `oracleDiff`

## Nicht im Umfang
- Ablauf/Filterwahl (AP-13c)

## Automatisierte Abnahme
- [ ] Kompatibilitätsmodus: identische `SlotAssignment` für alle Grids + ≥ 500 Zufallsgrids
- [ ] Paint-Soll-Pläne exakt
- [ ] Panel-Koordinaten und Panel-PA gegen die Testtabelle `geometry.md` §2.3 (δ₀ = 70°, ξ = η = 6,75° → Δα = 26,98992°, γ = +25,4278°)
- [ ] Eigenschaftstests: nie zwei Einheiten je Slot, gesperrte Slots unverändert, **Σ b_i ≤ supply nach der Normierung (A-27)**, deterministisch, Neuplanung ohne Änderung ändert nichts
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Soll-Pläne (Paint) mit Erklärungen an Sven; **Merge erst nach Abnahme** (H-13)
