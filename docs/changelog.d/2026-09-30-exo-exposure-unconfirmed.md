### Belichtungsempfehlung auch ohne bestätigte Filterradbelegung (2026-09-30)

Anforderungen: FA-EXO-14a · transit.md §6 · Entscheidung Sven 30.09.2026

- **Vorläufige Empfehlung:** Hat sich NINA an einem Rig noch nicht gemeldet, lässt sich die Filterradbelegung nicht bestätigen. Die Belichtungskarte rechnet dann mit dem Web-Filter des passenden, noch unbestätigten Platzes und zeigt „Vorläufig: … ist im Filterrad noch nicht bestätigt“.
  - Filterwahl in der Tabelle (FA-EXO-08), Projektanlage und Planung nutzen weiter nur bestätigte Plätze.
- **Klarerer Hinweis**, wenn gar kein Filter passt: Band Rc, Ic oder lum bzw. Breitband-Rot ab 590 nm Zentralwellenlänge.
- **API:** `exposure.filterConfirmed`.
- **Tests:**
  - API: Route mit unbestätigtem Platz, Kennzeichen;
  - Web: Hinweis auf der Karte.
- **Nachträge:** Annahmen der Belichtungsempfehlung (transit.md §6, FA-EXO-14a) von Sven am 30.09.2026 freigegeben.
