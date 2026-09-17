# Spezifikation: Ausführung im NINA-Plugin

Verbindlich für AP-S2b, AP-16a–h, AP-44 (Transit), AP-50 (Flats). Bezug: Fachkonzept 6.8–6.10 (FA-SYN-*, FA-NIN-*, FA-EXO-20…24), 8.6, 8.8; Technisches Konzept 5.6, 6.6, 7.3, 7.6, 10.
**Grundlage:** `Instructions/TargetInstructionSet.cs`, `AstroPMChildItems.cs`, `AstroPMExposureTriggers.cs`, `AstroPMLoopCondition.cs`, `AstroPMDailyLoopCondition.cs`, `AstroPMWaitForTime.cs` des Astro-PM-NINA-Plugins (MIT, Commit `5dd621d`). Übernahme von Code ist erlaubt; Herkunft im Kommentar, Hinweis in `THIRD_PARTY_NOTICES.md`, kein Name „Astro PM“ in Oberfläche/Bezeichnern.
**Aufteilung:** Muster aus diesem Dokument leben im Adapter `NinaPm.Nina` (net8.0-windows). Planung, API, Outbox, Lease- und Nacht-Zustandsmaschine, Filterauflösung, Flat-Kombinationen und Playback-Logik im Kern `NinaPm.Core` (net8.0, auf Linux testbar, Schnittstellen `ICameraControl`, `IMountControl`, `IFilterWheelControl`, `IRotatorControl`, `ISequenceHost`).

## 1. Sequenz-Bausteine (Kategorie „NINA-PM“, Anzeigenamen über i18n)

| Baustein | Art | Release | Zweck |
|---|---|---|---|
| **NINA-PM-Anweisungen** (`NinaPmContainer`) | Container (`SequenceContainer`, `IDeepSkyObjectContainer`) | R1 | führt je Aufruf **einen Block** aus; enthält die Flat-Boxen (R5) |
| NINA-PM Nachtschleife | Bedingung | R1 | wahr, solange Blöcke übrig sind, ein Block läuft, das Nachtfenster laut Plan (`sessionEndUtc`) noch nicht vorbei ist, die lokale Session **veraltet** ist (Neuaufbau, §2) oder Flats ausstehen |
| NINA-PM Ziele aktualisieren | Anweisung | R1 | Bootstrap/Ziele sofort abrufen |
| NINA-PM vor/nach jeder Belichtung | Trigger mit Anweisungsbox | R1 (FA-NIN-16) | vor/nach jeder Plugin-Belichtung |
| NINA-PM vor/nach Zielwechsel | Trigger mit Anweisungsbox | R1 (FA-NIN-16) | nach Slew/Zentrieren/Rotieren vor Guiding bzw. nach Blockende |
| NINA-PM Tagesschleife | Bedingung | R5 (FA-NIN-07) | Auslieferungsmenge für mindestens eine der nächsten 3 Nächte nicht leer, höchstens bis Enddatum bzw. Höchstzahl Nächte (Standard 14) |
| NINA-PM Warten auf Zeit | Anweisung | R5 (FA-NIN-26) | Uhrzeit oder Dämmerung mit Versatz, Tageswechsel-Zeit |

Beispielsequenzen (FA-NIN-25): „Eine Nacht mit Safety“ (R1) wie „Empfohlene Sequenz“ in FK 6.9 – Start → Schleife mit *Nachtschleife* { *NINA-PM-Anweisungen* } parallel zu *Solange unsicher – sichern & warten* → Ende; globale Trigger *Meridian Flip*, *Autofokus*, *Zentrieren nach Drift*. „Mehrere Nächte“ und „mit Flats“ (R5). *Remote Play/Pause* des Originals wird nicht übernommen (FK 2.3).

## 2. Container-Grundmuster
- `Execute` wird **überschrieben**; `base.Execute` wird nicht aufgerufen. Ein nicht exportiertes Platzhalter-Kind verhindert, dass NINA einen leeren Container überspringt; beim Serialisieren entfernen, beim Laden wiederherstellen.
- Ablauf je Aufruf: veraltete Session → zurücksetzen · kein Plan → Plan holen (§3.1) · nächster Block (§3.2) · danach, wenn alle Blöcke vorbei **und** `now ≥ flatsNotBeforeUtc`: Flats (§7) · danach, wenn `now ≥ sessionEndUtc`: Status „Session beendet“.
- **Reihenfolge am Nachtende (verbindlich, NIN5-12):** (1) alle Blöcke abgearbeitet oder vorbei → (2) Flats und Dark-Flats, sofern eingeschaltet und `now ≥ flatsNotBeforeUtc` (§7) → (3) `PATCH /sessions/{id} {status: "completed", endedAtUtc, outboxPending}` (§8, NIN5-7) → (4) `HasBlocksRemaining` liefert **erst im nächsten Aufruf** `false`, und nur wenn `now ≥ sessionEndUtc` ist. Bis `sessionEndUtc` bleibt die Nachtschleife also wahr und plant alle 5 min neu (frei gewordene Zeit, geänderte Ziele); der `PATCH` schließt die Session nur fachlich ab und wird bei einer erneuten Planung durch `PATCH {status: "running"}` zurückgenommen. Damit sind §1, §2, TK 10.3 Nr. 12, FA-NIN-06 und P-22 gleichlautend.
- **Drei Zeitmarken aus dem Plan** (§3.1, TK 7.6): `darknessEndUtc` = Ende der astronomischen Dunkelheit (letzte Belichtung), `flatsNotBeforeUtc` = frühester Flat-Start (Standard = `darknessEndUtc`), `sessionEndUtc` = **Nachtende** = Ende des Nachtfensters (FK 8.1; Nachtschleife, Stale-Schwelle + 2 h, Nachtbericht). Es gilt `darknessEndUtc ≤ flatsNotBeforeUtc ≤ sessionEndUtc`.
- **Sperre gegen Endlosschleifen:** leerer oder fehlgeschlagener Planaufbau → 5 min kein neuer Abruf (Zeitstempel **vor** dem Versuch setzen). Ein **Benutzerabbruch** (Sequenz gestoppt) und die Aktion *Zurücksetzen* (§3.2) heben die Sperre auf; eigene Abbrüche (Transit, Neuplanung) laufen über einen eigenen `CancellationTokenSource` und gelten nicht als Benutzerabbruch.
- **Leerer Plan mitten in der Nacht** (z. B. alle Ziele pausiert): Nachtschleife bleibt bis `sessionEndUtc` wahr; alle 5 min erneut planen (Sperre unten); Flats erst nach `flatsNotBeforeUtc`.
- **Nacht-Schlüssel** nur aus `bootstrap.nights[]` (Mittag–Mittag Standortzeit), nie aus `DateTime.Today`/Windows-Zeitzone.
- **Zwei verschiedene Begriffe (NIN5-4):**
  - *lokale Session **veraltet*** (Plugin-Sicht, löst den Neuaufbau aus): `now ≥ sessionEndUtc + 2 h` **oder** der Nacht-Schlüssel hat sich gegenüber dem gespeicherten Zustand geändert. „Oder“, nicht „und“ – der Schlüssel wechselt erst am lokalen Mittag, die Schwelle `+ 2 h` liegt Stunden davor; mit „und“ würde die Bedingung nie greifen. Wirkung: `sessionId`, `nightPlanId`, Blockindex und `tonight` verwerfen, Plan neu aufbauen (§3.1).
  - Server-Status **`stale`** (`session.status`, TK 6.6): 10 min ohne Heartbeat bei nicht offline gestellter Session. Das ist eine Server-Beobachtung und beeinflusst das Plugin nicht.
