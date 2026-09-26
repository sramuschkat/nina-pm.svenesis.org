### Betrieb – Auswertungs-Demodaten für den Test-Mandanten (2026-09-26)

Anforderungen: TK 5.4 (ops-cli); Entscheidungen Sven 26.09.2026 (nur Test-Mandant, nur Auswertungsdaten, 90 Nächte, vorhandene Projekte behalten ihren Stand, fünf Demo-Projekte „Demo – …“)

- Neuer `ops-cli`-Befehl **`demo-evaluation`**, nur für `tenant: "test"`. Er läuft in Schritten, weil die Lambda 60 s hat:
  - `plan`: Probelauf.
  - `clear`: löscht die Auswertungsdaten stapelweise. Dazu gehören Sessions, Aufnahmen, Aufnahmenächte, Korrekturen, Flat-Kombinationen, Session-Ereignisse, Protokolle, Klarnacht-Statistik, Server- und Offline-Pläne sowie Session-Alarme.
  - `projects`: legt die Demo-Projekte an und gibt sie frei.
  - `nights`: schreibt die Nächte abschnittweise.
  - `finish`: rechnet die Zähler aus den Aufnahmen (`reconcileSite`), setzt den Endstatus der Demo-Projekte und lässt den Aufwand neu rechnen.
  - Projekte, Ausrüstung, Mitglieder, gespeicherte Simulationen und die Prognose bleiben.
- **Generator** `demoEvaluation` (packages/shared), rein und deterministisch:
  - Wetter je Standort als Folge von Wetterlagen, etwa 60 % nutzbare Nächte.
  - Dunkelheit und Mond aus der Engine.
  - Aufnahmen in Filterblöcken mit Verwerfungen (Wolken, Guiding, Fokus, Satellit) und Metriken (HFR, Sterne, Guiding-RMS, Höhe).
  - Wetter-Schnappschuss, Sitzungsprotokolle und ungeprüfte Sessions der letzten sieben Nächte.
  - Geschichten der Demo-Projekte: fertig, aktiv mit Kanalbalance, aktiv, pausiert, Saison vorbei.
  - Vorhandene Projekte behalten exakt ihren heutigen Stand und Status. Der Stand wird im Probelauf erfasst und an alle Schritte weitergegeben.
- **`pnpm demo:evaluation [--dry-run]`** (nur Sven, Admin-Profil): Probelauf mit Zusammenfassung, Rückfrage „ja“, dann alle Schritte. Das Protokoll liegt unter `docs/test-runs/<Datum>/demo-evaluation/`.
- `pnpm demo:export` nutzt jetzt denselben Aufruf-Helfer (`tools/deploy/src/ops-invoke.ts`).
- Grundlage ist der Export vom 26.09.2026 (`docs/test-runs/2026-09-26/demo-evaluation/test-tenant-export.json`): Starfront, Svenesis-Texas-Rig, Filter LUMINOS/RED/GREEN/BLUE/HA/OIII/SII, IC 1848 und NGC 7380.
