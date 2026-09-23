# Go-live-Checkliste (AP-17)

Jeder Punkt mit Nachweis (Link auf CI-Lauf, Ausgabe von `pnpm deploy:prod`, Screenshot, Protokoll). Go-live erst, wenn alle ☑.

## Infrastruktur
- ☐ CloudFront: HTTPS only, TLS 1.2+; **alle vier Behaviors** tragen eine Response-Headers-Policy (`npm-html` für Default, `npm-api-static` für `/api/*`, `/catalog/*`, `/downloads/*`); HSTS und `nosniff` auch auf `/api/*` und `/downloads/*`; CSP ohne `unsafe-inline` für **Skripte** (für Stile ist es Pflicht, `specs/infra/iam.md` §10); `X-Origin-Verify` am API-Origin erzwungen und gegen den **einen** Wert aus `/nina-pm/origin-verify` geprüft (SV-16)
- ☐ Website-Distribution E2L6Q80SD8XPT0 unverändert (`aws cloudfront get-distribution-config` Vergleich vorher/nachher)
- ☐ Route-53: nur Alias `nina-pm.svenesis.org` neu
- ☐ Alarme (16.2) ausgelöst per Test und E-Mail empfangen
- ☐ Route-53-Health-Check **`/api/health` über CloudFront** grün (nicht direkt auf die HTTP API – dort fehlt `X-Origin-Verify`)
- ☐ AWS Backup Plan aktiv (täglich, 35 Tage, Standard-Vault; SV-15), letzter Lauf erfolgreich; DSQL-Cluster mit Löschschutz
- ☐ Eine Datei mit `Content-Type: text/html` unter `catalog/thumbs/` wird vom Browser **nicht** ausgeführt (CSP `default-src 'none'` auf `npm-api-static`)
- ☐ `GET /api/health` (einzige Health-Route, ohne DB-Ping) mit 5 rps/Burst 10 gedrosselt; Auth-Drossel 5 rps/Burst 10 nur auf `GET /api/auth/discord/{proxy+}` und den Einladungsrouten, `/auth/me`, `/auth/context`, `/auth/logout`, `/auth/sessions` unter der Stage-Drosselung; Alarm auf Stage-`Count` existiert und wurde einmal testweise ausgelöst (SV-06, SV-07)
- ☐ Restore-Probe (H-20) protokolliert
- ☐ Rollback-Probe: vorherigen Tag lokal deployt, Smoke grün, wieder aktuellen Tag deployt
- ☐ Kosten: Budget-Alarm aktiv

## Sicherheit
- ☐ CDK-Assertions aus `specs/infra/iam.md` §12 grün (Rollen nur mit den CDK-Grants aus §2–§5, kein `*` auf DSQL/S3/SSM/Invoke, `api` ruft nur `worker` auf, `worker` liest keine Auth-Geheimnisse; SV-13, SV-18)
- ☐ Direktaufruf der `execute-api`-Adresse liefert 403 (Smoke-Test)
- ☐ Reservierte Parallelität auf `api` (20) und `worker` (5) gesetzt
- ☐ CSP-Abnahme: Radix-Menü und -Dialog hinter produktiven Headern ohne CSP-Verstoß in der Konsole
- ☐ Uploads als presigned **POST**; ein Upload über der Größengrenze wird von S3 abgelehnt
- ☐ CSRF: schreibende Route ohne `X-NPM-Request` → 403 `auth.csrf_missing`, ebenso anonym `POST /api/auth/invitation/claim` und `/api/auth/invitations/preview` (SV-04)
- ☐ `/api/auth/test-login` in prod → 404
- ☐ Rechte-Tests vollständig (jede Route × Rollen) grün
- ☐ Mandantenisolation grün
- ☐ Sitzungen: Logout und „Sitzungen beenden“ wirken sofort, danach `401 auth.unauthenticated` (E2E, SV-01)
- ☐ Owner-Schutz-Tests grün (Admin kann Owner nicht herabstufen/entfernen/sperren)
- ☐ Keine Geheimnisse im Repo (`gitleaks` im CI)
- ☐ Abhängigkeits-Audit ohne kritische Befunde
- ☐ Datenschutz/Rechtliches (H-17) freigegeben

## Funktion (Test-Mandant, echtes Discord, Fake-Plugin)
- ☐ Mandant anlegen → Owner-Einladung → Owner-Login mit 2FA
- ☐ User einladen → User legt Objekt an → einreichen → Stimme eines anderen Users → Admin gibt frei
- ☐ Simulator zeigt Plan; Diagnose plausibel
- ☐ Fake-Plugin-Nacht nach Deploy grün
- Die Plugin-Nacht P-05 mit Simulatorgeräten ist seit 23.09.2026 Abnahme von AP-16h (Block RP vor R4), nicht Teil dieses Go-live.
- ☐ Benachrichtigung in der App empfangen
- ☐ Visuelle Abnahme (H-16) in **beiden Themes** (hell, dunkel), in allen drei Dichtestufen und bei 768 px sowie bei 2560 px Breite (volle Breite ohne Obergrenze)

## Betrieb
- ☐ **Sechs** Runbooks vorhanden (`docs/runbooks/`, geliefert in AP-17, CC5-13): `restore.md` (Restore inkl. Import-Modus `-c dsqlClusterId=…`), `rollback.md` (Deploy zurückrollen), `token-revoke.md` (NINA-Token widerrufen), `superuser-emergency.md` (Super-User-Notfallzugang über `ops-cli`), `owner-reassign.md` (Owner-Neuzuweisung), `dsql-cluster-swap.md` (neuer Cluster-ARN nach Restore, DAT-15)
- ☐ `docs/CHANGELOG.md` mit Version `1.0.0`
- ☐ Menüeintrag Website (H-18) erst nach allen obigen Punkten
