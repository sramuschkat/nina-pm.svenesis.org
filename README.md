# Svenesis NINA-PM

Web-App, AWS-Backend und NINA-Plugin zur Planung von Astrofotografie-Projekten, die NINA automatisch ausführt. Einzige Umgebung: prod unter https://nina-pm.svenesis.org.

- Einstieg: `START.md`, Arbeitsweise: `CLAUDE.md`, Dokumentation: `docs/README.md`
- Arbeitspakete und Status: `docs/work-packages/README.md`, Änderungen: `docs/CHANGELOG.md`

## Entwicklung

Voraussetzungen: Node 24 (`.nvmrc`) und pnpm 12 (`packageManager` in `package.json`).

```bash
pnpm i
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Deployt wird nur lokal durch Sven (`pnpm deploy:prod`, H-06).
