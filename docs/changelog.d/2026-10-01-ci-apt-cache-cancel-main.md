### CI: apt-Cache für Playwright, überholte Läufe auf `main` abbrechen (2026-10-01)

- E2E-Shards holen die Systembibliotheken für Chromium (Schriften, mesa) aus einem apt-Cache statt vom Ubuntu-Mirror. Der brauchte am 30.09. in zwei `main`-Läufen 7–8 min dafür, die Tests im selben Shard 1,1 min; auf genau diese Läufe wartet der Deploy. Der Cache-Schlüssel wechselt wöchentlich.
- Ein neuer Push auf `main` bricht den laufenden CI-Lauf ab wie schon in PRs. Landen mehrere PRs nacheinander, warteten überlappende Läufe (je 15 Jobs, 20 Runner je Repo) bisher 2,5–10 min auf freie Runner; der Deploy prüft ohnehin nur den letzten Stand. Die Sammeljobs `test` und `e2e` laufen jetzt mit `!cancelled()`, ein abgebrochener Lauf endet grau statt rot (Grund der Regel vom 26.09.).
