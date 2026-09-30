### Rollenansicht „Als User ansehen“ (2026-09-30)

Anforderungen: security-auth.md, SV-03, TK 5.2 · Wunsch Sven 30.09.2026 („jederzeit in die Userrolle und wieder zurück wechseln, um zu sehen, was ein User sieht, und userbezogene Sachen zu testen“)

- **Benutzermenü → „Als User ansehen“** für Admins und Owner mit 2FA (auch Super User mit dieser Mitgliedschaft): die eigene Sitzung wirkt im Mandanten mit **User-Rechten** – serverseitig (Routen, `can()`), nicht nur in der Oberfläche. Hinweisbalken „Rollenansicht …“ mit **Zurück zur Owner-/Admin-Ansicht**; im Benutzermenü „(User-Ansicht)“.
- Nur Herabstufung, nur die eigene Sitzung (andere Geräte unberührt), Mandantenwechsel beendet die Ansicht. Keine Impersonation anderer Mitglieder. Die gespeicherte Rolle bleibt unverändert; als User angelegte Objekte gehören weiter einem selbst (Vier-Augen-Regel beim Freigeben gilt).
- Neu: `POST /api/auth/view-as {asUser}`, `MeResponse.member.viewAsUser`, Spalte `auth_session.acting_role` (**Migration 0011**, additiv ohne DEFAULT).
- Tests: API (Umschalten, Admin-Route verweigert, Owner ohne Owner-Rechte, User/ohne 2FA verweigert, Kontextwechsel beendet), generierter Rechte-Test, Shell, E2E `view-as.spec.ts`.
- **Vor dem Deploy:** `pnpm test:dsql` für Migration 0011 (Protokoll unter `docs/test-runs/` in `main`).
