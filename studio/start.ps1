# GodeX Studio launcher
# Starts bun backend (if not running) and opens Studio UI in Edge App Mode
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$Port = 56791
$BunExe = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
$BackendPort = if ($env:GODEX_BASE -match ":(\d+)$") { $matches[1] } else { "5678" }
$StudioUrl = "http://127.0.0.1:$Port/"

$EdgePaths = @(
  "C:\Program Files (x86)\Microsoft\EdgeCore\*\msedge.exe",
  "C:\Program Files\Microsoft\EdgeCore\*\msedge.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)
$Edge = $null
foreach ($p in $EdgePaths) {
  $found = Get-Item $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $Edge = $found.FullName; break }
}
if (-not $Edge) {
  $cmd = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($cmd) { $Edge = $cmd.Source }
}
if (-not $Edge) {
  Write-Host "[!] Edge not found. Open browser manually: $StudioUrl"
  Start-Process $StudioUrl
  Read-Host "Press Enter"; exit 1
}

function Test-Port([int]$P) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ar = $c.BeginConnect("127.0.0.1", $P, $null, $null)
    $ok = $ar.AsyncWaitHandle.WaitOne(200)
    $c.Close()
    return $ok
  } catch { return $false }
}

if (-not (Test-Port $Port)) {
  Write-Host "[*] Starting bun backend on :$Port (godex on :$BackendPort)..."
  if (-not (Test-Path $BunExe)) {
    Write-Host "[X] Bun not found at $BunExe"
    Read-Host "Enter"; exit 1
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $BunExe
  $psi.Arguments = "run serve.ts"
  $psi.WorkingDirectory = $ScriptDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables["STUDIO_PORT"] = "$Port"
  $psi.EnvironmentVariables["GODEX_BASE"] = "http://127.0.0.1:$BackendPort"
  [System.Diagnostics.Process]::Start($psi) | Out-Null

  $tries = 0
  while (-not (Test-Port $Port) -and $tries -lt 30) {
    Start-Sleep -Milliseconds 500
    $tries++
  }
  if (-not (Test-Port $Port)) {
    Write-Host "[X] Backend did not start within 15s"
    Read-Host "Enter"; exit 1
  }
  Write-Host "[OK] Backend ready"
} else {
  Write-Host "[OK] Backend already running"
}

Write-Host "[*] Opening Edge App Mode: $StudioUrl"
Start-Process $Edge -ArgumentList @("--app=$StudioUrl", "--window-size=1400,900", "--window-position=200,100")
