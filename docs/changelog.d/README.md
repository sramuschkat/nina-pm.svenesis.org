# Changelog-Einträge je PR

Jeder PR legt **eine** Datei `YYYY-MM-DD-<ap-oder-thema>.md` an (z. B. `2026-09-25-ap-09a.md`) statt
`docs/CHANGELOG.md` direkt zu ändern – so gibt es keine Konflikte, wenn mehrere PRs gleichzeitig offen
sind. Inhalt wie ein Abschnitt im Changelog:

```
### AP-09a – Ausrüstung: API (2026-09-25)

Anforderungen: …

- …
```

`pnpm changelog:collect` übernimmt alle Dateien (neueste zuerst) unter „## [Unveröffentlicht]“ und löscht
sie – vor einem Release oder gesammelt in einem PR. Abnahmen (☑) kommen ebenfalls als Eintrag in den
nächsten Paket-PR, nicht in einen eigenen Status-PR.
