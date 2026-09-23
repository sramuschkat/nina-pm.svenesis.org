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
- CRUD Projekte/Panels/Zeilen, Vorlage anwenden, duplizieren, Status nach `projectStatusTransitions` (inkl. automatische Rückkehr nach *Aktiv*, Vollständigkeitsprüfung beim Aktivieren), Priorität je Rig, Favoriten, Notizen, Verlauf, Rig-Wechsel-Prüfung (FA-RIG-12)
- Zähler-Ableitungen (8.4) inkl. Planungsbedarf (**ganzzahlig**: `planned + ceil(planned·pct/100)`), „Soll erreicht“/„fertig“ in `packages/shared`
- Entwurf ohne Koordinaten, Einreichen prüft Pflichtfelder (`approval.incomplete`)
- `project.effort_stale` bei Änderungen setzen (Job folgt in AP-13e)
- **Löschen und Papierkorb** (TK 6.6, E4): Projekte **immer** weich (`deleted_at`), Panels/Zeilen mit Aufnahmen weich, ohne Aufnahmen endgültig; Papierkorb-Routen `GET /web/v1/projects?deleted=true` und `POST /web/v1/projects/{id}/restore` (Aktion `project.status`, Admin/Owner); kein automatisches Endlöschen; Stammdaten mit Verwendern bleiben gesperrt (`409 resource.in_use`)
- **Zeilen mit Aufnahmen (NT-E3):** Änderungen an Filter, Belichtungszeit, Gain, Offset, Binning oder Auslesemodus → `409 line.locked_by_captures`; änderbar bleiben Anzahl geplant, Mondprofil, aktiv. `POST /web/v1/projects/{id}/lines/{lineId}/duplicate {deactivateSource?}` legt eine neue Zeile mit Zähler 0 an und deaktiviert die alte auf Wunsch
- Datumsfelder mit Standortbezug (`start_date`, `due_date`) sind Nacht-Schlüssel des Standorts (NT-04)

## Nicht im Umfang
- Freigabe (AP-12a)

## Automatisierte Abnahme
- [ ] Rechte: User bearbeitet nur eigene Entwürfe/zurückgegebene
- [ ] Zähler-Tests 8.4
- [ ] Gelöschtes Projekt verschwindet aus Listen, Warteschlange, Scheduler-Eingabe und NINA-Auslieferung; `restore` stellt es unverändert wieder her; User → 403 auf `restore`
- [ ] Panel bzw. Zeile mit Aufnahmen wird weich gelöscht, ohne Aufnahmen endgültig
- [ ] Zeile mit Aufnahmen: Änderung der Belichtungszeit → `409 line.locked_by_captures`, Änderung von „geplant“ → 200; `duplicate` erzeugt eine Zeile mit Zähler 0, mit `deactivateSource: true` ist die alte danach inaktiv
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
