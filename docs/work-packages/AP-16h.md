# AP-16h – Plugin: Live-Status, Zielbrowser, Trigger-Sets, Anweisungskatalog

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-16g · **Menschliche Aufgaben:** H-12b, H-15

## Ziel
Das Plugin zeigt Live-Status, Zielbrowser und Trigger-Sets und wird als Release-ZIP mit Beispielsequenzen ausgeliefert. Damit ist das Plugin R1 fertig.

## Anforderungen
FA-NIN-02, FA-NIN-13, FA-NIN-16, FA-NIN-25

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §1 (Sequenzvorlage NT-44), §2 (blocked-Gründe und Austrittsregeln), §9
- specs/engine/geometry.md §2.1 (Panel-Nummerierung NT-32)
- FK 6.9, 15.1
- TK 10.2, 10.3 (Sequenzvorlage), 10.5
- ops/plugin-test-protocol.md P-11
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Alle Ansichten liegen in `NinaPm.Nina.Ui` (WPF), die Logik dahinter in `NinaPm.Core`; `NinaPm.Nina` bleibt ohne XAML (TK 10.5)
- Live-Status-Kopf mit Blockliste (Zustand `blocked` mit Grund, Outbox- und Dead-Letter-Zähler), Zielbrowser mit „In Framing-Assistent laden“ (Reflection-Muster Astro PM; Mosaik-Panels mit NINAs Framing-Nummerierung – Panel 1 = oben links = Nordost, `geometry.md` §2.1, NT-32), Trigger-Sets vor/nach Belichtung und Zielwechsel, Anweisungskatalog R1 (die Anweisung *Warten auf Zeit* ist **R5** und kommt in AP-52, FA-NIN-26), rotes Banner *Testbetrieb – Sicherheitsprüfungen aus* (§9), Release-ZIP und Beispielsequenzen als GitHub-Release-Asset; die Sequenzdateien liegen im Repository und kommen über das `BucketDeployment` aus AP-16a nach `downloads/nina-sequences/`
- **`SequenceInspector` mit der Sequenzvorlage (`execution.md` §1, NT-44):** prüft beim Laden und vor dem ersten Block den Start-Bereich **in dieser Reihenfolge** (Warten auf Sonnenhöhe, **danach** Unpark, Cool Camera, Autofokus einmal je Nacht vor dem ersten Ziel – NT-24, H3), den Zielcontainer mit *NINA-PM Nachtschleife* + *Loop While Safe*, Trigger *Meridian Flip* und *Autofokus nach Zeit* mit `Amount = afEveryMin` (M7), **keinen** Dither-Trigger, den Sicherungscontainer mit *Loop While Unsafe* + *NINA-PM Nachtschleife* und *NINA-PM Warten bis sicher oder Nachtende* statt *Wait until Safe* (H2) und den Ende-Bereich; Abweichungen als Hinweis (kein Abbruch) und einmal je Nacht `warning` `sequence_template_deviation`; Safety-Bedingungen ohne verbundenen Safety-Monitor → `warning` `safety_monitor_not_connected`; die Beispielsequenzen „Eine Nacht mit Safety“ und „Eine Nacht ohne Safety“ folgen der Liste

## Nicht im Umfang
- Flats (AP-50), Simulator im Plugin (AP-53)

## Automatisierte Abnahme
- [ ] Build + signiertes ZIP in CI, Manifest-Version = Tag `plugin-v*`
- [ ] UI-Logik-Tests: Blockliste aus dem Plan, `blocked`-Anzeige je Grund, Zähler aus der Outbox
- [ ] Zielbrowser-Test mit NINA-Mock (Framing-Assistent erhält Koordinaten und Positionswinkel; 2×2-Mosaik: Panel 1 = `(i, j) = (1, 0)`, Nordost)
- [ ] SequenceInspector-Tabellentest gegen die Vorlage: fehlender *Loop While Safe*, vorhandener Dither-Trigger, fehlender Autofokus im Start-Bereich, *Unpark* vor dem Warten (H3), *Wait until Safe* im Sicherungscontainer (H2), fehlender *Autofokus nach Zeit* (M7) → je ein Hinweis; Safety-Bedingungen ohne verbundenen Monitor → `safety_monitor_not_connected`; die mitgelieferten Beispielsequenzen → kein Hinweis
- [ ] Dreifachsperre des Testbetriebs (Schalter + private URL + Header) als Tabellentest – zwei von drei Bedingungen lassen die Prüfungen **an**
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-11
