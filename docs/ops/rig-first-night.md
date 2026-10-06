# Erste NINA-PM-Nächte am Rig Starfront (Stufe 3)

Checkliste für die ersten **3–5 betreuten Nächte** am echten Rig, bevor NINA-PM unbeaufsichtigt läuft. Rig laut Logs vom 23.08.–26.09.2026:
- Starfront, GT81 + Player One Ares-M PRO;
- ASI-Montierung (ASCOM, JNOW), ZWO EFW und EAF, DeepSkyDad-Flatpanel, PHD2;
- **kein Rotator**;
- Safety über den **Dach-Dateitreiber** (Generic File).

Werte in *kursiv* stammen aus den gemessenen Logs; was offen ist, steht als „prüfen“ da.

Ziel jeder betreuten Nacht: Am Morgen liegt das NINA-Log vor, Session und Zähler im Web stimmen, und nichts musste von Hand gerettet werden. Erst nach 3–5 solchen Nächten unbeaufsichtigt.

## 1. Im Web (am Tag vorher)

**Rig Starfront** (*Ausrüstung › Rigs*):

| Einstellung | Wert | Warum |
|---|---|---|
| Standort | Starfront, 31,55° N / 99,38° W, Zone `America/Chicago` | NINA-Profil, Montierung und Windows müssen denselben Standort haben |
| Rotator | **aus** | sonst `rotator_unavailable` je Block |
| An NINA ausliefern | an | sonst bekommt das Plugin keine Ziele |
| Nachtbericht nach Discord | an | Bericht am Morgen |
| Rotationstoleranz | ≥ Rotationstoleranz des Plate-Solvers in NINA | sonst `plate_solve_tolerance` |
| **Overheads** | eingetragen nach der ersten Rig-Nacht (06.10.2026) | ein zu kleiner Wert kostet Belichtungen am Blockende, ein zu großer Wartezeit (`WAIT_PLAN`) |
| – Slew + Zentrieren | **90 s** | Rig-Nacht: 52 s schon beim erneuten Anfahren desselben Ziels (2× Plate-Solve, Winkel-Solve, Guiding-Start); die früheren 35 s aus den Astro-PM-Logs enthielten Winkelprüfung und Guiding-Start nicht |
| – Filterwechsel | **10 s** | |
| – Dither-Settle | **18 s** | p50 17 s Settle + Überhang; Rig-Nacht 12–13 s |
| – Autofokus-Dauer | **180 s** | Rig-Nacht: Luminanz 135 s, SII 294 s (NINA fokussiert mit dem aktuellen Filter) |
| – Autofokus alle | wie *Autofocus After Time* in der Sequenz (60 min) | sonst `af_time_mismatch` |
| – Download je Belichtung | **5 s** | Rig-Nacht: Belichtungsende bis „gespeichert“ ≈ 5 s; ab Plugin 0.4.8 rechnet das Plugin mit diesem Wert (vorher fest 3 s – Werte unter 3 s ließen Blöcke mit einer Belichtung leer enden) |
| **Meridian-Flip** | genau wie im NINA-Profil | sonst `flip_timing_mismatch` |
| – Minuten nach Meridian / maximal / Pause vor Meridian | *5 / 10 / 5* (heutiges Profil) – prüfen | |
| – Flip-Dauer | *≈ 250 s* (Slew 48 s + AF nach Flip 125 s + Zentrieren/Guiding 59 s + Settle 15 s) – prüfen | ohne die Pause vor dem Meridian |
| **Flats** | an, Quelle Panel, Anzahl wie bisher, Dark-Flats an | |
| Auto-Flats | für die ersten Nächte **aus** | erst einzeln prüfen |
| **Projekt-Rotation** | gemessener Winkel ohne Rotator, Starfront **136°** | sonst vor jedem Block `ROTATION_MISMATCH` (Rig-Nacht 06.10.2026); der Block wird trotzdem belichtet, solange *Bei Abweichung überspringen* aus ist |

