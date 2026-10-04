# VM-Prüfstand: echtes NINA in der Windows-VM, gesteuert vom Mac

Claude Code fährt die VM-Läufe ohne Handgriffe: Ein kleiner Agent in der VM holt Aufträge vom Mac. Er installiert das Plugin, löscht `ninapm.db`, startet und beendet NINA und schickt das NINA-Log zurück. Geräte, Profilwerte, Sequenzstart und Screenshots laufen über das NINA-Plugin **Advanced API**. Die Auswertung ist dieselbe wie bisher (`pnpm plugin:sim --vm`).

**Nur für die Test-VM:** Die Advanced API hat keine Anmeldung, nie auf dem Rig einrichten.

## Aufbau
| Teil | Wo | Was |
|---|---|---|
| `pnpm vm-bench` (`tools/vm-bench`) | Mac | Prüfstand-Server (Port 8788) mit Auftragswarteschlange; Test-Server (8787) im selben Prozess; Advanced-API-Client; Auswertung |
| Agent `C:\NinaPmBench\NinaPmBenchAgent.ps1` | VM | Aufgabenplanung „NINA-PM Bench Agent“ bei Anmeldung, in der angemeldeten Sitzung (NINA erscheint normal auf dem Bildschirm); fragt alle 3 s den Mac nach Aufträgen |
| Advanced API (NINA-Plugin, Port 1888) | VM | Geräte verbinden, Profilwerte, Sequenz laden und starten, Reiter, Screenshots |

Der Agent kennt nur die Aufträge `ping`, `restart-nina`, `stop-nina`, `install-plugin` und `put-sequence` (je mit SHA-256-Prüfung), `collect-log`, `update-agent` (sich selbst vom Mac neu laden), `clone-profile` (Profil kopieren, Token der Kopie geleert) und `set-trained-flats` (trainierte Flat-Belichtungen ins Prüfstand-Profil, Sicherung `<Profil>.profile.bak`): keine beliebigen Befehle, keine Anmeldedaten. Der Prüfstand-Schlüssel liegt auf dem Mac in `~/.config/nina-pm/vm-bench.json` und in der VM in `C:\NinaPmBench\agent.json`, nicht im Repository. Er ist kein Zugang eines Menschen.

Netz: VMware-NAT, Mac `172.16.245.1`, VM `172.16.245.130`.

Prüfstand-Schlüssel wechseln: auf dem Mac in `~/.config/nina-pm/vm-bench.json` die Zeile `key` löschen, `pnpm vm-bench setup` ausführen und die ausgegebene Zeile in der VM erneut ausführen.

Geräte verbindet der Prüfstand nach einem Rescan je Typ (`/equipment/<gerät>/rescan`) mit der Geräte-ID aus dem aktiven Profil; per Alpaca-Discovery gefundene Geräte kennt NINA nach dem Start sonst noch nicht („Invalid Id“). Die VM erreicht den Mac wie bisher beim Test-Server.

## Einrichtung (einmalig, ≈ 15 min, Sven)
1. **Advanced API in NINA (VM):**
   - *Options → Plugins → Available* → **Advanced API** installieren, NINA neu starten.
   - *Options → Plugins → Advanced API*: API an, Port **1888**.
   - Die Firewall-Abfrage von Windows mit „Zulassen“ beantworten (die Einrichtung in Schritt 4 legt die Regel ohnehin an).
2. **NINA-PM-Optionen im Profil der VM:** Server-URL `http://172.16.245.1:8787/api`, Token `npm_test`, *Testbetrieb* an.
3. **Sequenz:** entfällt. Der Prüfstand erzeugt je Lauf `nina-pm-bench.json` aus der Beispielsequenz ohne *Wait for Sun Altitude* und *Run Autofocus*; der Agent legt sie in NINAs Standard-Sequenzordner (`SequenceSettings.DefaultSequenceFolder` im Profil). Gelöscht statt deaktiviert, weil NINA 3.2 „deaktiviert“ nicht speichert.
4. **Agent:**
   - Auf dem Mac im eigenen Terminal `pnpm vm-bench setup` ausführen. Es gibt den Einrichtungsbefehl mit dem Schlüssel aus, nur in Svens Terminal.
   - In der VM PowerShell **„Als Administrator ausführen“** öffnen und die Zeile mit `172.16.245.1` einfügen.
   - Der Mac meldet „Agent meldet sich … Einrichtung fertig“.
