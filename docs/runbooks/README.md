# Runbooks (AP-17, CC5-13)

Sechs Abläufe für den Betrieb von prod (`nina-pm.svenesis.org`). Alles mit AWS-Zugang führt **nur Sven** lokal mit seinem Admin-Profil aus (H-06); Claude Code deployt nie und ruft keine AWS-Befehle auf.

| Runbook | Wann |
|---|---|
| [restore.md](restore.md) | Datenfehler oder Verlust: Wiederherstellung aus AWS Backup in einen neuen Cluster |
| [rollback.md](rollback.md) | Ein Deploy verursacht Fehler: vorherigen Tag deployen |
| [token-revoke.md](token-revoke.md) | NINA-Token verloren, geleakt oder Rechner ausgemustert |
| [superuser-emergency.md](superuser-emergency.md) | Kein Super User erreichbar, Identität sperren, Sitzungen beenden |
| [owner-reassign.md](owner-reassign.md) | Owner eines Mandanten nicht mehr verfügbar |
| [dsql-cluster-swap.md](dsql-cluster-swap.md) | Der DSQL-Cluster wird ersetzt (neuer ARN) |
