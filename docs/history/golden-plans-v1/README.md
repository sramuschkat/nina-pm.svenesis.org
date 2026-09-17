# Soll-Pläne (Golden Plans)

Exakt prüfbare Erwartungen für `allocateNight` + `buildEntries` (Spezifikation: `specs/engine/allocation.md`, `flip-rotation.md`).

## Format
```json
{
  "id": "G01", "title": "…", "requirements": ["FA-SCH-…"], "explanation": "…",
  "approvedBy": null,
  "input": {
    "slotS": 300, "downloadS": 0, "slots": 12, "strategy": "proportional",
    "reserved": [ { "observationId": "T1", "fromSlot": 4, "toSlot": 7 } ],
    "bonus": { "enabled": true, "overshootPct": 20 },
    "filterSwitch": { "enabled": true, "every": 2, "tolerancePct": 50 },
    "meridianFlip": { "meridianAtS": 1800, "afterMin": 5, "maxAfterMin": 15, "durationS": 240 },
    "units": [ { "id": "A", "priority": 1, "minTimeSlots": 2,
      "lines": [ { "id": "A-L", "filter": "L", "exposureS": 300, "remaining": 12, "planned": 12, "bonus": 0,
                   "eligibleSlots": [[0, 11]], "order": 0, "moonSeparationDeg": 0 } ] } ]
  },
  "expected": {
    "blocks":      [ { "unit": "A", "fromSlot": 0, "toSlot": 3 }, { "unit": "T1", "fromSlot": 4, "toSlot": 7, "transit": true } ],
    "entries":     [ { "atS": 0, "cmd": "expose", "line": "A-L", "bonus": false }, { "atS": 2100, "cmd": "meridian_flip", "durationS": 240 } ],
    "diagnostics": { "B": "outranked" }
  }
}
```
- `approvedBy`: `null` bis zur menschlichen Abnahme (H-13), danach `"Name, JJJJ-MM-TT"`.
- `reserved`, `bonus`, `filterSwitch`, `meridianFlip`, `planned`, `bonus` (Zeile) sind optional; `eligibleSlots` sind inklusive Bereiche.
- `entries` (optional) enthält nur `expose` und `meridian_flip` in Sekunden ab Nachtbeginn; weitere Befehle (`filter`, `dither`, …) werden in diesen Soll-Plänen nicht verglichen. `diagnostics` (optional) listet nur Einheiten mit Grund.
- Overheads außer `downloadS` sind in den Soll-Plänen 0.

## Prüfung
- Referenz (nicht produktiv): `cd docs/specs/engine/reference && python3 allocate_reference.py ../../../contracts/golden-plans` → `11/11 Soll-Pläne bestanden`.
- Produktiv (AP-13a/b): `packages/engine/test/golden-plans.spec.ts` lädt alle Dateien und vergleicht `blocks`, `entries`, `diagnostics` exakt.
- Ein Soll-Plan wird nur mit einer Begründung im PR und neuer Abnahme (`approvedBy`) geändert. Neue Fälle: fortlaufend `G12…`.

## Übersicht
| ID | Fall |
|---|---|
| G01 | Einzelnes Ziel füllt die Nacht |
| G02 | Proportional, zwei gleiche Ziele |
| G03 | Untergehendes Ziel zuerst |
| G04 | Mindestzeit nicht erreichbar → `below_min_time` |
| G05 | Restposten unter Mindestzeit |
| G06 | Manuelle Priorität, Verdrängung → `outranked` |
| G07 | Transit-Reservierung |
| G08 | Restriktive Zeile (Mond) zuerst |
| G09 | Bonus-Durchlauf |
| G10 | Filterwechsel alle N im Rundlauf |
| G11 | Meridian-Flip im Block |
