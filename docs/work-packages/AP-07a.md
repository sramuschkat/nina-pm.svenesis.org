# AP-07a – System-Administration (Super User)

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-06a · **Menschliche Aufgaben:** –

## Ziel
Der Super User verwaltet Mandanten, Super User, Sperren und Wartungsbanner über S-80/S-81; jede Aktion ist auditiert.

## Anforderungen
FA-SU-01…09, FA-LOG-05, S-80, S-81

## Lesen (nur diese Abschnitte)
- FK 6.13 (Super User)
- FK 14.3 (S-80, S-81)
- TK 7.2 (System)
- rules/ui.md
- specs/ui/components.md
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- S-80 Mandanten (Liste, anlegen, sperren, Owner-Einladung, Notfall-Neuzuweisung mit Begründung)
- S-81 Super User
- System-Audit inkl. `GET /web/v1/audit/system`
- Identität systemweit sperren
- Wartungsbanner (`system_setting`)

## Nicht im Umfang
- Mandanteninterne Verwaltung

## Checkliste Bildschirm (S-80, S-81)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-80, S-81 vorhanden (Liste im PR abhaken)
- [ ] Wiederverwendbare Bausteine nur nach `docs/specs/ui/components.md`; Abstände über `--npm-space-*`, Symbole aus `components/icons.ts`, kein Emoji
- [ ] Rechte je Rolle (Owner, Admin, befristeter Admin, User) über `useCan` ein-/ausgeblendet; API lehnt trotzdem ab
- [ ] Zustände leer / laden / Fehler (Problem Details → i18n `errors.*`) / 412-Konflikt
- [ ] Texte DE/EN über i18n, Zeiten mit Zeitzonen-Kürzel (FK 8.1)
- [ ] Themes `light` und `dark` (Theme-Test gegen die Tokens, TK 11.3); Dichtestufen `compact`/`normal`/`wide`
- [ ] **Volle Fensterbreite ohne Obergrenze** (kein `max-width`; nur Textseiten auf Lesebreite) und **768 px** Mindestbreite ohne horizontales Scrollen – bei 768 px und bei 2400 px geprüft (NFA-01)
- [ ] Tastaturbedienung mit sichtbarem Fokusring
- [ ] `axe`-Komponententest ohne Verstöße der Stufen *serious* und *critical* (`@axe-core/playwright` im E2E bzw. `vitest-axe` im Komponententest; CI-Schritt `pnpm test:a11y`, TK 18) – **kein** Lighthouse-Schwellwert

## Automatisierte Abnahme
- [ ] E2E: Super User legt Mandant an → Einladung → Owner-Login (Test-Login-Fixtures)
- [ ] Jede Aktion erzeugt `system_audit`
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
