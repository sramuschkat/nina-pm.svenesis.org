# P-12 + P-35 Flats nach der Nacht – 04.10.2026 (VM-Prüfstand, echtes NINA 3.2)

Lauf `pnpm vm-bench run vm-flats`, Test-Server-Szenario `vm-flats`: Block 1 M 31 L/Ha 30 s mit Meridiandurchgang nach 4 min, Block 2 IC 1396 L Bin 2 mit Gain/Offset null. Die Dunkelheit endet nach 13 min. Flats vom Panel (`source=panel`), 5 je Kombination. Trainierte Flats (1 s, Gain/Offset −1, Bin 1 und 2) schreibt der Prüfstand ins Profil. NINA wird neu gestartet, sobald die 2. Kombination beginnt. Plugin aus `main` 30b1fdb (#241, vor dem Fix #244). Ohne Handgriff.

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
| 12:47:54 | `PLAN reason=initial`, Session läuft, Lease gehalten |
| 12:50:05–12:54:34 | Block 1 M 31 (L, Ha, L, L). 12:53:00 flippt NINA (`TRIGGER type=MeridianFlipTrigger`, West → Ost) |
| 12:54:34 | `BLOCK_END completed`. NINAs äußerer Flip-Trigger flippt ein zweites Mal, weil das Simulator-Teleskop wieder `pierWest` meldet (siehe unten) |
| 12:56:51–12:59:24 | Block 2 IC 1396 L Bin 2; dazwischen `PLAN reason=refresh` (12:59:14) |
| 13:00:54 | `FLATS_START` nach dem Nachtende, kein Block mehr danach |
| 13:00:55–13:01:16 | `L_b1_g-1_o-1_r0`: 5 Flats, Dark-Flat-Gruppe Bin 1 (5 Dark-Flats) `done`, `FLATS_END done` |
| 13:01:17 | `Ha_b1_g-1_o-1_r0` beginnt; nach 2 Flats startet der Prüfstand NINA neu (13:01:20, Kamera getrennt → NINA meldet drei *Take Exposure* „Camera not connected“) |
| 13:01:27 | Nach dem Neustart: `LEASE_REGAINED` |
| 13:01:43 | `FLATS_RESUME combination=Ha_b1… missing=3`, die fehlenden 3 Flats; `FLATS_END done` 13:01:50. Keine zweite Dark-Flat-Gruppe Bin 1 |
| 13:01:51–13:02:08 | `L_b2_g-1_o-1_r0`: 5 Flats, Dark-Flat-Gruppe Bin 2 (5 Dark-Flats), `FLATS_END done` |
| 13:02:08 | `FLATS_END`, Session `completed`, Outbox leer (13:02:28 `pending=0`) |

## Ergebnis
- **Genau drei Kombinationen:** L Bin 1, Ha Bin 1 und L Bin 2 mit Gain/Offset null, im Schlüssel als −1. Der Flip ergibt keine weitere Kombination, denn ohne Rotator bleibt der mechanische Winkel 0°.
- **Aufnahmen** (NINA-Log): 7 Lights (6 × L, 1 × Ha). Dazu 1-s-Aufnahmen, je Kombination genau 5 Flats:
  - Ha 5;
  - L 20 = je 5 Flats und 5 Dark-Flats in Bin 1 und Bin 2.

  Die Dark-Flat-Gruppe Bin 1 lief einmal, für L und Ha gemeinsam.
- **Neustart:** Fortgesetzt wurde nur mit den fehlenden 3 Ha-Flats. Die beiden Flats vor dem Neustart wurden nicht wiederholt.
- **Warnungen:** `WARNING code=flat_exposure_off` je Kombination ist erwartet, weil die Simulator-Kamera Sternfelder liefert (vm-bench.md). `sequence_template_deviation` und `rotator_unavailable` sind prüfstandbedingt.
- **`ERROR` im Log:**
  - `SetCCDTemperature … Will be clamped` beim Verbinden (Simulator);
  - die drei *Take Exposure* während des Neustarts.

  Keine vom Server abgelehnte Anfrage.
- **Prüfungen** `vm-check.txt`: alle fünf grün.

Der erste Versuch (12:29 UTC) brach ab, weil NINA beim Laden die Unterelemente von *Trained Flat/Dark Flat Exposure* leert. Der Prüfstand schreibt sie seitdem vollständig (Commit adc7bfc). Der Versuch deckte außerdem die beiden Plugin-Fälle auf, die #244 behebt: gescheiterte Box ohne Dateien, Dark-Flat-Gruppe erst mit gespeicherten Dark-Flats erledigt.

**Flip:** NINA flippt um 12:53:00. Das Sky-Simulator-Teleskop meldet aber ≈ 90 s danach wieder `pierWest`, NINA selbst flippt deshalb am Blockende erneut. Vor und nach der Belichtung war die Pier-Seite damit gleich, im Plugin-Log steht also kein `FLIP`. Das ist ein Simulator-Artefakt, kein Fehler des Plugins: Die Flip-Erkennung ist in `vm-flip` und P-27 (`FLIP pierBefore=west pierAfter=east`) belegt. `vm-flats` prüft den Flip deshalb nicht mehr.

**Ergebnis: Go** für P-12 und P-35 auf echtem NINA (vorbehaltlich Svens Abnahme von AP-50).
