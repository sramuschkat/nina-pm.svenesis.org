# P-23 + P-24 Tagesschleife und Warten auf Zeit – 04.10.2026 (VM-Prüfstand, echtes NINA 3.2)

Lauf `pnpm vm-bench run vm-multi-night`, Test-Server-Szenario `vm-multi-night`: zwei verkürzte Nächte im Abstand von 20 min, je Nacht ein Block M 31 L 30 s; Dunkelheit endet 10 min nach dem Start der Nacht, Session 12 min danach; nautische Dämmerung zum Start jeder Nacht. Sequenz: Beispielsequenz „Mehrere Nächte“ (`multi-night.json`) mit folgenden Prüfstand-Änderungen:
- *NINA-PM Warten auf Zeit*: nautische Dämmerung + 2 min;
- *NINA-PM Tagesschleife*: höchstens 2 Nächte;
- Trigger-Box *NINA-PM vor jeder Belichtung* (mit *Wait for Time Span* 1 s) am Container „Ziel“;
- ohne *Run Autofocus* (kein Fokussierer) und ohne *Warm Camera* am Morgen.

Plugin: `main` 0be2373 (AP-52 und #247–#250), lokal gebaut. Ohne Handgriff, ohne NINA-Neustart zwischen den Nächten.

| Gerät | Simulator | Zustand |
|---|---|---|
| Kamera | Camera Sky Simulator for ALPACA | verbunden, −10 °C |
| Montierung | Mount Sky Simulator for ALPACA | verbunden |
| Filterrad | Filterwheel Sky Simulator for ALPACA | verbunden |
| Guider | PHD2 (Simulator) | verbunden |
| Safety-Monitor | OmniSim Safety Monitor | verbunden, sicher |
| Rotator, Fokussierer, Kuppel, Flat-Panel | – | getrennt |

## Ablauf (NINA-Log, Zeiten UTC)
| Zeit | Ereignis |
|---|---|
| 16:26:03 | Sequenzstart: `DAYLOOP nights=0` (Rundenbeginn, Nacht-Tabelle noch nicht geladen), `WAIT_TIME source=nauticaldusk night=2026-10-03 untilUtc=16:28:03Z` |
| 16:28:03 | `WAIT_TIME_END` auf die Sekunde. Danach *Entparken* und *Kamera kühlen* |
| 16:29:34 | `PLAN reason=initial`, `SESSION … status=running night=2026-10-03` |
| 16:30:18–16:32:30 | Block 1 (Nacht 1), danach `PLAN reason=refresh` (kein Block mehr) |
| 16:36:03 | Nachtende: `SESSION status=completed pending=0`, `SESSION status=finished night=2026-10-03`. *Stop Guiding*, *Park Scope* am Morgen |
| 16:36:14 | Neue Runde der Tagesschleife: `DAYLOOP night=2026-10-04 nights=1`, `WAIT_TIME night=2026-10-04 untilUtc=16:48:03Z` |
| 16:48:03 | `WAIT_TIME_END` auf die Sekunde. *Entparken* |
| 16:48:06 | `PLAN reason=initial` und **neue Session** `status=running night=2026-10-04` (ohne NINA-Neustart) |
| 16:48:32–16:52:30 | Block 1 (Nacht 2) |
| 16:56:03 | `SESSION status=completed`, `SESSION status=finished night=2026-10-04` |
| 16:56:14 | `DAYLOOP_END reason=max_nights night=2026-10-05 nights=2`. Die Schleife endet, NINA führt den Ende-Bereich aus |

## Ergebnis
- **P-23:**
  - Zwei Nächte nacheinander, je eine abgeschlossene Session mit eigenem Nacht-Schlüssel (2026-10-03, 2026-10-04).
  - Zwischen den Nächten wartet die Tagesschleife in *Warten auf Zeit*, ohne Neustart.
  - Die Höchstzahl 2 Nächte beendet die Schleife.
- **P-24:**
  - *Warten auf Zeit* endet in beiden Nächten genau zur nautischen Dämmerung + 2 min. Erst danach wird entparkt, der Plan geholt und belichtet.
  - Die Trigger-Box vor jeder Belichtung lief **12× bei 12 Aufnahmen** (`TRIGGER type=BeforeExposureTrigger`).
- **Beispielsequenz:** „Mehrere Nächte“ lädt und läuft in NINA. Erster echter Ladetest der aus „Eine Nacht mit Safety“ abgeleiteten Datei.
- **Warnungen:** `sequence_template_deviation checks=start_autofocus_missing` und `rotator_unavailable` sind prüfstandbedingt.
- **`ERROR` im Log:** nur `SetCCDTemperature … Will be clamped` beim Verbinden (Simulator). Keine vom Server abgelehnte Anfrage.
- **Prüfungen** `vm-check.txt`: alle fünf grün.

`nacht-2.jpg`: Sequencer während Nacht 2. Die Tagesschleife steht auf max. 2 Nächte. *Warten auf Zeit* zeigt die Zielzeit in Standortzeit „until 04.10. 11:48 UTC−5 (night 2026-10-04)“. Die Statuszeile der Tagesschleife zeigte dabei „Night 1“, gezählt wurden die beendeten Nächte; ab diesem PR zeigt sie die laufende Nacht.

### Vorläufe am selben Tag
1. **15:22 UTC:** NINA stürzte 3 s nach dem ersten Blockstart ab. Windows-Ereignisprotokoll: `0xc000001d` (ungültiger Befehl) in unbekanntem Modul, kein Eintrag im NINA-Log.
2. **15:38 UTC:** Nacht 1 lief durch. Vor Nacht 2 kühlte NINA die am Morgen aufgewärmte Kamera neu (bis 10 min) und hätte die verkürzte Nacht verpasst. Abgebrochen; seitdem ohne *Warm Camera* am Morgen. In echten Nächten ist das Kühlen gewollt.
3. **16:03 UTC:** NINA stürzte 37 s nach dem Sequenzstart ab: `0xc0000005` in `coreclr.dll`.

Beide Abstürze sind nativ in der .NET-Laufzeit, ohne Eintrag im NINA-Log und nicht reproduzierbar. Einen gleichartigen Absturz gab es schon am 03.10. um 11:23 UTC mit einem älteren Plugin ohne AP-52. Wir werten sie deshalb als Instabilität der x64-Emulation in der VM (Windows auf Apple Silicon), nicht als Plugin-Fehler. Am Rig (x64-Windows) mitbeobachten. Der neue Agent-Auftrag `app-events` liest dafür das Windows-Ereignisprotokoll.

**Ergebnis: Go** für P-23 und P-24 (vorbehaltlich Svens Abnahme von AP-52).
