# Spezifikation: Aufwand-Kennzeichen (`estimateEffort`)

Verbindlich für AP-13e. Bezug: FA-PRJ-23, Fachkonzept 8.9, Job `effort` (TK 7.4).

## Eingabe `EffortInput`
Projekt (alle aktiven Panels/Zeilen mit Planungsbedarf), Rig inkl. Scheduler-Settings und Overheads, Standort, Mondprofile, Zeitraum `{fromNight, toNight}`, `stride` (Stichprobenabstand in Nächten).
- Zeitraum: Wunschzeitraum der Einreichung, sonst `heute … Saisonende` (FK 8.1), höchstens 180 Nächte; zirkumpolar 180 Nächte. **„heute“ = `currentNight(site, now)`** des Rig-Standorts (`night.md` §1.1, NT-01) – nie das Datum des Servers, des Browsers oder der Mandantenzeit; ein Wunschzeitraum, der vor `currentNight` beginnt, wird auf `currentNight` gekürzt.
- `stride`: Server-Job 3, Browser live 5 (entprellt 500 ms).

## Algorithmus (Schätzung unter Idealannahmen)
```
need_l = Planungsbedarf je Zeile (FK 8.4); need = Σ need_l
wenn need = 0:  kein Kennzeichen (Ergebnis `null`, Anzeige „fertig“, FK 8.9/FA-PRJ-12) → Ende
samples = fromNight, fromNight+stride, … ≤ toNight
rest_l = need_l; nights = 0; nachtPlan(n, rest) = planNight(nur dieses Projekt, Planungsbedarf = rest, Produktivmodus)
# 1) Bestnacht (nur Anzeige): Kapazität mit dem VOLLEN Bedarf
cap0[n][l] = expose-Einträge (ohne Bonus) je Zeile aus nachtPlan(n, need) für n ∈ samples
bestNight = Stichprobe mit max Σ_l min(cap0[n][l], need_l); Gleichstand → frühere Nacht
bestNightHoursByStage aus deren Einträgen
wenn Σ_l min(cap0[bestNight][l], need_l) ≥ need:
    tag = "single_night"; nights = 1; earliestCompletion = erste Stichprobennacht mit voller Deckung → Ende
# 2) Fortschreibung chronologisch, jede Stichprobe mit dem AKTUELLEN Rest (ENG-8)
für n in samples:
    c = expose-Einträge je Zeile aus nachtPlan(n, rest)          # Rest steuert Mondstufen, MinChunk und Vorfilter
    gained_l = min(c[l], rest_l); wenn Σ gained > 0: nights += 1; rest_l −= gained_l
    wenn Σ rest = 0: earliestCompletion = n; stopp
    # Nächte zwischen zwei Stichproben zählen mit der Kapazität DIESER Stichprobe (höchstens stride−1 Stück):
    für k = 1 … stride−1:
        wenn Σ rest = 0 → stopp
        gained_l = min(c[l], rest_l)
        wenn Σ gained = 0 → abbrechen (diese Kapazität bringt nichts; nächste Stichprobe)
        nights += 1; rest_l −= gained_l
        wenn Σ rest = 0: earliestCompletion = n + k; stopp
wenn Σ rest = 0 → tag = "multi_night" (nights = geschätzte Anzahl klarer Nächte, Anzeige „ca. n Nächte“)
sonst          → tag = "not_feasible", achievablePct = ⌊100 · (needSec − Σ rest_l·(exposureS_l+ov_l)) / needSec⌋
                 mit needSec = Σ need_l·(exposureS_l+ov_l)                      # in Sekunden, nicht in Frames (ENG-18)
limitingFactor = Zeile mit größtem ungedecktem Anteil (Gleichstand: erste Zeile in Zeilenreihenfolge)
                 + häufigster Diagnosegrund dieser Zeile aus den Stichproben (planNight liefert Gründe je Zeile,
                   allocation.md §12); kein Grund vorhanden → "outranked" entfällt, dann null
requiredHours  = (Σ_l need_l · (exposureS_l + ov_l) + nights_geschätzt · nBlocks · fix) / 3600
                 (ov, fix, nBlocks laut allocation.md §2; nights_geschätzt = 1 bei single_night, sonst nights)
Exoplanet: tag = "transit", fullyObservable (bool), coveragePct
```
- Das Ergebnis ist eine **Schätzung** (Stichproben, Idealannahmen: jede Nacht klar, keine Konkurrenz), **keine** mathematische Untergrenze – so ist es auch in FK 8.9 und TK 8.3 formuliert.
- `stride`: Server-Job **3**, Browser live **5** (nicht 7: 7 läuft im Takt der Mondperiode und kann ganze Dunkelfenster überspringen, ENG-8).
- Ergebnis `EffortEstimate {tag, nights?, earliestCompletion?, achievablePct?, requiredHours, bestNight?, bestNightHoursByStage?, limitingFactor?: {lineId, filterShortName, reason} | null, fullyObservable?, coveragePct?, stride, engineVersion, inputHash, computedAt}` oder **`null`**, wenn der Planungsbedarf 0 ist; `tag` aus `enums.json` → `effortTags` (`single_night`, `multi_night`, `not_feasible`, `transit`).
- Speicherung: `project.effort_tag`, `effort_nights`, `effort_detail` (= übrige Felder), `effort_input_hash`, `effort_computed_at`; `effort_stale` bei Änderung an Projekt, Rig-Settings, Standort, Mondprofil **und bei jeder Korrektur oder jedem Verwerfen von Aufnahmen** des Projekts (NT-48; der Planungsbedarf ändert sich). Gemeldete Aufnahmen gelten **ohne Bestätigung als akzeptiert** – eine Prüfung „am nächsten Tag“ ändert den Zähler nur durch Verwerfen; ohne Eingriff bleibt der Aufwand unverändert. Job dedupliziert `effort:<projectId>`; Neuberechnung nur bei geändertem `inputHash`.

