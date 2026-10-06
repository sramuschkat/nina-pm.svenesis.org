### Server: kein Lease-Hinweis mehr für die Nachmeldung nach dem Sessionende (2026-10-06)

Anforderungen: FA-SYN-06, FA-AUS-01 (execution.md §8 NIN5-7, NT-14; Rig-Nacht Starfront 06.10.2026, Entscheidung Sven)

- Das Plugin schließt die Session am Nachtende sofort ab und meldet offene Aufnahmen danach nach (`outboxPending > 0`). Mit dem Abschluss gibt der Server die Lease frei und meldete deshalb bisher „Aufnahmen ohne gültige Lease“. Am Rig passierte das jeden Morgen nach den Flats: 10 Flat-Meldungen 30 s nach dem Abschluss.
- Nachmeldungen einer so abgeschlossenen Session gelten bis 6 h nach dem Ende nicht mehr als Konflikt. Das gilt nicht, wenn eine andere Session die Lease hält oder die Session per Admin-Freigabe ausgeschlossen ist.
