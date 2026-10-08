<#
.SYNOPSIS
  Laedt die Verlaufs-CSV der Rig-Skripte (Core Temp, Pegasus PowerBox) nach NINA-PM hoch (AP-67).

.DESCRIPTION
  Liest die CSV-Datei eines Monitor-Skripts, nimmt alle Zeilen nach dem zuletzt bestaetigten Zeitpunkt und sendet
  sie gebuendelt (hoechstens 500 je Anfrage) an POST /api/nina/v1/telemetry. Der zuletzt bestaetigte Zeitpunkt
  steht in einer kleinen JSON-Datei neben der CSV, so dass ein Abbruch nichts doppelt oder verloren schickt: der
  Server nimmt jeden Messpunkt je (Rig, Quelle, Zeitpunkt) nur einmal an.

  Gedacht fuer die Aufgabenplanung alle 5 Minuten. Die Monitor-Skripte selbst bleiben unveraendert.

  Laeuft unter Windows PowerShell 5.1 und PowerShell 7+. Keine Module.

.PARAMETER Source
  pc (Core Temp: Spalten time,tmax,tavg,load,disk) oder power_box (PowerBox: time,temp,dew,hum,volt,amp,heat1,heat2).

.PARAMETER CsvPath
  Verlaufsdatei des Monitor-Skripts, z. B. C:\tools\coretemp_history.csv.

.PARAMETER Token
  Token der NINA-Instanz (npm_...). Standard: Umgebungsvariable NINA_PM_TELEMETRY_TOKEN (mit setx /M setzen).

.PARAMETER BaseUrl
  Standard: https://nina-pm.svenesis.org

.PARAMETER Disk
  Nur bei -Source pc: Laufwerk, dessen freier Speicherplatz bei jedem Lauf mitgesendet wird (Quelle storage).
  Standard C:. Leer ('') schaltet es ab. Fuer ein anderes Laufwerk, z. B. das NINA-Bildverzeichnis: -Disk D:

.PARAMETER DryRun
  Nur anzeigen, was gesendet wuerde (erste Anfrage als JSON), nichts senden, Zustand nicht aendern.

.EXAMPLE
  .\Send-NinaPmTelemetry.ps1 -Source pc -CsvPath C:\tools\coretemp_history.csv -DryRun

.EXAMPLE
  .\Send-NinaPmTelemetry.ps1 -Source pc -CsvPath C:\tools\coretemp_history.csv -Disk D:
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('pc', 'power_box')][string]$Source,
    [Parameter(Mandatory = $true)][string]$CsvPath,
    [string]$Token = $env:NINA_PM_TELEMETRY_TOKEN,
    [string]$BaseUrl = 'https://nina-pm.svenesis.org',
    [string]$StateFile = '',
    [int]$BatchSize = 500,
    [string]$LogFile = '',
    [string]$Disk = 'C:',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Inv = [System.Globalization.CultureInfo]::InvariantCulture

# CSV-Spalte -> Messgroesse der NINA-PM-API (packages/shared/src/contracts/nina/telemetry.ts)
$Columns = @{
    pc        = [ordered]@{ tmax = 'cpuMaxC'; tavg = 'cpuAvgC'; load = 'loadPct'; disk = 'diskC' }
    power_box = [ordered]@{
        temp = 'airC'; dew = 'dewPointC'; hum = 'humidityPct'; volt = 'voltageV'; amp = 'currentA'
        heat1 = 'dewHeater1Pct'; heat2 = 'dewHeater2Pct'
    }
}

function Write-Log([string]$Message) {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Write-Host $line
    if ($LogFile) { Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8 }
}

# Log klein halten: ueber 1 MB nur die letzten 2000 Zeilen behalten (drei Zeilen je 5 min wuerden sonst wachsen).
if ($LogFile -and (Test-Path -LiteralPath $LogFile)) {
    try {
        if ((Get-Item -LiteralPath $LogFile).Length -gt 1MB) {
            $keep = Get-Content -LiteralPath $LogFile -Tail 2000
            Set-Content -LiteralPath $LogFile -Value $keep -Encoding UTF8
        }
    } catch { }
}

if (-not $Token -and -not $DryRun) {
    Write-Log 'Kein Token: Parameter -Token oder Umgebungsvariable NINA_PM_TELEMETRY_TOKEN setzen.'
    exit 2
}
$uri = $BaseUrl.TrimEnd('/') + '/api/nina/v1/telemetry'
$headers = @{ Authorization = "Bearer $Token" }

