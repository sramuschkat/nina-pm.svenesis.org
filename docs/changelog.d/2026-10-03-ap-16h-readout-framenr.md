### Plugin: Auslesemodus vor dem Slew, Bildnummern (AP-16h, P-05 prod)
- Block, in dem keine Belichtungszeile mit gefundenem Filter einen Auslesemodus hat, den die Kamera kennt, wird sofort mit `BLOCK_SKIPPED reason=readout_mode_not_found` übersprungen (execution.md §4.1 Nr. 1, neuer Wert in `blockSkipReasons`) – statt bis zum Blockende zu guiden und zu dithern, ohne zu belichten.
- Bildnummer `$$FRAMENR$$` im Dateinamen zählt je Ziel und Filter wie bei NINAs eigener Belichtung (vorher immer `0000`).