5. **Sperrbildschirm aus:** *Einstellungen → Konten → Anmeldeoptionen* → „Wenn Sie abwesend waren, wann soll Windows eine erneute Anmeldung erfordern?“ → **Nie**. Standby und Bildschirm schaltet die Einrichtung schon ab. Die VM bleibt angemeldet.
6. Während der Läufe schläft der Mac nicht: `caffeinate -dims` in einem Terminal.

## Vor jedem Lauf: was in der VM laufen muss
Nach einem Neustart der VM startet nur der Agent von selbst (bei der Anmeldung). Die Simulatoren startet Sven **von Hand**, und zwar **erst, wenn die Uhr der VM stimmt** (Sky Simulator und OmniSim übernehmen die Zeit beim Start – mit falscher Uhr zeigt das Kamerabild den falschen Himmel und das Zentrieren scheitert, 04.10.2026); NINA startet der Prüfstand selbst.

| Programm | Wofür | Prüfung durch den Prüfstand |
|---|---|---|
| Windows-Anmeldung | Agent „NINA-PM Bench Agent“ startet bei der Anmeldung; falls nicht: `Start-ScheduledTask -TaskName 'NINA-PM Bench Agent'` | „Agent in der VM meldet sich nicht“ |
| **Sky Simulator for ALPACA** (Port 11111, nur lokal) | Kamera, Montierung, Filterrad, Rotator | Verbinden schlägt fehl |
| **ASCOM Alpaca OmniSimulator** (Port **32323**, Firewall „Zulassen“) | Safety-Monitor (sicher/unsicher schaltet der Prüfstand) | Vorabprüfung vor jedem Lauf mit Safety-Monitor: „OmniSim antwortet nicht“ |
| **PHD2** (Simulator-Profil, gestartet) | Guider | Verbinden des Guiders schlägt fehl |
| NINA | – | **nicht** von Hand starten; der Prüfstand startet NINA frisch |
| Uhr der VM | Zeitdienst `w32time` läuft, Zeitquelle gesetzt (`w32tm /config /manualpeerlist:"time.windows.com,0x9" /syncfromflags:manual /update`, dann `w32tm /resync /force`) | Lauf bricht nach 75 s ab, wenn das Plugin `clock_skew` meldet |

## Geräte im NINA-Profil der VM
Die Advanced API verbindet je Gerätetyp das **im Profil ausgewählte** Gerät; welche Geräte ein Lauf verbindet, steht in `tools/vm-bench/runs/<lauf>.json` (`connect`, alle anderen werden getrennt).

| Gerät | Im Profil ausgewählt | `vm-flip` |
|---|---|---|
| Kamera | Camera Sky Simulator for ALPACA | verbunden, Kühlung −10 °C |
| Montierung | Mount Sky Simulator for ALPACA | verbunden |
| Filterrad | Filterwheel Sky Simulator for ALPACA, Namen wie `tools/nina-test-server/rig.json` | verbunden |
| Rotator | Rotator Sky Simulator for ALPACA, Bereich `FULL` | verbunden |
| Guider | PHD2 (Simulator; PHD2 vorher starten und verbinden) | verbunden |
| Safety-Monitor | Alpaca Safety Monitor Simulator (OmniSim), sicher | verbunden |
| Fokussierer, Kuppel, Flat-Panel, Wetter, Schalter | – | getrennt |

Meridian-Flip-Werte setzt der Lauf selbst über die Advanced API (`profile` in der Laufdatei).

## Befehle (Claude Code)
| Befehl | Wirkung |
|---|---|
| `pnpm vm-bench status` | Agent und Advanced API erreichbar, Sequenzen in NINA |
| `pnpm vm-bench clone-profile --name <name> --server-url <url> [--filters a,b,…] [--flip 5,10,5]` | Prüfstand-Profil kopieren (neue Id, Name, Filternamen, Flip-Werte, NINA-PM-URL, Testbetrieb aus, Token geleert) und in NINA aktivieren; das Token trägt Sven auf der Optionsseite ein |
| `pnpm vm-bench update-agent` | Agent in der VM aus dem Repository neu laden (ab dieser Version ohne Handgriff) |
| `pnpm vm-bench install-plugin <ordner>` | Plugin-Build (CI-Artefakt `nina-pm-plugin`) in die VM, NINA neu gestartet |
| `pnpm vm-bench run vm-flip [--plugin <ordner>]` | Lauf: NINA frisch ohne `ninapm.db`, Profilwerte, Geräte, Test-Server, Sequenz, Screenshots, Log und Report, Auswertung |
| `pnpm vm-bench screenshot [reiter]` | Screenshot des NINA-Fensters |

