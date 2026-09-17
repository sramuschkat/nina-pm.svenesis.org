# Regeln: Frontend

Quelle: TK 11; FK Kap. 7 (Bildschirme S-xx).

- React 19 + TypeScript strict + Vite, React Router (Data Router), TanStack Query/Table, react-hook-form + zod, Radix UI (ungestylt), react-i18next, Comlink-Web-Worker; CSS Modules; Farben/Typografie nur über `packages/ui-tokens` (`--npm-*`), abgeleitet vom Erscheinungsbild www.svenesis.org (keine Laufzeit-Einbindung der Website).
- **Zwei Themes gleichrangig:** `light` und `dark` – jeder Bildschirm in beiden. **Kein Rotlicht-Modus** (Entscheidung 17.09.2026).
- **Arbeitsseiten nutzen die volle Fensterbreite** (kein `max-width`, kein zentrierter Container); nur Textseiten auf `--npm-max-width`. Breakpoints (768/1280/1600 px) steuern nur die Anordnung.
- **Dichte-Schalter** `compact`/`normal`/`wide` als `data-density` am `<html>`; er ändert nur Zeilenhöhe, Schriftskalierung, Abstandsfaktor und Diagrammhöhe – nie die Breite.
- **Mindestbreite: Arbeitsseiten 768 px, Textseiten und Kopf/Fuß 600 px**, jeweils ohne horizontales Scrollen. Telefonbreiten (360 px) werden **nicht** unterstützt (NFA-01).
- Tastaturbedienung mit sichtbarem Fokusring (`:focus-visible`); Kontrast WCAG AA; `pnpm test:a11y` (axe) ohne *serious*/*critical*-Verstöße.
- Abstände nur über `--npm-space-1…7`, Farben nur über `--npm-*`; Symbole aus `components/icons.ts` (Lucide), **kein Emoji** in der Oberfläche.
- Texte ausschließlich über i18n (DE/EN, Schlüssel `bereich.element`); Code/Bezeichner Englisch.
- Nächtliche Zeiten in Standortzeit, Fristen in Mandantenzeit, jeweils mit Kürzel (FK 8.1).
- Rechte nur über `useCan(action, res)` ausblenden – nie als einzige Absicherung.
- Einzelnacht-Simulation und Live-Aufwand im Web Worker mit derselben Engine.
- Fehler aus Problem Details über `errors.*`-i18n-Schlüssel anzeigen.
- Jede Seite: Lade-, Leer-, Fehlerzustand; Formulare mit zod-Schemas aus `packages/shared`.
- Wiederverwendbare Bausteine **nur** nach `specs/ui/components.md` (Eigenschaften, Zustände, Mindestgrößen, Grenzfälle); Bausteine importieren kein `useCan`, kein `fetch`, kein Repository.
- Komponenten-Tests (Testing Library) für Formulare und Rechteanzeige; E2E für Kernabläufe.
- Druckansicht statt serverseitiger PDF-Erzeugung.
