# Runbook: DSQL-Cluster tauschen (neuer ARN, DAT-15, SV-19)

**Wann:** Nach einem Restore ([restore.md](restore.md)) oder wenn der Cluster aus anderem Grund ersetzt wird. Jeder neue Cluster hat einen **neuen ARN** – alles, was daran hängt, muss mitziehen.

## Was am ARN hängt

| Stelle | Wie es mitzieht |
|---|---|
| IAM-Grants der Lambdas (`dsql:DbConnect`, `DbConnectAdmin`) | CDK-Grants auf den Cluster im Data-Stack → Deploy im Import-Modus |
| Rollen `app_rw`/`app_job` und `AWS IAM GRANT` (Migration 0000) | `migrate` läuft beim Deploy mit und legt sie idempotent an |
| AWS-Backup-Auswahl | Backup-Plan wählt per Cluster-ARN → Deploy |
| Endpunkt für die Lambdas | SSM `/nina-pm/dsql-endpoint` (von Hand, Schritt 2) |
| Alarme | hängen an Metriken, nicht am Cluster – keine Änderung |

## Ablauf (Sven, lokal, Admin-Profil)

1. Neuer Cluster `ACTIVE`, **Löschschutz an**.
2. `aws ssm put-parameter --name /nina-pm/dsql-endpoint --type String --overwrite --value <neuer Endpunkt>`
3. `pnpm deploy:prod -c dsqlClusterId=<neue ID>` – `cdk diff` zeigt: Data-Stack übernimmt den Cluster, Grants und Backup-Auswahl auf den neuen ARN. Smoke-Test und Fake-Plugin-Nacht grün.
4. PR: `"dsqlClusterId": "<neue ID>"` in `infra/cdk.context.json` – damit bleibt der Import-Modus für alle späteren Deploys. **Ohne diesen Eintrag legt der nächste Deploy einen neuen, leeren Cluster an.**
5. `pnpm golive:check` → Löschschutz und letzter Backup-Lauf des neuen Clusters prüfen (der erste Lauf erfolgt in der nächsten Sicherungsnacht).
6. Alten Cluster frühestens nach **7 Tagen** löschen: Löschschutz bewusst ausschalten, dann löschen.
