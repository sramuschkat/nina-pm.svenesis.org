# AP-08b – Engine: Zeit, Sonne, Mond, Koordinaten, Dämmerung (Port astro-core)

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-08a · **Menschliche Aufgaben:** H-03

## Ziel
Zeit, Sonne, Mond, Koordinaten und Dämmerung sind aus astro-core portiert – mit den Auflagen aus TK 8.4 (ΔT, Refraktion, Rundung, keine `Intl`) – und gegen astropy-Fixtures mit den Toleranzen aus TK 9.2 geprüft, dazu die Positivliste der Website-Prüfungen aus TK 9.2 (WS-22).

## Anforderungen
FK 8.1, TK 8.4, 9

## Lesen (nur diese Abschnitte)
- FK 8.1, 9
- TK 8.4, 9.1–9.2, TK 18 (reference.yml)
- specs/engine/moon.md §1–2 (Refraktion, Beleuchtung)
- specs/engine/night.md §1–§4 (Nacht-Tabelle mit `timeZoneTransitions`, Dämmerungssuche, Polarfälle, Nachtfenster-Rundung NT-07, Himmelsflat-Durchgänge NT-40)
- legacy/astro-tools-2026-09-21/js/astro-core.js (Kopiervorlage Astro-Kern)
- legacy/astro-tools-2026-09-21/js/weather-core.js (Kopiervorlage der Wetterbewertung, WS-19 – hier nur mitlesen, portiert wird sie in AP-23)
- rules/engine.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Zeit (JD, ΔT, Zeitzonenübergänge als Eingabe – `timeZoneTransitions[{atUtc, utcOffsetMinutes}]` der Nacht-Tabelle, `night.md` §1, NT-02), Präzession/Nutation, Sonne, Mond (topozentrisch, Beleuchtung `atan2`, Elongation), **Refraktion nach Saemundsson aus der geometrischen Höhe** (`moon.md` §1; Bennett wird nicht verwendet), Höhe/Azimut, Meridiandurchgang, Dämmerungszeiten und Nachtgrenzen **nach `night.md` §2** (Transit/Antitransit, Bisektion 1 s, `grazing`), bei `flats.source = sky` zusätzlich die Aufwärtsdurchgänge der Sonne bei −8° und −2° (NT-40)
- **Nachtfenster nach `night.md` §3 (NT-07):** Beginn = bürgerliche Abenddämmerung − 1 h, auf 5 min der UTC-Uhr **ab**gerundet; Ende = bürgerliche Morgendämmerung + 1 h, auf 5 min **auf**gerundet
- **Auflagen aus TK 8.4 „in der Vorlage falsch – nicht übernehmen“ (WS-20).** Beim Port sind diese Stellen zu ersetzen, nicht zu kopieren: **ΔT nachtragen** – die Vorlage rechnet die Ephemeridenargumente ohne ΔT (`astro-core.js:52/87`), richtig ist **TT = UT + 69 s** in Sonne, Mond, Präzession und Nutation, **nicht** in die Sternzeit (TK 8.5); der tote Vorgabewert **`OBL = 23.4397°`** (`astro-core.js:14`, 13,9″ falsch) wird **nie** verwendet, maßgeblich ist `nu.eps`; **`Intl` im Rechenpfad** (`astro-core.js:380-395`, `observing-planner.js:350`) und **`Math.round`** (`astro-core.js:331/391/399`) sind verboten – Zeitzonen kommen aus der Übergangstabelle (`night.md` §1, NT-02), gerundet wird mit `q(x, inv)`/`roundHalfAwayFromZero`; **Refraktion unterhalb −1° konstant** `R(−1°)` = 38,795′ statt ausgeblendet (`astro-core.js:305-309`); **Mondhöhe scheinbar** statt geometrisch (`astro-core.js:138`, bis 0,647°); **Mondabstand topozentrisch, unrefraktiert, mit `atan2`** statt geozentrisch mit `acos` (`observing-planner.js:1465`, 1,003°); **Dämmerung je Grenze** über Transit/Antitransit und Bisektion (1 s) statt 60-s-Raster mit Mitternachts-Heuristik (`astro-core.js:344-373`; Beleg A Coruña, Nacht 2026-07-01: Fenstermitte 22:00:00Z liegt 36,7 min vor dem Beginn der Dunkelheit 22:36:41Z); eine **nicht existierende Ortszeit** (DST-Sprung) ergibt `422 validation.failed` statt stillschweigend einer 0-h-Nacht (`astro-core.js:401/403`, `Pacific/Apia` 2011-12-30)
- `tools/reference` (Python/astropy) Generator + Fixtures, erzeugt im CI-Job `reference.yml` mit gebündelten IERS-Daten (lokal optional, H-10); `gen_sun_moon.py` und die Fixture-Liste enthalten **beide** Referenznächte für die Nachtfenster-Rundung: Starfront `2026-09-17` und `2026-09-15` (WS-28, TK 9.1)
- Referenztests mit Toleranzen TK 9.2

## Nicht im Umfang
- Sichtbarkeit/Mondvermeidung (AP-10)

