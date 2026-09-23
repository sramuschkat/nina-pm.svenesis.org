# Regeln: Tests und Abnahme

Quelle: TK 17, 18.

- Jedes Arbeitspaket endet mit **grüner CI** und erfüllt die *automatisierte Abnahme* seines Briefs; *menschliche Freigabe* wird von Sven erteilt (nie selbst abhaken).
- Befehle: `pnpm test` (Unit/Referenz/Isolation/Rechte), `pnpm e2e`, `pnpm fake-plugin`, `dotnet test apps/nina-plugin/NinaPm.Core.Tests` (Linux, macOS, Windows) und `dotnet build apps/nina-plugin/NinaPm.Nina` bzw. `…/NinaPm.Nina.Tests` (Adapter-Build ohne Windows, TK 10.5); die Adapter-Tests **ausführen** und `NinaPm.Nina.Ui` bauen nur auf `windows-latest`.
- Lokale DB und CI: PostgreSQL 16 im Docker mit Repeatable Read. DSQL-spezifische Tests (`pnpm test:dsql`) und der Spike AP-S1 laufen **nur lokal bei Sven** mit Admin-Profil gegen einen kurzlebigen Cluster mit Tag `purpose=ci`, den das Skript anlegt und im `finally` löscht (E1, H-22); Claude Code schreibt sie so, dass sie ohne CI laufen, und wertet das zurückgegebene Protokoll aus.
- Test-Login nur lokal über Fixtures aus `docs/seed/seed-demo.json`.
- Engine: Soll-Pläne, Grenzfall-Tabellen der Specs (Mond, Rotation, canonical JSON) sind Pflicht-Unit-Tests.
- Rechte-Tests werden aus Routen-Metadaten generiert: Route × {owner, admin, Admin ohne Discord-2FA (wirkt als User, SV-03), user, fremder Mandant, anonym}; befristete Admins entfallen (E2).
- Keine Tests gegen prod außer Smoke und Fake-Plugin-Nacht im Test-Mandanten (beide Schritte von `pnpm deploy:prod`, H-06).
- Neue Fehlercodes/Enums zuerst in `docs/contracts`, Test `contracts.spec.ts` prüft Konsistenz (Code ↔ i18n-Schlüssel vorhanden).
- Flaky Tests nicht deaktivieren, sondern Ursache beheben oder mit Issue als `todo` markieren.
- Commit/PR nennt AP-ID und Anforderungs-IDs; `docs/CHANGELOG.md` je AP.
