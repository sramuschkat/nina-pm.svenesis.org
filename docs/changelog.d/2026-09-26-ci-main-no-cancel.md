### CI: Läufe auf `main` nicht mehr abbrechen (2026-09-26)

- Landen zwei PRs kurz nacheinander, brach der zweite Push bisher den ersten CI-Lauf auf `main` ab. Die Sammeljobs meldeten ihn dann rot („Shards: cancelled“), zuletzt bei #85 durch #86.
- Jetzt läuft auf `main` jeder Push vollständig; nur in PRs ersetzt ein neuer Push den laufenden Lauf.