- **Uhrzeit:** Abweichung zum Server (`Date`-Header, gleitender Mittelwert) > 5 s → Warnung; > 60 s → keine Blöcke ausführen, Ereignis `error` `clock_skew`.
- `HasBlocksRemaining` darf während eines laufenden Blocks und bei ausstehenden Flats nie `false` werden (NINAs Bedingungs-Watchdog bricht sonst die laufende Anweisung ab).
- **Gesperrte Zustände (verbindlich, NIN-6):** Der Kern hält einen Zustand `blocked { reason, since, recoverable }`. Gründe und Wirkung:

| Grund (`blockedReasons`) | behebbar | Sofortwirkung | Austritt |
|---|---|---|---|
| `lease_lost` | ja | laufende Belichtung zu Ende, `block_end` Grund `lease_lost`, Blockliste eingefroren, danach je Aufruf 60 s warten | Heartbeat mit `leaseLost: false` (§6 → `held`) → Zustand gelöscht, Blockliste aus dem Plan neu aufgebaut |
| `rig_busy` | nein | laufende Belichtung zu Ende, `block_end` Grund `lease_lost` | kein Austritt; Nachtschleife wird **erst im nächsten Aufruf ohne laufenden Block** `false` (nur Simulation anzeigen), Sequenz endet geordnet |
| `token_invalid` (401) | nein | laufende Belichtung zu Ende, `block_end` Grund `error`, Meldung in der Optionsseite, Outbox pausiert (Warteschlange bleibt) | neues Token in den Optionen hinterlegt → Zustand gelöscht; sonst Nachtschleife `false` im nächsten Aufruf ohne laufenden Block |
| `engine_incompatible` (`409 engine.incompatible`, `minPluginVersion`) | nein | keine neuen Blöcke, laufender Block läuft zu Ende (`block_end` Grund `error`), Outbox pausiert, kein Dead-Letter | Plugin-Update; sonst wie `token_invalid` |
| `clock_skew` > 60 s | ja | keine neuen Blöcke, 60 s warten, erneut abgleichen | Abweichung ≤ 5 s → Zustand gelöscht; nach 10 Versuchen Nachtschleife `false` (im nächsten Aufruf ohne laufenden Block) |
| `plan_failed` / leerer Plan | ja | 5-min-Sperre (oben), warten bis `sessionEndUtc` | erfolgreicher Planaufbau **oder** *Zurücksetzen* durch den Benutzer (hebt die Sperre auf) |

  Im Zustand `blocked` **wartet** der Container 60 s (abbrechbar), statt sofort zurückzukehren – sonst ruft NINA ihn in Dauerschleife auf.
  **Kein Abbruch mitten im Block (verbindlich, NIN5-2):** Auch bei `recoverable = false` beendet das Plugin zuerst die laufende Belichtung und den laufenden Block (Box *nach Zielwechsel*, `block_end` mit Grund `lease_lost` bzw. `error`, Meldung der Aufnahme in die Outbox). `HasBlocksRemaining` bleibt dabei `true`. Erst der **nächste** Aufruf, bei dem kein Block läuft, liefert `false`; dann beendet sich die Sequenz geordnet (Ereignis `error` mit dem Grund). Damit gilt die Regel „`HasBlocksRemaining` darf während eines laufenden Blocks nie `false` werden“ auch für `rig_busy` und `token_invalid` (P-18).

## 3. Plan und Neuplanung (FA-SYN-03)

### 3.1 Planaufbau
`GET /bootstrap` (bei Fehler Cache) → `GET /targets` (ETag) → `POST /plan {night, reason: initial, sessionId?, targetsEtag, pendingCaptures}` → `POST /sessions` (Lease, §6) mit `nightPlanId`. Offline: Jint-Plan aus Cache (§8).

### 3.2 Wann neu geplant wird
| Zeitpunkt | Auslöser | Wirkung |
|---|---|---|
| vor jedem Block | `GET /targets` liefert neues ETag **oder** Bootstrap `settingsVersion` gestiegen **oder** Blockstart liegt > 10 min hinter Plan | `POST /plan {reason: refresh, startAtUtc = max(now, geplanter Blockstart), tonight}` |
| im Block alle 15 min | neues ETag | Fall a/b/c unten |
| nach Neustart/Unterbrechung | immer | `reason: resume`; **Blockindex aus dem neuen Plan** (erster Block mit `endUtc > now`), nicht aus `ninapm.db`; `sessionId`/`nightPlanId` aus `ninapm.db` bleiben (NIN-8) |
| *Zurücksetzen* | Benutzer | `reason: reset`, Blockindex 0 |
Sonst gilt der bestehende Plan unverändert (Hysterese).

