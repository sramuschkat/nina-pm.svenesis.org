# Seed-Daten

`seed-demo.json` wird von `pnpm db:seed` (lokal) und `ops-cli seed --tenant test` (Test-Mandant in prod) eingespielt.

- Fixtures `owner`, `admin` (befristet 72 h), `user1`, `user2`, `superuser`, `outsider` sind die Werte für `POST /auth/test-login {identityFixture}` (nur lokal, `AUTH_TEST_MODE`).
- Im Test-Mandanten in prod werden **keine** Identitäten angelegt; dort melden sich echte Discord-Konten über Einladungen an (H-12a). Nur Ausrüstung, Mondprofile und Projekte werden übernommen.
- Webhook-URLs sind Platzhalter; Discord-Tests laufen lokal gegen einen Mock (`tools/discord-mock`), in prod mit den Testkanälen aus H-21.
- `"lines": "wie Panel 1"` bedeutet: der Seeder kopiert die Zeilen des vorigen Panels.
- Kopplungs-Token nur lokal; in prod erzeugt S-42 das Token.
- Die Built-in-Mondprofile werden bei **jedem** neuen Mandanten angelegt (nicht nur im Demo-Seed).

**Zähler im Seed (DAT-18, DAT5-17):** `counters` erzeugen keine `capture`-Zeilen. Damit der Seed `capture_night` überhaupt füllen kann, ist `counters` eine **Liste mit Nacht**:

```json
"counters": [
  { "filter": "Ha",   "night": "2026-09-10", "acquired": 12, "rejected": 1 },
  { "filter": "Ha",   "night": "2026-09-12", "acquired": 10, "rejected": 1 },
  { "filter": "OIII", "night": "2026-09-12", "acquired": 10, "rejected": 0 }
]
```

`filter` zeigt auf die Zeile des Panels (bei Mosaiken zusätzlich `panelIndex`, Standard 0), `night` ist der Nacht-Schlüssel (Datum des Abends). Der Seed schreibt je Eintrag **eine** `capture_night`-Zeile mit `sources = ["import"]`, `rejected_correction = rejected`, `rejected_individual = 0`, `rejected_count = rejected`, und summiert die Einträge in `exposure_line.acquired_count`/`rejected_count`/`integration_s`. Der Abgleich-Job (TK 6.6/13) behandelt solche Zeilen als Basis, addiert nur neue Meldungen und überschreibt nie.
