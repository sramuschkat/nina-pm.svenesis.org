### CI: Cache nur auf `main` speichern (2026-09-26)

- Der Cache für Lint, Prettier und Typecheck wird nur noch bei Pushes auf `main` gespeichert; PRs lesen ihn nur. Das spart je PR-Lauf rund 20 s im Job `lint · typecheck`.
- Messung nach #84:
  - Der erste PR-Lauf mit 3 Test- und 6 E2E-Shards lief 2:22 min, bei noch leerem Cache.
  - Längste Jobs: `lint · typecheck` 2:04, E2E-Shard 2:06; die Test-Shards brauchten 1:25–1:36.
  - Auf `main` legte der Push-Lauf den Cache an (Speichern 21 s).
