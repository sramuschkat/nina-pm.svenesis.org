### AP-16h – VM-Termin auf das Nötige verkürzt (Beispielsequenz in NINA, vm-flip)

- `docs/ops/plugin-test-protocol.md`: Abschnitt *VM-Termin AP-16h* (≈ 40 min) – Beispielsequenz in NINA laden, Testkopie ohne Warten/Autofokus, `vm-flip`. Live-Status und Optionsseite prüfen die Render-Tests der CI; P-11 folgt in der Plugin-Nacht P-05 gegen prod.
- `tools/nina-sim/runs/vm-flip.json`: vmOnly-Prüfung der Sequenzvorlage (genau ein `sequence_template_deviation` mit `start_wait_missing,start_autofocus_missing`, kein `safety_monitor_not_connected`).
