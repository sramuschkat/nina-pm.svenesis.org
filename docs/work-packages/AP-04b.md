# AP-04b – Mandanten, Einladungen, Owner-Invarianten

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-04a · **Menschliche Aufgaben:** H-08, H-12a

## Ziel
Mandanten, Einladungen, Rollen und die Owner-Invarianten sind serverseitig vollständig und gegen Umgehung getestet. Der Test-Mandant kann angelegt werden.

## Anforderungen
FA-SU-05…09, FA-BEN-01…11, TK 5.5

## Lesen (nur diese Abschnitte)
- FK 6.13, 6.14 (Rollen)
- TK 5.4–5.5
- TK 7.2 (Einladungen, Mitglieder, Rollen & Owner, System)
- rules/dsql.md (guard)
- rules/security-auth.md (Rollen)
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `POST /system/v1/tenants` (minimal) + `ops-cli create-tenant`, Owner-Einladung `POST /system/v1/tenants/{id}/invitations` (Rolle owner; optional an eine Discord-User-ID gebunden wie jede Einladung – **keine** Sonderregeln gegen den Super User, E3); das Einlösen setzt `tenant.owner_member_id`, solange es leer ist
- Einladungen als **zwei Routen** (SEC-50): `POST /web/v1/invitations` legt fest `role:'user'` an (`member.manage`, Admin oder Owner), `POST /web/v1/invitations/admin` die Admin-Einladung (`member.admin.manage`, nur Owner) – die Berechtigung darf nie vom Rumpffeld `role` abhängen; Vorschau `POST /auth/invitations/preview` (Aktion `public`), Einlösen im Callback (AP-04a)
- `MemberRepository` mit Owner-Invarianten (`guard` auf `tenant`, `SELECT … FOR UPDATE`): Admin ernennen und entziehen **nur durch den Owner** (`PUT /web/v1/members/{id}/role`), der Owner ist nicht herabstufbar, deaktivierbar oder entfernbar (`409 member.owner_protected`), kann nicht austreten (`409 member.owner_cannot_leave`), und niemand ändert die eigene Rolle (`409 member.cannot_change_self`); Mandant ohne Owner: Owner-Aktionen stehen niemandem zu (TK 5.5)
- **Owner-Übertragung sofort** (E2, FA-BEN-09): `POST /web/v1/tenant/owner-transfer {memberId}` setzt in **einer** Transaktion `tenant.owner_member_id` auf ein aktives Mitglied mit Rolle Admin; der alte Owner bleibt Admin; `change_log` und `notification(owner.reassigned)` an alle Admins; ungültiges Ziel → `owner_transfer.target_invalid`. Notfall-Neuzuweisung `PUT /system/v1/tenants/{id}/owner` (alter Owner standardmäßig deaktiviert)
- Built-in-Mondprofile beim Anlegen des Mandanten
- **`ops-cli` mit den Befehlen aus TK 5.4:** `help`, `create-tenant`, `create-invitation`, `set-owner`, `grant-super-user`, `block-identity`, `revoke-sessions`, `seed --tenant test` (Demo-Daten aus `docs/seed/`), `list-failed-jobs`; jeder Aufruf schreibt `system_audit` mit Akteur `ops_cli` (CC-9)
- Aufräum-Aufgaben in `daily` (abgelaufene Einladungen)

## Nicht im Umfang
- UI (AP-07a–c)

## Automatisierte Abnahme
- [ ] Tests: Admin versucht Owner herabzustufen/deaktivieren/entfernen → `409 member.owner_protected`; Admin ernennt Admin → 403; Owner ändert die eigene Rolle → `409 member.cannot_change_self`; Owner verlässt den Mandanten → `409 member.owner_cannot_leave`; Neuzuweisung deaktiviert alten Owner
- [ ] Owner-Übertragung: an einen aktiven Admin → sofort wirksam, alter Owner bleibt Admin, `owner.reassigned` an alle Admins; an einen User bzw. ein deaktiviertes Mitglied → `owner_transfer.target_invalid`; durch einen Admin → 403
- [ ] Rechte-Tests aller neuen Routen
- [ ] Admin erzeugt über `POST /web/v1/invitations` eine Admin-Einladung → nicht möglich, die Route setzt `role` fest (SEC-50)
- [ ] letzter aktiver Super User entfernen/deaktivieren → `409 super_user.last_protected` (FA-SU-06)
- [ ] jeder `ops-cli`-Befehl schreibt `system_audit` mit Akteur `ops_cli`
- [ ] Owner-Einladung in einem Mandanten mit Owner → beim Einlösen `404 invitation.invalid`; Owner- oder Admin-Einladung mit `max_uses` > 1 → abgelehnt (Schema-CHECK); Notfall-Neuzuweisung benachrichtigt alle Admins einschließlich des bisherigen Owners
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Test-Mandant in prod anlegen, dich als Owner einladen, Login (H-12a); Super-User-Bootstrap mit der Discord-ID aus H-08 prüfen
