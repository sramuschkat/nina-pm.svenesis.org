### Heute Nacht – Ereignisse der Nacht (2026-09-27)

Anforderungen: S-02 · Wunsch Sven 27.09.2026 (Vorlage Beobachtungsplaner); Entscheidungen Sven: Bahndaten per täglichem Job, Umfang wie Screenshot (ohne Kometen)

- **Engine** (`sky`, nur Anzeige), portiert aus `sky-events.js` der Vorlage:
  - SGP4 (Vallado 2006, WGS-72; Prüffall 00005 auf 1e-6 km).
  - Überflüge über 10° im Sonnenlicht bei Sonne unter −6°, mit Helligkeit und Erdschatten.
  - Meteorströme (IMO-Liste, Radiant, grobe Rate).
  - Zentrum der Milchstraße (Sgr A* ≥ 10° in der Dunkelheit, Saison).
  - Die nächsten Finsternisse am Standort (Mond: 10 Jahre, Sonne: 20 Jahre, je drei).
  - Tests gegen die Werte der Vorlage für Starfront, 27./28.09.2026: ISS 21:23–21:25 CDT, Südliche Tauriden in 39 Tagen, Sgr A* 20:50–22:30 CDT, Halbschatten-Mondfinsternis 20.02.2027 17:13 CST.
- **Bahndaten:**
  - Neue Aufgabe `sky_satellites` im Zeitplan `daily`: holt die TLEs von ISS, Tiangong und Hubble bei CelesTrak, prüft Katalognummer und Prüfsumme und legt `catalog/sky/satellites.json` in den Web-Bucket. Alles oder nichts: bei einem Fehler bleibt der Vortag stehen.
  - Neues Recht `webBucket.grantPut(worker, 'catalog/sky/*')`, nur schreiben (iam.md §3, CDK-Assertion).
  - Die Oberfläche liest die Datei über CloudFront. Fehlt sie (lokal, vor dem ersten Lauf), gilt der mitgelieferte Stand der Vorlage; ab 14 Tagen Alter erscheint ein Hinweis statt Überflügen.
- **Oberfläche:** Neuer Abschnitt „Ereignisse der Nacht“ unter „Mond & Planeten“ mit vier aufklappbaren Gruppen: Anzahl, erste Zeile, Tabellen und Hinweise wie in der Vorlage. Neuer Baustein `NightEvents` (components.md §2.20), Symbole `satellite`, `sparkles`, `orbit`, `contrast`.
- **Nach dem Deploy:** Die erste Datei schreibt der `daily`-Lauf um 03:00 UTC; bis dahin gilt der mitgelieferte Stand vom 15.09.2026.
