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
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `POST /system/v1/tenants` (minimal) + `ops-cli create-tenant`, Owner-Einladung `POST /system/v1/tenants/{id}/invitations`
- Einladungen (`/web/v1/invitations`, Vorschau `/auth/invitations/{token}`), Annahme im Callback
- `MemberRepository` mit Owner-Invarianten (`guard` auf `tenant`), Rollen setzen/befristen/entziehen, Owner-Übertragung (anfordern/annehmen/abbrechen), Notfall-Neuzuweisung `PUT /system/v1/tenants/{id}/owner`
- Built-in-Mondprofile beim Anlegen des Mandanten
- `tenant.owner_state` (pending bis Annahme; Sperre der Owner-Aktionen, Hinweis an Super User über `notification.recipient_identity_id` bei Verfall)
- **`ops-cli` vollständig** (TK 5.4): `help`, `create-tenant`, `create-invitation`, `set-owner`, `block-identity`, `grant-super-user`, `revoke-sessions`, `unlock-tenant`, `seed --tenant test`, `revoke-nina-token`; jeder Aufruf mit `system_audit` (CC-9)
- Aufräum-Aufgaben in `daily`
- Test-Mandant-Befehl `ops-cli seed --tenant test`

## Nicht im Umfang
- UI (AP-07a–c)

## Automatisierte Abnahme
- [ ] Tests: Admin versucht Owner herabzustufen/deaktivieren/entfernen → 409; Admin ernennt Admin → 403; Owner ändert sich selbst → 409; Übertragung atomar; Neuzuweisung deaktiviert alten Owner
- [ ] Rechte-Tests aller neuen Routen
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Test-Mandant in prod anlegen, dich als Owner einladen, Login (H-12a); Super-User-Bootstrap mit der Discord-ID aus H-08 prüfen
