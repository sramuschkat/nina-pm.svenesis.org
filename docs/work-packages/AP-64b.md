# AP-64b – Vorhersage je Standort und Nacht („klar, aber nicht genutzt“ auch ohne Session)

**Release:** R6 · **Größe:** S · **Abhängigkeiten:** AP-64 · **Menschliche Aufgaben:** H-22 (DSQL-Protokoll vor dem Deploy)

## Ziel
Der Kalender der Standort-Statistik (AP-64, S-64) markiert eine Nacht als **„klar, aber nicht genutzt“**, wenn die
Vorhersage gut oder besser war, aber unter 1 h belichtet wurde. Bisher war die Vorhersage einer Nacht nur am
Wetter-Schnappschuss einer Session gespeichert – Nächte **ohne** Session konnten diese Klasse nie bekommen. Gerade sie
sind aber die interessanten: klar vorhergesagt, und das Rig lief nicht.

## Anforderungen
FA-AUS-16, FA-AUS-17, S-64 (Ergänzung im Fachkonzept mit diesem Paket)

## Lesen (nur diese Abschnitte)
- `docs/rules/dsql.md` (streng), `docs/rules/api.md`, `docs/rules/testing.md`, `docs/specs/infra/iam.md`
- `docs/work-packages/AP-64.md` (Teil E), FK FA-AUS-16/17 und S-64 über `docs/concept/INDEX.md`
- Code: `apps/api/src/sessions/log.ts` (`captureForecastSnapshot`, `clearNightView`), `apps/api/src/weather/{job,view}.ts`,
  `packages/db/src/repositories/{session-log,weather}.ts`, `apps/api/src/worker/tasks.ts`,
  `apps/web/src/pages/sessions/SiteStatsPage.tsx` (`dayKind`)

## Liefern
- **Migration 0014** (additiv): Tabelle `site_night_forecast` – eine Zeile je (Standort, Nacht) mit `rating_index`
  0…4 (FA-WET-03), `overall_score` (`nightMean`), `model_set`, `recorded_at` (Abrufzeit des Wetter-Caches);
  Primärschlüssel `(site_id, night)` wie `site_night_stat`, FKs ohne ON-DELETE-Aktion, kein weiterer Index. GRANTs
  nach TK 6.2 (Gruppe „Ausführung & Auswertung“). `site_night_stat` bleibt unverändert (CHECK auf `source` ist in
  DSQL nicht änderbar).
- **Writer:** `tick-5min` nach dem Wetter (kein neuer Zeitplan): je Standort aktiver Mandanten die Bewertung der
  **kommenden Nacht** (erste Nacht, deren astronomische Dunkelheit noch nicht begonnen hat) aus der jüngsten
  `weather_cache`-Zeile – **dieselbe Rechnung** wie der Schnappschuss zum Sessionbeginn (`weatherView`, `ratingIndex`,
  `nightMean`). Schreibt nur bei jüngerer Cache-Zeile (idempotent) und ab Beginn der Dunkelheit nicht mehr: Es gilt die
  letzte Vorhersage davor. Repository `recordSiteNightForecast` prüft den Standort gegen den Mandanten.
- **Reader:** `GET /web/v1/sites/{id}/clear-nights` liefert `forecastRatingIndex`/`forecastNightMean` auch für
  Nächte ohne Session; der Schnappschuss einer Session hat Vorrang. Die laufende bzw. bevorstehende Nacht des
  Standorts (Mittag bis Mittag) bleibt ohne gespeicherte Vorhersage.
- **Kalender (Web, `dayKind`):** Nacht ohne Session mit Vorhersage unter „gut“ → **„bewölkt“** (grau, Tooltip „bewölkt
  laut Vorhersage“, Legende „bewölkt (erfasst oder laut Vorhersage)“); ein manueller Eintrag überschreibt das. Nur
  Anzeige: Die Nacht zählt nicht als erfasst, „Nutzbare Nächte“ bleibt unverändert. Ohne Vorhersage „keine Angabe“.
- **Löschen:** Standort löschen nimmt die Vorhersagen mit; Mandant löschen (`TENANT_DELETE_ORDER`) und Betriebsexport
  (`evaluationCounts`) kennen die Tabelle.
- Fachkonzept FA-AUS-17 und S-64 (Ergänzung 07.10.2026), TK 6.2 und `tick-5min`, Schema und INDEX, Changelog.

## Nicht im Umfang
- **Treffsicherheit („Vorhersage stimmte“) bleibt bei Nächten mit Session.** FA-AUS-16 vergleicht Vorhersage mit
  „gemessen/beobachtet“; ohne Session ist nichts beobachtet. Eine Nacht ohne Session ist darum kein Fehltreffer,
  sondern „klar, aber nicht genutzt“. Neu ist nur: Fehlt einer Session der Schnappschuss, zählt die gespeicherte
  Vorhersage der Nacht.
- Nachträgliches Befüllen vergangener Nächte (der Wetter-Cache hält nur die kommenden Tage).

## Entscheidung (Sven, 07.10.2026)
„Klar, aber nicht genutzt“ = Vorhersage gut oder besser, aber unter 1 h belichtet – auch für Nächte ohne Session. Dafür
wird die Vorhersage je Standort und Nacht gespeichert. Nächte ohne Session mit Vorhersage unter „gut“ erscheinen
automatisch als „bewölkt“ (nur Anzeige); ein manueller Eintrag überschreibt das.

## Automatisierte Abnahme
- [x] DSQL-Lint (`pnpm db:lint`), Migrationsliste und `bundled.ts`, Rechte unter `app_job` (`job-role.test.ts`),
  Mandant-Löschen gegen das Schema (`tenant-delete.test.ts`).
- [x] API (PGlite, `site-night-forecast.test.ts`): Writer mit derselben Bewertung wie `weatherView`, idempotent, nach
  Beginn der Dunkelheit unverändert, fremder Standort `no_site`, Standort löschen; Reader: Nacht ohne Session mit guter
  Vorhersage, Vorrang des Schnappschusses, laufende Nacht ohne, Treffsicherheit nur mit Session, Mandantenbindung.
- [x] Vitest Web: `dayKind` für Nächte nur mit Vorhersage (gut → klar, nicht genutzt; darunter → bewölkt; ohne → keine
  Angabe); Kalender mit Tooltip und Legende, Kachel „davon klar, ungenutzt“, „Nutzbare Nächte“ unverändert.
- [ ] `pnpm test:dsql`-Protokoll für Migration 0014 (Sven, H-22), CI grün.

## Menschliche Aufgaben
- **H-22:** `pnpm test:dsql` mit Migration 0014 lokal ausführen und das Protokoll (`docs/test-runs/<datum>/ap-03/`)
  committen – **vor** `pnpm deploy:prod` (der Deploy verlangt es).
- Nach dem Deploy füllt sich die Tabelle ab der nächsten Nacht; „klar, aber nicht genutzt“ ohne Session erscheint
  erstmals am Morgen danach (H-16, Sichtprüfung im Kalender).
