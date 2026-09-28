### Sternkarte, Session-Korrektur, Simulator – Fehlerbehebungen (2026-09-28)

Anforderungen: S-20 (FA-FRM-05/08/11/12), S-61 (FA-AUS-06), S-40 (FA-SIM-05), NT-01, NT-04, E4 · Prüfung 28.09.2026 (P1-12…P1-16)

- **Sternkarte – Uhrzeit (P1-13):** Die Uhrzeit-Eingabe bleibt in der angezeigten Nacht: 01:30 in der Nacht 17./18. ist der Morgen des 18., nicht mehr der 17. (Nacht 16./17.).
- **Sternkarte – ±1 d:** springt über den Nacht-Schlüssel und behält die Uhrzeit auch über die Zeitumstellung (vorher ±86 400 s, in der 25-h-Nacht eine Stunde daneben).
- **Sternkarte – Neues Projekt mit X (P1-14):** Liegt das angeklickte Katalogobjekt nicht im Bildfeld, gehen seine Koordinaten in den Editor statt der Bildfeldmitte irgendwo am Himmel (der Editor überschrieb damit die Katalogkoordinaten). Liegt es im Bildfeld (samt Mosaik), bleibt die ausgerichtete Mitte.
- **Sternkarte – Mosaik-Zahlen (P1-15):** Leeren und neu Tippen ergibt die getippte Zahl (vorher wurde aus „5“ „15“); außerhalb des Bereichs wird erst beim Verlassen geklemmt. *Ins Projekt übernehmen* fragt nach, wenn das Mosaik um mehr als das Vierfache wächst oder mehr als 100 Belichtungszeilen entstehen.
- **Sternkarte – Übernehmen:** Bei 412 lädt die Karte das Projekt neu und zeigt einen Hinweis; Rektaszension und Rotation werden nach dem Runden in [0°, 360°) gelegt (359,9999997° ergab 360 und wurde abgelehnt); die Warnung zum Kamerawinkel rechnet über 0°/360° hinweg.
- **Session-Korrektur (P1-12):** Beim Wechsel der Zeile übernimmt das Formular die Zahl der neuen Zeile (vorher ging die der ersten Zeile mit). *Korrektur erfassen* erscheint nur, wenn der Nutzer mindestens eine Zeile korrigieren darf; das Formular bietet nur diese Zeilen an.
- **Simulator und Heute Nacht (P1-16):** Verlässt man die Seite, während der Worker rechnet, enden offene Anfragen mit Fehler bzw. werden abgebrochen; beim Wiederkommen rechnet der Plan neu, statt für immer „Plan wird berechnet“ zu zeigen. Skriptfehler im Worker beenden offene Anfragen ebenfalls; der nächste Lauf legt einen neuen Worker an. Der Mehrnacht-Bereich beginnt je Rig, Nacht und Entwurfswahl neu.
