# infra

CDK-App für die einzige Umgebung **prod** (`nina-pm.svenesis.org`). Stacks, `cdk.context.json` und CDK-Assertions folgen mit AP-02a und AP-02b. IAM je Lambda nach `docs/specs/infra/iam.md`.

Deployt wird nur lokal durch Sven mit `pnpm deploy:prod` (H-06). Claude Code und GitHub Actions deployen nie.
