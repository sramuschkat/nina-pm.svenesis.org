# Soll-Pläne (Golden Plans)

Exakt prüfbare Erwartungen für `planNight` nach `specs/engine/allocation.md`. **Status:** Paint-Fälle entstehen in **AP-13b**, Ablauf-Fälle in **AP-13d** (die bisherigen G01–G11 sind überholt, siehe `docs/history/golden-plans-v1/`).

## Vorgehen
1. **AP-13a:** `tools/astropm-oracle` bauen (allocation.md §11.2): C#-Quellen des Astro-PM-Plugins (MIT, Commit `5dd621d`) mit Minimal-Patch in einer .NET-8-Konsolen-App; CI-Job `oracle.yml` auf `ubuntu-latest`; Grid-Format (unten) und Adapter festlegen.
2. **AP-13b (Paint):** TS-Zuteilung im **Kompatibilitätsmodus** (Schalterliste allocation.md §11.1) gegen das Orakel prüfen (alle Grids + ≥ 500 Zufallsgrids, identische `SlotAssignment`); danach Paint-Soll-Pläne im **Produktivmodus** (Abweichungen A-1…A-31) mit `expected.slotAssignment`, Erklärung und `oracleDiff`.
3. **AP-13c (Ablauf, Teil 1):** `walk`/`pick`/`planNight`; Vergleich auf die Belichtungsfolge erweitern. **AP-13d (Teil 2):** Flip, Transit, Diagnose und die Ablauf-Soll-Pläne mit `expected.entries`, `warnings`, `diagnostics`.
4. Sven nimmt jeden Soll-Plan ab (`approvedBy`, H-13). **Merge-Bedingung** des jeweiligen PR, keine Startsperre für Folgepakete; bis zur Abnahme gelten nicht abgenommene Pläne als „vorläufig“ (Test läuft, blockiert aber nicht).

