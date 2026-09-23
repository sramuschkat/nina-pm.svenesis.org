# AP-S2a – Spike Jint-Laufzeit

**Release:** RP · **Größe:** S · **Abhängigkeiten:** AP-08c · **Menschliche Aufgaben:** –

## Ziel
Messen, ob `planNight` in Jint für Offline-Pläne schnell genug ist, und die Grenzen festhalten. Ergebnis ist ein ADR mit Empfehlung.

## Anforderungen
TK 10.4

## Lesen (nur diese Abschnitte)
- TK 10.4
- docs/adr/ADR-TEMPLATE.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Messung `planNight`-Prototyp (Dummy mit realistischer Last) in Jint: Laufzeit, Speicher, Grenzen (Rekursion, Zeitlimit)
- `docs/adr/ADR-S2a-jint.md` mit Empfehlung (Offline-Plan-Grenzen)

## Nicht im Umfang
- NINA-Laufzeitfragen (AP-S2b)

## Automatisierte Abnahme
- [ ] Messskript reproduzierbar
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Empfehlung bestätigen
