# AP-11b – Projekt-Editor S-31

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-11a, AP-10 · **Menschliche Aufgaben:** –

## Ziel
User und Admins erfassen Projekte im Editor S-31 schnell und korrekt, mit Vorschau im Nachtdiagramm.

## Anforderungen
FA-PRJ, S-31

## Lesen (nur diese Abschnitte)
- FK 14.3 (S-31)
- FK 6.4
- TK 7.2 (Projekte: Zeilen mit Aufnahmen, NT-E3)
- rules/ui.md
- specs/ui/components.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Editor: Einzelfeld (Koordinateneingabe/Suche Platzhalter bis R2), Zeilen mit Schnelleingabe, Vorlagen-Regel, Summen, Start-/Zieltermin (Nacht-Schlüssel des Standorts, NT-04), Nachtdiagramm-Vorschau
- Aufwand-Live-Anzeige als Platzhalter (AP-13e)
- **Zeilen mit Aufnahmen (NT-E3):** Filter, Belichtungszeit, Gain, Offset, Binning und Auslesemodus schreibgeschützt mit Hinweis und Aktion *Zeile duplizieren* (`POST /web/v1/projects/{id}/lines/{lineId}/duplicate`, alte Zeile optional deaktivieren); `409 line.locked_by_captures` erscheint als i18n-Fehlertext

## Nicht im Umfang
- Sternkarte (R2)

## Checkliste Bildschirm (S-31)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-31 vorhanden (Liste im PR abhaken)
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
- [ ] Komponenten-Tests Schnelleingabe und Summen
- [ ] E2E: Projekt anlegen, Zeile ergänzen, speichern (If-Match)
- [ ] Komponententest: Zeile mit Aufnahmen → gesperrte Felder, *Zeile duplizieren* ruft die Route auf
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Sichtprüfung
