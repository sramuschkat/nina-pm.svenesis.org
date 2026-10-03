### AP-16h – Oberfläche und Beispielsequenzen ohne VM geprüft

- **Render-Tests (Windows-CI):** Live-Status-Kopf (Testbetrieb mit rotem Banner, gesperrt mit Grund, „Heutige Ziele“ aufgeklappt) und Optionsseite mit Zielbrowser werden mit Testdaten gerendert. Die Bilder liegen im CI-Artefakt `nina-pm-render`, und jeder Binding-Fehler lässt den Test scheitern.
- **Beispielsequenzen gegen NINAs Typen:** Jeder `$type` und jede Eigenschaft in `one-night-safety.json` und `one-night.json` muss in NINA 3.2 bzw. im Plugin existieren.
- Live-Status als eigene Vorlage `NinaPm.LiveStatus`, damit er sich ohne NINAs Sequenzansicht rendern lässt.
