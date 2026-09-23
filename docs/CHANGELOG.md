# Changelog

Änderungen je Arbeitspaket, neueste oben. Versionen und Tags setzt Sven (`v*`, `plugin-v*`).

## [Unveröffentlicht]

### AP-02a – CDK-Grundgerüst: Data, Config, Cert, Web, Edge (2026-09-23)

Anforderungen: TK 4.1–4.5, ADR-14, NFA Betrieb, TK 15.1, TK 18, `specs/infra/iam.md` §7, §8, §10–§12.

- CDK-App `infra/` mit den Stacks `NinaPm-Data`, `NinaPm-Config`, `NinaPm-Cert` (us-east-1), `NinaPm-Web` und `NinaPm-Edge`; Konto und Hosted Zone aus H-01 in `config.ts` und `cdk.context.json`.
- Data: DSQL-Cluster mit Löschschutz und `RETAIN`, Tag `purpose=prod`, Import-Modus `-c dsqlClusterId=…`; Daten-Bucket mit Block Public Access, Versionierung, TLS-Pflicht und `RETAIN`; AWS-Backup-Plan täglich, 35 Tage, Standard-Vault, Auswahl per Cluster-ARN.
- Edge: CloudFront mit OAC, vier Behaviors mit `npm-html` bzw. `npm-api-static` nach `iam.md` §10, Viewer-Request-Funktion nach TK 4.3, Alias A/AAAA `nina-pm`, `/nina-pm/web/build-id`, Platzhalterseite.
- CDK-Assertions Nr. 5, 6, 7, 10 und Backup-Plan als Tests in `infra/test/`; `cdk synth` ohne AWS-Zugang im CI.
- `pnpm deploy:prod` im Grundzug (`tools/deploy`, nur Sven) und Smoke-Prüfung (`tools/smoke`).

### Release-Reihenfolge: NINA-Plugin als Block RP direkt vor R4 (2026-09-23)

Entscheidung Sven. Fachkonzept 1.21 (Kap. 11), Technisches Konzept 1.21 (Kap. 19), `docs/concept/INDEX.md` neu erzeugt.

- AP-S2b, AP-S2c, AP-08c, AP-S2a und AP-16a–h bilden den neuen Block **RP** zwischen R3 und R4 (`docs/work-packages/README.md`, Briefe mit `Release: RP`).
- R1 heißt „MVP Planung“ und geht ohne Plugin live. NINA-API (AP-14a–c) und Fake-Plugin bleiben in R1. AP-17 hängt nicht mehr von AP-16h ab.
- Die Plugin-Nacht P-05 wandert aus der Go-live-Checkliste in die menschliche Freigabe von AP-16h.
- H-14 wird erst für RP gebraucht (`docs/ops/human-tasks.md`, `START.md`).
- Wo FA-NIN-* oder `specs/nina/execution.md` „R1“ nennen, ist der Plugin-Umfang von RP gemeint.

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
