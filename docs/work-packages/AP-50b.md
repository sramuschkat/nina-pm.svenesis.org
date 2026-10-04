# AP-50b – Auto-Flats je Projekt

**Release:** R5 · **Größe:** M · **Abhängigkeiten:** AP-50 · **Menschliche Aufgaben:** H-15

## Ziel
Am Morgen nimmt das Plugin eine Flat-Kombination nur auf, wenn die Projekte, deren Lights sie nutzen, dafür noch keine
gültigen Flats haben – einmal je Projekt oder nach einem Intervall in Tagen. Ausgefallene Flats werden nachgeholt.

## Anlass
Svens Wunsch vom 04.10.2026 nach den neuen Flat-Optionen des Astro-PM-Plugins (v1.6.4/v1.6.5, Commits edbb301,
3bb30b4, f3750cb, fd12c20 nach 5dd621d): *Auto Flats Per Project* mit *Once Per Project* bzw. *Time Based*. Entscheidungen
Sven, 04.10.2026:
- Quelle der vorhandenen Flats: **nur der Server** (gemeldete Flat-Aufnahmen und `flat_combination` je Projekt mit
  Datum) – keine lokale Ergänzung im Plugin; noch nicht hochgeladene Flats zählen erst nach dem Hochladen.
- **Nachholen** wie Astro PM: nur mit eingeschalteten Auto-Flats, höchstens 3 Nächte; ohne Auto bleiben ausgefallene
  Kombinationen `skipped`.
- **Markierung je Belichtungszeile** in der Web-App nach der aktuellen Regel: ✓ = gültige Flats vorhanden, ✗ = das
  nächste Belichten bringt Flats; Tooltip mit Datum und Anzahl.

## Anforderungen
FA-NIN-17, FA-SCH-08 (Erweiterung im Fachkonzept mit diesem Paket)

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §7 (inkl. Spec-Ergänzung AP-50)
- specs/engine/flip-rotation.md §4
- FK 6.9 (FA-NIN-17), FA-SCH-08
- TK 6.6 (flat_combination)
- `CLAUDE.md`, `docs/rules/testing.md`, `docs/rules/dsql.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- **Rig-Einstellungen** (Migration, additiv): Auto-Flats je Projekt ein/aus, Modus `once_per_project` | `time_based`,
  Intervall in Tagen (Standard 7, 1–30); Bootstrap `rig.scheduler.flats.auto`; Rig-Seite mit schrittweiser Anzeige wie im
  Original (Modus nur mit Auto, Tage nur mit zeitbasiert).
- **Vorhandene Flats je Projekt** an das Plugin (z. B. in `targets` je Projekt): Kombinationsschlüssel (Filter,
  mechanischer Winkel in Zehntelgrad, Gain, Offset, Binning, Auslesemodus-Index) mit letztem Aufnahmedatum und Anzahl.
- **Plugin:** Entscheidung je Kombination nach dem Flat-Planer (AP-50) – aufnehmen, wenn eines der Ziele der Kombination
  keine passenden Flats hat (Winkel innerhalb der Toleranz, sonst exakt) bzw. die neuesten älter als das Intervall sind;
  Log `FLATS_END … status=skipped reason=covered`; keine Kombination übrig → kein Flat-Lauf (auch keine Boxen).
- **Nachholen:** Kombinationen, die bei `sessionEndUtc` oder bei unsicherem Nachtende offen sind, gehen mit Auto in
  den nächsten Morgen über (höchstens 3 Nächte, verfallen beim Abschalten von Flats oder Auto).
- **Web:** Markierung je Belichtungszeile (Projekt-Editor, Projektliste wo Zeilen erscheinen) nach der aktuellen Regel.

## Nicht im Umfang
- Lokale Ergänzung im Plugin um nicht hochgeladene Flats (Entscheidung Sven: nur Server).
- Flats, die außerhalb von NINA-PM entstanden sind.

## Automatisierte Abnahme
- [x] Kern-Tests: einmal je Projekt, zeitbasiert (Grenze genau N Tage), Winkel-Toleranz, Ziele mit und ohne Flats in einer Kombination
- [x] Nachholen über 1–3 Nächte, Verfall nach der 3. Nacht und beim Abschalten
- [x] Kopfloser Lauf mit zwei Nächten (P-38)
- [ ] `pnpm test:dsql`-Protokoll für die Migration (Sven), CI grün, Changelog, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Kurzer VM-Lauf mit zwei Nächten (P-38; zweite Nacht ohne Flats für schon abgedeckte Kombinationen).
