# NINA-PM Probe – Anleitung für die Protokolle P-01, P-02, P-03 und P-13 (AP-S2b)

Das Probe-Plugin prüft die Stellen ohne Vorbild im Astro-PM-Plugin gegen die installierte NINA-Version. Es ist **kein** Produktiv-Plugin und braucht keinen Server: Du fährst die Protokolle in der Windows-VM (H-14, `docs/ops/windows-vm.md`) mit den Simulatoren, Claude Code wertet die Logs mit `pnpm test-run:check` aus und schreibt daraus `docs/adr/ADR-S2b-nina.md`.

Was geprüft wird (execution.md §2, §4.3, §4.5, §4.6, §5):
- **Trigger-Walk:** Der Container ruft zwischen den Belichtungen die Trigger aller übergeordneten Container selbst auf, mit sich selbst als Kontext. Dither-Trigger sind immer unterdrückt, Autofokus-Trigger wahlweise.
- **Zuordnung:** Die Aufnahme-ID (UUID v7) entsteht vor der Belichtung, `Image.Id → Aufnahme-ID` wird vor dem Einreihen registriert, und `ImageSaved` löst sie auf. Bleibt `ImageSaved` 120 s aus, gilt die Aufnahme als `failed`.
- **Belichtung abbrechen:** über einen eigenen Abbruch-Token. `AbortExposure` der Kamera kommt nur als Rückfall nach 5 s.
- **Auslesemodus per Name:** Der Name wird in einen Index übersetzt, mit `SetReadoutModeForNormalImages` gesetzt.
- **Flip-Erkennung:** Die Pier-Seite wird vor und nach jedem Trigger-Aufruf gelesen. Ist die Pier-Seite unbekannt, erscheint nur `FLIP_UNDETECTED`.
- **Unterbrechung oder Benutzerabbruch** (§4.6): per *Loop While Safe* bzw. per Stopp.

## 1. Installieren

1. Plugin besorgen, eine der beiden Möglichkeiten:
   - **Aus dem CI:** Im PR unter *Checks → plugin → build → Artifacts* die Datei `nina-pm-probe` laden und entpacken.
   - **In der VM bauen:** `git pull` im geklonten Repository, dann `dotnet build -c Debug spikes\nina-probe`. Die Debug-Ausgabe landet direkt im Plugin-Ordner.
