# NINA-Abstürze in der VM – 05.10.2026

Die VM ist Windows 11 ARM. NINA 3.2.0.9001 (x64) läuft dort unter der x64-Emulation. Die Windows-Ereignisse hat der Absturz-Wächter des Prüfstands geholt: `app-events-*.txt`, Quellen *.NET Runtime*, *Application Error* und *Windows Error Reporting*.

| Zeit (UTC) | Lauf | Zeitpunkt im Lauf |
|---|---|---|
| 06:15:03 | vm-smoke | – |
| 13:13:06 | real-night-flats | Versuch 1 |
| 15:51:11 | real-full-night | nach gut 20 min |
| 17:15:04 | real-network | 18 s nach dem Anlegen der Session |
| 17:57:40 | real-network | 23 min nach der Wiederverbindung |
| 18:00:11 | real-long-night | 27 s nach dem Anlegen der Session |
| 18:03:30 | real-long-night | 31 s nach dem Anlegen der Session |

**Signatur, bei allen sieben gleich:**
- `NINA.exe` beendet mit `System.AccessViolationException`.
- Fehlermodul `coreclr.dll` 8.0.2125.47513, Ausnahme `0xc0000005`, Offset `0x1d4560`.
- Der .NET-Stack hat nur einen Rahmen: `CastHelpers.ChkCastClassSpecial`.
- Kein Rahmen aus NINA-PM. Bei einem einzigen Rahmen ist das allerdings kein Beweis.

Dazu kam um 18:45 (UTC) ein **Hänger ohne .NET-Absturz**: NINA antwortete nicht mehr, und ASCOM OmniSim war danach nicht erreichbar (`app-events-20261005-1827-real-long-night.txt`, nur ein nachgereichter Bluescreen-Bericht vom 07.09.).

**Bewertung:**
- Das Plugin ist reiner verwalteter Code: kein `unsafe`, keine eigenen P/Invokes.
- Die einzige native Komponente ist SQLite (`e_sqlite3`). Jeder Zugriff darauf läuft über eine Verbindung unter einer Sperre (`LocalStore.gate`, alle Methoden geprüft).
- Die Abstürze gibt es seit dem 03.10. und über alle Plugin-Versionen 0.4.x hinweg. Sie treten in verschiedenen Phasen auf: Start, Belichten, nach einem Netzausfall.
- Am wahrscheinlichsten ist die Emulation oder die Laufzeit. Ausgeschlossen ist das Plugin aber nicht.
- Nach einem Neustart von Windows lief `real-full-night` mit 0.4.7 1½ h ohne Absturz.

**Nicht weiter verfolgt (Entscheidung Sven, 05.10.2026).** Möglich wären später:
- vollständige Speicherabbilder (WER LocalDumps für `NINA.exe`), um den Stack des abstürzenden Threads zu sehen;
- eine Gegenprobe ohne NINA-PM;
- ein Versuch mit `DOTNET_EnableWriteXorExecute=0`.

Das Rig läuft nativ auf x64, ohne Emulation. Ob NINA dort stabil bleibt, zeigt die erste beaufsichtigte Nacht.
