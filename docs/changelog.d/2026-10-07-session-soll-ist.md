### Session Soll/Ist: Soll = Erstplan der Session ohne Bonus, Ist = diese Session (2026-10-07)

Anforderungen: FA-AUS-03, FA-AUS-06, FA-AUS-09; Entscheidung Sven 07.10.2026 (Analyse Soll/Ist)

- **Soll** je Zeile = Belichtungen des ersten Plans dieser Session (niedrigste Revision) **ohne Bonus**. Bisher kam das Soll aus `summary.plannedFrames` der Engine; dort zählen Bonus-Frames mit. Jetzt zählt der Server die `expose`-Einträge ohne `bonus` je Zeile aus den gespeicherten Plan-Blöcken. Die Engine bleibt unverändert.
- **Transit-Serien** (`expose_series`) haben kein Frame-Soll. Die Soll-Spalte zeigt „Serie“ mit dem geplanten Zeitfenster in Standortzeit; Ist zählt die Frames.
- **Erst später eingeplant:** Zeilen, die nicht im ersten Plan der Session stehen, aber in einer späteren Revision, zeigen Soll 0 mit dem Hinweis „später eingeplant“.
- **Ist** = gespeicherte Lights **dieser** Session. Bisher galt die ganze Nacht über alle Sessions (`capture_night`). Bonus-Aufnahmen stehen nur in *Bonus* und *Bonus verworfen*.
  - Eine Korrektur gilt weiter je Zeile und Nacht (FA-AUS-06). Ihr Überhang über die einzeln verworfenen Aufnahmen verteilt sich nach Sessionbeginn auf die Sessions der Nacht; die Summe ergibt den Nachtwert.
  - *Korrektur erfassen* nimmt Untergrenze, Startwert und Höchstwert aus den Nachtwerten der Zeile (neues Feld `night`).
- **Kennzahlen** (Plan-Treue) verwenden dieselben Begriffe: Frames ohne Bonus, Transit-Serien nur in der Zeit, nur Aufnahmen dieser Session.
- Beide Reiter zeigen die Erklärung „Soll = erster Plan dieser Session (ohne Bonus), Ist = Aufnahmen dieser Session“.
- Der Nachtbericht nach Discord zeigt bei Transit-Serien nur die Anzahl ohne Soll.
- Vertrag `NightSessionLineRow`: neu sind `plannedSeries`, `plannedLater` und `night` (Nachtwerte für die Korrektur). `rejectedIndividual` und `rejectedCorrection` stehen jetzt unter `night`. OpenAPI und Web-Typen sind neu erzeugt.
- Tests:
  - Repository/API: zwei Sessions einer Nacht mit Bonus, später eingeplantem Projekt, Transit-Serie und Korrektur-Überhang.
  - Unit: `plannedByLine`, `correctionShare` und Plan-Treue.
  - Web: Serie, „später eingeplant“, Erklärung, Korrektur mit Nachtwerten.
