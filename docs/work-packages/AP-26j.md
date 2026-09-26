# AP-26j – Saisondiagramm als Reiter neben dem Höhendiagramm, Sternkarten-Seitenbereich immer rechts, Filtermarken der Zielkarten gleich breit

**Release:** UI-Überarbeitung (vor R3) · **Größe:** S · **Abhängigkeiten:** AP-26i · **Menschliche Aufgaben:** –

## Ziel
Wünsche Sven vom 26.09.2026:
- **Sternkarte:** Der Seitenbereich (*Bildfeld & Mosaik*, *Ebenen*) steht immer rechts neben der Karte.
- **Objektbrowser** (*Beste der Nacht*, *Alle Objekte*): Das Saisondiagramm ist ein Reiter neben dem Höhendiagramm in der aufgeklappten Zeile; das Saison-Symbol in der Aktionsspalte entfällt.
- **Sternkarte:** Unter der Karte steht das Saisondiagramm des aktuellen Objekts ebenfalls als Reiter neben dem Höhendiagramm.
- **Nacht-Simulator:** Die farbigen Filtermarken der Zielkarten sind alle gleich breit.

## Lesen
- FK FA-SIC-02 (Saisondiagramm), S-20, S-21, FA-SIM-06

## Liefern
- **Objektbrowser:** `ObjectNight` mit Reitern *Höhendiagramm* / *Saisondiagramm* (`SeasonPanel`, 1 h Mindestzeit, astronomische Dunkelheit, Mindesthöhe der Kontextleiste); Aktion *Saison* und Saisonbereich unter der Tabelle entfallen.
- **Sternkarte:**
  - Das Raster bleibt immer zweispaltig (Seitenbereich 17–22rem).
  - Unter der Karte Reiter *Höhendiagramm* / *Saisondiagramm* für das gewählte Objekt, sonst für die Bildfeldmitte.
- **`useUniformWidth`** (`apps/web/src/lib`): Callback-Ref, misst das breiteste Element und setzt eine CSS-Variable. Genutzt von den Projektlisten (`--plan-chip-w`) und den Zielkarten des Simulators (`--sim-chip-w`).

## Automatisierte Abnahme
- [ ] Objektbrowser: keine Saison-Aktion, Reiter in der aufgeklappten Zeile
- [ ] `useUniformWidth`: breitestes Element als Variable
- [ ] 768 px ohne horizontales Scrollen; CI grün, Changelog

## Menschliche Freigabe
Sichtabnahme Sven
