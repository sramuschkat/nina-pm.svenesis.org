### Web: „Heute Nacht abgearbeitet“ ausgegraut statt verschwunden; laufender Block älterer Plugins (2026-10-07)

Anforderungen: FA-SIM-03, FA-SIM-10, FA-NIN-22; Rig-Nacht 06./07.10.2026 (WASP-3b, IC 1795, Plugin 0.4.10)

- **Heute Nacht abgearbeitet, alle Projektarten.** Ein Projekt, das in der laufenden Nacht belichtet wurde und danach nicht mehr ansteht (fertig, pausiert, Transit vorbei), bleibt sichtbar. Es steht ausgegraut mit Anzahl der Aufnahmen und Zeitraum an drei Stellen:
  - Simulator: eigene Zielkarte nach den geplanten, statt unter „Nicht zugeteilt“ mit „kein festgelegter Transit in dieser Nacht“.
  - „Heute Nacht“: Zeile in „Plan für diese Nacht“.
  - „An NINA ausgeliefert“: Karte mit neuem Feld `doneTonight` (`acquired`, `untilUtc`) aus den gespeicherten Lights der Nacht, ohne Entfernen-Knopf. NINA erhält das Projekt weiterhin nicht (`targets` unverändert).
- **Laufender Block bei Plugin vor 0.4.13.** Diese Plugins melden keinen Blockstart. Der aus den Aufnahmen abgeleitete Block galt deshalb sofort als beendet, und das Web blendete den Rest des gespeicherten Plans aus. Am Rig fehlte so ab 05:00 IC 1795 SII ×6, obwohl das Plugin daran arbeitete. Jetzt zählt der zuletzt begonnene Block als laufend, solange die Session läuft und es in den letzten 30 min Aktivität gab – wie bei gemeldeten Blöcken.
