# Spezifikation: Nacht, Dämmerung, Zeitzonen

Verbindlich für AP-08b (Zeit/Dämmerung), AP-10 (Nachtkontext), AP-13c (Nachtfenster), AP-14a (Bootstrap-Nächte), AP-16b (Offline). Bezug: Fachkonzept 8.1, TK 8.1/9.2, OT-11.

## 1. Nacht-Schlüssel
- Eine Nacht heißt `YYYY-MM-DD` und ist das **Abenddatum in Standortzeit**; sie läuft von **lokalem Mittag bis lokalem Mittag** (bei Zeitumstellung 23 bzw. 25 h).
- Der Schlüssel entsteht **immer** aus der Zeitzonentabelle des Servers (`bootstrap.nights[]`, 60 Nächte), nie aus der lokalen Uhr des Plugins oder aus `Intl` im Browser (AST-15, NIN-12). Die Tabelle enthält je Nacht `{night, noonStartUtc, noonEndUtc, utcOffsetMinutes[]}` und die **tzdata-Version**; die Version ist Teil von `PlanInput` und damit des `inputHash`.
- Der Browser darf `Intl` nur als Anzeigehilfe nutzen. Weichen Server- und Browser-Zeitzonendaten ab (unterschiedliche tzdata-Version), gilt der Server; der Simulator zeigt einen Hinweis.
- Die Saisonsuche über 365 Nächte (FK 8.1) läuft nur **online** (Server), weil die Offline-Tabelle nur 60 Nächte umfasst; offline wird sie übersprungen (Kennzeichen „Saison unbekannt“).

## 2. Dämmerungssuche (verbindlich)
Gesucht wird je Nacht und Grenze `h₀ ∈ {−6°, −12°, −18°}` (geometrische Höhe des Sonnenmittelpunkts) der Abwärts- und der Aufwärtsdurchgang. **Bezugspunkte sind Transit und Antitransit der Sonne, nicht die Mitternacht** – in Sommerzeit liegt das Sonnenminimum 1–2,5 h nach lokaler Mitternacht:
```
t_transit  = Zeitpunkt mit LHA_Sonne = 0   (Kulmination, h_max)    # iterativ wie tM, flip-rotation.md §1.1
t_anti     = Zeitpunkt mit LHA_Sonne = 180 (Antitransit, h_min)    # dazwischen liegt die Nacht
h_max = h(t_transit) ; h_min = h(t_anti)
wenn h_min > h₀:   keine Dunkelheit für diese Grenze  → Polartag-Zweig (§3)
wenn h_max < h₀:   durchgehend dunkel                 → Polarnacht-Zweig (§3)
sonst: genau zwei Durchgänge:
   Abwärts: Bisektion in [t_transit, t_anti]      (Vorzeichenwechsel garantiert)
   Aufwärts: Bisektion in [t_anti, t_transit + 1 Tag]
   Abbruch bei |Δt| ≤ 1 s (max. 20 Schritte), Ergebnis auf ganze Sekunden
```
- Der 10-min-Raster-Scan des ersten Entwurfs entfällt; Transit/Antitransit werden analytisch angelaufen, dadurch kann kein Durchgang übersehen oder der falsche gewählt werden.
- **Streifender Fall:** Ist `|h_min − h₀| < 0,5°`, ist der Zeitpunkt schlecht bestimmt; solche Nächte sind von den Referenztests ausgenommen (Kennzeichen `grazing` in der Fixture) und erzeugen im Simulator den Hinweis `twilight_grazing`.
- Die Grenzen werden je Grenze **einzeln** entschieden: In derselben Nacht kann `−6°` fehlen (Polartag-Zweig) und `−12°`/`−18°` vorhanden sein oder umgekehrt.
- Sonnen- und Mondauf-/-untergang: Sonne bei geometrisch **−0,833°** (Oberrand + Refraktion), Mond bei **scheinbarer Höhe des Mittelpunkts = 0°** (`moon.md`, AST-3).

## 3. Nachtfenster und Zeitmarken
```
nightWindowStart = bürgerliche Abenddämmerung (−6°) − 1 h, auf 5 min abgerundet
nightWindowEnd   = bürgerliche Morgendämmerung (−6°) + 1 h, auf 5 min aufgerundet
darknessStart/End = Dämmerungsgrenze des Projekts bzw. −18° für den Nachtkontext
```
- **Polartag-Zweig** (`h_min > −6°`, Abenddämmerung fehlt): `nightWindowStart = 18:00` Standortzeit; fehlt die Morgendämmerung: `nightWindowStart + 12 h` (wie Original, `allocation.md` §2). Für die tieferen Grenzen gilt dasselbe Fenster; `CanImage` ist dann leer, wenn die Grenze des Projekts nicht erreicht wird.
- **Polarnacht-Zweig** (`h_max < −6°`): Nachtfenster = ganze Nacht von lokalem Mittag bis lokalem Mittag; die tieferen Grenzen werden einzeln geprüft (bei `h_max ≥ −18°` gibt es trotz Polarnacht zwei −18°-Durchgänge).
- Die drei Zeitmarken des Plans (`darknessEndUtc`, `flatsNotBeforeUtc`, `sessionEndUtc`) sind in TK 7.6 definiert; `sessionEndUtc = nightWindowEnd`.

## 4. Pflicht-Tests
| Fall | Erwartung |
|---|---|
| Starfront (31,5° N) im September | alle drei Grenzen vorhanden, Referenzvergleich ±60 s |
| Hannover (52,3705° N) 21.06. | `h_min = δ + φ − 90 = 23,44 + 52,37 − 90 = −14,19°` → **−18° ohne Durchgang**, **−12° und −6° vorhanden** (nautische Dunkelheit ≈ 2 h). Projekte mit astronomischer Dämmerungsgrenze: keine Blöcke, Diagnose `not_visible`; Projekte mit nautischer Grenze: normale Planung |
| Hannover, Anfang August (`δ ≈ +19,1°`) | `h_min ≈ −18,5°`: astronomische Dunkelheit ≈ 78 min, zentriert um den **Antitransit** (≈ 01:27 Standortzeit) – der Abwärtsdurchgang liegt **nach** lokaler Mitternacht (Regressionstest für §2) |
| La Silla (29,3° S) im Juni | Südhalbkugel korrekt, lange Nacht |
| Polarnacht (78° N, 21.12.) | `h_max = 90 − |φ − δ| = −11,44°`: −6° ohne Durchgang → Fenster Mittag–Mittag; −12° und −18° mit **je zwei** Durchgängen |
| Polartag (78° N, 21.06.) | `h_min` deutlich über −6° → Fenster 18:00 + 12 h, `CanImage` leer |
| Zeitumstellung (Europa/Berlin, 25.10. und 29.03.) | Nacht 25 h bzw. 23 h, Nacht-Schlüssel stimmt |
| tzdata-Version geändert | `inputHash` ändert sich (Test auf Aufnahme der Version) |
