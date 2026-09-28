# Spezifikation: Wiederverwendbare UI-Bausteine

Verbindlich für AP-06a, AP-06b, AP-10, AP-13e, AP-13f, AP-23, AP-24, AP-25, AP-26a, AP-26b, AP-26c und jedes Paket, das einen dieser Bausteine benutzt. Bezug: Fachkonzept 14.1, 14.3, 14.4; Technisches Konzept 11.1–11.3.
**Warum diese Datei:** Mehrere Pakete liefern Bausteine, und viele weitere benutzen sie. Zuständig ist je Baustein: `FilterChip`, `ProgressBar`, `CoordinateInput`, `RigSelect`, `StatusBadge`, `CheckList`, `ConfirmDialog` → **AP-06a** (Rahmen und Grundbausteine) · `NightTimeline` → **AP-13e**, `EffortChip` → **AP-13e** · `SeasonChart` → **AP-10** · `WeatherChart` → **AP-23** · `DataTable` → **AP-26a** · `Tabs` → **AP-26b** · `FilterBar` → **AP-26c** · `PageHeader`, `ActionMenu` → **AP-26d**. Ohne gemeinsamen Vertrag legt das erste Paket das Verhalten für alle fest, und die Nacht-Zeitleiste sieht im Simulator anders aus als im Projekt-Editor (UI-3).

## 1. Allgemeine Regeln (gelten für jeden Baustein)