**Im laufenden Block** (Vergleich alter/neuer `targets`):
- (a) aktuelles Projekt/Panel/aktuelle Zeile entfällt (pausiert, abgeschaltet, gelöscht, fertig durch Korrektur, Auslieferung aus) → laufende Belichtung zu Ende, Block beenden (`block_end` Grund `target_removed`), neu planen mit `startAtUtc = now`.
- (b) neuer bzw. geänderter `locked` Transit, dessen Fenster (inkl. Slew-Vorlauf) vor Blockende beginnt → Transit-Unterbrechung §5.
- (c) alle übrigen Änderungen → laufender Block behält seine Einträge; neuer Plan gilt ab dem nächsten Block.

**Planwechsel:** `tonight` = `{pastBlocks, exposedSecByUnit, lastAutofocusUtc, filterCycle, flipDoneByPanel, currentUnitId}` aus dem lokalen Protokoll. Neuer Blockindex = erster Block des neuen Plans mit `endUtc > now`. Hat dieser dasselbe Projekt/Panel wie der gerade beendete Block und liegt kein Leerlauf dazwischen, entfällt der Slew (nur Guiding läuft weiter). UI (Blockliste, Zähler) wird aus dem neuen Plan aufgebaut; bereits erledigte Blöcke bleiben als „erledigt“ sichtbar. Ereignis `plan_rebuilt` mit alter/neuer `nightPlanId`.

## 4. Block ausführen

### 4.1 Ablauf
1. Vergangene Blöcke (`endUtc ≤ now`) überspringen (`block_skipped` Grund `elapsed`); Blöcke ohne `expose`/`expose_series` überspringen (`no_exposures`).
2. Bis Blockstart warten (10-s-Takt, abbrechbar durch *Block überspringen*); währenddessen Heartbeat weiter (§6).
3. Machbarkeit jetzt (Höhe, Dunkelheit mit Engine-Werten aus dem Plan) → sonst überspringen (`not_viable`).
4. `SetTarget`: Container-`Target` (Name = Projektname bzw. „Projekt – Panel-Label“, J2000-Koordinaten, Positionswinkel) setzen und `DeepSkyObject` synchronisieren; Koordinaten in `CenterAfterDriftTrigger` (`AttachNewParent`, `Coordinates`, `SequenceBlockInitialize`) und in die Boxen der eigenen Trigger injizieren.
5. **Slew/Zentrieren:** mit Rotator `CenterAndRotate` auf den Positionswinkel (auch 0°), ohne Rotator `Center`. Wiederholungen 15, 15, 30, 60, 120, 300, 300, 600, 600 s; nicht warten, wenn die nächste Wiederholung nach Blockende läge; danach überspringen (`center_failed`). Ohne Rotator: gemessenen Winkel prüfen (flip-rotation.md §3).
6. Box *vor Zielwechsel* (Trigger aller Vorfahren-Container, inkl. globaler) → Guiding starten (falls verbunden).
7. Einträge abarbeiten (§4.2) bis Blockende → Box *nach Zielwechsel* → `block_end`.

**Gründe für `block_end`** (`enums.json` `blockEndReasons`, genau einer je Block):

| Grund | wann |
|---|---|
| `completed` | alle Einträge abgearbeitet, Blockende erreicht |
| `night_end` | `darknessEndUtc` erreicht, bevor der Block seine Einträge abarbeiten konnte (letzte Belichtung mit `lastOfNight`) |
| `target_removed` | Fall (a) aus §3.2: Projekt/Panel/Zeile entfällt |
| `transit_interrupt` | Fall (b) aus §3.2: Transitfenster beginnt vor Blockende (§5) |
| `user_skip` | Benutzeraktion *Block überspringen* |
| `lease_lost` | `blocked{lease_lost}` oder `blocked{rig_busy}` (§2) |
| `flats` | Block endet, weil `flatsNotBeforeUtc` erreicht ist und Flats vorgehen (§7) |
| `error` | `blocked{token_invalid}`, `blocked{engine_incompatible}` oder unbehandelter Fehler (§2) |

  Gründe für `block_skipped` stehen in `blockSkipReasons` (§4.1 Nr. 1–5).

### 4.2 Eintrag → Aktion
| `cmd` | Aktion im Plugin |
|---|---|
| `slew_center_rotate` / `slew_center` | nur am Blockanfang bzw. Panelwechsel wie §4.1 Nr. 5; als Zeitmarke im Playback |
| `filter` | Filter wechseln (Auflösung §4.4); Zeitmarke |
| `expose` | Belichtung (§4.3) |
| `expose_series` | Transit-Serie (§5) |
| `dither` | `IGuiderMediator.Dither`, nur wenn zwischen letzter und aktueller Belichtung im Plan ein Dither liegt |
| `autofocus_hint` | **nur Zeitmarke**; Autofokus löst NINAs Trigger aus |
| `meridian_flip` | **nur Zeitmarke**; Flip löst NINAs Trigger aus (§4.5) |
| `wait` | bis `atUtc + durationS` warten, sofern die nächste Belichtung sonst zu früh begänne |
| `end` | Block beenden |

**Playback (FA-NIN-12):** *zeitgeführt* = nächster `expose`-Eintrag, dessen `atUtc ≤ now + offset` ist. `offset` ist der **kumulierte Verzug** aus allen Nicht-Belichtungsaktionen (NIN-14): tatsächliche minus geplante Dauer von Flip, Autofokus, Zentrieren (inkl. Wiederholungen), Dither und Download. Der Offset wird nach jeder solchen Aktion fortgeschrieben, ist nie negativ und wird am Blockende auf 0 zurückgesetzt. Damit werden am Ende eines Filterblocks nicht systematisch Belichtungen verworfen und die Filterverhältnisse bleiben erhalten.
- Übersprungene Belichtungen: Ereignis `skipped_timeaware` je Eintrag. Mehr als **3** übersprungene Belichtungen in einem Block → Neuplanung `reason: refresh` bei der nächsten Gelegenheit (der Plan passt offensichtlich nicht mehr).
- *sequenziell* = strikt nächster `expose`, kein Offset.
- Beide enden am Blockende; eine Belichtung beginnt nur, wenn `now + exposureS + downloadS ≤ blockEnd`. **Einzige Ausnahme:** ein Eintrag mit `lastOfNight` (Nachtende-Kulanz). Einen Überhang in den Folgeblock gibt es **nicht** (`allocation.md` §8.1/A-30 entfällt) – der Blockschluss ist hart.

