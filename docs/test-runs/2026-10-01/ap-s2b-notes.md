# AP-S2b – Zusatzpunkte (01.10.2026)

Testrechner: Windows 11 ARM64 (VMware auf Mac), NINA 3.2.0.9001 (x64 emuliert), Probe 0.1.2, Kamera *Alpaca Camera Sim* (OmniSim), übrige Geräte *Sky Simulator for ALPACA*, Profil `4f85dd14-ac0e-4e04-98f7-b59d86b227a0`. Sequenz `C:\Users\admin\Documents\N.I.N.A\probe.json`: *Connect All Equipment* im Startbereich, Probe-Container 5 × 5 s, keine globalen Trigger.

## Kommandozeile (OT-22, NT-45)

| Test | Aufruf | Ergebnis (Sven) |
|---|---|---|
| 1 lange Schalter | `NINA.exe --profileid <ID> --sequencefile "<pfad>" --runsequence --exitaftersequence` | NINA startet mit der Sequenz und beendet sich |
| 2 Kurzformen | `NINA.exe -p <ID> -s "<pfad>" -r -x` | NINA startet und beendet sich |
| 3 Aufgabenplanung | Basic Task, *Start a program*, Argumente wie Test 1, von Hand mit *Run* | erst kein Start (kein Prozess, Pfad mit Leerzeichen und `'N'` ohne Anführungszeichen); mit **Program/script in Anführungszeichen** und **Start in** = NINA-Ordner startet NINA **sichtbar**, läuft die Sequenz und beendet sich. *Run only when user is logged on* |

Beispiel für die Einrichtung (Aufgabenplanung, englisches Windows):
- Program/script: `"C:\Program Files\N.I.N.A. - Nighttime Imaging 'N' Astronomy\NINA.exe"`
- Add arguments: `--profileid <Profil-ID> --sequencefile "<Pfad zur Sequenz>" --runsequence --exitaftersequence`
- Start in: `C:\Program Files\N.I.N.A. - Nighttime Imaging 'N' Astronomy`
- General: *Run only when user is logged on*

Die Probe-Zeilen dieser drei Starts liegen nicht vor (die Begleitdatei wurde vor dem Safety-Test geleert); belegt ist der Ablauf durch Svens Beobachtung.

## Unterbrechung vs. Benutzerabbruch (execution.md §4.6)

Sequenz: *Sequential Instruction Set* mit Bedingung *Loop While Safe*, darin der Probe-Container (5 × 30 s). Logs: `safety/nina.log`, `safety/nina-app.log`.

| Lauf | Auslöser | Probe-Log | NINA-Log |
|---|---|---|---|
| 1 | Safety Monitor während Belichtung 3 **getrennt** (OmniSim-Setup-Seite ohne Schalter „IsSafe“) | `CAPTURE result=aborted`, `BLOCK_END reason=interrupted`, `SAFETY_PAUSE` | „SafetyMonitorInfo state changed to Unsafe“ 13:14:05.65 → „Unsafe conditions detected - Interrupting current Instruction Set“ 13:14:09.44 (≈ 3,8 s Prüftakt der Bedingung) |
| 2 | Sequenz während Belichtung 2 von Hand gestoppt (Monitor verbunden, sicher) | `CAPTURE result=aborted`, `BLOCK_END reason=user_skip` | „Sequence run was cancelled“ |

Der Fall „verbunden, aber `IsSafe = false`“ folgt in P-25 (AP-16c) mit dem Test-Server-Szenario `safety`.
