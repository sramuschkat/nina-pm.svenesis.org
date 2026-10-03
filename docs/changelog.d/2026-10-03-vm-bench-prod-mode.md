### VM-Prüfstand: Prod-Modus (P-05/P-11)
- `prod: true` im Lauf: Prod-Profil des Test-Mandanten, kein Test-Server, Stopp nach `untilMin`, 3 min Warten auf die Outbox, Zusammenfassung aus dem NINA-Log (Aufnahmen, Blöcke, Pläne, Sessions, Outbox, abgelehnte Aufrufe, Warnungen). Lauf `p05-prod` (30 min). Den Sync-Token setzt der Prüfstand nie.
