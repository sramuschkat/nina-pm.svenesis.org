# Regeln: API

Quelle: TK 7.

- Hono auf Lambda (`api`), Routen unter `/api/auth`, `/api/web/v1`, `/api/nina/v1`, `/api/system/v1`; gleicher Origin, keine CORS-Freigaben.
- Schemas mit zod in `packages/shared`; OpenAPI 3.1 wird generiert und eingecheckt (`docs/api/openapi.yaml`), CI prüft Diff.
- JSON `camelCase`; Zeiten ISO-8601 UTC mit `Z`; Nacht `YYYY-MM-DD`; Winkel Grad.
- Fehler: `application/problem+json` `{type, title, status, code, errors[]}`; `code` **nur** aus `docs/contracts/errors.json`.
- Nebenläufigkeit: `ETag`/`If-Match` → `412 resource.version_conflict`.
- Idempotenz: Anlagen mit Client-UUID (v7); Zustandsübergänge über `If-Match`.
- Listen: Cursor-Paginierung `limit` ≤ 200, Standard 50.
- Anfrage ≤ 1 MB; mehr per **presigned POST** (S3, mit `content-length-range`). Laufzeit > ~5 s → Job (`202 {jobId}`), nie synchron.
- Drosselung: API GW global 50 rps, `/api/nina/v1` 20 rps, `/api/auth/*` 5 rps, `GET /api/health` 1 rps; zusätzlich in der Middleware je NINA-Instanz 120 Aufrufe/min → `429 auth.rate_limited`. Werte und Begründung: `specs/infra/iam.md` §9.
- Aufzählungswerte nur aus `docs/contracts/enums.json`.
- Verträge zuerst: neue Struktur → Schema + Beispiel in `packages/shared/contracts`, dann Implementierung.
- Jede Route: `meta.action`, zod-Validierung, Rechte-Test, OpenAPI-Beschreibung mit Anforderungs-IDs.
- Zwei Anwendungs-Lambdas (`api`, `worker`) plus die Betriebs-Lambdas `migrate`, `db-bootstrap` (einmalig, Migration 0000) und `ops-cli`; CDK-Hilfs-Lambdas (BucketDeployment, Custom Resources) zählen nicht. Keine neuen Zeitpläne (nur `tick-5min`, `tick-hourly`, `daily`, `weekly`). Jede Lambda hat **ihre eigene** Ausführungsrolle (`specs/infra/iam.md`).
- Vertragsquelle sind die zod-Schemas; OpenAPI und JSON-Schemas werden generiert, nie von Hand gepflegt. Fehlercodes nur aus `docs/contracts/errors.json` (neue Codes dort ergänzen), z. B. `409 resource.in_use`, `401 auth.token_expired`.
