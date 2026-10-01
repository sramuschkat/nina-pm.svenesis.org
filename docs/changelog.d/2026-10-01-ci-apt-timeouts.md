### CI: apt mit Timeouts und zweitem Versuch (2026-10-01)

- Im E2E-Shard hing `apt-get update` (aus `playwright install-deps`) 20 min an einem Ubuntu-Spiegel, bis der Shard abgebrochen wurde (PR #177). Jetzt: Netz-Timeout 30 s mit drei Wiederholungen je Datei, je Versuch höchstens 4 min, bis zu zwei Versuche, Schritt-Obergrenze 10 min.
