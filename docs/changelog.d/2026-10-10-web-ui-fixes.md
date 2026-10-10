### Web: „In der Nacht öffnen“ im Reiter „Bilder“, größere Aufklapper auf „Heute“ (2026-10-10)

- **Projekt → Bilder:** „In der Nacht öffnen“ zeigte „Nicht gefunden“. Der Link ging auf `/auswertung/sitzungen/<id>`, eine Route, die es nicht gibt. Er führt jetzt über `sessionPath` zur Nacht mit vorgewählter Session (`/auswertung/naechte/<id>`).
- **Heute, Aufklapper unter der Zeitleiste:** „Nachtwetter im Detail“, „Mond und Planeten“ und „Ereignisse der Nacht“ sind jetzt mindestens 44 px hoch. Sie waren etwa 28 px hoch und auf dem iPad schwer zu treffen (Rückmeldung Sven).
