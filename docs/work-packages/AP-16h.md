# AP-16h – Plugin: Live-Status, Zielbrowser, Trigger-Sets, Anweisungskatalog

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-16g · **Menschliche Aufgaben:** H-12b, H-15

## Ziel
Das Plugin zeigt Live-Status, Zielbrowser und Trigger-Sets und wird als Release-ZIP mit Beispielsequenzen ausgeliefert. Damit ist das Plugin R1 fertig.

## Anforderungen
FA-NIN-02, FA-NIN-13, FA-NIN-16, FA-NIN-25, FA-NIN-26

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §1, §9
- FK 6.9, 15.1
- TK 10.2
- ops/plugin-test-protocol.md P-11, P-24
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Live-Status-Kopf mit Blockliste (Zustand `blocked` mit Grund, Outbox- und Dead-Letter-Zähler), Zielbrowser mit „In Framing-Assistent laden“ (Reflection-Muster Astro PM), Trigger-Sets vor/nach Belichtung und Zielwechsel, Anweisung *Warten auf Zeit*, Anweisungskatalog R1, rotes Banner *Testbetrieb – Sicherheitsprüfungen aus* (§9), Release-ZIP + Beispielsequenzen nach `downloads/`

## Nicht im Umfang
- Flats (AP-50), Simulator im Plugin (AP-53)

## Automatisierte Abnahme
- [ ] Build + signiertes ZIP in CI, Manifest-Version = Tag `plugin-v*`
- [ ] UI-Logik-Tests: Blockliste aus dem Plan, `blocked`-Anzeige je Grund, Zähler aus der Outbox
- [ ] Zielbrowser-Test mit NINA-Mock (Framing-Assistent erhält Koordinaten und Positionswinkel)
- [ ] *Warten auf Zeit*: Tabellentests für Uhrzeit, Dämmerungsquelle und Versatz (±30 s)
- [ ] Dreifachsperre des Testbetriebs (Schalter + private URL + Header) als Tabellentest – zwei von drei Bedingungen lassen die Prüfungen **an**
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-11, P-24
