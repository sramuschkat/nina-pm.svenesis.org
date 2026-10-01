# ADR-S2b – NINA-Laufzeit: Stellen ohne Vorbild

| | |
|---|---|
| Status | **Angenommen: Go** (01.10.2026, Abnahme Sven) – alle Laufzeitpunkte geprüft (P-01, P-02, P-03, P-13, Kommandozeile, Safety) |
| Datum | 2026-09-28 |
| Arbeitspaket | AP-S2b |
| Anforderungen | TK 10.1, 10.3, OT-08, OT-22, NT-45, NIN5-1, NIN5-3 |

## Kontext
Das Astro-PM-Plugin liefert die Muster für Container, Trigger-Walk, `AttachNewParent` und `IExposureItem`. Einige Stellen hat es aber nicht; sie werden hier gegen NINA 3.2 geprüft, bevor AP-16a…h darauf bauen:
- die Zuordnung `ImageSaved` → Aufnahme-ID für Lights;
- die Flip-Erkennung über die Pier-Seite und das Warten auf `TimeToMeridianFlip`;
- der Trigger-Filter nach Typ;
- der eigene Abbruch-Token;
- der Auslesemodus per Name;
- die Unterscheidung Unterbrechung / Benutzerabbruch;
- der Kommandozeilenstart.

Probe-Plugin: `spikes/nina-probe` (Anleitung dort). Übersetzt wird gegen NuGet `NINA.Plugin` 3.2.0.9001 (ADR-S2c).

## Geprüft

### Gegen die Assemblies von NINA 3.2.0.9001 (Metadaten, auf dem Mac)

| Punkt | Befund | Folge |
|---|---|---|
| Trigger aufrufen | `ISequenceTrigger.ShouldTrigger(previousItem, nextItem)` und `ShouldTriggerAfter(…)` liefern **`bool`** (synchron). Ausgeführt wird über **`Run(ISequenceContainer context, IProgress, CancellationToken)`**; `Execute` ist die überschreibbare Methode von `SequenceTrigger`, `Run` setzt den Status und ruft sie auf. | Das Beispiel in `execution.md` §5 (`await trigger.ShouldTrigger(…)`, `trigger.Execute(ctx, …)`) passt nicht zu NINA 3.2. Richtig ist `if (trigger.ShouldTrigger(prev, item)) await trigger.Run(this, progress, token);` → Spec-Korrektur mit der Abnahme |
| Trigger-Typnamen (NIN5-3) | Konkrete Trigger in `NINA.Sequencer`: `AutofocusAfterExposures`, `AutofocusAfterFilterChange`, `AutofocusAfterHFRIncreaseTrigger`, `AutofocusAfterTemperatureChangeTrigger`, `AutofocusAfterTimeTrigger`, `DitherAfterExposures`, `MeridianFlipTrigger`, `CenterAfterDriftTrigger`, `RestoreGuiding`, `SynchronizeDomeTrigger` | Die sechs Namen aus `execution.md` §5 stimmen. Die Laufzeit (P-13) bestätigt `GetType().Name` |
| Bild aufnehmen | `IImagingMediator.CaptureImage(CaptureSequence, CancellationToken, IProgress, string targetName)`, 4. Parameter neu gegenüber dem Original (3.0) | Probe übergibt den Zielnamen |
| Zuordnung | `IExposureData.MetaData.Image.Id` (`int`) nach `CaptureImage`; `ImageSavedEventArgs` trägt `MetaData` (mit `Image.Id`, `ExposureStart`, `ExposureMidPoint`) und `PathToImage` (`Uri`) | Zuordnung über `Image.Id`, Dateiname aus `PathToImage` wie in §4.3 geplant |
| Nachtdaten | `INighttimeCalculator.Calculate(DateTime?)`; das Original rief `Calculate()` ohne Parameter (3.0) | nur für `IDeepSkyObjectContainer.NighttimeData` |
| Filterwechsel | `IFilterWheelMediator.ChangeFilter(FilterInfo, CancellationToken, IProgress)` | – |
| Pier-Seite | `TelescopeInfo.SideOfPier` vom Typ `NINA.Core.Enum.PierSide` mit `pierEast`, `pierWest`, `pierUnknown`; `TimeToMeridianFlip` (`double`) | Zuordnung `pierWest → west`, `pierEast → east`, `pierUnknown → null` wie §4.3 |
| Flip-Einstellungen | `IMeridianFlipSettings`: `MinutesAfterMeridian`, `MaxMinutesAfterMeridian`, `PauseTimeBeforeMeridian`, `Recenter`, `UseSideOfPier`, `AutoFocusAfterFlip`, `SettleTime`, `RotateImageAfterFlip` | Heartbeat-Felder und §4.5 unverändert |
| Auslesemodus | `CameraInfo.ReadoutModes` (`IEnumerable<string>`), `ICameraMediator.SetReadoutModeForNormalImages(short)` | Name → Index wie §4.3 |
| Safety | `SafetyMonitorCondition` (in `GetConditionsSnapshot()` der Vorfahren), `SafetyMonitorInfo.Connected`/`IsSafe` | Unterscheidung wie §4.6 umsetzbar |
| Plugin-Manifest | `PluginBase.Identifier` liest das **`GuidAttribute`** der Assembly, `Name`/`Author`/Kurzbeschreibung kommen aus `AssemblyTitle`/`AssemblyCompany`/`AssemblyDescription`; `AssemblyMetadata("Identifier")` wird nicht gelesen. Fehlt das `Guid`-Attribut, bricht `LoadPlugin` ab und protokolliert nur auf Trace-Stufe (`KeyNotFoundException: GuidAttribute`, VM-Test 28.09.2026) | Probe korrigiert; **AP-16a:** `NinaPm.Nina` braucht `[assembly: Guid]`, `AssemblyTitle`, `AssemblyCompany`, `AssemblyDescription` und `MinimumApplicationVersion` |
| Ansichten | `NINA.View.Sequencer.SequenceBlockView` und `…MiniSequencer.MiniSequenceItem` in `NINA.Sequencer`; das Probe-XAML baut auf dem Mac | bestätigt ADR-S2c Frage 3 auch mit NINA-Typen im XAML |

