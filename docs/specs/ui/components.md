# Spezifikation: Wiederverwendbare UI-Bausteine

Verbindlich für AP-06a, AP-06b, AP-10, AP-13e, AP-13f, AP-24, AP-25 und jedes Paket, das einen dieser Bausteine benutzt. Bezug: Fachkonzept 14.1, 14.3, 14.4; Technisches Konzept 11.1–11.3.
**Warum diese Datei:** Fünf Pakete liefern Bausteine, und viele weitere benutzen sie. Ohne gemeinsamen Vertrag legt das erste Paket das Verhalten für alle fest, und die Nacht-Zeitleiste sieht im Simulator anders aus als im Projekt-Editor (UI-3).

## 1. Allgemeine Regeln (gelten für jeden Baustein)

- **Ort:** `apps/web/src/components/<Name>/` mit `index.tsx`, `<Name>.module.css`, `<Name>.test.tsx`. Keine Geschäftslogik im Baustein – Daten kommen ausschließlich über Eigenschaften.
- **Keine Rechteprüfung:** Ein Baustein kennt `can()` nicht. Die Seite entscheidet und übergibt `disabled` bzw. lässt Aktionen weg (`rules/ui.md`).
- **Vier Zustände, immer:** `loading` (Skelett in Tokenfarben, keine Spinner-Zentrierung mit Sprung), `empty` (kurzer Satz + optional eine Aktion), `error` (Meldung aus `errors.*`-i18n + *Erneut versuchen*, wenn der Aufrufer `onRetry` gibt), `ready`. Jeder Baustein nimmt `state?: 'loading' | 'empty' | 'error' | 'ready'` oder leitet es aus den Daten ab; der Vertrag steht je Baustein unten.
- **Größen:** Jeder Baustein nennt eine **Mindestbreite**. Unterhalb davon wird nicht umgebrochen, sondern der Inhalt reduziert (Spalten weg, Kurzform, Tooltip) – niemals horizontal gescrollt (NFA-01: Arbeitsseiten ab 768 px).
- **Abstände und Farben** nur über Tokens (`--npm-space-*`, `--npm-*`); keine freien px-Werte außer den hier genannten Mindest-/Höchstgrößen.
- **Themes:** Jeder Baustein funktioniert in `light` und `dark` (es gibt **keinen** Rotlicht-Modus); der Theme-Test (TK 11.3) prüft die berechneten Farben je Baustein automatisch gegen die Tokens.
- **Dichte:** Jeder Baustein liest Zeilenhöhe, Schriftskalierung, Abstandsfaktor und Diagrammhöhe aus den Dichte-Tokens (`--npm-row-h`, `--npm-font-scale`, `--npm-space-scale`, TK 11.3) – **keine** eigene Logik für die Dichtestufe. Eine `size`-Eigenschaft steuert nur den Einsatzort (Tabelle vs. Karte).
- **Breite:** Bausteine wachsen mit ihrem Container (`width: 100%`), weil die Arbeitsseiten die volle Fensterbreite nutzen. Wo mehr Platz sinnvoll ist (Diagramme, Tabellen), nutzt der Baustein ihn; eine Höchstbreite setzt nur der Aufrufer.
- **Tastatur:** Jedes interaktive Element ist mit `Tab` erreichbar, hat einen sichtbaren Fokusring (2 px, Akzentfarbe, `:focus-visible`) und reagiert auf `Enter`/`Space`. Diagramme sind mit `Tab` fokussierbar und mit `←`/`→` schrittweise abtastbar; der Fokuswert wird per `aria-live="polite"` als Text ausgegeben (das ist die Barrierefreiheits-Lösung für Canvas).
- **Canvas-Bausteine** (Nacht-Zeitleiste, Saisondiagramm, Astro-Wetter) zeichnen mit `devicePixelRatio`, erneuern bei `ResizeObserver`, rendern **ohne** eigene Datenabfrage und bieten immer eine Textalternative (`<table>` hinter `<details>` mit denselben Werten – erfüllt WCAG und dient gleichzeitig dem Komponententest).
- **Symbole:** Lucide, Strichstärke 2, 16 px in Tabellen, 20 px in Knöpfen, 24 px in der Navigation. Kein Emoji.
- **Tests je Baustein (Pflicht):** Zustände leer/laden/Fehler · Tastaturpfad · `vitest-axe` ohne *serious*/*critical* · Theme-Test für **beide** Themes · Dichte-Test für `compact`/`normal`/`wide` · Breitentest bei Mindestbreite und bei 2400 px · Grenzfall aus der Tabelle unten.

## 2. Die neun Bausteine

### 2.1 `FilterChip`

| | |
|---|---|
| Zweck | Filter als Farbmarke mit Kurznamen (Projektkarte, Editor, Simulator, Protokoll, Filterliste) |
| Eigenschaften | `shortName: string` · `color: string` (Hex aus `filter.color`) · `size?: 'sm' \| 'md'` (16/20 px Höhe) · `selected?: boolean` · `disabled?: boolean` · `onToggle?: () => void` · `title?: string` |
| Zustände | nur `ready`; ohne `onToggle` ist es ein `<span>`, mit `onToggle` ein `<button aria-pressed>` |
| Größen | Mindestbreite 32 px; Kurznamen über 4 Zeichen werden auf 4 gekürzt und der volle Name steht im `title` |
| Grenzfall | Kontrast: liegt die Helligkeit der Filterfarbe über 60 %, wird die Schrift dunkel gesetzt, sonst hell – Kontrast ≥ 4,5:1 ist Testfall |

### 2.2 `ProgressBar`

| | |
|---|---|
| Zweck | Fortschritt „x/y × t“ (Projektkarte, Editor, NINA-Auslieferung, Meine Objekte) |
| Eigenschaften | `acquired: number` · `planned: number` · `rejected?: number` · `bonus?: number` · `exposureS?: number` · `showLabel?: boolean` · `size?: 'sm' \| 'md'` |
| Zustände | `planned = 0` → `empty` („kein Plan“); sonst `ready` |
| Darstellung | drei Segmente in einem Balken: akzeptiert (Akzentfarbe), verworfen (gedämpft, schräg gestreift), Bonus (heller Akzent). Label `22/60 × 300 s · 33 %` |
| Größen | Mindestbreite 96 px; unter 140 px entfällt das Label und wandert in den `title` |
| Grenzfall | `acquired > planned` (Bonus/Überschuss): der Balken bleibt bei 100 %, das Label zeigt `62/60`, und der Überhang wird als eigenes Segment **über** der Linie angedeutet – kein Überlauf des Containers |
| Barrierefrei | `role="progressbar"` mit `aria-valuenow/min/max` und `aria-valuetext` (das Label) |

### 2.3 `NightTimeline` (Nacht-Zeitleiste)

Der wichtigste und am häufigsten wiederverwendete Baustein: Nachtdiagramm, Simulator, Exoplaneten, Sternkarte, Session-Soll/Ist.

| | |
|---|---|
| Eigenschaften | `window: {startUtc, endUtc}` (Mittag–Mittag) · `twilight: {civil, nautical, astronomical}` je Rand · `series?: AltitudeSeries[]` (Höhenkurven je Ziel, `{id, label, color, points: [{atUtc, altDeg}]}`) · `moon?: {points, illuminationPct, riseUtc, setUtc}` · `blocks?: TimelineBlock[]` (`{id, fromUtc, toUtc, label, kind: 'regular' \| 'transit' \| 'flat' \| 'idle', actual?: boolean}`) · `markers?: {atUtc, kind: 'flip' \| 'transit' \| 'now' \| 'custom', label}[]` · `minAltDeg?: number` (gestrichelte Linie) · `timeZone: string` (Anzeige in Standortzeit) · `height?: number` · `onSelect?: (atUtc) => void` |
| Zustände | `window` fehlt → `error`; keine `series` und keine `blocks` → `empty` („keine Nacht mit Dunkelheit“, der Fall Polartag ist damit abgedeckt) |
| Darstellung | Hintergrund nach Sonnenhöhe abgestuft, astronomische Dunkelheit als eigener Streifen, Mondband oben, Höhenkurven mittig, Blöcke als Balken unten (Ist-Balken schmaler und unter dem Soll-Balken, wenn `actual`), Marken als senkrechte Linien mit Kürzel |
| Größen | Mindestbreite **320 px**, Mindesthöhe 120 px; Standardhöhe 180 px (Editor) bzw. 240 px (Simulator). Unter 480 px entfallen die Stundenbeschriftungen bis auf jede dritte |
| Grenzfälle | (1) **keine Dunkelheit** (Mitternachtssonne) → nur Dämmerungsstreifen, Hinweistext im Diagramm; (2) **durchgehende Dunkelheit** (Polarnacht) → kein Dämmerungsstreifen; (3) **Zeitumstellung in der Nacht** → die Achse folgt der Standortzeit und enthält 23 bzw. 25 Stunden, die Beschriftung springt sichtbar; (4) mehr als 12 `series` → nur die ersten 12 werden gezeichnet, der Rest als „+n weitere“ in der Legende |
| Textalternative | `<details>`-Tabelle mit Dämmerungszeiten, je Ziel Auf-/Untergang und Kulmination, je Block Von/Bis/Label |

### 2.4 `SeasonChart` (Saison-/Monatsdiagramm)

| | |
|---|---|
| Einsatz | Projekt-Editor, Objektbrowser |
| Eigenschaften | `months: {month: string, usableHours: number, moonPct: number, usable: boolean}[]` · `range: '1m' \| '3m' \| '6m' \| '1y'` · `seasonStart?: string` · `seasonEnd?: string` · `minTimeH?: number` |
| Zustände | leeres `months` → `empty`; `ready` sonst |
| Darstellung | Balken je Nacht bzw. Woche (je `range`), Mindestzeit als waagerechte Linie, Saisonende als senkrechte Marke mit Datum |
| Größen | Mindestbreite 280 px, Höhe 120 px |
| Grenzfall | **zirkumpolar** (kein Saisonende) → keine Marke, Fußnote „ganzjährig“; **außerhalb der Saison** → Saisonbeginn als zweite Marke, Bereich davor gedämpft |

### 2.5 `WeatherChart` (Astro-Wetter-Grafik)

| | |
|---|---|
| Einsatz | Wetter, Standort, Projekt, Heute Nacht |
| Eigenschaften | `hours: WeatherHour[]` (Wolken hoch/mittel/tief, Seeing, Transparenz, Wind, Temperatur, Taupunkt, ECMWF-Gesamtnote) · `nightWindows: {startUtc, endUtc}[]` · `nowUtc: string` · `days: 7 \| 14` · `compact?: boolean` (Variante für „Heute Nacht“: nur Farbband) |
| Zustände | `hours` leer → `empty` („Vorhersage nicht verfügbar“, mit Zeitstempel des letzten Abrufs, wenn vorhanden); Abruffehler → `error` mit letztem Stand als gedämpfte Darstellung |
| Größen | Mindestbreite 360 px (volle Variante) bzw. 160 px (Eigenschaft `compact` – nicht die Dichtestufe); wächst nach oben mit dem Container |
| Grenzfall | Vorhersage endet mitten im Zeitraum → der Rest wird schraffiert und mit „keine Daten“ beschriftet, nicht auf 0 gesetzt |

### 2.6 `CoordinateInput`

| | |
|---|---|
| Einsatz | Standort, Projekt, Sternkarte |
| Eigenschaften | `kind: 'ra' \| 'dec' \| 'lon' \| 'lat'` · `valueDeg: number \| null` · `onChange(valueDeg \| null)` · `format?: 'sexagesimal' \| 'decimal'` (umschaltbar, Merkung in `user_preference`) · `disabled?` · `required?` |
| Verhalten | nimmt beide Schreibweisen bei der Eingabe an (`00h 52m 49s`, `00 52 49`, `13.2046`, `+56° 37′ 48″`, `56:37:48`), zeigt in der gewählten an; Umschalter als kleiner Knopf im Feld |
| Zustände | ungültige Eingabe → `error` am Feld mit Beispiel; leer und `required` → `error` beim Verlassen |
| Grenzfälle | RA auf `[0, 360)` normalisiert (`24h 00m` → `00h 00m`), Dec auf `[-90, +90]` begrenzt (Eingabe darüber → Fehler, **kein** stilles Abschneiden); Rundung auf 1e-6° wie die Engine (`canonical-json.md`) |
| Barrierefrei | ein `<input>` (kein Dreifach-Feld), Format im `aria-describedby` |

### 2.7 `RigSelect`

| | |
|---|---|
| Einsatz | Sternkarte, Simulator, Exoplaneten, Wetter, Listenfilter |
| Eigenschaften | `rigs: {id, name, siteName, telescopeName, cameraName, scaleArcsecPx, fovDeg, showInPlanning}[]` · `value: string \| null` · `onChange(id)` · `includeAll?: boolean` (Option „alle Rigs“ für Filter) · `disabled?` |
| Zustände | `rigs` leer → `empty` („kein Rig konfiguriert“ + Link nach S-10, wenn der Aufrufer `onEmptyAction` gibt) |
| Darstellung | Radix `Select`; je Zeile Name fett, darunter `Standort · Teleskop · Kamera · 2,03″/px · 1,7°×1,1°` in `--npm-text-light` |
| Größen | Mindestbreite 200 px; darunter nur der Name |
| Grenzfall | Rigs mit `showInPlanning = false` erscheinen unter einem Trenner „nicht in der Planung“ und sind wählbar, aber mit Hinweis |

### 2.8 `StatusBadge` (Status-/Freigabe-Kennzeichen)

| | |
|---|---|
| Einsatz | alle Projektansichten |
| Eigenschaften | `kind: 'project' \| 'approval' \| 'session' \| 'transit' \| 'effort'` · `value: string` (Wert aus `contracts/enums.json`) · `size?: 'sm' \| 'md'` · `withTooltip?: boolean` |
| Verhalten | Text **ausschließlich** über i18n-Schlüssel `status.<kind>.<value>`; Farbe über eine Zuordnungstabelle im Baustein (eine Stelle, nicht je Seite). Unbekannter Wert → neutrale Farbe und der rohe Wert, **kein** Absturz (ein neuer Enum-Wert darf die Oberfläche nie brechen) |
| Grenzfall | `kind: 'effort'` mit `value: null` (kein Bedarf) → der Baustein rendert **nichts** (`effort.md`: kein Kennzeichen ohne Bedarf) |

### 2.9 `CheckList` (Prüfliste ✓/✗)

| | |
|---|---|
| Einsatz | Zielkarten im Simulator, Einreichen-Dialog |
| Eigenschaften | `items: {id, label, ok: boolean \| null, detail?: string}[]` (`null` = nicht geprüft) · `compact?: boolean` |
| Darstellung | Lucide `check`/`x`/`minus` in Grün/Rot/Grau; die Unterscheidung trägt **immer** auch die Symbolform, nicht nur die Farbe (Rot-Grün-Sehschwäche, Testfall) |
| Zustände | `items` leer → `empty` |
| Grenzfall | mehr als 8 Einträge und `compact` → „n von m erfüllt“ mit Aufklappen |

## 3. Symbole je Bereich (Lucide)

| Bereich / Aktion | Symbol |
|---|---|
| Heute Nacht · Ausrüstung · Planung · Projekte · NINA · Wetter · Auswertung · Administration · System | `moon-star` · `telescope` · `compass` · `folder-kanban` · `plug-zap` · `cloud-sun` · `chart-line` · `users` · `settings` |
| Speichern · Einreichen · Freigeben · Zurückgeben · Ablehnen · Simulieren · Duplizieren · Löschen | `save` · `send` · `check` · `undo-2` · `x` · `play` · `copy` · `trash-2` |
| Benachrichtigungen · Theme hell/dunkel/rot · Benutzer · Hilfe | `bell` · `sun`/`moon`/`lamp` · `user` · `circle-help` |

Die Zuordnung liegt als Konstante `apps/web/src/components/icons.ts`; Seiten importieren **nur** daraus, damit dasselbe Symbol überall dasselbe bedeutet.

## 4. Abnahme (AP-06a und je liefernde Pakete)

1. Für jeden der neun Bausteine existieren die vier Zustände und sind als Komponententest abgedeckt.
2. `pnpm test:a11y` (axe) meldet für keine Bausteingeschichte einen *serious*- oder *critical*-Verstoß.
3. Der Theme-Test läuft für **beide** Themes über alle Bausteine und vergleicht die berechneten Farben mit der Token-Tabelle. Zusätzlich ein Dichte-Test: jeder Baustein in `compact`/`normal`/`wide` ohne Überlauf und ohne überlappenden Text.
4. Die in §2 genannten **Grenzfälle** sind je Baustein als Test vorhanden – insbesondere Mitternachtssonne, Polarnacht und Zeitumstellung für `NightTimeline`, `acquired > planned` für `ProgressBar`, Dec über 90° für `CoordinateInput` und unbekannter Enum-Wert für `StatusBadge`.
5. Kein Baustein importiert `useCan`, `fetch`, TanStack Query oder ein Repository (ESLint-Regel `no-restricted-imports` für `components/**`).
6. Mindestbreiten: ein Test rendert jeden Baustein bei seiner Mindestbreite **und** bei 2400 px und prüft beide Male `scrollWidth <= clientWidth` – die Arbeitsseiten nutzen die volle Fensterbreite, also muss jeder Baustein auch sehr breit sinnvoll aussehen.
