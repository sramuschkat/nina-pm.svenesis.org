### Heute Nacht – Kennzahlen, Zeitleiste der Nacht, neue Anordnung (2026-09-28)

Anforderungen: S-02, FA-FOL-06 · Entwurf und Freigabe Sven 27./28.09.2026 (Punkte 1–5)

- **Kopf:** Rig-Auswahl, Standort und Nacht, dazu eine Einschätzung mit Countdown („Gut 72 % · dunkel in 2 h 13 min“, „dunkel bis 05:24“, „Dunkelheit vorbei“), eingefärbt nach Wetterklasse.
- **Vier Kennzahlen** – die Zahlen der Nacht stehen nur hier:
  - Dunkel: Stunden und Zeiten.
  - Mond: Symbol, Beleuchtung, Auf-/Untergang, größte Höhe.
  - Wetter: Klasse und bestes Fenster.
  - Plan: Projekte und Frames aus dem Nachtplan, dazu der letzte Kontakt von NINA.
- **Zeitleiste der Nacht** auf einer gemeinsamen Achse mit roter Linie „jetzt“; ersetzt den Streifen „Mond und Dunkelheit“ und das Farbband. Oben die Stunden in Rig-Zeit („Standort CDT“), darunter die Zeit des Users („Bei dir MESZ“), wenn sie abweicht (Wunsch Sven 28.09.2026). Spuren:
  - Himmel (Dämmerung).
  - Wetter (Gesamtnote je Stunde).
  - Mond (über dem Horizont, größte Höhe).
  - **Plan:** Projektblöcke, Meridianflips und Flats aus der Simulation im Browser – gleiche Rechnung wie der Simulator, neuer Hook `useNightPlan`.
  - Filter (Filter und Anzahl).
  - Ereignisse (Milchstraßenzentrum, ISS-Überflüge).
  - Neuer Baustein `NightTimeline` (components.md §2.21).
- **Direkt unter der Zeitleiste, eingeklappt:** „Nachtwetter im Detail“ (Stundentabelle aus Astro-Wetter) und die Sichtbarkeit von Mond und Planeten (Nachtrag 28.09.2026: umbenannt und nach oben gezogen, das kleine Fenster „Mond & Planeten“ entfällt).
- **Zwei Spalten:** links „Plan für diese Nacht“ (Projekte aus der Prognose, „nur heute aus“, Safety-Link im Kopf), rechts „Ereignisse der Nacht“.
- Die Seite ist bei 1.400 px etwa ein Drittel kürzer (1.360 statt 2.080 px). Himmel, Mond, Planeten und Ereignisse werden einmal gerechnet und geteilt (`night-sky.ts`).
- **Tests:** Seite (Kopf, Kennzahlen, Zeitleiste, Reihenfolge, Einklappen), `NightTimeline` (Lage der Abschnitte, Marken, Linie „jetzt“, Textalternative, axe), E2E.
