# AP-12a – Freigabe-Workflow: API, Stimmen, Rangfolge

**Release:** R1 · **Größe:** L · **Abhängigkeiten:** AP-11a, AP-06b · **Menschliche Aufgaben:** –

## Ziel
Der Freigabe-Workflow mit Stimmen, Rangfolge und Verlauf ist serverseitig vollständig; nur freigegebene, aktive Projekte mit Planungsbedarf werden ausgeliefert.

## Anforderungen
FA-FRG-01…16, FK 6.14

## Lesen (nur diese Abschnitte)
- FK 6.14
- TK 7.2 (Warteschlange, Freigabe, Entwürfe)
- rules/dsql.md (guard project)
- TK 6.3
- contracts/errors.json
- contracts/enums.json
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- submit/withdraw/approve/return/reject mit If-Match; keine Freigabe eigener Objekte (Einstellung)
- `queue_vote` (eine Stimme je Mitglied/Objekt, nicht eigenes), `vote/acknowledge`, „geändert seit deiner Stimme“ bei Admin-Änderungen + Benachrichtigung an Einreicher und Stimmende
- `PUT /web/v1/me/submission-ranking`
- `GET /web/v1/queue` mit votes, submitterRank, planSummary; `effort` und `suggestedPriorityPosition` als `null` bis AP-13e
- Freigabe-Verlauf mit Endstand der Stimmen, Stimmen/Rang nach Entscheidung geschlossen
- `isDeliverable()` über Planungsbedarf (TK 6.3)

## Nicht im Umfang
- Änderungsanträge, Auswirkungsvorschau (R3)

## Automatisierte Abnahme
- [ ] Tests: eigene Stimme → 409 vote.own_object; Stimme nach Entscheidung → 409 vote.closed; paralleles Abstimmen/Entscheiden konsistent (guard)
- [ ] `isDeliverable` erst nach Freigabe
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
– (keine; PR-Review genügt)
