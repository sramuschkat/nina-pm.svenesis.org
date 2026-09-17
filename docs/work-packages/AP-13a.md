# AP-13a – Engine: Vergleichsorakel, Grid-Format, CI

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-10 · **Menschliche Aufgaben:** –

## Ziel
Das C#-Original des Astro-PM-Plugins läuft als Vergleichsorakel im CI, und das Grid-Format mit Adapter ist festgelegt. Damit lässt sich der TS-Port in AP-13b/c automatisch gegen das Original prüfen.

## Anforderungen
FA-SCH (Test-Grundlage), TK 8.3 Nr. 11, TK 17

## Lesen (nur diese Abschnitte)
- specs/engine/allocation.md §1–2, §11.1–11.2
- contracts/golden-plans/README.md (Grid-Format)
- history/Analyse_AstroPM_NINA_Plugin_2026-09-17.md §3
- TK 18 (oracle.yml)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `tools/astropm-oracle`: .NET-8-Konsolen-App; Originalquellen `ScheduleEngine.cs`/`SessionScheduler.cs` am gepinnten Commit `5dd621d` per Skript laden (nicht verändert einchecken) + Patch (Logger-Stub, `HorizonProfile`-Stub, Masken-Hook in `IsExposureSetMoonSafe`, stabiler Tie-Break in `PaintChunks`)
- Grid-JSON-Schema und Adapter Grid → `TargetProfile`/`TimeSlot` sowie Log → Einträge nach §11.2 (`packages/engine/src/plan/grid.ts`, C#-Seite im Orakel)
- Zufallsgrid-Generator (Seed-basiert), CLI `pnpm oracle:run <grid>`
- Workflow `oracle.yml` (ubuntu, .NET 8 + Node), Abweichungsbericht als Artefakt
- Schalterliste Kompatibilitätsmodus als Typ `CompatSwitches` (§11.1), noch ohne Engine-Logik

## Nicht im Umfang
- Zuteilung in TS (AP-13b); keine Änderung am Originalcode außer Patch

## Automatisierte Abnahme
- [ ] Orakel liefert für 20 Zufallsgrids zweimal identische Ausgabe (deterministisch)
- [ ] Grid-Schema validiert alle Beispiel-Grids
- [ ] `oracle.yml` grün
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
