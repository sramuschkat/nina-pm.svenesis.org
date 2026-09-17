# AP-S1 – Spike Aurora DSQL

**Release:** R1 · **Größe:** S · **Abhängigkeiten:** AP-02a · **Menschliche Aufgaben:** H-01, H-22

## Ziel
Die DSQL-Annahmen aus TK 6.0 sind in einem kurzlebigen CI-Cluster nachgewiesen oder mit Änderungsvorschlag widerlegt. Ergebnis ist ein ADR mit Befehlen und Ergebnissen, kein Produktivcode.

## Anforderungen
TK 6.0

## Lesen (nur diese Abschnitte)
- TK 6.0–6.8, TK 18 (dsql-it.yml)
- rules/dsql.md
- docs/adr/ADR-TEMPLATE.md
- schema_aurora_dsql.sql (Kopf, GRANT-Vorlage)
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Wegwerf-Skripte unter `spikes/dsql/`, ausgeführt als manuell ausgelöster Workflow `dsql-spike.yml` im GitHub-Environment `ci` gegen einen **kurzlebigen Cluster** (anlegen → prüfen → löschen, `if: always()`)
- Prüfprotokoll `docs/adr/ADR-S1-dsql.md` in der Reihenfolge aus TK 6.0: FK inkl. NOT VALID, **jsonb als Spaltentyp**, ADD COLUMN DEFAULT, SELECT FOR UPDATE bei Schreib-Schiefe, INSERT ON CONFLICT, Wartefunktion für CREATE INDEX ASYNC, GRANT/AWS IAM GRANT, Node-Connector, Grenzen (Zeilen, Datenvolumen, Laufzeit) – Latenz im CI-Runner messen, **nicht** aus Lambda (CC-6)
- Bei Abweichungen: Änderungsvorschlag für TK 6.0/`rules/dsql.md`

## Nicht im Umfang
- Kein Produktivcode

## Automatisierte Abnahme
- [ ] Skripte laufen reproduzierbar; Protokoll enthält je Punkt Befehl + Ergebnis
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Go/No-Go DSQL bestätigen
