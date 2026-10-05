### NINA-Plugin 0.4.5: Zurücksetzen beendet den laufenden Block

- **Vorher:** Ein Reset (Befehl `reset_plan` aus dem Web oder Knopf im Container) wartete bis zum Ende des laufenden Blocks. Lief der Block bis zum Nachtende, wurde der Reset in dieser Nacht nie wirksam (VM-Lauf `real-commands`, 05.10.2026).
- **Jetzt** (Entscheidung Sven 05.10.2026): Der laufende Block endet nach der aktuellen Belichtung mit `block_end` `replanned`. Danach holt das Plugin sofort den Plan mit `reason: reset`. Spec-Ergänzung `docs/specs/nina/execution.md` §3.2 und §4.1.
