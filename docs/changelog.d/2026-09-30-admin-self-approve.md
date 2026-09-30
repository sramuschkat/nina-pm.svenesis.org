### Projekt-Editor: *Freigeben & aktivieren* für eigene Entwürfe von Admins (2026-09-30)

Anforderungen: FA-PRJ-18, FA-FRG-10 · Hinweis Sven 30.09.2026 („wieso muss ich als Owner/Admin erst einreichen?“)

- Admins sehen bei **eigenen** Entwürfen und zurückgegebenen Projekten statt *Einreichen* den Knopf ***Freigeben & aktivieren***, solange die Mandanteneinstellung „Admin-Objekte ohne Warteschlange“ an ist (Standard). Die API konnte das schon, im Editor fehlte der Weg.
- Freigabe mit dem Rig des Projekts, Status *Aktiv*, Priorität am Ende der Rig-Liste. Es gilt dieselbe Pflichtprüfung wie beim Einreichen; fehlende Angaben stehen unter dem Kopf. Ohne Rig ist der Knopf gesperrt, ungespeicherte Änderungen zuerst speichern.
- Exoplaneten: Die Freigabe legt den gewünschten Transit fest (transit.md §8); danach wirkt *Festlegen* im Reiter sofort.
- Ohne die Einstellung bleibt es bei *Einreichen* über die Warteschlange.
- **Tests:** Editor (direkte Freigabe mit Rig, Status, Version; ohne Einstellung *Einreichen*; ohne Rig gesperrt).
