# astropm-oracle – Vergleichsorakel

Das C#-Original des Astro-PM-NINA-Plugins (MIT, Commit `5dd621d`) rechnet Grids im **Kompatibilitätsmodus**. Die TS-Engine muss dasselbe Ergebnis liefern (`specs/engine/allocation.md` §11.2, AP-13a). Ab AP-13b wird die Zuteilung verglichen, ab AP-13c/13d auch die Belichtungsfolge.

## Aufruf

```bash
pnpm oracle:run tools/astropm-oracle/grids --random 20 --seed 1 --repeat 2
```

- Positionsargumente: Grid-Dateien oder Ordner. Erlaubt sind reine Grids oder Soll-Pläne mit `input`.
- `--random n --seed s`: zusätzlich `n` Zufallsgrids mit den Seeds `s … s+n−1` (`randomGrid` der Engine, Kompatibilitätsmodus). Sie landen in `<out>/grids/`.
- `--repeat k`: `k` Läufe (`<out>/run-1 …`), die byte-genau gleich sein müssen (Determinismus).
- `--out` (Standard `tools/astropm-oracle/out/`): enthält `report.md` und je Grid `<name>.oracle.json`.
- Braucht .NET 8. Ohne `dotnet` bricht der Aufruf mit Hinweis ab; das Orakel läuft dann nur im CI (`.github/workflows/oracle.yml`, Artefakt `oracle-report`).

## Aufbau

| Datei | Inhalt |
|---|---|
| `sources.json` | Repository, Commit, SHA-256 der sechs Originaldateien |
| `src/fetch.ts` | lädt die Quellen nach `upstream/` (gitignored), prüft SHA-256, wendet `oracle.patch` an |
| `oracle.patch` | Minimal-Patch: `ExposureSetData.Id`, Masken-Hook in `IsExposureSetMoonSafe`, Tie-Break „früherer Start“ in `PaintChunks` |
| `cs/Stubs.cs` | Logger- und `HorizonProfile`-Stub, `OracleHooks.Masks` |
| `cs/GridAdapter.cs` | Grid → `TimeSlot`/`ProjectTarget`/`TargetProfile`, Aufruf `BuildMatrix` → `PaintSlots`/`PaintSlotsGreedy` → `WalkToLog`, Log → Einträge |
| `cs/Program.cs` | Konsolenprogramm: `AstroPmOracle --out <ordner> <grid>...` |
| `src/cli.ts`, `src/grids.ts` | `pnpm oracle:run`, Schema- und Querbezugsprüfung der Grids |
| `grids/` | Beispiel-Grids E01–E07 (Einzelziel, Fair Share, Mondstufen, Mosaik, Transit, manuelle Priorität, Panel-Rotation) |

`Instructions/TargetInstructionSet.cs` wird nur geladen, nicht übersetzt. Daraus stammt die Prioritätsreihenfolge (Z. 1048–1053), die der Adapter nachbaut. `AstroCalculator.cs` wird nur für Typen und Anzeigefelder übersetzt: Die Mondsicherheit kommt aus den Grid-Masken. Die Originalquellen werden nie eingecheckt.

## Adapter-Regeln (Gegenstück für die TS-Engine im Kompatibilitätsmodus)

**Zeit und Mond**
- Slot `s` beginnt bei `2000-01-01T00:00Z + s·300 s`. Die Sonne steht bei −30°, die Mondbeleuchtung ist 100 %.
- `MoonDown[s] ⇔ moonAltDeg[s] ≤ 0`.
- Zeilen-Sicherheit: ohne Profil immer; bei Mond unten immer; `mustBeDown` sonst nie; übrige Profile nach `safe`.

**Projekte und Profile**
- Projekte entstehen in Reihenfolge des ersten Auftretens: `ProjectTarget.Id` = Ordinalzahl, das ist der Schlüssel für `mosaic_grouping`. `ProjectName = TargetName = projectId`.
- Die Panels eines Projekts sind die Vereinigung der Panels seiner Einheiten, nach `index` sortiert. Panel-Einheiten (`<projectId>/p<index>`) erhalten `PanelIndex` = Position in dieser Liste.
- Profilname = `id`; bei `mustBeDown` heißt das Profil „No Moon“. Die Restriktivität ist `distanceDeg × (1 + 100/(maxIllumPct + 1))`.
- Stufen gruppieren nach Profilname in Reihenfolge des ersten Auftretens. Repräsentant einer Stufe ist die erste aktive Zeile in Panel-, dann Zeilenreihenfolge.

**Einheit fällt weg (`excluded`), in dieser Reihenfolge**
1. Längster `canImage`-Lauf · 5/60 h < `minTimeOnTargetH` → `below_min_time`.
2. Transit ohne Projektarbeit, oder das Fenster schneidet `[0, slots·300)` nicht → `no_transit_window`.
3. Panel-Einheit ohne Arbeit → `no_work`. Projekt-Einheiten bleiben auch ohne Arbeit, sie zählen für die Nachtgrenzen (A-25).

**Arbeit und Reihenfolge**
- Restarbeit je Zeile: `max(0, planned + ⌈planned · overshootPct/100⌉ − accepted) · exposureS`. Deaktivierte Zeilen haben keine Arbeit.
- Prioritätsreihenfolge: Priorität (0 = zuletzt), dann `projectId` ohne Groß-/Kleinschreibung, dann Panel-Position, dann Grid-Reihenfolge.
- `moonDownChain = [most_moon_limited] + sortChain` ohne `most_moon_limited`.
- Dither bzw. Filterwechsel gelten nur bei `enabled ∧ every > 0`. Die Toleranz ist `tolerancePct/100`.

**Ausgabe**
- `slotAssignment` ist der Stand nach Paint.
- `walkSlotAssignment` ist der Stand nach dem Walk (Blockanfang-Ersatz und Freigaben).
- `entries`:

  | Eintrag | Felder |
  |---|---|
  | `slew_center` | `unit`, `panel` |
  | `filter` | `filter` |
  | `expose` | `line`, `bonus`, `lastOfNight` = Ende nach `(LastUsableSlot+1)·300` |
  | `dither` | – |
  | `wait` | `untilS` |

  `atS` zählt in Sekunden ab Slot 0.
- Nicht unterstützt (Fehlerdatei statt Ergebnis): `mode ≠ compat`, `due_soonest` (`grid.unsupported_sort_key`), `startAtS` (`grid.replan_unsupported`).