### 4.3 Belichtung und Aufnahme-Meldung
- **Trigger-Walk (keine Kind-Elemente):** internes Belichtungselement erzeugen, `AttachNewParent(container)` (damit NINAs Flip-Trigger über `nextItem.Parent` die Zielkoordinaten findet). Reihenfolge: Filter wechseln (vor den Triggern, damit „AF nach Filterwechsel“ den neuen Filter sieht) → Dither laut Plan → **Pier-Seite und Zeitstempel merken** (`pierBefore`, `tTriggers`) → `RunTriggers(previous ?? container, item)` auf **allen Vorfahren-Containern** → **Pier-Seite erneut lesen und vergleichen** (§4.5; NINAs Flip-Trigger läuft *in* `RunTriggers`, deshalb wird **vorher** gemessen) → Belichtung → `RunTriggersAfter(item, container)` auf allen Vorfahren (danach Pier-Seite ein zweites Mal prüfen, falls ein Trigger dort geflippt hat). Triggerfehler protokollieren, nicht abbrechen.
- Element implementiert `IExposureItem` (ImageType `LIGHT`, Gain, Offset, Binning, ExposureTime) und `GetEstimatedDuration() = exposureS`.
- **Bildpipeline (verbindlich, NIN-19, Original `AstroPMChildItems.cs:478/487`):** `CaptureImage` → `_imageHistoryVM.Add(MetaData.Image.Id, "LIGHT")` → `ToImageData` → `PrepareImage` → Messwerte übernehmen (NIN5-10: `metrics.hfr` und `metrics.stars` aus der **Sterndetektion** des `PrepareImage`-Ergebnisses – `IRenderedImage.RawImageData.StarDetectionAnalysis.HFR`/`DetectedStars`; `metrics.meanAdu` aus `imageData.Statistics.Mean`; `metrics.sensorTempC` aus `MetaData.Camera.Temperature`; fehlt ein Wert oder ist die Sterndetektion abgeschaltet → **Feld weglassen**, nicht 0 melden) → `_imageHistoryVM.PopulateStatistics(...)` → Ziel-Metadaten setzen (Name, J2000-Koordinaten, Positionswinkel) → `ImageSaveMediator.Enqueue`. Ohne den Eintrag in die Bildhistorie zählen NINAs Trigger „Autofokus nach n Belichtungen“ und „nach HFR-Anstieg“ nicht.
- **Auslesemodus:** Eintrag liefert `readoutMode` (Name) und `readoutModeIndex`. Plugin sucht den Namen in `ICameraMediator.GetInfo().ReadoutModes` (exakt, ohne Groß-/Kleinschreibung) → Index; Name nicht gefunden → `readoutModeIndex` verwenden, wenn gültig, sonst Belichtung überspringen, Ereignis `readout_mode_not_found`. Setzen mit `SetReadoutModeForNormalImages`.
- **Zuordnung:** Das Element erzeugt vor der Belichtung `captureId` (UUID v7). Nach `CaptureImage` liefert NINA `MetaData.Image.Id` (int); das Plugin registriert `Image.Id → captureId` **vor** `ImageSaveMediator.Enqueue`. `ImageSaved` mit bekannter `Image.Id` → Meldung `result: saved`, `fileName` = Dateiname ohne Pfad. Kein `ImageSaved` binnen 120 s nach Enqueue → `result: failed`, Ereignis `warning` `image_not_saved`. Abgebrochene Belichtung → `aborted`. Lokales Zählen (Offline, Flat-Tracking) erst nach `saved`.
- **Meldungsfelder:** `nightPlanId`, `blockId` (UUID), `rotationDeg` = Positionswinkel des letzten Plate-Solve im Block (sonst Soll), `pierSide` aus `ITelescopeMediator` (`east`/`west`, unbekannt → `null`), `rotatorMechDeg` = **gemessener** mechanischer Winkel aus `IRotatorMediator.MechanicalPosition` (ohne Rotator 0; bei Flats dagegen der eingefrorene Repräsentant der Kombination, §7 und `contracts/nina/README.md`), `raDeg/decDeg` = Soll-Koordinaten des Panels.

### 4.4 Filterauflösung (FA-NIN-27, FK 8.6, Kern)
Normalisieren (trim, klein, Leerzeichen/Bindestriche/Unterstriche entfernen) → exakter Treffer → sonst **eindeutiges** Präfix in beide Richtungen → sonst „nicht gefunden“: Belichtungen der Zeile überspringen, Ereignis `filter_not_found`, Hinweis höchstens einmal je 12 h je Filter. **Nie** durch den gerade eingelegten Filter belichten. Ohne Filterrad (OSC, leere Filterliste): ohne Wechsel belichten. Dieselbe Regel gilt für Flats (nicht gefunden → Kombination überspringen, `flat_combination.status = skipped`). Tabellentests im Kern.

### 4.5 Meridian-Flip und Rotation
- Flip führt NINAs *Meridian Flip*-Trigger aus. Der Plan enthält den Flip nur zur Zeitplanung (flip-rotation.md); NINA entscheidet nach `TimeToMeridianFlip` der Montierung (±1 Belichtung Abweichung zulässig).
- **Erkennung:** `pierBefore` (vor `RunTriggers`, §4.3) ≠ Pier-Seite danach → Flip erfolgt; Dauer = Laufzeit dieses `RunTriggers`-Aufrufs (`now − tTriggers`); Ereignis `flip {durationS, pierSideBefore, pierSideAfter}`; `flipDoneByPanel` setzen; Playback-Verschiebung §4.2. Dieselbe Prüfung nach `RunTriggersAfter`. Ist die Pier-Seite unbekannt (`null`), gilt ein Flip **nur** dann als erkannt, wenn **beide** Bedingungen zutreffen (NIN5-1):
  1. der Positionswinkel eines **eigenen Plate-Solve** vor und nach `RunTriggers` unterscheidet sich um `|Δ| mod 360 ∈ [150°, 210°]` (≈ 180°), und
  2. die Laufzeit dieses `RunTriggers`-Aufrufs beträgt mindestens `0,5 · flip_duration_s` des Rig-Profils.

  Ein Vorzeichenwechsel des Stundenwinkels allein ist **kein** Flip-Kriterium: der Stundenwinkel wechselt am Meridian immer das Vorzeichen, auch bei Gabelmontierungen und bei GEM mit Pause vor dem Meridian. In diesem Fall wird nur die Warnung `flip_undetected` gemeldet, `flipDoneByPanel` bleibt **unverändert** und der Plan-Flip bleibt offen. Ist kein Plate-Solve verfügbar (kein Plate-Solver konfiguriert), gilt derselbe Fall.
