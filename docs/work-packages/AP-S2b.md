# AP-S2b – Spike NINA-Laufzeit: Stellen ohne Vorbild prüfen (Mensch + Agent)

**Release:** R1 · **Größe:** S · **Abhängigkeiten:** AP-01 · **Menschliche Aufgaben:** H-14, H-15

## Ziel
Früh klären, ob die NINA-Stellen ohne Vorbild im Astro-PM-Plugin (Bildzuordnung für Lights, Flip-Erkennung, Trigger-Filter, Belichtungsabbruch, Auslesemodus) mit der aktuellen NINA-Version funktionieren. Ergebnis ist ein ADR mit Go/No-Go, kein Produktivcode.

## Anforderungen
TK 10.1, 10.3, OT-08

## Lesen (nur diese Abschnitte)
- specs/nina/execution.md §2, §4.3, §4.5, §5
- TK 10.1–10.3
- ops/plugin-test-protocol.md P-01…P-03, P-13
- history/Analyse_AstroPM_NINA_Plugin_2026-09-17.md §5
- docs/adr/ADR-TEMPLATE.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Probe-Plugin (`spikes/nina-probe`) mit den Astro-PM-Mustern (Container mit überschriebenem `Execute`, Trigger-Walk, `AttachNewParent`, `IExposureItem`) **und** den neuen Stellen: Zuordnung `Image.Id` → captureId vor `Enqueue` für Lights (inkl. 120-s-Timeout), Flip-Werte aus dem Profil lesen und Flip über Pier-Seite erkennen, Trigger-Filter nach Typ (Autofokus unterdrücken), eigener Abbruch-Token für Belichtungen, Auslesemodus per Name → Index setzen
- Anleitung für Sven (Schritte, erwartete Log-Zeilen `NINA-PM | …`)
- **`tools/test-run-check` (CC5-11)** – hier geliefert, weil P-01…P-03 und P-13 es schon brauchen: prüft `result.json` gegen das Schema aus `ops/plugin-test-protocol.md` (inkl. `steps`-Anzahl je Protokoll) und das Log gegen `expectations.json`, schreibt `logCheck` zurück; CLI `pnpm test-run:check <ordner>`
- Auswertung → `docs/adr/ADR-S2b-nina.md` (Vorlage ADR-TEMPLATE); Bestätigung Positionswinkel-Konvention **und der Autofokus-Triggertypnamen** (NIN5-3)

## Nicht im Umfang
- Produktiv-Plugin; keine Suche nach Alternativen, solange die Muster funktionieren

## Automatisierte Abnahme
- [ ] `dotnet build` auf windows-latest grün
- [ ] Log-Grammatik `NINA-PM | EVENT key=value` mit den Schlüsselnamen aus `ops/plugin-test-protocol.md` in der Probe umgesetzt
- [ ] `pnpm test-run:check` läuft gegen ein Beispielverzeichnis und meldet fehlende Ereignisse
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
P-01…P-03 und P-13 durchführen (H-14, H-15), Go/No-Go
