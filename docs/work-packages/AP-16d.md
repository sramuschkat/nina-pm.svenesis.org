# AP-16d – Plugin Adapter: Trigger-Walk, Filter und Auslesemodus, Neuplanung im Block

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-16c · **Menschliche Aufgaben:** H-15

## Ziel
Trigger-Walk über alle Vorfahren, Filter- und Auslesemodus-Auflösung und die Neuplanung im laufenden Block sind integriert. Damit läuft eine Nacht mit fremden Triggern (Autofokus, Flip, Zentrieren) korrekt.

## Anforderungen
FA-NIN-05, FA-NIN-27, FA-SYN-03

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §3.2, §4.3–4.4
- FK 8.6 (FilterMatcher), FA-NIN-27
- ops/plugin-test-protocol.md P-06, P-15, P-19
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `TriggerWalker`: `RunTriggers`/`RunTriggersAfter` über **alle** Vorfahren-Container, Koordinaten-Injektion (`AttachNewParent`, `CenterAfterDriftTrigger`), Trigger-Sets vor/nach Belichtung; Filterung einzelner Trigger über `GetTriggersSnapshot()` (Vorbereitung für den Transit, AP-44)
- FilterMatcher (Normalisierung, exakter Treffer, eindeutiges Präfix beidseitig, nie falscher Filter, Hinweis 1×/12 h, auch für Flats)
- Auslesemodus Name → Index (`SetReadoutModeForNormalImages`), Fallback Index, `readout_mode_not_found`
- Integration der `ReplanPolicy` in den Container: vor jedem Block und alle 15 min im Block, Fälle a/b/c, neuer Blockindex, kein Slew bei gleichem Panel

## Nicht im Umfang
- Aufnahme-Meldung/Heartbeat (AP-16e)

## Automatisierte Abnahme
- [ ] FilterMatcher-Tabellentests (Kern)
- [ ] ReplanPolicy-Integrationstest mit NINA-Mocks (a/c und „keine Änderung → kein neuer Plan“)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-06, P-15, P-19
