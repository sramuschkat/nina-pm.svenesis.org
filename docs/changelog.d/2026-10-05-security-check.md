### Sicherheit – `pnpm security:check` (2026-10-05)

Anforderungen: SV-13, SV-15, SV-16 (Sicherheitsanalyse 05.10.2026)

- Neues Skript `pnpm security:check` (nur Sven, Admin-Profil): prüft mit nur lesenden AWS-CLI-Aufrufen Konto (Root, IAM-Benutzer, Public Access Block, CloudTrail, GuardDuty, Access Analyzer), beide Buckets, alle NINA-PM-Lambdas und ihre Rollen, API Gateway (Direktaufruf 403, CORS), CloudFront, SSM-Bestand, Altrollen/OIDC, Zeitpläne, Log-Aufbewahrung und die Fehler-Queue. Protokoll ohne geheime Werte unter `docs/test-runs/<Datum>/security/aws-check.md`; Exit 1 bei einem Befund „hoch“.
- Prüflogik rein in `tools/deploy/src/security/checks.ts` mit Unit-Tests je sicherem und unsicherem Fall.
