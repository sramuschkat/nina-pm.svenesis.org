### AP-16h – VM-Termin vorbereitet (Beispielsequenzen, vm-flip, Live-Status, P-11)

- `docs/ops/plugin-test-protocol.md`: Abschnitt *VM-Termin AP-16h* mit Beispielsequenzen in NINA neu speichern, `vm-flip` mit Testkopie, Live-Status- und Zielbrowser-Prüfung, P-11 gegen prod (Kamera getrennt) und Betriebs-Teil der Optionsseite.
- `tools/nina-sim/runs/vm-flip.json`: vmOnly-Prüfung der Sequenzvorlage (genau ein `sequence_template_deviation` mit den drei erwarteten Hinweisen der Testkopie, kein `safety_monitor_not_connected`).