### Zur Laufzeit (VM, NINA 3.2, Simulatoren) – offen

| Punkt | Protokoll / Versuch | Ergebnis |
|---|---|---|
| Trigger-Walk mit Kontext = Container, Flip mit Zielkoordinaten, AF-Zählung | P-01 | **✔ go (01.10.2026).** 20/20 gespeichert; Trigger zwischen den Belichtungen mit dem Probe-Container als Kontext; `AutofocusAfterFilterChange` genau bei den 3 Filterwechseln; Flip mit den Zielkoordinaten des Containers (NINA-Log „Current target coordinates RA 16:38:30 …“, kein „No target information“), `FLIP pierBefore=west pierAfter=east`. **Befund:** `ISequenceTrigger.Run` wirft nicht, wenn die Anweisung des Triggers scheitert (AF ohne Sterne: NINA loggt „Failed: Trigger“, `ContinueOnError`) – `trigger_failed` muss aus dem Trigger-Status nach `Run` kommen, nicht aus einer Ausnahme (AP-16d). **Befund 2:** `GetTriggersSnapshot()` liefert auch deaktivierte Trigger; der eigene Walk muss `Status == DISABLED` überspringen (probe-0.1.2). `docs/test-runs/2026-10-01/P-01/` |
| Zuordnung `ImageSaved` bei schneller Folge, FITS-Header (Zielname, PA) | P-02 | **✔ go (01.10.2026, probe-0.1.1).** 20/20 `CAPTURE result=saved`, jede Aufnahme-ID und jeder Dateiname genau einmal. NINA speichert im Hintergrund verschränkt (Bild *n*, während *n+1* belichtet); Bild 20 kam 1,8 s **nach** `BLOCK_END`. Lauf 1 mit probe-0.1.0 fiel deshalb durch (18/20, Handler im `finally` gelöst) – probe-0.1.1 hält den Handler, bis keine Aufnahme mehr offen ist. `docs/test-runs/2026-10-01/P-02/`, Lauf 1 unter `…/P-02-probe-0.1.0/` |
| Abbruch über eigenen Token < 5 s | P-03, P-13 (2) | **P-03 ✔ go (01.10.2026, Alpaca Camera Sim):** Abbruch nach 10 s über den eigenen Token, `CAPTURE result=aborted` **21 ms** später, kein `probe_abort_fallback`; für die abgebrochene Belichtung keine Datei und keine `Image.Id`, nächste Belichtung 46 ms danach. Lauf 1 mit der Sky-Simulator-Kamera nicht prüfbar (liefert jedes Bild nach ~1,5 s, egal welche Belichtungszeit) – für Läufe mit Zeitbezug (P-01, P-03, P-13) OmniSim-Kamera. `docs/test-runs/2026-10-01/P-03/`, `…/P-03-skysim/`. **P-13 (2) ✔:** 120-s-Belichtung nach 20 s abgebrochen, nächste startet sofort |
| Typfilter AF/Dither, Auslesemodus per Name, Flip `west → east`, Pier-Seite unbekannt → nur `FLIP_UNDETECTED` | P-13 | **✔ go (01.10.2026, probe-0.1.2).** Lauf A: `TRIGGER_SUPPRESSED` für `AutofocusAfterTimeTrigger` und `DitherAfterExposures` (Laufzeit-Typnamen = NIN5-3-Liste), kein AF-Lauf; `READOUT mode=set name=Default index=0` (Kamera kennt nur diesen Modus); `FLIP pierBefore=west pierAfter=east`. Lauf B (Pier-Seite ignoriert, 10 × 60 s – mit 4 × 60 s endete der Block vor dem Flip): nach jedem Flip-Trigger nur `FLIP_UNDETECTED`, kein `FLIP`; NINA flippte zweimal, weil der Sky Simulator danach wieder `pierWest` meldete → AP-16f muss mehrere Flips je Block melden. Erster Versuch A ohne Flip: Simulator-Sternzeit nach Uhrkorrektur der VM 6 h falsch. `docs/test-runs/2026-10-01/P-13/` |
| Positionswinkel-Konvention im FITS-Header | P-02 FITS-Header | **✔ Übergabe:** Der gesetzte Ziel-PA (30°) steht unverändert als `OBJCTROT = 30.0` („planned rotation“) im Header, `OBJECT`/`OBJCTRA`/`OBJCTDEC` = Probe-Ziel, `PIERSIDE = 'West'`, `ROTATOR = 0.0` (mechanisch, die Probe dreht nicht). Die Bildorientierung selbst (Plate-Solve mit Rotator) prüft P-13/AP-16f |
| Versionsabgleich `NINA.Sequencer.dll` = 3.2.0.9001 (aus AP-S2c verschoben) | `windows-vm.md` Schritt 5 | ✔ Sven 28.09.2026, VM: `FileVersion` 3.2.0.9001 = `NinaVersion` |
| Kommandozeile `--profileid`/`--sequencefile`/`--runsequence`/`--exitaftersequence` (Kurzformen?), Start über die Aufgabenplanung | README Probe §5 | **✔ (01.10.2026).** Lange Schalter und Kurzformen `-p`/`-s`/`-r`/`-x` laufen in NINA 3.2: Start mit Profil und Sequenz, Sequenz läuft, NINA beendet sich. Aufgabenplanung: *Program/script* **in Anführungszeichen** (Pfad mit Leerzeichen und `'N'`), *Start in* = NINA-Ordner, *Run only when user is logged on* – sonst startet nichts. `docs/test-runs/2026-10-01/ap-s2b-notes.md` |
| *Loop While Safe* unterbricht → `interrupted`, Stopp → `user_skip` (§4.6) | README Probe §5 | **✔ (01.10.2026).** Safety Monitor während einer Belichtung getrennt: NINA unterbricht nach ≈ 3,8 s (Prüftakt), Probe meldet `aborted`, `BLOCK_END reason=interrupted`, `SAFETY_PAUSE`. Stopp von Hand bei sicherem Monitor: `BLOCK_END reason=user_skip`. „Verbunden, aber unsicher“ (OmniSim ohne Schalter) folgt in P-25. `docs/test-runs/2026-10-01/safety/` |

