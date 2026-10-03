# VM-Prüfstand, erster Lauf `vm-flip` – 03.10.2026

Erster Lauf vollständig über den VM-Prüfstand (`pnpm vm-bench run vm-flip`, `docs/ops/vm-bench.md`), ohne Handgriffe in der VM. Plugin aus `plugin`-Lauf 37139500509 (main nach #222). NINA 3.2.0.9001, Advanced API 2.2.15.2, Test-Server `vm-flip` auf dem Mac (Start 17:41:54Z). Auswertung `pnpm plugin:sim --vm`: **alle sieben Prüfungen grün** (`vm-check.txt`).

## Ablauf (vom Mac gesteuert)
- Agent: NINA neu gestartet, `ninapm.db` gelöscht. Prüfstand-Sequenz `nina-pm-bench.json` (Beispielsequenz ohne *Wait for Sun Altitude* und *Run Autofocus*) in NINAs Sequenzordner gelegt.
- Advanced API:
  - Flip-Werte 1/5/0, *Recenter* aus.
  - Geräte nach Rescan mit den IDs aus dem Profil verbunden (Sky Simulator ALPACA: Kamera, Montierung, Filterrad, Rotator; PHD2; OmniSim-Safety).
  - Kühlung −10 °C, Sequenz geladen und gestartet.
- Nach 30 min: Report vom Test-Server; NINA-Log (5 Dateien) über den Agenten zurück.

## Befunde
- Flip 17:52:29Z, Ereignis `flip` **mit `durationS` 92** (Fix aus #221 im echten NINA bestätigt). Danach nur Zentrieren, kein Nachrotieren.
- 20 Aufnahmen: 8 `west`, 12 `east`.
- Genau ein `sequence_template_deviation` mit `start_wait_missing,start_autofocus_missing`.
- Nachtende: Session `completed`, Outbox leer; keine abgelehnte Anfrage, keine Alarme.
- Gelernt beim Aufbau:
  - **NINA 3.2 speichert „deaktiviert“ nicht** (`SequenceItem.Status` ist keine JSON-Eigenschaft). Darum entfernt die Prüfstand-Sequenz die Anweisungen.
  - Alpaca-Geräte kennt NINA nach dem Start erst nach einem Rescan.
  - Der Reiter *Sequencer* zeigt den Advanced Sequencer erst mit `SequenceSettings.DisableSimpleSequencer` nach einem NINA-Neustart. Darum zeigen die Screenshots dieses Laufs noch die Legacy-Seite und liegen nicht hier.
