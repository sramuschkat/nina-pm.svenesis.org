# AP-16f – Plugin: Rotator, Flip, Standort- und Sequenzprüfung, Playback-Verzug

**Release:** RP · **Größe:** M · **Abhängigkeiten:** AP-16e · **Menschliche Aufgaben:** H-15

## Ziel
Rotator, Meridian-Flip, Standort- und Uhrprüfung sowie die Sequenzprüfung arbeiten zuverlässig und melden Abweichungen.

## Anforderungen
FA-NIN-03, FA-NIN-23, FA-NIN-24, FK 8.8

## Lesen (nur diese Abschnitte)
- specs/engine/flip-rotation.md
- specs/engine/geometry.md §2.2 (Panel-PA, Toleranzprüfung ohne Rotator, gespiegelte Optik)
- specs/nina/execution.md §2 (PC-Zeitzone, Uhrzeit), §4.1, §4.2, §4.5, §6 (Heartbeat-Inhalte)
- FK 8.8
- ops/plugin-test-protocol.md P-07, P-08, P-21, P-26, P-36
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- **Rotator-Regeln modulo 180° (NT-E4):** `CenterAndRotate.PositionAngle = pa`, NINA wählt bei `RangeType` `FULL`/`HALF` PA oder PA + 180°, `QUARTER` → `warning` `rotator_range_quarter` (M2); Vergleich `r = |ist − soll| mod 180; Δ = min(r, 180 − r)`; `has_rotator`, aber Rotator nicht verbunden → `Center` + Winkelprüfung wie ohne Rotator + `warning` `rotator_unavailable` (NT-29)
- **Flip aktiv auslösen (NT-21, M1, M3):** beim Eintrag `meridian_flip` warten, bis NINAs früheste Flipzeit erreicht ist (`minimumTimeRemaining ≤ 0` aus `TelescopeInfo.TimeToMeridianFlip`, höchstens bis `limitEnd`), dann die Trigger aller Vorfahren über die eigene Iteration aufrufen (`GetTriggersSnapshot` + Filter, Dither unterdrückt), auch ohne folgende Belichtung; `UseSideOfPier` ändert das nicht (NINA flippt ab der frühesten Zeit bei jedem Trigger-Aufruf, `MeridianFlipTrigger.cs:236-238`, L8); nach **jedem** erkannten Flip (Pierseite gewechselt, auch ungeplant) zentrieren; gemeldete Dauer `now − max(tTriggerStart, tM + afterMin)`; Flip-Erkennung über Pier-Seite (`west` → `east`, NT-34; `flipDoneByPanel`), **Rückfall über Plate-Solve (Δ ≈ 180° und Triggerlaufzeit ≥ 0,5 × Flipdauer; Stundenwinkel allein ⇒ nur `flip_undetected`, NIN5-1)**; untere Kulmination gleich behandeln (NT-26)
- **Nach dem Flip (NT-E4):** nur Zentrieren (`slew_center`, auch bei einem älteren Plan mit `slew_center_rotate`), **kein** Nachrotieren, Winkelprüfung modulo 180°; mit NINA-`Recenter = true` ohne Rotator nur Winkelprüfung (NT-22)
- **kumulierter Playback-Verzug** inkl. Startverzug (§4.2, NT-21), SequenceInspector (Flip-Trigger vorhanden, Profilwerte; Sequenzvorlage in AP-16h)
- **SiteCheck:** Standort, Uhrabweichung 5 s/60 s gegen `serverTimeUtc` (NT-05); `warning` `pc_timezone_differs`, wenn der Offset von `TimeZoneInfo.Local` vom Standort-Offset abweicht – einzige erlaubte Stelle für `TimeZoneInfo.Local` (NT-06); die Meldung nennt die Folge für `$$DATEMINUS12$$`/Datumsordner und empfiehlt PC-Zone = Standortzone (L3); Montierungsstandort ≠ Rig-Standort bzw. LST-Abweichung > 1 min → `mount_site_mismatch` (NT-22); Plate-Solve meldet `Flipped` → `warning` `optics_mirrored`, gespiegelte Optik wird nicht unterstützt (NT-33)

## Nicht im Umfang
- –

## Automatisierte Abnahme
- [ ] Rotations-Grenzwerte modulo 180° aus `flip-rotation.md` §3 (u. a. Soll 90°, Ist 270° → ok) und Flip-Erkennung (Core), inkl. Fall „Pier-Seite `null` ohne Plate-Solve-Sprung → kein `flip`“
- [ ] Flip-Auslösung: Eintrag `meridian_flip` wartet bis `TimeToMeridianFlip` die früheste Flipzeit meldet (Montierung 20 s später als Engine-`tM` → Auslösung 20 s später; spätestens `limitEnd`), ruft dann die Trigger aller Vorfahren über die eigene Iteration auf; danach `Center`, nie `CenterAndRotate`; ungeplanter Flip vor einer Belichtung → ebenfalls `Center`
- [ ] SiteCheck: PC-Zone `Europe/Berlin` bei Standort `America/Chicago` → `pc_timezone_differs`, Nacht und Blockzeiten unverändert
- [ ] Playback-Verzug: Filterverhältnisse bleiben nach 6 min Verzögerung erhalten
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-07, P-08, P-21, P-26 (Mosaik-Panelwechsel am Meridian), P-36 (Windows-Zone ≠ Standortzone)
