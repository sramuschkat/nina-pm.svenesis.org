### VM-Prüfstand: Safety ohne Handgriff, vm-smoke, früheres Laufende

- **Safety-Monitor im Lauf steuerbar:**
  - `safe: true|false` setzt über die Simulator-Schnittstelle von OmniSim (`PUT /simulator/v1/safetymonitor/0/issafesetting`), was der Monitor meldet; er bleibt verbunden.
  - `monitor: connect|disconnect` trennt und verbindet ihn über die Advanced API (Fall „Monitor verloren“).
  - Vor jedem Lauf wird OmniSim auf sicher gesetzt.
- **Prüfstand-Sequenz:** optional NINAs globaler Trigger *Dither after Exposures*.
- **Neuer Lauf `vm-smoke`** (Kühlung ab Minute 5, Safety-Pause von Minute 13,3 bis 15): alle Prüfungen grün (`docs/test-runs/2026-10-03/vm-smoke-bench/`).
- **Laufende:** Ein Lauf endet 60 s, nachdem die Session abgeschlossen ist; `untilMin` ist nur noch die Obergrenze.
