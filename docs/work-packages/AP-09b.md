# AP-09b – Stammdaten-Bildschirme S-11 … S-15

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-09a, AP-06a · **Menschliche Aufgaben:** –

## Ziel
Admins pflegen die Stammdaten (Standorte, Teleskope, Kameras, Filter/Vorlagen, Mondprofile) in S-11…S-15; User sehen sie lesend.

## Anforderungen
FA-STO, FA-TEL, FA-KAM, FA-FIL, FA-BPL, FA-MON, S-11…S-15

## Lesen (nur diese Abschnitte)
- FK 14.3 (S-11…S-15)
- FK 6.1, 6.2 (Feldlisten)
- rules/ui.md
- contracts/errors.json (resource.in_use)
- specs/ui/components.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- S-11 Standorte (inkl. Standort-Links), S-12 Teleskope, S-13 Kameras (Gain-/Auslesemodi, Hinweis NINA-Abgleich), S-14 Filter & Belichtungsplan-Vorlagen (Spektrum), S-15 Mondprofile (Built-ins schreibgeschützt, Validierung minAlt < maxAlt)
- Wiederverwendbare Formular-, Tabellen- und Löschsperre-Dialoge (Verwenderliste)

## Nicht im Umfang
- S-10 Rigs (AP-09c)

## Checkliste Bildschirm (S-11…S-15)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-11…S-15 vorhanden (Liste im PR abhaken)
- [ ] Wiederverwendbare Bausteine nur nach `docs/specs/ui/components.md`; Abstände über `--npm-space-*`, Symbole aus `components/icons.ts`, kein Emoji
- [ ] Rechte je Rolle (Owner, Admin, befristeter Admin, User) über `useCan` ein-/ausgeblendet; API lehnt trotzdem ab
- [ ] Zustände leer / laden / Fehler (Problem Details → i18n `errors.*`) / 412-Konflikt
- [ ] Texte DE/EN über i18n, Zeiten mit Zeitzonen-Kürzel (FK 8.1)
- [ ] Themes `light` und `dark` (Theme-Test gegen die Tokens, TK 11.3); Dichtestufen `compact`/`normal`/`wide`
- [ ] **Volle Fensterbreite ohne Obergrenze** (kein `max-width`; nur Textseiten auf Lesebreite) und **768 px** Mindestbreite ohne horizontales Scrollen – bei 768 px und bei 2400 px geprüft (NFA-01)
- [ ] Tastaturbedienung mit sichtbarem Fokusring
- [ ] `axe`-Komponententest ohne Verstöße der Stufen *serious* und *critical* (`@axe-core/playwright` im E2E bzw. `vitest-axe` im Komponententest; CI-Schritt `pnpm test:a11y`, TK 18) – **kein** Lighthouse-Schwellwert

## Automatisierte Abnahme
- [ ] Komponenten-Tests Formulare und Validierung
- [ ] E2E: Kamera und Mondprofil anlegen, Löschen in Verwendung zeigt Verwender
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Kurze Sichtprüfung
