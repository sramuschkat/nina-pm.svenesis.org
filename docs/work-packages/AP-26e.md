# AP-26e – Nachtdiagramm im Stil des Beobachtungsplaners, Plangrafik des Simulators

**Release:** UI-Überarbeitung (vor R3) · **Größe:** M · **Abhängigkeiten:** AP-26d · **Menschliche Aufgaben:** –

## Ziel
Ein Nachtdiagramm für alle Stellen, gestaltet wie das Höhendiagramm des Beobachtungsplaners der Website (`legacy/astro-tools-2026-09-21/js/observing-planner.js`, `drawAltChart`). Die Zeitachse zeigt Standort- und eigene Zeit (Wunsch Sven, 26.09.2026). Der Simulator bekommt eine Plangrafik nach Svens Screenshot vom 26.09.2026: Blöcke als Flächen im Diagramm, Filterleiste darüber, ziehbare Uhrzeit.

Grundlage ist der Design-Canvas „Nachtdiagramm, Sternkarte, Editor Entwurf (AP-26e)“. Entscheidungen Sven vom 26.09.2026:
- Das Diagramm ist in beiden Themes dunkel.
- Der Editor wird zweispaltig; das folgt in AP-26f.
- Der Simulator sieht aus wie der Screenshot.

## Lesen
- `docs/specs/ui/components.md` §2.3 (`NightTimeline`)
- FK FA-SIC-01, FA-SIM-02, FA-SIM-07 (`docs/concept/INDEX.md`)
- `docs/rules/ui.md`

## Liefern
- **Tokens** (`packages/ui-tokens`, themen-unabhängig):
  - `SKY_STOPS` nach `CHART_SKY` des Beobachtungsplaners.
  - Neue Farben für Rahmen, Achse, astronomisch dunkel (grün), Grenzlinie der Dunkelheit, Uhrzeit (rot), Meridian (violett), beste Zeit und Mondbeschriftung.
- **`NightChart`** (components.md §2.3):
  - **Rahmen:** dunkle Fläche mit Achsen innerhalb; die Legende steht als Zeile darüber.
  - **Ausschnitt:** eine Stunde vor Sonnenuntergang bis eine Stunde nach Sonnenaufgang, auf volle Standortstunden (`crop`, Standard an). Ohne Sonnenuntergang Mittag bis Mittag.
  - **Himmel und Raster:** Himmel nach Sonnenhöhe; astronomisch dunkel grün mit gepunkteten Grenzlinien. Raster 60° und alle zwei Stunden, Mindesthöhe (sonst 30°) gestrichelt, Dämmerungskürzel B/N/A.
  - **Mond:** rote Fläche, deren Deckkraft der Beleuchtung folgt.
  - **Marken:** Meridian als violette gestrichelte Linie mit Beschriftungskasten, beste Zeit als Punkt (höchster Stand in astronomischer Dunkelheit).
  - **Uhrzeit:** rote Linie mit Kasten „Uhrzeit 03:40 (10:40)“, die Klammer in der zweiten Zone.
  - **Zweite Zeitzone:** standardmäßig die Zeitzone des Geräts, nur wenn sie von der Standortzeit abweicht; abschaltbar mit `secondaryTimeZone={null}`.
  - **Stundenstreifen** (FA-SIC-01) bleiben abschaltbar (`bands`) und sind im Projekt-Editor an.
  - **`facts`:** Kennwerte neben dem Diagramm (Höhe zur Uhrzeit, höchste Höhe, Mond, Zeit über Mindesthöhe).
  - **Zeiger:** Klick oder Ziehen setzt die Uhrzeit (`cursorUtc` / `onCursorChange`, sonst `onSelect`).
  - **`variant="plan"`** (Simulator, FA-SIM-07):
    - Blöcke als halbtransparente Flächen in Zielfarbe mit Namen; der Block unter der Uhrzeit ist hervorgehoben.
    - Filterleiste über dem Diagramm mit „R ×10“.
    - Dämmerung ausgeschrieben am Fuß, Mond beschriftet.
    - Nacht dunkel statt grün.
- **`DataTable`** (§2.11): `renderDetail` – die Detailzeile ist immer aufklappbar und zeigt zusätzlich eigenen Inhalt.
- **Seiten:**
  - **Simulator:** Plangrafik nach Screenshot. Die Kopfzeile trägt Standortzeit, dunkle Stunden, Ziele, Aufnahmen und Mond; der Zeitschieber bleibt als Tastaturweg.
  - **Objektbrowser** (Alle Objekte, Beste der Nacht): die aufgeklappte Zeile zeigt das Nachtdiagramm des Objekts mit Kennwerten für Rig und Nacht der Kontextleiste.
  - **Projekt-Editor, Projektliste, Sternkarte:** der neue Stil ohne eigene Umbauten (die folgen in AP-26f).
- Spezifikation components.md §2.3 und Changelog angepasst.

## Nicht im Umfang
- Layout von Editor und Sternkarte (AP-26f), Engine und API.

## Automatisierte Abnahme
- [ ] Modelltests: Ausschnitt auf volle Standortstunden (auch bei Zeitumstellung), beste Zeit, Plan-Beschriftung „R ×10“
- [ ] Baustein-Tests: Legende oben, `facts`, Zeiger per Klick, `variant="plan"`, axe ohne *serious*/*critical*
- [ ] Objektbrowser: Aufklappen zeigt das Diagramm; Simulator: Plangrafik und Schieber
- [ ] CI grün, Changelog-Eintrag

## Menschliche Freigabe
Sichtabnahme Sven (Objektbrowser aufgeklappt, Simulator, Editor-Diagramm)
