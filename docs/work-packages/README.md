# Arbeitspakete

Reihenfolge innerhalb eines Releases ist verbindlich (Tabelle von oben nach unten). Ein Paket beginnt erst, wenn seine Abhängigkeiten abgenommen und die blockierenden menschlichen Aufgaben (`../ops/human-tasks.md`) erledigt sind. **Ausnahmen:** H-13 (Soll-Pläne) ist Merge-Bedingung von **AP-13b** (Paint) und **AP-13d** (Ablauf), keine Startsperre; H-16 (visuelle Abnahme) blockiert nicht.

**Größen:** S ≈ 1 Sitzung · M ≈ 1–2 Sitzungen · L ≈ 2–4 Sitzungen (Claude Code, inkl. Tests).

**Ablauf je Paket:** Brief lesen → nur die genannten Abschnitte laden (`../concept/INDEX.md`) → Verträge/Schemas zuerst → implementieren → automatisierte Abnahme → PR mit AP- und Anforderungs-IDs (Basis `main`, Changelog-Eintrag als Datei in `../changelog.d/`) → Sven landet mit `pnpm pr:land` → menschliche Freigabe. „CHANGELOG ergänzt“ in den Briefen ist mit dem Eintrag in `docs/changelog.d/` erfüllt.

**Status** pflegt Sven nach der Abnahme (☐ offen · ◐ in Arbeit · ☑ abgenommen + Datum). Claude Code nimmt das erste Paket, dessen Status ☐ ist und dessen Abhängigkeiten ☑ sind; es setzt höchstens ◐ und trägt ☑ nach Svens ausdrücklicher Abnahme im nächsten Paket-PR nach.

## R1

| AP | Titel | Größe | Abhängig von | Mensch | Status |
|---|---|---|---|---|---|
| [AP-01](AP-01.md) | Monorepo-Gerüst | M | – | H-02, H-03 | ☑ 23.09.2026 |
| [AP-02a](AP-02a.md) | CDK-Grundgerüst: Data, Config, Cert, Web, Edge | M | AP-01 | H-01, H-04, H-06 | ☑ 23.09.2026 |
| [AP-S1](AP-S1.md) | Spike Aurora DSQL | S | AP-02a | H-01, H-22 | ☑ 23.09.2026 |
| [AP-02b](AP-02b.md) | CDK: Api, Jobs, Ops (Lambdas, Rollen, Zeitpläne, Alarme) | M | AP-02a, AP-S1 | H-05, H-06, H-09 | ☑ 23.09.2026 |
| [AP-03](AP-03.md) | Datenbankpaket und Migrationen | L | AP-02b | H-06, H-22 | ☑ 23.09.2026 |
| [AP-05](AP-05.md) | Shared: Rechte, Fehler, Verträge, Middleware, Job-Infrastruktur | M | AP-03 | – | ☑ |
| [AP-04a](AP-04a.md) | Anmeldung mit Discord und Sitzungen | L | AP-05 | H-05, H-07, H-08 | ☑ |
| [AP-04b](AP-04b.md) | Mandanten, Einladungen, Owner-Invarianten | L | AP-04a | H-08, H-12a | ☑ |
| [AP-06a](AP-06a.md) | Frontend-Shell, Gestaltung, Anmelde-Bildschirme | L | AP-04b | H-16 | ☑ |
| [AP-06b](AP-06b.md) | Benachrichtigungen in der App und Startseite R1 | S | AP-06a | – | ☑ |
| [AP-07a](AP-07a.md) | System-Administration (Super User) | M | AP-06a | – | ☑ |
| [AP-07b](AP-07b.md) | Mitglieder, Einladungen, Admin-Rechte (Owner) | M | AP-07a | – | ☑ |
| [AP-07c](AP-07c.md) | Mandanteneinstellungen, Owner-Übertragung, Protokolle | M | AP-07b | – | ☑ |
| [AP-08a](AP-08a.md) | Engine-Grundlagen: Mathematik, kanonisches JSON, Hash | M | AP-01 | – | ☑ |
| [AP-08b](AP-08b.md) | Engine: Zeit, Sonne, Mond, Koordinaten, Dämmerung (Port astro-core) | L | AP-08a | H-03 | ☑ |
| [AP-09a](AP-09a.md) | Ausrüstung: API | L | AP-05, AP-04b, AP-08b | – | ☑ |
| [AP-09b](AP-09b.md) | Stammdaten-Bildschirme S-11 … S-15 | M | AP-09a, AP-06a | – | ☑ |
| [AP-09c](AP-09c.md) | Rig-Bildschirm S-10 | M | AP-09b | – | ☑ |
| [AP-10](AP-10.md) | Engine: Sichtbarkeit, Saisonende, Mondvermeidung, Nachtdiagramm | M | AP-08b, AP-06a | – | ☑ |
| [AP-11a](AP-11a.md) | Projekte: API | L | AP-09a | – | ☑ |
| [AP-11b](AP-11b.md) | Projekt-Editor S-31 | L | AP-11a, AP-10 | – | ☑ |
| [AP-11c](AP-11c.md) | Projektliste S-30 | S | AP-11b | – | ☑ |
| [AP-12a](AP-12a.md) | Freigabe-Workflow: API, Stimmen, Rangfolge | L | AP-11a, AP-06b | – | ☑ |
| [AP-12b](AP-12b.md) | Meine Objekte S-32 und Entwürfe S-34 | M | AP-12a, AP-11c | – | ☑ |
| [AP-12c](AP-12c.md) | Warteschlange S-33 | M | AP-12b | – | ☑ |
| [AP-13a](AP-13a.md) | Engine: Vergleichsorakel, Grid-Format, CI | M | AP-10 | – | ☑ |
| [AP-13b](AP-13b.md) | Engine: Zuteilung (`paint`) + Soll-Pläne Paint | L | AP-13a | H-13 | ☑ |
| [AP-13c](AP-13c.md) | Engine: Ablauf (`walk`/`pick`), Blöcke, `planNight` | L | AP-13b | – | ☑ |
| [AP-13d](AP-13d.md) | Engine: Flip, Transit, Diagnose + Soll-Pläne Ablauf | M | AP-13c | H-13 | ☑ |
| [AP-13e](AP-13e.md) | Engine: Aufwand-Kennzeichen + Job + Einfügeposition | M | AP-13d, AP-12c | – | ☑ |
| [AP-13f](AP-13f.md) | Simulator S-40 | L | AP-13d, AP-09c, AP-11a, AP-06a | – | ☑ |
| [AP-14a](AP-14a.md) | NINA-API: Instanz-Token, Bootstrap, Ziele, Plan | M | AP-13c, AP-12a, AP-11a | – | ☑ |
| [AP-14b](AP-14b.md) | NINA-API: Sessions, Lease, Offline, Ingest, Heartbeat | L | AP-14a | – | ☑ |
| [AP-14c](AP-14c.md) | NINA-Instanzen S-42, Auslieferung S-41, Fake-Plugin | M | AP-14b, AP-13f | H-12b, H-24 | ☑ |
| [AP-15](AP-15.md) | Sessions und Auswertung R1 | M | AP-14c | – | ☑ |
| [AP-07d](AP-07d.md) | Speicherbedarf je Mandant (S-80, FA-SU-03) | S | AP-07a | – | ☑ |
| [AP-17](AP-17.md) | Härtung und Go-live | L | AP-15, AP-07c, AP-07d | H-17, H-18, H-20, H-23 | ☑ |

