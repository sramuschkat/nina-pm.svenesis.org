# AP-16b – Plugin Core: Planung, Neuplanung, Offline-Plan

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-16a, AP-S2a, AP-13d · **Menschliche Aufgaben:** –

## Ziel
Der Plugin-Kern plant online und offline und entscheidet nachvollziehbar, wann neu geplant wird (Hysterese, Fälle a/b/c). Alles ist ohne NINA auf Linux getestet.

## Anforderungen
FA-NIN-04…12, FA-SYN-03, FA-SIM-05

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §2 (Zeitmarken, veraltete Session, `blocked`), §3, §8
- specs/engine/allocation.md §5.3 (`tonight`)
- specs/engine/night.md (Nacht-Schlüssel offline)
- TK 10.3 Nr. 1–3, 10.4
- ADR-S2a
- ops/plugin-test-protocol.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- PlanClient (`POST /plan`, Gründe initial/refresh/resume/reset), `ReplanPolicy` (vor jedem Block nur bei ETag/settingsVersion/Verzug > 10 min; im Block alle 15 min Fälle a/b/c; neuer Blockindex; kein Slew bei gleichem Panel)
- `tonight` aus dem lokalen Protokoll
- Jint-Fallback offline mit Bootstrap-Zeitzonen und Nacht-Schlüsseln
- Nachtschleife als Zustandsmaschine (Ende erst nach `sessionEndUtc`), Playback zeitgeführt/sequenziell als reine Logik

## Nicht im Umfang
- NINA-Adapter

## Automatisierte Abnahme
- [ ] ReplanPolicy-Tabellentests (a/b/c, Hysterese, Verzug)
- [ ] Zustandsmaschinen-Tests (Zeit simuliert): Nachtende-Reihenfolge Blöcke → Flats → `PATCH completed` → erst im nächsten Aufruf `false` (NIN5-12); `blocked` je Grund mit Austrittsregel (NIN5-2/13)
- [ ] Offline-Plan-Hash = Server-Hash bei gleichem Input – **vollständig erst mit AP-13d**, weil Flip, Transit und Diagnose in den Hash eingehen (CC5-10)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
