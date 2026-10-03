### Plugin: Filter nicht gefunden (AP-16h, P-05 prod)
- Block, in dem keine Belichtungszeile einen im NINA-Profil gefundenen Filter hat, wird sofort mit `BLOCK_SKIPPED reason=filter_not_found` übersprungen (execution.md §4.1 Nr. 1) – kein Slew, kein leeres Absitzen bis zum Blockende.
- Belichtung ohne gewählten Filter versucht die Filterwahl erneut (z. B. nach einer im Web korrigierten Belegung), statt still zu überspringen.
- Meldet der Heartbeat ein neues targets-ETag, läuft die Prüfung im Block vor der nächsten Belichtung sofort statt erst nach 15 min.
- Test-Server-Aktion `filter_wheel_restored`, Szenario und kopfloser Lauf `filter-restored`.
