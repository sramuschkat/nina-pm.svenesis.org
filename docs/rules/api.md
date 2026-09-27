# Regeln: API

Quelle: TK 7.

- Hono auf Lambda (`api`), Routen unter `/api/auth`, `/api/web/v1`, `/api/nina/v1`, `/api/system/v1`; gleicher Origin, keine CORS-Freigaben.
- Schemas mit zod in `packages/shared`; OpenAPI 3.1 wird generiert und eingecheckt (`docs/api/openapi.yaml`), CI prüft Diff.
- JSON `camelCase`; Zeiten ISO-8601 UTC mit `Z`; Nacht `YYYY-MM-DD`; Winkel Grad.
- Query-Parameter mit IDs heißen wie das Vertragsfeld – `rigId`, `siteId`, `projectId` –, nie verkürzt (`rig=`). Das gilt für die API unter `/api`; Adressen der Oberfläche (deutsche Pfade wie `/planung/objekte?rig=`) sind davon ausgenommen (Entscheidung Sven 27.09.2026).
- Fehler: `application/problem+json` `{type, title, status, code, errors[]}`; `code` **nur** aus `docs/contracts/errors.json`. Unerwartete Fehler → `500 internal.error` nur mit `requestId`; keine Stacktraces, SQL-/AWS-Fehlertexte oder Schlüssel in Antworten; Details nur im Log.
- Nebenläufigkeit: `ETag`/`If-Match` → `412 resource.version_conflict`.
- Idempotenz: Anlagen mit Client-UUID (v7); Zustandsübergänge über `If-Match`.
- Listen: Cursor-Paginierung `limit` ≤ 200, Standard 50.
- Anfrage ≤ 1 MB; mehr per **presigned POST** (S3, mit `content-length-range`). Laufzeit > ~5 s → Job (`202 {jobId}`), nie synchron.
- Drosselung **nur am API Gateway** (SV-06): Stage 50 rps / Burst 100, `/api/nina/v1` 20 rps, 5 rps / Burst 10 nur auf `GET /api/auth/discord/{proxy+}` und die Einladungsrouten (`POST /api/auth/invitation/claim`, `POST /api/auth/invitations/preview`) – `/auth/me`, `/auth/context`, `/auth/logout`, `/auth/sessions` laufen unter der Stage-Drosselung –, `GET /api/health` 5 rps / Burst 10 → `429 auth.rate_limited`; reservierte Parallelität `api` 20, `worker` 5. Keine Drosselung in der Middleware (auch nicht je NINA-Instanz). Fachliche Grenzen bleiben: `nights ≤ 14` (zod), Job-Dedupe, höchstens 3 offene Jobs je Mitglied. Werte: `specs/infra/iam.md` §9.
- CSRF (SV-04): jede nicht-GET-Methode unter `/api/auth`, `/api/web/v1`, `/api/system/v1` (auch anonyme wie `POST /auth/invitation/claim` und `/auth/invitations/preview`) verlangt den Header `X-NPM-Request: 1`, sonst `403 auth.csrf_missing`; ausgenommen `/nina/v1` (Bearer statt Cookie). Keine `Origin`-/`Sec-Fetch-Site`-Prüfung.
- `GET /api/health` (SV-07): die **einzige** Health-Route – öffentlich, ohne DB-Ping, ohne Sonder-Header, Ziel des Route-53-Health-Checks über CloudFront; die DB-Erreichbarkeit prüft der Smoke-Test über eine angemeldete Route.
- NINA-API (SV-08): `Authorization: Bearer npm_…`; jede Anfrage liest den Token-Hash per Index (kein Cache, kein Ablauf) – widerrufen oder unbekannt → `401 nina.token_invalid`.
- Aufzählungswerte nur aus `docs/contracts/enums.json`.
- Verträge zuerst: neue Struktur → Schema + Beispiel in `packages/shared/contracts`, dann Implementierung.
- Jede Route: `meta.action`, zod-Validierung, Rechte-Test, OpenAPI-Beschreibung mit Anforderungs-IDs.
- Zwei Anwendungs-Lambdas (`api`, `worker`) plus die Betriebs-Lambdas `migrate` (verbindet als DSQL-`admin`, führt auch Migration 0000 aus, SV-13) und `ops-cli`; CDK-Hilfs-Lambdas (BucketDeployment, Custom Resources) zählen nicht. Keine neuen Zeitpläne (nur `tick-5min`, `tick-hourly`, `daily`, `weekly`). Jede Lambda hat **ihre eigene** Ausführungsrolle (`specs/infra/iam.md`).
- Vertragsquelle sind die zod-Schemas; OpenAPI und JSON-Schemas werden generiert, nie von Hand gepflegt. Fehlercodes nur aus `docs/contracts/errors.json` (neue Codes dort ergänzen), z. B. `409 resource.in_use`, `401 auth.unauthenticated` (auch für abgelaufene Sitzungen, SV-01).
