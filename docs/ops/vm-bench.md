# VM-Prüfstand: echtes NINA in der Windows-VM, gesteuert vom Mac

Claude Code fährt die VM-Läufe ohne Handgriffe: Ein kleiner Agent in der VM holt Aufträge vom Mac. Er installiert das Plugin, löscht `ninapm.db`, startet und beendet NINA und schickt das NINA-Log zurück. Geräte, Profilwerte, Sequenzstart und Screenshots laufen über das NINA-Plugin **Advanced API**. Die Auswertung ist dieselbe wie bisher (`pnpm plugin:sim --vm`).

**Nur für die Test-VM:** Die Advanced API hat keine Anmeldung, nie auf dem Rig einrichten.

## Aufbau
| Teil | Wo | Was |
|---|---|---|
| `pnpm vm-bench` (`tools/vm-bench`) | Mac | Prüfstand-Server (Port 8788) mit Auftragswarteschlange; Test-Server (8787) im selben Prozess; Advanced-API-Client; Auswertung |
| Agent `C:\NinaPmBench\NinaPmBenchAgent.ps1` | VM | Aufgabenplanung „NINA-PM Bench Agent“ bei Anmeldung, in der angemeldeten Sitzung (NINA erscheint normal auf dem Bildschirm); fragt alle 3 s den Mac nach Aufträgen |
| Advanced API (NINA-Plugin, Port 1888) | VM | Geräte verbinden, Profilwerte, Sequenz laden und starten, Reiter, Screenshots |

Der Agent kennt nur die Aufträge `ping`, `restart-nina`, `stop-nina`, `install-plugin` und `put-sequence` (je mit SHA-256-Prüfung), `collect-log`, `update-agent` (sich selbst vom Mac neu laden) und `clone-profile` (Profil kopieren, Token der Kopie geleert): keine beliebigen Befehle, keine Anmeldedaten. Der Prüfstand-Schlüssel liegt auf dem Mac in `~/.config/nina-pm/vm-bench.json` und in der VM in `C:\NinaPmBench\agent.json`, nicht im Repository. Er ist kein Zugang eines Menschen.

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

Läufe: `vm-flip`, `vm-smoke`. Ein Lauf endet 60 s, nachdem die Session abgeschlossen ist; `untilMin` ist die Obergrenze.