Ergebnisse liegen in `.vm-bench/<zeit>-<lauf>/` (`report.json`, `nina.log`, `vm-check.txt`, Screenshots; nicht im Repository). Abgenommene Läufe kommen wie bisher nach `docs/test-runs/<datum>/`.

Safety-Monitor in Läufen (`steps`):
- `safe: true|false` setzt über die Simulator-Schnittstelle von OmniSim (Port 32323, `PUT /simulator/v1/safetymonitor/0/issafesetting`), was der Monitor meldet. Der Monitor bleibt verbunden, wie bei einem Dach, das schließt (P-25 „unsicher“).
- `monitor: disconnect|connect` trennt und verbindet ihn über die Advanced API. Das ist der Fall „Monitor verloren“ (P-25: `safety_monitor_not_connected`, kein Park/Unpark im Takt).
- Vor jedem Lauf setzt der Prüfstand OmniSim auf sicher.

Läufe: `vm-flip`, `vm-smoke`, `vm-transit`, `vm-replan-transit`, `vm-transit-flip`, `vm-flats`, `vm-flats-auto`. Ein Lauf endet 60 s, nachdem die Session abgeschlossen ist; `untilMin` ist die Obergrenze.

### Flats (AP-50/AP-50b): `vm-flats`, `vm-flats-auto`

Zwei kurze Läufe statt einzelner Protokolle (Sven 04.10.2026: Laufzeit optimieren):

| Lauf | deckt ab | Dauer |
|---|---|---|
| `vm-flats` | P-12 (Reihenfolge, Kombinationen, Dark-Flat-Gruppe, Neustart in der 2. Kombination mit Fortsetzen) und P-35 (Bin 1/Bin 2, Gain/Offset `null`) | ≈ 25 min |
| `vm-flats-auto` | P-38 (Auto-Flats einmal je Projekt: vorhandene Flats aus dem Test-Server, alle Kombinationen `covered`, kein Flat-Lauf) | ≈ 20 min |

| Gerät | Simulator | Zustand |
|---|---|---|
| Kamera | Camera Sky Simulator for ALPACA | verbunden, −10 °C |
| Montierung | Mount Sky Simulator for ALPACA | verbunden |
| Filterrad | Filterwheel Sky Simulator for ALPACA | verbunden |
| Guider | PHD2 (Simulator) | verbunden |
| Safety-Monitor | OmniSim Safety Monitor | verbunden, sicher |
| Flat-Panel, Rotator, Fokussierer, Kuppel | – | getrennt |

- **Trainierte Flats:** Der Lauf schreibt vor dem Start je Filterposition und Binning (1, 2) eine trainierte Belichtung (1 s, Gain/Offset −1) ins Prüfstand-Profil (`set-trained-flats`, Vorlage für den Binning-Knoten aus demselben Profil) und prüft nach dem Start über die Advanced API, dass NINA sie geladen hat. Kein Training von Hand.
- **Ohne Flat-Panel:** *Trained Flat/Dark Flat Exposure* überspringen Panel-Schritte, wenn kein Panel verbunden ist; es bleiben die Belichtungen (FLAT, Dark-Flats als DARK).
- **Ohne Rotator:** Der Sky Simulator rendert sein Bild unabhängig vom Rotator – *Center and Rotate* käme nie auf den Winkel. Alle Lights stehen bei 0°; zwei mechanische Winkel und der Flip ohne zweite Kombination prüft der kopflose Lauf P-12.
- **Flip im Flat-Lauf:** NINA flippt im ersten Block, aber das Sky-Simulator-Teleskop meldet ≈ 90 s danach wieder `pierWest` (Lauf 04.10.: NINA flippt am Blockende ein zweites Mal). Die Pier-Seite vor und nach der Belichtung ist dann gleich, also kein `FLIP` im Plugin-Log. Das ist ein Simulator-Artefakt; `vm-flats` prüft den Flip deshalb nicht, sondern nur, dass er keine weitere Kombination ergibt.
- **Neustart (P-12):** Schritt `restartAfterLog`: sobald die 2. verschiedene Zeile `FLATS_START combination=` im Log steht, startet der Prüfstand NINA neu (ohne `ninapm.db` zu löschen), verbindet die Geräte und startet die Sequenz wieder.
- **Mittelwert der Flats:** Die Simulator-Kamera liefert Sternfelder, keine hellen Flats – `WARNING code=flat_exposure_off` nach der ersten Flat je Kombination ist dort erwartet.
