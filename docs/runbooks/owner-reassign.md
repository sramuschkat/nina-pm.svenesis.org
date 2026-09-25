# Runbook: Owner eines Mandanten neu zuweisen (FA-BEN-09, FA-SU-05, E2)

**Wann:** Der Owner will abgeben (normaler Fall) oder ist nicht mehr verfügbar (Notfall).

## Normalfall: Owner überträgt selbst

1. Owner: *Verwaltung* → *Mitglieder* (S-70) → *Owner übertragen* → aktiven Admin wählen → Bestätigungsdialog.
2. Wirkt sofort; der bisherige Owner bleibt Admin (E2).

## Notfall: Owner nicht erreichbar (Super User)

1. Als Super User in den **System-Kontext** wechseln (Discord-2FA Pflicht).
2. S-80 *Mandanten* → Mandant wählen → *Owner neu zuweisen* (Begründung Pflicht, Bestätigungsdialog):
   - einem vorhandenen aktiven Mitglied (`PUT /api/system/v1/tenants/{id}/owner`), oder
   - per **neuer Owner-Einladung** (Link wird einmalig angezeigt, sicher übergeben).
3. Alle Admins des Mandanten – einschließlich des bisherigen Owners – werden benachrichtigt (FA-SU-05). Der Vorgang steht im System-Audit (S-82).

## Notfall ohne Super User

1. Erst [superuser-emergency.md](superuser-emergency.md) (Super User ernennen), dann wie oben.
2. Letzte Möglichkeit direkt über `ops-cli` (Mitglieds-ID aus S-70 bzw. der Datenbank):
   ```
   {"command":"set-owner","tenant":"<Mandanten-Schlüssel>","member":"<app_user.id>"}
   ```
   Der bisherige Owner wird dabei deaktiviert.
