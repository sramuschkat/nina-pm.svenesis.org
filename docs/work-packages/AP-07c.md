# AP-07c – Mandanteneinstellungen, Sicherheit, Owner-Übertragung, Protokolle

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-07b · **Menschliche Aufgaben:** –

## Ziel
Mandanteneinstellungen, Sicherheitseinstellungen des Owners, Owner-Übertragung und Protokolle sind bedienbar. Damit ist die Benutzerverwaltung R1 vollständig.

## Anforderungen
FA-BEN-06…10, FA-ADM, S-71, S-72, S-73

## Lesen (nur diese Abschnitte)
- FK 6.12–6.14
- FK 14.3 (S-71…S-73)
- TK 7.2 (Mandant, Sicherheit, Rollen & Owner)
- rules/ui.md
- specs/ui/components.md
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- S-71 Einstellungen (Allgemein), Reiter Sicherheit (nur Owner, 2FA-Pflicht nur mit Owner-2FA), Owner-Übertragung mit Bestätigung per Mandantenschlüssel
- S-72 Anmelde- und Änderungsprotokoll
- S-73 persönliche Einstellungen, Anmeldesitzungen

## Nicht im Umfang
- Discord-Reiter (AP-60)

## Checkliste Bildschirm (S-71…S-73)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-71…S-73 vorhanden (Liste im PR abhaken)
- [ ] Wiederverwendbare Bausteine nur nach `docs/specs/ui/components.md`; Abstände über `--npm-space-*`, Symbole aus `components/icons.ts`, kein Emoji
- [ ] Rechte je Rolle (Owner, Admin, befristeter Admin, User) über `useCan` ein-/ausgeblendet; API lehnt trotzdem ab
- [ ] Zustände leer / laden / Fehler (Problem Details → i18n `errors.*`) / 412-Konflikt
- [ ] Texte DE/EN über i18n, Zeiten mit Zeitzonen-Kürzel (FK 8.1)
- [ ] Themes `light` und `dark` (Theme-Test gegen die Tokens, TK 11.3); Dichtestufen `compact`/`normal`/`wide`
- [ ] **Volle Fensterbreite ohne Obergrenze** (kein `max-width`; nur Textseiten auf Lesebreite) und **768 px** Mindestbreite ohne horizontales Scrollen – bei 768 px und bei 2400 px geprüft (NFA-01)
- [ ] Tastaturbedienung mit sichtbarem Fokusring
- [ ] `axe`-Komponententest ohne Verstöße der Stufen *serious* und *critical* (`@axe-core/playwright` im E2E bzw. `vitest-axe` im Komponententest; CI-Schritt `pnpm test:a11y`, TK 18) – **kein** Lighthouse-Schwellwert

## Automatisierte Abnahme
- [ ] E2E: Owner überträgt → Empfänger nimmt an → alter Owner bleibt Admin
- [ ] Admin ändert Sicherheit → 403
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
