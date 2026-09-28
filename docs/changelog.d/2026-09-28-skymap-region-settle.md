### Sternkarte: Katalogregion erst nach Stillstand laden (2026-09-28)

Anforderungen: FA-FRM-09, NFA (Last/Drosselung, TK 4.1) · Befund aus den CloudWatch-Logs vom 25.09.2026

- **Befund:** Am 25.09. bekam die Sternkarte in drei kurzen Schüben 49 Antworten mit `503`. Die `api` lief dabei an ihrer reservierten Parallelität von 20. Die Drosselungen (Throttles) stimmen genau mit den 503 überein. Auslöser war `/api/web/v1/dso/region` mit bis zu 125 Anfragen in 12 Sekunden: Beim Ziehen und Zoomen ändert sich der Anfrage-Schlüssel der Region laufend, und jede Zwischenstellung startete eine eigene Anfrage.
- **Behebung:** Der Regions-Schlüssel wird erst weitergegeben, wenn die Ansicht 300 ms stillsteht (`useSettled`, `REGION_SETTLE_MS`). Der erste Wert beim Öffnen gilt sofort. Überholte Anfragen bricht React Query über `AbortSignal` ab (`catalogApi.region(q, signal)`). Bis die neue Region da ist, bleiben die bisherigen Objekte sichtbar (`keepPreviousData`).
- **Tests:** `use-settled.test.tsx` prüft den Hook. In `skymap-page.test.tsx` gibt es beim Öffnen sofort eine Anfrage mit Signal, und dreimal schnelles Hineinzoomen ergibt genau eine weitere Anfrage. Ohne die Änderung waren es 4 Anfragen. Im Browser lokal nachgemessen: drei Zoomstufen in 335 ms ergaben eine Anfrage.
