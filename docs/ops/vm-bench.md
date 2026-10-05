# VM-Prüfstand: echtes NINA in der Windows-VM, gesteuert vom Mac

Claude Code fährt die VM-Läufe ohne Handgriffe: Ein kleiner Agent in der VM holt Aufträge vom Mac. Er installiert das Plugin, löscht `ninapm.db`, startet und beendet NINA und schickt das NINA-Log zurück. Geräte, Profilwerte, Sequenzstart und Screenshots laufen über das NINA-Plugin **Advanced API**. Die Auswertung ist dieselbe wie bisher (`pnpm plugin:sim --vm`).

**Nur für die Test-VM:** Die Advanced API hat keine Anmeldung, nie auf dem Rig einrichten.

## Aufbau
| Teil | Wo | Was |
|---|---|---|
| `pnpm vm-bench` (`tools/vm-bench`) | Mac | Prüfstand-Server (Port 8788) mit Auftragswarteschlange; Test-Server (8787) im selben Prozess; Advanced-API-Client; Auswertung |
| Agent `C:\NinaPmBench\NinaPmBenchAgent.ps1` | VM | Aufgabenplanung „NINA-PM Bench Agent“ bei Anmeldung, in der angemeldeten Sitzung (NINA erscheint normal auf dem Bildschirm); fragt alle 3 s den Mac nach Aufträgen |
| Advanced API (NINA-Plugin, Port 1888) | VM | Geräte verbinden, Profilwerte, Sequenz laden und starten, Reiter, Screenshots |

Der Agent kennt nur die Aufträge `ping`, `restart-nina`, `stop-nina`, `install-plugin` und `put-sequence` (je mit SHA-256-Prüfung), `collect-log`, `update-agent` (sich selbst vom Mac neu laden), `clone-profile` (Profil kopieren, Token der Kopie geleert) und `set-trained-flats` (trainierte Flat-Belichtungen ins Prüfstand-Profil, Sicherung `<Profil>.profile.bak`), `clean-images` (vor jedem Lauf: nur Datumsordner `JJJJ-MM-TT` im Bildordner des Profils und die Zwischenbilder des Plate-Solvers löschen – die Simulator-Kamera ignoriert die Belichtungszeit, Transitserien liefern Hunderte FITS je Lauf; 05.10.2026 lief der Speicher voll): keine beliebigen Befehle, keine Anmeldedaten. Der Prüfstand-Schlüssel liegt auf dem Mac in `~/.config/nina-pm/vm-bench.json` und in der VM in `C:\NinaPmBench\agent.json`, nicht im Repository. Er ist kein Zugang eines Menschen.

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
| `pnpm vm-bench real-check <szenario>` | Szenario gegen den echten Server ohne VM prüfen (Standort, Ziele, Plan) |
| `pnpm vm-bench screenshot [reiter]` | Screenshot des NINA-Fensters |

Ergebnisse liegen in `.vm-bench/<zeit>-<lauf>/` (`report.json`, `nina.log`, `vm-check.txt`, Screenshots; nicht im Repository). Abgenommene Läufe kommen wie bisher nach `docs/test-runs/<datum>/`.

Safety-Monitor in Läufen (`steps`):
- `safe: true|false` setzt über die Simulator-Schnittstelle von OmniSim (Port 32323, `PUT /simulator/v1/safetymonitor/0/issafesetting`), was der Monitor meldet. Der Monitor bleibt verbunden, wie bei einem Dach, das schließt (P-25 „unsicher“).
- `monitor: disconnect|connect` trennt und verbindet ihn über die Advanced API. Das ist der Fall „Monitor verloren“ (P-25: `safety_monitor_not_connected`, kein Park/Unpark im Takt).
- Vor jedem Lauf setzt der Prüfstand OmniSim auf sicher.

**Absturz-Wächter (05.10.2026):** Während eines Laufs fragt der Prüfstand alle 30 s die Advanced API ab. Antwortet NINA zweimal im Abstand von 10 s nicht, holt er die Windows-Ereignisse (`app-events.txt` im Laufordner: .NET Runtime, Application Error), bricht den Lauf ab und wiederholt ihn **einmal** von vorn – der bekannte Absturz der x64-Emulation (`AccessViolationException` in `coreclr.dll`, 03.–05.10.2026) hält so keine Lauffolge mehr auf und bleibt belegt. Nach `real`-Läufen schreibt der Prüfstand den vorherigen Standort ins NINA-Profil zurück.

Läufe: `vm-flip`, `vm-smoke`, `vm-transit`, `vm-replan-transit`, `vm-transit-flip`, `vm-flats`, `vm-flats-auto`, `vm-multi-night`; gegen den echten Server `real-night-flats`, `real-transit`, `real-commands`, `real-full-night`, `real-network`, `real-flip` (unten). Ein Lauf endet 60 s, nachdem die Session abgeschlossen ist (mit `sessions: n` erst nach n abgeschlossenen Sessions); `untilMin` ist die Obergrenze.

