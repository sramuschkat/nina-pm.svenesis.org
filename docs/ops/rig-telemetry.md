# Rig-Telemetrie einrichten (AP-67)

Die Monitor-Skripte am Rig schreiben ihre Messwerte als CSV: Core Temp für den Mini-PC (`coretemp_history.csv`) und
die Pegasus PowerBox (`ppba_history.csv`). Sie halten aber nur die letzten Stunden. Das Upload-Skript
`tools/rig-telemetry/Send-NinaPmTelemetry.ps1` schickt diese CSV-Zeilen alle 5 Minuten nach NINA-PM. Dort bleiben
die Rohwerte 90 Tage und die Stundenwerte dauerhaft. Angezeigt werden sie im Web unter **Betrieb → Rig-Zustand**.

Die Monitor-Skripte selbst bleiben unverändert. Das Upload-Skript liest ihre CSV nur, ohne sie zu sperren.

## 1. Token anlegen (Web)

1. Unter **NINA → NINA-Instanzen** eine neue Instanz anlegen, z. B. „SFRO-Telemetrie“, Rig „SFRO-Rig“.
2. Das Token wird nur einmal angezeigt – kopieren.

Eine eigene Instanz statt des Plugin-Tokens hat zwei Vorteile: Sie lässt sich getrennt widerrufen, und ihr
„Zuletzt gesehen“ zeigt, ob der Upload läuft. Sie nimmt nie eine Lease und stört das Plugin nicht.

## 2. Token am Rig hinterlegen

In einer **Administrator-PowerShell**:

```powershell
setx NINA_PM_TELEMETRY_TOKEN "npm_..." /M
```

`/M` ist nötig, weil die Aufgabe als `SYSTEM` läuft. Das Token gehört nicht in Skripte, Logs oder Chats.

## 3. Skript ablegen und testen

`Send-NinaPmTelemetry.ps1` nach `C:\tools\` kopieren, dann:

```powershell
# a) Was würde gesendet? (nichts wird geschickt, der Zustand bleibt unverändert)
.\Send-NinaPmTelemetry.ps1 -Source pc -CsvPath C:\tools\coretemp_history.csv -DryRun
.\Send-NinaPmTelemetry.ps1 -Source power_box -CsvPath C:\tools\ppba_history.csv -DryRun

# b) Einmal wirklich senden (neue PowerShell, damit die Umgebungsvariable gilt)
.\Send-NinaPmTelemetry.ps1 -Source pc -CsvPath C:\tools\coretemp_history.csv
```

Erwartet: `pc: N Messpunkte gesendet, N angenommen`. Beim zweiten Aufruf sendet das Skript nur, was seitdem neu
ist. Den zuletzt bestätigten Zeitpunkt merkt es sich in `coretemp_history.ninapm.json` neben der CSV.

## 4. Aufgabenplanung (alle 5 Minuten)

```powershell
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
$Principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)

foreach ($s in @(
    @{ Name = 'pc';        Csv = 'C:\tools\coretemp_history.csv' },
    @{ Name = 'power_box'; Csv = 'C:\tools\ppba_history.csv' })) {
  $Action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory 'C:\tools' -Argument (
      '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden ' +
      "-File C:\tools\Send-NinaPmTelemetry.ps1 -Source $($s.Name) -CsvPath $($s.Csv) " +
      "-LogFile C:\tools\ninapm-telemetry.log")
  Register-ScheduledTask -TaskName "NINA-PM Telemetrie $($s.Name)" -Action $Action -Trigger $Trigger `
      -Principal $Principal -Settings $Settings
}
```

Prüfen: `Get-Content C:\tools\ninapm-telemetry.log -Tail 10` und im Web **Betrieb → Rig-Zustand**.

## Verhalten

| Fall | Was passiert |
|---|---|
| Server oder Netz nicht erreichbar | Exitcode 1, Zustand unverändert; der nächste Lauf sendet alles nach dem letzten bestätigten Zeitpunkt (die CSV hält 12 h) |
| Doppelt gesendet | Der Server nimmt jeden Messpunkt je (Rig, Quelle, Zeitpunkt) nur einmal an (`duplicate`) |
| Messpunkt älter als 7 Tage oder mehr als 5 min in der Zukunft | Der Server zählt ihn als `skipped`, der Rest kommt an |
| Ungültiger Wert (z. B. Messfehler außerhalb des Bereichs) | `422`: der Stapel wird übersprungen und protokolliert, damit er nicht ewig hängt |
| Token widerrufen | `401`, Exitcode 1; neues Token anlegen und mit `setx /M` setzen |
| Leere Zelle in der CSV | Der Wert fehlt (nie 0) |

## Messgrößen

| Quelle | CSV-Spalte → Messgröße |
|---|---|
| `pc` | `tmax` → `cpuMaxC`, `tavg` → `cpuAvgC`, `load` → `loadPct`, `disk` → `diskC` |
| `power_box` | `temp` → `airC`, `dew` → `dewPointC`, `hum` → `humidityPct`, `volt` → `voltageV`, `amp` → `currentA`, `heat1` → `dewHeater1Pct`, `heat2` → `dewHeater2Pct` |

Wertebereiche und Einheiten: `packages/shared/src/contracts/nina/telemetry.ts`. Der Taupunktabstand wird im Web
aus Luft und Taupunkt gerechnet, nicht gespeichert.
