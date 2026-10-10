### Ist der Nacht: Autofokus, Warten und leere Blöcke als Zeilen, Details gefüllt (2026-10-10)

Vergleich mit dem Plugin-Fenster der Rig-Nacht 09./10.10.2026: Die Aufnahmen stimmten 1 : 1, aber die Lücken dazwischen waren im Web unerklärt.

- **Autofokus** steht als Zeile mit Filter und Dauer, auch der Start-Autofokus vor dem ersten Block (in der Nacht 15 Läufe, ≈ 34 min).
- **Warten:** Eine Pause zwischen zwei Aufnahmen desselben Blocks, die kein Autofokus und kein Flip erklärt, steht als „Warten“ mit Dauer, z. B. die Pause vor dem Meridian (11 min 8 s, wie `WAIT_ENTRY` im Plugin-Log). Das Plugin meldet diese Pause nicht als Ereignis, deshalb ohne Grund.
- **Leerer Block:** Ein einzelner kurzer Block ohne Aufnahme (Anfahren, Zentrieren, dann leer, 01:58) verschwand ganz; er steht jetzt als „Slew/Zentrieren · keine Belichtung“. Mehrere leere Blöcke in Folge bleiben eine Lücke.
- **Details der Ist-Belichtungen:** Gain, Offset, Binning, Auslesemodus, Rotation, RA/Dec und Höhe/Mond wie bei den geplanten Zeilen – aus der gespeicherten Planrevision des Blocks, sonst aus Panel und Zeile des Projekts.
- Vertrag: `ExecutedEvent.filter` (Autofokus). Das Plugin 0.4.23 braucht kein Update; es ignoriert das neue Feld.
- AP-71 und AP-72 ☑ 10.10.2026 (Abnahme Sven nach der Rig-Nacht 09./10.10.2026, Reiter „Bilder“ geprüft).
