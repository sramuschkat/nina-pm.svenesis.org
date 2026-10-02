### AP-16c: abgearbeiteter Block läuft nicht noch einmal (2026-10-02)

Anforderungen: AP-16c, FA-NIN-05, execution.md §2 („nicht in Dauerschleife“) · Befund aus dem zweiten Lauf in NINA (Sven, 02.10.2026)

- Mit der Sky-Simulator-Kamera (ignoriert die Belichtungszeit) war ein 20-min-Block nach 1,5 min abgearbeitet; die Nachtschleife wählte „ersten Block mit `endUtc > now`“ und startete denselben Block erneut – 1703-mal, kurz vor dem Blockende in einer Dauerschleife ohne Belichtung.
- Jetzt läuft jeder Block **höchstens einmal je Plan**: ausgeführte und übersprungene Blöcke stehen in `state.doneBlocks` (mit `nightPlanId`, übersteht Neustarts); danach wartet das Plugin auf den nächsten Block bzw. plant neu (`refresh`). Ein neuer Plan entscheidet neu.
- Unbehandelter Fehler im Block (kein Abbruch): `BLOCK_END reason=error`, `ERROR code=block_failed`, Block erledigt – keine Fehlerschleife über denselben Block.
- Tests: schnelle Kamera, Neustart mit erledigtem Block, Fehler im Block.
