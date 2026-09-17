# Plugin-Testprotokolle (Mensch in der Schleife)

Durchführung durch Sven auf dem Windows-Rechner (H-14) mit NINA-Simulatorgeräten. Claude Code liefert zu jedem Protokoll das Build-Artefakt, ggf. ein Probe-Plugin und das Szenario für `tools/nina-test-server`. Ergebnisse unter `docs/test-runs/<JJJJ-MM-TT>/<P-xx>/` ablegen:
- `result.json` (Schema unten), `nina.log` (nur Zeilen mit Präfix `NINA-PM |`), Screenshots `*.png`.

Claude Code wertet `result.json` und das Log maschinell aus (`pnpm test-run:check <ordner>` prüft die erwarteten Log-Ereignisse je Protokoll) und entscheidet mit Sven Go/No-Go.

## Testbetrieb tagsüber: `tools/nina-test-server`
NINA-Simulatoren haben keine Simulatoruhr. Deshalb läuft das Plugin gegen einen lokalen Test-Server statt gegen prod:
1. `pnpm nina-test-server --scenario <name>` auf dem Windows-Rechner starten (Port 8787); Szenarien liegen unter `tools/nina-test-server/scenarios/` (`one-night`, `replan`, `replan-transit`, `transit`, `flip`, `delay`, `night-end`, `flats`, `multi-night`, `lease`).
2. Im Plugin Server-URL `http://localhost:8787/api` und Token `npm_test` eintragen.
3. Der Server erzeugt Blöcke ab `jetzt + 2 min`, für Flip-Tests ein Ziel mit RA = lokale Sternzeit + n min, Transitfenster ab `jetzt + 10 min`. Änderungen zur Laufzeit über `POST /test/actions {action}` (oder die Szenario-Zeitleiste):

| `action` | Wirkung im Test-Server | gebraucht von |
|---|---|---|
| `targets_change` | neues `targetsEtag`, geänderte Zielliste | P-06, P-15 |
| `pause_project` | Projekt auf `on_hold`, neues ETag | P-06, P-15 |
| `lock_transit` | Transit `locked` mit Fenster vor Blockende | P-15b |
| `skip_block` | markiert den laufenden Block als übersprungen | P-05 |
| `lease_release` | nächste Heartbeat-Antwort trägt `lease.leaseLost = true` | P-17 |
| `rig_busy` | `POST /sessions` und `PATCH … {status: running}` antworten `409 session.rig_busy` | P-10 |
| `revoke_token` | alle weiteren Aufrufe antworten `401 nina.token_invalid` | P-18 |
| `clear` | setzt alle Aktionen zurück | alle |

  Das Szenario `lease` startet mit zwei registrierten Instanzen desselben Rigs, damit P-10 und P-17 ohne echten zweiten Rechner laufen (NIN5-16).
4. Sicherheitsprüfungen (Dunkelheit, Höhe) überspringt das Plugin nur, wenn der Server `X-NPM-Test: 1` sendet; prod sendet den Header nie.

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
| `state` | Zustandsname (`held`, `lost`, `offline`, `running`, …) | `LEASE`, `HEARTBEAT` |
| `status` | HTTP-Status oder Sessionstatus | `API`, `SESSION` |
| `result` | `saved` / `aborted` / `failed` | `CAPTURE` |
| `file` | Dateiname ohne Pfad (in `"…"`) | `CAPTURE`, `COPY` |
| `filter`, `short` | Filtername bzw. Kurzname | `FILTER_NOT_FOUND`, `CAPTURE` |
| `mode`, `name`, `index` | Auslesemodus: Aktion, Name, Index | `READOUT`, `READOUT_MODE_NOT_FOUND` |
| `type`, `box` | Triggertyp, Name der Anweisungsbox | `TRIGGER_SUPPRESSED` |
| `pierBefore`, `pierAfter`, `durationS` | Flip-Messwerte | `FLIP`, `FLIP_UNDETECTED` |
| `pending`, `dead` | Outbox-Zähler | `OUTBOX` |
| `combination`, `missing`, `mechDg` | Flat-Kombination (Schlüssel in Zehntelgrad) | `FLATS_*`, `DARKFLAT_GROUP` |
| `source` | `server` / `offline` | `PLAN` |
| `etag` | `targetsEtag` (in `"…"`) | `TARGETS` |
| `atUtc`, `untilUtc` | Zeitpunkte in `…Z` | beliebig |
| `code` | Unterfall aus `enums.json`/`errors.json` | `WARNING`, `ERROR`, `API` |

  Feste Schreibweisen: **`READOUT mode=set name="High Gain Mode" index=0`** (nicht `READOUT set …`) und **`CAPTURE id=… result=saved file="…"`** für die Zuordnung nach `ImageSaved` (es gibt kein Ereignis `ImageSaved` in der Grammatik).

