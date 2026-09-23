# AP-13e – Engine: Aufwand-Kennzeichen + Job + Einfügeposition

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-13d, AP-12c · **Menschliche Aufgaben:** –

## Ziel
Jedes Projekt zeigt ein geschätztes Aufwand-Kennzeichen (1 Nacht / ca. n Nächte / nicht machbar), live im Editor und als Job auf dem Server; Admins erhalten eine Einfügeposition.

## Anforderungen
FA-PRJ-23, FA-FRG-16, FK 8.9

## Lesen (nur diese Abschnitte)
- specs/engine/effort.md
- TK 7.4 (Job effort), TK 8.3 (Aufwand), TK 13 (`tick-hourly`, standortbezogene Nachtaufgaben NT-08)
- FK 6.14 (Einfügeposition)
- rules/ui.md
- specs/ui/components.md
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `estimateEffort` mit Stichproben (`stride` 3 Server, 5 Browser; jede Stichprobe mit dem aktuellen Restbedarf)
- Job `effort` (dedupliziert `effort:<projectId>`), Auslöser Speichern/Einreichen/Freigeben/Sessionende/Korrektur und Verwerfen von Aufnahmen (`effort_stale`, NT-48)
- **Standortbezogener Lauf (NT-08):** aus `tick-hourly` **einmal je `(site, night)`** nach dem lokalen Mittag des Standorts (`noonStartUtc` der Nacht `currentNight`), idempotent über `effort:<siteId>:<night>`; nur Projekte mit `effort_stale` oder älter als 7 Tage, höchstens 200 je Lauf; „ab heute“ = `currentNight` (`effort.md`)
- `suggestedPriorityPosition` für Admins
- Anzeige in S-30…S-33 („ca. n Nächte“) und live im Editor (Web Worker, entprellt 500 ms; Nacht-Tabelle aus `GET /web/v1/sites/{id}/nights`, NT-02)

## Nicht im Umfang
- –

## Checkliste Komponente (Aufwand-Chips S-30…S-33)
- [ ] Vertrag aus `docs/specs/ui/components.md` §2 eingehalten: Eigenschaften, Zustände, Mindestgrößen, Grenzfälle, Textalternative
- [ ] Zustände leer / laden / Fehler / bereit; keine eigenen Rechteentscheidungen (die Seite entscheidet); kein Import von `useCan`, `fetch` oder Repositories
- [ ] Texte DE/EN über i18n, Zeiten mit Zeitzonen-Kürzel (FK 8.1)
- [ ] Themes `light` und `dark` (Theme-Test gegen die Tokens); Dichtestufen `compact`/`normal`/`wide` ohne Überlauf
- [ ] Mindestbreite laut `components.md` **und** 2400 px ohne horizontales Scrollen (`scrollWidth <= clientWidth`), Tastaturbedienung mit sichtbarem Fokusring
- [ ] `pnpm test:a11y` (axe) ohne *serious*/*critical*-Verstöße

## Automatisierte Abnahme
- [ ] Pflicht-Tests effort.md (inkl. `need = 0` → `done` und Mehrzeilen-Fall)
- [ ] Job-Test: veraltet → neu berechnet; unveränderter `inputHash` → keine Schreibung
- [ ] Laufzeit ≤ 5 s je Projekt im Benchmark
- [ ] Standortlauf Starfront: `tick-hourly` um `2026-09-18T14:00Z` (vor `noonStartUtc` der Nacht `2026-09-18`) → kein Lauf; um `18:00Z` → genau ein Lauf; um `19:00Z` → kein zweiter
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
