# P-38 Auto-Flats einmal je Projekt – 04.10.2026 (VM-Prüfstand, echtes NINA 3.2)

Lauf `pnpm vm-bench run vm-flats-auto`, Test-Server-Szenario `vm-flats-auto`. Block 1 M 31 L 30 s, Block 2 NGC 7000 Ha 30 s, Dunkelheit endet nach 11 min. Rig: `flatsAutoMode=once_per_project`. Für beide Projekte meldet der Server schon Flats (`flatsOnRecord`: M 31 L, NGC 7000 Ha), wie aus einer früheren Nacht. Plugin aus `main` f93e2f7 (mit #244 und #245). Ohne Handgriff.

| Gerät | Simulator | Zustand |
|---|---|---|
| Kamera | Camera Sky Simulator for ALPACA | verbunden, −10 °C |
| Montierung | Mount Sky Simulator for ALPACA | verbunden |
| Filterrad | Filterwheel Sky Simulator for ALPACA | verbunden |
| Guider | PHD2 (Simulator) | verbunden |
| Safety-Monitor | OmniSim Safety Monitor | verbunden, sicher |
| Flat-Panel, Rotator, Fokussierer, Kuppel | – | getrennt |

## Ablauf (NINA-Log, Zeiten UTC)
| Zeit | Ereignis |
|---|---|
| 13:14:10 | `PLAN reason=initial`, Session läuft, Lease gehalten |
| 13:18:24–13:19:26 | Block 1 M 31 L, `BLOCK_END completed` |
| 13:21:35–13:24:25 | Block 2 NGC 7000 Ha, danach `PLAN reason=refresh` |
| 13:24:25–13:24:35 | Rest von Block 2, `BLOCK_END reason=night_end` |
| 13:25:05 | `FLATS_END combination=L_b1_g-1_o-1_r0 status=skipped reason=covered` und `FLATS_END combination=Ha_b1_g-1_o-1_r0 status=skipped reason=covered` |
| 13:25:05 | Session `completed`, `pending=0` |

## Ergebnis
- **Kein Flat-Lauf:**
  - Beide Kombinationen sind durch die Flats beim Server gedeckt (`reason=covered`).
  - Kein `FLATS_START`, keine Flat- oder Dark-Flat-Aufnahme, keine Panel-Schritte.
- **Aufnahmen:** 4 × L und 4 × Ha, je 30 s, alle gespeichert. Keine vom Server abgelehnte Anfrage, Outbox leer.
- **`ERROR` im Log:** nur `SetCCDTemperature … Will be clamped` beim Verbinden (Simulator).
- **Prüfungen** `vm-check.txt`: beide grün.
- **Nicht in der VM geprüft:**
  - das Nachholen (`flatCarryOver`, höchstens drei Nächte);
  - `time_based` mit Intervall;
  - eine fehlende Kombination neben einer gedeckten.

  Diese Fälle decken der kopflose Lauf P-38 (`tools/nina-sim/runs/P-38.json`, zwei Nächte) und `FlatAutoTests` ab. Ein zweiter VM-Nachtlauf setzt den Tageswechsel ohne NINA-Neustart voraus (AP-52).

**Ergebnis: Go** für P-38 auf echtem NINA (vorbehaltlich Svens Abnahme von AP-50b).