## R2

| AP | Titel | Größe | Abhängig von | Mensch | Status |
|---|---|---|---|---|---|
| [AP-20](AP-20.md) | Objektkatalog und Objektbrowser | M | AP-17 | H-11 | ☑ |
| [AP-21](AP-21.md) | Sternkarte S-20 | L | AP-20 | – | ◐ |
| [AP-22](AP-22.md) | Mosaik-Panels im Editor (aus der Sternkarte) | M | AP-21 | – | ☐ |
| [AP-23](AP-23.md) | Astro-Wetter | M | AP-17 | – | ☐ |
| [AP-24](AP-24.md) | Saisondiagramm und Wochen-Sichtbarkeit | S | AP-10 | – | ☐ |
| [AP-25](AP-25.md) | Vorschaubilder | S | AP-20 | – | ☐ |

## R3

| AP | Titel | Größe | Abhängig von | Mensch | Status |
|---|---|---|---|---|---|
| [AP-30](AP-30.md) | Sitzungsprotokoll und Klarnacht-Statistik | M | AP-15 | – | ☐ |
| [AP-31](AP-31.md) | Session-KPIs, Abweichungsgründe, Aufnahmen verwerfen | M | AP-30 | – | ☐ |
| [AP-32](AP-32.md) | Mehrnacht-Simulation, Auswirkungsvorschau, Änderungsanträge | L | AP-31 | – | ☐ |
| [AP-33](AP-33.md) | Folgeplanung S-62 und Prognose | M | AP-32 | – | ☐ |
| [AP-34](AP-34.md) | Projektbericht S-63 | S | AP-31 | – | ☐ |
| [AP-35](AP-35.md) | „Heute Nacht“ S-02 | S | AP-33 | – | ☐ |

## RP – NINA-Plugin (direkt vor R4)