## Keine Vorlage – vollständiger Neubau (verbindlich, WS-21)
Für `estimateEffort` gibt es im Website-Code **keine Vorlage**; in TK 8.4 ist das so zu kennzeichnen. Zwei Funktionen sehen von außen ähnlich aus und dürfen ausdrücklich **nicht** als Referenz herangezogen werden:
- **`SvSkyMap.usableHours` ist keine Referenz für `requiredHours`.** Es ist eine **linke Riemannsumme über 10-min-Stichproben** mit **festem 30°-Tor**: die Höhe wird alle 600 s ausgewertet, jede Stichprobe zählt mit `step/3600` h, die **letzte** Stichprobe zählt mit 0. Nachzulesen ist das an der gleichlautenden **Inline-Rechnung** in `observing-planner.js:1455-1473 computeObjects()` (`step = 600`, `dt = i < samples.length − 1 ? step/3600 : 0`, `if (alt >= 30) hours30 += dt`); `SvSkyMap.usableHours` selbst steht in `js/sky-map.js` (nicht in `observing-planner.js`) und ist über `verify-planner.js:389-391` geprüft. Damit fehlen (a) die Mindesthöhe je Projekt/Rig – 30° sind verdrahtet –, (b) Belichtungslängen, Filterwechsel, Download, Dither, Autofokus und die Overheads aus `allocation.md` §2, (c) der Planungsbedarf je Zeile, (d) die Mondstufen und (e) `MinChunk` und Blockbildung. Eine halbe Stichprobe an jedem Rand verschiebt das Ergebnis systematisch nach unten. `usableHours` beantwortet „wie lange steht das Objekt hoch“, `estimateEffort` beantwortet „wie viele Nächte brauche ich“ – die beiden Zahlen dürfen sich unterscheiden und werden nicht gegeneinander geprüft (`verify-planner.js:391` steht deshalb auf der Negativliste, WS-23).
- **Saisonende nach FK 8.1 hat ebenfalls keine Vorlage.** Die Website zeichnet nur **Monatsbalken**: `nightSummary` (`sky-events.js:685`) summiert je Nacht die Stunden mit Sonne unter **−18°** und Objekt über **30°** – beide Grenzen verdrahtet –, und die Saisonangabe entsteht daraus als „Monate mit mindestens einer Stunde“ am **15. jedes Monats** (`sky-events.js:545-564`, Ausgabe als Monatsbereiche in `seasonText`, `observing-planner.js:991`). Das ist eine Anzeige, kein Saisonende: es kennt keine Dämmerungsgrenze je Projekt, keine Mindesthöhe je Rig, keinen Planungsbedarf und keine Nacht-für-Nacht-Auflösung. Die Saisonsuche über 365 Nächte (`night.md` §1, nur online) ist Eigenentwicklung.

