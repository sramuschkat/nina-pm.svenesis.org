# Regeln: Tests und Abnahme

Quelle: TK 17, 18.

- Jedes Arbeitspaket endet mit **grüner CI** und erfüllt die *automatisierte Abnahme* seines Briefs; *menschliche Freigabe* wird von Sven erteilt (nie selbst abhaken).
- Befehle: `pnpm test` (Unit/Referenz/Isolation/Rechte), `pnpm e2e`, `pnpm fake-plugin`, `dotnet test apps/nina-plugin/NinaPm.Core.Tests` (Linux) bzw. vollständige Lösung auf `windows-latest`.
- Lokale DB: PostgreSQL 16 im Docker mit Repeatable Read; DSQL-spezifisches nur in `dsql-it.yml`.
- Test-Login nur lokal über Fixtures aus `docs/seed/seed-demo.json`.
- Engine: Soll-Pläne, Grenzfall-Tabellen der Specs (Mond, Rotation, canonical JSON) sind Pflicht-Unit-Tests.
- Rechte-Tests werden aus Routen-Metadaten generiert: Route × {owner, admin, befristeter Admin, abgelaufener Admin, user, fremder Mandant, anonym}.
- Keine Tests gegen prod außer Smoke und Fake-Plugin-Nacht im Test-Mandanten.
- Neue Fehlercodes/Enums zuerst in `docs/contracts`, Test `contracts.spec.ts` prüft Konsistenz (Code ↔ i18n-Schlüssel vorhanden).
- Flaky Tests nicht deaktivieren, sondern Ursache beheben oder mit Issue als `todo` markieren.
- Commit/PR nennt AP-ID und Anforderungs-IDs; `docs/CHANGELOG.md` je AP.
