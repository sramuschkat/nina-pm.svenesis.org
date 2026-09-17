# AP-02a – CDK-Grundgerüst: Bootstrap, Data, Config, Cert, Web, Edge

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-01 · **Menschliche Aufgaben:** H-01, H-04, H-06

## Ziel
Die Grundinfrastruktur ist per CDK deploybar: DSQL-Cluster, Buckets, Zertifikat, eigene CloudFront-Distribution unter `nina-pm.svenesis.org` und die GitHub-OIDC-Rollen. Danach zeigt die Domain eine Platzhalterseite, die Website bleibt unberührt.

## Anforderungen
TK 4, ADR-14, NFA Betrieb

## Lesen (nur diese Abschnitte)
- TK 4.1–4.5
- TK 15 (Header, Geheimnisse, IAM)
- specs/infra/iam.md §7–§8, §10–§11
- TK 18
- rules/security-auth.md (Website nie ändern)
- ops/human-tasks.md H-01, H-04
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `infra/` mit Stacks `NinaPm-Bootstrap` (GitHub-OIDC-Provider · Deploy-Rolle `NinaPmGithubDeploy` mit Vertrauen nur Repo + Environment `prod` und Rechten **ausschließlich** `sts:AssumeRole` auf die vier CDK-Bootstrap-Rollen plus `cloudformation:DescribeStacks`/`GetTemplate` · IAM-Politik **`NinaPmDeployBoundary`** nach `iam.md` §7.2 (wird von Sven bei `cdk bootstrap` als `--cloudformation-execution-policies` gesetzt, H-04) · Rolle **`NinaPmOpsInvoker`** mit MFA-Bedingung · CI-Rolle `NinaPmGithubCiDsql` nur Environment `ci` mit DSQL-Rechten auf Cluster mit Tag `purpose=ci`), `Data` (DSQL-Cluster mit Löschschutz und Tag `purpose=prod`, Import-Modus über Kontextwert `dsqlClusterId`, S3-Buckets, **Backup-Vault `nina-pm-prod` mit Vault Lock** und Vault-Zugriffspolitik), `Config` (**KMS-Schlüssel `alias/nina-pm-ssm`** mit Schlüsselpolitik nach `iam.md` §8, SSM-Referenzen inkl. `origin-verify` **und** `origin-verify-prev`), `Cert` (us-east-1), `Web` (S3 SPA), `Edge` (eigene CloudFront-Distribution `nina-pm.svenesis.org`, Behaviors `/api/*`, `/catalog/*`, `/downloads/*`, **je Behavior eine Response-Headers-Policy** – `npm-html` mit vollständiger CSP nach `iam.md` §10 für Default, `npm-api-static` für die übrigen drei –, SSM-Parameter `/nina-pm/web/build-id`, Route-53-Alias)
- Platzhalterseite
- `deploy-prod.yml` mit Environment `prod` und manueller Freigabe
- `cdk-nag`, CDK-Assertions (keine Änderung an fremden Distributionen/Records)

## Nicht im Umfang
- Keine Lambdas (AP-02b), keine Migrationen
- `cdk bootstrap` selbst (H-04)

## Automatisierte Abnahme
- [ ] `pnpm cdk synth` + `cdk-nag` grün in CI
- [ ] Assertion-Tests: genau eine Distribution, Alias nur `nina-pm`
- [ ] **alle vier Behaviors** tragen eine Response-Headers-Policy; die Politik des Default-Behaviors enthält `style-src` mit `'unsafe-inline'` und `script-src` **ohne** `'unsafe-inline'` (SEC-2/SEC-16)
- [ ] `NinaPmGithubDeploy` enthält keine Anweisung außer `sts:AssumeRole` und `cloudformation:Describe*`/`GetTemplate` (SEC-3)
- [ ] `NinaPmDeployBoundary` enthält alle vier `Deny`-Anweisungen aus `iam.md` §7.2 (Website-Distribution, fremde DNS-Namen, Datenzerstörung, fremdes IAM)
- [ ] Backup-Vault hat Vault Lock und eine Zugriffspolitik ohne `backup:DeleteRecoveryPoint` für die Deploy-Rolle (SEC-20)
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Deploy freigeben (H-06); `https://nina-pm.svenesis.org/` zeigt Platzhalter; Website unverändert (Vergleich `get-distribution-config`)
