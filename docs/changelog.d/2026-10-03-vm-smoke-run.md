### Plugin: VM-Kurzlauf vom 03.10.2026 grün

- `docs/test-runs/2026-10-03/vm-smoke`: alle sieben Prüfungen gegen echtes NINA grün (Profil im Heartbeat, ImageSaved mit Messwerten, Dither-Trigger unterdrückt, Kühlung, Safety, Nachtende, keine abgelehnte Anfrage).
- Prüfung „Heartbeat liest das Profil“ liest die Kameratemperatur statt „Kühler an“ (der letzte Heartbeat kommt nach „Warm Camera“ im Ende-Bereich); neue Prüfoption `exists` in `tools/nina-sim`.
