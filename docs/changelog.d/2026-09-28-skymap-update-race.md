### Sternkarte: schnelle Änderungen gehen nicht mehr verloren

- Zwei Änderungen kurz hintereinander, etwa „Panels horizontal“ und „Panels vertikal“, bauen jetzt aufeinander auf. Vorher übernahm React Router als Grundlage die Adresse des letzten Renderns, sodass die erste Änderung verloren gehen konnte, wenn die Karte langsamer neu zeichnete. Aufgefallen ist das am E2E-Test „Mosaik 2×2 aus der Sternkarte“ auf `main` nach #121.
