# AP-16d – Plugin Adapter: Trigger-Walk, Filter und Auslesemodus, Neuplanung im Block

**Release:** RP · **Größe:** M · **Abhängigkeiten:** AP-16c · **Menschliche Aufgaben:** H-15

## Ziel
Trigger-Walk über alle Vorfahren, Filter- und Auslesemodus-Auflösung und die Neuplanung im laufenden Block sind integriert. Damit läuft eine Nacht mit fremden Triggern (Autofokus, Flip, Zentrieren) korrekt.

## Anforderungen
FA-NIN-05, FA-NIN-27, FA-SYN-03

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §3.2, §4.3–4.4
- FK 8.6 (Filterzuordnung), FA-RIG-14
- ops/plugin-test-protocol.md P-06, P-15, P-19, P-28, P-32
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `TriggerWalker`: Trigger aller Vorfahren über die **eigene Iteration** (`GetTriggersSnapshot` + Filter, Dither unterdrückt; nie `SequenceContainer.RunTriggers`/`RunTriggersAfter`, die alles-oder-nichts sind, M1) über **alle** Vorfahren-Container, Koordinaten-Injektion (`AttachNewParent`, `CenterAfterDriftTrigger`), Trigger-Sets vor/nach Belichtung; Filterung einzelner Trigger **immer** selbst über `GetTriggersSnapshot()` jedes Vorfahren (Transit-Allowlist in AP-44): Trigger mit `dither` im Typnamen werden in regulären Blöcken und im Transit **immer** unterdrückt, das Dithern steuert nur der Plan; beim Planaufbau einmal `warning` `nina_dither_trigger_present` (NT-23)
- **`FilterResolver` (NT-E1):** belichtet nur über den bestätigten `ninaFilterName` aus `targets`, **exakter** Vergleich (ordinal) mit `FilterInfo.Name` im NINA-Profil; `null` oder fehlender Name → Belichtungen der Zeile überspringen, Ereignis `filter_not_found` (Hinweis höchstens 1×/12 h je Filter), beim Planaufbau `warning` `filter_wheel_changed`, wenn ein Name im Profil fehlt; OSC ohne Filterrad ohne Filterwechsel; dieselbe Regel für Flats. Die frühere Laufzeit-Heuristik `FilterMatcher` entfällt
- **Auslesemodus (NT-37):** Name → Index über `ReadoutModes` (exakt, ohne Groß-/Kleinschreibung), gesetzt mit `SetReadoutModeForNormalImages` (wirkt in NINA dauerhaft); Name nicht gefunden → Belichtung überspringen, `readout_mode_not_found` – außer die Kamera meldet genau einen Modus; **kein** Rückfall auf `readoutModeIndex`
- Integration der `ReplanPolicy` in den Container: vor jedem Block und alle 15 min im Block, Fälle a/b/c, neuer Blockindex, kein Slew bei gleichem Panel

## Nicht im Umfang
- Aufnahme-Meldung/Heartbeat (AP-16e)

## Automatisierte Abnahme
- [ ] `FilterResolver`-Tabellentests aus `execution.md` §4.4 (exakter Treffer; „Ha“ gegen Profil „Ha 3nm“ → nicht gefunden; abweichende Groß-/Kleinschreibung → nicht gefunden; `null` → nicht gefunden; OSC ohne Filterrad → Belichtung ohne Wechsel)
- [ ] Auslesemodus: Name fehlt → übersprungen; genau ein Modus → dieser; nie über den Index
- [ ] TriggerWalker: `DitherAfterExposures` wird in regulären Blöcken und im Transit nie ausgeführt
- [ ] ReplanPolicy-Integrationstest mit NINA-Mocks (a/c und „keine Änderung → kein neuer Plan“)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-06, P-15, P-19, P-28 (globaler Dither-Trigger), P-32 (Filterrad umgesteckt)
