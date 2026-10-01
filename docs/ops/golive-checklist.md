# Go-live-Checkliste (AP-17)

Jeder Punkt mit Nachweis (Link auf CI-Lauf, Ausgabe von `pnpm deploy:prod`, Screenshot, Protokoll). Go-live erst, wenn alle ☑.

**Nachweise:**
- **CI** = grüner Lauf von `ci.yml` auf dem Go-live-Commit; der Test ist angegeben.
- **Prüfung prod** = `pnpm golive:check`, nur lesend, nur Sven; Protokoll unter `docs/test-runs/<Datum>/ap-17/golive-check.md`.
- **Sven** = menschliche Freigabe (Haken setzt nur Sven).

## Infrastruktur
- ☑ CloudFront: HTTPS only, TLS 1.2+; **alle vier Behaviors** tragen eine Response-Headers-Policy (`npm-html` für Default, `npm-api-static` für `/api/*`, `/catalog/*`, `/downloads/*`); HSTS und `nosniff` auch auf `/api/*` und `/downloads/*`; CSP ohne `unsafe-inline` für **Skripte** (für Stile ist es Pflicht, `specs/infra/iam.md` §10); `X-Origin-Verify` am API-Origin erzwungen und gegen den **einen** Wert aus `/nina-pm/origin-verify` geprüft (SV-16) – *CI: `infra/test/assertions.test.ts` (Assertion 6, Distribution TK 4.3), `assertions-02b.test.ts` (Edge/X-Origin-Verify); Smoke nach jedem Deploy (Header aller Behaviors, execute-api → 403)*
- ☐ Website-Distribution E2L6Q80SD8XPT0 unverändert (`aws cloudfront get-distribution-config` Vergleich vorher/nachher) – *Prüfung prod: vor dem Go-live-Deploy `pnpm golive:check --snapshot-website`, danach `pnpm golive:check`; CI: Assertion 7 (kein Template referenziert E2L6Q80SD8XPT0)*
- ☑ Route-53: nur Alias `nina-pm.svenesis.org` neu – *CI: Assertion 7 (nur Präfix `nina-pm`, keine Zone angelegt)*
- ☐ Alarme (16.2) ausgelöst per Test und E-Mail empfangen – *Sven: `pnpm alarm:probe` (Pflichtalarm `StaleRunningSessions` und Stage-`Count`), E-Mail-Eingang im Protokoll nachtragen (H-23); CI: `infra/test/stale-sessions-metric.test.ts` – die Metriken `StaleRunningSessions` und `DsqlRetries` entstehen im Code und lösen die Alarme aus. Health-Check ohne Alarm (Entscheidung Sven, 23.09.2026), DPU-Schwelle nach 4 Wochen Betrieb*
- ☐ Route-53-Health-Check **`/api/health` über CloudFront** grün (nicht direkt auf die HTTP API – dort fehlt `X-Origin-Verify`) – *Prüfung prod*
- ☐ AWS Backup Plan aktiv (täglich, 35 Tage, Standard-Vault; SV-15), letzter Lauf erfolgreich; DSQL-Cluster mit Löschschutz – *Prüfung prod; CI: Backup-Plan und Assertion 10*
- ☑ Eine Datei mit `Content-Type: text/html` unter `catalog/thumbs/` wird vom Browser **nicht** ausgeführt (CSP `default-src 'none'` auf `npm-api-static`) – *CI: Assertion 6 (`npm-api-static` mit `default-src 'none'` und `sandbox`); Prüfung prod: harte CSP auf `/catalog/thumbs/…`*
- ☐ `GET /api/health` (einzige Health-Route, ohne DB-Ping) mit 5 rps/Burst 10 gedrosselt; Auth-Drossel 5 rps/Burst 10 nur auf `GET /api/auth/discord/{proxy+}` und den Einladungsrouten, `/auth/me`, `/auth/context`, `/auth/logout`, `/auth/sessions` unter der Stage-Drosselung; Alarm auf Stage-`Count` existiert und wurde einmal testweise ausgelöst (SV-06, SV-07) – *CI: Assertion 8; Sven: `pnpm loadtest:prod` (Artefakt `loadtest.json`, erwartet 429/403, Parallelität ≤ 20) und `pnpm alarm:probe`*
- ☐ Restore-Probe (H-20) protokolliert – **entfällt** (Entscheidung Sven, 25.09.2026); Runbook `restore.md` vorhanden, beim ersten Ernstfall protokollieren
- ☐ Rollback-Probe: vorherigen Tag lokal deployt, Smoke grün, wieder aktuellen Tag deployt – *Sven, H-23, Runbook `rollback.md`*
- ☐ Kosten: Budget-Alarm aktiv – *Prüfung prod; CI: Budget 20 USD an das Topic*

