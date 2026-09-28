# ADR-S2b – NINA-Laufzeit: Stellen ohne Vorbild

| | |
|---|---|
| Status | **Entwurf**: Befunde aus den NINA-3.2-Assemblies eingetragen; Laufzeit (P-01…P-03, P-13, Kommandozeile, Safety) offen bis zu Svens Läufen in der VM (H-14, H-15) |
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
| Ansichten | `NINA.View.Sequencer.SequenceBlockView` und `…MiniSequencer.MiniSequenceItem` in `NINA.Sequencer`; das Probe-XAML baut auf dem Mac | bestätigt ADR-S2c Frage 3 auch mit NINA-Typen im XAML |

### Zur Laufzeit (VM, NINA 3.2, Simulatoren) – offen

| Punkt | Protokoll / Versuch | Ergebnis |
|---|---|---|
| Trigger-Walk mit Kontext = Container, Flip mit Zielkoordinaten, AF-Zählung | P-01 | offen |
| Zuordnung `ImageSaved` bei schneller Folge, FITS-Header (Zielname, PA) | P-02 | offen |
| Abbruch über eigenen Token < 5 s | P-03, P-13 (2) | offen |
| Typfilter AF/Dither, Auslesemodus per Name, Flip `west → east`, Pier-Seite unbekannt → nur `FLIP_UNDETECTED` | P-13 | offen |
| Positionswinkel-Konvention im FITS-Header | P-02 Screenshot | offen |
| Versionsabgleich `NINA.Sequencer.dll` = 3.2.0.9001 (aus AP-S2c verschoben) | `windows-vm.md` Schritt 5 | offen |
| Kommandozeile `--profileid`/`--sequencefile`/`--runsequence`/`--exitaftersequence` (Kurzformen?), Start über die Aufgabenplanung | README Probe §5 | offen |
| *Loop While Safe* unterbricht → `interrupted`, Stopp → `user_skip` (§4.6) | README Probe §5 | offen |

## Entscheidung
Offen bis zu den Laufzeitergebnissen. Vorgesehen: Gehen P-01…P-03 und P-13 durch, übernehmen AP-16c…16h die Muster aus `spikes/nina-probe` in `NinaPm.Nina`:
- den Trigger-Walk mit `ShouldTrigger`/`Run` und Kontext = Container;
- die Zuordnung über `Image.Id` vor `Enqueue`;
- die Abbruch-Token;
- den Auslesemodus per Name;
- die Flip-Erkennung über die Pier-Seite.

## Folgen
- `execution.md` §5: Beispielcode an NINA 3.2 anpassen (`ShouldTrigger` synchron, `Run` statt `Execute`); gleiche Stelle in `ops/plugin-test-protocol.md` P-13.
- `ops/plugin-test-protocol.md`: Betriebszeile `TRIGGER` und Schlüssel `night` ergänzt (Spec-Ergänzung in diesem PR); P-13 (3) mit einem Auslesemodus, den die Kamera anbietet.
- Messwerte für AP-16f (Flip-Dauer) gelten nur auf x64 (TK 10.5), die VM liefert nur die Funktion.

## Alternativen
- `SequenceContainer.RunTriggers` wie im Original: abgelehnt. Es ist alles-oder-nichts, eine Typfilterung ist damit nicht möglich (NT-23, NIN-12).
