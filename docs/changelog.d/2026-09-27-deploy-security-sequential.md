### Deploy – sicherheitsrelevante Änderungen nacheinander (2026-09-27)

- `pnpm deploy:prod` wertet den `cdk diff` aus. Enthält er IAM- oder Sicherheitsgruppen-Änderungen, läuft `cdk deploy --all` ohne `--concurrency 4`, und CDK fragt je Stack selbst nach (`y`).
- Grund: Mit Parallelität kann CDK nicht nachfragen und bricht ab („Stack includes security-sensitive updates, but concurrency is greater than 1“, Deploy von #106 mit dem neuen Recht `worker` → `catalog/sky/*`).
- Die Sicherheitsabfrage bleibt dabei erhalten, `--require-approval never` wird nicht verwendet. Ohne solche Änderungen wird wie bisher parallel deployt.