- **Ort:** `apps/web/src/components/<Name>/` mit `index.tsx`, `<Name>.module.css`, `<Name>.test.tsx`. Keine Geschäftslogik im Baustein – Daten kommen ausschließlich über Eigenschaften.
- **Keine Rechteprüfung:** Ein Baustein kennt `can()` nicht. Die Seite entscheidet und übergibt `disabled` bzw. lässt Aktionen weg (`rules/ui.md`).
- **Vier Zustände, soweit der Vertrag des Bausteins sie nennt** (§2; rein darstellende Bausteine wie `FilterChip` und `StatusBadge` haben nur `ready`): `loading` (Skelett in Tokenfarben, keine Spinner-Zentrierung mit Sprung), `empty` (kurzer Satz + optional eine Aktion), `error` (Meldung aus `errors.*`-i18n + *Erneut versuchen*, wenn der Aufrufer `onRetry` gibt), `ready`. Jeder Baustein nimmt `state?: 'loading' | 'empty' | 'error' | 'ready'` oder leitet es aus den Daten ab; der Vertrag steht je Baustein unten.
- **Größen:** Jeder Baustein nennt eine **Mindestbreite**. Unterhalb davon wird nicht umgebrochen, sondern der Inhalt reduziert (Spalten weg, Kurzform, Tooltip) – niemals horizontal gescrollt (NFA-01: Arbeitsseiten ab 768 px).
- **Abstände und Farben** nur über Tokens (`--npm-space-*`, `--npm-*`); keine freien px-Werte außer den hier genannten Mindest-/Höchstgrößen.
- **Themes:** Jeder Baustein funktioniert in `light` und `dark` (es gibt **keinen** Rotlicht-Modus); der Theme-Test (TK 11.3) prüft die berechneten Farben je Baustein automatisch gegen die Tokens.
- **Dichte:** Jeder Baustein liest Zeilenhöhe, Schriftskalierung, Abstandsfaktor und Diagrammhöhe aus den Dichte-Tokens (`--npm-row-h`, `--npm-font-scale`, `--npm-space-scale`, TK 11.3) – **keine** eigene Logik für die Dichtestufe. Eine `size`-Eigenschaft steuert nur den Einsatzort (Tabelle vs. Karte).
- **Breite:** Bausteine wachsen mit ihrem Container (`width: 100%`), weil die Arbeitsseiten die volle Fensterbreite nutzen. Wo mehr Platz sinnvoll ist (Diagramme, Tabellen), nutzt der Baustein ihn; eine Höchstbreite setzt nur der Aufrufer.
- **Tastatur:** Jedes interaktive Element ist mit `Tab` erreichbar, hat einen sichtbaren Fokusring (2 px, Akzentfarbe, `:focus-visible`) und reagiert auf `Enter`/`Space`. Diagramme sind mit `Tab` fokussierbar und mit `←`/`→` schrittweise abtastbar; der Fokuswert wird per `aria-live="polite"` als Text ausgegeben (das ist die Barrierefreiheits-Lösung für Canvas).
- **Canvas-Bausteine** (Nacht-Zeitleiste, Saisondiagramm, Astro-Wetter) zeichnen mit `devicePixelRatio`, erneuern bei `ResizeObserver`, rendern **ohne** eigene Datenabfrage und bieten immer eine Textalternative (`<table>` hinter `<details>` mit denselben Werten – erfüllt WCAG und dient gleichzeitig dem Komponententest).
- **Symbole:** Lucide, Strichstärke 2, 16 px in Tabellen, 20 px in Knöpfen, 24 px in der Navigation. Kein Emoji.
- **Tests je Baustein (Pflicht):** Zustände leer/laden/Fehler · Tastaturpfad · `vitest-axe` ohne *serious*/*critical* · Theme-Test für **beide** Themes · Dichte-Test für `compact`/`normal`/`wide` · Breitentest bei Mindestbreite und bei 2400 px · Grenzfall aus der Tabelle unten.

## 2. Die zehn Bausteine

### 2.1 `FilterChip`

| | |
|---|---|
| Zweck | Filter als Farbmarke mit Kurznamen (Projektkarte, Editor, Simulator, Protokoll, Filterliste) |
| Eigenschaften | `shortName: string` · `color: string` (Hex aus `filter.color`) · `size?: 'sm' \| 'md'` (16/20 px Höhe) · `selected?: boolean` · `disabled?: boolean` · `onToggle?: () => void` · `title?: string` |
| Zustände | nur `ready`; ohne `onToggle` ist es ein `<span>`, mit `onToggle` ein `<button aria-pressed>` |
| Größen | **Alle Marken gleich breit** (AP-26k, Wunsch Sven 26.09.2026): Mindestbreite `3,3em + 2 × space-2 + Rand` – Platz für vier breite Großbuchstaben (`sm` 53 px, `md` 60 px bei normaler Dichte); nur ein ungewöhnlich breites Kürzel wird breiter. Kurznamen über 4 Zeichen werden auf 4 gekürzt und der volle Name steht im `title` |
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
| Eigenschaften | `window: {startUtc, endUtc}` (Mittag–Mittag) · `twilight: {civil, nautical, astronomical}` je Rand · `sun?: {atUtc, altDeg}[]` (Sonnenhöhe für die Himmelsfarbe; fehlt sie, wird der Himmel aus `twilight` gestuft) · `series?: AltitudeSeries[]` (Höhenkurven je Ziel, `{id, label, color, points: [{atUtc, altDeg}]}`; `color` als CSS-Farbe oder Token `var(--npm-chart-…)`; die **erste** Reihe ist das Hauptziel der Stundenstreifen) · `moon?: {points, illuminationPct, riseUtc, setUtc}` · `recommended?: {fromUtc, toUtc}[]` (nutzbare Zeit des Hauptziels aus der Engine: Dämmerung, Mindesthöhe, Mondprofil) · `blocks?: TimelineBlock[]` (`{id, fromUtc, toUtc, label, kind: 'regular' \| 'transit' \| 'flat' \| 'idle', color?, actual?: boolean}`) · `filterBars?: {fromUtc, toUtc, color, label}[]` (Filterbalken über den Blöcken in Filterfarben, FA-SIM-07; AP-13f) · `markers?: {atUtc, kind: 'flip' \| 'transit' \| 'now' \| 'custom', label}[]` · `minAltDeg?: number` (gestrichelte Linie) · `timeZone: string` (Anzeige in Standortzeit, IANA) · `secondaryTimeZone?: string \| null` (zweite, gedämpfte Beschriftungszeile; Standard seit AP-26e die Zeitzone des Geräts, nur wenn sie im Fenster eine andere Uhrzeit zeigt; `null` schaltet sie ab; NT-03) · `height?: number` · `onSelect?: (atUtc) => void` · `cursorUtc?: number \| null`, `onCursorChange?: (atUtc) => void` (gesteuerte Uhrzeit; Klick und Ziehen ins Diagramm, ←/→) · `variant?: 'night' \| 'plan'` · `bands?: boolean` (Standard an) · `crop?: boolean` (Standard an) · `facts?: boolean` · `legend?: 'top' \| 'side' \| 'none'` (Standard `top`) · `filterBars[].count?` (Anzahl der Belichtungen) · `highlightBlockIds?` (Plangrafik: hervorgehobene Blöcke, z. B. des gewählten Ziels im Simulator, AP-26g; sonst der Block unter der Uhrzeit) |
| Zustände | `window` fehlt → `error`; keine `series` und keine `blocks` → `empty` („keine Nacht mit Dunkelheit“, der Fall Polartag ist damit abgedeckt) |
| Darstellung | **Stil des Beobachtungsplaners (AP-26e, Entscheidung Sven 26.09.2026):** das Diagramm liegt in einem dunklen Rahmen (`chart-frame`, in beiden Themes), Achsen innerhalb; **Ausschnitt** (`crop`) eine Stunde vor Sonnenuntergang (−0,833°) bis eine Stunde nach Sonnenaufgang, auf volle Standortstunden, ohne Unter-/Aufgang das ganze Fenster; `SKY_STOPS` = `CHART_SKY` des Planers, **astronomisch dunkel grün** (`chart-sky-dark`) mit gepunkteten Grenzlinien (`chart-dark-edge`); Raster 60° und alle 2 h (bzw. so, dass Beschriftungen ≥ 90 px auseinander liegen), Mindesthöhe (sonst 30°) weiß gestrichelt; **Mond als rote Fläche mit Deckkraft 0,18 + 0,4 × Beleuchtung**, „Mond n %“ oben rechts; **Meridian** violett gestrichelt mit Kasten „Meridian 01:16“ bzw. „Meridian-Flip 01:16“; **beste Zeit** als Punkt (höchster Stand in astronomischer, sonst nautischer Dunkelheit, sonst im Fenster); **Uhrzeit** (Marke `now` bzw. `cursorUtc`) als rote Linie mit Kasten „Uhrzeit 03:40 (10:40)“, die Klammer in der zweiten Zone. `facts`: Kennwerte rechts neben dem Diagramm (Höhe zur Uhrzeit, höchster Stand, Mond, Zeit über Mindesthöhe), bei schmalem Container darunter. **Plangrafik** (`variant: 'plan'`, Simulator FA-SIM-07 nach Svens Screenshot): Blöcke als halbtransparente Flächen in Zielfarbe über die volle Höhe mit Namen, der Block unter der Uhrzeit kräftiger mit 2-px-Rand; Filterleiste über dem Diagramm mit „R ×10“ (Textfarbe nach Helligkeit des Filters); Dämmerung ausgeschrieben am Fuß (abends rechts, morgens links der Linie); „Mond“ am höchsten Punkt; Nacht dunkel statt grün; keine Stundenstreifen. Die folgende Beschreibung gilt weiter, soweit sie dem nicht widerspricht. **Himmel nach Sonnenhöhe** (Entscheidung 24.09.2026, Vorbild Svens Screenshot): Farbverlauf golden → blau → dunkel aus `SKY_STOPS` (`@nina-pm/ui-tokens`), **in beiden Themes gleich** – das Diagramm zeigt den Himmel; Achsen, Beschriftung und Legende außerhalb folgen dem Theme. Dämmerungswechsel als feine senkrechte Linie mit Kürzel am Fuß (B/N/A bzw. C/N/A); Raster 0/30/60/90° und volle Stunden. Höhenkurven als Linien (Hauptziel hell), **Mond als rote Fläche mit Linie**, Beleuchtung „Mond n %“ oben rechts (Text, kein Symbolzeichen), Mindesthöhe rot gestrichelt. **Stundenstreifen** unter dem Diagramm, je Zeile eine Farbe: *Empfohlene Belichtungszeit* (`recommended`), *über Mindesthöhe ohne Mond*, *mit Mond*, *über Mindesthöhe* (jeweils nur in astronomischer Dunkelheit, Mond ≤ 0° = ohne Mond) und *astronomisch dunkel* (Sonne ≤ −18°); gerastert auf 5 min, nur Anzeige. **Legende** rechts (bei schmalem Container darunter; mit `legend: 'top'` als kompakte, umbrechende Zeile über dem Diagramm, Projekt-Editor AP-26d) als `fieldset` mit Checkbox je Ebene (Ziele, Mond, Mindesthöhe, Streifen) und der Stundensumme je Streifen; Ausblenden ändert nur die Zeichnung. Blöcke als Balken unten (Ist-Balken schmaler und unter dem Soll-Balken, wenn `actual`), Blöcke als Balken unten (Ist-Balken schmaler und unter dem Soll-Balken, wenn `actual`), Marken als senkrechte Linien mit Kürzel. **Zeitachse (NT-03):** Stundenbeschriftung in `timeZone`, am Achsenende das Zonenkürzel aus `formatTzAbbr` (`rules/ui.md`, z. B. „CDT“); mit `secondaryTimeZone` eine zweite, gedämpfte Zeile mit eigenem Kürzel. Jede Beschriftung wird je Zeitpunkt über `Intl` aus dem UTC-Wert berechnet – **nie** über einen festen Versatz zwischen den Zonen. Tooltips und Marken zeigen Uhrzeit **mit** Kürzel (`21:08 CDT`); die Kürzel stehen am rechten Ende jeder Achsenzeile |
| Größen | Mindestbreite **320 px**, Mindesthöhe 120 px; Standardhöhe 180 px (Editor) bzw. 240 px (Simulator). Unter 480 px entfallen die Stundenbeschriftungen bis auf jede dritte |
| Grenzfälle | (1) **keine Dunkelheit** (Mitternachtssonne) → nur Dämmerungsstreifen, Hinweistext im Diagramm; (2) **durchgehende Dunkelheit** (Polarnacht) → kein Dämmerungsstreifen; (3) **Zeitumstellung in der Nacht** → die Achse folgt der Standortzeit und enthält 23 bzw. 25 Stunden, die Beschriftung springt sichtbar, das Kürzel wechselt an der Sprungstelle (z. B. „CDT“ → „CST“, Chicago 31.10./01.11.2026: 25 h); (3a) **nur eine der beiden Zonen stellt um** → die zweite Zeile verschiebt sich innerhalb der Nacht gegen die erste (Beispiel Standort `America/Chicago`, `secondaryTimeZone` `Europe/Berlin`, Nacht 24./25.10.2026: Berlin stellt um 01:00 UTC von MESZ auf MEZ um, Chicago erst am 01.11. – Abstand 7 h → 6 h, 19:30 CDT = 02:30 MESZ, 20:30 CDT = 02:30 MEZ); beide Zeilen tragen ihr jeweils gültiges Kürzel; (4) mehr als 12 `series` → nur die ersten 12 werden gezeichnet, der Rest als „+n weitere“ in der Legende |
| Textalternative | `<details>`-Tabelle mit Dämmerungszeiten, je Ziel Auf-/Untergang und Kulmination, je Stundenstreifen Summe und Zeiträume, je Block Von/Bis/Label – alle Zeiten mit Kürzel |

### 2.4 `SeasonChart` (Saison-/Monatsdiagramm)

| | |
|---|---|
| Einsatz | Projekt-Editor, Objektbrowser |
| Eigenschaften | `months: {month: string, usableHours: number, moonPct: number, usable: boolean}[]` · `range: '1m' \| '3m' \| '6m' \| '1y'` · `seasonStart?: string` · `seasonEnd?: string` · `minTimeH?: number` |
| Zustände | leeres `months` → `empty`; `ready` sonst |
| Darstellung | Balken je Nacht bzw. Woche (je `range`), Mindestzeit als waagerechte Linie, Saisonende als senkrechte Marke mit Datum |
| Größen | Mindestbreite 280 px, Höhe 120 px |
| Grenzfall | **zirkumpolar** (kein Saisonende) → keine Marke, Fußnote „ganzjährig“; **außerhalb der Saison** → Saisonbeginn als zweite Marke, Bereich davor gedämpft |
| Umsetzung (AP-24) | `months[]` ist je **Balken** ein Eintrag (1 Monat: Nacht, sonst Woche); `month` = erste Nacht, `usableHours` = nutzbare Stunden **je Nacht** (Mittel), `moonPct` = Anteil mit Mond über dem Horizont; zusätzlich optional `nights`, `peakAltDeg` (höchste Zielhöhe, rechte Achse), `today`, `status` (`never` → Hinweis) und `state`. Die Stunden je Filter-Stufe (FA-SIC-02) sind noch nicht enthalten |

### 2.5 `WeatherChart` (Astro-Wetter-Grafik)

Der Baustein zeichnet ausschließlich, was die Engine schon gerechnet hat. **Er bewertet nichts** – Formeln, Klassen, Nachtmittel und bestes Fenster stehen in `engine/weather.md`. Alles in diesem Vertrag ist reine Anzeige (WS-17): es verändert keinen Score, geht in keinen `outputHash` ein und ist deshalb hier und nicht in der Engine-Spezifikation festgelegt. Wertebereich aller Scores ist **0…1** (`engine/weather.md` §2).

| | |
|---|---|
| Einsatz | Wetter, Standort, Projekt, Heute Nacht |
| Eigenschaften | `hours: WeatherHourly[]` (je Stunde die Felder aus `engine/weather.md` §3.4 `payload.hours[]`: Rohwerte nach §1.1, `jetKmh`, `shearKmh`, `moonAltDeg` (geometrische topozentrische Mondhöhe zum Stundenmittelpunkt `tUnix + 1800`, `engine/weather.md` §3.3 – nur die Grundlage von `moonFreeSec`, **nicht** die Planungs-Mondhöhe aus `engine/moon.md`), `modelId`, `cloudSrc`, `nest`, `aerosolMissing`, `seeingIncomplete`, `cloudScore`, `seeingScore`, `transparencyScore`, `overallScore`, `ratingIndex`) · `nights: WeatherNight[]` (`night`, `nightMean`, `coveredSec`, `darknessSec`, `coverage`, `bestWindow`; Typ definiert in TK 8.2 und `engine/weather.md` §3.4) · `nightWindows: {startUtc, endUtc}[]` (Nachtfenster, `engine/night.md` §3 – Hintergrund und Spaltenbereich) · `darkWindows: {startUtc, endUtc}[]` (astronomische Dunkelheit, `engine/night.md` §2 – Bezug von `nightMean` und `bestWindow`) · `sunAltDeg: number[]` (je Stunde, für die Tageslicht-Abstufung) · `nowUtc: string` · `days: 7` (Vorhersagehorizont der Stundenreihe, `forecast_days=7`, TK 14) · `compact?: boolean` (Variante nur als Farbband) · `detailOnly?: boolean` (nur „Nacht im Detail“ mit ← →, ohne Wochenübersicht und Skala – Variante für „Heute Nacht“, 27.09.2026) |
| Zustände | `hours` leer → `empty` („Vorhersage nicht verfügbar“, mit Zeitstempel des letzten Abrufs, wenn vorhanden); Abruffehler → `error` mit letztem Stand als gedämpfte Darstellung |
| Größen | Mindestbreite 360 px (volle Variante) bzw. 160 px (Eigenschaft `compact` – nicht die Dichtestufe); wächst nach oben mit dem Container |
| **Farbrampe Teilbewertungen** (`cloudScore`, `seeingScore`, `transparencyScore`, `overallScore` in den Wertzeilen) | linear je Kanal von **blassem Graublau `rgb(198, 208, 220)`** bei 0 nach **gesättigtem Blau `rgb(30, 88, 190)`** bei 1: `kanal = round(schlecht + (gut − schlecht) · s)`. `null` → **`#262c34`** („keine Daten“, dieselbe Farbe wie die Lücke am Horizontende). **Tintenschwelle 0,55:** Zellentext weiß bei `s > 0,55`, sonst `#1b2633` – oberhalb 0,55 wird die Rampe für dunkle Schrift zu dunkel |
| **Ampel Gesamtnote** (Farbband und Nacht-Ø) | Stützstellen an den **oberen drei** Klassengrenzen aus `engine/weather.md` §3.1 (0,45 / 0,65 / 0,85) plus den Randwerten 0 und 1; die Grenze **0,25 hat bewusst keinen eigenen Stop** (so in der Vorlage, `weather-core.js` `RATING_STOPS`) – zwischen 0 und 0,45 läuft die Rampe also durch, ohne bei *Schlecht* zu knicken: **0 → `rgb(216, 67, 59)`** · **0,45 → `rgb(224, 123, 43)`** · **0,65 → `rgb(217, 181, 43)`** · **0,85 → `rgb(63, 174, 76)`** · **1 → `rgb(63, 174, 76)`**; dazwischen linear je Kanal. Anschließend in den neutralen Grund **`rgb(31, 37, 46)`** eingeblendet mit `k = clamp((−sunAltDeg − 12)/6, 0, 1)` – `k = 0` bei nautischer Dämmerung (−12°), `k = 1` in astronomischer Dunkelheit (−18°); das Nacht-Ø wird immer mit `k = 1` gezeichnet. `overallScore == null` oder `k = 0` → nur der neutrale Grund |
| **Skala in Worten** | Die Legende zeigt die fünf Klassen mit den Stützwerten **0,92 / 0,75 / 0,55 / 0,35 / 0,12** (`ratingIndex` 4/3/2/1/0), jeweils als Farbfleck der Teilbewertungs-Rampe plus Klassenname aus i18n `weather.rating.<n>`. Die Stützwerte sind Anzeigemittelpunkte der Klassen, **keine** Schwellen – die Schwellen sind 0,25/0,45/0,65/0,85 |
| **Windstufen** (`wind10Kmh`, Windpfeil) | ≤ 10 km/h `#3fae4c` · ≤ 20 `#8fbf2f` · ≤ 30 `#d9b52b` · ≤ 40 `#e07b2b` · > 40 `#d8433b` · `null` → `#262c34`. Der Pfeil zeigt in die Richtung, in die der Wind weht (`windDir10Deg + 180°`); die Stufe trägt zusätzlich der Zahlenwert `Wind/Böen` unter dem Pfeil, nie nur die Farbe |
| **Hilfsbewertungen (nur Zellfarbe)** | Vier Zeilen ohne jede Wirkung auf die Bewertung, gefärbt über dieselbe Teilbewertungs-Rampe: Wasserdampf `clamp(1 − (pwvMm − 10)/40, 0, 1)` · Staub `clamp(1 − dustUgM3/100, 0, 1)` · Sicht `clamp((visibilityM/1000 − 1)/19, 0, 1)` · Regenwahrscheinlichkeit `clamp(1 − precipProbPct/100, 0, 1)`. In jeder Zelle steht der **Messwert** mit Einheit (mm, µg/m³, km, %), nicht die Hilfsbewertung. `precipMm` und `precipProbPct` werden angezeigt, bewerten aber nichts (`engine/weather.md` §2, WS-E1) |
| **Taugefahr** | Aus `spread = tempC − dewPointC`: `spread ≤ 4 °C` → Zelle orange hinterlegt `rgba(224, 123, 43, .38)`, `spread ≤ 2 °C` → rot `rgba(216, 67, 59, .6)`. Der Zahlenwert steht immer dabei; in Fahrenheit wird nur die Anzeige umgerechnet, die Schwellen bleiben 4 °C / 2 °C |
| **Modellkürzel je Stunde** | Aus `modelId` (`engine/weather.md` §1.5): `d2` → „ICON-D2“ / „D2“ · `eu` → „ICON-EU“ / „EU“ · `global` → „ICON global“ / „IG“ · `dini` → „HARMONIE“ / „HA“ · `hrrr` → „HRRR“ / „HR“ · `gem` → „GEM“ / „GEM“ · `gfs` → „GFS“ / „GFS“. Die Zeile zeigt den langen Namen; reicht die Spaltenbreite nicht, das zweite Kürzel. Die Kürzel stehen im Baustein als Konstante, damit ein neuer Wert von `weatherModels` die Grafik nicht bricht: unbekannter `modelId` → der rohe Wert, kein Absturz (wie `StatusBadge`, §2.8) |
| **Kennzeichen** | `aerosolMissing` → die Stunde bzw. Nacht trägt **„ohne Aerosol – Bewertung optimistisch“**, die Transparenzzelle ist „keine Daten“ (`#262c34`); `seeingIncomplete` → **„Seeing unvollständig“**; `coverage < 1` → **„Nacht unvollständig (n %)“**; `nest` → die Modellzelle wird hervorgehoben, weil die Stunde aus dem hochauflösenden Nest kommt. Jedes Kennzeichen ist **Text** (Zeile, Tooltip und Textalternative), nie nur eine Farbe. Die Seeing- und die Transparenzzeile sind zusätzlich dauerhaft als *geschätzt* beschriftet (FA-WET-01) |
| Grenzfälle | (1) Vorhersage endet mitten im Zeitraum → der Rest wird schraffiert und mit „keine Daten“ beschriftet, **nicht** auf 0 gesetzt; (2) Nacht ohne astronomische Dunkelheit (Polartag) → kein Farbband, kein Nacht-Ø, Hinweistext „keine Dunkelheit“; (3) `bestWindow == null` → der Satz über der Grafik nennt nur das Nacht-Ø, es wird **kein** Fenster markiert; (4) `bestWindow.fair` → das Fenster wird gedämpft markiert und der Satz sagt „bestenfalls mittel“ |
| Textalternative | `<details>`-Tabelle mit einer Zeile je Stunde: Zeitpunkt mit Zonenkürzel, `modelId`, Bedeckung, die vier Scores als Prozentzahl **und** Klassenname, Wind/Böen, Temperatur/Taupunkt, Sicht, Regen, Kennzeichen als Text; darunter je Nacht `nightMean`, `coverage` und `bestWindow` |

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

### 2.8a `EffortChip` (Aufwand-Kennzeichen, AP-13e)

| | |
|---|---|
| Einsatz | S-30 Liste und Karten, S-31 Kopf (live), S-32, S-33 (FA-PRJ-23) |
| Eigenschaften | `effort: EffortView \| null` · `stale?: boolean` · `state?: 'loading' \| 'empty' \| 'error' \| 'ready'` · `size?: 'sm' \| 'md'` · `live?: boolean` · `onRetry?: () => void` |
| Verhalten | Text über `effort.*`: „1 Nacht“ (grün), „ca. n Nächte“ (blau), „nicht machbar (x %)“ (rot), „Transit · vollständig / teilweise (x %)“ (violett, Token `--npm-violet`), „fertig“ (`tag = null`); `stale` hängt „wird aktualisiert“ an. Tooltip (`title` und zugänglicher Name): Schätzungshinweis, benötigte Stunden, beste Nacht je Mondstufe, begrenzender Faktor, frühestes Ende, Zeitraum – Nächte als Doppeldatum. Fokussierbar mit Fokusring |
| Zustände | `empty` = noch nicht berechnet („Schätzung folgt“ bzw. „wird aktualisiert“), `loading` (Skelett), `error` mit *Erneut versuchen*, `ready` |
| Größen | Mindestbreite 0 (kürzt mit Auslassungszeichen), keine Umbrüche |

### 2.9 `CheckList` (Prüfliste ✓/✗)

| | |
|---|---|
| Einsatz | Zielkarten im Simulator, Einreichen-Dialog |
| Eigenschaften | `items: {id, label, ok: boolean \| null, detail?: string}[]` (`null` = nicht geprüft) · `compact?: boolean` |
| Darstellung | Lucide `check`/`x`/`minus` in Grün/Rot/Grau; die Unterscheidung trägt **immer** auch die Symbolform, nicht nur die Farbe (Rot-Grün-Sehschwäche, Testfall) |
| Zustände | `items` leer → `empty` |
| Grenzfall | mehr als 8 Einträge und `compact` → „n von m erfüllt“ mit Aufklappen |

### 2.10 `ConfirmDialog` (Bestätigungsdialog)

Schutz gegen Versehen (Entscheidung E4 vom 21.09.2026): **Pflicht** vor jeder folgenreichen Aktion; `window.confirm` ist verboten (`rules/ui.md`).

| | |
|---|---|
| Einsatz | Löschen (Projekt, Panel, Zeile, Stammdaten, Mandant), Rechte entziehen (Admin → User, Mitglied deaktivieren/entfernen), Owner übertragen, Ablehnen (Einreichung, Änderungsantrag), NINA-Token widerrufen, Sitzungen beenden |
| Eigenschaften | `open: boolean` · `title: string` (Frage mit Objektname, z. B. „Projekt *NGC 7380* löschen?“) · `consequence: string` (Folgen in **einem** Satz, z. B. „Das Projekt wird in den Papierkorb verschoben und kann von Admins wiederhergestellt werden.“) · `confirmLabel: string` (**Verb**, z. B. „Löschen“, „Übertragen“, „Widerrufen“ – nie „OK“/„Ja“) · `variant?: 'default' \| 'danger'` · `confirmName?: string` (Variante *Namenseingabe*) · `state?: 'ready' \| 'loading' \| 'error'` · `errorKey?: string` (`errors.*`-i18n-Schlüssel) · `onConfirm: () => void \| Promise<void>` · `onCancel: () => void` |
| Varianten | **`default`** – neutraler Aktionsknopf (z. B. Owner übertragen, Sitzungen beenden). **`danger`** („gefährlich“) – Aktionsknopf in der Gefahrenfarbe der Tokens, Symbol `triangle-alert` vor dem Titel (Löschen, Rechte entziehen, Ablehnen, Token widerrufen). **Namenseingabe** (`confirmName` gesetzt, immer mit `danger`) – **nur** beim Löschen eines Mandanten (S-80, FA-MAN-03): Eingabefeld „Zum Bestätigen `<tenant_key>` eingeben“; der Aktionsknopf bleibt gesperrt, bis die Eingabe nach Entfernen führender/folgender Leerzeichen **exakt** `confirmName` entspricht (Groß-/Kleinschreibung zählt; Einfügen erlaubt) |
| Zustände | `ready`; `loading` – Aktion läuft: beide Knöpfe gesperrt, Aktionsknopf mit Fortschrittssymbol, `onConfirm` wird **genau einmal** ausgelöst; `error` – Meldung aus `errorKey` im Dialog, Dialog bleibt offen, Aktionsknopf wieder aktiv (z. B. `412 resource.version_conflict`, `409 member.owner_protected`). Kein `empty` |
| Tastatur | Radix `AlertDialog` mit Fokusfalle. Beim Öffnen liegt der Fokus auf **Abbrechen** (bei Namenseingabe auf dem Eingabefeld); `Esc` = Abbrechen; `Enter` löst nur den fokussierten Knopf aus bzw. im Namensfeld nur bei Übereinstimmung; Klick außerhalb schließt **nicht**; nach dem Schließen kehrt der Fokus zum auslösenden Element zurück |
| Größen | Breite 360–520 px (Ausnahme von der Breitenregel in §1: Dialoge wachsen nicht mit dem Fenster); Knöpfe mindestens 96 px breit und so hoch wie `--npm-row-h`; Reihenfolge rechts unten: *Abbrechen*, dann Aktionsknopf; lange Objektnamen im Titel werden nach 60 Zeichen mit „…“ gekürzt, der volle Name steht im `title` |
| Textalternative | `role="alertdialog"`, `aria-labelledby` = Titel, `aria-describedby` = Folgesatz; die Gefahr trägt immer auch der Text (Verb im Knopf, Symbol), nie nur die Farbe; Fehlermeldung per `aria-live="assertive"` |
| Grenzfall | Doppelklick oder `Enter`-Wiederholung auf dem Aktionsknopf → nur ein Aufruf; Dialog wird während `loading` per `Esc` **nicht** geschlossen; falsche Namenseingabe → Knopf gesperrt, kein Fehlertext vor dem ersten Verlassen des Felds |

Die Ansicht *Gelöscht* (Papierkorb für Projekte, Admin/Owner, Aktion *Wiederherstellen* ohne Dialog, weil sie nichts zerstört) ist kein eigener Baustein, sondern ein Filter der Projektliste (Fachkonzept S-30): seit AP-26c der Umschalter *Papierkorb* (`FilterToggle`, `aria-pressed`) in der `FilterBar` (§2.13) statt eines Reiters.

### 2.11 `DataTable` (Datentabelle, AP-26a)

Jede Datentabelle der Oberfläche (Entscheidung Sven, 26.09.2026). Ausgenommen sind nur die Textalternativen der Diagramme (§1 *Canvas-Bausteine*) und reine Formularraster ohne Datenzeilen, z. B. die Gain-Modi einer Kamera.

| | |
|---|---|
| Eigenschaften | `columns: DataColumn<T>[]` · `rows: T[]` · `rowKey(row)` · `label: string` (zugänglicher Name) · `rowLabel?(row)` (Kurzname für den Detailknopf) · `sort?`/`onSortChange?` (gesteuert, z. B. URL-Zustand) · `defaultSort?` · `serverSorted?` (Zeilen kommen sortiert, der Baustein sortiert nicht selbst) · `groups?: {key(row), header(key, rows)}` · `rowProps?(row)` (z. B. `aria-selected`, Ziehen) · `state?: 'loading' \| 'error' \| 'ready'` · `empty?` · `error?` · `renderDetail?(row)` (eigener Inhalt der Detailzeile, z. B. Nachtdiagramm im Objektbrowser, AP-26e: der Detailknopf steht dann immer, der Inhalt unter den ausgeblendeten Spalten). Spalte: `id` · `header` · `cell(row)` · `sortValue?(row)` (clientseitig sortierbar) oder `sortable?` (serverseitig) · `priority?` (1 = nie ausblenden, Standard) · `align?: 'start' \| 'end'` · `nowrap?` · `headerHidden?` (Kopf nur für Screenreader, z. B. Bild- oder Aktionsspalte) |
| Sortierung | Klick auf den Spaltenkopf: aufsteigend → absteigend → aus (Ausgangsreihenfolge der Seite). Stabil; leere Werte (`null`, `''`) **immer** zuletzt, auch absteigend; Zeichenketten natürlich (`Intl.Collator`, `numeric`: „M 31“ vor „M 101“) in der Sprache der Oberfläche. Bei Gruppen wird innerhalb jeder Gruppe sortiert, die Gruppen behalten ihre Reihenfolge. **Bearbeitbare Tabellen mit fachlicher Reihenfolge** (Belichtungsplan, Panels, Belichtungsvorlage, Filterrad: NINA-Reihenfolge) geben kein `sortValue` an |
| Spalten ausblenden | Ist die Tabelle breiter als ihr Container, blendet der Baustein vor dem Zeichnen so lange die Spalte mit der **höchsten** `priority` aus (bei Gleichstand die rechte zuerst), bis sie passt; Spalten mit Priorität 1 nie. Sobald eine Spalte fehlt, erscheint vorn eine Spalte mit Detailknopf (`chevron-right`/`chevron-down`, `aria-expanded`, Name „Weitere Angaben zu *rowLabel*“); die Detailzeile zeigt die ausgeblendeten Spalten als Liste *Kopf: Wert* – dieselben Zellen, also auch Eingabefelder. Neue Containerbreite (ResizeObserver), andere Zeilen- oder Spaltenzahl → neu berechnen. **Nie horizontal scrollen** (`overflow-x: clip`) |
| Zustände | `loading` (Skelett, `role="status"`), `empty` (Standard „Keine Einträge.“ oder `empty`), `error` (`error`, z. B. `ProblemMessage` mit *Erneut versuchen*), `ready` |
| Tastatur | Sortierbare Köpfe sind Knöpfe (`Tab`, `Enter`/`Space`), `title` „Sortieren nach *Kopf*“; Detailknopf je Zeile ebenso; die Zellen behalten ihre eigenen Bedienelemente |
| Größen | Mindestbreite = Summe der Spalten mit Priorität 1; volle Containerbreite; stehender Kopf (`position: sticky`); Zeilenhöhe `--npm-row-h`; Zahlen rechtsbündig (`align: 'end'`) |
| Textalternative | Die Tabelle selbst: `aria-label` = `label`, `aria-sort` an sortierbaren Köpfen (`none`/`ascending`/`descending`), Gruppenköpfe als `<th scope="colgroup">`, Detailzeile als `<dl>` |
| Grenzfall | alle Werte einer Spalte leer · gleiche Werte (stabile Reihenfolge) · so schmal, dass nur Priorität 1 bleibt · Gruppe nach Filterung leer (entfällt) · gesteuerte Sortierung auf eine nicht mehr vorhandene Spalte (unsortiert) |

### 2.12 `Tabs` (Reiter, AP-26b)

Jede Reiterleiste innerhalb einer Seite (Bereiche des Projekt-Editors, Rig-Bereiche, Simulator-Ergebnis, Mitglieder/Einladungen, Kamera, Filter). Ausgenommen sind die Bereichsnavigation zwischen Seiten (`SectionTabs`, Links statt Reiter).

| | |
|---|---|
| Eigenschaften | `tabs: {key, label, badge?, title?}[]` · `value` · `onChange(key)` · `label: string` (zugänglicher Name der Leiste) · `panels: Record<key, ReactNode>` · `keepMounted?` (verdeckte Reiter bleiben mit `hidden` im DOM – Pflicht, wenn Formularfelder über Reiter verteilt sind) · `toolbar?` (Werkzeuge rechts in der Leiste, z. B. Nachtwahl, *Kopieren*) · `orientation?: 'horizontal' \| 'vertical'` (senkrecht für Unterreiter) · `panelClassName?` (z. B. Höchsthöhe mit eigener Scrollfläche) |
| Zustände | `ready`; Lade-, Leer- und Fehlerzustand liefert der Inhalt des Reiters. Ein Reiter mit Fehlern trägt ein Kennzeichen (`badge`, Text, nicht nur Farbe); beim Speichern mit Fehlern in einem verdeckten Reiter wechselt die Seite dorthin |
| Tastatur | WAI-ARIA *Tabs* mit automatischer Aktivierung: nur der aktive Reiter ist per `Tab` erreichbar (`tabindex` wandert mit), `←`/`→` (senkrecht `↑`/`↓`) wechseln und aktivieren, `Pos1`/`Ende` springen; danach folgen die Werkzeuge, dann der Inhalt (`tabpanel`, fokussierbar) |
| Größen | Leiste so breit wie der Container; passen die Reiter nicht, scrollt nur die Leiste waagerecht, nie die Seite. Senkrechte Leiste 11rem breit |
| Textalternative | `role="tablist"` mit `aria-label`, `aria-orientation`; Reiter `role="tab"` mit `aria-selected`, `aria-controls`; Inhalt `role="tabpanel"` mit `aria-labelledby` |
| Grenzfall | Reiter verschwindet (Panel gelöscht, Recht fehlt) → die Seite fällt auf den ersten Reiter zurück · `keepMounted` mit Fehlern in einem verdeckten Feld · ein einziger Reiter (Leiste bleibt, damit die Bereichsbezeichnung sichtbar ist) |

### 2.13 `FilterBar` (Filterleiste, AP-26c)

Jede Filterleiste über einer Liste (Projektliste, Warteschlange, Objektbrowser; Entscheidung Sven, 26.09.2026): **eine** Zeile `[Suche] [Filter in der Zeile] [aktive Filter als Chips „Rig: Rig A ×“] [+ Filter ▾] [Umschalter] … [Trefferzahl] [Ansicht]`, alle übrigen Filter in einem aufklappbaren Bereich unter der Zeile. Rig und Nacht des Objektbrowsers sind Bezug der Nachtwerte, kein Filter, und stehen darüber.

| | |
|---|---|
| Eigenschaften | `label: string` (zugänglicher Name, `role="group"`) · `search?: {value, onChange, label, placeholder?, onSubmit?, maxLength?}` (Beschriftung nur für Screenreader; `onSubmit` bei `Enter`) · `inline?` (wichtigste Filter als kleine Auswahllisten direkt in der Zeile, z. B. Objekttyp und Katalog im Objektbrowser – sie brauchen keinen Chip, die Auswahl zeigt den Wert) · `chips?: {id, label, onRemove}[]` (aktive Filter aus dem Bereich; `label` als „*Filter*: *Wert*“ über `filterBar.chip`, Ja/Nein-Filter nur mit ihrem Namen) · `panel?` (übrige Filterfelder; ohne `panel` kein Knopf) · `panelLabel?` (Standard „Filter“, im Objektbrowser „Weitere Filter“) · `extra?` (Umschalter, z. B. `FilterToggle` *Papierkorb*) · `count?` (Trefferzahl, `role="status"`) · `view?` (Ansichtsumschalter rechts) · `onReset?` (*Alle zurücksetzen* im Bereich) · `defaultOpen?`. Hilfsbausteine `FilterToggle` (`aria-pressed`), `FilterField` (beschriftetes Feld im Bereich), `FilterCheck` (Kontrollkästchen). Zustand der Filter hält die Seite (Objektbrowser: URL) |
| Zustände | `ready`; Bereich zu (nur Chips) oder auf (Raster der Felder + *Alle zurücksetzen*). Lade- und Fehlerzustand liefert die Liste darunter; die Trefferzahl fehlt, solange nichts geladen ist |
| Tastatur | Suche, Zeilenfilter, Chip-×, Knopf, Umschalter, Ansicht in Lesereihenfolge per `Tab`. Knopf *Filter* mit `aria-expanded`/`aria-controls`; Aufklappen setzt den Fokus auf das erste Feld des Bereichs, `Esc` im Bereich schließt ihn und gibt den Fokus an den Knopf zurück. × eines Chips entfernt den Filter; der Fokus geht auf den Chip an derselben Stelle, sonst den vorigen, nach dem letzten auf den Knopf |
| Größen | Volle Containerbreite; die Zeile bricht bei wenig Platz um (Suche 10–28rem, flexibel), nie horizontal scrollen; Trefferzahl und Ansicht rechtsbündig (`margin-left: auto`). Bereich als Raster `minmax(12rem, 1fr)`. Chip höchstens 20rem, längerer Text mit „…“ und vollem Text im `title`. Zeilenhöhe `--npm-row-h` |
| Textalternative | Leiste `role="group"` mit `aria-label`; Chips als Liste „Aktive Filter“; × ist ein Knopf mit Namen „Filter *label* entfernen“; Bereich `role="group"` mit dem Namen des Knopfs; Umschalter mit `aria-pressed` und Text (Symbol nur zusätzlich) |
| Grenzfall | kein aktiver Filter (keine Chip-Liste) · Filterwert, den es nicht mehr gibt (unbekanntes Rig → „Unbekanntes Rig“, der Chip bleibt entfernbar) · sehr langer Wert (gekürzt, `title`) · Umschalter wechselt die Liste (Papierkorb: Suche, Filter und Ansicht entfallen, der Fokus bleibt auf dem Umschalter) · 768 px mit allen Filtern aktiv (Zeile bricht um) |

### 2.14 `PageHeader` (Seitengerüst, AP-26d)

Kopf jeder Arbeitsseite. Titel und Hauptaktion stehen auf allen Seiten an derselben Stelle.

| | |
|---|---|
| Eigenschaften | `title` · `meta?` (Zeile unter dem Titel: Kennzeichen, Mandant/Datum, Rig, Fortschritt) · `actions?` (Knöpfe rechts, Hauptaktion zuletzt) · `crumbs?: {label, to?}[]` (nur Detailseiten) · `nav?` (Bereichsreiter, z. B. `SectionTabs`, **unter** dem Titel) · `titleHint?` (`title`-Attribut bei gekürztem Titel) |
| Zustände | `ready`; Lade- und Fehlerzustände liefert die Seite darunter |
| Tastatur | keine eigene Bedienung; Reihenfolge Brotkrumen → Aktionen → Reiter |
| Größen | Titel 24 px, einzeilig mit „…“; unter 1024 px rücken die Aktionen unter den Titel |
| Textalternative | Titel ist die einzige `h1` der Seite; Brotkrumen als `nav` mit dem Namen „Brotkrumen“ |
| Grenzfall | sehr langer Projektname (Kürzung mit `titleHint`) · keine Aktionen (Nur-Lese-Rechte) · Seite ohne Bereichsreiter |

### 2.15 `ActionMenu` (⋯-Menü, AP-26d)

Seltene oder folgenreiche Aktionen, z. B. *Löschen* im Seitenkopf oder Zeilenaktionen in Tabellen. Die Bestätigung (`ConfirmDialog`) bleibt beim Aufrufer.

| | |
|---|---|
| Eigenschaften | `label` (zugänglicher Name, z. B. „Weitere Aktionen zu M 31“) · `items: {key, label, icon?, onSelect, danger?, disabled?}[]` · `size?: 'sm' \| 'md'` (`sm` in Tabellen, ohne Rahmen) |
| Zustände | ohne Einträge kein Knopf; deaktivierte Einträge bleiben sichtbar |
| Tastatur | Radix-Menü: `Enter`/`Space` öffnet, Pfeile wählen, `Esc` schließt, Fokus zurück auf den Knopf |
| Größen | Knopf in Steuerhöhe (28 px in Tabellen), Menü mindestens 180 px |
| Textalternative | Knopf mit `aria-label`, Einträge als `menuitem`; Gefahr trägt der Text, die Farbe nur zusätzlich |
| Grenzfall | ein einziger Eintrag · alle Einträge deaktiviert · Menü am rechten Fensterrand (öffnet nach links) |

### 2.16 `ThumbPreview` (Vorschaubild mit großer Fassung, AP-26h)

Kleines Vorschaubild in Listen und Tabellen (Projektliste, Meine Objekte, Warteschlange, Entwürfe, Objektbrowser). Wunsch Sven vom 26.09.2026.

| | |
|---|---|
| Eigenschaften | `children` (das kleine Bild, 40 px in Projektlisten, 48 px im Objektbrowser) · `preview: () => ReactNode` (das große Bild, 320 px; wird erst beim Überfahren erzeugt und geladen) |
| Verhalten | Beim Überfahren mit der Maus erscheint die große Fassung rechts neben dem kleinen Bild. Reicht der Platz rechts nicht, erscheint sie links davon; senkrecht steht sie mittig und bleibt im Fenster. Sie liegt als Portal mit fester Position über der Seite, damit `DataTable` (`overflow-x: clip`) sie nicht abschneidet; `pointer-events: none`. Verlassen entfernt sie |
| Zugänglichkeit | Nur Zusatz fürs Auge: die große Fassung ist `aria-hidden`, der Alternativtext steht am kleinen Bild, die Zeile bleibt der Link. Kein zusätzlicher Tab-Halt |
| Größen | Projektlisten: Spalte mit Priorität 1 (nie ausblenden), ohne Bild ein Platzhalter gleicher Größe |

### 2.17 `MoonDarkness` (Mond und Dunkelheit, Planung)

Kopf und Nachtstreifen einer Nacht in Objektbrowser (S-21) und Sternkarte (S-20), nach dem Beobachtungsplaner (`drawNightStrip`, legacy/…/observing-planner.js). Wunsch Sven vom 27.09.2026.

| | |
|---|---|
| Eigenschaften | `data` (aus `moonDarkness()`: Fenster, Stichproben alle 5 min mit Sonnen- und Mondhöhe, Sonnenunter-/-aufgang, Grenzen bürgerlich/nautisch/astronomisch, Mondauf-/-untergang, höchster Mondstand, Phase um Mitternacht der Nacht) · `night` · `timeZone` (Standort) · `southern` (Mondsymbol spiegeln) · `nowUtc` (Kennzeichen „jetzt“, nur in der laufenden Nacht) · `cursorUtc` + `onCursorChange` (rote Linie „eingestellte Uhrzeit“, Klick stellt die Uhrzeit auf 5 min – Sternkarte) |
| Darstellung | Kopf: `MoonIcon`, aufklappbarer Titel „Mond und Dunkelheit“, Zeile „Phase · n % beleuchtet · x Tage nach Neumond“. Streifen auf dem dunklen Diagrammrahmen (`chart-frame`, themen-unabhängig): Himmel nach Sonnenhöhe (`SKY_STOPS`), unter −18° `chart-sky-dark`, Mondhöhe als gelbe Linie (`chart-moon-line`) mit Fläche (Deckkraft 0,12 + 0,3 · Beleuchtung), Beschriftung des höchsten Stands, Maßlinie „x h y min astronomisch dunkel“, Kennzeichen oben in bis zu drei Zeilen (was nicht passt, entfällt): Sonne und Mond als gezeichnete Formen mit Pfeil (kein Emoji), bürg./naut./astr. gestrichelt, „jetzt“; Stundenzeilen „Standort“ und – nur wenn abweichend – „bei dir“. Legende und Fußnote darunter |
| Zeiten | Standortzeit (NT-03); die Nacht und ihre Grenzen aus der Zeitzonentabelle des Servers, die Astronomie aus `@nina-pm/engine` |
| Zugänglichkeit | Canvas mit `role="img"` und Zusammenfassung (Nacht, Dunkelheit, Mond, Zone); Titel als Knopf mit `aria-expanded` |

### 2.18 `MoonIcon` (Mondsymbol)

SVG, dunkle Scheibe (`moon-dark`) und beleuchteter Teil (`moon-lit`) aus Halbkreis und Terminator-Ellipse (`rx = r·|cos φ|`, φ = Phasenwinkel); zunehmend rechts beleuchtet, auf der Südhalbkugel gespiegelt. Rein dekorativ (`aria-hidden`). Verwendet von `MoonDarkness` und dem Mondkalender der Datumswahl (Planung, `pages/planning/NightPicker`).

### 2.19 `NightBodies` (Mond & Planeten, Heute Nacht)

Vorbild `renderPlanetCards`/`drawPlanetBars` im Beobachtungsplaner. Eigenschaften: `rows` (Proben der Nacht aus `sky.nightBodySamples`, 10 min), `site` (Breite/Länge), `timeZone`, `atUtc` (Zeitpunkt der Spalte „jetzt“ und der roten Linie), `atIsNow`. Oben Karten für jeden Körper, der zum besten Moment (`sky.bestBodySample`: am höchsten bei Sonne < −6°, sonst nach Sonnenuntergang) mindestens 10° hoch steht – Name, „max. 72° um 02:40 CDT · S“, Helligkeit bzw. beleuchteter Anteil, linker Rand und Punkt in der Körperfarbe (`body-*`); die übrigen in einer Zeile „Nicht über 10° bei Nacht: …“. Darunter ein Canvas auf `chart-frame`: Dämmerungsleiste (`skyColor`), Stunden in Standortzeit (Gerätezeit darunter, wenn abweichend), je Körper ein Balken über dem Horizont (Deckkraft nach Höhe und Himmelshelligkeit), rechts „jetzt“, „max. Höhe“, „mag · %“ (unter 560 px nur die ersten beiden). Textalternative: `aria-label` mit bestem Moment je Körper. Keine Datenabfrage.

### 2.20 `NightEvents` (Ereignisse der Nacht, Heute Nacht)

Vorbild `renderEvents` im Beobachtungsplaner. Eigenschaften: `timeZone`, `nightUtc`, `passes` (`sky.satellitePassesForNight`, `null` beim Laden), `showers` (`sky.showersTonight` mit `sky.meteorRate`), `moonIllumPct`, `limitingMag`, `galactic` (`sky.galacticCentre`), `season` (`sky.galacticSeason`), `eclipses` (`sky.nextEclipses`). Vier aufklappbare Gruppen (`<details>`) mit Symbol, Titel, Anzahl und erster Zeile im Kopf; darin je eine Tabelle und die Hinweise der Vorlage. Leere Gruppen entfallen, die Überflüge bleiben mit Hinweis, wenn Bahndaten älter als 14 Tage sind; ohne jedes Ereignis ein Leertext. Uhrzeiten in Standortzeit, auf die Minute gerundet wie die Vorlage, Finsternisse mit Datum und Zonenkürzel. Keine Datenabfrage.

### 2.21 `NightTimeline` (Zeitleiste der Nacht, Heute Nacht)

Mehrere Spuren auf **einer** Zeitachse in Standortzeit (volle Stunden, ab 17 Stunden jede zweite; Zeile „Standort CDT“), darunter heller eine zweite Stundenzeile in der Zeit des Users („Bei dir MESZ“), wenn dessen Zone abweicht (`deviceTimeZone`, sonst die des Browsers), dazu eine rote Linie „jetzt“ durch alle Spuren (`chart-now`, nur im Fenster). Eigenschaften: `fromUtc`, `toUtc`, `timeZone`, `nowUtc?`, `label` und `lanes`; jede Spur hat `key`, `label`, `segments` (von–bis, CSS-Farbe aus Tokens, optional Beschriftung, Deckkraft, Tooltip), optional `markers` (Zeitpunkt, Farbe, Titel), `note` (Text in leerer Spur), `continuous` (durchgehendes Band, z. B. Himmel und Wetter) und `describe` (Abschnitte und Marken als visuell verborgene Textliste). Auf dem dunklen Rahmen `chart-frame`; Beschriftungen in Balken werden abgeschnitten. Der Baustein rechnet nichts und fragt keine Daten ab – „Heute Nacht“ liefert Himmel (Sonnenhöhe), Wetter (Gesamtnote je Stunde), Mond (Zeit über dem Horizont), Plan (Blöcke, Flips, Flats aus der Simulation im Browser), Filter und Ereignisse.

## 3. Symbole je Bereich (Lucide)

| Bereich / Aktion | Symbol |
|---|---|
| Übersicht · Heute Nacht · Ausrüstung · Planung · Projekte · NINA · Wetter · Auswertung · Administration · System | `layout-dashboard` · `moon-star` · `telescope` · `compass` · `folder-kanban` · `plug-zap` · `cloud-sun` · `chart-line` · `users` · `settings` |
| Ereignisse der Nacht: Überflüge · Meteorströme · Milchstraßenzentrum · Finsternisse | `satellite` · `sparkles` · `orbit` · `contrast` |
| Speichern · Einreichen · Freigeben · Zurückgeben · Ablehnen · Simulieren · Duplizieren · Löschen | `save` · `send` · `check` · `undo-2` · `x` · `play` · `copy` · `trash-2` |
| Benachrichtigungen · Theme hell/dunkel · Benutzer · Hilfe | `bell` · `sun`/`moon` · `user` · `circle-help` |
| Gelöscht (Papierkorb) · Wiederherstellen · Warnung im `ConfirmDialog` | `trash` · `archive-restore` · `triangle-alert` |
| Sperren · Entsperren · Einladen · Owner übertragen · Hinzufügen · Mandant wechseln · Abmelden (Verwaltung, AP-07a…c) | `lock` · `lock-open` · `user-plus` · `crown` · `plus` · `arrow-left-right` · `log-out` |
| Favorit · Zurück · vorige/nächste Nacht · externer Link (Projekt-Editor, AP-11b) | `star` · `arrow-left` · `chevron-left`/`chevron-right` · `external-link` |
| Ziehen (Rangfolge S-32, Priorität S-30, AP-12b) | `grip-vertical` |
| Stimme (Warteschlange S-33, AP-12c) | `thumbs-up` |
| Saison eines Objekts (Objektbrowser, AP-26d) | `calendar-range` |
| Datumswahl der Nacht mit Mondkalender (Planung) | `calendar-days` |
| Aktualisieren (An NINA ausgeliefert S-41, AP-14c) | `refresh-cw` |
| Sortierbar · Detailzeile zu/offen (`DataTable`, AP-26a) | `arrow-up-down` (aufsteigend `arrow-up`, absteigend `arrow-down`) · `chevron-right`/`chevron-down` |
| Filter aufklappen · Filter entfernen (`FilterBar`, AP-26c) | `plus` + `chevron-down` · `x` |

Die Zuordnung liegt als Konstante `apps/web/src/components/icons.ts`; Seiten importieren **nur** daraus, damit dasselbe Symbol überall dasselbe bedeutet.

## 4. Abnahme (AP-06a und je liefernde Pakete)

1. Für jeden der zehn Bausteine existieren die im Vertrag genannten Zustände und sind als Komponententest abgedeckt.
2. `pnpm test:a11y` (axe) meldet für keine Bausteingeschichte einen *serious*- oder *critical*-Verstoß.
3. Der Theme-Test läuft für **beide** Themes über alle Bausteine und vergleicht die berechneten Farben mit der Token-Tabelle. Zusätzlich ein Dichte-Test: jeder Baustein in `compact`/`normal`/`wide` ohne Überlauf und ohne überlappenden Text.
4. Die in §2 genannten **Grenzfälle** sind je Baustein als Test vorhanden – insbesondere Mitternachtssonne, Polarnacht, Zeitumstellung (auch nur in einer der zwei Zonen, Fall 3a) und Kürzel-Rückfall `GMT±x` → `CDT` für `NightTimeline`, `acquired > planned` für `ProgressBar`, Dec über 90° für `CoordinateInput`, unbekannter Enum-Wert für `StatusBadge`, Polartag ohne Dunkelheit, abbrechende Vorhersage, `bestWindow == null` und unbekannter `modelId` für `WeatherChart` sowie Doppelklick, `Esc` und falsche Namenseingabe für `ConfirmDialog`.
5. Kein Baustein importiert `useCan`, `fetch`, TanStack Query oder ein Repository (ESLint-Regel `no-restricted-imports` für `components/**`).
6. Mindestbreiten: ein Test rendert jeden Baustein bei seiner Mindestbreite **und** bei 2400 px und prüft beide Male `scrollWidth <= clientWidth` – die Arbeitsseiten nutzen die volle Fensterbreite, also muss jeder Baustein auch sehr breit sinnvoll aussehen.
7. **`WeatherChart` bewertet nicht (WS-17):** Ein Test füttert den Baustein mit festen `hours` und prüft, dass jede Zelle den übergebenen Wert zeigt – der Baustein enthält keine der Formeln aus `engine/weather.md` §2. Dazu je Anzeige-Größe ein Farbtest gegen die Stützwerte aus §2.5 (Rampenenden `rgb(198, 208, 220)` / `rgb(30, 88, 190)`, Ampelstops an 0 / 0,45 / 0,65 / 0,85, Windstufen 10 / 20 / 30 / 40 km/h, Tintenschwelle 0,55, Taugefahr 4 °C / 2 °C, Skalen-Stützwerte 0,92 / 0,75 / 0,55 / 0,35 / 0,12) und ein Test, dass jedes Kennzeichen (`aerosolMissing`, `seeingIncomplete`, `coverage < 1`) als **Text** in der Textalternative steht, nicht nur als Farbe.
