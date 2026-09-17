# AP-07b – Mitglieder, Einladungen, befristete Admins

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-07a · **Menschliche Aufgaben:** –

## Ziel
Admins verwalten Mitglieder, Einladungen und befristete Admin-Rechte in S-70; Rollenabläufe wirken automatisch.

## Anforderungen
FA-BEN-01…11, S-70

## Lesen (nur diese Abschnitte)
- FK 6.13, 6.14
- FK 14.3 (S-70)
- TK 13 (tick-5min Rollenablauf)
- rules/ui.md
- specs/ui/components.md
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- S-70 Mitglieder/Einladungen (Rolle, Befristung, verlängern, entziehen, Sitzungen beenden, entfernen mit Folgen FA-BEN-11)
- `tick-5min`: Rollenablauf + Hinweis 24 h vorher
- Austritt `POST /web/v1/me/leave`

## Nicht im Umfang
- Sicherheitseinstellungen (AP-07c)

## Checkliste Bildschirm (S-70)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-70 vorhanden (Liste im PR abhaken)
- [ ] Wiederverwendbare Bausteine nur nach `docs/specs/ui/components.md`; Abstände über `--npm-space-*`, Symbole aus `components/icons.ts`, kein Emoji
- [ ] Rechte je Rolle (Owner, Admin, befristeter Admin, User) über `useCan` ein-/ausgeblendet; API lehnt trotzdem ab
- [ ] Zustände leer / laden / Fehler (Problem Details → i18n `errors.*`) / 412-Konflikt
- [ ] Texte DE/EN über i18n, Zeiten mit Zeitzonen-Kürzel (FK 8.1)
- [ ] Themes `light` und `dark` (Theme-Test gegen die Tokens, TK 11.3); Dichtestufen `compact`/`normal`/`wide`
- [ ] **Volle Fensterbreite ohne Obergrenze** (kein `max-width`; nur Textseiten auf Lesebreite) und **768 px** Mindestbreite ohne horizontales Scrollen – bei 768 px und bei 2400 px geprüft (NFA-01)
- [ ] Tastaturbedienung mit sichtbarem Fokusring
- [ ] `axe`-Komponententest ohne Verstöße der Stufen *serious* und *critical* (`@axe-core/playwright` im E2E bzw. `vitest-axe` im Komponententest; CI-Schritt `pnpm test:a11y`, TK 18) – **kein** Lighthouse-Schwellwert

## Automatisierte Abnahme
- [ ] Test: befristeter Admin wird nach Ablauf User (`mver`+1, Token veraltet → 401 token_stale)
- [ ] UI blendet Owner-Aktionen für Admins aus; API lehnt ab
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
