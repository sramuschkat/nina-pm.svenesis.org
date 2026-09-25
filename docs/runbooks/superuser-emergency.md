# Runbook: Super-User-Notfallzugang über `ops-cli` (TK 5.4, E3, FA-SU-06)

**Wann:** Kein Super User kann sich anmelden, eine Identität muss sofort gesperrt oder alle Sitzungen einer Identität beendet werden.

`ops-cli` ist eine Lambda ohne Route und ohne Function-URL; nur Sven ruft sie mit seinem Admin-Profil auf. Ausgaben können Einladungslinks enthalten → Ausgabedatei nach dem Lesen löschen, nie teilen.

## Aufruf

```
aws lambda invoke --function-name nina-pm-ops-cli --region eu-central-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '<JSON>' out.json && cat out.json && rm out.json
```

## Befehle

| Zweck | Nutzlast |
|---|---|
| Übersicht aller Befehle | `{"command":"help"}` |
| Super User ernennen (die Identität muss sich einmal angemeldet haben) | `{"command":"grant-super-user","discordId":"<Discord-ID>"}` |
| Identität systemweit sperren (beendet alle Sitzungen) | `{"command":"block-identity","discordId":"<Discord-ID>"}` |
| Sperre aufheben | `{"command":"block-identity","discordId":"<Discord-ID>","unblock":true}` |
| Alle Sitzungen einer Identität beenden | `{"command":"revoke-sessions","identity":"<Discord-ID oder identity.id>"}` |

## Danach

1. Mit dem ernannten Super User anmelden (Discord-2FA ist Pflicht) und in S-81 prüfen.
2. Überzählige Super User in S-81 wieder entziehen; der letzte Super User bleibt geschützt (FA-SU-06).
3. Vorgang im System-Audit (S-82) nachvollziehen.
