# P-15b Neuplanung Fall (b) Transit-Unterbrechung – 04.10.2026 (VM-Prüfstand, echtes NINA 3.2)

Lauf `pnpm vm-bench run vm-replan-transit`, Test-Server-Szenario `replan-transit` (ein langer Regelblock mit 60-s-Belichtungen; Transitfenster ab Minute 15, erst nach der Test-Server-Aktion `lock_transit` in Minute 4 im Plan), Plugin aus `main` 4df4566. Ohne Handgriff; Geräte wie P-14 (Kamera, Montierung, Filterrad Sky Simulator for ALPACA, PHD2, OmniSim Safety Monitor verbunden; Rotator, Fokussierer getrennt).

## Ablauf (NINA-Log, Zeiten UTC)
| Zeit | Ereignis |
|---|---|
| 07:47:36 | `PLAN reason=initial` (ohne Transit) |
| 07:50:04 | `BLOCK_START` Regelblock (L, 60 s, zeitgeführt) |
| 07:51:36 | Test-Server: `lock_transit` (neues targets-ETag im Heartbeat) |
| 07:53:22 | laufende Belichtung **zu Ende** (kein Abbruch, Entscheidung Sven 04.10.2026) → `BLOCK_END reason=transit_interrupt` → `PLAN reason=refresh` |
| 07:53:22–07:58:39 | Regelblock im neuen Plan bis vor den Vorlauf (`completed`) |
| 08:00:33 | `BLOCK_START` Transitblock (Vorlauf) |
| 08:02:36 | `TRANSIT_START` am Fensterbeginn |
| 08:22:04 | `TRANSIT_END`, `PLAN reason=refresh`, Rest `BLOCK_SKIPPED elapsed` |

## Ergebnis
- Aufnahmen: 10 × L im Regelblock, **573 × R** in der Serie, alle mit `transitObservationId`; kein `CAPTURE result=aborted`; keine abgelehnte Anfrage.
- Prüfungen `vm-check.txt`: **alle drei grün**.
- `live-status-transit.jpg`: Live-Status „Running – Test replan-transit – R · 30 s“, rotes Banner *Test mode – safety checks off*, Outbox 0.

Auswertung auf das Log ab dem NINA-Neustart dieses Laufs (07:46:30 UTC): der Agent lieferte die Logdatei von P-14 mit (Auswahl nach Änderungszeit); seitdem kürzt der Prüfstand das Log selbst.

**Ergebnis: Go** (vorbehaltlich Svens Abnahme von AP-44).
