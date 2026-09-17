# AP-16f – Plugin: Rotator, Flip, Standort- und Sequenzprüfung, Playback-Verzug

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-16e · **Menschliche Aufgaben:** H-15

## Ziel
Rotator, Meridian-Flip, Standort- und Uhrprüfung sowie die Sequenzprüfung arbeiten zuverlässig und melden Abweichungen.

## Anforderungen
FA-NIN-03, FA-NIN-23, FA-NIN-24, FK 8.8

## Lesen (nur diese Abschnitte)
- specs/engine/flip-rotation.md
- specs/engine/geometry.md §2.2 (Panel-PA, Toleranzprüfung ohne Rotator)
- specs/nina/execution.md §4.2, §4.5
- FK 8.8
- ops/plugin-test-protocol.md P-07, P-08, P-21
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Rotator-Regeln, Flip-Erkennung über Pier-Seite (Dauer, `flipDoneByPanel`), **Rückfall über Plate-Solve (Δ ≈ 180° und Triggerlaufzeit ≥ 0,5 × Flipdauer; Stundenwinkel allein ⇒ nur `flip_undetected`, NIN5-1)**, Nachbehandlung (Container-Target, erneutes Center & Rotate), **kumulierter Playback-Verzug** (§4.2), SequenceInspector (Trigger vorhanden, Profilwerte), SiteCheck (Standort, Uhrabweichung 5 s/60 s)

## Nicht im Umfang
- –

## Automatisierte Abnahme
- [ ] Rotations-Grenzwerte und Flip-Erkennung (Core), inkl. Fall „Pier-Seite `null` ohne Plate-Solve-Sprung → kein `flip`“
- [ ] Playback-Verzug: Filterverhältnisse bleiben nach 6 min Verzögerung erhalten
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-07, P-08, P-21
