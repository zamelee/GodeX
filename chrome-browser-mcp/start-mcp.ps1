param(
    [string]$Action = "start",
    [string]$Headless = "false",
    [string]$CdpPort = "0",
    [string]$McpPort = "9224"
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$HttpFile = Join-Path $ScriptRoot "dist\index_http.js"
$PidFile = Join-Path $ScriptRoot ".mcp.pid"
$LogFile = Join-Path $ScriptRoot ".mcp.log"
$ErrFile = Join-Path $ScriptRoot ".mcp.err"

function info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function ok($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red }

function getPid {
    if (Test-Path $PidFile) {
        $id = [int](Get-Content $PidFile -Raw).Trim()
        if ($id -gt 0) {
            $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
            if ($proc) { return $id }
        }
        Remove-Item $PidFile -ErrorAction SilentlyContinue
    }
    return $null
}

function doStatus {
    $id = getPid
    if ($id) {
        $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($proc) {
            ok "chrome-browser-mcp 运行中 (PID: $id)"
            info "命令: $($proc.Path)"
            info "启动: $($proc.StartTime)"
            $check = Invoke-RestMethod "http://localhost:$McpPort/health" -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($check) {
                info "健康: $($check.status)"
            }
            return
        }
    }
    info "chrome-browser-mcp 未运行"
    info "使用 '.\start-mcp.ps1 start' 启动"
}

function doStop {
    $id = getPid
    if ($id) {
        info "停止 MCP (PID: $id)..."
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
        Start-Sleep 1
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        ok "已停止"
    } else {
        info "MCP 未运行"
    }
}

function doStart {
    $id = getPid
    if ($id) {
        $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($proc) {
            warn "chrome-browser-mcp 已在运行 (PID: $id)"
            return
        }
    }

    if (-not (Test-Path $HttpFile)) {
        fail "找不到 $HttpFile"
        info "先运行: cd $ScriptRoot; bun run build"
        exit 1
    }

    # 检查端口
    $used = Get-NetTCPConnection -LocalPort $McpPort -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($used) {
        warn "端口 $McpPort 已被占用 (PID: $($used.OwningProcess))"
        exit 1
    }

    $env:HEADLESS = $Headless
    $env:MCP_PORT = $McpPort
    if ($CdpPort -ne "0") { $env:CDP_PORT = $CdpPort }

    info "启动 chrome-browser-mcp..."
    info "  入口: $HttpFile"
    info "  MCP端口: $McpPort"
    info "  HEADLESS: $Headless"

    $proc = Start-Process -FilePath "node" -ArgumentList $HttpFile -WorkingDirectory (Split-Path $HttpFile) -NoNewWindow -PassThru -RedirectStandardOutput $LogFile -RedirectStandardError $ErrFile
    $proc.Id | Out-File -FilePath $PidFile -Encoding UTF8
    info "PID: $($proc.Id)"

    # 等待就绪
    $ready = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep 1
        $check = Invoke-RestMethod "http://localhost:$McpPort/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($check -and $check.status -eq "ok") {
            $ready = $true
            break
        }
        if ($null -eq (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) {
            fail "进程已退出"
            if (Test-Path $ErrFile) { Get-Content $ErrFile | Select-Object -First 5 }
            exit 1
        }
    }

    if ($ready) {
        ok "chrome-browser-mcp 已就绪 (PID: $($proc.Id))"
        info "  MCP端点: http://localhost:$McpPort/call"
        info "  健康检查: http://localhost:$McpPort/health"
        info "  工具列表: http://localhost:$McpPort/tools"
    } else {
        warn "服务可能未就绪，请检查"
    }
}

switch ($Action.ToLower()) {
    "start"   { doStart }
    "stop"    { doStop }
    "restart" { doStop; doStart }
    "status"  { doStatus }
    default {
        Write-Host @"
用法: .\start-mcp.ps1 <命令>

命令:
  start    启动 MCP (默认)
  stop     停止 MCP
  restart  重启 MCP
  status   查看状态

示例:
  .\start-mcp.ps1 start
  .\start-mcp.ps1 start -McpPort 9225
  .\start-mcp.ps1 status
  .\start-mcp.ps1 stop
"@
    }
}
