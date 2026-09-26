# AP-32b – Änderungsanträge mit Konflikt-Diff

**Release:** R3 · **Größe:** M · **Abhängigkeiten:** AP-32a · **Menschliche Aufgaben:** –
Teil 2 von [AP-32](AP-32.md) (Aufteilung: Entscheidung Sven 26.09.2026).

## Ziel
User stellen für freigegebene Objekte Änderungsanträge; Admins entscheiden mit Gegenüberstellung alt/neu und
Konfliktbehandlung.

## Anforderungen
FA-FRG-08 (mit FA-FRG-04, -11, -14, -15 für Anträge)

## Umfang eines Antrags (Entscheidung Sven 26.09.2026)
Zeilen (geplante Anzahl, an/aus, neue Zeilen), Bedingungen, Zeitraum (Start/Fälligkeit) und Beschreibung.
Koordinaten, Panels und Rig ändert weiterhin nur der Admin.

## Lesen (nur diese Abschnitte)
- FK 6.14, 8.10 · TK 7.2 (Änderungsanträge), 7.4 · contracts/errors.json (`change_request.*`) · rules/ui.md ·
  specs/ui/components.md · `CLAUDE.md`, `docs/rules/testing.md`

## Liefern
- `POST/GET /projects/{id}/change-requests`, `PATCH /change-requests/{id}` (eigene Version, `If-Match` → 412),
  `POST /change-requests/{id}/withdraw`, `POST /change-requests/{id}/decide` (Konflikt `409
  change_request.conflict`, wenn sich das Projekt seit dem Gesehenen geändert hat; angenommen werden nur die
  im Antrag geänderten Felder)
- Warteschlange mit Anträgen (Stimmen, Rang, Benachrichtigungen), Reiter *Änderungsanträge* mit alt/neu,
  Auswirkungsvorschau für Anträge

## Umsetzung (26.09.2026)
- Ein Antrag ist ein eigener Eintrag der Warteschlange (`kind: change-request`, Version des Antrags, Stimmen,
  Rang in der gemeinsamen Rangfolge des Einreichers) mit Gegenüberstellung gegen die **aktuelle** Fassung
  (`QueueItem.changeRequest`); die Plan-Chips zeigen den Plan „mit Antrag“.
- Annehmen wendet die beantragten Felder in **einer** Transaktion an (`ProjectRepository.patchIn/patchLineIn/
  addLineIn`, Änderungsprotokoll und Projektversion wie beim Bearbeiten); die Entscheidung trägt die gesehene
  Projektversion (`409 change_request.conflict`, sonst) und die Antragsversion (`If-Match`, 412).
- Zurückziehen nur durch den Antragsteller (Admins lehnen ab); Ablehnen mit Pflichtkommentar und
  Bestätigungsdialog; eigene Anträge eines Admins wie eigene Objekte (FA-FRG-10).
- Freigabe-Verlauf (FA-FRG-12): „Änderungsantrag gestellt/angenommen/abgelehnt/zurückgezogen“ aus der
  Antragszeile (keine Migration – `approval_event.action` hat einen festen CHECK).
- Oberfläche: Projekt-Editor Reiter *Änderungsanträge* (Antrag stellen/bearbeiten/zurückziehen: Anzahl und
  aktiv je Zeile, neue Zeilen, Mindesthöhe, Mindestzeit, Dämmerung, Start/Fällig, Beschreibung, Begründung);
  Warteschlange Reiter *Alle | Einreichungen | Änderungsanträge*, Entscheidung mit Gegenüberstellung und
  Auswirkungsvorschau; *Meine Objekte* mit Anträgen in der Rangliste.

## Automatisierte Abnahme
- [ ] Konflikt bei geänderter Version (Antrag 412, Entscheidung 409)
- [ ] CI grün, Changelog, AP- und Anforderungs-IDs im PR
