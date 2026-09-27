### Sicherheit – S3-Aufbewahrung und Body-Limit (2026-09-27)

Anforderungen: FA-MAN-03, TK 12, TK 15 · AWS-Sicherheitsanalyse vom 27.09.2026, To-dos 2 und 11

- **Daten-Bucket mit Lebenszyklusregeln:**
  - Alte Versionen und Löschmarker verschwinden nach 30 Tagen, abgebrochene Uploads nach einem Tag.
  - Befristete Objekte tragen das Tag `npm-retention=<Tage>d`, und je Wert gibt es eine Regel: Job-Ergebnisse 2 Tage, Importe (später auch Exporte) 7 Tage, Planprotokolle 400 Tage. Transit-Ergebnisse bleiben unbefristet.
  - Ein Präfixfilter je Kategorie geht nicht, weil der Schlüssel mit der Mandanten-ID beginnt.
- **Tag beim Schreiben:**
  - Der Worker setzt es bei Job-Ergebnissen.
  - Presigned POSTs für Importe und Planprotokolle enthalten das Feld `tagging` samt Bedingung `eq $tagging`, der Client kann es also nicht weglassen oder ändern.
- **Mandanten-Löschen (FA-MAN-03)** entfernt jetzt jede Version und jeden Löschmarker unter `tenant/<id>/`. Bisher setzte es nur Löschmarker, und die Daten blieben erhalten. Teilfehler von S3 brechen den Vorgang ab.
- **Body-Limit 1 MiB** für die ganze API (Web und NINA), vor Sitzung und CSRF. Darüber antwortet die API mit `413 request.too_large` (neuer Fehlercode).
- **Bestand:** Vorhandene Objekte ohne Tag laufen nicht ab. Ihre alten Versionen verfallen aber nach 30 Tagen.
- Protokolle der Auswertungs-Demo vom 26.09.2026 (`docs/test-runs/2026-09-26/demo-evaluation/`).
