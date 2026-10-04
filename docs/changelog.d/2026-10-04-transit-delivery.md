### Transits an NINA ausliefern; Abschluss mit Nachfrist (AP-44)

Anforderungen: FA-EXO-21…24, FA-EXO-33a, FA-NIN-20, FA-SYN-02

- **Fehler behoben:** Der Server lieferte festgelegte Transits nie an das Plugin – `targets` enthielt nur Deep-Sky (`exoplanet: null`), `POST /plan` rechnete ohne `transits`. Festgelegte Beobachtungen wurden deshalb nie belichtet und als *verpasst* abgeschlossen. Getestet war AP-44 nur gegen den `nina-test-server`.
- **`GET /targets`:** Exoplaneten-Projekte in der Nacht ihres festgelegten (primären) Transits mit Ephemeride, Beobachtung, Erlaubnissen und Transit-Zeile; `deliveryNights` und die Web-Ansicht *An NINA ausgeliefert* zählen sie mit. Das ETag ändert sich bei Festlegen, Aufheben und neuen Erlaubnissen.
- **`POST /plan` / `GET /simulation`:** Transit der Nacht als Transit-Einheit (`buildPlanInput` mit `transits`); ohne Transit in der Nacht wird ein Exoplaneten-Projekt nicht geplant.
- **Abschluss (`settleTransits`):** erst 30 min nach Fensterende (letzte Belichtung und Postausgang des Plugins); *beobachtet* mit Nachmeldungen wird neu gezählt, ohne zweites Discord-Ereignis.
- **Spec:** `transit.md` §8 (Nachfrist) und neuer §9 (Auslieferung an NINA).
