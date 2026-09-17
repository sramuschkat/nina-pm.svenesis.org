# AP-08a – Engine-Grundlagen: Mathematik, kanonisches JSON, Hash

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-01 · **Menschliche Aufgaben:** –

## Ziel
Die Engine hat eigene, deterministische Mathematik und kanonisches JSON als Grundlage für identische Ergebnisse in Browser, Node und Jint.

## Anforderungen
TK 8.1, NFA Determinismus

## Lesen (nur diese Abschnitte)
- rules/engine.md
- specs/engine/canonical-json.md
- TK 8.1–8.2
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `packages/engine/src/math` (fdlibm-Port: sin, cos, tan, asin, acos, atan, atan2, exp, log, pow, fmod) mit Tests gegen bekannte Werte
- `canonicalInputJson`, `sha256hex` (rein)
- ESLint-Regel scharf schalten
- `ENGINE_VERSION`

## Nicht im Umfang
- Astronomie (AP-08b)

## Automatisierte Abnahme
- [ ] Testvektoren aus canonical-json.md
- [ ] math: ≥ 10.000 Zufallswerte |Δ| ≤ 1e-15 gegen `Math.*` (nur im Test erlaubt)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
