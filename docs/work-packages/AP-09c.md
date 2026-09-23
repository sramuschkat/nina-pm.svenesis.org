# AP-09c – Rig-Bildschirm S-10

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-09b · **Menschliche Aufgaben:** –

## Ziel
Admins konfigurieren Rigs mit allen Scheduler-, Flip-, Rotator- und Filterrad-Einstellungen in S-10. Das ist die Eingabe für Engine und Plugin.

## Anforderungen
FA-RIG-01…14, FA-SCH (Einstellungen), S-10

## Lesen (nur diese Abschnitte)
- FK 14.3 (S-10)
- FK 6.1 (FA-RIG), 6.7 (Scheduler-Einstellungen)
- TK 7.2 (Ausrüstung: Filterradbelegung)
- specs/engine/sort-chain.md
- specs/engine/flip-rotation.md §1
- rules/ui.md
- specs/ui/components.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- S-10 Rigs: Übersicht in drei Spalten, Scheduler-Einstellungen (Strategie, Playback, Sortierkette per Ziehen, Bonus/Überschuss, Mosaik-Panels getrennt, Dither, Filterwechsel, Flats/Dark-Flats inkl. Quelle `panel`/`sky` (NT-40), Overheads), Flip-Einstellungen, Rotator-Felder, Auslieferungsschalter; Speichern mit `If-Match` (`settings_version`)
- **Filterradbelegung (FA-RIG-14, NT-E1):** je Platz Web-Filter ↔ NINA-Filtername aus dem zuletzt gemeldeten NINA-Filterrad, Vorschlag aus `GET /web/v1/rigs/{id}/filter-wheel` übernehmen oder ändern und bestätigen (nur Admin/Owner, `PUT …/filter-wheel`); nicht zugeordnete und nach `filter_wheel_changed` wieder unbestätigte Plätze deutlich markiert (ihre Zeilen plant die Engine nicht ein); OSC ohne Filterrad ohne diesen Abschnitt

## Nicht im Umfang
- Übernahmestatus in NINA (AP-14c)

## Checkliste Bildschirm (S-10)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-10 vorhanden (Liste im PR abhaken)
- [ ] Wiederverwendbare Bausteine nur nach `docs/specs/ui/components.md`; Abstände über `--npm-space-*`, Symbole aus `components/icons.ts`, kein Emoji
- [ ] Rechte je Rolle (Owner, Admin, User; Admin oder Owner ohne Discord-2FA wirkt als User) über `useCan` ein-/ausgeblendet; API lehnt trotzdem ab
- [ ] Folgenreiche Aktionen (Löschen, Rechte entziehen, Owner übertragen, Ablehnen, Token widerrufen, Sitzungen beenden) nur über `ConfirmDialog` (`docs/specs/ui/components.md` §2.10), nie `window.confirm`; Markdown-Felder nur über `react-markdown` ohne rohes HTML
- [ ] Zustände leer / laden / Fehler (Problem Details → i18n `errors.*`) / 412-Konflikt
- [ ] Texte DE/EN über i18n, Zeiten mit Zeitzonen-Kürzel (FK 8.1)
- [ ] Themes `light` und `dark` (Theme-Test gegen die Tokens, TK 11.3); Dichtestufen `compact`/`normal`/`wide`
- [ ] **Volle Fensterbreite ohne Obergrenze** (kein `max-width`; nur Textseiten auf Lesebreite) und **768 px** Mindestbreite ohne horizontales Scrollen – bei 768 px und bei 2400 px geprüft (NFA-01)
- [ ] Tastaturbedienung mit sichtbarem Fokusring
- [ ] `axe`-Komponententest ohne Verstöße der Stufen *serious* und *critical* (`@axe-core/playwright` im E2E bzw. `vitest-axe` im Komponententest; CI-Schritt `pnpm test:a11y`, TK 18) – **kein** Lighthouse-Schwellwert

## Automatisierte Abnahme
- [ ] Komponenten-Tests Sortierkette und Validierung (`afEveryMin = 0` = aus)
- [ ] E2E: Rig anlegen, Einstellungen speichern, 412 bei parallelem Speichern
- [ ] E2E: Filterradbelegung mit Vorschlag bestätigen; als User nur lesend
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Kurze Sichtprüfung
