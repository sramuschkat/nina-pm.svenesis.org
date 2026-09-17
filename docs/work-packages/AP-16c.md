# AP-16c – Plugin Adapter: Container, interne Items, Blockablauf

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-16b, AP-14b · **Menschliche Aufgaben:** H-14, H-15

## Ziel
Der NINA-Container führt Blöcke nach dem Astro-PM-Muster aus: ein Block je Aufruf, Slew/Zentrieren mit Wiederholungsleiter, interne Belichtungselemente und die Tabelle Eintrag → Aktion. Gesperrte Zustände warten, statt in eine Dauerschleife zu laufen.

## Anforderungen
FA-NIN-05…12

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §1–2, §4.1–4.2
- TK 10.2–10.3 Nr. 4, 7
- ADR-S2b
- ops/plugin-test-protocol.md P-05
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `NinaPmContainer` nach Astro-PM-Muster (überschriebenes `Execute`, ein Block je Aufruf, Platzhalter-Kind, 5-min-Sperre, Nacht-Schlüssel aus Bootstrap, Zustand `blocked{reason}` mit 60-s-Warten)
- interne Items: Slew/Center mit Wiederholungsleiter, Guiding, Dither, `TakeExposureItem` mit `IExposureItem`/`GetEstimatedDuration`
- Tabelle Eintrag → Aktion (§4.2) inkl. `wait`/`end`/`autofocus_hint`, Blockende-Regel mit Überhang (A-30), Playback sequenziell
- Nightly Loop mit den drei Zeitmarken, Beispielsequenz „Eine Nacht mit Safety“
- Portierter Code mit Herkunftskommentar (Datei/Commit)

## Nicht im Umfang
- Trigger-Walk und Filterauflösung (AP-16d), Aufnahme-Meldung (AP-16e)

## Automatisierte Abnahme
- [ ] Adapter-Unit-Tests mit NINA-Mocks auf windows-latest
- [ ] Kern-Test: `blocked` wartet 60 s statt sofort zurückzukehren
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-05