Erlaubte Ereignisnamen: alle `sessionEventKinds` aus `../contracts/enums.json` in Großbuchstaben (`PLAN_BUILT`, `PLAN_REBUILT`, `BLOCK_START`, `BLOCK_END`, `BLOCK_SKIPPED`, `FLIP`, `TRANSIT_START`, `TRANSIT_END`, `TRIGGER_SUPPRESSED`, `FILTER_NOT_FOUND`, `READOUT_MODE_NOT_FOUND`, `LEASE_LOST`, `LEASE_REGAINED`, `OFFLINE_START`, `OFFLINE_END`, `ROTATION_MISMATCH`, `ROTATION_UNKNOWN`, `FLIP_UNDETECTED`, `SKIPPED_TIMEAWARE`, `FLATS_START`, `FLATS_END`, `WARNING`, `ERROR`, …) **plus** die Betriebszeilen `PLAN`, `API`, `LEASE`, `HEARTBEAT`, `OUTBOX`, `READOUT`, `CAPTURE`, `SESSION`, `TARGETS`, `BLOCKED`, `FLATS_RESUME`, `DARKFLAT_GROUP`, `COPY`.

`pnpm test-run:check <ordner>` (Werkzeug `tools/test-run-check`, geliefert in AP-16a) prüft `result.json` gegen das Schema und das Log gegen die je Protokoll erwarteten Ereignisse (Tabelle `expectations.json` im Werkzeug).

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
- `protocol` ∈ `P-01 … P-24` (inkl. `P-15b`); `server` ∈ **`nina_test_server` | `prod`** (ein einzelner Wert, kein Alternativ-Text); `scenario` = Szenarioname oder `null`, wenn ohne Test-Server gefahren.
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
| P-07 | AP-16f | Flip mit Rotator | Rig mit Rotator-Simulator; Meridian im Block | Flip-Trigger feuert; danach `slew_center_rotate`; Positionswinkel ±1°; Ereignis `flip` |
| P-08 | AP-16f | Ohne Rotator falscher Winkel | Rig ohne Rotator, Kamerawinkel absichtlich 30° daneben | Ereignis `rotation_mismatch`; bei `skipOnRotationMismatch` Block übersprungen |
| P-09 | AP-16g | Offline & Outbox | Netzwerk nach Block 1 trennen, 30 min laufen lassen, verbinden | Offline-Plan (Jint) aktiv; Outbox sendet FIFO nach; keine Duplikate im Web |
| P-10 | AP-16e | Lease-Konflikt | Szenario `lease`; während eines Blocks `POST /test/actions {action: "rig_busy"}` (ersatzweise eine zweite NINA-Instanz desselben Rigs starten) | `API status=409 code=session.rig_busy`, Warnung, zweite Instanz nur Simulation; die **laufende** Belichtung und der Block werden zuerst beendet (`BLOCK_END reason=lease_lost`), `BLOCKED reason=rig_busy`, und erst der nächste Aufruf ohne laufenden Block beendet die Nachtschleife (NIN5-2) |
| P-11 | AP-16h | Zielbrowser & Framing | Optionsseite → Ziel wählen → „In Framing-Assistent laden“ | Framing-Assistent mit Koordinaten/Rotation; Screenshot |
| P-12 | AP-50 | Flats & Dark-Flats | Sequenz „mit Flats“; Nacht mit Filtern L/Ha, Flip mit Rotator; danach Flat-Schleife (Simulator-Flatpanel); Abbruch während der 2. Kombination, NINA neu starten | Kombinationen = gespeicherte Light-Kombinationen (inkl. 2. Rotatorwinkel), Kombinationen laufen **seriell**; Dateien in jedem Zielordner; jede Flat-Meldung trägt denselben **eingefrorenen** `rotatorMechDeg` und `flatsPlanned`/`darkFlatsPlanned` (NIN5-8/9; Log `mechDg=…`); Dark-Flat-Gruppe nur **einmal** je Nacht (`DARKFLAT_GROUP status=done`, danach `darkFlatsPlanned=0`); S-61 Reiter *Flats* zeigt Soll/Ist; nach dem Neustart Fortsetzen nur mit fehlenden Aufnahmen (`FLATS_RESUME combination=… mechDg=… missing=…`) und **ohne** zweite Zeile in `flat_combination`. |
| P-13 | AP-S2b | Neue Stellen ohne Vorbild | Probe: (1) Autofokus-Trigger „AF nach Zeit“ (1 min) während einer Serie per Typfilter unterdrücken – die erlaubten Trigger werden **mit dem Plugin-Container als Kontext** aufgerufen (`ShouldTrigger(previous ?? this, item)`, `Execute(this, …)`, `execution.md` §5), und die Typnamen sind in diesem Spike gegen die installierte NINA-Version zu **bestätigen** (Ergebnis in `docs/adr/`); (2) laufende 120-s-Belichtung über eigenen Abbruch-Token beenden; (3) Auslesemodus per Name setzen; (4) Flip mit Simulator-Meridian in 5 min, Pier-Seite vor/nach Trigger loggen; zusätzlich ein Lauf mit Pier-Seite `null` | (1) `TRIGGER_SUPPRESSED type=AutofocusAfterTimeTrigger` und kein „No target information available for flip“ beim Flip-Trigger; (2) `CAPTURE result=aborted` < 5 s, nächste Belichtung startet; (3) `READOUT mode=set name="High Gain Mode" index=0`; (4) `FLIP pierBefore=east pierAfter=west durationS=…`; bei Pier-Seite `null` ohne 180°-Plate-Solve-Sprung nur `FLIP_UNDETECTED` und **kein** `FLIP` (NIN5-1) |
| P-14 | AP-44 | Transit | Test-Server-Szenario `transit` (Fenster ab jetzt + 10 min, 20 min lang, AF-Trigger aktiv, eine lange Belichtung vor dem Fenster) | Vorlauf-Belichtung wird abgebrochen oder gar nicht begonnen; `TRANSIT_START`; Serie bis `untilUtc` unabhängig von der Anzahl; `TRIGGER_SUPPRESSED` für AF; alle Aufnahmen mit `transitObservationId`; `TRANSIT_END` + Neuplanung |
| P-15 | AP-16d | Neuplanung im Block (a/c) | Szenario `replan`: im laufenden Block (a) aktuelles Projekt pausieren, (c) anderes Projekt ändern; zusätzlich ein Lauf ohne Änderung | (a) Belichtung zu Ende, `BLOCK_END reason=target_removed`, neuer Plan ab jetzt; (c) Block läuft unverändert, neuer Plan ab nächstem Block, kein zusätzlicher Slew bei gleichem Panel; ohne Änderung **kein** neuer Plan (Hysterese) |
| P-15b | AP-44 | Neuplanung Fall (b) Transit-Unterbrechung | Szenario `replan-transit`: im laufenden Block einen Transit mit Fenster vor Blockende festlegen | laufende Belichtung endet oder wird abgebrochen, `TRANSIT_START` vor Fensterbeginn, danach `PLAN_REBUILT`; erst ab R4 prüfbar |
| P-16 | AP-16g | Offline-Modus und Jint-Plan | Offline-Modus einschalten, Netz trennen, Plugin neu starten, 2 Blöcke laufen lassen, Netz verbinden, Offline-Modus aus | `HEARTBEAT state=offline` vor der Trennung; Plan per Jint (`PLAN source=offline`); im Web keine `stale`-Markierung und kein Alarm; nach Rückkehr Outbox nachgesendet, Session `offline: true` angenommen, keine Duplikate |
| P-17 | AP-16e | Lease verloren / Übernahme | Szenario `lease`; während eines Blocks `POST /test/actions {action: "lease_release"}` (in prod: S-42 „Session übernehmen“); danach Aktion `clear` und Plugin neu starten | nächster Heartbeat `leaseLost=true` → laufende Belichtung zu Ende, `LEASE state=lost`, `BLOCKED reason=lease_lost`, 60-s-Wartetakt, keine neuen Blöcke; nach `clear` erster erfolgreicher Heartbeat → `LEASE state=held`, `LEASE_REGAINED`, Blockliste neu aus dem Plan; nach Neustart derselben Instanz ohne fremde Session: `LEASE state=held` (eigene Session fortgesetzt) |
| P-18 | AP-16g | Token widerrufen | Während einer **laufenden Belichtung** `POST /test/actions {action: "revoke_token"}` (in prod: Token in S-42 widerrufen) | `API status=401` → die laufende Belichtung läuft zu Ende, `BLOCK_END reason=error`, `BLOCKED reason=token_invalid`; keine neuen Blöcke, Cache nicht verwendet, Outbox pausiert (kein Dead-Letter), klare Meldung in der Optionsseite; die Nachtschleife wird **erst im nächsten Aufruf ohne laufenden Block** falsch (NIN5-2) |
| P-19 | AP-16d | Filter/Auslesemodus nicht gefunden | Rig-Zeile mit Filter `OIII`, der im Filterrad fehlt; zweite Zeile mit unbekanntem Auslesemodus | `FILTER_NOT_FOUND short=OIII`, Zeile übersprungen, nie mit anderem Filter belichtet; `READOUT_MODE_NOT_FOUND` → Belichtung übersprungen; Hinweis höchstens einmal |
| P-20 | AP-16g | Neustart im Block | NINA mitten in Block 2 beenden und neu starten, Sequenz erneut starten | `PLAN reason=resume`; gleiche `sessionId` und `nightPlanId` aus `ninapm.db`; Blockindex aus dem **neuen** Plan (erster Block mit `endUtc > now`); `POST /sessions` idempotent (200); keine doppelten Aufnahmen |
| P-21 | AP-16f | Zeitgeführtes Playback nach Verzögerung | Szenario `delay`: Zentrieren im Test-Server um 6 min verzögern; zweiter Lauf mit Flip im Block | übersprungene Belichtungen als `SKIPPED_TIMEAWARE`, danach laut Uhr weiter; nach Flip Planzeit um (tatsächlich − geplant) verschoben, kein Filter-Block ausgelassen |
| P-22 | AP-16e | Nachtende und verwaiste Session | Szenario `night-end`: `sessionEndUtc` in 15 min, `flatsNotBeforeUtc` 5 min davor; einmal normal beenden (mit gefüllter Outbox: Netz kurz vor dem Ende trennen), einmal NINA vor dem Ende hart beenden | normal: **Reihenfolge** Blöcke → Flats ab `flatsNotBeforeUtc` → `SESSION status=completed pending=n` (sofort, auch mit `n > 0`, NIN5-7) → Nachtschleife endet **erst im nächsten Aufruf** und nicht vor `sessionEndUtc` (NIN5-12); nach dem Nachsenden `SESSION status=completed pending=0`, danach startet der Server Nachtbericht/Abschluss; hart: nach 10 min ohne Heartbeat markiert der Server die Session als *verwaist* (Alarm; im Test-Server `GET /test/report`, in prod S-60 ab AP-15), späte Meldungen nach Neustart werden übernommen |
| P-23 | AP-52 | Tagesschleife über zwei Nächte | Szenario `multi-night` (zwei aufeinanderfolgende Nächte, Tageswechsel-Zeit 12:00 Standortzeit); Sequenz „Mehrere Nächte“ | nach `SESSION status=completed` wartet die Tagesschleife, startet in der zweiten Nacht eine **neue** Session mit neuem Nacht-Schlüssel; Höchstzahl Nächte beendet die Schleife |
| P-24 | AP-16h | Trigger-Sets und *Warten auf Zeit* | Trigger-Set *vor jeder Belichtung* mit einer Log-Anweisung; Anweisung *Warten auf Zeit* (Dämmerung + 15 min) | Log zeigt die Box vor **jeder** Belichtung; Wartezeit endet zur erwarteten Zeit (±30 s) |
