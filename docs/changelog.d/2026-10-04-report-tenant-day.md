### Projektbericht: Zeitraum nach dem Tag des Mandanten
- Die Abfrage wartet auf den geladenen Mandanten. Vorher galt „heute“ zuerst in UTC, nach dem Laden in der Zeitzone des Mandanten; zwischen Mitternacht dort und in UTC lud der Bericht doppelt, und der Test war rot (CI auf `main`, 03.10.2026 nach 22:00 UTC).
