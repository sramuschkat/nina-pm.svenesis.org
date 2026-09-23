# AP-04a – Anmeldung mit Discord und Sitzungen

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-05 · **Menschliche Aufgaben:** H-05, H-07, H-08

## Ziel
Anmeldung über Discord (mit PKCE) und serverseitige Sitzungen funktionieren in prod; jede Anfrage prüft Sitzung, Rolle und Status frisch aus der Datenbank. Super User werden per Bootstrap angelegt; der Test-Login existiert nur lokal.

## Anforderungen
FA-LOG-01…11, FA-SU-01…04, TK 5.1–5.4

## Lesen (nur diese Abschnitte)
- FK 6.13 (Anmeldung)
- TK 5.1–5.4
- TK 17 (Berechtigungen, Test-Login)
- rules/security-auth.md
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `/auth/discord/start|callback` mit `state` **und PKCE (S256)** im signierten Cookie `__Host-npm_oauth` (10 min, HMAC mit `/nina-pm/oauth/cookie-secret`, SV-02), `next` nur als relativer Pfad; Identität anlegen/aktualisieren inkl. `mfa_enabled` und `last_login_at`; Einladungs-Cookie `__Host-npm_invite` über `POST /auth/invitation/claim` (TK 5.2)
- **Serverseitige Sitzung** (SV-01): Sitzungs-ID mit 256 Bit im Cookie `__Host-npm_sid` (HttpOnly, Secure, SameSite=Lax, Path=/), in `auth_session` nur `session_hash` = SHA-256; Ablauf **14 Tage Inaktivität** und **30 Tage** höchstens (Konstanten `SESSION_IDLE_DAYS`/`SESSION_MAX_DAYS` in `packages/shared`), `last_seen_at` höchstens alle 5 min schreiben (OCC-Konflikt dabei ignorieren); abgelaufene Zeilen bei der Anmeldung aufräumen
- Sitzungsprüfung je Anfrage (ersetzt den Stub aus AP-05): **eine** indizierte Abfrage liest Sitzung, Mitgliedschaft (Rolle, Status, Owner), `identity.status`, `identity.mfa_enabled`, `tenant.status` und im System-Kontext `super_user.status` – **kein Cache**; Ergebnis `AuthContext` nach TK 5.3; ohne 2FA wirkt ein Admin oder Owner als User (`mfaRequired`, SV-03)
- `POST /auth/context` (Mandant bzw. System, schreibt in dieselbe Sitzungszeile), `POST /auth/logout`, `GET /auth/me` (inkl. wirksamer Rolle und `mfaRequired`), `GET/DELETE /auth/sessions[/{id}]` (Sitzungsliste mit Gerät, gekürzter IP, `createdAt`, `lastSeenAt`)
- Super-User-Bootstrap aus SSM `/nina-pm/bootstrap-super-users` (erste Anmeldung mit 2FA legt `super_user` an, `system_audit` mit Aktion `super_user.bootstrap`); System-Kontext nur mit 2FA
- Test-Login nur im lokalen Node-Adapter (Build-Konstante)
- Playwright-Grundgerüst (Config, lokaler Stack, ein Smoke-Test) – AP-06a erweitert es für die UI (CC-5)
- Frontend-Hilfe `apps/web/src/auth` (ohne UI): `401 auth.unauthenticated` → Anmeldeseite mit `next` = aktueller Pfad; keine Token-Erneuerung im Browser (TK 5.3)

## Nicht im Umfang
- Mandanten und Einladungsverwaltung (AP-04b), UI (AP-06a)

## Automatisierte Abnahme
- [ ] Sitzung: Logout, `DELETE /auth/sessions/{id}` und Rollenwechsel wirken ab der nächsten Anfrage (Integrationstest, Node ohne Browser)
- [ ] Ablauf: 14 Tage ohne Anfrage bzw. 30 Tage nach der Anmeldung → `401 auth.unauthenticated` (Uhr im Test verstellt); `last_seen_at` wird innerhalb von 5 min nur einmal geschrieben
- [ ] In der Datenbank steht nur `session_hash`; das Cookie trägt `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` und den Präfix `__Host-`
- [ ] OAuth: falscher `state`, fehlender oder falscher `code_verifier`, manipuliertes Cookie → Abbruch; `next` mit fremdem Host wird verworfen, ebenso `//host/…` und `/\host/…` (Muster `^/(?![/\\])`)
- [ ] Admin ohne 2FA verhält sich wie User (`GET /auth/me` meldet `mfaRequired`); System-Kontext ohne 2FA → `auth.mfa_required`
- [ ] gesperrte Identität → `403 auth.identity_blocked`; gesperrter Mandant → `403 tenant.locked`
- [ ] Smoke prod: `/api/auth/test-login` → 404
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Login mit echtem Discord in prod als Super User
