### CI: Engine-Parität nur bei Engine-Änderungen

- `plugin.yml`: neuer Auftrag `changes` („Engine geändert?“). Die 500 Jint-Pläne in `engine-parity` (≈ 4 min) und `jint-runtime` (≈ 2,5 min) laufen in PRs nur noch, wenn sich Engine, Engine-Bundle, Testvektoren, Jint-Spike oder die Paritätstests ändern; auf `main` immer. Der ApiClient-Test gegen den Test-Server läuft weiter bei jedem PR. Plugin-PRs sind damit nach ≈ 2,5 statt ≈ 5 min fertig.
