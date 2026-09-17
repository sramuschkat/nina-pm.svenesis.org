# AP-09a – Ausrüstung: API

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-05, AP-04b · **Menschliche Aufgaben:** –

## Ziel
Standorte, Teleskope, Kameras, Filter, Vorlagen, Mondprofile und Rigs samt Scheduler-Einstellungen sind per API verwaltbar, mit Löschsperren und Berechnungen.

## Anforderungen
FA-STO, FA-TEL, FA-KAM, FA-FIL, FA-BPL, FA-MON, FA-RIG-01…09

## Lesen (nur diese Abschnitte)
- specs/engine/geometry.md §1 (Abbildungsmaßstab, Bildfeld)
- FK 6.1, 6.2
- TK 7.2 (Ausrüstung)
- schema_aurora_dsql.sql (site … rig)
- contracts/enums.json
- contracts/errors.json
- specs/engine/sort-chain.md, flip-rotation.md (Rig-Felder)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- CRUD Standorte, Standort-Links, Teleskope, Kameras (Gain-/Auslesemodi), Filter, Belichtungsvorlagen, Mondprofile (Built-ins schreibgeschützt), Rigs inkl. Scheduler-Settings (`PUT /rigs/{id}/scheduler-settings`, `settings_version`), Anzeige-/Auslieferungsschalter
- Berechnete Werte (Abbildungsmaßstab, Bildfeld) in `packages/shared`
- Löschsperren `409 resource.in_use` mit Liste
- Validierung Sortierkette/Flip

## Nicht im Umfang
- UI (AP-09b, AP-09c)

## Automatisierte Abnahme
- [ ] CRUD + Rechte-Tests (Admin schreibt, User liest)
- [ ] Maßstab/Bildfeld gegen Handrechnung
- [ ] Löschen in Verwendung → 409 mit Verwendern
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
