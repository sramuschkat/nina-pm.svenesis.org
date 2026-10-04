# P-27 Flip im Transitfenster – 04.10.2026 (VM-Prüfstand, echtes NINA 3.2)

Lauf `pnpm vm-bench run vm-transit-flip`, Test-Server-Szenario `transit-flip` (Regelblock L 60 s, danach Transitfenster 25 min mit dem Meridiandurchgang des Transitziels in der Fenstermitte), Plugin aus `main` 4df4566 (#234). NINA-Profil: Meridian-Flip *Recenter* = an, *AutoFocusAfterFlip* = aus. Ohne Handgriff.

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
| 08:29:11 | `PLAN reason=initial`; `WARNING code=flip_in_transit atUtc=08:48:10Z durationS=210` (Lücke im Plan ausgewiesen) |
| 08:30:09 | Test-Server-Alarm `nina_settings_mismatch` / `recenter_after_flip_on` aus dem Heartbeat |
| 08:31:36–08:34:57 | Regelblock L 60 s (3 Aufnahmen), `BLOCK_END completed` vor dem Vorlauf |
| 08:37:08 | `BLOCK_START` Transitblock = Vorlauf (Slew/Zentrieren) |
| 08:39:10 | `TRANSIT_START untilUtc=09:04:10`; `TRIGGER_SUPPRESSED type=AutofocusAfterTimeTrigger` |
| 08:48:13 | NINA: *Meridian Flip – Flip should happen now* (Flip-Fenster 08:48:12–08:52:12), `TRIGGER type=MeridianFlipTrigger` – keine Belichtung abgebrochen, die letzte begann 08:48:11 und wurde gespeichert |
| 08:48:49–08:48:51 | NINA *Recenter after meridian flip* (Plate-Solve, Abweichung 0) |
| 08:49:47 | `FLIP pierBefore=west pierAfter=east durationS=95` |
| 08:49:48–08:49:51 | Winkelprüfung des Plugins mit eigenem Solve (kein eigenes Zentrieren, da NINA zentriert, NT-22), kein `rotation_mismatch` |
| 08:49:46 → | Serie läuft weiter (R 30 s, Bild `…_0266` ff.) |
| 09:03:39 | `TRANSIT_END`, `BLOCK_END completed` (nächste Belichtung passte nicht mehr vor `untilUtc`) |
| 09:03:39 | `PLAN reason=refresh`; Rest des Transitblocks `BLOCK_SKIPPED reason=elapsed` (kein Slew) |

## Ergebnis
- Aufnahmen (Test-Server-Report): 3 × L im Regelblock, **678 × R** in der Serie (08:39:10–09:03:36), **alle mit derselben `transitObservationId`**, Bildnummern `…_0000` bis `…_0677`. Lücke 08:48:11–08:49:46 = Flip mit Zentrieren. Die Sky-Simulator-Kamera ignoriert die Belichtungszeit, daher so viele.
- Vorhergesagte Lücke (08:48:10) und tatsächlicher Flip-Beginn (08:48:13) stimmen überein; der Flip dauerte 95 s statt der eingeplanten 210 s (Simulator-Montierung).
- Kein `CAPTURE result=aborted`, keine vom Server abgelehnte Anfrage, kein Block übersprungen außer dem abgelaufenen Rest.
- `ERROR` im Log nur `SetCCDTemperature … Will be clamped` beim Verbinden (Simulator, wie in P-14/P-15b).
- Prüfungen `vm-check.txt`: **alle vier grün**.

Abweichung von der Zeile P-27 in `plugin-test-protocol.md`: In der VM gibt es keinen Fokussierer, daher lief der Prüfstand mit *AutoFocusAfterFlip* = aus und nur mit *Recenter* = an. „AF nach Flip aktiv“ und die Variante *Recenter* = aus sind im Sim-Lauf `tools/nina-sim/runs/P-27.json` abgedeckt; am Rig (Fokussierer vorhanden) bei der Abnahme mitprüfen.

`live-status-nach-flip.jpg`: Sequencer etwa eine Minute nach dem Flip, Statuszeile „NINA-PM: Test wasp-12 R 30 s“, „Outbox 0 pending, 0 dead letters“, Meridian-Flip-Trigger mit dem Fenster.

**Ergebnis: Go** (vorbehaltlich Svens Abnahme von AP-44).
