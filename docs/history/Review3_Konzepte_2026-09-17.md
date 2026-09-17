# Review 3 – Fachkonzept 1.10 · Technisches Konzept 1.7 · Schema 1.7 · Claude-Code-Paket

Stand 17.09.2026. Fünf Prüfdurchgänge (Fachlogik, Konsistenz der Dokumente, Planungs-Spezifikation gegen den Astro-PM-C#-Code, NINA-Plugin-Ausführung, Umsetzbarkeit mit Claude Code). Die wichtigsten Befunde habe ich selbst gegengeprüft (✔ = am Dokument bestätigt). **Status: eingearbeitet am 17.09.2026** in Fachkonzept 1.11, Technisches Konzept 1.8, Schema 1.8 und das Claude-Code-Paket (Specs `allocation.md`, `moon.md`, `effort.md`, `transit.md`, `flip-rotation.md`, `execution.md`; Verträge, Enums, Fehlercodes, Seed; Arbeitspakete neu geschnitten AP-09b/c, AP-13a–e, AP-16a–g; H-12a/b, H-22; Testprotokolle P-13…P-22; `START.md`, `docs/adr/ADR-TEMPLATE.md`, `docs/concept/INDEX.md`). Entscheidungen: FK OP-28.

## Gesamturteil

- **Fachlich** ist das Konzept weitgehend schlüssig. Nach der Übernahme des Astro-PM-Algorithmus gibt es aber neue Reibungsstellen: Überschuss vs. „fertig“, Neuplanung vor jedem Block vs. faire Verteilung, Transit-Zeitreihen und Overheads bei kleinen Restposten.
- **Die Planungs-Spezifikation** (`allocation.md`) beschreibt das C#-Original in den Kernroutinen korrekt (fairShare, Passes, Nacharbeiten, Sortierkette – nachgerechnet). Es fehlen jedoch Details für den Kompatibilitätsmodus des Orakels. Einige Abweichungen (Overheads, hartes Blockende) erzeugen neue Randfehler.
- **Die Plugin-Spezifikation** übernimmt die erprobten Muster richtig. An drei Stellen hat die Vorlage kein Vorbild, und dort fehlen die Regeln: Neuplanung im Block, Transit, Zuordnung `ImageSaved`.
- **Claude Code (Opus 5)** kann mit dem Paket R1 schrittweise umsetzen: klare Reihenfolge, knappe Regeln, exakte Specs, vollständige Fehlercodes/Enums. Vor dem Start sollten aber rund 15 Punkte behoben werden. Das sind Widersprüche (Lambda-Anzahl, Lease-Dauer, Enum-Werte in Beispielen), Abhängigkeitsfehler (DSQL-Zugang, DB-Ping vor Migration, Soll-Pläne) und zu große Pakete (AP-13a, AP-16c).

---

## A. Vor dem Start beheben (hoch)

| # | Befund | Fundstelle | Vorschlag |
|---|---|---|---|
| A-1 ✔ | **Grenzfall-Tabelle Mond falsch:** Streng 20 % bzw. Moderat 50 % liegen unter max. Beleuchtung → Stufe 3 „sicher“, nicht „blockiert“ (Zahlen der Stufe 4 stimmen). Pflicht-Unit-Tests wären falsch. | `specs/engine/moon.md` Tabelle Z. 1–3 | Beleuchtung über maxIllum setzen (z. B. 40 %/70 %) und Stufe 3 separat testen. |
| A-2 ✔ | **Überschuss wird nie fertig:** „fertig“ und Statuswechsel *Bereit zur Bearbeitung* hängen an *Verbleibend = 0*, geplant wird aber mit Planungsbedarf (inkl. Überschuss); nur *Aktiv* wird ausgeliefert. `isDeliverable` enthält noch die alte Bonus-Obergrenze. | FK FA-PRJ-12, FA-SCH-04, 8.4; TK 6.3 (Z. 483) | „fertig“/Auslieferung an Planungsbedarf koppeln; `isDeliverable` = Planungsbedarf > 0 ∨ Bonus an. |
| A-3 ✔ | **Lease-Dauer widersprüchlich:** 3 min (FK, Schema) vs. 10 min (TK 5.6, Beispiel). | FK FA-RIG-06; Schema `rig`; TK 431, 7.6 | Einheitlich festlegen (3 min bei 60-s-Heartbeat). |
| A-4 ✔ | **Beispiele widersprechen Enums:** `kind: "deep_sky"`, `rotationMode: "rotate"/"check"` vs. `regular/transit`, `rotator/fixed_camera`. Transitblock enthält einen Flip im Fenster; Filter „R“ fehlt am Rig; Sortierkette im Bootstrap noch alt; `mosaicPanelPreference` vs. `mosaic_panels_independent` (5 Schreibweisen). AP-14a-Abnahme („Beispiele validieren“) scheitert. | `contracts/nina/*.json`, TK 7.6, enums.json, seed, golden-plans README | Ein Namenssatz; Beispiele, TK 7.6, Seed und Schema-Kommentare angleichen. |
| A-5 ✔ | **„Nur zwei Lambdas“** – TK nennt zusätzlich `migrate` und `ops-cli` (plus CDK-Hilfs-Lambdas); CDK-Assertion in AP-02b bricht. | CLAUDE.md Regel 11, `rules/api.md`, AP-02b vs. TK 3.1/4.1/6.8 | „2 Anwendungs-Lambdas + migrate + ops-cli; CDK-Hilfs-Lambdas ausgenommen“. |
| A-6 | **DB-Ping vor Migration:** AP-02b verlangt `/api/health` mit DB-Ping, Rollen/IAM-GRANT und Stack `Migrate` entstehen erst in AP-03. | AP-02b, TK 4.1/6.8 | Abnahme „DB ok“ nach AP-03 oder Migrate-Grundgerüst in AP-02b. |
| A-7 | **DSQL-Zugang für Claude Code fehlt:** Spike AP-S1 und `dsql-it.yml` brauchen AWS-Rechte (Cluster anlegen/löschen) und ein Environment `ci`; H-04 kennt nur `prod`. | AP-S1, AP-03, H-04, TK 4.1 | Neue Aufgabe H-22: Environment `ci` + OIDC-Rolle mit DSQL-Rechten; Spike als manuell ausgelöster Workflow. |
| A-8 | **Soll-Pläne falsch geschnitten:** AP-13a soll Produktiv-Soll-Pläne für alle Fälle erzeugen, braucht dafür aber `walk/pick` aus AP-13b; H-13 sperrt AP-13b und damit die ganze NINA-Kette. | AP-13a/b, golden-plans README, TK 19 | Paint-Fälle in 13a, Ablauf-Fälle in 13b; H-13 als Merge-Bedingung, nicht als Startsperre. |
| A-9 | **AP-13a und AP-16c zu groß:** Orakel + Grid + Port von ~2.400 C#-Zeilen + 500-Grid-Vergleich + Soll-Pläne bzw. Container + alle Items + Trigger-Walk + Zuordnung + Outbox + Heartbeat. | AP-13a, AP-16c | 13a → 13a-1 Orakel/Grid/CI, 13a-2 Paint-Port, 13a-3 Soll-Pläne; 16c in Container/Items und Trigger/Zuordnung/Heartbeat teilen. |
| A-10 | **Neuplanung verschiebt die Fairness:** Beispiel zwei gleiche Ziele (je 10 h, 8 h Nacht): Erstplan 4/4 h, nach Neuplanung vor Block 2 A 5,7 h / B 2,3 h, weil bereits Zugeteiltes nicht zählt. Blöcke ändern sich laufend. | `allocation.md` A-11, §5.1 | Heute bereits belichtete Zeit als `existing` in fairShare; Hysterese (laufenden/nächsten Block beibehalten, nur bei Fall a/b der FA-SYN-03 umplanen). |
| A-11 | **Overheads + hartes Blockende → Restposten nie fertig:** 1×300 s + 5 s Download → MinChunk 2 Slots; Walk: Slew 120 + AF 180 + 305 > 600 s → keine Belichtung, jede Nacht. Zusätzlich Aussortieren mit unverkürzter Mindestzeit (§3.2). | `allocation.md` A-4, A-7, §3.2 | Blockfixkosten (Slew + fälliger AF) in MinChunk/Budget; Aussortieren mit min(Mindestzeit, Restarbeit). |
| A-12 | **Plugin: Neuplanung im Block ungeregelt:** Vorlage bildet Einträge einmal je Block; FA-SYN-03 verlangt Aktualisierung alle 15 min mit Fällen a/b/c; `startAtUtc`, neuer Blockindex, erneuter Slew und „ETag geändert vs. immer“ offen. | `specs/nina/execution.md` §3; TK 10.3 Nr. 3 | Laufender Block behält Einträge; (a) nach laufender Belichtung beenden, (b) Transit-Unterbrechung, (c) ab nächstem Block; Index = erster Block mit `endUtc > jetzt`; gleiches Panel → kein Slew; nur bei ETag-Änderung. |
| A-13 | **Plugin: Transit nicht spezifiziert:** `expose_series`, Autofokus-Sperre, Belichtungsabbruch (FA-NIN-20), Unterscheidung Benutzerabbruch; TK spricht von eigenem Container (passt nicht zu „ein Block je Execute“). Kein Testprotokoll. | execution.md; TK 10.3 Nr. 8; AP-44; FK FA-NIN-20 | Abschnitt „Transit“: Schleife im selben Container, TriggerWalker filtert AF-Trigger, eigener Abbruch-Token; P-Transit anlegen. |
| A-14 ✔ | **Zuordnung `ImageSaved`:** `MetaData.Image.Id` ist eine NINA-int-ID, erst nach `CaptureImage` bekannt – die UUID kann nicht vorher hinein; kein Timeout, Vorlage meldet „erfasst“ auch bei Speicherfehler. | execution.md §4; TK 10.2/10.3 Nr. 5 | Image.Id → captureId nach Capture, vor Enqueue registrieren; Timeout 120 s → `failed`; erst nach `ImageSaved` zählen. |
| A-15 ✔ | **Transit-Widerspruch FK:** FA-EXO-18 erlaubt mehrere künftige Festlegungen, FA-EXO-21 sagt „danach ist kein Ereignis mehr festgelegt“. Transit-Soll als Anzahl bricht Zeitreihe vor Baseline-Ende ab (auch im Walk: Kandidat nur mit Rest > 0). | FK FA-EXO-18/20/21; `allocation.md` §8 | EXO-21 nur diese Beobachtung abschließen; Transit über Zeit bis Fensterende steuern, Zusatzframes nicht als Bonus. |

## B. Planungs-Engine (mittel)

| # | Befund | Vorschlag |
|---|---|---|
| B-1 | `MoonDown` ≤ 0 (Original, §2) vs. `moonSafe` < 0 (`moon.md`): bei 0° Slot zugeteilt, aber keine Zeile wählbar. | Einheitlich ≤ 0. |
| B-2 ✔ | Pass 3: `accessible_r` wird vor 3a berechnet und nicht nachgeführt → 3a-Reserve wird doppelt ausgezahlt (Überbuchung früh untergehender Ziele). Im Original genauso, in der Spec nicht erwähnt. | Kompatibilitätsmodus: dokumentieren; Produktiv: nach 3a neu berechnen (A-13 neu). |
| B-3 | Blockanfang-Fallback prüft nur `CanImage[s]` für mehrere Slots; auch Transit- und vorgefilterte Einheiten kommen als Ersatz in Frage. | CanImage für alle Slots, Transit/Prefiltered ausschließen. |
| B-4 | A-7 unscharf: `pick` erhöht den Filterzähler auch, wenn die Belichtung verworfen wird; `fits` rechnet ohne Download; kürzere Zeile wird nicht probiert; „Ende“ mehrdeutig. | `pick` mit `D ≤ blockEnd − t` filtern, Zustand erst nach Annahme; „Ende = Blockende“. |
| B-5 | Kompatibilitätsmodus unvollständig: Prioritäts-Gleichstand nach Projektname, PreClaim in Zeilenreihenfolge, Tier-Gleichstand nach Einfügeordnung, globales `lastEs`, Panel-Lock mit Listenposition, Nachtgrenzen inkl. Einheiten ohne Arbeit. | Verbindliche Liste der Kompatibilitätsschalter in §11. |
| B-6 | Orakel-Adapter nicht spezifiziert: `IsExposureSetMoonSafe` hat keinen Slot-Index (UtcStart-Zuordnung), „No Moon“ wird am Profilnamen erkannt, `HorizonProfile` braucht Plugin-Typen, `RunSchedule` ignoriert Sortierkette, `PaintTrace` statisch; Grid liefert nur `peakAltDeg`. | Abschnitt „Adapter Grid → TargetProfile/TimeSlot, Log → entries“ in §11. |
| B-7 | „Sonst letzte Zeile wiederholen“ gilt im Original nur mit Bonus; Nachtende-Kulanz im Original global (letzter nutzbarer Slot), nicht „letzter Block“; kein Slew nach Leerlauf auf derselben Einheit. | Bedingungen wörtlich übernehmen, Slew nach Leerlauf festlegen. |
| B-8 | Filterwahl: ohne Filterwechsel kein aktives Panel → keine Panel-Rotation; Zyklus erkennt Zeilen am Filternamen; Mond-oben-Pool bei nur LA-Zeilen auf aktivem Panel anders als beschrieben. | §9 präzisieren (oder als Abweichung korrigieren). |
| B-9 | Pass 0b, enforceMinimum, gapFill verlängern per `CanImage` (A-6 nur Pass 0); `decrementWork`-Hint in 0b fehlt in der Spec. | Ergänzen, A-6 konsequent. |
| B-10 | Nachtfenster-Ende im Original aufgerundet; Flip-Reihenfolge `pick` → Flip lässt t springen; `tM` bei Mosaik ohne Panel-Einheiten mehrdeutig; Laufzeitzustand (letzter AF, Filterzyklus, Flip erledigt) fehlt in `PlanInput` für Neuplanung. | Flip vor `pick`; `tM` je aktivem Panel; Laufzeitzustand als Eingabe. |
| B-11 | Panel-Positionen: Original rechnet Höhe/Mondabstand am Projektzentrum für alle Panels. | Festlegen (Zentrum für Kompatibilität, Panel produktiv). |
| B-12 | `effort.md` `nMin` ist keine echte Untergrenze (Greedy über Nächte); Pflicht-Test 2 gilt nur ohne Overheads; 180 Nachtplanungen je Projekt täglich × alle Projekte ohne Laufzeitziel. | „Schätzung“ nennen; Test mit Overheads 0; Stichprobe (jede 3.–7. Nacht) + Laufzeitziel. |
| B-13 | `afEveryMin = 0` / `ditherEvery = 0` undefiniert (Division durch 0); minAlt = maxAlt im Mondprofil. | 0 = aus; Validierung minAlt < maxAlt. |
| B-14 | Mosaik mit „Panels getrennt planen“ (Standard) bekommt proportional ein Vielfaches der Zeit eines Einzelfelds; Mindestzeit je Panel. | Anteil je Projekt deckeln oder Standard aus; bewusst entscheiden. |

## C. NINA-Plugin (mittel)

| # | Befund | Vorschlag |
|---|---|---|
| C-1 | Aktion je Eintragsart fehlt (`filter`, `wait`, `meridian_flip`, `autofocus_hint`, `end`): wer wartet vor dem Flip, Zeitverschiebung nach echtem Flip im zeitgeführten Playback. | Tabelle Eintrag → Aktion; `wait`/`meridian_flip`/`autofocus_hint` nur Zeitmarken, NINA-Trigger entscheidet. |
| C-2 | Flip-Erkennung (Pier-Seite vor/nach Triggern) und Flipdauer-Messung offen; Planungs-tM vs. `TimeToMeridianFlip` der Montierung (±1 Belichtung). | Über Pier-Seite erkennen; Toleranz dokumentieren. |
| C-3 | Block-IDs je Planrevision nicht eindeutig; Aufnahmen/Ereignisse ohne `nightPlanId`; `/plan` ohne `sessionId`. | Block-ID als UUID oder `nightPlanId` mitsenden. |
| C-4 | Pflichtfelder: `fileName` bei `aborted/failed`, `pierSide` „unbekannt“, `rotationDeg` ohne Plate-Solve je Aufnahme. | Bedingt optional; Quellen festlegen. |
| C-5 | Auslesemodus: „Index und Name“ nicht in Verträgen; Namen in Beispielen uneinheitlich; Flats-Auslesemodus nicht gesetzt. | Name → Index aus Kameraliste; unbekannt → überspringen; für Flats setzen. |
| C-6 | Flats: „Fortsetzen bei nächster offener Kombination“ ohne Status je Kombination; Primärziel und `$$TARGETNAME$$`-Namensregel für Dateikopie; Dark-Flats je Winkel mehrfach; Kopien melden? | Status + Dateianzahl je Kombination; Primärziel = erstes Ziel; Kopien nicht melden. |
| C-7 | Leere Neuplanung mitten in der Nacht beendet die Nacht und startet Flats zu früh; `sessionEndUtc` fehlt im Plan. | `sessionEndUtc` in Plan; Schleife bis Dunkelheitsende. |
| C-8 | Lease-Zustandsmaschine im Plugin (Verlust, Neustart derselben Session, 409 bei nachgemeldeter Offline-Session → Endlosschleife); Offline-Modus friert Lease/Session nicht ein → Alarme und Übernahme. | Zustandsmaschine + `sessionId` persistieren; Offline beim Einschalten melden, keine Alarme. |
| C-9 | Testprotokolle: NINA-Simulatoren haben keine Simulatoruhr (Tests nur nachts mit passenden Zielen); fehlen: Transit, Neuplanung a/b/c, Offline-Jint, Lease, 401, Filter nicht gefunden, Neustart in Block/Flats, Auslesemodus; Ergebnisse nicht maschinell auswertbar; Log-Präfix `[NinaPm]` vs. `NINA-PM |`. | Test-Server-Modus („Blöcke ab jetzt + 2 min“, Ziel-RA für Flip); P-13…P-22; `result.json`-Schema. |
| C-10 | AP-S2b prüft nur schon erprobte Muster; die neuen Risiken (ImageSaved für Lights, Flip-Werte aus Profil, Trigger-Filter nach Typ, eigener Abbruch-Token) nicht. | Umfang von AP-S2b darauf ausrichten. |
| C-11 | FilterMatcher: FK normalisiert Leerzeichen/Bindestriche, execution.md nicht; gilt auch für Flats? | Eine Regel mit Tabellentests, auch für Flats. |
| C-12 | Persistenz uneinheitlich (`flat_combinations.json` vs. SQLite-Outbox); Nacht-Schlüssel darf nicht aus lokaler Windows-Zeit kommen; Uhrabweichung ohne Grenzwert. | Ein Ort/Format; Nacht-Schlüssel nur aus Bootstrap; Grenzwert. |

## D. Fachlogik (mittel/niedrig)

| # | Befund | Vorschlag |
|---|---|---|
| D-1 | Geteilte Transit-Beobachtung: Aufnahme gehört zu genau einer Zeile, Projekte können abweichende Transit-Zeilen haben. | Gewinnerregel + n:m-Zuordnung zu Beobachtungen. |
| D-2 | User legt nach Freigabe bis zu 10 Transits fest, Bestätigung standardmäßig aus, Transit hat Vorrang → verdrängt alle anderen. | Bestätigung standardmäßig an oder Kontingent. |
| D-3 | Saisonende „letzte Nacht … nach der 30 Nächte“ trifft bei zwei Pausen die nächste Saison; Ziel aktuell außerhalb der Saison offen. | „erste Nacht ab heute“; Fall außer Saison. |
| D-4 | „Nachtende“ undefiniert (Mittag–Mittag vs. Dämmerung); Heartbeat-/Stale-Schwellen uneinheitlich (3/10/30 min, `tick-hourly`); FA-SYN-07 „nur Diagnose“ steuert aber Lease/Alarme. | Zentrale Tabelle aller Zeitschwellen; Stale in `tick-5min`. |
| D-5 | Verworfen = Korrektur je Nacht **plus** einzeln verworfene Aufnahmen → doppelt abziehbar; Bonus nicht unterscheidbar. | Gegenseitig ausschließen oder anrechnen. |
| D-6 | Exoplaneten-Projekt erbt Deep-Sky-Standards (astronomisch, 30°), Suche nutzt nautisch → Baseline geht verloren. | Eigene Standards aus Suchfilter. |
| D-7 | Admin-Projekte „automatisch freigegeben“, aber unvollständige Entwürfe möglich; Projektstatus ohne Zustandsdiagramm; *Archiviert* vs. „gelöscht (Archiv)“. | Zustandsdiagramm Projektstatus; Pflichtprüfung beim Aktivieren. |
| D-8 | Rig-/Kamerawechsel mit vorhandenen Aufnahmen zählt fremden Maßstab weiter. | Warnung/Duplizieren anbieten. |
| D-9 | Dual-Rig auf einer Montierung nicht abbildbar. | In 2.3 ausschließen. |
| D-10 | Autofokus-Unterdrückung im Transit (FA-NIN-05 löst alle Trigger aus). | Siehe A-13. |
| D-11 | Owner ausstehend (Einladung offen/verfallen) verletzt „immer genau ein Owner“. | Zustand „Owner ausstehend“ + Hinweis an Super User. |
| D-12 | `filter_stuck`-Warnung schlägt bei Einfilter-Projekten an. | Ausnehmen. |
| D-13 | Kleinere Unschärfen: Integrationszeit mit/ohne Bonus (8.4 vs. FA-PRJ-10), Flats-Klammer in 8.4, Nachtdatum „16./17.09.“, Nacht-Ausnahme für Zeilen-Schalter, Datenmodell-Attribute (mustBeDown, k, Autofokus im Fenster). | Bereinigen. |

## E. Konsistenz (niedrig, schnell zu beheben)

`transit_observation.locked_at` fehlt im Schema ✔ · `capture.ra_deg/dec_deg` und Metrik-Schlüssel API ↔ Schema · Fehlercodes `409 in_use`, `token_expired` nicht in errors.json · `EffortEstimate`-Felder Spec ↔ TK ↔ Schema · Seed-Feldnamen (Mondprofil, Flats) ↔ API · falsche IDs in execution.md (FA-NIN-08 → -12, -15 → -27) · AP-11a liest `project_history` (gibt es nicht) · AP-60 FA-DIS in FK 6.13 · Mosaik-Scheduler R1 vs. AP-22 „G12“ · AP-04b wartet auf H-12 (enthält NINA-Kopplung) · Stale-Schwelle 10/30 min · Flat-Kombination ohne Auslesemodus (TK 10.3) · `public` fehlt in `Action` · `session.report` fehlt in TK 7.7 · `dark_flat_count` Standard · S-14/S-15-Zuschnitt · Schema-Kopf nennt FK 1.9/TK 1.6 · Heartbeat-Beispiel `engineVersion 1.0.0` vs. 3.2.0 · `filter_not_found` fehlt in `sessionEventKinds` · Tagesschleifen-Bedingung execution.md ↔ FA-NIN-07 · Pfade TK 3.1 (`tools/reference-data`, `docs/03_api`, `apps/worker`) ↔ Paket · UUID v4/v7 · `ON DELETE` „nicht vorhanden“ vs. „nicht genutzt“.

## F. Umsetzbarkeit mit Claude Code

| # | Befund | Vorschlag |
|---|---|---|
| F-1 | Alle Briefs: „Ziel“ wiederholt nur den Titel; UI-Briefs ohne Feld-/Rechte-Checklisten (AP-09b 6 Bildschirme, L). | 2–3 Sätze Ergebnis je Brief; Checklisten; AP-09b teilen. |
| F-2 | Keine Status-Spalte je AP; Claude Code erkennt nicht, was abgenommen ist. | Status + Datum in `work-packages/README.md` (Sven pflegt) oder GitHub-Labels. |
| F-3 | Einstieg Sitzung 1 unklar (Paketquelle, legacy-Quelle, Zielrepo). | `START.md` mit Prompt für Sitzung 1. |
| F-4 | Leseabschnitte nur als Kapitelnummern; fehlende Hinweise auf errors.json, enums.json, seed README, rules/ui.md, execution.md; „ADR-Vorlage“ existiert nicht. | `docs/concept/INDEX.md` (Abschnitt → Zeilen, per Skript) und fehlende Leseangaben; ADR-Vorlage. |
| F-5 | Doppelte Vertragsquelle (zod → OpenAPI vs. JSON-Schemas „aus Beispielen“, NSwag vs. Schemas). | zod = Quelle; OpenAPI/JSON-Schema generiert; NSwag aus `openapi.yaml`. |
| F-6 | Token-API (`POST /web/v1/nina-instances`) keinem AP zugeordnet, AP-14a braucht Tokens. | In AP-14a. |
| F-7 | AP-05 verlangt i18n-Schlüssel je Fehlercode, i18n kommt erst in AP-06a; AP-10/13d Web-Komponenten ohne AP-06a-Abhängigkeit. | `errors.*` in AP-05; Abhängigkeiten ergänzen. |
| F-8 | Unnötige Sperren: H-10 (astropy lokal) blockiert Engine-Kette, H-16 blockiert alle UI-Pakete, AP-S2b steht erst nach AP-15. | astropy im CI mit gebündelten IERS-Daten; H-16 nicht blockierend; AP-S2b früh. |
| F-9 | Vorrangregel ohne Brief/CLAUDE.md; wer taggt Releases; GitHub-Scope `workflow`; H-08 auch für AP-04a; H-05 vollständige Parameterliste. | Ergänzen. |

## Empfohlene Reihenfolge

1. **A-1 bis A-5** (Fehler/Widersprüche, schnell).
2. **A-6 bis A-9 und F-2/F-3/F-4** (Paket arbeitsfähig machen).
3. **A-10 bis A-15** (fachliche Regeln: Fairness bei Neuplanung, Restposten, Plugin-Neuplanung, Transit, Bildzuordnung).
4. **B und C** in `allocation.md`/`execution.md` nachziehen, **D/E** bereinigen.
