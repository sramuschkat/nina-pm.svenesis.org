# VM-Kurzlauf `vm-smoke` – 03.10.2026

Plugin aus `plugin`-Lauf 37107856954 (main nach #210), NINA 3.2.0.9001 auf der Windows-VM (Arm64, x64-Prozess), Test-Server `vm-smoke` auf dem Mac (Start 08:18:50Z). Auswertung: `pnpm plugin:sim --vm /tmp/vm` → **alle sieben Prüfungen grün** (`vm-check.txt`). Das NINA-Log liegt nur lokal (`*.log` ist nicht eingecheckt).

## Geräte
| Gerät | Treiber | Zustand |
|---|---|---|
| Kamera | Camera Sky Simulator for ALPACA | verbunden, Kühlung −10 °C, bei Minute 5 auf 0 °C |
| Montierung | Mount Sky Simulator for ALPACA | verbunden |
| Filterrad | Filterwheel Sky Simulator for ALPACA | verbunden |
| Guider | PHD2 (Simulator) | verbunden |
| Safety-Monitor | Alpaca Safety Monitor Simulator (OmniSim) | verbunden; unsicher 08:32:39Z, sicher 08:34:39Z |
| Rotator | – | getrennt |

## Befunde
- Profil im Heartbeat (Filterrad ab Platz 1, Kamera mit Temperatur und Auslesemodi), keine vom Server abgelehnte Anfrage im Lauf (nach #210).
- 41 Aufnahmen `saved` mit NINAs `exposureMidUtc`, Pier-Seite `west`, HFR, Sternen, Mittelwert, Sensortemperatur/Sollwert; Outbox am Ende leer.
- NINAs globaler Trigger „Dither after Exposures“: `WARNING nina_dither_trigger_present` beim Planaufbau, `TRIGGER_SUPPRESSED type=DitherAfterExposures` in jedem Blocklauf (P-28 mit echtem NINA).
- Kühlung: Block 1 war vor der Sollwert-Änderung fertig (die Sky-Simulator-Kamera ignoriert die Belichtungszeit); ab Block 2 alle 33 Aufnahmen `temperatureDeviation: true`, genau eine `camera_temperature`-Warnung je Blocklauf.
- Safety: `SAFETY_PAUSE` → Sicherung (Find home scheitert erwartungsgemäß, Sky-Simulator ohne Home, ContinueOnError) → `HEARTBEAT paused` → `SAFETY_RESUME` → `PLAN reason=resume`, keine Session abgebrochen.
- Nachtende bei Minute 21 (08:39:50Z): `SESSION status=completed pending=0`, `SESSION status=finished`, Ende-Bereich (Warm Camera).
- Erwartete Warnungen: `rotator_unavailable` je Block (Rotator getrennt).
- Vor dem Lauf zwei `422` auf Heartbeats (03:17/03:18 Ortszeit) – vor dem Start dieses Test-Servers, also von der vorigen Instanz; Ursache dort nicht mehr sichtbar, im Lauf selbst keine.
