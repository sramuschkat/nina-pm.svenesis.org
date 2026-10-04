# Plugin-Testprotokolle (Mensch in der Schleife)

Durchführung durch Sven auf dem Windows-Rechner (H-14) mit NINA-Simulatorgeräten. Claude Code liefert zu jedem Protokoll das Build-Artefakt, ggf. ein Probe-Plugin und das Szenario für `tools/nina-test-server`. Ergebnisse unter `docs/test-runs/<JJJJ-MM-TT>/<P-xx>/` ablegen:
- `result.json` (Schema unten), `nina.log` (nur Zeilen mit Präfix `NINA-PM |`), Screenshots `*.png`.

Claude Code wertet `result.json` und das Log maschinell aus (`pnpm test-run:check <ordner>` prüft die erwarteten Log-Ereignisse je Protokoll) und entscheidet mit Sven Go/No-Go.

## Testbetrieb tagsüber: `tools/nina-test-server`
NINA-Simulatoren haben keine Simulatoruhr. Deshalb läuft das Plugin gegen einen lokalen Test-Server statt gegen prod:
1. `pnpm nina-test-server --scenario <name>` auf dem Windows-Rechner starten (Port 8787); Szenarien liegen unter `tools/nina-test-server/scenarios/` (`one-night`, `replan`, `replan-transit`, `transit`, `flip`, `delay`, `night-end`, `flats`, `flats-binning`, `multi-night`, `lease`, `mosaic-flip`, `transit-flip`, `current-night`, `safety`, `filters-readout`, `filter-restored`, `vm-smoke`, `flip-no-rotator`, `vm-flip`, `starfront-night`, `starfront-night-untuned`, `starfront-roof`, `starfront-center-fails`).
2. Im Plugin Server-URL `http://localhost:8787/api` und Token `npm_test` eintragen. Läuft der Server auf einem anderen Rechner im lokalen Netz (z. B. dem Mac neben der Windows-VM), dann `http://<IP dieses Rechners>:8787/api` – nur Adressen aus 10/8, 172.16/12 und 192.168/16 gelten als lokal (die Firewall des Rechners muss Port 8787 für Node zulassen); P-29 und P-36 brauchen den Server auf dem Windows-Rechner selbst. Der Server lauscht nur auf Anfragen des Plugins; das Rig selbst braucht nie eingehende Verbindungen.
3. Der Server erzeugt Blöcke ab `jetzt + 2 min`, für Flip-Tests ein Ziel mit `RA_J2000 = LST + n min − (α_app − α_J2000)` (NT-35: der Meridian gilt für die scheinbare RA; ohne die Korrektur liegt der Flip 2026 um gut 1 min daneben, polnah deutlich mehr), Transitfenster ab `jetzt + 10 min`. Ausnahme Szenario `current-night`: es liefert die echte Nachttabelle des Standorts Starfront (`America/Chicago`, `bootstrap.nights[]`, `timeZoneTransitions`) und prüft den `night`-Wert in `POST /plan`/`POST /sessions` (sonst `422 nina.night_invalid`). Änderungen zur Laufzeit über `POST /test/actions {action}` (oder die Szenario-Zeitleiste):

| `action` | Wirkung im Test-Server | gebraucht von |
|---|---|---|
| `targets_change` | neues `targetsEtag`, geänderte Zielliste | P-06, P-15 |
| `pause_project` | Projekt auf `on_hold`, neues ETag; mit `project` (Projektname aus dem Szenario, z. B. `ngc7000`) genau dieses, sonst das erste aktive | P-06, P-15 |
| `lock_transit` | Transit `locked` mit Fenster vor Blockende | P-15b |
| `skip_block` | markiert den laufenden Block als übersprungen | P-05 |
| `lease_release` | nächste Heartbeat-Antwort trägt `lease.leaseLost = true` | P-17 |
| `rig_busy` | `POST /sessions` und `PATCH … {status: running}` antworten `409 session.rig_busy`; die Heartbeat-Antwort einer laufenden Session trägt `leaseLost: true` (eine andere Instanz hält das Rig) | P-10 |
| `revoke_token` | alle weiteren Aufrufe antworten `401 nina.token_invalid` | P-18 |
| `drop_responses` | der Server nimmt Anfragen an, antwortet aber nicht (Timeout) – ersetzt das Trennen des Netzes, das bei `localhost` nicht wirkt | P-09 |
| `restore_responses` | antwortet wieder normal (Heartbeat-Antwort `leaseLost: false`) | P-09 |
| `clock_skew` | `serverTimeUtc` in Bootstrap und Heartbeat-Antwort um +90 s verschoben (Wert als Parameter `seconds`) | P-37 |
| `filter_wheel_changed` | Bootstrap/`targets` liefern für einen Platz einen `ninaFilterName`, der im NINA-Profil nicht (mehr) vorkommt; weicht das Filterrad im Heartbeat von der Belegung ab, Alarm `filter_wheel_changed` im Report | P-32 |
| `filter_wheel_restored` | nimmt `filter_wheel_changed` zurück (Belegung im Web korrigiert): neues targets-ETag, der Name passt wieder | P-05 |
| `clear` | setzt alle Aktionen zurück | alle |

  Das Szenario `lease` startet mit zwei registrierten Instanzen desselben Rigs, damit P-10 und P-17 ohne echten zweiten Rechner laufen (NIN5-16).
  Der Report (`GET /test/report`) enthält außerdem `alerts` (`session_stale`: 10 min ohne Heartbeat → Session *verwaist*, P-22; `filter_wheel_changed`, P-32) und `rejected` (abgelehnte Anfragen mit den Vertragsfehlern – zeigt Abweichungen des Plugins vom Vertrag).
4. Sicherheitsprüfungen (Dunkelheit, Höhe) überspringt das Plugin nur, wenn der Server `X-NPM-Test: 1` sendet; prod sendet den Header nie.

