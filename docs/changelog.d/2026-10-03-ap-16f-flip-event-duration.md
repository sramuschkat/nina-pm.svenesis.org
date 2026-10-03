### AP-16f – Flip-Ereignis mit Dauer, VM-Lauf vm-flip

Anforderungen: FA-NIN-24, P-07, P-26

- **Flip-Ereignis mit `durationS`:** Das Ereignis `flip` an den Server trägt jetzt die gemessene Flip-Dauer; bisher stand sie nur in der Logzeile `FLIP`. Neue Report-Prüfung in den Läufen P-07, P-26 und `vm-flip`.
- **VM-Lauf `vm-flip` 03.10.2026** (`docs/test-runs/2026-10-03/vm-flip/`): Flip mit echtem NINA nach der frühesten Flipzeit, nur Zentrieren, kein Nachrotieren. Außerdem: Beispielsequenz lädt in NINA, die Sequenzprüfung meldet genau die erwarteten Hinweise, und der Live-Status ist in NINA sichtbar.
