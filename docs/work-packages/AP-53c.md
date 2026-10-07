# AP-53c – Ist + Plan, eine Eingabe-Quelle

**Release:** R5 · **Größe:** M · **Abhängigkeiten:** AP-53, AP-53b · **Menschliche Aufgaben:** H-15

## Ziel
Während und nach einer Nacht soll man an jeder Stelle sehen, **was die Rig gemacht hat und was sie noch vorhat**: Plugin-Simulator, Web-Simulator, Zeitleiste auf „Heute Nacht“ und die Fenster aus AP-53b. Heute rechnet der Plugin-Simulator seit #277 ab jetzt, deshalb verschwinden erledigte Ziele aus der Grafik (Rig-Nacht 06./07.10.2026: der WASP-3b-Transit fehlte ab 01:07).

Außerdem sollen Web und Server die Engine-Eingabe **gleich zusammensetzen**. Heute baut der Browser die Eingabe selbst aus Rig, Projekten, Mondprofilen, Nacht-Tabelle und seit #288 den Transits. Der Server baut sie in `nightPlanInput`. Die Engine ist dieselbe, die Eingabe nur fast. Jede neue Eingabe (Transits, Autofokus-Trigger, offene Meldungen) musste bisher an zwei Stellen nachgezogen werden (#288, #289, #291).

Skizze (Abnahme vor der Umsetzung): https://claude.ai/artifact/3gkfoUTnPigpnuRYP4PXmQ

## Anforderungen
FA-SIM-05, FA-SIM-07, FA-SIM-08, FA-NIN-13, FA-NIN-18. Neu vorgeschlagen ist **FA-SIM-10** „Ist + Plan der laufenden und vergangenen Nacht“. Die FK-Zeile kommt mit dem Umsetzungs-PR (FK S-40).

## Lesen (nur diese Abschnitte)
- FK FA-SIM-01…09, FA-NIN-13, FA-NIN-18, S-40
- TK 7.3 (Planaufbau, `POST /plan`), 7.6 (Blöcke), 6.3 (Session-Detail)
- specs/nina/execution.md §2, §10
- `docs/rules/api.md`, `docs/rules/engine.md`, `docs/rules/testing.md`
- Code: `apps/api/src/nina/sync.ts` (`nightPlanInput`), `apps/api/src/nina/simulation.ts`, `apps/web/src/pages/simulator/simulate.ts`, `use-night-plan.ts`
- Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern

### A – Eine Eingabe-Quelle
- **`GET /api/web/v1/simulations/input?rigId=&night=`** liefert die fertige `PlanInput`. Sie entsteht aus derselben Funktion wie `POST /plan` und `GET /nina/v1/simulation` (`nightPlanInput`, dafür von `NinaPrincipal` auf `{tenantId, rigId}` umstellen). Dazu kommen `inputHash` (`canonicalInputJson`), Projektnamen, Mondprofilnamen und Filterfarben. Berechtigung wie der Web-Simulator, generierte Rechte-Tests.
- Der **Browser rechnet weiter selbst** (Worker, `planNight`): Er übernimmt die Server-Eingabe unverändert. Was-wäre-wenn (Zeile aus/an, Priorität, Startzeit, Schieberegler) wird als **Überlagerung** auf diese Eingabe angewendet (`applyOverrides(input, overrides)` in `packages/shared`). Das ersetzt die eigene Zusammensetzung aus `buildPlanInput` im Browser.
- `buildPlanInput` bleibt in `packages/shared` als einzige Abbildung, wird aber nur noch auf dem Server aufgerufen. Die Abfragen für Projekte, Mondprofile und Transits im Simulator entfallen, soweit nur die Eingabe sie brauchte. Zielkarten und Hinweise lesen aus der Antwort.
- Der Engine-Bundle-Hash im Browser muss weiter zum Server passen (`pnpm engine:parity`).

### C – Hinweis bei abweichendem Hash
- Der Web-Simulator zeigt neben der Kopfzeile, ob sein Ergebnis zur Rig passt. Er vergleicht drei Hashes: die Eingabe, die er gerechnet hat, `inputHash` aus der Antwort und den der letzten gespeicherten Planrevision (`night_plan.input_hash`):
  - **„Gleiche Eingabe wie der Server“** – keine Überlagerung aktiv.
  - **„Was-wäre-wenn – weicht vom Server ab“** mit Liste der Überlagerungen und *Zurücksetzen*.
  - **„Rig plant noch mit Revision n von hh:mm“**, wenn sich die Server-Eingabe seit dem gespeicherten Plan geändert hat (z. B. Projekt geändert). Der Hinweis nennt, wann das Plugin das spätestens übernimmt: ≤ 1 min bei neuem Ziele-ETag (0.4.12), sonst bei der nächsten Neuplanung.
