### VM-Prüfstand: Nachtbericht im Lauf vorgezogen (2026-10-07)

- Seit #304 läuft der Nachtbericht frühestens 10 min nach dem Sessionabschluss (`LATE_LIGHT_AFTER_END_MS`). VM-Läufe gegen den echten Server enden aber 60 s nach dem Abschluss, deshalb war die Prüfung „Abschluss- und Bericht-Job erledigt“ rot (`real-flip`, 07.10.2026).
- Der Prüfstand zieht den Berichtstermin im Lauf jetzt vor, wie schon die Transit-Wertung. Kopflose Läufe mit virtueller Uhr ändern sich nicht.
