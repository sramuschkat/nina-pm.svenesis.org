### Scheduler-Einstellungen neu aufgebaut (2026-10-10)

Wunsch Sven: Die Einstellungen im Nacht-Simulator (S-40) waren unübersichtlich. Umgesetzt nach dem Entwurf vom 10.10.

- Karten mit Zeilen: Name und Erklärung links, Feld rechts; abhängige Zeilen eingerückt und gesperrt, solange ihr Schalter aus ist.
- Bei voller Breite drei Spalten: *Planung* und *Reihenfolge* · *Ablauf in NINA*, *Meridian-Flip* und *Bildbewertung* · *Flats* und *Zeiten für die Planung*. Schmaler zwei, unter 760 px eine Spalte; Sprungmarken zu den Abschnitten.
- Schalter statt Häkchen, Wiedergabe und Flat-Quelle als Umschalter, Flip-Fenster in einer Zeile („ab … bis … min“), Kriterien der Sortierkette per Auswahl.
- *Zeiten für die Planung*: je Schritt eingetragen, gemessen (Median, n, „wirkt“) und „fest“ (AP-65), einschließlich Flip-Dauer. „Fest“ wird hier mit *Speichern* übernommen; die Tabelle am Rig speichert weiterhin sofort.
- Ungespeicherte Änderungen: klebende Leiste mit Anzahl und *Verwerfen*, geänderte Zeilen tragen einen Punkt; *Speichern* ist ohne Änderung gesperrt.
- API und gespeicherte Werte bleiben unverändert.
