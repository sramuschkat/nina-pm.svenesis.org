# AP-11a – Projekte: API

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-09a · **Menschliche Aufgaben:** –

## Ziel
Projekte mit Panels und Belichtungszeilen sind per API vollständig verwaltbar, inklusive Zählern, Planungsbedarf, Statusübergängen und Soft-Delete.

## Anforderungen
FA-PRJ-01…22 (ohne Mosaik-Panels im Scheduler), FA-BER

## Lesen (nur diese Abschnitte)
- FK 6.4, 8.4
- contracts/enums.json (projectStatusTransitions)
- contracts/errors.json
- TK 6.3, 6.4, 6.6 (Löschen), 7.2 (Projekte, Projektstatus, Verlauf, Notizen)
- schema_aurora_dsql.sql (project … exposure_line, approval_event, change_log)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- CRUD Projekte/Panels/Zeilen, Vorlage anwenden, duplizieren, Status nach `projectStatusTransitions` (inkl. automatische Rückkehr nach *Aktiv*, Vollständigkeitsprüfung beim Aktivieren), Priorität je Rig, Favoriten, Notizen, Soft-Delete, Verlauf, Rig-Wechsel-Prüfung (FA-RIG-12)
- Zähler-Ableitungen (8.4) inkl. Planungsbedarf (**ganzzahlig**: `planned + ceil(planned·pct/100)`), „Soll erreicht“/„fertig“ in `packages/shared`
- Entwurf ohne Koordinaten, Einreichen prüft Pflichtfelder (`approval.incomplete`)
- `project.effort_stale` bei Änderungen setzen (Job folgt in AP-13e)

## Nicht im Umfang
- Freigabe (AP-12a)

## Automatisierte Abnahme
- [ ] Rechte: User bearbeitet nur eigene Entwürfe/zurückgegebene
- [ ] Zähler-Tests 8.4
- [ ] Soft-Delete bei Aufnahmen
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
