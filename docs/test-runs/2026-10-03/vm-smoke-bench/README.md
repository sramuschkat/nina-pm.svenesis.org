# VM-Prüfstand `vm-smoke` – 03.10.2026

Zweiter Lauf über den VM-Prüfstand, erstmals mit Safety ohne Handgriff:
- Safety-Monitor über die Simulator-Schnittstelle von OmniSim umgeschaltet (`PUT /simulator/v1/safetymonitor/0/issafesetting`); der Monitor bleibt dabei verbunden.
- NINAs globaler Trigger *Dither after Exposures* steht in der erzeugten Prüfstand-Sequenz.

Plugin aus `plugin`-Lauf 37139500509 (main nach #222). Auswertung `pnpm plugin:sim --vm`: **alle sieben Prüfungen grün** (`vm-check.txt`).

## Geräte
Wie `docs/ops/vm-bench.md`, Rotator **getrennt** (`rotator_unavailable` je Block erwartet). Kühlung −10 °C, Sollwert bei Minute 5 auf 0 °C.

## Zeitplan (vom Mac gesteuert)
| Minute | Aktion |
|---|---|
| 0 | Test-Server `vm-smoke` (Start 18:22:00Z), Prüfstand-Sequenz gestartet |
| 5 | Kamera-Sollwert 0 °C (Advanced API) |
| 13,3 | Safety unsicher (OmniSim) |
| 15 | Safety sicher (OmniSim) |
| 30 | Report, NINA-Log, Auswertung |

## Befunde
- 21 Aufnahmen gespeichert; ab Minute 5 mit `temperatureDeviation`, genau eine `camera_temperature`-Warnung je Block.
- Pläne `initial` → `resume` (nach der Safety-Pause) → `refresh`.
- Session `completed`, Outbox leer, keine abgelehnte Anfrage.
- `nina_dither_trigger_present` und `TRIGGER_SUPPRESSED` mit dem globalen Dither-Trigger aus der erzeugten Sequenz.
- `safety-pause.png`:
  - Live-Status im echten NINA mit rotem Testbetrieb-Banner, „Waiting – Next block 13:33“ (Standortzeit), Outbox-Zähler, *Reset*/*Skip block*.
  - Sicherung: *Park Scope* erledigt, *NINA-PM Wait until Safe or Night End* wartet.
- `nach-wiederaufnahme.png`: *Is Safe* grün, Statuszeile „NINA-PM: Test ngc7000 Ha 30 s – Exposing“.
- **Kleiner Befund (Oberfläche):** Während der Safety-Pause zeigt der Live-Status „Waiting“; der Heartbeat meldet schon `paused`. „Paused – unsafe“ wäre genauer (Verbesserung für AP-16h).