## Entscheidung
**Go (angenommen von Sven am 01.10.2026).** P-01, P-02, P-03 und P-13 sind bestanden, Kommandozeilenstart und Safety-Unterbrechung bestätigt. AP-16c…16h übernehmen die Muster aus `spikes/nina-probe` in `NinaPm.Nina`:
- den Trigger-Walk mit `ShouldTrigger`/`Run` und Kontext = Container – deaktivierte Trigger überspringen, Fehlschlag über den Status nach `Run` erkennen;
- die Zuordnung über `Image.Id` vor `Enqueue`, sitzungsweit statt im Block;
- die Abbruch-Token;
- den Auslesemodus per Name;
- die Flip-Erkennung über die Pier-Seite, mehrere Flips je Block möglich;
- den Start über die Aufgabenplanung mit den oben genannten Einstellungen.

## Folgen
- `execution.md` §5: Beispielcode an NINA 3.2 anpassen (`ShouldTrigger` synchron, `Run` statt `Execute`); gleiche Stelle in `ops/plugin-test-protocol.md` P-13.
- `ops/plugin-test-protocol.md`: Betriebszeile `TRIGGER` und Schlüssel `night` ergänzt (Spec-Ergänzung in diesem PR); P-13 (3) mit einem Auslesemodus, den die Kamera anbietet.
- Messwerte für AP-16f (Flip-Dauer) gelten nur auf x64 (TK 10.5), die VM liefert nur die Funktion. Der Testrechner vom 01.10.2026 ist ebenfalls Windows 11 **ARM64** (VMware, NINA x64 emuliert): keine Zeitmessungen.
- **Aus P-01 (Spec-Ergänzung `execution.md` §5, mit der Abnahme):** Trigger mit `Status == SequenceEntityStatus.DISABLED` überspringen (`GetTriggersSnapshot()` liefert sie mit). Nach `await trigger.Run(...)` den Status des Triggers bzw. seiner Anweisungen prüfen (`SequenceEntityStatus.FAILED`) und dann `warning trigger_failed` melden; `Run` wirft bei einer gescheiterten Anweisung keine Ausnahme.
- **Aus P-02 (Spec-Ergänzung `execution.md` §4.3, mit der Abnahme):** Die Zuordnung `Image.Id → captureId` und der `ImageSaved`-Handler leben **nicht** im Block. Gespeichert wird im Hintergrund, die letzten Bilder eines Blocks kommen nach dessen Ende. Der Handler bleibt angehängt, bis keine Aufnahme mehr offen ist (gespeichert oder nach 120 s `failed`); das Blockende wartet nicht darauf. In `NinaPm.Nina` (AP-16e) gehört die Zuordnung in den sitzungsweiten Dienst, nicht in den Container.

## Alternativen
- `SequenceContainer.RunTriggers` wie im Original: abgelehnt. Es ist alles-oder-nichts, eine Typfilterung ist damit nicht möglich (NT-23, NIN-12).