## Automatisierte Abnahme
- [ ] Referenztests grün (Toleranzen)
- [ ] Refraktionsrichtung aus `moon.md` §1 exakt: Saemundsson **aus der geometrischen Höhe** (`R(0°) = 28,98′`, unterhalb −1° konstant `R(−1°)`), Bennett nur zur Rückrechnung in Referenztests
- [ ] Testtabelle `night.md` §4 exakt (Hannover 21.06. `h_min` = −14,19°, Hannover 29.07.2026 Antitransit **01:28** Standortzeit (WS-29), 78° N `h_max` = −11,44°)
- [ ] Grenzfälle Polarnacht, Mitternachtssonne, Zeitumstellung
- [ ] Nachtfenster-Rundung (NT-07) mit der **eigenen Toleranz ± 5 s** statt der allgemeinen ± 60 s aus TK 9.2 (WS-28): Starfront `2026-09-17` → `00:00:00Z – 13:00:00Z`, **156 Slots** à 300 s; dazu die **zweite Referenznacht** Starfront `2026-09-15` → `00:05:00Z – 13:00:00Z`, **155 Slots**, deren Dämmerungszeiten ≥ 2 min von der 5-min-Marke entfernt liegen und die deshalb die Rundungs**richtung** prüft, während die Nacht 17.09. die Genauigkeit prüft (`night.md` §4). Mit ± 60 s wäre ein Port formal konform, der 155 statt 156 Slots bzw. `13:00:00Z` statt `13:05:00Z` liefert. Je Tabellenzeile steht der Abstand zur 5-min-Grenze dabei: **11,4 s** (Beginn 17.09.), **51,4 s** (Ende 17.09.), **14,7 s** (Ende 18.09., Morgendämmerung **11:59:45Z**) und **21,9 s** (Ende 19.09.). Die **Referenzzeiten** stehen auf ganze Sekunden **gerundet** (Toleranz ± 1 s), die **Abstände** sind aus den **exakten** Werten gerechnet (01:04:48,6Z / 11:59:08,6Z / 11:59:45,3Z / 12:00:21,9Z) – deshalb mit einer Nachkommastelle (`night.md` §2/§4, TK 9.2)
- [ ] Zeitumstellung `America/Chicago` (NT-46): Nacht `2026-10-31` = 25 h (`2026-10-31T17:00Z → 2026-11-01T18:00Z`), Nacht `2026-03-07` = 23 h (`2026-03-07T18:00Z → 2026-03-08T17:00Z`)
- [ ] **Positivliste der Prüfungen aus `verify-planner.js` (TK 9.2, WS-22)** in `packages/engine/test/legacy-checks.spec.ts`, jede mit Fundstelle im Stand 21.09.2026: `:419` **Meeus 47.a** (Mond), 1992-04-12 0h TD → α = 134,688470°, δ = 13,768368°, Δ = 368.409,7 km, Toleranz **± 0,0006°** in α/δ und **± 1 km** in Δ. Die Vorlage führt die Breitenreihe (Tabelle **47.B**, Σb) nur mit **30 der 60 Terme** – damit wird die Toleranz **nur knapp erfüllt**: nachgerechnet **δ 1,94″ gegen die zulässigen 2,16″** (= ± 0,0006°), also 90 % des Budgets allein für den Reihenabbruch, während α mit 0,46″ und Δ mit 0,015 km unauffällig bleiben (47.A ist dort vollständig). Der **Produktivpfad braucht die vollen 60 Terme von 47.B** (`specs/engine/moon.md`), sonst hat der Test keinen Spielraum mehr für echte Portierungsfehler; `:423` **Meeus 22.a** (Nutation und Schiefe), 1987-04-10 0h TD → Δψ = −3,788″ (± 0,5″), Δε = +9,443″ (± 0,1″), ε₀ = 23°26′27,407″ (± 0,05″); `:428-441` Mondposition gegen **JPL Horizons**, 10 Termine 20.09.–17.10.2026, **± 0,01°** – **mit ΔT**, der Test prüft damit den Produktivpfad nach WS-20 und nicht den Website-Pfad ohne ΔT; `:96-99` **Präzession**, Rundlauf J2000 → Datum → J2000 über Zufallspunkte **< 1e-4″**, der Pol bleibt endlich (δ = 89,85°); `:247-261` **Neu- und Vollmonde gegen USNO**, 10 Termine 2026, **± 30 min** als Grobtest für `d` und `illum`; `:472` **Dunkelheit am Pol**, −85°, 29.05.–04.06.2026, kürzeste Spanne **> 900 min** als Regression für den Polarnacht-Zweig. Die übrigen Positivlisten-Einträge liegen nicht hier: `:194-203` und `:320-385` (Katalog-Wohlgeformtheit) sind Importtests von AP-20, `:637-648` (Wetter-Scores) gehört zu AP-23
- [ ] **Negativliste (TK 9.2, WS-23) – diese Prüfungen werden ausdrücklich nicht übernommen**, damit sie nicht „aus Vollständigkeit“ wieder eingebaut werden: `:110` schreibt fest, dass es **unter dem Horizont keine Refraktion** gibt – das widerspricht `moon.md` und WS-20 (`astro-core.js:305-309`), konform wäre `refract(−5°) = −4,3534°`, der Test würde den korrigierten Port durchfallen lassen; `:105` schreibt **Bennett** zu, was die **Saemundsson-Umkehrung** ist (34,43′ statt 34,48′) – der Zahlenwert gehört zum anderen Modell; `:476` Rundlaufbereich der Refraktion **unterhalb −1°** – prüft genau den abgeschnittenen Zweig; `:391` **`usableHours`** – linke Riemannsumme mit festem 30°-Tor, NINA-PM rechnet `estimateEffort` nach `effort.md`; `:393` **festes Rig-Bildfeld 1,69°** – das Bildfeld kommt je Rig aus `geometry.md`; dazu alle Prüfungen zu Seitenstruktur und Skriptreihenfolge, `?v=`-Versionen, Bildbeständen, HEALPix, Kartenprojektion, Sternbinärdatei, Doppelsternen und TLE-Alter
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
