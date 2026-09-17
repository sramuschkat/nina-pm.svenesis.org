# Dokumentation – Leseplan

| Wer / wann | Lesen |
|---|---|
| Claude Code, erste Sitzung | `../START.md` |
| Claude Code, jede Sitzung | `../CLAUDE.md` → Brief des aktuellen Arbeitspakets (`work-packages/AP-xx.md`) → darin genannte Abschnitte (Zeilen über `concept/INDEX.md`) |
| Engine-Arbeit | `rules/engine.md` + passende `specs/engine/*.md` + `contracts/golden-plans/` + `history/Analyse_AstroPM_NINA_Plugin_2026-09-17.md` |
| Datenbank | `rules/dsql.md` + `concept/schema_aurora_dsql.sql` |
| Infrastruktur / IAM | `specs/infra/iam.md` (Rollen und Rechte je Lambda, API-Gateway-Drosselung, CloudFront-Header) + TK 4, 15 |
| Oberfläche | `rules/ui.md` + `specs/ui/components.md` (Bausteine) + FK 14 (Bildschirme S-xx) + TK 11 |
| API | `rules/api.md` + `contracts/errors.json`, `contracts/enums.json` + TK 7 (Vertragsquelle: zod-Schemas) |
| NINA-Plugin | `specs/nina/execution.md` + TK 10 + `contracts/nina/` + `ops/plugin-test-protocol.md` (Test-Server, P-01…P-24) |
| Sven | `ops/human-tasks.md`, `contracts/golden-plans/README.md` (Abnahme), `ops/golive-checklist.md` |

## Ordner
- `rules/` – verbindliche Arbeitsregeln (kurz)
- `specs/engine/` – Rechenvorschriften mit Pflicht-Tests (Zuteilung nach Astro-PM-Plugin; `geometry.md` für Bildfeld, Mosaik-Panels und Positionswinkel)
- `specs/infra/` – IAM und Least Privilege je Lambda, API-Gateway-Drosselung, CloudFront-Header-Politiken
- `specs/ui/` – Verträge der wiederverwendbaren Bausteine, Symbole, Abstände
- `specs/nina/` – Ausführung im NINA-Plugin
- `contracts/` – Aufzählungen, Fehlercodes, Soll-Pläne, NINA-API-Beispiele
- `seed/` – Demo- und Testdaten
- `ops/` – menschliche Aufgaben, Go-live, Plugin-Tests, Discord-Meldungen
- `work-packages/` – Brief je Arbeitspaket (R1–R6)
- `concept/` – Fachkonzept 1.15, Technisches Konzept 1.12, Schema 1.11 und `INDEX.md` (Abschnitt → Zeilen, per Skript erzeugt). Master liegt im Projektordner; bei Änderungen dort ändern, hierher kopieren und INDEX neu erzeugen
- `adr/` – `ADR-TEMPLATE.md`; Spikes und Architekturentscheidungen legt Claude Code hier als `ADR-xx-….md` ab
- `history/` – Reviews, Analyse des Astro-PM-Plugins, überholte Soll-Pläne v1
- später von Claude Code angelegt: `api/openapi.yaml`, `runbooks/`, `test-runs/`, `CHANGELOG.md`

## Vorrang bei Widersprüchen
Brief des Arbeitspakets > `specs/` und `contracts/` > `rules/` > Technisches Konzept > Fachkonzept. Widersprüche als Issue melden und im Master beheben; nie stillschweigend eine Seite wählen.