### Gegen den echten Server (Stufe 2a): `real-*`

Die Läufe oben sprechen mit dem `nina-test-server`, der seine Pläne selbst baut. Planung, Transit-Auslieferung, Session-Jobs, Befehle und Nachtbericht des **echten** Servers prüfen sie nicht (Analyse 04.10.2026). Die `real-*`-Läufe starten statt des Test-Servers den echten API-Code (`apps/api/src/bench/real-server.ts` auf dem lokalen Stack `local-stack.ts`: PGlite mit Demo-Seed, echte Uhr, Takt wie `tick-5min` jede Minute, Discord-Nachbildung) auf demselben Port. Die Nacht wird über die **Daten** gestaucht, nicht über die Uhr:

- **Standort:** Breite 50°, Länge so gelöst, dass die astronomische Dämmerung 25 / 40 / 35 min nach dem Start endet (`nightTimes`, Zone `Etc/GMT±h`); NINA bekommt denselben Standort ins Profil. Die Montierung übernimmt ihn beim Verbinden (`TelescopeLocationSyncDirection = TOTELESCOPE`, nur in `real`-Läufen): NINA flippt nach der Sternzeit der Montierung, und der Simulator stünde sonst weiter in Starfront (`mount_site_mismatch`). Nach dem Lauf verbindet der Prüfstand die Montierung einmal neu und setzt sie so auf Starfront zurück. Der Sky-Simulator speichert den Standort auf 0,01° gerundet; NINA meldet dabei „Unable to set mount latitude“, das ist harmlos. Test-Server-Läufe übertragen nichts (`NOSYNC`), damit die Meldung nicht bei jedem Lauf erscheint.
- **Ziele:** Deep-Sky-Projekte bei Dec +75° (aus jeder Länge hoch genug) mit Stundenwinkel +2 h (kein Meridiandurchgang; in `real-flip` Meridian 10 min nach dem Start, RA J2000 um die Präzession verschoben), freigegeben wie in den API-Tests; Filterrad wie die VM; Rig A ohne Rotator wie Starfront; Flip-Werte von Rig und Profil gleich (1 / 5 / 0 min, Dauer 120 s, Recenter aus).
- **Transit:** Katalogeintrag `BENCH-1b` mit T0 aus der gewünschten Transitmitte (22 min nach dem Start), ohne Grundlinie festgelegt; die Wertung `observed` zieht der Prüfstand am Ende vor (Frist `TRANSIT_SETTLE_GRACE_MS`).
- **Token:** Das Profil der VM schickt weiter `npm_test`; der Prüfstand schreibt es auf das Token einer echt angelegten Instanz um. Der *Testbetrieb* schaltet gegen den echten Server keine Sicherheitsprüfung ab (keine Test-Server-Antwort).

| Lauf | prüft | Dauer |
|---|---|---|
| `real-night-flats` | Plan durch den Server, Nachtende, Flats und Dark-Flats, Abschluss, Nachtbericht, Discord, Zähler = gemeldete Lights | ≈ 35 min |
| `real-transit` | festgelegter Transit in `targets`, Transitblock in NINA, Aufnahmen mit Beobachtung, `observed`, Abschluss | ≈ 45 min |
| `real-commands` | Projekt des laufenden Blocks pausiert → Neuplanung, Kommandos `refresh_targets`/`reset_plan` quittiert, NINA-Neustart → `resume` derselben Session | ≈ 40 min |
| `real-full-night` | typische Starfront-Nacht: vier Ziele, LRGB und SHO, Gain/Offset je Zeile, Dither alle 3; Flats je belichtetem Filter, erst nach *Wait for Time → Nautical Dawn* in *Vor Flats* | ≈ 100 min |
| `real-network` | Netzausfall 12 min (Anfragen des Plugins ohne Antwort): Session verwaist (`stale`), danach Outbox nachgereicht, Abschluss | ≈ 50 min |
| `real-flip` | Meridian-Flip **ohne Rotator** wie Starfront: Ereignis `flip` im Flip-Fenster, keines `flip_undetected`, Aufnahmen vor und nach dem Flip, keine Flip- oder Standortwarnung der Einstellungsprüfung | ≈ 45 min |
| `real-long-night` | lange Nacht über Nacht (Lücke E): 4½ h Dunkelheit, sechs Ziele mit LRGB und SHO à 120 s, Dither alle 3, Flip ohne Rotator im letzten Block, Flats mit Panel nach der nautischen Dämmerung; Session nie verwaist (Stichprobe je Minute), keine Fehler-Ereignisse, höchstens ein Plan je 5 min, mindestens fünf Ziele belichtet | ≈ 5½ h |

