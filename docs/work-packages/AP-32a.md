# AP-32a – Mehrnacht-Simulation und Auswirkungsvorschau als Jobs

**Release:** R3 · **Größe:** M · **Abhängigkeiten:** AP-31 · **Menschliche Aufgaben:** –
Teil 1 von [AP-32](AP-32.md) (Aufteilung: Entscheidung Sven 26.09.2026).

## Ziel
Mehrnacht-Simulation (S-40) und Auswirkungsvorschau vor der Freigabe (S-33) laufen als Jobs.

## Anforderungen
FA-SIM-04, FA-FRG-05

## Lesen (nur diese Abschnitte)
- FK 6.7, 6.14 · TK 7.4, 13 (SV-06) · rules/ui.md · specs/ui/components.md
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- Reine Mehrnacht-Rechnung `simulateNights` (`packages/shared`): je Nacht `planNight` mit allen
  Projekten des Rigs (Konkurrenz), der Restbedarf wird fortgeschrieben (simulierte Frames als `pending`);
  optional mit Wettergewichtung aus der Nachtbewertung (FK 8.5: ≥ 65 % → 1,0 · 45–65 % → 0,5 · < 45 % → 0,1;
  Nächte ohne Vorhersage ungewichtet und gekennzeichnet).
- Jobs `multi_sim` (`POST /web/v1/simulations/multi` → `202 {jobId}`, `simulation.run`, höchstens 14 Nächte,
  optional eigene Entwürfe/Einreichungen) und `impact` (`POST /web/v1/queue/{kind}/{id}/impact` → `202`,
  `queue.decide`, 14 Nächte mit und ohne das eingereichte Objekt auf dem Wunsch-Rig: Anteil des Objekts,
  Verschiebung der Fertigstellung anderer Projekte). Deduplizierung und höchstens 3 offene Jobs je Mitglied
  bestehen seit AP-05/SV-06.
- Ergebnis als JSON in S3 `tenant/<tid>/jobs/<jobId>.json` (Worker), Abruf über
  `GET /web/v1/jobs/{id}/result` (Server liest S3 – kein CORS am Daten-Bucket nötig).
- S-40: Reiter bzw. Bereich *Mehrnacht* (7/14 Nächte, Wetter gewichten, eigene Entwürfe); S-33: Auswirkungsvorschau
  im Detail eines eingereichten Objekts (Admin).

## Nicht im Umfang
- Änderungsanträge (AP-32b), Auswirkungsvorschau für Änderungsanträge (AP-32b).

## Automatisierte Abnahme
- [ ] Mehrnacht-Tests (Fortschreibung, Konkurrenz, Wettergewichtung), Job-Tests (202, Deduplizierung, Ergebnis)
- [ ] CI grün, Changelog, AP- und Anforderungs-IDs im PR