## Format
```json
{
  "id": "G01", "title": "…", "requirements": ["FA-SCH-…"], "explanation": "…",
  "approvedBy": null, "oracleDiff": null,
  "input": {
    "mode": "productive",
    "slotS": 300, "slots": 24, "startAtS": null, "moonAltDeg": [ … je Slot … ],
    "settings": { "strategy": "proportional|manual_priority",
                  "sortChain": ["lowest_peak_altitude","setting_soonest","most_remaining","constrained"],
                  "bonusEnabled": false, "overshootPct": 0, "mosaicPanelsIndependent": true,
                  "dither": { "enabled": false, "every": 3 }, "filterSwitch": { "enabled": false, "every": 10, "tolerancePct": 50 },
                  "overhead": { "slewCenterS": 0, "filterChangeS": 0, "ditherSettleS": 0, "afEveryMin": 0, "afDurationS": 0, "downloadS": 0 },
                  "flip": { "enabled": false, "afterMin": 5, "maxAfterMin": 15, "pauseBeforeMin": 0, "durationS": 240 } },
    "moonProfiles": [ { "id": "strict", "distanceDeg": 90, "maxIllumPct": 30, "mustBeDown": false } ],
    "units": [ { "unitId": "A", "projectId": "A", "priority": 1, "minTimeOnTargetH": 1.0, "dueDate": null,
                 "peakAltDeg": 60, "canImage": [[0, 23]], "meridianAtS": null,
                 "transit": null,
                 "panels": [ { "index": 0, "peakAltDeg": 60, "canImage": [[0, 23]], "meridianAtS": null,
                   "lines": [ { "id": "A-Ha", "filter": "Ha", "exposureS": 300, "planned": 12, "accepted": 0,
                     "enabled": true, "moonProfile": "strict", "safe": [[0, 23]] } ] } ] } ],
    "tonight": null
  },
  "expected": {
    "slotAssignment": [ "A", "A", null, … ],
    "entries": [ { "atS": 0, "cmd": "slew_center" }, { "atS": 0, "cmd": "filter", "filter": "Ha" },
                 { "atS": 0, "cmd": "expose", "line": "A-Ha", "bonus": false, "lastOfNight": false },
                 { "atS": 3600, "cmd": "end" } ],
    "warnings": [ { "code": "idle_gap", "atS": 3600 } ],
    "diagnostics": [ { "unitId": "B", "reason": "outranked" }, { "unitId": "A", "lineId": "A-Ha", "reason": "moon_blocked" } ]
  }
}
```
- **Einheiten-ID (`unitId`)**: `"<projectId>"` bei Einzelfeldern, `"<projectId>/p<index>"` bei Panel-Einheiten (gleiche Schreibweise wie `tonight.pastBlocks[].unitId` in TK 7.6; im `NightPlan` entspricht das `projectId` + optional `panelId`). `slotAssignment` und `diagnostics` nutzen `unitId`; `diagnostics` ist eine **Liste** aus `{unitId, lineId?, reason, message?}` (mehrere Gründe je Einheit und zeilenweise Gründe für das Aufwand-Kennzeichen, §12).
- Bereiche `[von, bis]` inklusive (Slots). `safe` = Mond-oben-Sicherheit der Zeile (Mond-unten ist immer sicher); bei `mustBeDown` wird `safe` ignoriert.
- **Panel-Felder** (`panels[].peakAltDeg`, `canImage`, `meridianAtS`) gelten produktiv je Panel (A-19); fehlen sie, gilt der Wert der Einheit. Im Kompatibilitätsmodus wird immer der Einheitenwert benutzt.
- **Transit** je Einheit: `{"windowS": [von, bis], "lineId": "A-R", "lockedAtS": 0}` (Sekunden ab Slot 0; `lockedAtS` entscheidet bei Überlappung, A-20).
- **Neuplanung:** `startAtS` (Sekunden ab Slot 0) plus `tonight` in Sekunden: `{"pastBlocks": [{"unitId": "A", "fromS": 0, "toS": 3600}], "exposedSecByUnit": {"A": 3300}, "lastAutofocusS": 600, "filterCycle": [{"unitId": "A", "lineId": "A-Ha", "subsOnLine": 9}], "flipDoneByPanel": {}, "currentUnitId": "A"}`.
- `mode` ist das **einzige** Modusfeld (`productive` | `compat`, allocation.md §11.1).
- **Schema:** `grid.schema.json` (JSON Schema 2020-12, erzeugt aus `packages/shared/src/contracts/grid.ts` mit `pnpm contracts:generate`). Querbezüge (Einheiten-/Zeilen-IDs, Profile, Bereiche, Panel-Einheiten, `due_soonest` im Kompatibilitätsmodus) prüft `checkGrid` in `packages/engine/src/plan/grid.ts`.
- **Orakel-Ausgabe** und Adapter-Regeln: `tools/astropm-oracle/README.md` (AP-13a).
- Das Grid enthält keine Astronomie; der Adapter `grid → Matrix` ist Teil des Tests.

## Pflichtfälle (Mindestumfang)
**Paint (AP-13b):** Einzelziel · zwei gleiche Ziele (Fair Share) · früh untergehendes Ziel (Pass 3a, `accessible` nach 3a neu) · Knapp-Fall · Restposten (MinChunk verkleinert, Blockfixkosten A-16) · manuelle Priorität · Transit-Sperre · Nur-mondlos-Arbeit (Pass 1a) · exklusiv vs. flexibel (Pass 1b) · Mindestzeit verlängern/leihen/freigeben · Splitter · Defragmentierung · Bonus und absorb · Mosaik als Panel-Einheiten mit Deckel je Projekt (A-15) · Neuplanung mit `tonight` (Nachtfairness A-10).

**Ablauf (AP-13c/13d):** Filterwahl bei steigendem/sinkendem Mond · Filterwechsel mit Toleranz (Zyklus je Zeile, A-22) · zeitkritischer Schutz · Mosaik mit Panel-Rotation · Blockanfang ohne Arbeit (abgeben nur bei CanImage in allen Slots / freigeben, A-17) · Slew nach Leerlauf (A-18) · Nachtende-Kulanz · Meridian-Flip (vor der Filterwahl) · Overheads (A-4) · Belichtung passt nicht bis Blockende (A-7) · Transitreihe bis Fensterende (A-21) · Flip im Transitfenster (Diagnose `flip_in_transit`).

**Kompatibilitätsmodus:** Dieselben Grids laufen zusätzlich mit `mode: "compat"` gegen das Orakel; Erwartung dort ist die Orakel-Ausgabe, nicht der Soll-Plan.
