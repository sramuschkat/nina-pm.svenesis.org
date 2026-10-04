# P-14 Transit – 04.10.2026 (VM-Prüfstand, echtes NINA 3.2)

Lauf `pnpm vm-bench run vm-transit`, Test-Server-Szenario `transit` (Regelblock mit 300-s-Belichtungen, Transitfenster ab Minute 10 für 20 min), Plugin aus `main` 4df4566 (#234, lokal gebaut wie der CI-Auftrag). Beispielsequenz „Eine Nacht mit Safety“ mit dem Trigger *AF After Time* (60 min) im Zielcontainer. Ohne Handgriff.

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
| 07:11:23 | `PLAN reason=initial` |
| 07:12:21 | `BLOCK_START` Regelblock (L, 300 s) – eine Belichtung, die zweite passte nicht mehr vor den Vorlauf |
| 07:13:35 | `BLOCK_END reason=completed` – vor dem Vorlauf, nichts abgebrochen |
| 07:19:20 | `BLOCK_START` Transitblock = Vorlauf (Slew/Zentrieren) |
| 07:21:23 | `TRANSIT_START untilUtc=07:41:23` am Fensterbeginn; `TRIGGER_SUPPRESSED type=AutofocusAfterTimeTrigger` |
| 07:40:50 | `TRANSIT_END`, `BLOCK_END completed` (nächste Belichtung passte nicht mehr vor `untilUtc`) |
| 07:40:51 | `PLAN reason=refresh`; Rest des Transitblocks `BLOCK_SKIPPED reason=elapsed` (kein Slew) |

## Ergebnis
- Aufnahmen (Test-Server-Report): 1 × L im Regelblock, **507 × R** in der Serie (07:21:23–07:40:49), **alle mit derselben `transitObservationId`**, Bildnummern `…_0000` bis `…_0506`. Die Sky-Simulator-Kamera ignoriert die Belichtungszeit, daher so viele; am Rig ≈ 36 (30 s + 3 s).
- Kein `CAPTURE result=aborted`, keine vom Server abgelehnte Anfrage, kein `ERROR`.
- Autofokus-Trigger von NINA im Transit unterdrückt (Typname der installierten NINA-Version bestätigt: `AutofocusAfterTimeTrigger`).
- Prüfungen `vm-check.txt`: **alle vier grün**.

Hinweis zur Auswertung: Der erste Versuch wurde mitten in der Serie unterbrochen (Prüfstand-Prozess mit dem Chat beendet); das Log dieses Laufs ist auf seinen eigenen NINA-Neustart (07:10:55 UTC) beschränkt, seitdem sammelt der Prüfstand das Log ab dem Neustart ein.

`live-status-transit.jpg`: Sequencer während der Serie, Statuszeile „NINA-PM: Test wasp-12 R 30 s“, *AF After Time* ohne Fokussierer (rotes Ausrufezeichen, erwartet).

**Ergebnis: Go** (vorbehaltlich Svens Abnahme von AP-44).