- Nach dem Flip: mit Rotator erneut `CenterAndRotate` auf den Positionswinkel; ohne Rotator Winkel prüfen (modulo 180°) → `rotation_mismatch`. Der Plan enthält dafür einen eigenen `slew_center_rotate`/`slew_center`-Eintrag direkt nach `meridian_flip` (`flip-rotation.md` §2); `meridianFlip.durationS` deckt nur den Flip selbst. Weicht die Flipzeit > 1 Belichtung vom Plan ab, bei nächster Gelegenheit neu planen (`reason: refresh`).
- Heartbeat meldet Flip-Profilwerte und ob der Trigger in der Sequenz (Container-Vorfahren oder globale Trigger) vorhanden ist (FA-NIN-24).

## 5. Transit (AP-44, FA-NIN-20/21, FA-EXO-20…24)
- **Vorlauf:** `blocks[kind=transit].startUtc` **ist der Fensterbeginn** (`transitStartUtc` aus `targets`), nicht der Slew-Beginn (NIN5-5, TK 7.6, `transit.md` §3). Der Slew-/Zentrier-Vorlauf `slewCenterS + 60 s` liegt **davor**, im vorhergehenden regulären Block: dessen `endUtc` ist höchstens `startUtc − slewCenterS − 60 s`. Das Plugin zieht den Vorlauf also **nicht** noch einmal von `startUtc` ab, sondern beginnt Slew/Zentrieren sofort nach dem Ende des Regelblocks. Der Fensterbeginn kommt aus dem Plan und zusätzlich aus `targets`; in der letzten Stunde vor dem Fenster holt das Plugin `targets` alle **5 min** statt 15 min, damit eine kurzfristige Festlegung nicht zu spät auffällt. Vor jeder Belichtung prüft es `transitStartUtc − slewCenterS − 60 s ≤ now + exposureS + downloadS`. Wenn ja: Belichtung nur beginnen, wenn sie vorher endet; läuft eine Belichtung bereits und würde später enden → **abbrechen über den eigenen `CancellationTokenSource`** des Belichtungselements (`ICameraMediator.AbortExposure` nur als Rückfall, wenn der Task nach 5 s nicht endet), Meldung `aborted` (OP-12).
- **Ausführung im selben Container** (kein eigener Container): Block `kind: transit` → Slew/Zentrieren → **Filter der Transit-Zeile setzen (§4.4) und Auslesemodus setzen (§4.3) – einmal vor der Serie** → Guiding → `expose_series`: Schleife von Belichtungen der Transit-Zeile bis `untilUtc`, unabhängig von Anzahl/Planungsbedarf; jede Aufnahme mit `transitObservationId`; kein Dither, kein weiterer Filterwechsel.
- **Trigger im Transit (Mechanismus, NIN-12):** `SequenceContainer.RunTriggers` ist alles-oder-nichts. Das Plugin iteriert deshalb – wie das Original für „nach Zielwechsel“ (`TargetInstructionSet.cs:1480/1545`) – selbst über `GetTriggersSnapshot()` jedes Vorfahren-Containers und ruft `ShouldTrigger`/`Execute` nur für die **erlaubten** Trigger auf.
  - **Kontext-Parameter (verbindlich, NIN5-3):** Beide Aufrufe bekommen als Kontext den **Plugin-Container**, nicht `null` und nicht den Vorfahren:

    ```
    var ctx  = this;                       // NinaPmContainer
    var prev = lastExecutedItem ?? ctx;    // vorheriges Element, sonst der Container selbst
    if (await trigger.ShouldTrigger(prev, item))
        await trigger.Execute(ctx, token, progress);
    ```

    NINAs *Meridian Flip*-Trigger holt die Zielkoordinaten über diesen Kontext (`context` → `IDeepSkyObjectContainer.Target`); mit `null` oder einem fremden Vorfahren slewt er ins Leere – genau der Fallstrick, den der Original-Kommentar in `TargetInstructionSet.cs:1410–1417` beschreibt. Der Container ist `IDeepSkyObjectContainer` und trägt das aktuelle Ziel (§4.1 Nr. 4), deshalb ist `this` der richtige Kontext.
  - **Allowlist/Blocklist:** unterdrückt werden Trigger, deren Typname (`GetType().Name`) `autofocus` enthält (Vergleich **ohne Groß-/Kleinschreibung**, `IndexOf(..., StringComparison.OrdinalIgnoreCase)`), sowie `CenterAfterDriftTrigger`, sofern `observation.allowAutofocus` bzw. `allowRecenter` nicht gesetzt sind; Meridian-Flip läuft **immer**. Die Typnamen der NINA-Kerntrigger (`AutofocusAfterTimeTrigger`, `AutofocusAfterExposuresTrigger`, `AutofocusAfterHFRIncreaseTrigger`, `AutofocusAfterTemperatureChangeTrigger`, `AutofocusAfterFilterChangeTrigger`) sind aus der NINA-Version 3.1 abgeleitet und **in AP-S2b gegen die installierte NINA-Version zu bestätigen** (Spike-Ergebnis in `docs/adr/`); sie dienen nur der Anzeige und der Protokollierung. Maßgeblich für die Unterdrückung ist immer die Namens-Heuristik, damit auch Fremd-Plugins erfasst werden. Die erkannte Liste wird in den Optionen sichtbar gemacht. Dieselben Namen stehen in `ops/plugin-test-protocol.md` (P-13).
  - Eigene Trigger-Sets (*vor/nach jeder Belichtung*), die Autofokus-Anweisungen enthalten, werden im Transit **übersprungen** (Ereignis `trigger_suppressed` mit `box`-Angabe).
  - Unterdrückte Trigger → Ereignis `trigger_suppressed {type}`.
- **Flip im Fenster:** Plan enthält keinen Flip-Eintrag, Diagnose `flip_in_transit` (Plugin zeigt Warnung); führt NINA trotzdem einen Flip aus, wird er gemeldet und die Serie danach fortgesetzt.
- Nach `untilUtc`: `transit_end`, Neuplanung `reason: refresh`, Rückkehr zu regulären Zielen.

