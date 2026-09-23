# AP-16c – Plugin Adapter: Container, interne Items, Blockablauf

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-16b, AP-14b · **Menschliche Aufgaben:** H-14, H-15

## Ziel
Der NINA-Container führt Blöcke nach dem Astro-PM-Muster aus: ein Block je Aufruf, Slew/Zentrieren mit Wiederholungsleiter, interne Belichtungselemente und die Tabelle Eintrag → Aktion. Gesperrte Zustände warten, statt in eine Dauerschleife zu laufen.

## Anforderungen
FA-NIN-05…12

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §1–2, §4.1–4.2, §4.6
- TK 10.2–10.3 Nr. 4, 7, 9
- ADR-S2b
- ops/plugin-test-protocol.md P-05, P-25, P-31
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `NinaPmContainer` nach Astro-PM-Muster (überschriebenes `Execute`, ein Block je Aufruf, Platzhalter-Kind, 5-min-Sperre nur nach Benutzerabbruch, Nacht über `currentNight` aus AP-16b, Zustand `blocked{reason}` mit 60-s-Warten); `SetTarget` mit `new Coordinates(Angle.ByDegree(raDeg), Angle.ByDegree(decDeg), Epoch.J2000)` – nicht `Angle.ByHours` des Originals (NT-28)
- interne Items: Slew/Center mit Wiederholungsleiter (Slew-Verzicht nur, wenn seit dem letzten Zentrieren weder geparkt noch unterbrochen wurde: `AtPark = false`, Abstand < 1′, NT-16), Guiding, Dither, `TakeExposureItem` mit `IExposureItem`/`GetEstimatedDuration` (Gain/Offset `null` → `-1`, NT-38)
- Tabelle Eintrag → Aktion (§4.2) inkl. `wait` (endet spätestens beim folgenden `meridian_flip`, NT-21), `end`, `autofocus_hint` (kein Offset, wenn NINA keinen AF auslöst, NT-24); **harter Blockschluss ohne Überhang**, einzige Ausnahme Nachtende-Kulanz: ein `lastOfNight`-Eintrag beginnt nur, wenn `now + exposureS + downloadS ≤ min(darknessEndUtc, block.twilightEndUtc)` (`null`-Werte zählen nicht, beide `null`: `≤ blockEnd`), sonst `block_end` Grund `night_end` (NT-13, NT-18, M4); Playback sequenziell
- **Nachtende (§2, NT-11):** Nachtschleife endet, sobald kein Block läuft und `now ≥ (darknessEndUtc ?? sessionEndUtc)`, spätestens bei `sessionEndUtc`; `PATCH completed` erst am Schleifenende, danach sofort der Ende-Bereich (Guiding stoppen, parken, aufwärmen); kein Wiederöffnen mit `running`; leerer Plan nach `darknessEndUtc` ist kein `plan_failed`
- **Unterbrechung und Benutzer-Stopp (§4.6, NT-15, NT-16):** Interrupt (Vorfahr mit `SafetyMonitorCondition` und Safety-Monitor nicht `Connected && IsSafe`) vom Benutzerabbruch unterscheiden; Interrupt → laufende Aufnahme `aborted`, `block_end` Grund `interrupted`, Ereignis `safety_pause`, Heartbeat `paused`, 5-min-Sperre unverändert, Wiederaufnahme mit `safety_resume` und `reason: resume`; **Anweisung *NINA-PM Warten bis sicher oder Nachtende* (H2):** wartet im Sicherungscontainer bis sicher oder `now ≥ (darknessEndUtc ?? sessionEndUtc)`; am Nachtende schließt sie die Nacht ohne Wiederaufnahme ab (Flats nur, falls sicher, sonst `skipped`; `PATCH completed`; `nightFinished` → Nachtschleife falsch, *Unpark* entfällt, Ende-Bereich); ohne verbundenen Safety-Monitor kein Warten; Benutzer-Stopp → `block_end` Grund `user_skip`, `PATCH` mit Status `aborted`, danach Heartbeats ohne `sessionId`, Sperre aufgehoben
- Beispielsequenzen „Eine Nacht mit Safety“ und „Eine Nacht ohne Safety“ nach der Sequenzvorlage (`execution.md` §1, NT-44): Start *Warten auf Sonnenhöhe* → *Entparken* → *Kamera kühlen* → *Autofokus* (H3); *Loop While Safe* am Zielcontainer mit Trigger *Autofokus nach Zeit* (`Amount = afEveryMin`, M7) und Sicherungscontainer mit *Loop While Unsafe* + *NINA-PM Nachtschleife* und *NINA-PM Warten bis sicher oder Nachtende* (nicht *Wait until Safe*, H2) statt Parallel-Container; Autofokus einmal vor dem ersten Ziel, kein Dither-Trigger
- Portierter Code mit Herkunftskommentar (Datei/Commit)

## Nicht im Umfang
- Trigger-Walk und Filterauflösung (AP-16d), Aufnahme-Meldung (AP-16e)

## Automatisierte Abnahme
- [ ] Adapter-Unit-Tests in `NinaPm.Nina.Tests` mit NINA-Attrappen – Bauen im Auftrag `cross-build`, Ausführen auf `windows-latest` (TK 10.5)
- [ ] Kern-Test: `blocked` wartet 60 s statt sofort zurückzukehren
- [ ] Kern-Test Nachtende-Kulanz: eine Belichtung, die nach `darknessEndUtc` enden würde, beginnt nicht (`block_end` Grund `night_end`); bei `null` gilt `blockEnd`
- [ ] Adapter-Test: Interrupt durch `SafetyMonitorCondition` → `interrupted`/`safety_pause`, Benutzerabbruch → `PATCH` `aborted` und aufgehobene Sperre
- [ ] Kern-Test *Warten bis sicher oder Nachtende* (H2): unsicher bis `darknessEndUtc` → Flats `skipped`, `PATCH completed`, Nachtschleife `false`; sicher vor dem Nachtende → sofortiges Ende ohne Abschluss; kein Safety-Monitor → kein Warten
- [ ] Unit-Test `Coordinates`: `raDeg = 198,069` → RA 13,2046 h
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-05, P-25 (Safety-Unterbrechung, Szenario `safety`), P-31 (Nachtende ohne Flats)
