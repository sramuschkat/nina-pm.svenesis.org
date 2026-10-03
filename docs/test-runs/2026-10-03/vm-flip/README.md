# VM-Kurzlauf `vm-flip` – 03.10.2026

Plugin aus `plugin`-Lauf 37118727294 (main nach #219/#220), NINA 3.2.0.9001 auf der Windows-VM, Test-Server `vm-flip` auf dem Mac (Start 11:32:24Z). Sequenz: Beispielsequenz `one-night-safety.json` (AP-16h) in NINA geladen – ohne Fehler –, *Wait for Sun Altitude* und *Run Autofocus* deaktiviert, als `vm-test.json` gespeichert. Auswertung `pnpm plugin:sim --vm /tmp/vm-flip vm-flip` → `vm-check.txt`. Das NINA-Log liegt nur lokal (`*.log` ist nicht eingecheckt).

## Geräte
| Gerät | Treiber | Zustand |
|---|---|---|
| Kamera | Camera Sky Simulator for ALPACA | verbunden, Kühlung −10 °C |
| Montierung | Mount Sky Simulator for ALPACA | verbunden |
| Filterrad | Filterwheel Sky Simulator for ALPACA | verbunden |
| Rotator | Rotator Sky Simulator for ALPACA | verbunden, Bereich `FULL` |
| Guider | PHD2 (Simulator) | verbunden |
| Safety-Monitor | Alpaca Safety Monitor Simulator (OmniSim) | verbunden, sicher |
| Fokussierer, Kuppel, Flat-Panel, Wetter, Schalter | – | getrennt |

NINA-Profil Meridian-Flip: 1 / 5 / 0 min, *Recenter* aus; Windows-Zeitzone US Central.

## Befunde
- **Flip mit echtem NINA (P-07/P-26):** `TRIGGER type=MeridianFlipTrigger` beim Eintrag `meridian_flip` um 11:41:26Z, `FLIP pierBefore=west pierAfter=east durationS=93` um 11:42:59Z; danach nur Zentrieren, kein `ROTATION_MISMATCH`, mechanischer Rotatorwinkel aller 20 Aufnahmen gleich (0), 8 Aufnahmen `west`, 12 `east`.
- **Sequenzvorlage (AP-16h):** genau ein `WARNING code=sequence_template_deviation checks=start_wait_missing,start_autofocus_missing`, Ereignis mit `data.checks[]`; kein `safety_monitor_not_connected`.
- **Live-Status (AP-16h)** im echten NINA: rotes Banner, *Running*, Ziel mit RA/Dec und Rotation, Belichtung, Outbox-Zähler, „Today's targets“ in CDT (`live-status.png`).
- SiteCheck ohne Befund, Nachtende 11:58:24Z mit `SESSION status=completed pending=0`, keine abgelehnte Anfrage, keine Alarme.
- **Lücke gefunden:** Das Ereignis `flip` an den Server trug keine `durationS` (FA-NIN-24: Flip mit Dauer melden) – nur die Logzeile hatte sie. Die Prüfung hatte nur das Log angesehen. Behoben im selben PR (Dauer ins Ereignis), neue Report-Prüfung in P-07, P-26 und `vm-flip`; dieser Lauf ist gegen die neue Prüfung rot (`vm-check.txt`), der kopflose Lauf mit dem Fix grün. Kein neuer VM-Lauf nötig: Die Dauer stammt aus derselben, hier gemessenen Logzeile.
- Unauffällig: *Restore Guiding* läuft vor jeder Belichtung (NINA-Trigger, PHD2 „already guiding“, ≈ 20 ms). Nach dem regulären Blockende (11:53:54Z, letzte Belichtung passte nicht mehr) lieferte die Neuplanung denselben Block mit 35 s Rest; Slew entfiel (gleiches Panel), keine Belichtung passte, Blockende nach 10 s – wie in `execution.md` §2 (AP-16c-Ergänzung).