## 6. Session, Lease, Heartbeat (TK 5.6)
- **Heartbeat** läuft **unabhängig von der Sequenz** (Hintergrund-Timer, 60 s) sobald das Plugin verbunden ist; Zustände `running | idle | paused | flats | offline`.
- **Lease** 3 min (`rig_lease.lease_until`, eine Zeile je Rig, Schema 1.9+), jeder Heartbeat mit `sessionId` verlängert. Zustandsmaschine im Kern mit vollständigen Übergängen (NIN-7):

| Von | Auslöser | Nach | Wirkung |
|---|---|---|---|
| `none` | `POST /sessions` gesendet | `acquiring` | – |
| `acquiring` | `201` | `held` | Blöcke dürfen laufen |
| `acquiring` | `409 session.rig_busy` | `none` | nur Simulation anzeigen, `blocked{rig_busy}` |
| `held` | Heartbeat-Antwort `leaseLost: true` | `lost` | laufende Belichtung zu Ende, keine neuen Blöcke, Ereignis `lease_lost` |
| `held` | 3 Heartbeats hintereinander ohne Antwort (≥ 3 min) | `lost` | wie oben; die Lease ist serverseitig verfallen |
| `lost` | erster erfolgreicher Heartbeat bzw. `PATCH /sessions/{id}` mit `status: running` | `reacquiring` | – |
| `reacquiring` | Antwort mit `leaseLost: false` | `held` | weiter wie gewohnt, Ereignis `lease_regained` |
| `reacquiring` | `409 session.rig_busy` (andere Instanz hat übernommen) | `none` | Session beenden (`PATCH status: aborted`), `blocked{rig_busy}` |
| beliebig | Offline-Modus ein | `held` (eingefroren) | Lease bleibt serverseitig stehen (§6 unten) |

  - **Meldungen scheitern nie an der Lease:** `captures` und `events` werden auch in `lost`/`reacquiring` gesendet und vom Server gespeichert (mit Warnung markiert, TK 5.6/6.6); `session.lease_lost` erscheint nur als Hinweis in der Heartbeat-Antwort, nicht als Fehler dieser Endpunkte.
  - Neustart: `sessionId` und `nightPlanId` persistiert; derselbe Rechner/Instanz setzt die eigene Session fort (`PATCH /sessions/{id} {status: "running"}` erneuert die Lease und liefert `{lease}`; eigene abgelaufene Lease gilt nicht als Konflikt). `POST /sessions` mit bereits bekannter `id` ist **idempotent** (`200` mit derselben Antwort).
  - Offline angelegte Session, später `409 session.rig_busy` beim Nachmelden → erneut mit `offline: true` senden; der Server nimmt sie ohne Lease an (TK 6.6), Aufnahmen werden gespeichert; niemals Dead-Letter-Schleife.
- **Offline-Modus einschalten** (FA-NIN-04): ein letzter Aufruf `POST /heartbeat {state: "offline", offlineUntil?}` → Server friert Lease und Session-Überwachung ein (keine `stale`-Markierung, keine Alarme), bis wieder ein Heartbeat kommt, der Admin die Lease freigibt oder 14 Tage vergangen sind. Eine **Admin-Freigabe** (`POST /web/v1/rigs/{id}/lease/release`) beendet das Einfrieren sofort, damit ein Ersatzrechner starten kann; das offline laufende Plugin erfährt es beim nächsten Online-Heartbeat (`leaseLost`).
- **Wechsel online → offline mitten in der Nacht (NIN-9):** Der Offline-Plan (Jint) hat eine neue `nightPlanId` und neue Block-UUIDs. Das Plugin meldet ihn mit `PATCH /sessions/{id} { offline: true, offlinePlan: { inputHash, blocks[] } }` nach; der Server legt dazu einen `night_plan(origin='plugin_offline')` an und verknüpft ihn mit der Session. Bis zur Nachmeldung tragen Aufnahmen `nightPlanId = null` (zulässig bei `offline`), danach die neue ID.

