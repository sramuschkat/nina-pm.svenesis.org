### CI – Diagnose für hängende E2E-Shards

- Mehrfach hing ein E2E-Shard nach „N passed“ bis zum Job-Limit (zuletzt `e2e (6/6)` auf `main`, 20 min). Der Schritt hat jetzt einen stummen Wächter: läuft er 2 min nach dem Testergebnis noch, schreibt er Prozessbaum, die Prozesse mit offener Schritt- bzw. tee-Pipe und die Ports 8787/4173 ins Log (höchstens dreimal, als einklappbare Gruppe). Exit-Code des Testlaufs unverändert.
