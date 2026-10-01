### AP-16a: Optionsseite – Token-Eingabe, Testbetrieb-Schalter, Schaltflächen (2026-10-01)

Anforderungen: AP-16a, FA-NIN-01, SV-08 · Befund P-04 (Sven, Windows-VM gegen den Test-Server)

- Das Sync-Token aus der PasswordBox kam nie im Plugin an („Server-URL und Token eintragen.“): die Bindung meldete sich erst bei einer Änderung der gebundenen Eigenschaft an, die beim Öffnen leer ist und bleibt. Jetzt eigener Schalter `PasswordBoxBinding.Attach`; drei Adapter-Tests (Windows).
- Testbetrieb: NINAs Stil zeigt die CheckBox als Schalter ohne Text – Beschriftung „Testbetrieb“ jetzt links, Hinweis „nur mit lokalem Test-Server“ daneben.
- Schaltflächen mit NINAs `ButtonForegroundBrush` (vorher schwarze Schrift auf dunklem Grund).
- CLAUDE.md: Aufruf von `tools/nina-build-check.sh` mit `--allow` und Release-Build.
