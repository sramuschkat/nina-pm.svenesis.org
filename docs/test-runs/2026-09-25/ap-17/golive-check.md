# Go-live-Prüfung (AP-17, automatisierbare Punkte)

Lauf 2026-09-25T09:15:56.805Z, Commit 039f721. Erzeugt von `pnpm golive:check` (nur lesend).

| Punkt | Ergebnis | Detail |
|---|---|---|
| Website-Distribution E2L6Q80SD8XPT0 unverändert (Vergleich vorher/nachher) | ☑ | ok |
| Alarme nach TK 16.2 vorhanden und an das SNS-Topic gebunden | ☑ | 9 Alarme |
| Alarm-E-Mail-Abo bestätigt (H-09) | ☑ | ok |
| AWS Backup: Plan nina-pm-dsql aktiv, letzter Lauf erfolgreich (SV-15) | ☑ | letzter Lauf 2026-09-25T05:00:00+02:00 |
| DSQL-Cluster mit Löschschutz | ☑ | ok |
| Reservierte Parallelität nina-pm-api = 20 | ☑ | ok |
| Reservierte Parallelität nina-pm-worker = 5 | ☑ | ok |
| Budget-Alarm aktiv (20 USD/Monat) | ☑ | ok |
| Route-53-Health-Check /api/health über CloudFront grün | ☑ | 6/6 Regionen erfolgreich |
| CSRF: POST /api/auth/invitation/claim ohne X-NPM-Request → 403 auth.csrf_missing (SV-04) | ☑ | ok |
| CSRF: POST /api/auth/invitations/preview ohne X-NPM-Request → 403 auth.csrf_missing (SV-04) | ☑ | ok |
| catalog/thumbs: harte CSP (default-src 'none', sandbox) – HTML wird nicht ausgeführt | ☑ | ok |

Alle Punkte grün.
