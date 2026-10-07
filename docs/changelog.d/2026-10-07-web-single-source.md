### Web: laufende Nacht aus gespeichertem Plan + Ist, „Heute Nacht“ ab jetzt (2026-10-07)

Anforderungen: FA-SIM-03, FA-SIM-05, FA-SIM-06, FA-SIM-10, FA-FOL-06, NT-01, NT-03; Analyse 07.10.2026, Entscheidung Sven 07.10.2026

- **Eine Quelle für die laufende Nacht.** Hat die Rig für die laufende Nacht einen gespeicherten Serverplan, zeigt das Web, was sie tatsächlich ausführt: offener Rest der letzten Revision plus Ist. Das gilt im Simulator für Zielkarten, „Nicht zugeteilt“, Kopfzahlen (Ziele · Frames) und Flip-Marken, auf „Heute Nacht“ für die Tabelle „Plan für diese Nacht“ und die Kennzahl „Plan“.
  - Zustände: *läuft an der Rig* (der jetzt laufende Block), *geplant* (späterer Block), *abgearbeitet* (Ist ohne offenen Block), *nicht zugeteilt* (weder offen geplant noch belichtet; die Gründe stammen aus der Rechnung ab jetzt und sind so beschriftet).
  - Beendete und übersprungene Blöcke bleiben nicht mehr „geplant“: `block_end` (auch leer), `block_skipped` und Blöcke vor dem zuletzt begonnenen Ist-Block. `GET /web/v1/simulations/input` liefert dazu neu `endedBlockIds` (additiv, Plugin-Vertrag unverändert).
  - Die Rechnung ab jetzt gilt nur noch für Was-wäre-wenn (eigene Entwürfe) und für Nächte ohne gespeicherten Plan. Den Plan der Rig speichert der Simulator nicht noch einmal.
- **„Heute Nacht“ rechnet ab jetzt.** Die laufende Nacht wird wie im Simulator ab „jetzt“ gerechnet, nicht mehr ab der Dämmerung. Es gibt keine Frames mehr für vergangene Fenster.
- **Ist und Plan ohne Rechnung.** Zeitleiste und Kennzahl zeigen Ist und gespeicherten Plan auch dann, wenn die Rechnung im Browser noch läuft oder scheitert. Der Fehlerhinweis betrifft nur die Rechnung.
- **Auslieferung aus.** Ist „An NINA ausliefern“ für das Rig aus, zeigt „Heute Nacht“ einen Hinweis. Die Frames heißen dann „wenn ausgeliefert“.
- **Kleinere Korrekturen:**
  - „n weitere aktive Projekte ohne Frames“ zählt laufende bzw. abgearbeitete Projekte nicht mehr doppelt.
  - „An NINA ausgeliefert“ zeigt „letzte bis …“ in Standortzeit mit Kürzel (NT-03).
  - Das Planprotokoll nummeriert je Belichtungszeile über die ganze Nacht.
  - Nach Ende des Nachtfensters bleibt die alte Nacht auf „Heute Nacht“ stehen, solange ihre Session läuft (Flats, Rest eines Transits).
- **Ältere Plugins (vor 0.4.13).** Ein aus Aufnahmen abgeleiteter Block beginnt zum geplanten Blockbeginn: höchstens 20 min vor der ersten Aufnahme und nie im vorigen Block. Anfahren und Autofokus stehen so nicht mehr als roter „Leerlauf“ da.
