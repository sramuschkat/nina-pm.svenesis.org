<#
  NINA-PM Bench Agent (ops/vm-bench.md): läuft per Aufgabenplanung in der angemeldeten Sitzung der Test-VM und holt
  Aufträge vom Prüfstand-Server auf dem Mac (GET /agent/next, Kopf X-Bench-Key). Er führt NUR diese Aufträge aus:
    ping, restart-nina (optional ninapm.db löschen), stop-nina, install-plugin (ZIP vom Mac, SHA-256 geprüft),
    collect-log (NINA-Log seit einem Zeitpunkt zurück an den Mac).
  Keine beliebigen Befehle, keine Anmeldedaten. Konfiguration: C:\NinaPmBench\agent.json (server, key, ninaExe).
  Windows PowerShell 5.1.
#>
$ErrorActionPreference = 'Stop'
$Root = 'C:\NinaPmBench'
$Cfg = Get-Content (Join-Path $Root 'agent.json') -Raw | ConvertFrom-Json
$Headers = @{ 'X-Bench-Key' = $Cfg.key }
$PluginDir = Join-Path $env:LOCALAPPDATA 'NINA\Plugins\3.0.0\Svenesis.NinaPm'
$DbPattern = Join-Path $env:LOCALAPPDATA 'NINA\Plugins\Svenesis.NinaPm\ninapm.db*'
$LogDir = Join-Path $env:LOCALAPPDATA 'NINA\Logs'

$mutex = New-Object System.Threading.Mutex($false, 'Local\NinaPmBenchAgent')
if (-not $mutex.WaitOne(0)) { exit 0 }

function Write-AgentLog([string]$Message) {
    $line = '{0} {1}' -f (Get-Date).ToUniversalTime().ToString('o'), $Message
    Add-Content -Path (Join-Path $Root 'agent.log') -Value $line
}

function Test-Nina { return [bool](Get-Process -Name 'NINA' -ErrorAction SilentlyContinue) }

function Stop-Nina {
    $p = Get-Process -Name 'NINA' -ErrorAction SilentlyContinue
    if (-not $p) { return }
    foreach ($proc in @($p)) {
        [void]$proc.CloseMainWindow()
        if (-not $proc.WaitForExit(30000)) {
            Write-AgentLog 'NINA beendet sich nicht – Prozess wird beendet'
            $proc.Kill()
            [void]$proc.WaitForExit(15000)
        }
    }
}

function Start-Nina([string]$ProfileId) {
    $argList = @()
    if ($ProfileId) { $argList += @('--profileid', $ProfileId) }
    $wd = Split-Path $Cfg.ninaExe
    if ($argList.Count -gt 0) {
        Start-Process -FilePath $Cfg.ninaExe -ArgumentList $argList -WorkingDirectory $wd | Out-Null
    } else {
        Start-Process -FilePath $Cfg.ninaExe -WorkingDirectory $wd | Out-Null
    }
}

function Send-Done([string]$Id, [bool]$Ok, [string]$Message) {
    $body = @{ ok = $Ok; message = $Message } | ConvertTo-Json -Compress
    Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$($Cfg.server)/agent/done/$Id" -Headers $Headers `
        -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
}

function Send-File([string]$Id, [string]$Name, [byte[]]$Bytes) {
    Invoke-WebRequest -UseBasicParsing -Method Put -Uri "$($Cfg.server)/agent/upload/$Id/$Name" -Headers $Headers `
        -ContentType 'application/octet-stream' -Body $Bytes | Out-Null
}

# NINA hält die Logdatei offen: lesend mit FileShare.ReadWrite öffnen.
function Read-Shared([string]$Path) {
    $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try {
        $ms = New-Object System.IO.MemoryStream
        $fs.CopyTo($ms)
        # Komma: Array als Ganzes zurückgeben, nicht Byte für Byte in die Pipeline.
        return ,$ms.ToArray()
    } finally { $fs.Dispose() }
}

function Invoke-Job($Job) {
    switch ($Job.type) {
        'ping' {
            return "NINA $(if (Test-Nina) { 'läuft' } else { 'aus' }), Plugin $(if (Test-Path $PluginDir) { 'installiert' } else { 'fehlt' })"
        }
        'stop-nina' { Stop-Nina; return 'NINA beendet' }
        'restart-nina' {
            Stop-Nina
            if ($Job.args.resetDb) { Remove-Item -Path $DbPattern -Force -ErrorAction SilentlyContinue }
            Start-Nina ([string]$Job.args.profileId)
            return "NINA gestartet$(if ($Job.args.resetDb) { ', ninapm.db gelöscht' })"
        }
        'install-plugin' {
            $name = [System.IO.Path]::GetFileName([string]$Job.args.file)
            $zip = Join-Path $env:TEMP $name
            Invoke-WebRequest -UseBasicParsing -Uri "$($Cfg.server)/files/$name" -Headers $Headers -OutFile $zip
            $hash = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($hash -ne ([string]$Job.args.sha256).ToLowerInvariant()) { throw "SHA-256 stimmt nicht ($hash)" }
            Stop-Nina
            if (Test-Path $PluginDir) { Remove-Item -Path (Join-Path $PluginDir '*') -Recurse -Force }
            else { New-Item -ItemType Directory -Path $PluginDir | Out-Null }
            Expand-Archive -Path $zip -DestinationPath $PluginDir -Force
            Remove-Item $zip -Force
            if ($Job.args.start) { Start-Nina ([string]$Job.args.profileId) }
            return "Plugin installiert ($((Get-ChildItem $PluginDir -Recurse -File).Count) Dateien)"
        }
        'collect-log' {
            $since = [DateTime]::Parse([string]$Job.args.sinceUtc, $null, [System.Globalization.DateTimeStyles]::AdjustToUniversal)
            $files = Get-ChildItem -Path $LogDir -Filter '*.log' | Where-Object { $_.LastWriteTimeUtc -ge $since } | Sort-Object Name
            if (-not $files) { throw "kein NINA-Log seit $since" }
            $all = New-Object System.Collections.Generic.List[byte]
            foreach ($f in $files) { $all.AddRange((Read-Shared $f.FullName)) }
            Send-File $Job.id 'nina.log' $all.ToArray()
            return "$(@($files).Count) Logdatei(en), $($all.Count) Bytes"
        }
        default { throw "Auftrag '$($Job.type)' ist nicht erlaubt" }
    }
}

Write-AgentLog "Agent gestartet, Server $($Cfg.server)"
$lastError = ''
while ($true) {
    try {
        $state = if (Test-Nina) { 'running' } else { 'stopped' }
        $r = Invoke-WebRequest -UseBasicParsing -Uri "$($Cfg.server)/agent/next?nina=$state&host=$env:COMPUTERNAME" -Headers $Headers -TimeoutSec 10
        $lastError = ''
        if ($r.StatusCode -eq 200 -and $r.Content) {
            $job = $r.Content | ConvertFrom-Json
            Write-AgentLog "Auftrag $($job.type) ($($job.id))"
            try {
                $msg = Invoke-Job $job
                Send-Done $job.id $true ([string]$msg)
            } catch {
                Write-AgentLog "Fehler: $($_.Exception.Message)"
                Send-Done $job.id $false $_.Exception.Message
            }
        }
    } catch {
        # Prüfstand-Server auf dem Mac läuft nur während eines Laufs – nicht erreichbar ist der Normalfall.
        if ($_.Exception.Message -ne $lastError) { Write-AgentLog "Server: $($_.Exception.Message)"; $lastError = $_.Exception.Message }
    }
    Start-Sleep -Seconds 3
}
