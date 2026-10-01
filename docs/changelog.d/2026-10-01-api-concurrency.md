### Reservierte Parallelität der `api` 50 statt 20 (2026-10-01)

Anforderungen: SV-06, SEC-15, TK 4.2/16.2, `specs/infra/iam.md` §9 · Alarm `nina-pm-api-5xx-rate` 30.09.2026 20:15 UTC, Entscheidung Sven 01.10.2026

- Ursache des Alarms: Ein Aufruf von „Heute Nacht“ nach einer Pause schickte 19 Anfragen in 2 s, alle mit Kaltstart – die `api`-Lambda war mit 20 Instanzen voll, ein gleichzeitiger Health-Check bekam `503` (1 von 73 Anfragen = 1,37 % > 1 %). In der Woche zuvor erreichte die Parallelität bei Arbeit an vielen Stunden 14–20.
- `infra/config.ts`: `reservedConcurrency.api` 50 (worker unverändert 5). Konto-Kontingent 400, danach 345 unreserviert (≥ 100). DSQL-Verbindungen höchstens 100 (Pool 2 je Container). Keine Zusatzkosten (Abrechnung je Aufruf).
- CDK-Assertion, TK 4.2/5/16, `iam.md` §9, `rules/api.md`, Go-live-Checkliste angepasst.
- Folge-PR: weniger parallele Anfragen je Seite (Projekt-Details und Ausrüstungslisten gebündelt).