**Filterrad** (*Filterradbelegung – Zuordnung zu NINA*): Plätze genau mit den NINA-Namen bestätigen, auf Groß-/Kleinschreibung achten: `LUMINOS`, `RED`, `GREEN`, `BLUE`, `HA`, `OIII`, `SII`. Leere Plätze bleiben leer. Nach dem ersten Heartbeat zeigt die Seite die Meldung von NINA zum Vergleich.

**Kamera:** Die Auslesemodi der Ares-M **Zeichen für Zeichen** wie in NINA eintragen (*Equipment › Camera › Settings › Readout mode for sequences*; NINAs Player-One-Treiber: `Normal`, `Low Noise`), Standard `Low Noise`. Das Plugin findet den Modus über den Namen; ein falscher Name überspringt die Belichtungen (`readout_mode_not_found`). Einen automatischen Abgleich im Web gibt es noch nicht: Das Plugin meldet die Modi zwar, der Server speichert sie aber nicht (vorgemerkt, 06.10.2026). Die Zeilen nutzen *Gain 125, Offset 50, Auslesemodus `Low Noise`* wie bisher, oder leer für den Kamera-Standard. Rauschmodell bei Gain 125, LRN laut Handbuch: 1,017 e⁻/ADU, 1,38 e⁻, Full Well 16 666 e⁻, QE 91 %, Dunkelstrom bei 20 °C 0,0224 e⁻/s.

**NINA-Instanz** (*NINA › NINA-Instanzen & Tokens*): Instanz für den Rig-PC anlegen und das Token sofort notieren; es wird nur einmal angezeigt.

**Projekte:** freigegeben, *Aktiv*, Rig Starfront. Unter *NINA › An NINA ausgeliefert* müssen die Ziele der Nacht stehen. Den **Nacht-Simulator** für die Nacht ansehen: Blöcke, Dunkelheit und Flip-Marken müssen plausibel sein. Für die erste Nacht reichen 1–2 bekannte Ziele. Sind alle Projekte vor der Dämmerung fertig, endet die Nacht trotzdem zur Dämmerung mit Flats; das gilt ab Plugin 0.4.4 und Engine 0.16.0 (Lauf `real-all-done`, 05.10.2026).

## 2. Am Rig-PC

- **Plugin** in der freigegebenen Version installieren (aktuell **0.4.9**, CI-Artefakt `nina-pm-plugin` des `plugin`-Laufs auf main 54fd1b7). Dazu NINA beenden, das Plugin-Paket nach `%LOCALAPPDATA%\NINA\Plugins\3.0.0\Svenesis.NinaPm` entpacken und NINA starten. Das Astro-PM-Plugin darf installiert bleiben; seine Sequenz aber nicht laden.
- **Keine Advanced API** auf dem Rig. Sie hat keine Anmeldung und ist nur für die Test-VM gedacht.
- *Optionen › Plugins › NINA-PM*:
  - Server-URL bleibt `https://nina-pm.svenesis.org/api`, Sync-Token eintragen;
  - *Testbetrieb* **aus**, *Offline-Modus* **aus**;
  - *Verbindung testen* muss die Rig-Daten zeigen;
  - zeigt die Seite eine Standortwarnung, *Standort aus NINA-PM übernehmen* (englisch: *Use location from NINA-PM*) drücken.
- **NINA-Profil:**
  - *Meridian Flip*: **Recenter aus** (NT-22, NINA-PM zentriert nach jedem Flip selbst; heute ist es an). Minuten nach Meridian, maximal und Pause genau wie im Web; *AF after flip* wie bisher.
  - *Plate Solving*: Rotationstoleranz ≤ Rotationstoleranz des Rigs.
  - *Flat-Panel*: trainierte Flat-Belichtungen für jede Kombination aus Filter, Binning, Gain und Offset der Projekte. Fehlt eine, meldet das Plugin es und der Filter bekommt keine Flats.
