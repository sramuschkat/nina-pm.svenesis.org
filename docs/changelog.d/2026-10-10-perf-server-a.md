### Performance Paket A: Indizes, Verbindungspool, Kaltstart, „Heute Nacht“ parallel (2026-10-10)

Basis: AWS-Logs der letzten 24 h, p50/p95 je Pfad (Sven, 10.10.2026), dazu die Analyse des API-Codes.

- **Migration 0016:** Indizes `ix_capture_session (tenant_id, session_id, captured_at)` und `ix_capture_project (tenant_id, project_id, captured_at)`.
  - Beide standen im Datenmodell, keine Migration legte sie an.
  - Ohne sie lasen diese Abfragen alle Aufnahmen des Mandanten: Session-Detail, Nächte-Zusammenfassung, Reiter „Bilder“, letzte Aufnahme auf „Heute“, Bildbewertung und das Ist der Nacht.
  - Dazu `ix_night_plan_rig_origin` für die gespeicherte Prognose (`/tonight`, `/forecast`).
- **DSQL-Pool 2 → 6:** Parallele Abfragen einer Route (`Promise.all`) liefen mit 2 Verbindungen praktisch nacheinander. Verbindungen kosten bei DSQL nichts.
- **Kaltstart:** Die API-Lambda baut SSM-Parameter und die erste DSQL-Verbindung schon in der Init-Phase auf. Vorher zahlte sie der erste Aufruf je Container: p95 billiger Aufrufe 730–830 ms bei p50 50–110 ms.
- **`/tonight`:** Rigs werden parallel statt nacheinander berechnet.
- Keine Änderung an Verträgen oder IAM.
