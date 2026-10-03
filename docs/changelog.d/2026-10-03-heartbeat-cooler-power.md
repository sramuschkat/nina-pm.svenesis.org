### Plugin: Heartbeat mit negativer Kühlerleistung

- Die Sky-Simulator-Kamera meldet die Kühlerleistung als negativen Wert; der Heartbeat sandte ihn, der Server lehnte jeden Heartbeat mit `422` ab (`camera.coolerPowerPct` 0–100). Werte außerhalb 0–100 oder NaN entfallen jetzt (VM-Lauf 03.10.2026).
- VM-Kurzlauf: vor jedem Lauf mit frisch gestartetem Test-Server `ninapm.db` löschen (Anleitung in `ops/plugin-test-protocol.md`).
