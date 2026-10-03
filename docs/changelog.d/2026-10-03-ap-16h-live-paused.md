### AP-16h – Live-Status „Pausiert – unsicher“ während der Safety-Pause

Anforderungen: FA-NIN-13; execution.md §4.6

- Der Live-Status im Container zeigt während einer Safety-Unterbrechung **„Pausiert – unsicher“ / „Paused – unsafe“** statt „Warten“, aus demselben Zustand wie der Heartbeat `paused`. Ein gesperrter Zustand geht vor.
- Befund aus dem VM-Prüfstand (`vm-smoke`, 03.10.2026); mit dem Prüfstand im echten NINA bestätigt (`docs/test-runs/2026-10-03/vm-smoke-paused/`).