# Freier Speicherplatz (Quelle storage): ein Messpunkt je Lauf, unabhaengig von der CSV. Ein Fehler hier
# blockiert den CSV-Upload nicht.
if ($Source -eq 'pc' -and $Disk) {
    try {
        $drive = New-Object System.IO.DriveInfo($Disk.TrimEnd('\').TrimEnd(':'))
        $totalGb = [math]::Round($drive.TotalSize / 1GB, 2)
        $freeGb = [math]::Round($drive.AvailableFreeSpace / 1GB, 2)
        $freePct = if ($drive.TotalSize -gt 0) { [math]::Round(100.0 * $drive.AvailableFreeSpace / $drive.TotalSize, 1) } else { 0 }
        $storageBody = @{
            source  = 'storage'
            samples = @(@{
                    atUtc  = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ', $Inv)
                    values = [ordered]@{ freeGb = $freeGb; totalGb = $totalGb; freePct = $freePct }
                })
        } | ConvertTo-Json -Depth 5 -Compress
        if ($DryRun) {
            Write-Host $storageBody
        } else {
            Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' `
                -Body ([System.Text.Encoding]::UTF8.GetBytes($storageBody)) -TimeoutSec 30 | Out-Null
            Write-Log ("storage {0}: {1} GB frei von {2} GB ({3} %)" -f $Disk, $freeGb, $totalGb, $freePct)
        }
    } catch {
        Write-Log "Speicherplatz $Disk nicht gesendet: $($_.Exception.Message)"
    }
}

if (-not (Test-Path -LiteralPath $CsvPath)) {
    Write-Log "CSV fehlt: $CsvPath"
    exit 2
}
if (-not $StateFile) { $StateFile = [System.IO.Path]::ChangeExtension($CsvPath, '.ninapm.json') }

# Zuletzt bestaetigter Zeitpunkt (UTC)
$last = [DateTimeOffset]::MinValue
if (Test-Path -LiteralPath $StateFile) {
    try {
        $state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
        if ($state.lastUtc) {
            $last = [DateTimeOffset]::Parse($state.lastUtc, $Inv, [System.Globalization.DateTimeStyles]::AssumeUniversal)
        }
    } catch {
        Write-Log "Zustandsdatei unlesbar, beginne von vorn: $($_.Exception.Message)"
    }
}

# CSV lesen, ohne die Datei zu sperren (das Monitor-Skript schreibt weiter)
try {
    $fs = [System.IO.File]::Open($CsvPath, 'Open', 'Read', 'ReadWrite')
    try {
        $reader = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
        $text = $reader.ReadToEnd()
    } finally { $fs.Dispose() }
} catch {
    Write-Log "CSV nicht lesbar (naechster Versuch beim naechsten Lauf): $($_.Exception.Message)"
    exit 1
}
$rows = @(($text -split "`r?`n") | Where-Object { $_.Trim() } | ConvertFrom-Csv)
$map = $Columns[$Source]

$samples = New-Object System.Collections.Generic.List[object]
foreach ($r in $rows) {
    if (-not $r.time) { continue }
    try {
        $at = [DateTimeOffset]::Parse($r.time, $Inv)
    } catch { continue }
    if ($at -le $last) { continue }
    $values = [ordered]@{}
    foreach ($col in $map.Keys) {
        $raw = $r.$col
        if ($null -eq $raw -or $raw -eq '') { continue }
        $v = 0.0
        if ([double]::TryParse($raw, [System.Globalization.NumberStyles]::Float, $Inv, [ref]$v)) {
            $values[$map[$col]] = [math]::Round($v, 3)
        }
    }
    if ($values.Count -eq 0) { continue }
    $samples.Add([pscustomobject]@{
            at     = $at
            atUtc  = $at.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ', $Inv)
            values = $values
        })
}

if ($samples.Count -eq 0) {
    Write-Verbose 'Nichts Neues.'
    exit 0
}
$sorted = @($samples | Sort-Object { $_.at })
$sent = 0

for ($i = 0; $i -lt $sorted.Count; $i += $BatchSize) {
    $chunk = @($sorted[$i..([math]::Min($i + $BatchSize, $sorted.Count) - 1)])
    $body = @{
        source  = $Source
        samples = @($chunk | ForEach-Object { @{ atUtc = $_.atUtc; values = $_.values } })
    } | ConvertTo-Json -Depth 5 -Compress
    if ($DryRun) {
        Write-Host $body
        Write-Log ("DryRun: {0} neue Messpunkte, {1} Anfrage(n)" -f $sorted.Count, [math]::Ceiling($sorted.Count / $BatchSize))
        exit 0
    }
    $skipBatch = $false
    try {
        $res = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30
        $sent += $res.accepted
    } catch {
        $status = 0
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        if ($status -eq 422) {
            # Ungueltige Werte (z. B. Messfehler ausserhalb des Bereichs): Stapel ueberspringen, sonst haengt er ewig.
            Write-Log "Stapel abgelehnt (422), uebersprungen: $($_.ErrorDetails.Message)"
            $skipBatch = $true
        } else {
            Write-Log "Senden fehlgeschlagen (Status $status), naechster Versuch beim naechsten Lauf: $($_.Exception.Message)"
            exit 1
        }
    }
    # Fortschritt erst nach Erfolg (oder bewusstem Ueberspringen) speichern.
    $lastUtc = $chunk[-1].at.UtcDateTime.ToString('o', $Inv)
    @{ lastUtc = $lastUtc } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
    if ($skipBatch) { continue }
}
Write-Log ("{0}: {1} Messpunkte gesendet, {2} angenommen" -f $Source, $sorted.Count, $sent)
exit 0
