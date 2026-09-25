# Runbook: Restore aus AWS Backup (TK 6.10, DAT5-16, SV-15, SV-19)

**Wann:** Datenfehler oder Datenverlust in der Datenbank. **RPO 24 h** (tägliche Sicherung, 35 Tage Aufbewahrung, Standard-Vault; kein Point-in-Time-Restore). Code-Fehler ohne Datenschaden → [rollback.md](rollback.md).

**Wer:** Sven, lokal mit Admin-Profil (H-06). Dauer grob 30–60 min, abhängig von der Datenmenge.

> Die einmalige Restore-Probe (H-20) entfällt nach Entscheidung von Sven (25.09.2026). Dieses Runbook ist deshalb nicht geprobt – beim ersten Ernstfall jeden Schritt mit Uhrzeit notieren und das Protokoll unter `docs/test-runs/<Datum>/restore/` ablegen.

## 1. Vorbereiten

1. Wartungshinweis setzen (S-82 *System-Audit* → Wartungsbanner), z. B. „Wiederherstellung läuft – Aufnahmen werden danach nachgemeldet“.
2. Zeitpunkt des Schadens bestimmen; der Wiederherstellungspunkt muss **davor** liegen.
3. Aktuelle Cluster-ID notieren (`infra/cdk-outputs.json` → `NinaPm-Data.DsqlClusterArn`, letzter Pfadteil).

## 2. Wiederherstellen (über den ARN des Wiederherstellungspunkts)

1. AWS-Konsole → **AWS Backup** → Vault **Default** → Ressource `nina-pm`-Cluster → Wiederherstellungspunkt wählen → **ARN kopieren**.
2. *Restore* auslösen (Konsole, über diesen ARN). AWS Backup legt einen **neuen Cluster mit neuem ARN** an; der alte bleibt unverändert.
3. Warten, bis der neue Cluster `ACTIVE` ist; neue **Cluster-ID** und **Endpunkt** notieren.
4. Am neuen Cluster **Löschschutz einschalten** (Konsole bzw. `aws dsql update-cluster --identifier <neue ID> --deletion-protection-enabled`).

## 3. Anwendung auf den neuen Cluster umstellen

1. SSM-Parameter umstellen:
   ```
   aws ssm put-parameter --name /nina-pm/dsql-endpoint --type String --overwrite --value <neuer Endpunkt>
   ```
2. Deploy im **Import-Modus** – der Data-Stack übernimmt den vorhandenen Cluster, IAM-Grants, Backup-Auswahl und Alarme hängen am **ARN** und ziehen mit:
   ```
   pnpm deploy:prod -c dsqlClusterId=<neue ID>
   ```
   `migrate` läuft mit: legt Rollen und `AWS IAM GRANT` idempotent an und prüft das Schema. Danach Smoke-Test und Fake-Plugin-Nacht (Pflicht, `TEST_RIG_TOKEN`).
3. **Sofort per PR** `"dsqlClusterId": "<neue ID>"` in `infra/cdk.context.json` eintragen und landen. Ohne diesen Eintrag legt der nächste Deploy ohne `-c` einen **neuen, leeren** Cluster an (der Skript-Hinweis erinnert daran).
4. Details zum Tausch: [dsql-cluster-swap.md](dsql-cluster-swap.md).

## 4. Daten nachholen

1. Wartungshinweis ändern: „Bitte im NINA-Plugin *erneut hochladen ab Datum* <Datum des Wiederherstellungspunkts> ausführen“. Das Plugin behält gesendete Meldungen 14 Tage; der idempotente Ingest übernimmt nur Fehlendes (TK 6.6).
2. Stichprobe: S-60 Sessions der letzten Nächte, Zähler eines aktiven Projekts, jüngster Eintrag im Änderungsprotokoll (S-72).
3. Wartungshinweis entfernen.

## 5. Aufräumen

- Alten Cluster **frühestens nach 7 Tagen** löschen (DAT-15): Löschschutz bewusst ausschalten, dann löschen.
- Protokoll mit Zeiten je Schritt ablegen.
