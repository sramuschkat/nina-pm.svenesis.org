### Nächte: Session-Qualität auf der Karte, Vorhersage beschriftet (2026-10-10)

Nach Svens Hinweis zur Nacht 08./09.10.: Auf der Karte stand „● Sehr schlecht · 23 %“. Das war die Wettervorhersage zum Sessionbeginn, wirkte aber wie eine Bewertung der Nacht, während die Session-Qualität im Detail „sehr gut · 96 %“ zeigte.

- Die Karte einer Nacht zeigt jetzt die **Session-Qualität** als Hauptwert („Qualität sehr gut · 96 %“ mit Leiste), über alle Sessions der Nacht summiert.
- Die Vorhersage steht beschriftet darunter („Vorhersage: sehr schlecht · 23 %“).
- `GET /api/web/v1/sessions` liefert je Session `quality` mit derselben Bewertung wie das Nacht-Detail.
