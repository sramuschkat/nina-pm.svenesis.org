# infra

CDK-App der einzigen Umgebung **prod** (`nina-pm.svenesis.org`, TK 4). Konfiguration in `config.ts`, Stacks in `lib/`, Einstieg `bin/app.ts`.

| Stack | Region | Inhalt | seit |
|---|---|---|---|
| `NinaPm-Data` | eu-central-1 | DSQL-Cluster (Löschschutz, `RETAIN`, `purpose=prod`), Daten-Bucket (`RETAIN`), AWS-Backup-Plan (täglich, 35 Tage, Standard-Vault, Auswahl per Cluster-ARN); Ausgabe `DsqlEndpoint` | AP-02a |
| `NinaPm-Config` | eu-central-1 | Referenzen auf die SSM-Parameter aus H-05 (legt keine an) | AP-02a |
| `NinaPm-Cert` | us-east-1 | ACM-Zertifikat `nina-pm.svenesis.org`, DNS-Validierung | AP-02a |
| `NinaPm-Web` | eu-central-1 | Web-Bucket (SPA, `/catalog/`, `/downloads/`) | AP-02a |
| `NinaPm-Edge` | eu-central-1 | CloudFront mit OAC, vier Behaviors mit `npm-html` bzw. `npm-api-static`, Viewer-Request-Funktion, Alias `nina-pm`, `/nina-pm/web/build-id`, Platzhalterseite | AP-02a |
| `NinaPm-Migrate`, `-Api`, `-Jobs`, `-Ops` | eu-central-1 | Lambdas, Rollen, Zeitpläne, Alarme | AP-02b, AP-03 |

## Befehle

```bash
pnpm cdk synth --no-lookups
pnpm test
```

`cdk synth` läuft ohne AWS-Zugang: die Lookup-Werte der Hosted Zone stehen in `cdk.context.json`. Die CDK-Assertions nach `docs/specs/infra/iam.md` §12 liegen in `test/`.

**Deployt wird nur lokal durch Sven** mit `pnpm deploy:prod` (H-06), nach dem Standard-`cdk bootstrap` in `eu-central-1` und `us-east-1` (H-04). Claude Code und GitHub Actions deployen nie.

## Hinweise

- **Import-Modus:** `-c dsqlClusterId=<id>` übernimmt einen vorhandenen Cluster statt einen neuen anzulegen (Restore, TK 6.10).
- **`/nina-pm/dsql-endpoint`** legt Sven nach dem ersten Deploy aus der Ausgabe `DsqlEndpoint` an (H-05). `pnpm deploy:prod` zeigt den Befehl an, wenn der Parameter fehlt oder abweicht.
- **`/api/*`** zeigt bis AP-02b auf den Web-Bucket und liefert dort 403 oder 404. AP-02b stellt auf die HTTP API mit `X-Origin-Verify` um.
- **Web-Bucket-Policy** liegt im Edge-Stack, weil sie die Distribution referenziert. Sie erlaubt nur CloudFront (OAC) das Lesen und verbietet unverschlüsselte Zugriffe.