## Sicherheit
- ☑ CDK-Assertions aus `specs/infra/iam.md` §12 grün (Rollen nur mit den CDK-Grants aus §2–§5, kein `*` auf DSQL/S3/SSM/Invoke, `api` ruft nur `worker` auf, `worker` liest keine Auth-Geheimnisse; SV-13, SV-18) – *CI: `infra/test/assertions*.test.ts`, Nr. 1–10*
- ☑ Direktaufruf der `execute-api`-Adresse liefert 403 (Smoke-Test) – *Smoke nach jedem Deploy*
- ☑ Reservierte Parallelität auf `api` (50, bis 30.09.2026: 20) und `worker` (5) gesetzt – *CI: Assertion 8; Prüfung prod: `get-function-concurrency`*
- ☑ CSP-Abnahme: Radix-Menü und -Dialog hinter produktiven Headern ohne CSP-Verstoß in der Konsole – *CI: `e2e/ui.spec.ts` (`collectCspViolations`)*
- ☑ Uploads als presigned **POST**; ein Upload über der Größengrenze wird von S3 abgelehnt – *CI: `apps/api/test/upload-ticket.test.ts` (`content-length-range`, `eq $key`)*
- ☑ CSRF: schreibende Route ohne `X-NPM-Request` → 403 `auth.csrf_missing`, ebenso anonym `POST /api/auth/invitation/claim` und `/api/auth/invitations/preview` (SV-04) – *CI: `apps/api/test/csrf.test.ts`, `e2e/smoke.spec.ts`; Prüfung prod: beide anonymen Routen*
- ☑ `/api/auth/test-login` in prod → 404 – *Smoke nach jedem Deploy*
- ☑ Rechte-Tests vollständig (jede Route × Rollen) grün – *CI: `apps/api/test/rights.test.ts`, `nina-rights.test.ts`*
- ☑ Mandantenisolation grün – *CI: Isolations-Suite `packages/db/src/testing/isolation.ts` (in `packages/db/test/db.test.ts`), `rights.test.ts` (fremder Mandant), SEC-53 in `nina-sessions.test.ts`*
- ☑ Sitzungen: Logout und „Sitzungen beenden“ wirken sofort, danach `401 auth.unauthenticated` (E2E, SV-01) – *CI: `e2e/auth-flow.spec.ts`, `members.spec.ts`, `tenant-settings.spec.ts`*
- ☑ Owner-Schutz-Tests grün (Admin kann Owner nicht herabstufen/entfernen/sperren) – *CI: `apps/api/test/members.test.ts`*
- ☑ Keine Geheimnisse im Repo (`gitleaks` im CI)
- ☐ Abhängigkeits-Audit ohne kritische Befunde – *`nightly.yml` (`pnpm audit --audit-level critical`); lokal 25.09.2026: 1 niedriger Befund, kein kritischer*
- ☐ Datenschutz/Rechtliches (H-17) freigegeben – *Sven: Freigabe im Chat am 25.09.2026; danach ergänzt: Absatz „Öffentliche Vorschaubilder“ (SEC-28)*

## Funktion (Test-Mandant, echtes Discord, Fake-Plugin)
- ☐ Mandant anlegen → Owner-Einladung → Owner-Login mit 2FA
- ☐ User einladen → User legt Objekt an → einreichen → Stimme eines anderen Users → Admin gibt frei
- ☐ Simulator zeigt Plan; Diagnose plausibel
- ☑ Fake-Plugin-Nacht nach Deploy grün – *`pnpm deploy:prod` (Pflichtschritt seit 25.09.2026)*
- Die Plugin-Nacht P-05 mit Simulatorgeräten ist seit 23.09.2026 Abnahme von AP-16h (Block RP vor R4), nicht Teil dieses Go-live.
- ☐ Benachrichtigung in der App empfangen
- ☐ Visuelle Abnahme (H-16) in **beiden Themes** (hell, dunkel), in allen drei Dichtestufen und bei 768 px sowie bei 2560 px Breite (volle Breite ohne Obergrenze)

**E2E-Kernabläufe R1 (lokaler Stack, CI):**

| Ablauf | Spezifikation |
|---|---|
| AF-01 Rig einrichten | `equipment.spec.ts`, `rigs.spec.ts`, `nina.spec.ts` (Instanz koppeln) |
| AF-02 Projekt planen | `projects.spec.ts`, `project-list.spec.ts` |
| AF-03 Nacht simulieren | `simulator.spec.ts` |
| AF-04 Nacht ausführen | `sessions.spec.ts` (Fake-Plugin-Nacht) |
| AF-06 Session auswerten | `sessions.spec.ts` (Soll/Ist, Kennzeichen, Korrektur) |
| AF-08 Projekt abschließen | `sessions.spec.ts` (verschwindet aus der Auslieferung) |
| AF-11 Objekt einreichen | `my-objects.spec.ts` |
| AF-12 Warteschlange bearbeiten | `queue.spec.ts` |
| AF-13 Mandant und Benutzer verwalten | `system-admin.spec.ts`, `members.spec.ts`, `tenant-settings.spec.ts` |
| AF-14 Abstimmen | `queue.spec.ts` |

AF-05 und AF-09 (Transits, R4), AF-07 (Folgeplanung, R2) und AF-10 (Sitzungsprotokoll, R3) folgen mit ihren Releases.

## Betrieb
- ☑ **Sechs** Runbooks vorhanden (`docs/runbooks/`, geliefert in AP-17, CC5-13): `restore.md` (Restore inkl. Import-Modus `-c dsqlClusterId=…`), `rollback.md` (Deploy zurückrollen), `token-revoke.md` (NINA-Token widerrufen), `superuser-emergency.md` (Super-User-Notfallzugang über `ops-cli`), `owner-reassign.md` (Owner-Neuzuweisung), `dsql-cluster-swap.md` (neuer Cluster-ARN nach Restore, DAT-15)
- ☐ `docs/CHANGELOG.md` mit Version `1.0.0` – *Sven: `pnpm changelog:collect` und Tag `v1.0.0`*
- ☐ Menüeintrag Website (H-18) erst nach allen obigen Punkten – *noch nicht (Entscheidung Sven, 25.09.2026)*