Entscheidung Sven, 23.09.2026: R1 geht ohne Plugin live; NINA-API (AP-14a–c) und Fake-Plugin bleiben in R1. RP liefert den Plugin-Umfang, den Fachkonzept und `../specs/nina/execution.md` mit „R1“ kennzeichnen. H-14 wird erst hier gebraucht; die Plugin-Nacht P-05 ist Abnahme von AP-16h.

| AP | Titel | Größe | Abhängig von | Mensch | Status |
|---|---|---|---|---|---|
| [AP-S2b](AP-S2b.md) | Spike NINA-Laufzeit: Stellen ohne Vorbild prüfen (Mensch + Agent) | S | AP-01 | H-14, H-15 | ☐ |
| [AP-S2c](AP-S2c.md) | Spike Build: Adapter ohne Windows bauen (Mensch + Agent) | S | AP-01 | H-14 | ☐ |
| [AP-08c](AP-08c.md) | Engine-Bundle und Jint-Parität | S | AP-08b, AP-S2c | – | ☐ |
| [AP-S2a](AP-S2a.md) | Spike Jint-Laufzeit | S | AP-08c | – | ☐ |
| [AP-16a](AP-16a.md) | Plugin: Lösung, Core, Kopplung, NINA-Test-Server | M | AP-S2b, AP-S2c, AP-08c, AP-14a | H-14, H-15 | ☐ |
| [AP-16b](AP-16b.md) | Plugin Core: Planung, Neuplanung, Offline-Plan | M | AP-16a, AP-S2a, AP-13d | H-15 | ☐ |
| [AP-16c](AP-16c.md) | Plugin Adapter: Container, interne Items, Blockablauf | L | AP-16b, AP-14b | H-14, H-15 | ☐ |
| [AP-16d](AP-16d.md) | Plugin Adapter: Trigger-Walk, Filter und Auslesemodus, Neuplanung im Block | M | AP-16c | H-15 | ☐ |
| [AP-16e](AP-16e.md) | Plugin: Aufnahme-Zuordnung, Heartbeat, Lease | M | AP-16d | H-15 | ☐ |
| [AP-16f](AP-16f.md) | Plugin: Rotator, Flip, Standort- und Sequenzprüfung, Playback-Verzug | M | AP-16e | H-15 | ☐ |
| [AP-16g](AP-16g.md) | Plugin: Outbox, Offline-Modus, Bedienung | M | AP-16f | H-15 | ☐ |
| [AP-16h](AP-16h.md) | Plugin: Live-Status, Zielbrowser, Trigger-Sets, Anweisungskatalog | L | AP-16g | H-12b, H-15 | ☐ |

## R4

| AP | Titel | Größe | Abhängig von | Mensch | Status |
|---|---|---|---|---|---|
| [AP-40](AP-40.md) | Exoplaneten-Kataloge | M | AP-17 | – | ☐ |
| [AP-41](AP-41.md) | Transitrechnung | M | AP-40, AP-08b | – | ☐ |
| [AP-42](AP-42.md) | Exoplaneten-Bildschirm S-22 | M | AP-41 | – | ☐ |
| [AP-43](AP-43.md) | Exoplaneten-Projekt und Transit-Beobachtungen | L | AP-42, AP-12c | – | ☐ |
| [AP-44](AP-44.md) | Scheduler-Reservierung und Plugin-Transitblock | M | AP-43, AP-16h | H-15 | ☐ |
| [AP-45](AP-45.md) | Transit-Auswertung und Ergebnisimport | M | AP-44 | H-19 | ☐ |

## R5

| AP | Titel | Größe | Abhängig von | Mensch | Status |
|---|---|---|---|---|---|
| [AP-50](AP-50.md) | Flat-Handling im Plugin | L | AP-16h | H-15 | ☐ |
| [AP-52](AP-52.md) | Tagesschleife | M | AP-50 | H-15 | ☐ |
| [AP-53](AP-53.md) | Simulator im Plugin | M | AP-16h | H-15 | ☐ |
| [AP-54](AP-54.md) | Mandanten-Export/-Import | M | AP-17 | – | ☐ |
| [AP-55](AP-55.md) | Astro-PM-Import (optional) | M | AP-54 | – | ☐ |

## R6

| AP | Titel | Größe | Abhängig von | Mensch | Status |
|---|---|---|---|---|---|
| [AP-60](AP-60.md) | Discord-Kanäle und Nachtbericht | M | AP-15 | H-21 | ☐ |
| [AP-61](AP-61.md) | Belichtungs-/Sampling-Rechner | S | AP-09b | – | ☐ |
| [AP-62](AP-62.md) | Optionale NINA-Metriken | S | AP-16h | – | ☐ |
| [AP-63](AP-63.md) | Teilen von Ausrüstung/Projekten | S | AP-54 | – | ☐ |
