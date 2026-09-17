# AP-04a – Anmeldung mit Discord und Sitzungen

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-05 · **Menschliche Aufgaben:** H-05, H-07, H-08

## Ziel
Anmeldung über Discord mit eigenen Tokens, Refresh-Rotation und Karenz funktioniert in prod. Super User werden per Bootstrap angelegt; der Test-Login existiert nur lokal.

## Anforderungen
FA-LOG-01…11, FA-SU-01…04, TK 5.1–5.4

## Lesen (nur diese Abschnitte)
- FK 6.13 (Anmeldung)
- TK 5.1–5.4
- rules/security-auth.md
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `/auth/discord/start|callback`, Identität anlegen/aktualisieren, `auth_session`, Cookies, JWT (kid-Rotation), `POST /auth/refresh` mit Rotation + 60 s Karenz + Wiederverwendungserkennung, `POST /auth/context` (Mandant/System ≤ 12 h), `logout`, `GET /auth/me`, Sitzungsliste
- Super-User-Bootstrap aus SSM `/nina-pm/bootstrap-super-users`, 2FA-Pflicht
- `mver`/`sid`/Befristungsprüfung mit 60-s-Cache
- Test-Login nur im lokalen Node-Adapter (Build-Konstante)
- `login_audit`, Rate-Limit Anmeldung
- Playwright-Grundgerüst (Config, lokaler Stack, ein Smoke-Test) – AP-06a erweitert es für die UI (CC-5)
- Frontend-Hilfen: Single-Flight-Refresh (`navigator.locks`) als Paket `apps/web/src/auth` (ohne UI)

## Nicht im Umfang
- Mandanten/Einladungen (AP-04b), UI (AP-06a)

## Automatisierte Abnahme
- [ ] Unit/Integration: Rotation, Karenz, Wiederverwendung sperrt **nur die Sitzungsfamilie**, System-Kontext läuft ab, 12-h-Regel für Owner-Aktionen
- [ ] Integrationstest (Node, ohne Browser): zwei parallele Refreshes derselben Sitzung → beide erfolgreich, nur eine Rotation
- [ ] Smoke prod: `/api/auth/test-login` → 404
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Login mit echtem Discord in prod als Super User