## 7. Flats (AP-50)
- Drei Anweisungsboxen am Container: **Vor Flats** (einmal), **Flats je Kombination**, **Nach Flats** (einmal); Ein/Aus, Anzahl, Dark-Flats und „vollständiger Filtersatz“ aus den Rig-Einstellungen.
- **Kombination** = Filter-Kurzname + **geclusterter mechanischer Rotatorwinkel** + Gain + Offset + Binning + **Auslesemodus-Index**; Zielliste je Kombination (Abweichung vom Original, das nach Himmels-PA gruppiert). Der Winkel wird je gespeicherter Light-Aufnahme gemessen, aber mit `tol = max(1°, rotation_tolerance_deg/2)` geclustert (`round(mech/tol)·tol`); Repräsentant = **Median** der Werte der Kombination (`flip-rotation.md` §4). Ohne Clustern entstünde je Blockbesuch eine neue Kombination (NIN-2).
- **Schlüssel einfrieren (verbindlich, NIN5-8):** Der Repräsentant wird **einmal** berechnet – bei der ersten Flat-Meldung der Kombination – und als **Zehntelgrad-Ganzzahl** `mech_deg_dg = roundHalfAwayFromZero(median · 10)` in `flat_combination_local` gespeichert. Ab dann ist er unveränderlich: jede Meldung der Kombination trägt `rotatorMechDeg = mech_deg_dg / 10`, auch nach einem Neustart des Plugins und auch wenn weitere Light-Aufnahmen den Median verschieben würden. Der laufend nachgeführte Median steht daneben in `median_deg_dg` (nur Anzeige/Diagnose). Der Schlüssel ist damit Plugin- und serverseitig identisch: `flat_combination` führt `rotator_mech_deg_dg integer` (Zehntelgrad) im Primärschlüssel und `median_deg double precision` als reine Beobachtung (Schema 1.10, TK 6.6). Ohne diese Festschreibung entstünde nach einem Neustart eine zweite Zeile für dieselbe Kombination.
- **Schlüssel serverseitig:** Session + Filter-Kurzname + `rotator_mech_deg_dg` + Gain + Offset + Binning + Auslesemodus-Index (`flat_combination`, TK 6.6).
- **Persistenz:** SQLite-Datei des Plugins (gleiche Datenbank wie Outbox/Cache, Tabelle `flat_combination_local`): je Nacht und Kombination `status (pending|running|done|skipped)`, `mech_deg_dg` (eingefrorener Repräsentant in Zehntelgrad, Teil des Schlüssels), `median_deg_dg` (laufender Median, nur Anzeige), `flats_expected`, `dark_flats_expected` (beide `NULL` bei Auto-Exposure/Sky-Flat), `flatsSaved`, `darkFlatsSaved`, Zielliste. Neustart setzt bei der ersten Kombination mit Status ≠ done fort; eine unterbrochene Kombination (`running`) wird **nur mit den fehlenden Aufnahmen** fortgesetzt (Box-Anweisungen erhalten `count − saved`). Neue Kombination nach erledigten Flats → wieder `pending`.
- **Ablauf:** Guiding stoppen → Boxen an einen **Container ohne Parent** hängen (keine Sequenz-Trigger; `IDeepSkyObjectContainer`, damit `$$TARGETNAME$$` greift) → Vor Flats → je mechanischem Winkel `MoveMechanical` → je Kombination: Filter (§4.4), Auslesemodus setzen mit **`SetReadoutModeForNormalImages`** (NINA wendet `ReadoutModeForSnapImages` nur auf `SNAPSHOT` an; Flats/Dark-Flats laufen als FLAT/DARKFLAT über die Normal-Einstellung – Original `AstroPMChildItems.cs:394`); Index wie §4.3 auflösen, Werte in alle Flat-Anweisungen der Box schreiben (Trained Flat/Dark Flat Exposure, Auto Exposure/Brightness Flat, Sky Flat: Filter, Gain, Offset, Binning, Anzahl), fehlenden Trained-Flat-Eintrag vorab melden, Fortschritt **rekursiv inkl. Schleifenbedingungen** zurücksetzen, ausführen → Nach Flats → Boxen wieder am Container einhängen.
- **Zielname und Kopie (NIN-16b):** Primärziel = erstes Ziel der Kombination (Reihenfolge der ersten Light-Aufnahme); Container-Target-Name = Name, unter dem die Lights gespeichert wurden (`Projekt` bzw. `Projekt – Panel-Label`). Der Name wird vor dem Vergleich **sanitisiert** wie von NINA beim Speichern (verbotene Zeichen `\ / : * ? " < > |` → `_`, Trimmen). Kopiert wird nur, wenn der Dateipfad ein **Pfadsegment** enthält, das genau dem sanitisierten Primärziel entspricht; dieses Segment wird durch den sanitisierten Namen des anderen Ziels ersetzt (kein Teilstring-Ersatz, damit „M 31“ nicht in „M 310“ trifft). Fehlt das Segment oder existiert die Zieldatei schon, wird die Kopie protokolliert und übersprungen. Kopien werden **nicht** gemeldet.
- **Meldung:** jede Flat-/Dark-Flat-Datei einmal mit `frameType` aus `ImageType` (`FLAT` → `flat`, `DARKFLAT` → `dark_flat`), `projectIds` = Zielliste, `metrics.meanAdu` aus `imageData.Statistics.Mean` (nur Flats), `rotatorMechDeg` = eingefrorener Repräsentant. Zusätzlich trägt **jede** Flat-Meldung der Kombination die Sollwerte `flatsPlanned` und `darkFlatsPlanned` (NIN5-9): die Anzahlen, die das Plugin für **diese** Kombination in **dieser** Nacht tatsächlich aufnimmt – `darkFlatsPlanned = 0`, wenn die Dark-Flat-Gruppe bereits erledigt ist, `flatsPlanned` = Anzahl aus den Rig-Einstellungen minus schon gespeicherter Aufnahmen bei Fortsetzung. Serverseitig gewinnt die **erste** Meldung je Kombination (`flat_combination.flats_planned`/`dark_flats_planned`); ohne die Felder greift die Rig-Einstellung als Rückfall (TK 6.6).
- **Dark-Flats (verbindlich, NIN-15):** je **(Belichtungszeit, Gain, Offset, Binning, Auslesemodus)** genau **einmal** pro Nacht – unabhängig vom Rotatorwinkel (Dark-Flats sind winkelunabhängig; FA-NIN-17, TK 10.3). Im lokalen Speicher steht dafür je Nacht eine Zeile `dark_flat_group` mit `status` und `saved`; eine Kombination, deren Dark-Flat-Gruppe schon `done` ist, überspringt den Dark-Flat-Teil (`darkFlatsPlanned = 0` in der Meldung).
- **Zuordnung der letzten Dateien (NIN-16a, NIN5-11):** `ImageSaveMediator.ImageSaved` ist ein **globales** Ereignis; es gibt deshalb genau **einen** Handler für den ganzen Flat-Lauf, der nach Filter, Auslesemodus-Index, Gain, Offset, Binning und `ImageType` der gespeicherten Datei entscheidet, zu welcher Kombination sie gehört (Zuordnung im Kern, nicht über An- und Abhängen). Die Kombinationen laufen **streng seriell**: das Plugin startet die nächste Kombination erst, wenn die vorige abgeschlossen ist (unten). So kann eine Datei nie zwei Kombinationen zugeordnet werden.
  **Abschluss einer Kombination** (welche Bedingung zuerst zutrifft):
  1. `flatsSaved ≥ flatsExpected` **und** `darkFlatsSaved ≥ darkFlatsExpected`, oder
  2. die Box-Anweisungen sind fertig gelaufen **und** seit dem letzten `ImageSaved` sind 120 s vergangen (gleiche Frist wie bei Lights, §4.3).

  `flatsExpected`/`darkFlatsExpected` sind die Anzahlen aus den Rig-Einstellungen minus bereits gespeicherter Aufnahmen; `darkFlatsExpected = 0`, wenn die Dark-Flat-Gruppe schon `done` ist. Bei **Auto-Exposure- und Sky-Flat-Boxen** ist die Anzahl nicht vorab bekannt (die Box entscheidet selbst, ob sie eine Aufnahme verwirft oder wiederholt); dort gilt ausschließlich Bedingung 2, und `flatsExpected` wird auf `null` gesetzt (in der Meldung bleibt `flatsPlanned` dann weg). Nach Abschluss wird `status = done` gesetzt und die Datei-Zuordnung dieser Kombination geschlossen; der Handler selbst bleibt bis zum Ende des gesamten Flat-Laufs registriert und wird in `Teardown` abgehängt. Ohne diese Regel fehlen die letzten Dateien für Kopie und Meldung.