Auswertung aus der Datenbank (`report.json` mit `checks`) und aus dem NINA-Log (`summary.json`); der Lauf ist grün, wenn alle Prüfungen stimmen und das Log keine `ERROR`, keine 4xx und eine leere Outbox zeigt. Ohne VM prüft `pnpm vm-bench real-check <night-flats|transit|commands|full-night|network|flip|long-night>` in Sekunden, dass der Server zum Szenario einen passenden Plan liefert (mit geplantem Flip) (dasselbe in `apps/api/test/bench-real-server.test.ts`).

### Gegen prod (Stufe 2b): `prod-short`

Kurzer Lauf gegen `nina-pm.svenesis.org` mit dem Test-Mandanten. Standort und Testziel rechnet `pnpm vm-bench prod-site --start <ISO>` aus; Sven stellt sie im Web ein, Claude Code greift nicht auf prod zu. Ablauf, Prüfliste und Rückbau stehen in `docs/ops/stage-2b-prod.md`.

### Flats (AP-50/AP-50b): `vm-flats`, `vm-flats-auto`

Zwei kurze Läufe statt einzelner Protokolle (Sven 04.10.2026: Laufzeit optimieren):

| Lauf | deckt ab | Dauer |
|---|---|---|
| `vm-flats` | P-12 (Reihenfolge, Kombinationen, Dark-Flat-Gruppe, Neustart in der 2. Kombination mit Fortsetzen) und P-35 (Bin 1/Bin 2, Gain/Offset `null`) | ≈ 25 min |
| `vm-flats-auto` | P-38 (Auto-Flats einmal je Projekt: vorhandene Flats aus dem Test-Server, alle Kombinationen `covered`, kein Flat-Lauf) | ≈ 20 min |

**Flat-Panel (Lücke B, 05.10.2026):** `vm-flats` und `real-full-night` verbinden den OmniSim-*CoverCalibrator* (`FlatDeviceSettings-Id`, `connect: flatdevice`) und bauen *Vor Flats* und *Nach Flats* wie die Rig-Checkliste: Abdeckung zu und Licht an, danach Licht aus (`sequence.flatsPanel`). NINA loggt Abdeckung und Licht nicht. Deshalb fragt der Prüfstand das Panel alle 5 s über die Advanced API ab (`panel.json` im Laufordner). Der Lauf ist nur grün, wenn während der Flats die Abdeckung zu (oder keine vorhanden) und das Licht mit Helligkeit > 0 an war und das Licht am Ende aus ist.

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

### Tagesschleife (AP-52): `vm-multi-night`

P-23 und P-24 auf echtem NINA in ≈ 45 min. Der Test-Server liefert **zwei verkürzte Nächte** im Abstand von 20 min (Szenario-Option `nightSpacingMin`). Die Nacht-Tabelle wechselt 1 min nach dem Sessionende auf die nächste Nacht, die Dämmerungen liegen am Anfang jeder Nacht. NINA fährt die Beispielsequenz „Mehrere Nächte“ ohne Neustart und ohne Handgriff.

| Gerät | Simulator | Zustand |
|---|---|---|
| Kamera | Camera Sky Simulator for ALPACA | verbunden, −10 °C |
| Montierung | Mount Sky Simulator for ALPACA | verbunden |
| Filterrad | Filterwheel Sky Simulator for ALPACA | verbunden |
| Guider | PHD2 (Simulator) | verbunden |
| Safety-Monitor | OmniSim Safety Monitor | verbunden, sicher |
| Rotator, Fokussierer, Kuppel, Flat-Panel | – | getrennt |

- **Sequenz** (aus `multi-night.json`, Optionen in `sequence`):
  - *Run Autofocus* fehlt auch in der Tagesschleife, weil die VM keinen Fokussierer hat;
  - *Warm Camera* fehlt am Morgen in der Tagesschleife: Das erneute Kühlen (bis 10 min, Lauf 04.10.) fräße die verkürzte zweite Nacht auf; der Ende-Bereich wärmt nach der letzten Nacht;
  - *NINA-PM Warten auf Zeit* wartet bis zur nautischen Dämmerung + 2 min;
  - Höchstzahl 2 Nächte;
  - am Container „Ziel“ hängt die Box *NINA-PM vor jeder Belichtung* mit *Wait for Time Span* 1 s.
- **Prüfungen** (`tools/nina-sim/runs/vm-multi-night.json`, kopflos mit `dayLoop`):
  - zwei abgeschlossene Sessions mit verschiedenen Nacht-Schlüsseln;
  - *Warten auf Zeit* endet ±30 s zur Dämmerung + 2 min der 2. Nacht, erst danach kommen Plan und Blöcke;
  - die Box läuft vor jeder Belichtung (`TRIGGER type=BeforeExposureTrigger` so oft wie `CAPTURE`, nur NINA);
  - das Ende kommt nach der Höchstzahl (`DAYLOOP_END reason=max_nights`).
- **Erster echter Ladetest** der abgeleiteten Beispielsequenz `multi-night.json` in NINA.

