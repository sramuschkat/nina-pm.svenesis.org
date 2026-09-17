# AP-06a – Frontend-Shell, Gestaltung, Anmelde-Bildschirme

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-04b · **Menschliche Aufgaben:** H-16

## Ziel
Die Web-App hat Rahmen, Gestaltung nach svenesis.org, i18n und die Anmelde-Bildschirme. Alle weiteren Bildschirme bauen darauf auf.

## Anforderungen
FA-WEB-01…04, FA-ADM-07, NFA UX, S-01

## Lesen (nur diese Abschnitte)
- FK 14.1–14.2, 14.3 (S-01)
- TK 11
- specs/ui/components.md §1, §3, §4
- specs/infra/iam.md §10 (CSP)
- rules/ui.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `packages/ui-tokens` (Farben/Typografie nach www.svenesis.org, **Abstandsskala `--npm-space-1…7`** mit Dichte-Faktor, **zwei Themes** `light`/`dark` mit den Farbwerten aus TK 11.3 – **kein** Rotlicht-Modus), `components/icons.ts` (Lucide-Zuordnung nach `components.md` §3), `packages/i18n` erweitern (DE/EN, Grundgerüst aus AP-05)
- Theme-Umschaltung über `data-theme` und **Dichte-Schalter** über `data-density` (`compact`/`normal`/`wide`) am `<html>` mit den Tokens aus TK 11.3 (Zeilenhöhe, Schriftskalierung, Abstandsfaktor, Diagrammhöhe); beide Wahlen in `user_preference`, Sofortwerte `npm.theme`/`npm.density` im `localStorage`
- Layout der Shell: Arbeitsbereich **ohne Breitenobergrenze** (volle Fensterbreite, einklappbare linke Navigation), Textseiten im Container `--npm-max-width`; App-Fußleiste mit dem Dichte-Schalter
- AppBar, SideNav, SvenesisHeader/Footer, Datenschutz-/Quellen-Seite, Einstiegsseite
- S-01: Login, Mandantenauswahl, Kein Zugang, Einladung annehmen
- Auth-Provider, `useCan`, Fehleranzeige aus Problem Details
- Playwright-Tests für UI-Abläufe (Grundgerüst aus AP-04a), E2E „zwei Tabs refreshen“
- Generierter Web-API-Client (`openapi-typescript` aus `docs/api/openapi.yaml`) und i18n-Lint für fehlende/überzählige Schlüssel (CC-12)

## Nicht im Umfang
- Fachbildschirme

## Checkliste Bildschirm (S-01)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-01 vorhanden (Liste im PR abhaken)
- [ ] Wiederverwendbare Bausteine nur nach `docs/specs/ui/components.md`; Abstände über `--npm-space-*`, Symbole aus `components/icons.ts`, kein Emoji
- [ ] Rechte je Rolle (Owner, Admin, befristeter Admin, User) über `useCan` ein-/ausgeblendet; API lehnt trotzdem ab
- [ ] Zustände leer / laden / Fehler (Problem Details → i18n `errors.*`) / 412-Konflikt
- [ ] Texte DE/EN über i18n, Zeiten mit Zeitzonen-Kürzel (FK 8.1)
- [ ] Themes `light` und `dark` (Theme-Test gegen die Tokens, TK 11.3); Dichtestufen `compact`/`normal`/`wide`
- [ ] **Volle Fensterbreite ohne Obergrenze** (kein `max-width`; nur Textseiten auf Lesebreite) und **768 px** Mindestbreite ohne horizontales Scrollen – bei 768 px und bei 2400 px geprüft (NFA-01)
- [ ] Tastaturbedienung mit sichtbarem Fokusring
- [ ] `axe`-Komponententest ohne Verstöße der Stufen *serious* und *critical* (`@axe-core/playwright` im E2E bzw. `vitest-axe` im Komponententest; CI-Schritt `pnpm test:a11y`, TK 18) – **kein** Lighthouse-Schwellwert

## Automatisierte Abnahme
- [ ] Komponenten-Tests Rechteanzeige
- [ ] E2E: Test-Login → Mandantenauswahl → Startseite
- [ ] `pnpm test:a11y` (axe) für Shell und Anmelde-Bildschirme ohne *serious*/*critical*-Verstöße (CC5-9)
- [ ] **CSP-Abnahme (SEC-2):** Playwright startet die gebaute SPA hinter einem Proxy, der die produktiven Header aus `iam.md` §10 setzt, öffnet ein Radix-Menü **und** einen Radix-Dialog und prüft, dass die Browserkonsole keinen CSP-Verstoß meldet
- [ ] **Theme-Test** für `light` und `dark`: berechnete Farben gegen die Token-Tabelle
- [ ] **Dichte-Test:** Shell und eine Beispieltabelle in `compact`/`normal`/`wide` – Zeilenhöhe und Abstände ändern sich, die Breite nicht
- [ ] Breiten-Test: Shell bei 768 px, 1280 px und 2400 px ohne horizontales Scrollen (`scrollWidth <= clientWidth`); der Arbeitsbereich nutzt bei 2400 px die volle Breite (kein zentrierter Container), Textseiten bleiben bei 1100 px (UI-1)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Visuelle Abnahme gegen www.svenesis.org (H-16, nicht blockierend: Anmerkungen als Folge-Issues)
