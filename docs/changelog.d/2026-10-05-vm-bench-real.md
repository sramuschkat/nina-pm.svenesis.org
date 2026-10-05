### VM-Prüfstand gegen den echten Server (Stufe 2a)

- **Lokaler Stack** `apps/api/src/local-stack.ts`: Der Aufbau aus `local.ts` ist jetzt wiederverwendbar.
  - Neu ist ein optionaler Takt wie `tick-5min` in prod (Jobs nachholen, verwaiste Sessions, Abschluss und Bericht, Transits, Discord). Einschalten mit `LOCAL_TICK_S`.
  - `pnpm dev:api` und die E2E-Läufe verhalten sich wie bisher.
- **Prüfstand-Modus `real`** (`apps/api/src/bench/real-server.ts`): Der VM-Lauf spricht mit dem echten API-Code statt mit dem Test-Server.
  - Die Nacht wird über die Daten gestaucht: Der Standort ist so gewählt, dass die Dunkelheit nach 25–40 min endet. Ein Exoplanet mit eigener Ephemeride hat seinen Transit nach 22 min.
  - Das Prüfstand-Token `npm_test` wird auf eine echt angelegte Instanz umgeschrieben.
  - Die Auswertung kommt aus der Datenbank: Session, Zähler, Flat-Kombinationen, Transit, Jobs, Kommandos, Discord.
- **Drei Läufe:** `real-night-flats`, `real-transit`, `real-commands`. Dazu kommen `pnpm vm-bench real-check <szenario>` (ohne VM) und ein API-Test, der alle drei Szenarien plant.
