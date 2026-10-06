# VM-Lauf `real-network` gegen den echten Server – 05.10.2026 (Stufe 2a)

Lauf `pnpm vm-bench run real-network`, Plugin 0.4.4: echter Server lokal, nach 5 min trennt der Server das Netz für 12 min (Anfragen des Plugins bleiben ohne Antwort), danach wieder erreichbar. Geräte wie `real-full-night`, ohne Flat-Panel.

| Zeit (UTC) | Ereignis |
|---|---|
| 17:14 | Erster Versuch: NINA-Absturz 18 s nach dem Anlegen der Session (`coreclr.dll`, `../vm-crashes/`), Wiederholung |
| 17:17:49 | Zweiter Versuch, Sequenz startet |
| 17:22:49 | Netz getrennt (`netz-weg.png` im Laufordner) |
| 17:34:49 | Netz zurück; Session war beim Server `stale` |
| 17:34–17:57 | Plugin setzt die Session fort (`PATCH` 200), meldet 14 Aufnahme-Stapel nach, holt 2 Pläne, Heartbeats 200 |
| 17:57:40 | NINA-Absturz (`coreclr.dll`, gleiche Signatur) – Lauf rot |

**Ergebnis:** Der Prüfgegenstand (Netzausfall, `stale`, Wiederaufnahme, Nachmeldung aus der Outbox) verhielt sich wie spezifiziert. Der Lauf endete durch den bekannten NINA-Absturz der VM vor Flats und Abschluss; diese Teile prüfen `real-full-night` und die kopflosen Läufe. Wiederholung bei stabiler VM offen.
