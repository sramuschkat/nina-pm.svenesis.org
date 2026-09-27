### Planung – Objektbrowser zuerst, gleiche Kontextleiste, „Mond und Dunkelheit“, Datumswahl mit Mondkalender (2026-09-27)

Anforderungen: S-20, S-21, FA-FRM-11, FK 1088 (Übernahme „Nachtstreifen, Mondkalender“ aus dem Beobachtungsplaner) · Wunsch Sven 27.09.2026

- **Planung:** Der Objektbrowser ist der erste Reiter, und „Planung“ in der Navigation öffnet ihn. Die Sternkarte folgt als zweiter Reiter.
- **Gleiche Kontextleiste in Objektbrowser und Sternkarte** (`pages/planning/PlanningContext`):
  - Aufbau: Rig · „Nacht ab dem Abend des [Datum] [mit Mondphasen]“ mit ← → · „Heute Nacht“.
  - Rechts steht ein seitenbezogener Zusatz: im Objektbrowser die Dunkelheit, in der Sternkarte Uhrzeit in Standortzeit, Zone und „Jetzt“.
  - Das Datum ist der Nacht-Schlüssel.
  - In der Sternkarte behält ein Nachtwechsel die Uhrzeit innerhalb der Nacht, auch über die Zeitumstellung. Rig, Datum und Uhrzeit sind dafür aus der Werkzeugleiste in die Kontextleiste gewandert; die Werkzeugleiste enthält Suche und Aktionen.
- **Mondkalender** (Popover), je Nacht:
  - Mondsymbol und Beleuchtung um Mitternacht der Nacht.
  - Grüner Balken für die mondfreie astronomische Dunkelheit (voll = die längste des Monats, mindestens 8 h).
  - Stern für die drei besten Nächte; getönt die Nächte ab Freitag und Samstag.
  - Viertel mit Rahmen und Namen, der Nacht Mittag–Mittag zugeordnet.
  - „Heute“ und der orange Rahmen kommen aus der Nacht-Tabelle des Servers.
  - Unten die Viertel mit Uhrzeit in Standortzeit, die Gerätezeit in Klammern, wenn sie abweicht.
- **„Mond und Dunkelheit“** unter Rig und Datum, aufklappbar:
  - Kopf: Phase, Beleuchtung und Tage nach Neumond.
  - Nachtstreifen nach dem Beobachtungsplaner: Himmel nach Sonnenhöhe, astronomisch dunkel grün, Mondhöhe als gelbe Linie mit Fläche, Maßlinie der astronomischen Dunkelheit.
  - Kennzeichen für Sonnen- und Mondauf-/-untergang, bürgerlich/nautisch/astronomisch und „jetzt“.
  - Stundenzeilen „Standort“ und „bei dir“; dazu Legende und Fußnote.
  - Sonne und Mond sind gezeichnete Formen statt Zeichen (kein Emoji).
  - Objektbrowser: direkt nach Rig und Nacht; die laufende Nacht zeigt „jetzt“ als gestricheltes Kennzeichen.
  - Sternkarte: ebenfalls direkt nach Rig und Nacht, vor Suche und Karte; wie im Beobachtungsplaner mit roter Linie „eingestellte Uhrzeit“, ein Klick in den Streifen stellt die Uhrzeit (auf 5 min).
- **Neue Bausteine** `MoonDarkness` und `MoonIcon` (components.md §2.17/§2.18), Symbol `calendar-days`, neue Tokens (`chart-moon-line`, `chart-mark-*`, `moon-lit`/`moon-dark`, `today`, `star`).
- **Engine:** `moonPhaseAngleDeg`, `moonPhaseEvents` (Viertel per Bisektion auf 1 s) und `moonAgeDays`. Geprüft gegen die veröffentlichten Viertel im September 2026 auf ± 3 min. Die Dunkelheitszeiten der Nacht 27./28.09. in Starfront stimmen auf ± 3 min mit dem Beobachtungsplaner überein.