## 8. Offline, Cache und Persistenz (Kern)
- **Ein** lokaler Speicher: SQLite `%LOCALAPPDATA%\NINA\Plugins\Svenesis.NinaPm\ninapm.db` mit Tabellen `cache` (Bootstrap, Targets, letzter Plan, ETag), `outbox`, `sent_history` (14 Tage), `dead_letter`, `flat_combination_local`, `state` (sessionId, nightPlanId, Blockindex, `tonight`).
- Cache online höchstens 7 Tage alt verwendbar; im Offline-Modus unbegrenzt. `401` (Token widerrufen) → Cache **nicht** verwenden, Fehlermeldung, keine Blöcke.
- Offline: Plan per Jint (`engine.iife.js`) aus Cache mit Zeitzonen/Nacht-Schlüsseln aus Bootstrap; Zählung lokal fortschreiben; Meldungen in die Outbox.
- **Log-Präfix** überall `NINA-PM |` (FA-NIN-19); Logzeilen für Tests: `NINA-PM | <EVENT> key=value …` (Grammatik in `ops/plugin-test-protocol.md`).
- **Sendereihenfolge:** Session (`POST /sessions`) → Aufnahmen/Ereignisse in FIFO je Session → `PATCH /sessions/{id}`.
- **Sessionende bei voller Outbox (verbindlich, NIN5-7):** Das Plugin sendet `PATCH /sessions/{id} {status: "completed", endedAtUtc, outboxPending: n}` **sofort** am Nachtende – auch wenn noch `n > 0` Pakete in der Outbox liegen. Damit gilt die Session nie als *verwaist*. Der Server setzt `session.status = completed`, startet die Jobs `session_close` und `session_report` aber **erst**, wenn `outboxPending = 0` gemeldet wurde oder die Frist von 6 h abgelaufen ist (TK 13). Jedes weitere Leeren der Outbox wird mit einem erneuten `PATCH {status: "completed", outboxPending: n'}` gemeldet (idempotent); bei `n' = 0` läuft die Nachrechnung an. Kommen nach dem Nachtbericht noch Aufnahmen, rechnet der Server Zähler und Bericht nach (TK 6.6).
- **Fehlercode → Aktion (verbindlich, NIN-10):**

| Antwort | Aktion |
|---|---|
| `2xx` | gesendet, in `sent_history` (14 Tage) |
| `408`, `429`, `5xx`, Netzfehler | Wiederholung mit Backoff (1, 2, 5, 15, 60 min), unbegrenzt |
| `409 session.unknown` | Session erneut senden, dann Paket wiederholen |
| `409 session.rig_busy` (Offline-Session) | mit `offline: true` erneut senden; nie Dead-Letter |
| `409 session.closed` | **kein** Reopen (NIN5-6): Paket sofort ins Dead-Letter mit Hinweis „Nacht seit &lt;Datum&gt; abgeschlossen – erneut hochladen“ (Anzeige im Plugin, Import über `POST /web/v1/rigs/{id}/import`). Ein `PATCH {status: "running"}` würde die Lease erneuern (und damit einem gerade laufenden Rig die Session entreißen) sowie `session_close`/Nachtbericht ein zweites Mal auslösen |
| `409 session.lease_lost` | Paket trotzdem gesendet betrachten (Server speichert), Lease-Zustandsmaschine §6 |
| `409 plan.targets_etag_mismatch` | `GET /targets` neu, Plan neu, Paket einmal wiederholen |
| `409 engine.incompatible` / `minPluginVersion` | keine neuen Blöcke, Meldung „Update nötig“, Outbox pausiert (kein Dead-Letter) |
| `413` | Paket halbieren und erneut senden (bis Größe 1), dann Dead-Letter |
| `422` mit `errors[]` | nur die beanstandeten Meldungen ins Dead-Letter, den Rest erneut senden |
| `401` | Senden anhalten (`blocked{token_invalid}`), Warteschlange bleibt erhalten |
| übrige `4xx` | Dead-Letter (Anzeige im Plugin, Anzahl im Heartbeat) |

## 9. Testbetrieb ohne echte Nacht
- `tools/nina-test-server` (AP-16a): lokaler HTTP-Server mit der NINA-API, der Pläne relativ zur aktuellen Zeit erzeugt (Blöcke ab `now + 2 min`, konfigurierbare Ziele; für Flip-Tests Ziel-RA = lokale Sternzeit + `n` min, damit der Meridian im Block liegt; Transit-Fenster ab `now + 10 min`). Szenarien: `one-night`, `replan`, `replan-transit`, `transit`, `flip`, `delay`, `night-end`, `flats`, `multi-night`, **`lease`** (zwei Rechner am gleichen Rig); Änderungen zur Laufzeit über `POST /test/actions {action}` mit den Aktionen `targets_change`, `pause_project`, `lock_transit`, `skip_block`, **`lease_release`** (nächste Heartbeat-Antwort trägt `leaseLost: true`), **`rig_busy`** (`POST /sessions` und `PATCH … {status: running}` antworten `409 session.rig_busy`), **`revoke_token`** (alle weiteren Aufrufe antworten `401 nina.token_invalid`) und `clear` (setzt alle Aktionen zurück) – damit sind P-10, P-17 und P-18 ohne echten zweiten Rechner prüfbar; Auswertung über `GET /test/report` (Aufnahmen, Ereignisse, Sessions), damit die Protokolle **ohne** Web-App prüfbar sind. Das Plugin nutzt ihn über die Server-URL. **Sicherheitsprüfungen dürfen nur lokal abgeschaltet werden (NIN-17):** Dunkelheits- und Höhenprüfung entfallen nur, wenn (a) in den Plugin-Optionen der sichtbare Schalter *Testbetrieb* aktiv ist, (b) die Server-URL auf `localhost`/`127.0.0.1` oder eine private IP zeigt **und** (c) die Antwort den Header `X-NPM-Test: 1` trägt. Alle drei Bedingungen müssen erfüllt sein; im Live-Status erscheint dann ein rotes Banner *Testbetrieb – Sicherheitsprüfungen aus*. Eine Gegenstelle allein kann die Prüfungen nie abschalten.
- Abnahme: `ops/plugin-test-protocol.md` (P-01…P-24).
