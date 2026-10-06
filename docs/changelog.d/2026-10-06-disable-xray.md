### Kein X-Ray mehr (2026-10-06)

Anforderungen: TK 16.1, SV-13 (Entscheidung Sven 06.10.2026)

- Alle vier Lambdas laufen ohne X-Ray (`tracing: DISABLED`). Ohne eigene Sampling-Regel zeichnete X-Ray bei unserem geringen Verkehr praktisch jeden Aufruf auf (AWS-Standard: die erste Anfrage je Sekunde); das Free Tier für Oktober war nach 6 Tagen zu 90 % verbraucht. Diagnose läuft über die strukturierten Logs (`durationMs`) und die Metriken.
- Damit entfallen `xray:PutTraceSegments`/`xray:PutTelemetryRecords` auf `*` in den Lambda-Rollen (Sicherheitsanalyse 05.10.2026, B-08). TK 16.1 und der IAM-Abschnitt nachgezogen; neue Infra-Prüfung „keine X-Ray-Rechte“.
