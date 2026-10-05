### Engine 0.16.0: Nachtende ohne Projekte

- **Fehler (gefunden mit dem kopflosen Lauf `real-all-done`):** Waren alle Projekte einer Nacht vor der Dämmerung fertig, pausiert oder nicht mehr ausgeliefert, lieferte der Plan `darknessEndUtc = null`. Das Plugin wartete dann bis zum Nachtfensterende (etwa Sonnenaufgang + 1 h), die Flats entfielen, und am Morgen begann eine Session der nächsten Nacht.
- **Fix:** Ohne Projekte im Planungsinput gilt für `darknessEndUtc` die astronomische Grenze, wie der Standard der Projekte. Spec-Ergänzung `docs/specs/engine/night.md` §3.
- Der Plugin-Teil (Nachtende über `sessionEndUtc` regulär abschließen) folgt in einem eigenen PR.
