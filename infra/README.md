# infra

CDK-App der einzigen Umgebung **prod** (`nina-pm.svenesis.org`, TK 4). Konfiguration in `config.ts`, Stacks in `lib/`, Einstieg `bin/app.ts`.

| Stack | Region | Inhalt | seit |
|---|---|---|---|
| `NinaPm-Data` | eu-central-1 | DSQL-Cluster (Löschschutz, `RETAIN`, `purpose=prod`), Daten-Bucket (`RETAIN`), AWS-Backup-Plan (täglich, 35 Tage, Standard-Vault, Auswahl per Cluster-ARN); Ausgabe `DsqlEndpoint` | AP-02a |
| `NinaPm-Config` | eu-central-1 | Referenzen auf die SSM-Parameter aus H-05 (legt keine an) | AP-02a |
| `NinaPm-Cert` | us-east-1 | ACM-Zertifikat `nina-pm.svenesis.org`, DNS-Validierung | AP-02a |
| `NinaPm-Web` | eu-central-1 | Web-Bucket (SPA, `/catalog/`, `/downloads/`) | AP-02a |
| `NinaPm-Edge` | eu-central-1 | CloudFront mit OAC, vier Behaviors mit `npm-html` bzw. `npm-api-static`, Viewer-Request-Funktion, Alias `nina-pm`, `/nina-pm/web/build-id`, Platzhalterseite | AP-02a |
| `NinaPm-Jobs` | eu-central-1 | Lambda `nina-pm-worker` (Rolle `NinaPmWorker`, reserviert 5), SQS `nina-pm-worker-failures`, vier Zeitpläne in der Gruppe `nina-pm` | AP-02b |
| `NinaPm-Api` | eu-central-1 | HTTP API mit Drosselung nach `iam.md` §9, Lambda `nina-pm-api` (Rolle `NinaPmApi`, reserviert 20), Zugriffsprotokoll; Ausgabe `ApiEndpoint` | AP-02b |
| `NinaPm-Ops` | eu-central-1 | Lambda `nina-pm-ops-cli` (Rolle `NinaPmOpsCli`), SNS `nina-pm-alarms`, Alarme nach TK 16.2, Route-53-Health-Check, Budget | AP-02b |
| `NinaPm-Migrate` | eu-central-1 | Lambda `nina-pm-migrate` (Rolle `NinaPmMigrate`, `dsql:DbConnectAdmin`) als CDK-Trigger vor Api und Jobs: Migration 0000 und alle offenen Migrationen | AP-03 |

## Befehle

```bash
pnpm cdk synth --no-lookups
pnpm test
```

`cdk synth` läuft ohne AWS-Zugang: die Lookup-Werte der Hosted Zone stehen in `cdk.context.json`. Die CDK-Assertions nach `docs/specs/infra/iam.md` §12 liegen in `test/`.

**Deployt wird nur lokal durch Sven** mit `pnpm deploy:prod` (H-06), nach dem Standard-`cdk bootstrap` in `eu-central-1` und `us-east-1` (H-04). Claude Code und GitHub Actions deployen nie.

## Hinweise

- **Backup-Vault `Default`:** muss in `eu-central-1` existieren (H-04). AWS legt ihn nur beim ersten Öffnen der Backup-Konsole selbst an; `pnpm deploy:prod` bricht sonst vorab mit dem passenden Befehl ab.
- **Import-Modus:** `-c dsqlClusterId=<id>` übernimmt einen vorhandenen Cluster statt einen neuen anzulegen (Restore, TK 6.10).
- **`/nina-pm/dsql-endpoint`** legt Sven nach dem ersten Deploy aus der Ausgabe `DsqlEndpoint` an (H-05). `pnpm deploy:prod` zeigt den Befehl an, wenn der Parameter fehlt oder abweicht.
- **`/api/*`** geht an die HTTP API. CloudFront sendet dabei den einen Wert aus `/nina-pm/origin-verify` als `X-Origin-Verify`, die Lambda `api` vergleicht ihn und antwortet sonst 403 (SV-16). Der Parameter muss vor dem Deploy existieren (H-05); `pnpm deploy:prod` prüft das.
- **Lambdas** werden beim Synth mit esbuild aus `apps/api/src/handlers/` gebündelt (ESM, Node 24, arm64); `@aws-sdk/*` bringt die Laufzeit mit.
- **Zugriffsprotokoll der HTTP API** ohne IP: API Gateway kann sie nicht kürzen, und sie wird nicht gebraucht (Entscheidung 23.09.2026).
- **Route-53-Health-Check** ohne Alarm: dessen Metriken liegen nur in us-east-1 (Entscheidung 23.09.2026).
- **`ops-cli`** aufrufen: `aws lambda invoke --function-name nina-pm-ops-cli --cli-binary-format raw-in-base64-out --payload '{"command":"help"}' /dev/stdout`
- **Web-Bucket-Policy** liegt im Edge-Stack, weil sie die Distribution referenziert. Sie erlaubt nur CloudFront (OAC) das Lesen und verbietet unverschlüsselte Zugriffe.
