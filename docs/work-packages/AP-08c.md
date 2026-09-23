# AP-08c – Engine-Bundle und Jint-Parität

**Release:** R1 · **Größe:** S · **Abhängigkeiten:** AP-08b, AP-S2c · **Menschliche Aufgaben:** –

## Ziel
Die Engine liegt als `engine.iife.js` vor und liefert in Jint dieselben Hashes wie in Node. Das sichert die Offline-Planung im Plugin ab.

## Anforderungen
TK 8.1, 10.4, 17

## Lesen (nur diese Abschnitte)
- rules/engine.md (Jint)
- TK 10.2, 10.4
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `pnpm engine:bundle` → `engine.iife.js`
- **`apps/nina-plugin/NinaPm.Core.Tests` wird hier angelegt** (net8.0, plattformneutral – Linux, macOS und Windows; nutzt `Directory.Build.props` aus AP-S2c; AP-16a erweitert es nur, CC5-16): Jint lädt Bundle, Paritätstest Hash Node ↔ Jint für Fixtures + 500 Zufallseingaben (Node erzeugt Erwartungsdatei)
- CI-Job `engine-parity` (ubuntu)

## Nicht im Umfang
- Plugin-Funktionen

## Automatisierte Abnahme
- [ ] Paritätstest grün in CI
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