2. `NinaPm.Probe.dll` nach `%LOCALAPPDATA%\NINA\Plugins\3.0.0\NINA-PM Probe\` kopieren (Ordner anlegen), NINA neu starten.
3. NINA **ganz** beenden (`Get-Process NINA` darf nichts mehr liefern) und neu starten: Plugins lädt NINA nur beim Start.
4. Unter *Plugins → Installiert* muss **NINA-PM Probe 0.1.0** stehen. Fehlt es, steht der Grund nur auf Log-Stufe *Trace* im NINA-Log (`Select-String -Pattern "Probe"`).

**Vor jedem Protokoll** die Begleitdatei `%LOCALAPPDATA%\NINA\NinaPmProbe\nina-pm.log` löschen oder umbenennen. Das Plugin schreibt jede `NINA-PM |`-Zeile zusätzlich dorthin; die Datei ist später dein `nina.log`.

## 2. Sequenz aufbauen

Im *Erweiterten Sequenzer*:
1. Unter *Zielbereich* aus der Kategorie **NINA-PM Probe** den Container **NINA-PM Probe** einfügen.
2. Die Parameter im Container je Protokoll setzen (Tabelle unten).
3. Die **globalen Trigger** je Protokoll setzen (*Global Triggers* oben im Sequenzer).

Vor dem Start: Kamera, Montierung, Filterrad und Safety-Monitor der Simulatoren verbunden, Montierung entparkt und nachführend. Die Montierung schwenkt zu Beginn auf das Probe-Ziel mit Meridian in *n* Minuten, wenn *Zum Ziel schwenken* an ist.

Meridian-Flip in NINA 3: Einen globalen Schalter gibt es nicht. Aktiv ist der Flip, sobald der Trigger **Meridian Flip** in *Globale Trigger* steckt. Die Zeiten stehen unter *Optionen → Bildaufnahme (Imaging) → Meridian Flip*: *Minutes after meridian* 1, *Max. minutes after meridian* 5, *Pause before meridian* 0, *Use telescope side of pier* an, *Recenter after flip* aus. Der Teleskop-Simulator muss nachführen und die Pier-Seite melden (*Ausrüstung → Teleskop*: vor dem Flip „West“, nicht „Unknown“).

| Parameter | P-01 | P-02 | P-03 | P-13 Lauf A | P-13 Lauf B |
|---|---|---|---|---|---|
| Belichtungen × s | 20 × 60 | 20 × 5 | 5 × 30 | 6 × 120 | 4 × 60 |
| Filter | `L,R` (exakt wie im Profil) | `L` | `L` | `L` | `L` |
| Meridian in min | 10 | 120 | 120 | 5 | 5 |
| Dec ° / PA ° | 20 / 30 | 20 / 30 | 20 / 30 | 20 / 30 | 20 / 30 |
| Abbruch Nr. / nach s | 0 | 0 | 2 / 10 | 2 / 20 | 0 |
| Auslesemodus | leer | leer | leer | ein Modus, den die Kamera anbietet (z. B. `High Gain Mode`) | leer |
| AF unterdrücken | aus | aus | aus | **an** | aus |
| Pier-Seite ignorieren | aus | aus | aus | aus | **an** |
| Globale Trigger | Meridian Flip, AF nach Zeit (30 min), AF nach Filterwechsel, Center after Drift | keine | keine | Meridian Flip, AF nach Zeit (**1 min**), zusätzlich *Dither after Exposures* | Meridian Flip |

Den Namen des Auslesemodus zeigt NINA unter *Ausrüstung → Kamera*. Ist der Name falsch, erscheint `READOUT_MODE_NOT_FOUND` und die Belichtungen werden übersprungen, wie im Produktiv-Plugin vorgesehen.

## 3. Erwartete Log-Zeilen

| Protokoll | Muss vorkommen | Darf nicht vorkommen |
|---|---|---|
| P-01 | `TRIGGER type=…` zwischen den `CAPTURE … result=saved` (20×); `TRIGGER type=MeridianFlipTrigger`; `FLIP pierBefore=west pierAfter=east durationS=…` | `ERROR`; im **NINA-Log** (nicht nur `nina-pm.log`) die Meldung „No target information available for flip“ |
| P-02 | 20 × `CAPTURE id=… result=saved file="…"` mit verschiedenen IDs und Dateinamen | `CAPTURE … result=failed` |
| P-03 | `WARNING code=probe_abort atUtc=…`, weniger als 5 s später `CAPTURE … result=aborted atUtc=…`, danach wieder `result=saved` | `WARNING code=probe_abort_fallback` (dann griff nur noch `AbortExposure`) |
| P-13 A | `TRIGGER_SUPPRESSED type=AutofocusAfterTimeTrigger` und `TRIGGER_SUPPRESSED type=DitherAfterExposures`; `READOUT mode=set name="…" index=…`; `CAPTURE … result=aborted`; `FLIP pierBefore=west pierAfter=east durationS=…` | ein `TRIGGER type=AutofocusAfterTimeTrigger` |
| P-13 B | `TRIGGER type=MeridianFlipTrigger`, danach `FLIP_UNDETECTED` | ein `FLIP` in Lauf B |

P-13 A und B schreiben in **dieselbe** `nina-pm.log`; beide Läufe gehören in einen Ordner.

## 4. Ergebnisse ablegen

Je Protokoll, z. B. für P-13:

```bash
pnpm test-run:check --init P-13 docs/test-runs/2026-09-29/P-13
```

Das legt `result.json` mit den Schritten des Protokolls an. Dann:
1. `nina-pm.log` als `nina.log` in den Ordner kopieren, dazu Screenshots (`*.png`): P-01 Sequenzansicht, P-02 FITS-Header mit Zielname und Positionswinkel.
2. In `result.json` eintragen:
   - `pluginVersion` `probe-0.1.0`;
   - `ninaVersion`, z. B. `3.2.0.9001` aus *Hilfe → Über*;
   - je Schritt `ok` und `note`;
   - `result` `go`/`no_go`, Abweichungen und Artefakte.
   
   `server` bleibt `nina_test_server`, `scenario` bleibt `null` (ohne Test-Server gefahren).
3. Committen oder den Ordner an Claude Code geben. `pnpm test-run:check docs/test-runs/2026-09-29/P-13` trägt `logCheck` ein.

## 5. Zusätzlich für das ADR (ohne `result.json`)

- **Versionsabgleich (aus AP-S2c):** Dateiversion von `NINA.Sequencer.dll` der Installation, Schritt 5 in `docs/ops/windows-vm.md`.
- **Kommandozeilenstart (OT-22, NT-45):**
  1. In NINA die Sequenz aus P-02 speichern, z. B. `C:\dev\probe.json`, und die Profil-ID notieren (*Optionen → Allgemein → Profile*).
  2. Einmal von Hand starten:
     ```powershell
     & "C:\Program Files\N.I.N.A. - Nighttime Imaging 'N' Astronomy\NINA.exe" --profileid <ID> --sequencefile C:\dev\probe.json --runsequence --exitaftersequence
     ```
  3. Denselben Aufruf als Aufgabe in der Windows-Aufgabenplanung anlegen und einmal auslösen.
  4. Notieren, welche Schalter NINA 3.2 akzeptiert (Kurzformen `-p`, `-s`, `-r`, `-x`?) und ob NINA nach der Sequenz beendet.
- **Unterbrechung vs. Benutzerabbruch (§4.6):**
  1. Den Probe-Container (P-03-Werte, Abbruch Nr. 0) in einen Container mit der Bedingung *Loop While Safe* legen.
  2. Während einer Belichtung den Safety-Monitor-Simulator auf unsicher schalten. Erwartet: `CAPTURE … result=aborted`, `BLOCK_END reason=interrupted`, `SAFETY_PAUSE`.
  3. Zweiter Lauf: die Sequenz von Hand stoppen. Erwartet: `BLOCK_END reason=user_skip`.

Die Ergebnisse dieser drei Punkte reichen als kurze Notiz, z. B. in `docs/test-runs/<datum>/ap-s2b-notes.md`.