## Kopfloser Nachtlauf: `pnpm plugin:sim` (Entscheidung Sven 02.10.2026)
Die Ablauflogik eines Protokolls prüft zuerst der kopflose Nachtlauf – ohne NINA, ohne VM, in Sekunden, bei jedem Plugin-PR (Auftrag `plugin-sim` in `plugin.yml`, Ergebnisordner als Artefakt):
1. `tools/nina-sim` startet je Lauf den Test-Server mit **virtueller Uhr** (jede Anfrage trägt die Zeit des Plugins im Kopf `x-npm-sim-now`) und `apps/nina-plugin/NinaPm.Sim`: der unveränderte Plugin-Kern (`NightRunner`, `BlockExecutor`, Heartbeat, Outbox, Lease, `ninapm.db`) mit einem simulierten NINA. Dieselben Regeln wie der Adapter kommen aus dem Kern (`HostRules`: Filter, Auslesemodus, Hinweise, Aufnahme-Meldung; `SafetyWait`: *Warten bis sicher oder Nachtende*); die Sequenz bildet die Beispielsequenz „Eine Nacht mit Safety“ nach (Ziel mit *Loop While Safe* und Nachtschleife, Sicherung, Ende).
2. Ein Lauf ist `tools/nina-sim/runs/P-xx.json`: Szenario, Geräte (`setup`: Filterrad, Auslesemodi, Kamera-Sollwert, Dither-Trigger, Autofokus-Trigger `afTrigger`, NINA-Profil `recenter`/`autoFocusAfterFlip`), Schritte zur Minute (`server`: Aktion des Test-Servers; `sim`: `start`, `stop` (Benutzer-Stopp), `crash` (NINA hart beendet), `unsafe`/`safe`, `monitor_off`/`monitor_on`, `setpoint`, `filters`, `readout_modes`, `network_down`/`network_up`) und **je Protokollschritt Prüfungen** auf Log und Report (Anzahl, Reihenfolge, Abwesenheit vor/nach einem Ereignis, je Block). P-22 läuft in zwei Teilen (zwei Nächte).
3. Ergebnis je Lauf unter `.sim-runs/P-xx/` (bzw. `--out`): `nina.log`, `report.json`, `result.json` mit `ok`/`note` je Schritt aus den Prüfungen; danach `test-run:check` wie bei einem VM-Lauf. `pnpm plugin:sim P-17` fährt einen Lauf, ohne Angabe alle.

Abgedeckt: P-05, P-06, P-10, P-12, P-14, P-15, P-15b, P-17, P-19, P-22, P-25, P-27, P-32, P-33, P-34, P-35. **Nicht** abgedeckt – bleibt beim Windows-Sequenztest bzw. beim VM-Kurzlauf: NINAs Sequencer (Trigger-Walk, `TRIGGER_SUPPRESSED`, P-28), echtes `ImageSaved` mit Messwerten, Profil- und Geräteeinstellungen, Park/Home, Plattensolve und Flip.

## Starfront-Szenarien (kopflos, aus echten Nächten)
Aus 21 NINA-Logs des Rigs in Starfront (23.08.–26.09.2026, Astro PM) und dem NINA-Profil gemessen (03.10.2026): Dither-Settle Median 18 s, Slew und Zentrieren 35 s, Autofokus 2–5 min, Flip 250 s nach 10 min Pause um den Meridian (Pause vor dem Meridian 5 min, Flip 5 min danach). Die Szenarien geben dem Test-Server diese Rig-Werte (`scheduler` im Szenario) und dem simulierten NINA die gemessenen Zeiten (`setup` im Lauf):

| Lauf | Prüft |
|---|---|
| `starfront-night` | Rig-Werte auf den Medianen: Plan und Nacht stimmen überein (54 geplant, 54 aufgenommen), Pause vor dem Meridian mit genau einem Flip |
| `starfront-night-untuned` | bisherige Rig-Werte (Dither 15 s, Flip 120 s): keine Sprünge wie bei Astro PM, sondern verschobene Planuhr (NT-21); 57 geplant, 55 aufgenommen |
| `starfront-roof` | Sequenz am Nachmittag bei geschlossenem Dach gestartet (Generic-File-Safety), Dach öffnet, schließt vor dem Ende der Dunkelheit wieder: keine abgelehnte Anfrage vor dem ersten Plan, keine Wiederaufnahme, Nacht abgeschlossen |
| `starfront-center-fails` | Zentrieren scheitert für ein Ziel (falsche Koordinaten wie am 04.09.2026): Wiederholungsleiter bis vor das Blockende, Block übersprungen, nächstes Ziel belichtet |

## VM-Kurzlauf `vm-smoke` (≈ 25 min, ersetzt die Einzelläufe auf der VM)
Prüft in **einem** Lauf, was nur echtes NINA zeigt: Profil im Heartbeat, `ImageSaved` mit NINAs Zeiten und Messwerten, NINAs Dither-Trigger unterdrückt, Kühlungsabweichung, Safety mit Park und Wiederaufnahme, Nachtende mit leerer Outbox, keine vom Server abgelehnte Anfrage. Die Ablauflogik ist vorher kopflos geprüft (`pnpm plugin:sim`, auch `vm-smoke` selbst mit denselben Zeitpunkten); auf Windows prüft der Adapter-Test die Bildpipeline in einer echten NINA-Sequenz.

