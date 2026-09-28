-- Migration 0009 – Rang offener Änderungsanträge für den worker (Fehler 28.09.2026: Zeitplan `tick-hourly`,
-- Aufgabe `submission_expiry` → „permission denied for table change_request“).
-- Verfällt eine Einreichung, nummeriert `renumberRanks` die gemeinsame Rangfolge des Einreichers neu (FA-FRG-15):
-- eingereichte Projekte **und** offene Änderungsanträge (AP-32b). Hat der Einreicher einen offenen Antrag, schreibt
-- der worker `change_request.submitter_rank`. `app_job` bekommt UPDATE nur für diese eine Spalte – Inhalt, Status
-- und Entscheidung eines Antrags ändert der worker nicht (TK 6.2, gleiches Muster wie 0008 und `discord_channel`).
-- statement
GRANT UPDATE (submitter_rank) ON change_request TO app_job;
