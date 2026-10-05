### NINA-Plugin 0.4.3: Nachtende über sessionEndUtc

- **Fehler (gefunden mit dem kopflosen Lauf `real-all-done`):** Endete die Nacht erst über `sessionEndUtc`, etwa weil der Plan kein `darknessEndUtc` hatte, wechselte im selben Augenblick die „aktuelle Nacht“. Die offene Session wurde als veraltet verworfen, die Nacht nie regulär beendet, und am Morgen begann eine Session der nächsten Nacht.
- **Fix:** Eine offene Session gehört bis zum Mittag noch zu ihrer Nacht und wird dort regulär abgeschlossen: Flats nur vor `sessionEndUtc`, Abschluss, `SESSION status=finished`. Danach endet die Sequenz bzw. die Tagesschleife übernimmt. Spec-Ergänzung `docs/specs/nina/execution.md` §2.
- Zusammen mit Engine 0.16.0 (#268) beginnen die Flats in diesem Fall wieder zur Dämmerung.
