# Spezifikation: Sortierkette

Verbindlich für AP-13b. Bezug: FA-SCH-03, Fachkonzept 8.3, `allocation.md` §5. Schlüssel: `contracts/enums.json` → `sortChainKeys`. Grundlage: `ApplySortChain` im Astro-PM-Plugin (Abweichung: zusätzlicher Schlüssel `due_soonest`).

## Verwendung
Die Sortierkette ordnet die **Kandidaten eines Durchlaufs** der proportionalen Strategie (Pass 1a, 1b, 2, 3). Die Reihenfolge wirkt beim Malen (wer zuerst Läufe wählt) und entscheidet im **Knapp-Fall** von `fairShare`, wer seine Mindestzeit bekommt. Bei manueller Priorität wirkt nur die Prioritätsreihenfolge.

- `sortChain` = `rig.sort_chain` (geordnete Liste, jeder Schlüssel höchstens einmal).
- Mond-unten-Durchläufe (1a, 1b) nutzen `moonDownChain = [most_moon_limited] + sortChain ohne most_moon_limited`.
- Sortierung **stabil** nach den Schlüsseln der Reihe nach; letzter Tie-Break: Matrix-Reihenfolge der Einheiten (produktiv Projekt-ID, Panel-Index; Kompatibilität Grid-Reihenfolge).
- Metriken werden **zum Zeitpunkt des Durchlaufs** gelesen (Restarbeit ist bereits um frühere Durchläufe verringert).

## Schlüssel

| Schlüssel | Anzeige (i18n) | Wert je Einheit | Sortierung |
|---|---|---|---|
| `lowest_peak_altitude` | `sortChain.lowestPeakAltitude` – geringste Maximalhöhe | maximale scheinbare Höhe in nutzbaren Slots der Nacht | aufsteigend |
| `setting_soonest` | `sortChain.settingSoonest` – bald untergehend | `LastUsableSlot` | aufsteigend |
| `most_remaining` | `sortChain.mostRemaining` – meiste Restarbeit | `TotalWorkSec` (live) | absteigend |
| `constrained` | `sortChain.constrained` – knappes Zeitfenster | `IsConstrained` (nutzbare Slots × 300 < 2 × Mindestzeit) | knapp zuerst |
| `most_moon_limited` | `sortChain.mostMoonLimited` – meiste Mondvermeidungs-Arbeit | `RemainingLaSec` (Stufen ≥ 1, live) | absteigend |
| `mosaic_grouping` | `sortChain.mosaicGrouping` – Mosaik zusammenhalten | Projekt-ID (Panels desselben Projekts nebeneinander) | aufsteigend |
| `card_order` | `sortChain.cardOrder` – Priorität | `UserPriorityIndex` | aufsteigend |
| `due_soonest` | `sortChain.dueSoonest` – Zieltermin am nächsten | `project.due_date`, ohne Termin = +∞ | aufsteigend |

**Standard** (wie Astro PM): `["lowest_peak_altitude","setting_soonest","most_remaining","constrained"]`.

## Regeln
- Unbekannter oder doppelter Schlüssel → `422 rig.sort_chain_invalid`.
- Leere Liste erlaubt (dann nur Matrix-Reihenfolge).
- Astro-PM-Import (OP-20): `LowestPeakAltitude→lowest_peak_altitude`, `SettingSoonest→setting_soonest`, `MostRemainingWork→most_remaining`, `Constrained→constrained`, `MostLaWork→most_moon_limited`, `MosaicGroup→mosaic_grouping`, `UserPriority→card_order`.

## Pflicht-Tests
1. Standardkette ordnet drei Einheiten mit bekannten Werten wie das Original (Vergleichstest).
2. Gleichstand in allen Schlüsseln → Matrix-Reihenfolge.
3. `due_soonest`: ohne Termin zuletzt.
4. `moonDownChain` stellt `most_moon_limited` an den Anfang und entfernt Duplikat.
5. Knapp-Fall: Umordnen der Kette ändert, wer Mindestzeit erhält.
