# AP-02a – CDK-Grundgerüst: Data, Config, Cert, Web, Edge

**Release:** R1 · **Größe:** M · **Abhängigkeiten:** AP-01 · **Menschliche Aufgaben:** H-01, H-04, H-06

## Ziel
Die Grundinfrastruktur ist per CDK beschrieben und lokal deploybar: DSQL-Cluster mit Löschschutz, Buckets, Sicherung, Zertifikat und eigene CloudFront-Distribution unter `nina-pm.svenesis.org`. Danach zeigt die Domain eine Platzhalterseite, die Website bleibt unberührt.

## Anforderungen
TK 4, ADR-14, NFA Betrieb

## Lesen (nur diese Abschnitte)
- TK 4.1–4.5
- TK 15.1 (Header, Geheimnisse)
- specs/infra/iam.md §7, §8, §10–§12
- TK 18 (ci.yml, lokale Skripte, CDK-Assertions)
- rules/security-auth.md (Website nie ändern)
- ops/human-tasks.md H-01, H-04, H-06
- `CLAUDE.md`, `docs/rules/testing.md`; Abschnitt → Zeilen: `docs/concept/INDEX.md`

## Liefern
- `infra/` mit den Stacks `Data` (DSQL-Cluster mit **Löschschutz** und `RemovalPolicy.RETAIN`, Tag `purpose=prod`, Import-Modus über Kontextwert `dsqlClusterId`; S3-Buckets mit Block Public Access und Versionierung, Daten-Bucket mit `RETAIN`; **AWS-Backup-Plan** täglich, Aufbewahrung 35 Tage, **Standard-Vault**, Auswahl per Cluster-ARN), `Config` (Referenzen auf die SSM-Parameter nach `iam.md` §8 inkl. `/nina-pm/oauth/cookie-secret` und dem **einen** Wert `/nina-pm/origin-verify`; SecureStrings mit dem AWS-verwalteten Schlüssel `alias/aws/ssm`), `Cert` (us-east-1), `Web` (S3 SPA), `Edge` (eigene CloudFront-Distribution `nina-pm.svenesis.org`, Behaviors `/api/*`, `/catalog/*`, `/downloads/*`, **je Behavior eine Response-Headers-Policy** – `npm-html` mit vollständiger CSP nach `iam.md` §10 für Default, `npm-api-static` mit harter CSP für die übrigen drei –, SSM-Parameter `/nina-pm/web/build-id`, Route-53-Alias). Es gibt **keinen** eigenen Bootstrap-Stack: die Erst-Einrichtung ist der Standard-`cdk bootstrap` durch Sven (H-04, E1, SV-13)
- Hosted Zone per `HostedZone.fromLookup` (erlaubt, SV-19); die Lookup-Werte stehen in der eingecheckten `cdk.context.json`, damit `cdk synth` in CI ohne AWS-Zugang läuft
- Platzhalterseite
- Lokales Deploy-Skript **`pnpm deploy:prod`** (`tools/deploy/`, TK 18) im Grundzug: Vorbedingungen prüfen (CI auf dem Commit grün, Arbeitsbaum sauber) → `cdk diff` anzeigen und bestätigen lassen → `cdk deploy --all` → Smoke-Test; die Schritte On-Demand-Backup vor Migrationen (AP-03) und Fake-Plugin-Nacht (AP-14c) ergänzen die Folgepakete. **Claude Code führt das Skript nie aus** (H-06)
- CDK-Assertions nach `iam.md` §12 als Testgerüst im Auftrag `ci.yml`; hier grün: Nr. 5, 6, 7 und 10 – die Rollen- und Lambda-Assertions (Nr. 1–4, 8, 9) kommen mit den Lambdas in AP-02b und AP-03

## Nicht im Umfang
- Keine Lambdas (AP-02b), keine Migrationen
- `cdk bootstrap` und jeder Deploy (H-04, H-06 – nur Sven, lokal)
- Nichts aus TK 15.3 (bewusst nicht vorgesehen) nachbauen – keine Deploy-Härtung, keine GitHub-Anbindung an AWS, keine zusätzlichen Audit-Spuren

## Automatisierte Abnahme
- [ ] `pnpm cdk synth` samt CDK-Assertions in CI grün, **ohne** AWS-Zugang (Lookup-Werte aus `cdk.context.json`)
- [ ] Assertion 5: beide Buckets mit `BlockPublicAcls`, `BlockPublicPolicy`, `IgnorePublicAcls`, `RestrictPublicBuckets` und Versionierung; Web-Bucket nur über CloudFront mit OAC lesbar
- [ ] Assertion 6: **alle vier Behaviors** tragen eine Response-Headers-Policy; `npm-html` enthält `style-src` mit `'unsafe-inline'` und `script-src` **ohne** `'unsafe-inline'` (SEC-2); `npm-api-static` enthält eine CSP mit `default-src 'none'` (SV-16)
- [ ] Assertion 7: Website-Schutz: die Route-53-Konstrukte legen ausschließlich Einträge mit dem Präfix `nina-pm` an; das Template referenziert die Website-Distribution `E2L6Q80SD8XPT0` nicht
- [ ] Assertion 10: DSQL-Cluster mit Löschschutz und `DeletionPolicy: Retain`, Daten-Bucket mit `DeletionPolicy: Retain`
- [ ] Backup-Plan im Template: täglich, 35 Tage, Ziel-Vault `Default`, Auswahl über den Cluster-ARN
- [ ] CI grün, `docs/CHANGELOG.md` ergänzt, AP- und Anforderungs-IDs im PR

## Menschliche Freigabe
Standard-`cdk bootstrap` (H-04), danach Deploy lokal mit `pnpm deploy:prod` (H-06); `https://nina-pm.svenesis.org/` zeigt Platzhalter; Website unverändert (Vergleich `get-distribution-config`)
