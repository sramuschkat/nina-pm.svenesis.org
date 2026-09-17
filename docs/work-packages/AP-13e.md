# AP-13e – Engine: Aufwand-Kennzeichen + Job + Einfügeposition

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-13d, AP-12c · **Menschliche Aufgaben:** –

## Ziel
Jedes Projekt zeigt ein geschätztes Aufwand-Kennzeichen (1 Nacht / ca. n Nächte / nicht machbar), live im Editor und als Job auf dem Server; Admins erhalten eine Einfügeposition.

## Anforderungen
FA-PRJ-23, FA-FRG-16, FK 8.9

## Lesen (nur diese Abschnitte)
- specs/engine/effort.md
- TK 7.4 (Job effort), TK 8.3 (Aufwand), TK 13 (daily)
- FK 6.14 (Einfügeposition)
- rules/ui.md
- specs/ui/components.md
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `estimateEffort` mit Stichproben (`stride` 3 Server, 5 Browser; jede Stichprobe mit dem aktuellen Restbedarf)
- Job `effort` (dedupliziert, höchstens 200 Projekte/Tag, sonst nur bei `effort_stale`), Auslöser (Speichern/Einreichen/Freigeben/Sessionende/täglich)
- `suggestedPriorityPosition` für Admins
- Anzeige in S-30…S-33 („ca. n Nächte“) und live im Editor (Web Worker, entprellt 500 ms)

## Nicht im Umfang
- –

## Checkliste Komponente (Aufwand-Chips S-30…S-33)
- [ ] Vertrag aus `docs/specs/ui/components.md` §2 eingehalten: Eigenschaften, Zustände, Mindestgrößen, Grenzfälle, Textalternative
- [ ] Zustände leer / laden / Fehler / bereit; keine Annahmen über Rechte (die Seite entscheidet); kein Import von `useCan`, `fetch` oder Repositories
- [ ] Texte DE/EN über i18n, Zeiten mit Zeitzonen-Kürzel (FK 8.1)
- [ ] Themes `light` und `dark` (Theme-Test gegen die Tokens); Dichtestufen `compact`/`normal`/`wide` ohne Überlauf
- [ ] Mindestbreite laut `components.md` **und** 2400 px ohne horizontales Scrollen (`scrollWidth <= clientWidth`), Tastaturbedienung mit sichtbarem Fokusring
- [ ] `pnpm test:a11y` (axe) ohne *serious*/*critical*-Verstöße

## Automatisierte Abnahme
- [ ] Pflicht-Tests effort.md (inkl. `need = 0` → `done` und Mehrzeilen-Fall)
- [ ] Job-Test: veraltet → neu berechnet; unveränderter `inputHash` → keine Schreibung
- [ ] Laufzeit ≤ 5 s je Projekt im Benchmark
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
