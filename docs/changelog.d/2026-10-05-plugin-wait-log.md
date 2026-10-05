### NINA-Plugin 0.4.2: `WAIT_PLAN` im Log

- Wartet das Plugin im zeitgeführten Ablauf 30 s oder länger auf den geplanten Zeitpunkt der nächsten Belichtung, steht jetzt eine Zeile im Log: `WAIT_PLAN block=… untilUtc=… durationS=…`. Das passiert, wenn das Plugin schneller als geplant ist, etwa weil NINA an einem eingeplanten Autofokus keinen ausgelöst hat.
- Vorher sah so ein Block im Log minutenlang untätig aus (VM-Lauf gegen den echten Server, 05.10.2026: 4½ min zwischen Blockstart und erster Belichtung). Belichtungen gehen dabei nicht verloren; die Wartezeit liegt nur vor statt nach ihnen.
- Log-Grammatik (`plugin-test-protocol.md`) und `test-run-check` kennen das neue Ereignis. Die Spec-Ergänzung steht in `execution.md` §4.2.