- **Dateimuster** (*Options › Imaging*): Am Starfront-Rig bleibt Svens bisheriges Muster mit dem **Ziel als erstem Ordner**, etwa `<Ziel>\LIGHT\<Nacht>\<Filter>\<Ziel>_LIGHT_<Filter>_<Belichtung>s_G<Gain>_O<Offset>_<Auslesemodus>_<Temp>C_<Nr>_<Datum Zeit>`. So steht es in der Rig-Nacht vom 06.10.2026 im Log. Folgen:
  - Lights, Flats (`<Ziel>\FLAT\…`) und Dark-Flats (`<Ziel>\DARKFLAT\…`) liegen je Ziel. NINA-PM setzt je Block den Projektnamen; „/“ im Namen wird beim Speichern zu „_“.
  - Geteilte Flats kopiert das Plugin in die Ordner der übrigen Ziele (`COPY … status=copied`). Ab 0.4.9 gilt das auch für die Dark-Flats, die nur einmal je Nacht und Gruppe aufgenommen werden.
  - Mit NINAs Standardmuster ohne Zielordner (so liefen die VM-Tests) gibt es keine Kopien, und im Log steht `COPY … status=no_target_segment`.
- **Windows:** Zeitzone = Standortzone (CDT/CST), sonst Warnung `pc_timezone_differs` und Datumsordner, die nicht zur Nacht passen. Uhr synchronisiert: Mehr als 60 s Abweichung sperrt das Plugin (`clock_skew`).

## 3. Sequenz

Grundlage ist die Beispielsequenz **„Eine Nacht mit Safety“** (Links auf der Optionsseite des Plugins); Aufbau siehe `docs/ops/sample-sequences.md` und *NINA › Hilfe*. Für Starfront:

- **Start-Bereich:** *Wait if Sun Altitude* (wie bisher) → Entparken bzw. wie bisher bei Astro PM → *Cool Camera* → **Run Autofocus**. Den Autofokus nicht weglassen: Ohne ihn plant der Server am ersten Block Autofokus-Zeit, die NINA dann nicht nutzt (`WAIT_PLAN` im Log).
- **„Ziel“:**
  - Bedingungen *NINA-PM Night Loop* und *Loop While Safe* (Dach-Safety);
  - Trigger *Meridian Flip*, *Autofocus After Time* (Amount = „Autofokus alle“ des Rigs) und *Restore Guiding*;
  - **kein** *Dither after Exposures*.
- **„Sicherung“:**
  - Bedingungen *Loop While Unsafe* und *NINA-PM Night Loop*;
  - Anweisungen *Stop Guiding* → Parken/Home → **NINA-PM Wait until Safe or Night End** als letzte Anweisung.
- **Ende-Bereich:** *Stop Guiding* → Parken/Home → *Warm Camera*.
- **Flats** (*NINA-PM Instructions* → *Flats am Nachtende*):
  - *Vor Flats*: *Stop Guiding* → Parken/Home → NINAs eigenes **Wait for Time** mit Quelle **Nautical Dawn**, wie bisher bei Astro PM → Panel schließen, Licht an. So beginnen die Flats erst nach der nautischen Dämmerung (Starfront-Regel). Ab Plugin 0.4.8 stoppt das Plugin das Guiding **nicht** selbst und wartet bei Panel-Flats nicht; Start und *Stop Guiding* gehören in diese Box (Entscheidung Sven 06.10.2026). Ist die Dämmerung schon vorbei, etwa nach einer Unterbrechung, geht es sofort weiter: NINA wartet dann 0 s (NINA 3.2, `WaitForTime`). Gleichwertig ist *Wait for Sun Altitude* mit Comparator „<“ und −12°. *NINA-PM Wait for Time* passt hier **nicht**: Sie würde auf die nächste Nacht warten.
  - *Je Kombination*: *Trained Flat Exposure* → *Trained Dark Flat Exposure*, beide mit *Keep Panel Closed* an. Filter, Gain, Offset, Binning und Anzahl nicht eintragen.
  - *Nach Flats*: Licht aus.
