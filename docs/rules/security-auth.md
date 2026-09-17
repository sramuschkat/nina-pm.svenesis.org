# Regeln: Sicherheit und Anmeldung

Quelle: TK 5, 15; FK 6.13/6.14.

- Anmeldung **nur Discord OAuth2** (vertraulicher Client, Scope `identify`, `state` im signierten Cookie `__Host-npm_oauth`; Discord-Access-Token wird nicht gespeichert), keine Passwörter, keine E-Mail-Anmeldung.
- Access-JWT HS256 mit `kid`, 15 min (Cookie `__Host-npm_at`, HttpOnly, Secure, SameSite=Lax), Refresh-Token rotierend (Cookie `__Host-npm_rt`, SameSite=Strict, 30 Tage rollierend, Inaktivität laut Mandant), nur Hash in `auth_session`, `prev_refresh_hash` mit 60 s Karenz; Wiederverwendung außerhalb der Karenz → alle Sitzungen der Familie beenden.
- Client-Refresh als Single-Flight über `navigator.locks` (Fallback: BroadcastChannel).
- Claims laut TK 5.3: `sub`, `sid`, `ctx`, `tid`, `mid`, `role`, `own`, `mver`, `su`, `mfa`, `mfaRequired`, `ver`. Prüfung `mver`/`sid`/Befristung je Anfrage (Cache 60 s; ohne Cache für `member.*`, `tenant.owner.transfer`, `tenant.security`, `queue.decide`).
- Systemkontext (Super User) max. 12 h, eigener Kontextwechsel, jede Aktion im System-Audit.
- **Owner-Invarianten**: genau ein Owner, immer aktiver unbefristeter Admin; keine Mandantenrolle darf den Owner ändern (`409 member.owner_protected`); nur der Owner verwaltet Admins, Sicherheit, Übertragung; Owner ändert sich nie selbst.
- Berechtigungen: jede Route deklariert `meta.action`; `can()` aus `packages/shared` im Backend erzwungen, im Frontend nur zum Ausblenden. Generierter Rechte-Test je Route × Rolle.
- CSRF: Header `X-NPM-Request: 1` bei schreibenden Methoden **und** Herkunftsprüfung (`Sec-Fetch-Site: same-origin`, sonst `Origin` gegen `https://nina-pm.svenesis.org`; fehlt beides → `403 auth.origin_invalid`); ausgenommen nur `/auth/discord/start|callback` und die NINA-API (Bearer, kein Cookie). `X-Origin-Verify` von CloudFront prüft die Lambda-Middleware gegen **beide** SSM-Werte (Rotation, TK 5.3).
- Discord-2FA-Pflicht für Admins (`mfaRequiredForAdmins`) ist **standardmäßig aktiv** (FA-LOG-07); Super User und Owner-exklusive Aktionen verlangen sie immer.
- NINA-Token `npm_<base62>`: nur Hash + Präfix speichern, einmal anzeigen, an ein Rig gebunden.
- Geheimnisse nur in SSM SecureString mit dem Schlüssel `alias/nina-pm-ssm`; nie in Code, Logs, Frontend, Discord-Meldungen, Tests. Logs ohne Tokens/Cookies/Webhook-URLs (Redaktion in Logger).
- **Least Privilege ist spezifiziert, nicht improvisiert:** Rollen, Aktionen und Ressourcen je Lambda stehen in `specs/infra/iam.md`. Was dort nicht steht, wird **nicht** vergeben – fehlt ein Recht, wird die Spec ergänzt, nicht die Politik im Code erweitert. `"Resource": "*"` ist in einer `Allow`-Anweisung verboten (CDK-Assertion). `api` darf `lambda:InvokeFunction` nur auf `worker`; `worker` erhält keinen Zugriff auf `/nina-pm/jwt/*`, `discord/client-secret` und `bootstrap-super-users`; `dsql:DbConnectAdmin` trägt nur die nicht automatisch laufende Lambda `db-bootstrap`.
- Uploads nur als **presigned POST** mit `content-length-range`; vor dem Parsen `GetObjectAttributes` prüfen; JSON streamend lesen mit Tiefen- und Anzahlgrenzen (TK 7.1).
- `AUTH_TEST_MODE` / `/auth/test-login` nur im lokalen Node-Adapter; CDK-Assertion + Smoke-Test `404` in prod.
- Rate-Limits: API GW je Route; Anmelde-/Einladungs-Endpunkte zusätzlich über `login_audit`.
- Keine Laufzeit-Referenzen auf www.svenesis.org; Website und deren CloudFront-Distribution nie ändern.
