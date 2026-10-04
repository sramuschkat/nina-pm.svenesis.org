### VM-Prüfstand: Transit-Läufe P-14, P-15b, P-27 mit echtem NINA (AP-44)

- **Neue Läufe** `vm-transit` (P-14), `vm-replan-transit` (P-15b) und `vm-transit-flip` (P-27), je mit Sim-Gegenstück in `tools/nina-sim/runs/` und benannten Prüfungen.
- **Test-Server-Aktionen im Lauf:** Ein Schritt mit `server: <Aktion>` löst sie aus (z. B. `lock_transit` in P-15b).
- **Vorabprüfungen:** OmniSim muss erreichbar sein; 75 s nach Sequenzstart bricht der Lauf bei `clock_skew` ab (VM-Uhr falsch).
- **Log:** Der Prüfstand sammelt das NINA-Log ab dem eigenen NINA-Neustart ein und kürzt `nina.log` auf diese Zeilen (VM-Ortszeit aus dem Log); das ungekürzte Log bleibt als `nina-full.log`.
- **Doku** `docs/ops/vm-bench.md`: was vor jedem Lauf in der VM laufen muss (Programme, Uhr per w32time, Simulatoren erst nach korrekter Uhr starten).
- **Protokolle** `docs/test-runs/2026-10-04/P-14`, `P-15b`, `P-27`: alle Go.
