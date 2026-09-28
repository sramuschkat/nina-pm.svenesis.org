# ADR-S2a – Offline-Planung mit Jint: Laufzeit und Grenzen

| | |
|---|---|
| Status | vorgeschlagen (Empfehlung von Sven zu bestätigen) |
| Datum | 2026-09-28 |
| Arbeitspaket | AP-S2a |
| Anforderungen | TK 10.4 (Offline), TK 10.2 (`EngineHost`: eigener Thread, Timeout), rules/engine.md Nr. 7 und 10 |

## Kontext
Offline plant das Plugin mit `engine.iife.js` unter Jint (TK 10.4): im Offline-Modus und im Lease-Zustand `unreachable`. AP-08c hat gezeigt, dass Jint dieselben Hashes rechnet wie Node. Offen war, ob es schnell genug ist, wie viel Speicher es braucht und welche Grenzen der `EngineHost` setzen soll.

Die Eingaben entstehen mit `pnpm engine:bench` und steigen in der Last:
- Grundlage ist der Richtwert aus rules/engine.md Nr. 10, 30 Projekte × 3 Panels × 5 Zeilen;
- Standort Starfront, Nacht 2026-09-17;
- Mosaik-Panels als eigene Einheiten, das ist der schwerste Fall;
- Flip, Dither und Filterwechsel sind an.

Gemessen hat `spikes/jint-runtime` mit Jint 4.16.4 und Engine 0.8.0.

## Geprüft

### MacBook Air M4 (arm64, .NET 8.0.31), 3 warme Läufe, Median

| Stufe | Einheiten | Eingabe | Node | Jint 1. Aufruf | Jint warm | Faktor | Hash | allokiert / gehalten |
|---|---|---|---|---|---|---|---|---|
| klein 5×1×3 | 5 | 6 KiB | 7 ms | 921 ms | 444 ms | 63× | = Node | 260 MiB / 14 MiB |
| mittel 15×2×4 | 30 | 35 KiB | 14 ms | 951 ms | 951 ms | 68× | = Node | 559 MiB / 15 MiB |
| **Richtwert 30×3×5** | 90 | 119 KiB | 27 ms | 2256 ms | **2227 ms** | 82× | = Node | 1298 MiB / 30 MiB |
| Richtwert, Neuplanung | 90 | 119 KiB | 24 ms | 2174 ms | 2138 ms | 89× | = Node | 1240 MiB / 28 MiB |
| doppelt 60×3×5 | 180 | 236 KiB | 46 ms | 4127 ms | 4108 ms | 89× | = Node | 2387 MiB / 47 MiB |
| groß 100×4×6 | 400 | 608 KiB | 102 ms | 9275 ms | 9225 ms | 90× | = Node | 5350 MiB / 108 MiB |

| Punkt | Befund |
|---|---|
| Bundle laden | 308 KiB; erste Engine 372 ms (inkl. JIT von Jint), jede weitere 25 ms |
| Warm vs. kalt | Kaum Unterschied nach dem ersten Laden: Jint interpretiert, die Zeit hängt linear an der Last (≈ 23–25 ms je Einheit) |
| Rekursion | Die größte Stufe braucht `LimitRecursion` ≥ 7; auf einem Thread mit nur 256 KiB Stack läuft sie mit Grenze 14 durch |
| Zeitlimit | `TimeoutInterval` greift: `TimeoutException` nach ~10 ms bei 1 ms Grenze |
| Abbruch | `CancellationToken` greift: `ExecutionCanceledException`, Reaktion 2–4 ms |
| Speicher | Gehalten wird wenig (Richtwert ≈ 30 MiB, groß ≈ 108 MiB), **allokiert** wird viel (Richtwert ≈ 1,3 GiB je Plan, kurzlebig). `LimitMemory` zählt die **Allokation** des Aufrufs: Die kleinste funktionierende Grenze für den Richtwert war 1298 MiB, genau die Allokation. Als Speicherschutz ist es damit ungeeignet |
| Prozess | nach allen Stufen 135 MiB Arbeitsspeicher, 66 MiB GC-Heap |

### x64 (CI-Runner `ubuntu-latest`)
Stufen bis zum Richtwert, Auftrag `jint-runtime` in `plugin.yml`, Artefakt `jint-runtime`: **Werte folgen aus dem ersten CI-Lauf dieses PR.** Ein Sternwarten-PC (x64-Mini-PC) dürfte eher in dieser Größenordnung liegen als der M4.

## Entscheidung (Vorschlag)
Jint bleibt die Offline-Engine. `EngineHost` in `NinaPm.Core` (AP-16b) setzt:

1. **Eine Engine je Plugin-Lauf** auf einem **eigenen Hintergrund-Thread** mit Warteschlange. Jint ist nicht threadsicher. Das Bundle wird einmal beim Plugin-Start geladen, das kostet rund 0,4 s; danach wird die Engine wiederverwendet.
2. **`Strict()`, `LimitRecursion(64)`** (gebraucht: 7).
3. **`TimeoutInterval(60 s)`** je Aufruf, das ist etwa 25× der Richtwert auf dem M4. Wird die Grenze überschritten, gilt der Plan als nicht gebaut: `blocked { plan_failed }` mit 5-min-Sperre (execution.md §2).
4. **`CancellationToken`** verknüpft mit Sequenz-Stopp und Plugin-Ende. Die Reaktion liegt bei wenigen ms.
5. **Kein `LimitMemory`**: Die Option misst Allokation, nicht Belegung. Den Speicher begrenzt stattdessen die Eingabe.
6. **Offline-Lastgrenze:** Bis **90 Einheiten** (Richtwert) plant das Plugin offline ohne Einschränkung. Darüber meldet es beim Planaufbau einmal `warning` Code `offline_plan_large` und plant trotzdem, das Zeitlimit sichert ab.

   Die Zahl 90 prüfe ich nach den x64-Werten. Liegt der Richtwert dort über 10 s, schlage ich vor, offline nur Projekte mit Restbedarf in der aktuellen Nacht einzubeziehen (Vorfilter im Kern, vor Jint).

## Folgen
- TK 10.2 (`EngineHost`) und TK 10.4: Parameter aus der Entscheidung nachtragen, sobald Sven die Empfehlung bestätigt hat. Der Code folgt mit AP-16b.
- `enums.json`: Warncode `offline_plan_large`, zusammen mit AP-16b.
- **Risiko:** rund 1,3 GiB kurzlebige Allokation je Richtwert-Plan im NINA-Prozess. Das bedeutet Gen-0/1-Sammlungen und bei schwacher Hardware eventuell kurze Ruckler der Oberfläche. Deshalb Hintergrund-Thread; beobachten in P-16 und P-30 (AP-16g).
- Online plant weiter der Server (ADR-16); Jint läuft nur offline, dort ist eine Laufzeit im Sekundenbereich unkritisch, denn neu geplant wird nur an Blockgrenzen.

## Alternativen
- **Andere JS-Engine (ClearScript/V8):** schneller, aber nativer Code je Plattform, mehr Größe und ein anderer Lizenz- und Update-Pfad. Abgelehnt, solange Jint reicht.
- **Port der Engine nach C#:** doppelte Implementierung; die Parität wäre nicht mehr per Hash gegen dieselbe Quelle gesichert. Abgelehnt.
- **`LimitMemory` als Schutz:** abgelehnt, weil es Allokation statt Belegung misst (oben).
