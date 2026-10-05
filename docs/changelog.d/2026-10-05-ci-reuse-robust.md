### CI: Übernahme des PR-Ergebnisses robust gegen API-Aussetzer (2026-10-05)

- Schritt „Gleicher Stand schon im PR geprüft?“: Antwortet die GitHub-API mit einem Fehler (z. B. HTTP 502), läuft die volle CI statt den Lauf rot abzubrechen (main a15b6f1, 05.10.2026).
