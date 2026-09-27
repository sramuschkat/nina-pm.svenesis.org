# AP-13f – Simulator S-40

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-13d, AP-09c, AP-11a, AP-06a · **Menschliche Aufgaben:** –

## Ziel
Im Simulator S-40 sieht man den Nachtplan eines Rigs mit Diagnose und Warnungen, bevor NINA ihn ausführt.

## Anforderungen
FA-SIM-01…08, S-40

## Lesen (nur diese Abschnitte)
- FK 6.7, 14.3 (S-40)
- TK 7.2 (Simulation, Nacht-Tabelle)
- specs/engine/night.md §1 (Nacht-Tabelle)
- specs/engine/allocation.md §12 (Warnungen)
- rules/ui.md
- specs/ui/components.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- S-40: Rig/Nacht wählen, Zielkarten, Plan-Grafik (Blöcke, Flip-Kennzeichen, Transit), Protokoll-Tabelle, Diagnose je Projekt (inkl. `lineId`), Plausibilitätswarnungen mit `level`, Rotations-Prüfliste, Entwürfe des Users nur lokal
- **Datenladen für den Simulator** (`GET /web/v1/rigs/{id}` aus AP-09a, `GET /web/v1/projects?rigId=` aus AP-11a, Mondprofile, **Nacht-Tabelle aus `GET /web/v1/sites/{id}/nights`** (AP-09a, NT-02) – Nacht-Schlüssel, `currentNight` und Offsets nie aus `Intl`, Anzeige mit `SiteTime` in Standortzeit mit Kürzel, NT-03) und Übergabe an **`buildPlanInput(rig, projects, moonProfiles, nights, options)`** aus AP-13c – keine eigene Abbildung (A5-2)
- Web Worker mit eigener typisierter RPC-Schicht (`apps/web/src/lib/worker-rpc.ts`, Form wie Comlink `expose`/`wrap`; Entscheidung Sven, 25.09.2026: keine zusätzliche Abhängigkeit)
- `POST /web/v1/simulations` speichert Plan

## Nicht im Umfang
- Mehrnacht (R3)

## Checkliste Bildschirm (S-40)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-40 vorhanden (Liste im PR abhaken)
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
- [ ] E2E: Simulation zeigt Blöcke für Seed-Daten
- [ ] Worker-Ergebnis = Node-Ergebnis (Hash)
- [ ] E2E mit Browserzone `Europe/Berlin` (Playwright `timezoneId`) und Standort `America/Chicago`: Nacht 17./18.09.2026 zeigt Blockzeiten in CDT, Hash = Node-Lauf mit der Server-Tabelle (NT-46)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Sichtprüfung