## Leistung
- Server: bis zu **2 × 60** `planNight`-Läufe (Schritt 1 „Bestnacht“ mit vollem Bedarf, Schritt 2 chronologisch mit Restbedarf) × Einzelprojekt **≤ 5 s** in Lambda (Laufzeitziel identisch in TK 8.3; Abbruch mit `effort_stale` bei > 5 s). Nachtkontext und Sichtbarkeit je Nacht cachen (gemeinsamer Cache je Standort und Nacht im Job-Lauf); Schritt 2 bricht ab, sobald der Bedarf gedeckt ist.
- Standortbezogener Lauf (NT-08): aus `tick-hourly`, **einmal je `(site, night)`** nach dem lokalen Mittag des Standorts (`noonStartUtc` der Nacht `currentNight`), idempotent über den Schlüssel `effort:<siteId>:<night>`; nur Projekte mit `effort_stale` oder `effort_computed_at` älter als 7 Tage, höchstens 200 je Lauf (Rest in der nächsten Nacht des Standorts).
- Browser: stride 5, Abbruch bei neuer Eingabe.

## Pflicht-Tests (Overheads 0, Flip aus, sofern nicht anders genannt)
1. Kleines Projekt passt in eine Nacht → `single_night`.
2. 20 h Bedarf, gleichbleibend 5 h/Nacht nutzbar → `multi_night`, nights = 4.
3. Wie 2 mit `downloadS = 5` und 300-s-Belichtungen → nights = 5 (Overhead wirkt).
4. Mond blockiert Breitband in 10 von 14 Nächten → `multi_night`, limitingFactor Breitband-Zeile, reason `moon_blocked`.
5. Ziel geht in 20 Nächten unter, Bedarf 30 Nächte → `not_feasible`, achievablePct korrekt.
6. Nie über Mindesthöhe → `not_feasible` 0 %, reason `not_visible`.
7. Exoplanet → `transit` mit `fullyObservable`.
8. stride 1 und stride 3 liefern bei gleichbleibenden Nächten dasselbe Ergebnis.
9. `need = 0` (Projekt fertig) → Ergebnis `null`, keine Division; die UI zeigt „fertig“ (FA-PRJ-12).
10. Zwei Zeilen (Schmalband mondunabhängig, Breitband mondempfindlich): sobald Schmalband gedeckt ist, plant die **nächste Stichprobe** nur noch Breitband und nutzt die mondfreie Zeit dafür → `nights` kleiner als bei der Rechnung mit vollem Bedarf.
12. Stichprobe mit Kapazität 0 für alle Zeilen (Mond blockiert alles): die Zwischen-Nächte-Schleife bricht sofort ab, `nights` wächst nicht, und die nächste Stichprobe entscheidet (Regressionstest gegen die Endlosschleife, ENG5-3).
11. Gleichstand bei `bestNight` → frühere Nacht gewinnt (deterministisch).
