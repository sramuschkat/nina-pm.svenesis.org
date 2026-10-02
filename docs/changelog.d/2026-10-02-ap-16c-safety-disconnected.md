### AP-16c – Getrennter Safety-Monitor: Warten statt Park/Unpark im Takt

- *NINA-PM Wait until Safe or Night End* behandelt einen getrennten Safety-Monitor wie „unsicher“: die Montierung bleibt geparkt, gewartet wird bis verbunden **und** sicher, höchstens bis zum Nachtende (dann Abschluss der Nacht); Warnung `safety_monitor_not_connected` einmal je Wartephase. Vorher kehrte die Anweisung sofort zurück, und NINA parkte und entparkte im Takt (P-25-Lauf 02.10.2026: 13 × Park in 2,5 min). Brief AP-16c, `execution.md` §4.6, P-25 angepasst (Entscheidung Sven).