- Der Plugin-Simulator zeigt in der Fußzeile `Plan <id> · Rev. n` und denselben Hinweis, wenn die Simulation nicht dem gespeicherten Plan entspricht.

### Ist + Plan
- **Ist aus den Session-Ereignissen** (`session_event`, `capture`) der Nacht, alle Sessions des Rigs, nach Zeit geordnet:
  - `executed.blocks[]`: `{projectId, panelId, kind, startUtc, endUtc, endReason, nightPlanId, blockId}` aus `block_start`/`block_end`, Transit-Serien als `kind = transit`.
  - `executed.segments[]`: zusammenhängende Aufnahmen gleichen Filters je Block, `{startUtc, endUtc, filter, saved, skipped, failed}`. Das hält die Antwort klein (558 Transit-Frames → ein Segment).
  - `executed.events[]`: Autofokus, Meridian-Flip, Safety-Pause, Neuplanung mit Grund, Flats.
  - Neu in `NinaSimulation` (Plugin) und in der Antwort der Web-Route. Nur für die aktuelle Nacht und vergangene Nächte mit Session, sonst leer.
- **Plan ab jetzt aus der letzten gespeicherten Revision** (`night_plan`, `origin = server_plan`): Blöcke und Einträge ab `max(jetzt, Ende Ist)`. Das ist genau das, was das Plugin ausführt. Die Neurechnung ab jetzt (heutiges Verhalten seit #277) bleibt nur für eine Nacht ohne gespeicherten Plan.
- **Plan zu Nachtbeginn** (Revision 1 der Session) wahlweise als dünner Umriss hinter Ist und Plan. Schalter *Ursprungsplan*, Standard aus.
- **Darstellung (`PlanChart`, Web und Plugin gleich):**
  - Ist blass mit dünnem Rand und blasser Filterleiste aus den Segmenten (Sven, 07.10.2026: Vergangenheit schwach, Zukunft stark).
  - Plan ab jetzt kräftig gefüllt, mit kräftiger Filterleiste.
  - Lücken im Ist (Leerlauf, Schleife, Safety) schraffiert mit Grund im Tooltip.
  - Jetzt-Linie. Höhenkurven über die ganze Nacht.
- **Planprotokoll** mit Spalte **Ist** wie in AP-53b (✓ gespeichert, ↷ übersprungen mit Grund, ✕ fehlgeschlagen, ▶ läuft, ○ geplant). Vergangene Einträge kommen aus den Ist-Daten, künftige aus dem gespeicherten Plan. Kopfzeile mit Zählern.
- **Verwender:**
  - Web-Simulator (S-40), wenn „Heute Nacht“ läuft oder eine vergangene Nacht mit Session gewählt ist. Für künftige Nächte bleibt alles wie heute.
  - Zeitleiste auf „Heute Nacht“ (`TonightPage`, Zeilen Plan und Filter): Ist und Plan in einer Zeile. Auf der Rig-Karte steht der Hinweis „Rig plant noch mit Rev. n von hh:mm“, wenn sich die Eingabe seit dem gespeicherten Plan geändert hat (Entscheidung 4).
  - Plugin-Simulator (FA-NIN-18) für die laufende Nacht.
  - AP-53b-Fenster: Blöcke aus dem gespeicherten Plan wie entschieden. Das Ist kommt offline aus dem lokalen Protokoll, sonst aus `executed`. Das vereinheitlicht die Datenquelle mit dem Plugin-Simulator.
- **Verträge zuerst:** `SimulationInput`, `SimulationInputQuery`, `ExecutedNight` in `packages/shared/src/contracts/simulation.ts`, `nina.NinaSimulation.executed`. Neue Ereignisarten nur, falls nötig, über `enums.json`.
- Spec-Ergänzungen in `execution.md` §10 (Ist + Plan im Plugin-Simulator) und im FK-Vorschlag FA-SIM-10. Changelog-Fragment.

## Nicht im Umfang
- **Server rechnet für den Web-Simulator** (Variante B). Der Browser bleibt Rechner für Was-wäre-wenn und Zeitschieber ohne Server-Rundlauf.
- Mehrnacht-Simulation und Prognose-Job (`simulateNights`): Sie schreiben den Restbedarf über mehrere Nächte fort und behalten ihre Abbildung. Eine Angleichung käme gegebenenfalls in einem eigenen Brief.
- Eingriffe aus der Ist-Ansicht (Block wiederholen, Aufnahmen verwerfen).
- Nachtbericht und Session-Detail (S-50) bekommen die Grafik erst, wenn Sven es wünscht. Die Daten sind dieselben.

## Entscheidungen (Sven, 07.10.2026)
1. **Rest-Plan aus der letzten gespeicherten Revision.** Die Grafik zeigt ab jetzt genau, was das Plugin ausführt. Eine Neurechnung ab jetzt gibt es nur für eine Nacht ohne gespeicherten Plan und für *Was-wäre-wenn*.
2. **Ursprungsplan als Umriss:** Schalter *Ursprungsplan*, Standard aus.
3. **Vergangene Nächte mit Session:** Der Web-Simulator zeigt Ist und letzte Revision. Künftige Nächte und Nächte ohne Session rechnet er wie bisher.
4. **Hinweis „Rig plant noch mit Rev. n“** erscheint im Web- und Plugin-Simulator und auf der Rig-Karte von „Heute Nacht“.

## Umsetzung (07.10.2026) – Abweichungen und Präzisierungen
- **Reihenfolge:** Auf Wunsch von Sven vor der Abnahme von AP-53b umgesetzt („wir testen das dann alles zusammen“).
- **Plugin meldet Blöcke:** Bis 0.4.13 meldete das Plugin weder Blockstart/-ende noch Übersprungenes oder Safety-Pausen. Ab 0.4.14 meldet es dieselben Einträge wie das Nachtjournal (execution.md §10.2). Für ältere Nächte ergibt das Server-Ist die Blöcke aus den Aufnahmen.
- **Was-wäre-wenn:** Im Web-Simulator gibt es keine lokalen Schalter je Zeile oder Priorität (Zeilen schaltet er auf dem Server); Was-wäre-wenn ist *mit meinen Entwürfen*. Dafür baut der Browser die Eingabe weiter selbst (`buildPlanInput` bleibt im Browser nur dafür); `applyOverrides` entfällt.
- **„Rig plant noch mit Rev. n“:** Der Hash der gespeicherten Revision ist nicht vergleichbar (Startzeit, Nachtzustand). Verglichen werden Ziele-ETag und Einstellungsversion, die `POST /plan` in `night_plan.summary` ablegt – ohne Migration.
- **Ist in den Plugin-Fenstern:** Das lokale Journal ist frischer als das einmal je Nacht geholte Server-Ist; es gilt das lokale Journal, davor das Server-Ist.

## Automatisierte Abnahme
- [ ] Vertragstest: `GET /simulations/input` liefert für dasselbe Rig, dieselbe Nacht und dieselbe Zeit **byte-gleich** dieselbe `canonicalInputJson` wie `POST /plan` ohne `tonight`. Das gilt mit Transit, ohne Transit und mit unbekanntem Autofokus-Trigger.
- [ ] Web: `planNight(applyOverrides(input, {}))` ergibt denselben Hash wie der Server. Jede Überlagerung ändert nur die betroffenen Felder. Die Simulator-Tests laufen ohne eigene `buildPlanInput`-Zusammensetzung.
- [ ] Ist-Aggregation: Beispielnacht nach 06./07.10. (Transit 558 × RED, 12 min `transit_interrupt`-Schleife, IC 1795, Flip, Flats) → erwartete Blöcke, Segmente, Lücken und Zähler. Zwei Sessions in einer Nacht werden zusammengeführt.
- [ ] Hash-Hinweis: drei Zustände (gleich, Was-wäre-wenn, Rig auf älterer Revision) in Komponenten-Tests; „Rig auf älterer Revision“ auch auf der Rig-Karte von „Heute Nacht“
- [ ] Plugin: `NinaSimulation.executed` deserialisiert, `PlanChart` zeichnet Ist blass und Plan kräftig, Grenze an der Jetzt-Linie. Ohne `executed` (älterer Server) bleibt die Anzeige wie heute.
- [ ] E2E (Playwright): Simulator „Heute Nacht“ mit laufender Session aus dem Seed zeigt erledigte Blöcke vor der Jetzt-Linie. Die Zeitleiste auf „Heute Nacht“ zeigt den Transit.
- [ ] Rechte-Tests generiert, CI grün, Changelog-Fragment, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Abnahme der Skizze vor Beginn. Danach Sichtprüfung (H-15): Plugin-Simulator und Web-Simulator während einer VM-Nacht mit Neuplanung und übersprungenem Block, „Heute Nacht“ nach einer Rig-Nacht.
