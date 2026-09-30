### Transitsuche: Baseline fest 60 min je Seite (2026-09-30)

Anforderungen: FA-EXO-19 · transit.md §2 · FK 8.7 · Entscheidung Sven 30.09.2026 nach Abgleich mit Astro PM (Kepler-76b, Starfront, 30.09.)

- Die Baseline je Seite ist jetzt fest 60 min: „Ingress − 1 h bis Egress + 1 h“, der Baseline-Standard von ExoClock und ETD.
  - Bisher war sie dauerabhängig: T14/2, 30 bis 120 min (AST-T13).
  - Bei unsicherer Ephemeride gilt weiter mindestens k·σ.
  - Engine 0.14.0: `DEFAULT_BASELINE_MIN`.
- Das Beobachtungsfenster ist damit bis auf den Unsicherheitspuffer (mindestens 5 min) gleich wie bei Astro PM. Beispiel Kepler-76b: Ingress 22:05, Egress 23:33 → Fenster 21:00–00:38. Astro PM zeigt 21:05–00:33, weil es keinen Puffer rechnet.
- Spec `transit.md` §2/§4 und FK 8.7 nachgezogen.
