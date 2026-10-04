### VM-Prüfstand: Lauf `vm-multi-night` (P-23/P-24, AP-52)

- **Zwei verkürzte Nächte im Abstand von 20 min** (Test-Server-Option `nightSpacingMin`): Nacht-Tabelle, Dämmerungen und Pläne der Folgenacht sind entsprechend verschoben. So läuft die Tagesschleife auf echtem NINA in ≈ 45 min statt über zwei Tage.
- **Prüfstand:**
  - Laufoption `sessions` (Ende erst nach n abgeschlossenen Sessions);
  - Sequenz-Optionen für *Warten auf Zeit*, Höchstzahl Nächte und eine Trigger-Box vor jeder Belichtung;
  - `removeFromStart` gilt auch für den Start in der Tagesschleife.
- **Prüfarten** `sameCount` (Box-Läufe = Belichtungen) und `distinct` (verschiedene Nacht-Schlüssel); die Prüfungen laufen kopflos und gegen NINA.
