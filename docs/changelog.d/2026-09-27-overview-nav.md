### Übersicht – eigener Menüpunkt, ohne „Wetter heute Nacht“ (2026-09-27)

Anforderungen: S-01 · Wunsch Sven 27.09.2026

- **Navigation:** „Übersicht“ steht als eigener Menüpunkt ganz oben (Symbol `layout-dashboard`, Ziel `/`). Er ist nur auf der Startseite aktiv, nicht auf jeder Seite. Bisher war die Übersicht nur über das Logo erreichbar.
- **Übersicht:** Die Karte „Wetter heute Nacht“ entfällt; das Wetter der Nacht steht unter „Heute Nacht“ („Nacht im Detail“). Die Karten sind neu verteilt: links „Aktive Projekte“, rechts „Warteschlange“ und „Letzte Sessions“. Die Kennzahl „Nächste gute Nacht“ bleibt.
- Tests: Shell (Menüpunkt, aktiv nur auf `/`), Übersicht, E2E.
