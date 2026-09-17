# Go-live-Checkliste (AP-17)

Jeder Punkt mit Nachweis (Link auf Workflow-Lauf, Screenshot, Protokoll). Go-live erst, wenn alle ☑.

## Infrastruktur
- ☐ `cdk-nag` ohne offene Befunde (Ausnahmen begründet in `infra/nag-suppressions.md`)
- ☐ CloudFront: HTTPS only, TLS 1.2+; **alle vier Behaviors** tragen eine Response-Headers-Policy (`npm-html` für Default, `npm-api-static` für `/api/*`, `/catalog/*`, `/downloads/*`); HSTS und `nosniff` auch auf `/api/*` und `/downloads/*`; CSP ohne `unsafe-inline` für **Skripte** (für Stile ist es Pflicht, `specs/infra/iam.md` §10); `X-Origin-Verify` am API-Origin erzwungen und gegen **beide** SSM-Werte geprüft
- ☐ Website-Distribution E2L6Q80SD8XPT0 unverändert (`aws cloudfront get-distribution-config` Vergleich vorher/nachher)
- ☐ Route-53: nur Alias `nina-pm.svenesis.org` neu
- ☐ Alarme (16.2) ausgelöst per Test und E-Mail empfangen
- ☐ Route-53-Health-Check **`/api/health/shallow` über CloudFront** grün (nicht direkt auf die HTTP API – dort fehlt `X-Origin-Verify`)
- ☐ AWS Backup Plan aktiv, letzter Lauf erfolgreich; Vault `nina-pm-prod` mit **Vault Lock** und Zugriffspolitik ohne `backup:DeleteRecoveryPoint` für die Deploy-Rolle
- ☐ Restore-Probe (H-20) protokolliert inkl. Plugin-Nachmeldung
- ☐ Rollback-Probe: vorherigen Tag deployt, Smoke grün, wieder aktuellen Tag deployt
- ☐ Kosten: Budget-Alarm aktiv

## Sicherheit
- ☐ **IAM-Diff gegen `specs/infra/iam.md`** ohne Abweichung (je Rolle die synthetisierten Politiken gegen die Spec; Artefakt aus AP-17)
- ☐ Keine `Allow`-Anweisung mit `"Resource": "*"` in einer Ausführungsrolle (Ausnahmen laut `iam.md` §1)
- ☐ `NinaPmApi` hat genau **einen** `lambda:InvokeFunction`-Eintrag → `nina-pm-worker`; `NinaPmWorker` hat ein `Deny` darauf
- ☐ `NinaPmWorker` hat **keinen** Lesezugriff auf `/nina-pm/jwt/*`, `discord/client-secret`, `bootstrap-super-users`
- ☐ `dsql:DbConnectAdmin` **nur** in `db-bootstrap`; diese Lambda hat keinen Trigger und keine Ereignisquelle
- ☐ Die cfn-exec-Rolle trägt `NinaPmDeployBoundary`, **nicht** `AdministratorAccess` (Screenshot aus H-04)
- ☐ Direktaufruf der `execute-api`-Adresse liefert 403 (Smoke-Test)
- ☐ Reservierte Parallelität auf `api` (20) und `worker` (5) gesetzt
- ☐ Drosselung je NINA-Instanz greift (121 Aufrufe/min → `429`)
- ☐ CloudTrail `nina-pm-management` aktiv; Alarm „Notfallzugang benutzt“ per Testaufruf ausgelöst und E-Mail erhalten
- ☐ `/nina-pm/bootstrap-super-users` nach dem ersten Super-User-Login geleert (H-08)
- ☐ Rotationsprobe JWT und Origin-Verify protokolliert (H-26)
- ☐ CSP-Abnahme: Radix-Menü und -Dialog hinter produktiven Headern ohne CSP-Verstoß in der Konsole
- ☐ Uploads als presigned **POST**; ein Upload über der Größengrenze wird von S3 abgelehnt
- ☐ CSRF: ohne `X-NPM-Request` bzw. mit fremdem `Origin` → 403
- ☐ `/api/auth/test-login` in prod → 404
- ☐ Rechte-Tests vollständig (jede Route × Rollen) grün
- ☐ Mandantenisolation grün
- ☐ Refresh-Rotation: Wiederverwendung außerhalb Karenz beendet Sitzungen (E2E)
- ☐ Owner-Schutz-Tests grün (Admin kann Owner nicht herabstufen/entfernen/sperren)
- ☐ Keine Geheimnisse im Repo (`gitleaks` im CI)
- ☐ Abhängigkeits-Audit ohne kritische Befunde
- ☐ Datenschutz/Rechtliches (H-17) freigegeben

## Funktion (Test-Mandant, echtes Discord, NINA-Simulator)
- ☐ Mandant anlegen → Owner-Einladung → Owner-Login mit 2FA
- ☐ User einladen → User legt Objekt an → einreichen → Stimme eines anderen Users → Admin gibt frei
- ☐ Simulator zeigt Plan; Diagnose plausibel
- ☐ Plugin-Nacht (P-05) mit Simulatorgeräten: Aufnahmen im Web, Zähler stimmen
- ☐ Fake-Plugin-Nacht nach Deploy grün
- ☐ Benachrichtigung in der App empfangen
- ☐ Visuelle Abnahme (H-16) in **beiden Themes** (hell, dunkel), in allen drei Dichtestufen und bei 768 px sowie bei 2560 px Breite (volle Breite ohne Obergrenze)

## Betrieb
- ☐ **Sechs** Runbooks vorhanden (`docs/runbooks/`, geliefert in AP-17, CC5-13): `restore.md` (Restore inkl. Import-Modus `-c dsqlClusterId=…`), `rollback.md` (Deploy zurückrollen), `token-revoke.md` (NINA-Token widerrufen), `superuser-emergency.md` (Super-User-Notfallzugang über `ops-cli`), `owner-reassign.md` (Owner-Neuzuweisung), `dsql-cluster-swap.md` (neuer Cluster-ARN nach Restore, DAT-15)
- ☐ `docs/CHANGELOG.md` mit Version `1.0.0`
- ☐ Menüeintrag Website (H-18) erst nach allen obigen Punkten
