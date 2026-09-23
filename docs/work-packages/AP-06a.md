# AP-06a – Frontend-Shell, Gestaltung, Anmelde-Bildschirme

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-04b · **Menschliche Aufgaben:** H-16

## Ziel
Die Web-App hat Rahmen, Gestaltung nach svenesis.org, i18n, die Grundbausteine inkl. `ConfirmDialog` und die Anmelde-Bildschirme. Alle weiteren Bildschirme bauen darauf auf.

## Anforderungen
FA-WEB-01…04, FA-ADM-07, NFA UX, S-01

## Lesen (nur diese Abschnitte)
- FK 14.1–14.2, 14.3 (S-01)
- TK 11
- specs/ui/components.md §1–§4 (Grundbausteine inkl. §2.10 `ConfirmDialog`)
- specs/infra/iam.md §10 (CSP)
- rules/ui.md (u. a. Zeitanzeige, Datumswerte, „Heute Nacht“, Zeitzonen-Tests; NT-01…NT-04)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `packages/ui-tokens` (Farben/Typografie nach www.svenesis.org, **Abstandsskala `--npm-space-1…7`** mit Dichte-Faktor, **zwei Themes** `light`/`dark` mit den Farbwerten aus TK 11.3 – **kein** Rotlicht-Modus), `components/icons.ts` (Lucide-Zuordnung nach `components.md` §3), `packages/i18n` erweitern (DE/EN, Grundgerüst aus AP-05)
- Theme-Umschaltung über `data-theme` und **Dichte-Schalter** über `data-density` (`compact`/`normal`/`wide`) am `<html>` mit den Tokens aus TK 11.3 (Zeilenhöhe, Schriftskalierung, Abstandsfaktor, Diagrammhöhe); beide Wahlen in `user_preference`, Sofortwerte `npm.theme`/`npm.density` im `localStorage`
- Layout der Shell: Arbeitsbereich **ohne Breitenobergrenze** (volle Fensterbreite, einklappbare linke Navigation), Textseiten im Container `--npm-max-width`; App-Fußleiste mit dem Dichte-Schalter
- AppBar, SideNav, SvenesisHeader/Footer, Datenschutz-/Quellen-Seite, Einstiegsseite
- S-01: Login, Mandantenauswahl, Kein Zugang, Einladung annehmen; Hinweis „Rechte ruhen – 2FA fehlt“ bei `mfaRequired` (SV-03)
- Grundbausteine, für die AP-06a laut `components.md` zuständig ist: `FilterChip`, `ProgressBar`, `CoordinateInput`, `RigSelect`, `StatusBadge`, `CheckList` und **`ConfirmDialog`** (§2.10: Radix `AlertDialog`, Fokus beim Öffnen auf *Abbrechen*, Aktionsknopf mit Verb, Varianten `default`/`danger`/Namenseingabe) – Pflicht vor jeder folgenreichen Aktion, nie `window.confirm` (E4)
- Markdown-Anzeige nur über `react-markdown` ohne rohes HTML (`skipHtml`, kein `rehype-raw`), ESLint-Regel `react/no-danger` als Fehler (SV-05)
- Auth-Provider, `useCan`, Fehleranzeige aus Problem Details
- Playwright-Tests für UI-Abläufe (Grundgerüst aus AP-04a), E2E „Abmelden in einem Tab wirkt im zweiten mit der nächsten Anfrage“ (TK 17)
- Generierter Web-API-Client (`openapi-typescript` aus `docs/api/openapi.yaml`) und i18n-Lint für fehlende/überzählige Schlüssel (CC-12)
- **Zeit und Datum (NT-03, NT-04):** Datumslogik ausschließlich mit `@js-temporal/polyfill` (`Temporal.PlainDate`, `Temporal.ZonedDateTime`), `Intl` nur zur Anzeige; Hilfsfunktion **`formatTzAbbr(atUtc, timeZone)`** in `packages/shared` mit der Kürzelregel aus `rules/ui.md` (`de-DE` mit `timeZoneName: 'short'`; ergibt das `GMT±x`, dann `en-US`; ergibt auch das `GMT±x`, dann `UTC±h` bzw. `UTC±h:mm`); Baustein **`SiteTime`** (Nachtereignisse in Standortzeit mit Kürzel; Fristen ohne Standortbezug in Mandantenzeit mit Standortzeit im Tooltip; Doppeldatum-Regel „17./18.09.“); ESLint `no-restricted-syntax` gegen `new Date(<String-Literal oder Template>)` in `apps/web` und `packages/shared`

## Nicht im Umfang
- Fachbildschirme
- `WeatherChart` (`specs/ui/components.md` §2.5) – der Baustein gehört zu **AP-23**; AP-06a liefert nur die Tokens, die Farbrampe wird dort nicht definiert

## Checkliste Bildschirm (S-01)
- [ ] Jedes Feld und jede Aktion aus FK 14.3 für S-01 vorhanden (Liste im PR abhaken)
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
- [ ] Komponenten-Tests Rechteanzeige
- [ ] E2E: Test-Login → Mandantenauswahl → Startseite
- [ ] `pnpm test:a11y` (axe) für Shell und Anmelde-Bildschirme ohne *serious*/*critical*-Verstöße (CC5-9)
- [ ] **CSP-Abnahme (SEC-2):** Playwright startet die gebaute SPA hinter einem Proxy, der die produktiven Header aus `iam.md` §10 setzt, öffnet ein Radix-Menü **und** einen Radix-Dialog und prüft, dass die Browserkonsole keinen CSP-Verstoß meldet
- [ ] `ConfirmDialog`-Tests nach `components.md` §4: Doppelklick → genau ein Aufruf, `Esc` = Abbrechen, Fokus beim Öffnen auf *Abbrechen*, falsche Namenseingabe hält den Aktionsknopf gesperrt
- [ ] **Theme-Test** für `light` und `dark`: berechnete Farben gegen die Token-Tabelle
- [ ] **Dichte-Test:** Shell und eine Beispieltabelle in `compact`/`normal`/`wide` – Zeilenhöhe und Abstände ändern sich, die Breite nicht
- [ ] Breiten-Test: Shell bei 768 px, 1280 px und 2400 px ohne horizontales Scrollen (`scrollWidth <= clientWidth`); der Arbeitsbereich nutzt bei 2400 px die volle Breite (kein zentrierter Container), Textseiten bleiben bei 1100 px (UI-1)
- [ ] `formatTzAbbr`-Tabellentest: `America/Chicago` im September → „CDT“ (über `en-US`, weil `de-DE` „GMT-5“ liefert), `Europe/Berlin` im Sommer → „MESZ“, `Asia/Kolkata` → `UTC+5:30`
- [ ] `SiteTime`-Komponententest mit Browserzone `Europe/Berlin` (Playwright `timezoneId`) und Standort `America/Chicago`: `2026-09-18T02:08:00Z` → „21:08 CDT“, nie die Browserzeit
- [ ] Lint-Test: `new Date('2026-09-17')` in `apps/web` schlägt an
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Visuelle Abnahme gegen www.svenesis.org (H-16, nicht blockierend: Anmerkungen als Folge-Issues)