Vorbereitung (einmal): Plugin aus dem `plugin`-Lauf auf `main` installieren; NINA-Profil-Filterrad wie `tools/nina-test-server/rig.json` (`LUMINANCE`, `RED`, `GREEN`, `BLUE`, `HA`, `SII`, `OIII`); Sequenz „Eine Nacht mit Safety“ nach der Vorlage (Start mit *Unpark*, Ziel mit *Loop While Safe* und *Nachtschleife*, darin *Set Tracking*/*Unpark* vor „Blöcke“, Sicherung mit Park und *Warten bis sicher oder Nachtende*, Ende mit Park); **globaler Trigger „Dither after Exposures“** (Amount 1); Geräte wie in den bisherigen Läufen: Sky-Simulator-Kamera (Kühlung an, Sollwert −10 °C) und -Montierung, PHD2-Simulator, Rotator getrennt (der Plan meldet dann `WARNING code=rotator_unavailable` und zentriert ohne Drehung – erwartet); OmniSim-Safety-Monitor verbunden und sicher; Plugin-Optionen Testbetrieb an, Server-URL `http://<Mac-IP>:8787/api`, Token `npm_test`.

Geräte in NINA (Stand der Läufe vom 01./02.10.2026):

| Gerät | Treiber / Simulator | Zustand | Einstellung |
|---|---|---|---|
| Kamera | Sky Simulator | verbunden | Kühlung an, Sollwert −10 °C (ignoriert die Belichtungszeit) |
| Montierung | Sky Simulator | verbunden | – |
| Filterrad | Sky Simulator | verbunden | Namen im Profil wie `rig.json`: `LUMINANCE`, `RED`, `GREEN`, `BLUE`, `HA`, `SII`, `OIII` (Plätze 1–7) |
| Fokussierer | Sky Simulator | verbunden oder getrennt | *Run Autofocus* in der Testkopie gelöscht |
| Guider | PHD2 (Simulator) | verbunden | – |
| Safety-Monitor | OmniSim | verbunden, sicher | OmniSim trennt bei jedem Umschalten – danach in NINA **neu verbinden** |
| Rotator | – | **getrennt** | `WARNING rotator_unavailable` je Block ist erwartet |
| Kuppel, Flat-Panel, Wetter, Schalter | – | getrennt | – |

Vor **jedem** Lauf mit einem frisch gestarteten Test-Server: NINA beenden und den lokalen Speicher des Plugins löschen (PowerShell: `Remove-Item "$env:LOCALAPPDATA\NINA\Plugins\Svenesis.NinaPm\ninapm.db*"`), dann NINA starten. Jeder Test-Server erzeugt seine Nacht neu, der Nacht-Schlüssel ist aber das Kalenderdatum – ein gespeicherter Plan vom vorigen Lauf derselben Nacht hat sein Dunkelheitsende längst hinter sich, das Plugin schlösse die Nacht sofort ab (`SESSION status=finished`, VM-Lauf 03.10.2026).

| Minute nach Serverstart | Wer | Was |
|---|---|---|
| 0 | Mac | `pnpm nina-test-server --scenario vm-smoke --host 0.0.0.0` |
| ≤ 1 | VM | Sequenz starten (Block 1 beginnt bei Minute 2) |
| 5 | VM | Kamera-Sollwert auf **0 °C** stellen (bis zum Ende so lassen) |
| 13 | VM | Safety-Monitor **unsicher** (OmniSim), danach in NINA neu verbinden |
| 15 | VM | Safety-Monitor wieder **sicher**, danach in NINA neu verbinden |
| ≈ 22 | – | Nachtende (Minute 21): Session abgeschlossen, Ende-Bereich parkt |
| 24 | Mac | `mkdir -p /tmp/vm && curl -s http://localhost:8787/test/report > /tmp/vm/report.json`, danach Server beenden |
| 24 | VM → Mac | NINA-Log der Sitzung als `/tmp/vm/nina.log` ablegen |

Die Sky-Simulator-Kamera ignoriert die Belichtungszeit (P-05, 02.10.2026): den Abbruch mitten in der Belichtung (`CAPTURE result=aborted`, P-25) prüft deshalb nur der kopflose Lauf. Auswertung: `pnpm plugin:sim --vm /tmp/vm` – prüft dieselben benannten Prüfungen wie der kopflose `vm-smoke`-Lauf, zusätzlich die nur mit NINA möglichen (`TRIGGER_SUPPRESSED`), und schreibt `vm-check.txt`. Grün → Abnahme der Pakete, deren Protokolle kopflos grün sind.

### VM-Kurzlauf `vm-flip` (≈ 35 min, Flip mit echtem NINA – P-07/P-26)
Meridian 8 min nach Serverstart im Block, Flip beim Eintrag `meridian_flip` nach NINAs frühester Flipzeit, danach nur Zentrieren, Rotator ohne Nachrotieren, SiteCheck ohne Befund. Vorher `ninapm.db` löschen (s. o.), Sequenz wie bei `vm-smoke`, der globale Dither-Trigger darf bleiben.

| Gerät | Treiber | Zustand | Einstellung |
|---|---|---|---|
| Kamera | Camera Sky Simulator for ALPACA | verbunden | Kühlung an, −10 °C |
| Montierung | Mount Sky Simulator for ALPACA | verbunden | – |
| Filterrad | Filterwheel Sky Simulator for ALPACA | verbunden | Namen wie `rig.json` |
| Rotator | Rotator Sky Simulator for ALPACA | **verbunden** | Optionen → Rotator: Bereich `FULL` |
| Guider | PHD2 (Simulator) | verbunden | – |
| Safety-Monitor | Alpaca Safety Monitor Simulator (OmniSim) | verbunden, sicher | – |
| Kuppel, Flat-Panel, Wetter, Schalter | – | getrennt | – |

NINA-Profil → Meridian-Flip (wie das Test-Rig): **Minuten nach Meridian 1**, **max. Minuten nach Meridian 5**, Pause vor Meridian 0, *Recenter* aus; Windows-Zeitzone = US Central.

| Minute nach Serverstart | Wer | Was |
|---|---|---|
| 0 | Mac | `pnpm nina-test-server --scenario vm-flip --host 0.0.0.0` |
| ≤ 1 | VM | Sequenz starten (Block ab Minute 2, Meridian bei Minute 8, Flip ab Minute 9) |
| ≈ 27 | – | Nachtende (Minute 26), Session abgeschlossen |
| 30 | Mac | `mkdir -p /tmp/vm-flip && curl -s http://localhost:8787/test/report > /tmp/vm-flip/report.json`, dann Server beenden; NINA-Log als `/tmp/vm-flip/nina.log` |

Keine Handgriffe während des Laufs. Auswertung: `pnpm plugin:sim --vm /tmp/vm-flip vm-flip`.

### VM-Termin AP-16h (≈ 40 min): Beispielsequenz in NINA, `vm-flip`
Nur was echtes NINA braucht. Live-Status und Optionsseite mit Zielbrowser prüfen die Render-Tests der Windows-CI (`RenderTests`, Artefakt `nina-pm-render`, kein Binding-Fehler), die Beispielsequenzen der Typ-Test `SampleSequenceTests`. P-11 (Framing-Assistent mit echten Zielen) folgt in der Plugin-Nacht P-05 gegen prod, die ohnehin mit dem Test-Mandanten läuft.

1. **Beispielsequenz (≈ 2 min):** `one-night-safety.json` aus `apps/nina-plugin/NinaPm.Nina/Samples/` in NINA laden – lädt sie ohne Fehler, ist der Skript-Umbau aus AP-16h bestätigt. Optional unverändert unter demselben Namen speichern und auf den Mac legen (ersetzt die Skriptfassung). Dann *Wait if Sun Altitude* und *Run Autofocus* im Start-Bereich **löschen** (nicht nur deaktivieren – NINA 3.2 speichert „deaktiviert“ nicht) und als `vm-test.json` speichern. Mit dem VM-Prüfstand (`docs/ops/vm-bench.md`) entfällt dieser Schritt. **Kein** globaler Dither-Trigger.
2. **`vm-flip` mit `vm-test.json` (≈ 35 min):** Geräte, Profil und Zeitplan wie im Abschnitt `vm-flip`, vorher `ninapm.db` löschen, keine Handgriffe. Optional bei Minute 3–7 ein Screenshot des aufgeklappten Containers (Banner, *Läuft*, „Heutige Ziele“).

Erwartet zusätzlich (vmOnly in `tools/nina-sim/runs/vm-flip.json`): genau einmal `WARNING code=sequence_template_deviation checks=start_wait_missing,start_autofocus_missing`, kein `safety_monitor_not_connected`. Auswertung: `pnpm plugin:sim --vm /tmp/vm-flip vm-flip`. Ergebnis unter `docs/test-runs/<Datum>/vm-flip/`.

## Log-Grammatik
Eine Zeile je Ereignis: `NINA-PM | EVENT key=value key=value …` (EVENT in Großbuchstaben, Werte ohne Leerzeichen oder in `"…"`), z. B. `NINA-PM | CAPTURE id=0192… result=saved file="NGC 281_Ha_0023.fits"`.

**Schlüsselnamen (verbindlich, NIN5-15).** Nur diese Schlüssel kommen vor; jeder Wert ist ein Wort, eine Zahl oder eine Zeichenkette in `"…"`:

| Schlüssel | Bedeutung | typische Ereignisse |
|---|---|---|
| `id` | UUID der Aufnahme (`captureId`), des Blocks oder des Plans | `CAPTURE`, `BLOCK_START`, `PLAN_BUILT` |
| `block` | Block-UUID | `BLOCK_*`, `CAPTURE` |
| `plan` | `nightPlanId` | `PLAN*`, `BLOCK_START` |
| `session` | `sessionId` | `SESSION`, `LEASE` |
| `reason` | Grund aus `blockSkipReasons`/`blockEndReasons`/`blockedReasons`/`planReasons` | `BLOCK_END`, `BLOCK_SKIPPED`, `BLOCKED`, `PLAN` |
| `state` | Zustandsname (`held`, `unreachable`, `lost`, `offline`, `running`, `paused`, `idle`, …) | `LEASE`, `HEARTBEAT` |
| `status` | HTTP-Status oder Sessionstatus | `API`, `SESSION` |
| `call` | aufgerufener Endpunkt der NINA-API (`bootstrap`, `targets`, `plan`, `sessions`, `captures`, `events`, `heartbeat`) | `API` |
| `result` | `saved` / `aborted` / `failed` | `CAPTURE` |
| `file` | Dateiname ohne Pfad (in `"…"`) | `CAPTURE`, `COPY` |
| `filter`, `short` | Filtername bzw. Kurzname | `FILTER_NOT_FOUND`, `CAPTURE` |
| `mode`, `name`, `index` | Auslesemodus: Aktion, Name, Index | `READOUT`, `READOUT_MODE_NOT_FOUND` |
| `type`, `box` | Triggertyp, Name der Anweisungsbox | `TRIGGER_SUPPRESSED` |
| `pierBefore`, `pierAfter`, `durationS` | Flip-Messwerte | `FLIP`, `FLIP_UNDETECTED` |
| `pending`, `dead` | Outbox-Zähler | `OUTBOX` |
| `combination`, `missing`, `mechDg` | Flat-Kombination (Schlüssel in Zehntelgrad; Werte und `status`/`reason` bei Flats: `execution.md` §7, Spec-Ergänzung AP-50) | `FLATS_*`, `DARKFLAT_GROUP` |
| `source` | `server` / `cache` (gespeicherter Server-Plan) | `PLAN` |
| `etag` | `targetsEtag` (in `"…"`) | `TARGETS` |
| `atUtc`, `untilUtc` | Zeitpunkte in `…Z` | beliebig |
| `code` | Unterfall aus `enums.json`/`errors.json`; bei `API status=0` (keine HTTP-Antwort) `network` oder `timeout` | `WARNING`, `ERROR`, `API` |
| `night` | Nacht-Schlüssel `JJJJ-MM-TT` | `PLAN` (P-29) |
| `checks` | Prüfcodes des `SequenceInspector`, durch Komma getrennt (AP-16h, `execution.md` §1) | `WARNING code=sequence_template_deviation` |

  Feste Schreibweisen: **`READOUT mode=set name="High Gain Mode" index=0`** (nicht `READOUT set …`) und **`CAPTURE id=… result=saved file="…"`** für die Zuordnung nach `ImageSaved` (es gibt kein Ereignis `ImageSaved` in der Grammatik).

Erlaubte Ereignisnamen: alle `sessionEventKinds` aus `../contracts/enums.json` in Großbuchstaben (`PLAN_BUILT`, `PLAN_REBUILT`, `BLOCK_START`, `BLOCK_END`, `BLOCK_SKIPPED`, `FLIP`, `TRANSIT_START`, `TRANSIT_END`, `TRIGGER_SUPPRESSED`, `FILTER_NOT_FOUND`, `READOUT_MODE_NOT_FOUND`, `LEASE_LOST`, `LEASE_REGAINED`, `OFFLINE_START`, `OFFLINE_END`, `ROTATION_MISMATCH`, `ROTATION_UNKNOWN`, `FLIP_UNDETECTED`, `SKIPPED_TIMEAWARE`, `FLATS_START`, `FLATS_END`, `WARNING`, `ERROR`, …) **plus** die Betriebszeilen `PLAN`, `API`, `LEASE`, `HEARTBEAT`, `OUTBOX`, `READOUT`, `CAPTURE`, `SESSION`, `TARGETS`, `BLOCKED`, `FLATS_RESUME`, `DARKFLAT_GROUP`, `COPY`, `TRIGGER`.

> **Spec-Ergänzung (AP-S2b, 28.09.2026):** Zwei Ergänzungen, mit dem Merge des AP-S2b-PR freigegeben.
> - **Betriebszeile `TRIGGER type=… atUtc=…`:** Ein Trigger wurde über den eigenen Trigger-Walk ausgeführt (`execution.md` §4.3). P-01 verlangt die Trigger-Ausführung zwischen den Belichtungen im Log, dafür gab es bisher kein Ereignis.
> - **Schlüssel `night`:** P-29 verwendet ihn schon (`PLAN … night=2026-09-17`), er fehlte nur in der Tabelle.

`pnpm test-run:check <ordner>` (Werkzeug `tools/test-run-check`, geliefert in **AP-S2b**) prüft `result.json` gegen das Schema und das Log gegen die je Protokoll erwarteten Ereignisse (Tabelle `expectations.json` im Werkzeug).

Claude Code wertet die Artefakte aus und entscheidet mit Sven Go/No-Go.

## Schema `result.json`
```json
{
  "protocol": "P-15",
  "date": "2026-10-02",
  "pluginVersion": "1.0.0-rc.3",
  "ninaVersion": "3.2.0.1001",
  "server": "nina_test_server",
  "scenario": "replan",
  "result": "go",
  "steps": [
    { "n": 1, "ok": true, "note": "" },
    { "n": 2, "ok": false, "note": "Slew trotz gleichem Panel" }
  ],
  "logCheck": { "status": "pass", "missing": [], "unexpected": [] },
  "deviations": ["…"],
  "artifacts": ["nina.log", "s61.png"]
}
```
- `protocol` ∈ `P-01 … P-37` (inkl. `P-15b`); `server` ∈ **`nina_test_server` | `prod`** (ein einzelner Wert, kein Alternativ-Text); `scenario` = Szenarioname oder `null`, wenn ohne Test-Server gefahren.
- `steps` = **je Protokoll die Schritte aus der Tabelle unten**, durchnummeriert ab 1 in derselben Reihenfolge; jeder Schritt mit `ok` (Pflicht) und `note` (Pflicht, darf leer sein). Fehlt ein Schritt oder ist die Anzahl falsch, schlägt `test-run:check` fehl.
- `logCheck` wird von `pnpm test-run:check <ordner>` **eingetragen** (nicht von Hand): `status` ∈ `pass | fail | not_run`, `missing[]` = erwartete, aber nicht gefundene Log-Ereignisse, `unexpected[]` = verbotene Ereignisse (z. B. `ERROR`), die vorkamen.
- `result` ∈ `go | no_go`. Ein Protokoll gilt als bestanden, wenn `result = go`, **alle** `steps[].ok = true` und `logCheck.status = pass`.

## Protokolle

| ID | Paket | Ziel | Schritte (Kurz) | Erwartung / Artefakt |
|---|---|---|---|---|
| P-01 | AP-S2b | Trigger-Walk nach Astro-PM-Muster | Probe-Plugin-Sequenz „Probe-Container“ starten; globale Trigger „Meridian Flip“ (Simulator-Meridian in 10 min), „Autofokus nach Zeit“, „AF nach Filterwechsel“ und „Center after Drift“ aktiv; Container führt 20 × 60-s-Belichtungen als interne Elemente aus und ruft die Trigger aller Vorfahren auf | Log zeigt Trigger-Ausführung **zwischen** Belichtungen; Flip nutzt Zielkoordinaten (kein „No target information available for flip“); AF-Zählung stimmt; Screenshot Sequenzansicht |
| P-02 | AP-S2b | Zuordnung bis `ImageSaved` | Probe-Plugin vergibt die Capture-ID vor der Belichtung und ordnet das `ImageSaved`-Ereignis über `MetaData.Image.Id` zu | Log **`CAPTURE id=… result=saved file="…"`** für jede Belichtung (Grammatik oben; es gibt keine Zeile `ImageSaved …`), keine Fehlzuordnung bei schnellen Folgen; FITS-Header-Screenshot (Zielname, PA) |
| P-03 | AP-S2b | Belichtung abbrechen | Während Belichtung Abbruch per Probe-Befehl | Belichtung endet < 5 s; Log `result=aborted`; nächste Belichtung startet |
| P-04 | AP-16a | Kopplung & Optionen | Server-URL `http://localhost:8787/api` und Token `npm_test` des **Test-Servers** eintragen; *Verbindung testen*; danach einmal mit falschem Token | Anzeige Mandant/Rig/Standort-Abgleich; falsches Token → „ungültig“ (`API status=401`); Screenshot Optionsseite. *(Gegen den Test-Mandanten in prod erst ab AP-16h, H-12b)* |
| P-05 | AP-16c | Eine Nacht (Simulator) | Beispielsequenz „Eine Nacht“; Szenario `one-night` im `nina-test-server`; 2 Projekte aktiv | Blöcke laut Plan; Aufnahmen im Test-Server-Protokoll (`GET /test/report`) bzw., wenn AP-15 abgenommen ist, im Web (S-61); Zähler korrekt; Outbox leer am Ende (`OUTBOX pending=0`) |
| P-06 | AP-16d | Neuplanung vor Block | Während Block 1 im Test-Server bzw. Web Projekt 2 pausieren (neues ETag); zusätzlich Lauf ohne Änderung | Block 2 nicht mehr Projekt 2; Ereignis `plan_rebuilt`; ohne Änderung **kein** neuer Plan (Hysterese) |
| P-07 | AP-16f | Flip mit Rotator (NT-E4, M2, M3) | Rig mit Rotator-Simulator, `RangeType` einmal `FULL`, einmal `HALF`; Meridian im Block; mechanischen Winkel vor und nach dem Flip notieren; dritter Lauf mit `RangeType = QUARTER` (nur Planaufbau und Heartbeat) | Flip-Trigger feuert beim Eintrag `meridian_flip`, nachdem das Plugin auf NINAs früheste Flipzeit gewartet hat (`TimeToMeridianFlip`, höchstens bis `limitEnd`; NT-21, M3); danach nur **Zentrieren**, **keine** Rotatorbewegung (mechanischer Winkel unverändert ±0,1°); gemessener PA nach dem Flip = Soll **modulo 180°** (±1°, typisch Soll + 180°); Ereignis `flip`, danach Zentrieren, kein `ROTATION_MISMATCH`; `QUARTER`: `WARNING code=rotator_range_quarter`, Alarm `nina_settings_mismatch` mit Code `rotator_range_quarter` im Test-Report („PA oder PA + 180°“ gilt nur für `FULL`/`HALF`) |
| P-08 | AP-16f | Ohne Rotator falscher Winkel | Rig ohne Rotator, Kamerawinkel absichtlich 30° daneben (kopflos: Szenario `flip` ohne verbundenen Rotator bzw. `flip-no-rotator` mit `skipOnRotationMismatch`) | Ereignis `rotation_mismatch`; bei `skipOnRotationMismatch` Block übersprungen |
| P-09 | AP-16g | Netzausfall & Outbox (NT-14) | Nach Block 1 `POST /test/actions {action: "drop_responses"}` (in prod: Netz trennen), 30 min laufen lassen, dann `restore_responses` | nach 3 Heartbeats ohne Antwort `LEASE state=unreachable` (**nicht** `lost`); laufender und folgende Blöcke laufen nach dem **gespeicherten** Plan weiter, **kein** neuer Plan während des Ausfalls; alle Aufnahmen tragen dessen `nightPlanId`; nach der Rückkehr `LEASE state=held` – der erste Heartbeat holt die serverseitig verfallene Lease zurück (`leaseLost: false`, weil `active_session_id` leer bzw. die eigene ist, M5) –, Outbox sendet die Meldungen in FIFO-Reihenfolge nach (kein `PATCH {offlinePlan}`); kein Lease-Fehlercode auf Pakete; keine Duplikate |
| P-10 | AP-16e | Lease-Konflikt | Szenario `lease`; während eines Blocks `POST /test/actions {action: "rig_busy"}`, dann NINA neu starten (der Neustart setzt die Session mit `PATCH running` fort, das mit `409 session.rig_busy` antwortet; ersatzweise eine zweite NINA-Instanz desselben Rigs starten) | `API status=409 code=session.rig_busy`, Warnung, zweite Instanz nur Simulation; die **laufende** Belichtung und der Block werden zuerst beendet (`BLOCK_END reason=lease_lost`), `BLOCKED reason=rig_busy`, und erst der nächste Aufruf ohne laufenden Block beendet die Nachtschleife (NIN5-2) |
| P-11 | AP-16h | Zielbrowser & Framing | Optionsseite → *An NINA ausgeliefert* → *Aktualisieren* → ein Einzelfeld- und ein Mosaik-Ziel (2×2) wählen → „In Framing-Assistent laden“ | NINA wechselt in den Framing-Assistenten; Zentrum (RA/Dec), Rotation = `center.rotationDeg`, Sensor/Pixel/Brennweite des Rigs, Raster 2×2 mit Überlappung des Projekts; Panel 1 oben links = Nordost bei Rotation 0 (NT-32), Panelreihenfolge wie die Panel-Labels der Web-App; Screenshot je Ziel |
| P-12 | AP-50 | Flats & Dark-Flats | Sequenz „mit Flats“; Nacht mit Filtern L/Ha, zwei Ziele mit Positionswinkel 0° und 45° (Rotator), eines davon mit Flip; Szenario `night-end` mit Flats; danach Flat-Schleife (Simulator-Flatpanel); Abbruch während der 2. Kombination, NINA neu starten | Reihenfolge Blöcke → Nachtende (`darknessEndUtc`) → Flats ab `flatsNotBeforeUtc` → `SESSION status=completed` → Ende-Bereich; Kombinationen = gespeicherte Light-Kombinationen (je Filter die **zwei** mechanischen Winkel der beiden Ziele; der Flip erzeugt **keine** weitere Kombination, NT-E4), Kombinationen laufen **seriell**; Dateien in jedem Zielordner; jede Flat-Meldung trägt denselben **eingefrorenen** `rotatorMechDeg` und `flatsPlanned`/`darkFlatsPlanned` (NIN5-8/9; Log `mechDg=…`); Dark-Flat-Gruppe nur **einmal** je Nacht (`DARKFLAT_GROUP status=done`, danach `darkFlatsPlanned=0`); S-61 Reiter *Flats* zeigt Soll/Ist; nach dem Neustart Fortsetzen nur mit fehlenden Aufnahmen (`FLATS_RESUME combination=… mechDg=… missing=…`) und **ohne** zweite Zeile in `flat_combination`. |
| P-13 | AP-S2b | Neue Stellen ohne Vorbild | Probe: (1) Autofokus-Trigger „AF nach Zeit“ (1 min) während einer Serie per Typfilter unterdrücken – die erlaubten Trigger werden **mit dem Plugin-Container als Kontext** aufgerufen (`ShouldTrigger(previous ?? this, item)`, `Execute(this, …)`, `execution.md` §5), und die Typnamen sind in diesem Spike gegen die installierte NINA-Version zu **bestätigen** (Ergebnis in `docs/adr/`); (2) laufende 120-s-Belichtung über eigenen Abbruch-Token beenden; (3) Auslesemodus per Name setzen; (4) Flip mit Simulator-Meridian in 5 min, Pier-Seite vor/nach Trigger loggen; zusätzlich ein Lauf mit Pier-Seite `null` | (1) `TRIGGER_SUPPRESSED type=AutofocusAfterTimeTrigger` und kein „No target information available for flip“ beim Flip-Trigger; (2) `CAPTURE result=aborted` < 5 s, nächste Belichtung startet; (3) `READOUT mode=set name="…" index=…` mit einem Modus, den die Kamera anbietet (z. B. `High Gain Mode`); (4) `FLIP pierBefore=west pierAfter=east durationS=…` (Zuordnung `pierWest → west`, `pierEast → east`, `execution.md` §4.3); bei Pier-Seite `null` ohne 180°-Plate-Solve-Sprung nur `FLIP_UNDETECTED` und **kein** `FLIP` (NIN5-1) |
| P-14 | AP-44 | Transit | Test-Server-Szenario `transit` (Fenster ab jetzt + 10 min, 20 min lang, AF-Trigger aktiv, eine lange Belichtung vor dem Fenster) | Belichtung, die in den Vorlauf reichen würde, wird nicht begonnen (eine laufende läuft immer zu Ende, Sven 04.10.2026); `TRANSIT_START`; Serie bis `untilUtc` unabhängig von der Anzahl; `TRIGGER_SUPPRESSED` für AF; alle Aufnahmen mit `transitObservationId`; `TRANSIT_END` + Neuplanung |
| P-15 | AP-16d | Neuplanung im Block (a/c) | Szenario `replan` (Blöcke à 30 min, damit die 15-min-Prüfung im Block greift): im laufenden Block (a) aktuelles Projekt pausieren, (c) anderes Projekt ändern; zusätzlich ein Lauf ohne Änderung | (a) Belichtung zu Ende, `BLOCK_END reason=target_removed`, neuer Plan ab jetzt; (c) Block läuft unverändert, neuer Plan ab nächstem Block, kein zusätzlicher Slew bei gleichem Panel; ohne Änderung **kein** neuer Plan (Hysterese) |
| P-15b | AP-44 | Neuplanung Fall (b) Transit-Unterbrechung | Szenario `replan-transit`: im laufenden Block einen Transit mit Fenster vor Blockende festlegen | laufende Belichtung läuft zu Ende (kein Abbruch, Sven 04.10.2026), danach `BLOCK_END reason=transit_interrupt`, `TRANSIT_START` am Fensterbeginn, danach `PLAN_REBUILT`; erst ab R4 prüfbar |
| P-16 | AP-16g | Offline-Modus und Neustart mit gespeichertem Plan | Offline-Modus einschalten, Netz trennen, NINA neu starten, 2 Blöcke laufen lassen, Netz verbinden, Offline-Modus aus | `HEARTBEAT state=offline` vor der Trennung; nach dem Neustart `PLAN source=cache` mit der `nightPlanId` des gespeicherten Server-Plans, Blockindex nach der Uhr; im Web keine `stale`-Markierung und kein Alarm; nach Rückkehr Outbox nachgesendet, keine Duplikate. Gegenprobe: Start ohne gespeicherten Plan der Nacht → `BLOCKED reason=plan_failed`, keine Blöcke |
| P-17 | AP-16e | Lease verloren / Übernahme | Szenario `lease`; während eines Blocks `POST /test/actions {action: "lease_release"}` (in prod: S-42 „Session übernehmen“); danach Aktion `clear` und Plugin neu starten | nächster Heartbeat `leaseLost=true` → laufende Belichtung zu Ende, `LEASE state=lost`, `BLOCKED reason=lease_lost`, 60-s-Wartetakt, keine neuen Blöcke; nach `clear` erster erfolgreicher Heartbeat → `LEASE state=held`, `LEASE_REGAINED`, Blockliste neu aus dem Plan; nach Neustart derselben Instanz ohne fremde Session: `LEASE state=held` (eigene Session fortgesetzt) |
| P-18 | AP-16g | Token widerrufen | Während einer **laufenden Belichtung** `POST /test/actions {action: "revoke_token"}` (in prod: Token in S-42 widerrufen) | `API status=401` → die laufende Belichtung läuft zu Ende, `BLOCK_END reason=error`, `BLOCKED reason=token_invalid`; keine neuen Blöcke, Cache nicht verwendet, Outbox pausiert (kein Dead-Letter), klare Meldung in der Optionsseite; die Nachtschleife wird **erst im nächsten Aufruf ohne laufenden Block** falsch (NIN5-2) |
| P-19 | AP-16d | Filter/Auslesemodus nicht gefunden (NT-E1, NT-37) | Szenario `filters-readout` (kopflos) oder: Zeile mit `ninaFilterName = "OIII"`, der im NINA-Filterrad fehlt; Zeile mit `ninaFilterName = "Ha"` bei Profilname `Ha 3nm`; zweite Kamera-Zeile mit unbekanntem Auslesemodus; Gegenprobe mit einer Kamera, die genau einen Modus meldet | `FILTER_NOT_FOUND short=OIII` bzw. `short=Ha`, Zeilen übersprungen, **kein** Präfix-Treffer, nie mit anderem Filter belichtet; `READOUT_MODE_NOT_FOUND` → Belichtung übersprungen (kein Rückfall auf `readoutModeIndex`); hat ein Block keine belichtbare Zeile, `BLOCK_SKIPPED reason=filter_not_found` bzw. `readout_mode_not_found` vor dem Slew; bei genau einem Modus wird belichtet; Hinweis höchstens einmal |
| P-20 | AP-16g | Neustart im Block | NINA mitten in Block 2 beenden und neu starten, Sequenz erneut starten | `PLAN reason=resume`; gleiche `sessionId` aus `ninapm.db`, **neue** `nightPlanId` (Aufnahmen danach tragen sie, NT-18); `SESSION status=running` mit `resumedAtUtc`; Blockindex aus dem **neuen** Plan (erster Block mit `endUtc > now`); `POST /sessions` idempotent (200); keine doppelten Aufnahmen |
| P-21 | AP-16f | Zeitgeführtes Playback nach Verzögerung | Szenario `delay`: Block 1 begann vor 6 min, Zentrieren um 6 min verzögern; zweiter Lauf mit Flip im Block | **Spec-Ergänzung (AP-16f, 03.10.2026, zur Bestätigung):** Startverzug und Zentrieren gehen in den Verzug ein (§4.2, NT-21) – die Planuhr rutscht nach hinten, es entstehen **keine** `SKIPPED_TIMEAWARE`, die Belichtungen laufen in Planreihenfolge, kein Filter-Block wird ausgelassen (Brief: Filterverhältnisse bleiben erhalten; vorher stand hier „übersprungene Belichtungen als `SKIPPED_TIMEAWARE`“); nur das harte Blockende schneidet ab; nach Flip Planzeit um (tatsächlich − geplant) verschoben |
| P-22 | AP-16e | Nachtende und verwaiste Session (R1, ohne Flats) | Szenario `night-end`: `darknessEndUtc` in 15 min, `sessionEndUtc` 30 min später, Flats **aus** (Flats prüft P-12, R5); einmal normal beenden (mit gefüllter Outbox: kurz vor dem Ende `drop_responses`), einmal NINA vor dem Ende hart beenden | normal (NT-11): letzte Belichtung endet ≤ `darknessEndUtc` (Kulanz nur mit `lastOfNight`, NT-13) → `SESSION status=completed pending=n` (auch mit `n > 0`, NIN5-7) → Nachtschleife endet im nächsten Aufruf, Ende-Bereich (*Park Scope*) **vor** `sessionEndUtc`; kein `PATCH status=running` danach; nach dem Nachsenden `SESSION status=completed pending=0`, danach startet der Server Nachtbericht/Abschluss; hart: nach 10 min ohne Heartbeat markiert der Server die Session als *verwaist* (Alarm; im Test-Server `GET /test/report`, in prod S-60 ab AP-15), späte Meldungen nach Neustart werden übernommen |
| P-23 | AP-52 | Tagesschleife über zwei Nächte | Szenario `multi-night` (zwei aufeinanderfolgende Nächte, Tageswechsel-Zeit 12:00 Standortzeit); Sequenz „Mehrere Nächte“ | nach `SESSION status=completed` wartet die Tagesschleife, startet in der zweiten Nacht eine **neue** Session mit neuem Nacht-Schlüssel; Höchstzahl Nächte beendet die Schleife |
| P-24 | AP-52 | Trigger-Sets und *Warten auf Zeit* (die Anweisung *Warten auf Zeit* ist R5, FA-NIN-26) | Trigger-Set *vor jeder Belichtung* mit einer Log-Anweisung; Anweisung *Warten auf Zeit* (Dämmerung + 15 min) | Log zeigt die Box vor **jeder** Belichtung; Wartezeit endet zur erwarteten Zeit (±30 s) |
| P-25 | AP-16c | Safety-Unterbrechung und Wiederaufnahme (NT-16, H2) | Szenario `safety`; Sequenz nach `execution.md` §1 (*Loop While Safe* an „Ziel“ mit Wiederherstellung am Anfang und Container „Blöcke“, Sicherungscontainer mit *Loop While Unsafe* + *NINA-PM Nachtschleife* und *NINA-PM Warten bis sicher oder Nachtende* als letzter Anweisung; Park- oder Home-Variante); ASCOM-Safety-Monitor-Simulator während einer laufenden Belichtung auf unsicher, nach 5 min wieder auf sicher; zusätzlich ein Lauf mit Benutzer-Stopp, ein Lauf „unsicher bis Nachtende“ (`darknessEndUtc` in 15 min, Monitor bleibt unsicher) und ein Lauf mit getrenntem Safety-Monitor | unsicher: `CAPTURE result=aborted`, `BLOCK_END reason=interrupted`, `SAFETY_PAUSE`, `HEARTBEAT state=paused`, NINA sichert die Montierung im Sicherungscontainer (Park bzw. Home + Nachführung aus), kein `SESSION status=aborted`; sicher: `SAFETY_RESUME`, `PLAN reason=resume` mit neuer `plan=…`, Wiederherstellung am Anfang von „Ziel“ (Unpark bzw. Nachführung an), erneuter Slew mit Zentrieren (kein Slew-Verzicht nach Park/Home); Benutzer-Stopp: `SESSION status=aborted`, danach `HEARTBEAT state=idle` ohne `session`, 5-min-Sperre aufgehoben; Neustart legt eine **neue** Session an; unsicher bis Nachtende: bei `darknessEndUtc` (± 1 min) `SESSION status=completed` **ohne** `SAFETY_RESUME`, Zielcontainer läuft nicht wieder an, danach Ende-Bereich (*Warm Camera*); getrennter Monitor: `WARNING code=safety_monitor_not_connected` (einmal je Wartephase), Montierung bleibt geparkt – **kein** Park/Unpark im Takt; nach Wiederverbinden und sicher Wiederaufnahme, sonst Abschluss am Nachtende |
| P-26 | AP-16f | Mosaik-Panelwechsel am Meridian (NT-27) | Szenario `mosaic-flip`: 2×1-Mosaik, `tM` von Panel 1 im ersten Block, Panel 2 folgt direkt; Rotator-Simulator | Flip im Block von Panel 1 (`FLIP pierBefore=west pierAfter=east`); beim Wechsel auf Panel 2 kein zweiter Flip, wenn dessen `tM` schon überschritten ist, sonst Flip-Dauer im Plan des Folgeblocks eingerechnet; kein Nachrotieren (mechanischer Winkel bleibt), Panel-PA modulo 180° in Toleranz |
| P-27 | AP-44 | Flip im Transitfenster mit AF/Recenter (NT-25) | Szenario `transit-flip`: `tM + afterMin` im Fenster; NINA-Profil `AutoFocusAfterFlip = true`, einmal `Recenter = true`, einmal `false` | Plan ohne Flip-Eintrag, Diagnose `flip_in_transit` mit Zusatz „AF nach Flip aktiv“ und ausgewiesener Lücke; NINA flippt während der Serie (`FLIP`), AF nach dem Flip läuft (NINA-intern); Serie danach bis `untilUtc` fortgesetzt, alle Aufnahmen mit `transitObservationId`; bei `Recenter = true` Heartbeat-Alarmcode im Test-Report (`nina_settings_mismatch`) |
| P-28 | AP-16d | Globaler Dither-Trigger (NT-23) | globalen Trigger *Dither after Exposures* (jede Belichtung) aktivieren; Szenario `one-night` mit Plan-Dither alle 3 Belichtungen; zweiter Lauf im Szenario `transit` | beim Planaufbau `WARNING code=nina_dither_trigger_present`; `TRIGGER_SUPPRESSED type=DitherAfterExposures` je Block; gedithert wird nur laut Plan (Guider-Log: Dither nur nach jeder 3. Belichtung); im Transit kein Dither |
| P-29 | AP-16b | Start zu beliebiger Tageszeit / aktuelle Nacht (NT-01) | Szenario `current-night` (Starfront, `America/Chicago`), Windows-Uhr des Test-PCs (der Test-Server läuft auf demselben Rechner, daher kein `clock_skew`) auf 18.09.2026 **02:00 CDT** (09:00 MESZ), dann **09:00 CDT** (16:00 MESZ, vor lokalem Mittag), dann **13:00 CDT** (20:00 MESZ, nach lokalem Mittag); Sequenz jeweils starten | 02:00 CDT: `PLAN … night=2026-09-17`; 09:00 CDT: `night=2026-09-18`, Plugin wartet auf den ersten Block (`HEARTBEAT state=idle`); 13:00 CDT: `night=2026-09-18`; nie `422 nina.night_invalid` |
| P-30 | AP-16g | Online → Offline-Modus mitten in der Nacht (NT-14, NIN-9) | Offline-Modus während eines laufenden Blocks einschalten, 2 Blöcke offline laufen lassen, Offline-Modus aus | `HEARTBEAT state=offline`; laufender Block läuft **weiter** (kein `BLOCK_END reason=replanned`, kein neuer `PLAN`); jede Offline-Aufnahme trägt die `nightPlanId` des gespeicherten Server-Plans; nach der Rückkehr Outbox nachgesendet (kein `PATCH {offlinePlan}`), keine Duplikate |
| P-31 | AP-16c | Nachtende ohne Flats (NT-11, NT-13) | Szenario `night-end` mit Flats aus, `darknessEndUtc` in 20 min, Belichtungen 300 s; zweiter Lauf mit leerem Plan (alle Projekte pausiert) ab 10 min vor `darknessEndUtc` | letzte Belichtung beginnt nur, wenn sie bis `darknessEndUtc` endet, sonst `BLOCK_END reason=night_end`; Ende-Bereich startet sofort: *Park Scope* spätestens `darknessEndUtc` + 3 min (Log-Zeitstempel); zweiter Lauf: bis `darknessEndUtc` `HEARTBEAT state=idle` und Neuplanung alle 5 min, danach **kein** `BLOCKED reason=plan_failed`, sondern `SESSION status=completed` und Ende |
| P-32 | AP-16d | Filterrad umgesteckt (NT-E1) | im NINA-Profil zwei Filternamen tauschen bzw. einen umbenennen (oder Test-Server-Aktion `filter_wheel_changed`) | Heartbeat `filterWheel` zeigt die neuen Namen; im Test-Report Alarmcode `filter_wheel_changed`; `WARNING code=filter_wheel_changed` beim Planaufbau; betroffene Zeilen `FILTER_NOT_FOUND`, nie mit dem Filter am alten Platz belichtet |
| P-33 | AP-50 | Trained-Flat-Position geändert (NT-39) | Flat-Lauf mit *Trained Flat Exposure* (`KeepPanelClosed = true`); danach im NINA-Profil die Position eines Filters ändern, nächste Nacht mit Flats; einmal eine trainierte Belichtung absichtlich 5× zu lang | geänderte Position: Kombination `skipped`, `WARNING code=trained_flat_position_changed`; zu lange Belichtung: `WARNING code=flat_exposure_off` nach der ersten Flat-Aufnahme (`meanAdu` > 80 %), Kombination läuft weiter; Flatpanel öffnet sich nicht |
| P-34 | AP-16e | Temperaturabweichung (NT-E2) | Kamera-Simulator mit Sollwert −10 °C, Rig `camera.setpointC = −10`, `toleranceC = 1`; während eines Blocks Sollwert der Kamera auf 0 °C stellen | weiter belichtet; genau **ein** `WARNING code=camera_temperature` je Block; betroffene Aufnahmen mit `temperatureDeviation: true`, `metrics.sensorTempC`/`setPointC` gesetzt; Heartbeat `camera {temperatureC, setPointC, coolerOn, coolerPowerPct}` |
| P-35 | AP-50 | Gemischtes Binning bei Flats (NT-38) | Lights einer Nacht mit Filter L in Bin 1 und Bin 2, eine Zeile mit Gain/Offset `null` | zwei getrennte Kombinationen (Bin 1, Bin 2), jede mit eigenem Flat- und Dark-Flat-Satz in passendem Binning; Kombination mit `null`-Gain/Offset im Schlüssel mit `-1`; Meldungen tragen das Binning der Kombination |
| P-36 | AP-16f | Windows-Zone ≠ Standortzone (NT-06) | Windows-Zeitzone des Test-PCs auf Mitteleuropa, Standort Starfront (`America/Chicago`); *NINA-PM Warten auf Zeit* (R5) auf 21:00 Standortzeit | SiteCheck `WARNING code=pc_timezone_differs`, die Meldung nennt die Folge für `$$DATEMINUS12$$`/Datumsordner und empfiehlt PC-Zone = Standortzone (L3); Nacht-Schlüssel, Blockzeiten und Warten auf Zeit richten sich nach Standortzeit (Wartezeit endet 21:00 CDT ± 30 s), nicht nach der PC-Zone |
| P-37 | AP-16g | Uhrabweichung > 60 s (NT-05) | Test-Server-Aktion `clock_skew` mit `seconds=90`; danach `clear` | `ERROR code=clock_skew`, `BLOCKED reason=clock_skew`, keine neuen Blöcke, 60-s-Wartetakt; nach `clear` Abweichung ≤ 5 s → Zustand gelöscht, Blöcke laufen; im Offline-Modus keine Prüfung (Hinweis „Uhrzeit ungeprüft“) |
