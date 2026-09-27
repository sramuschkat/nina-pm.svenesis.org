### Fehler: Prognose schlug in prod fehl („Interner Fehler“, `permission denied for table rig`) (2026-09-27)

Anforderungen: FA-FOL-02, FA-FOL-05, TK 6.2 · Meldung Sven 27.09.2026 (Heute Nacht → „Prognose berechnen“)

- **Ursache:** Der Job `forecast` ersetzt seine Nachtpläne unter dem Wächter `SELECT … FROM rig FOR UPDATE`, weil stündlicher Lauf und „Prognose berechnen“ gleichzeitig laufen können. `FOR UPDATE` verlangt das UPDATE-Recht auf mindestens eine Spalte. Die Rolle des worker (`app_job`) hatte auf `rig` nur SELECT und INSERT. Damit ist die Prognose in prod seit AP-33 nie gespeichert worden, auch nicht stündlich. Die Tests liefen nicht mit der Rolle `app_job`.
- **Behebung:** Migration `0008_rig_sperre_worker`: `GRANT UPDATE (updated_at) ON rig TO app_job` – nur diese eine Spalte, der worker ändert keine Rigs (gleiches Muster wie `discord_channel`). Nachgezogen in TK 6.2 und `src/grants.ts`.
- **Tests:** Die Rechte-Suite (D-02/D-03, PostgreSQL mit der echten Rolle `app_job`) prüft jetzt die Sperre auf `rig` und das weiterhin verbotene Ändern (`UPDATE rig SET name …` → 42501).
- **DSQL-Lint:** Ein GRANT aus einer späteren Migration zählt für die Tabelle mit, ausgeführte Migrationen bleiben unverändert.
