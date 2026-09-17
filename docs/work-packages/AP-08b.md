# AP-08b – Engine: Zeit, Sonne, Mond, Koordinaten, Dämmerung (Port astro-core)

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-08a · **Menschliche Aufgaben:** H-03

## Ziel
Zeit, Sonne, Mond, Koordinaten und Dämmerung sind aus astro-core portiert und gegen astropy-Fixtures mit den Toleranzen aus TK 9.2 geprüft.

## Anforderungen
FK 8.1, TK 8.4, 9

## Lesen (nur diese Abschnitte)
- FK 8.1, 9
- TK 8.4, 9.1–9.2, TK 18 (reference.yml)
- specs/engine/moon.md §1–2 (Refraktion, Beleuchtung)
- specs/engine/night.md (Dämmerungssuche, Polarfälle)
- legacy/astro-tools-*/astro-core.js (Kopiervorlage)
- rules/engine.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Zeit (JD, ΔT, Zeitzonenübergänge als Eingabe), Präzession/Nutation, Sonne, Mond (topozentrisch, Beleuchtung `atan2`, Elongation), **Refraktion nach Saemundsson aus der geometrischen Höhe** (`moon.md` §1; Bennett wird nicht verwendet), Höhe/Azimut, Meridiandurchgang, Dämmerungszeiten und Nachtgrenzen **nach `night.md` §2** (Transit/Antitransit, Bisektion 1 s, `grazing`)
- `tools/reference` (Python/astropy) Generator + Fixtures, erzeugt im CI-Job `reference.yml` mit gebündelten IERS-Daten (lokal optional, H-10)
- Referenztests mit Toleranzen TK 9.2

## Nicht im Umfang
- Sichtbarkeit/Mondvermeidung (AP-10)

## Automatisierte Abnahme
- [ ] Referenztests grün (Toleranzen)
- [ ] Refraktionstabelle aus `moon.md` §1 exakt (28,98′ bei 0°, 34,48′ bei −0,575°)
- [ ] Testtabelle `night.md` §4 exakt (Hannover 21.06. `h_min` = −14,19°, Antitransit 01:27, 78° N `h_max` = −11,44°)
- [ ] Grenzfälle Polarnacht, Mitternachtssonne, Zeitumstellung
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
