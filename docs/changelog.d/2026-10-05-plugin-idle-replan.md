### NINA-Plugin 0.4.7: Neuplanung ab jetzt, Lücken vor dem nächsten Block werden genutzt (2026-10-05)

Anforderungen: FA-SYN-03 (execution.md §3.2; Analyse VM-Lauf `real-full-night` 05.10.2026, Entscheidung Sven)

- Neuplanung vor einem Block beginnt bei `now` statt beim geplanten Blockstart.
- Liegt der nächste Block nach einem Block dieser Nacht mehr als 5 min in der Zukunft, plant das Plugin einmal je Plan ab jetzt neu (`IdleAhead`). Vorher blieb eine Lücke leer, wenn ein Projekt vor dem Ende seines Laufs fertig war (`idle_gap` der Engine): im VM-Lauf 10 von 40 min, nachgestellt im kopflosen Lauf 23 statt 37 Aufnahmen; mit der Änderung sechsmal 37.
