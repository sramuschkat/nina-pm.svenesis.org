# AP-S1 – Spike Aurora DSQL

**Release:** R1 · **Größe:** S · **Abhängigkeiten:** AP-02a · **Menschliche Aufgaben:** H-01, H-22

## Ziel
Die DSQL-Eigenschaften aus TK 6.0 sind in einem kurzlebigen Cluster nachgewiesen oder mit Änderungsvorschlag widerlegt; das Prüfskript schreibt Claude Code, ausgeführt wird es lokal von Sven. Ergebnis ist ein ADR mit Befehlen und Ergebnissen, kein Produktivcode.

## Anforderungen
TK 6.0

## Lesen (nur diese Abschnitte)
- TK 6.0–6.8
- TK 17 (DSQL-Integration), TK 18 (`pnpm test:dsql`)
- rules/dsql.md
- rules/testing.md
- docs/adr/ADR-TEMPLATE.md
- schema_aurora_dsql.sql (Kopf, GRANT-Vorlage)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Wegwerf-Prüfungen unter `spikes/dsql/`, gestartet über **`tools/deploy/test-dsql.ts --spike`** (`pnpm test:dsql --spike`): das Skript legt per AWS SDK einen **kurzlebigen Cluster** mit Tag `purpose=ci` an, führt die Prüfungen aus und löscht den Cluster im `finally` – auch bei Fehler. **Sven führt es lokal mit seinem Admin-Profil aus (H-22)** und legt das Protokoll unter `docs/test-runs/<datum>/ap-s1/` ab; Claude Code führt es nie aus (E1)
- Das Skript schreibt je Prüfpunkt Befehl, Ergebnis und Dauer in das Protokoll; AP-03 baut `pnpm test:dsql` auf demselben Skript auf
- Prüfprotokoll `docs/adr/ADR-S1-dsql.md` aus dem zurückgegebenen Protokoll, in der Reihenfolge aus TK 6.0: FK inkl. NOT VALID, **jsonb als Spaltentyp**, ADD COLUMN DEFAULT, SELECT FOR UPDATE bei Schreib-Schiefe, INSERT ON CONFLICT, Wartefunktion für CREATE INDEX ASYNC, GRANT/AWS IAM GRANT, Node-Connector, Grenzen (Zeilen, Datenvolumen, Laufzeit) – Latenz vom Rechner aus gemessen, **nicht** aus Lambda (CC-6)
- Bei Abweichungen: Änderungsvorschlag für TK 6.0/`rules/dsql.md`

## Nicht im Umfang
- Kein Produktivcode
- Kein GitHub-Workflow mit AWS-Zugang (E1)

## Automatisierte Abnahme
- [ ] Skript mit gemocktem AWS SDK getestet: Tag `purpose=ci` gesetzt, Cluster wird im `finally` auch bei einem Fehler gelöscht
- [ ] Protokoll enthält je Punkt Befehl + Ergebnis
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Spike lokal ausführen und Protokoll zurückgeben (H-22); Go/No-Go DSQL bestätigen
