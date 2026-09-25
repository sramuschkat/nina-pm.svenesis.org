### Deploy: kein Deploy mit veraltetem main (2026-09-25)

- `pnpm pr:land … --deploy` bricht ab, wenn `git checkout main` oder `git pull --ff-only` scheitert, statt anschließend den alten Stand zu deployen.
- `pnpm deploy:prod` nennt bei unsauberem Arbeitsbaum die betroffenen Dateien und deployt nur, wenn `HEAD` gleich `origin/main` ist.
- Anlass: Nach dem Merge von #67 blieb `packages/catalog-data/js/star-catalog.js` liegen, weil das Verzeichnis schreibgeschützt war. Schreibgeschützt sind in `packages/catalog-data` nur die Dateien, nicht die Verzeichnisse (README).
