# AP-14c – NINA-Instanzen S-42, Auslieferung S-41, Fake-Plugin

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-14b, AP-13f · **Menschliche Aufgaben:** H-12b, H-24

## Ziel
Admins koppeln NINA-Instanzen in S-42 und sehen die Auslieferung in S-41; das Fake-Plugin prüft eine ganze Nacht automatisch.

## Anforderungen
FA-NIN-22, FA-SIM-09, FA-RIG-06, S-41, S-42

## Lesen (nur diese Abschnitte)
- FK 14.3 (S-41, S-42)
- TK 5.6 (Gültigkeit und Ablage)
- TK 7.2 (NINA-Instanzen)
- TK 17 (Fake-Plugin, Smoke prod)
- TK 18 (`pnpm deploy:prod`)
- rules/ui.md
- specs/ui/components.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- S-42 Instanzen & Token (einmal anzeigen, widerrufen mit `ConfirmDialog`, Diagnose, `last_seen_at` als letzte Nutzung, Lease freigeben „Session übernehmen“) – Tokens gelten bis zum Widerruf, ohne Ablaufdatum und Verlängerung (SV-08)
- S-41 „An NINA ausgeliefert“, Übernahmestatus in S-40/S-10
- `tools/fake-plugin` (komplette Nacht inkl. Neuplanung mit `tonight`, Duplikate, Offline-Nachmeldung, unzugeordnet, Lease verloren) + `pnpm fake-plugin`; als Schritt von `pnpm deploy:prod` gegen den Test-Mandanten mit `TEST_RIG_TOKEN` aus der lokalen Umgebung (H-24), dazu der Smoke-Schritt **DB-Erreichbarkeit** über `GET /api/nina/v1/bootstrap` mit demselben Token (SV-07)

## Nicht im Umfang
- –

## Checkliste Bildschirm (S-41, S-42)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-41, S-42 vorhanden (Liste im PR abhaken)
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
- [ ] Fake-Plugin-Nacht lokal grün, Zähler korrekt
- [ ] Widerruf-Test: nach `revoke` antwortet schon die nächste Anfrage mit `401 nina.token_invalid`
- [ ] Das Token erscheint nur in der Antwort der Anlage; die Liste zeigt Präfix und `last_seen_at`, nie das Token
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Instanz im Test-Mandanten koppeln (H-12b); Token als lokale Umgebungsvariable `TEST_RIG_TOKEN` bereitstellen (H-24), danach Deploy mit Fake-Plugin-Nacht (H-06)
