### Katalogsuche schneller, Zeittest stabil (2026-09-26)

Anforderungen: FA-FRM-01, FA-FRM-15, AP-20 („Suche < 300 ms“)

- Die Namenssortierung der Katalogsuche nutzt einen gemeinsamen `Intl.Collator` und den beim Indizieren berechneten Namensrang, statt `localeCompare` mit Optionen je Vergleich. Die Suche nach „ngc“ (rund 8.000 Treffer) braucht lokal 5 statt 73 ms, die warme Nachtsuche über den ganzen Katalog 18 statt 57 ms.
- Damit hält der Test „Suche < 300 ms“ auch auf ausgelasteten CI-Runnern (zuletzt 388 ms). Er meldet die gemessenen Zeiten jetzt im Protokoll.
- Zwei weitere zeitabhängige Tests sind stabil: Das Saisondiagramm rechnet ein Jahr Nächte und hat ein eigenes Zeitlimit von 20 s. Der E2E-Test der Ausrüstung wartet nach dem Wechsel auf 768 px, bis das Layout umgebrochen ist.
