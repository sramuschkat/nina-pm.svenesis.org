### NINA-Plugin 0.4.6: Neuplanung zählt die letzte Belichtung, Wartezeiten unterbrechbar (2026-10-05)

Anforderungen: FA-SYN-03, FA-NIN-12, NT-15 (execution.md §3.2, §4.2, §5; Analyse VM-Lauf `real-night-flats` 05.10.2026)

- Vor jeder Neuplanung (außer `initial`) wartet das Plugin höchstens 15 s, bis NINA die belichteten Lights gespeichert hat; die gerade beendete Aufnahme zählt dann in `pendingCaptures`. Vorher plante der Server für eine eben fertige Zeile noch eine Aufnahme (Block mit 309 s Warten, dann `target_removed`).
- Warten auf den geplanten Zeitpunkt (`WAIT_PLAN`) und `wait`-Einträge laufen im 10-s-Takt: Zurücksetzen, Überspringen und `lease_lost` wirken sofort; ein neues targets-ETag wird sofort geprüft (höchstens einmal je Minute); ein festgelegter Transit beendet den Block vor statt nach der Wartezeit.
- Regressionstest: eine laufende Belichtung endet auch, wenn während ihr ein Transit festgelegt wird (Spec-Ergänzung 04.10.2026); veralteter Kommentar zu `CancelKind.Own` korrigiert.
