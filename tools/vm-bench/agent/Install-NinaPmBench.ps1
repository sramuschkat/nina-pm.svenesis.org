<#
  Einrichtung des NINA-PM-Prüfstands in der Test-VM (ops/vm-bench.md) – einmalig, PowerShell „Als Administrator“.
  Legt C:\NinaPmBench an, lädt den Agenten vom Mac, registriert die Aufgabe „NINA-PM Bench Agent“ (bei Anmeldung, in
  der angemeldeten Sitzung, ohne erhöhte Rechte), öffnet TCP 1888 (Advanced API) nur für das lokale Subnetz und schaltet
  Standby und Bildschirmabschaltung am Netzteil ab. Nur für die Test-VM – nicht auf dem Rig.
#>
param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$Key
)
$ErrorActionPreference = 'Stop'
$principalCheck = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principalCheck.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Bitte PowerShell „Als Administrator ausführen“.'
}
$Root = 'C:\NinaPmBench'
New-Item -ItemType Directory -Path $Root -Force | Out-Null

$nina = Join-Path $env:ProgramFiles "N.I.N.A. - Nighttime Imaging 'N' Astronomy\NINA.exe"
if (-not (Test-Path $nina)) {
    $found = Get-ChildItem -Path $env:ProgramFiles, ${env:ProgramFiles(x86)} -Filter 'NINA.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $found) { throw 'NINA.exe nicht gefunden' }
    $nina = $found.FullName
}
Write-Host "NINA: $nina"

# Erneute Einrichtung: laufenden Agenten zuerst beenden, sonst arbeitet er mit dem alten Skript weiter.
Stop-ScheduledTask -TaskName 'NINA-PM Bench Agent' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like '*NinaPmBenchAgent.ps1*' } |
    ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
Invoke-WebRequest -UseBasicParsing -Uri "$Server/setup/NinaPmBenchAgent.ps1" -OutFile (Join-Path $Root 'NinaPmBenchAgent.ps1')
@{ server = $Server; key = $Key; ninaExe = $nina } | ConvertTo-Json | Set-Content -Path (Join-Path $Root 'agent.json') -Encoding UTF8

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Root\NinaPmBenchAgent.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'NINA-PM Bench Agent' -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'NINA-PM Bench Agent'
Write-Host "Aufgabe „NINA-PM Bench Agent“ registriert und gestartet (Benutzer $user)."

if (-not (Get-NetFirewallRule -DisplayName 'NINA-PM Bench: Advanced API' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'NINA-PM Bench: Advanced API' -Direction Inbound -Protocol TCP -LocalPort 1888 `
        -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
}
Write-Host 'Firewall: TCP 1888 (Advanced API) aus dem lokalen Subnetz erlaubt.'

powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
Write-Host 'Standby und Bildschirmabschaltung (Netzbetrieb) aus.'

$r = Invoke-WebRequest -UseBasicParsing -Uri "$Server/agent/next?nina=setup&host=$env:COMPUTERNAME" -Headers @{ 'X-Bench-Key' = $Key }
Write-Host "Verbindung zum Mac: HTTP $($r.StatusCode) – Einrichtung fertig."
