# AP-12c – Warteschlange S-33

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-12b · **Menschliche Aufgaben:** –

## Ziel
Alle Mitglieder sehen die Warteschlange S-33 mit Stimmen und Plan-Chips; Admins entscheiden dort.

## Anforderungen
FA-FRG-14, FA-FRG-16, S-33

## Lesen (nur diese Abschnitte)
- FK 14.3 (S-33)
- FK 6.14
- rules/ui.md
- specs/ui/components.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Tabelle für alle Mitglieder: Stimmen (Anzahl + Namen), eigene Stimme, Einreicher-Rang, Plan-Chips-Spalte, Aufwand-Spalte (Platzhalter bis AP-13e), Aktionen Admin (freigeben mit Rig/Position/Start/Zieltermin, zurückgeben, ablehnen)

## Nicht im Umfang
- Fristen/Wochen-Sichtbarkeit (R2/R4)

## Checkliste Bildschirm (S-33)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-33 vorhanden (Liste im PR abhaken)
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
- [ ] E2E: User stimmt ab, Admin gibt frei, Verlauf zeigt Stimmen
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Sichtprüfung
