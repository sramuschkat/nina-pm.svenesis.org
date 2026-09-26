# AP-26k – Filtermarken überall gleich breit, Sternkarten-Seitenbereich wirklich rechts

**Release:** UI-Überarbeitung (vor R3) · **Größe:** XS · **Abhängigkeiten:** AP-26j · **Menschliche Aufgaben:** –

## Ziel
Wünsche Sven vom 26.09.2026:
- Die farbigen Filtermarken sind überall gleich breit, auch in der Filterliste unter Ausrüstung.
- Der Seitenbereich der Sternkarte steht tatsächlich rechts neben der Karte. AP-26j hatte das zugesagt, der Bereich stand aber weiter darunter.

## Liefern
- **`FilterChip`** (§2.1): gemeinsame Mindestbreite `3,3em + 2 × space-2 + Rand`.
- **Sternkarte:** feste Rasterplätze für Karte (Spalte 1, Zeile 1), Seitenbereich (Spalte 2, Zeile 1) und Objektbereich (Zeile 2, volle Breite).
- **E2E:** Die Lage von Karte, Seitenbereich und Objektbereich wird über `boundingBox` geprüft.

## Automatisierte Abnahme
- [ ] E2E: Seitenbereich rechts neben der Karte, gleiche Oberkante; Objektbereich darunter
- [ ] CI grün, Changelog

## Menschliche Freigabe
Sichtabnahme Sven
