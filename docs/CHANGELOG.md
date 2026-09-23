# Changelog

Änderungen je Arbeitspaket, neueste oben. Versionen und Tags setzt Sven (`v*`, `plugin-v*`).

## [Unveröffentlicht]

### AP-01 – Monorepo-Gerüst (2026-09-23)

Anforderungen: NFA Wartbarkeit, TK 3.1, TK 3.2, TK 18 (`ci.yml`), FK 9, `rules/testing.md`.

- pnpm-Workspace nach TK 3.1: `apps/web` (Vite, React), `apps/api` (tsup, je ein Bundle für `api`, `worker`, `migrate`, `ops-cli`), `packages/{shared,db,engine,i18n,ui-tokens,catalog-data}`, `infra`, `tools/repo-check`; `apps/nina-plugin` als Platzhalter für AP-S2c.
- TypeScript strict (`tsconfig.base.json`, ES2022, `moduleResolution bundler`), ESLint (typescript-eslint strict), Prettier, Vitest. TypeScript 6.0, weil typescript-eslint TypeScript 7 noch nicht unterstützt.
- Engine-Regel in ESLint als Allowlist nach `rules/engine.md`: nur `Math.abs/floor/ceil/trunc/min/max/sign/sqrt/PI`; verboten sind jedes andere `Math`-Member, `**`, `toFixed`/`toPrecision`/`toString(radix)`, BigInt, `Date`, `Intl`, Timer, `process`, `fetch` und nicht-relative Importe. Test `packages/engine/test/lint-rules.test.ts`.
- ESLint-Regel nach TK 3.2: `packages/db/src/connection` nur aus `packages/db/src/repositories` importierbar. Test `packages/db/test/lint-rules.test.ts`.
- `packages/catalog-data`: Kopie von `data/` und `js/dso-catalog.js` aus `legacy/astro-tools-2026-09-21/` (H-03), schreibgeschützt, README mit Herkunft, Datum und Lizenzen.
- `tools/repo-check`: Prüfsummen-Test, der Änderungen an `legacy/astro-tools-2026-09-21/` und `packages/catalog-data/` im CI erkennt.
- `.github/workflows/ci.yml` (install, lint, typecheck, test, build) und gitleaks.
- `THIRD_PARTY_NOTICES.md` um OpenNGC (CC BY-SA 4.0), d3-celestial (BSD 3-Clause) und die Datenquellen der Katalogdaten ergänzt.
- `docs/CHANGELOG.md` angelegt.