- Nach dem Laden zeigt das NINA-Log beim ersten Plan die Vorlagenprüfung (`Sequence template: …`). Sie sollte **leer** sein; jede Meldung dort vor der Nacht klären.

## 4. Die erste Nacht beobachten

| Wann | Wo | Erwartet |
|---|---|---|
| Vor dem Start | Web *NINA › NINA-Instanzen* | Instanz verbunden, Plugin-Version richtig, letzter Heartbeat < 2 min, **keine** Einstellungswarnung (Flip, Recenter, AF, Filterrad) |
| Sequenzstart | NINA-Log | `PLAN reason=initial`, `SESSION … status=running`, Live-Status im Container mit „Today's targets“ |
| Erster Block | NINA, Web *Sessions* | Slew, Zentrieren, erste Aufnahmen; im Web steigen die Zähler |
| Meridian-Flip | NINA-Log | `FLIP pierBefore=… pierAfter=… durationS=…`, danach Zentrieren und weiter |
| Dach zu | NINA | Belichtung abgebrochen, Sicherung parkt, *Wait until Safe or Night End* wartet; Dach auf → Wiederaufnahme mit neuem Plan. Bleibt das Dach bis zum Ende der Dunkelheit zu, laufen die **Panel-Flats trotzdem** (Log `Unsafe at night end – panel flats run anyway`), danach `SESSION status=finished reason=unsafe` |
| Dach schließt während der Flats | NINA-Log | **prüfen:** Die laufende Kombination wird unterbrochen und in der Sicherung mit den fehlenden Aufnahmen fortgesetzt; alle Kombinationen `done` |
| Morgen | NINA-Log, Discord | Ende der Dunkelheit → `FLATS_START` erst nach der nautischen Dämmerung → Flats → `SESSION status=completed pending=0` → Ende-Bereich (Parken, Aufwärmen) → Nachtbericht in Discord |

**Bei Problemen:**
- Plugin gesperrt (`BLOCKED`), Ziele falsch, Abbruch mitten in der Nacht: Sequenz stoppen, im Container *Reset* drücken. Bleibt es dabei, die gewohnte **Astro-PM-Sequenz** laden und die Nacht damit fortsetzen.
- Den Zeitpunkt notieren; der Rest steht im Log.

`WAIT_PLAN` im Log ist **kein** Fehler. Es heißt nur, dass das Plugin schneller als geplant war und auf den nächsten Zeitpunkt wartet.

## 5. Am Morgen danach

- **NINA-Log** der Nacht (`%LOCALAPPDATA%\NINA\Logs\<Datum>.log`) nach `docs/test-runs/<Datum>/rig-night-<n>/` legen oder schicken. Claude Code wertet es aus: Ablauf, Warnungen, Zeiten gegen den Plan, Verzug, Flats.
- **Schnelle Prüfung:** `pnpm rig-night:check docs/test-runs/<Datum>/rig-night-<n>/` liest alle NINA-Logs der Nacht und gibt ein Go/No-Go.
  - Muss: Plan, Session gestartet und regulär beendet, Outbox leer, keine `ERROR`-Zeile, keine Sperre, keine abgelehnte Anfrage, Lights gespeichert, Flat-Kombinationen erledigt, Flats erst nach der nautischen Dämmerung von Starfront.
  - Hinweise: Warnungen, Flips, `WAIT_PLAN`, übersprungene Blöcke, Safety-Unterbrechungen, Nutzung der Dunkelheit.
  - Lights je Filter liest das Werkzeug aus dem Dateinamen.
- **Im Web prüfen:**
  - Session abgeschlossen;
  - Zähler je Zeile = gespeicherte Dateien;
  - Flat-Kombinationen `done`;
  - Nachtbericht in Discord;
  - keine offenen Alarme.
- Abweichungen der Overheads aus dem Log in die Rig-Werte übernehmen (Medianwerte).

Nach **3–5 Nächten** ohne Eingriff: Auto-Flats nach Bedarf einschalten und unbeaufsichtigt laufen lassen, optional mit Autostart über die Windows-Aufgabenplanung (NT-45).
