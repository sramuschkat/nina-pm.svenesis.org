### Web: Ist + Plan rechnet wie das Plugin – Blockende, entfallender Autofokus, Flats (2026-10-10)

Anlass: Rig-Nacht 09./10.10.2026 (LDN 1228). Das Rig lag 5:16 min zurück. Im Web stand G 36 um 02:01:41 mitten im Folgeblock (IC 5146), G 35 lief über das Blockende hinaus.

- **Blockende:** Liegt das Rig zurück, entfallen verschobene Belichtungen, die nicht mehr bis Blockende + 60 s fertig werden (wie `Playback.LateGraceMax` im Plugin). Mit ihnen entfallen Dither und Autofokus danach. Am Blockende steht je Filter eine Zeile „passt nicht mehr in den Block“ mit Anzahl; die Nummern zählen ohne sie weiter.
- **Autofokus:** Ein geplanter Autofokus, der weniger als die Hälfte des Autofokus-Takts nach dem letzten Autofokus der Nacht läge, steht als „entfällt – gerade fokussiert“ da. Seine Dauer geht vom Verzug ab, wie `AF_SKIPPED reason=recent` im Plugin.
- **Flats:** Die Liste zeigt die Flats als eigene Zeile, wie das Plugin-Fenster.
- Betrifft Simulator, Nacht und „Heute“ (`actual-view.ts`). Nur Web: kein Server, kein Plugin, keine Migration.
