<# chrome-browser-mcp HTTP 启动器
# 用法: .\start-mcp.ps1 [start|stop|restart|status]
# 环境变量:
#   HEADLESS   - true/false (默认 false，即 headful 可见)
#   CDP_PORT   - 指定 Chrome 调试端口 (默认自动查找 9222-9225)
#   MCP_PORT   - MCP HTTP 服务器端口 (默认 9224)
#>

param(
    [string]$Action = "start",
    [string]$Headless = "false",
    [string]$CdpPort = "0",
    [string]$McpPort = "9224",
    [string]$Debug = "0"
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DistDir = Join-Path $ScriptRoot "dist"
$HttpFile = Join-Path $DistDir "index_http.js"
$PidFile = Join-Path $ScriptRoot ".mcp.pid"
$LogFile = Join-Path $ScriptRoot ".mcp.log"
$ErrFile = Join-Path $ScriptRoot ".mcp.err"

function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red }
function Write-Debug($msg) { if ($Debug -eq "1") { Write-Host "[DBG]  $msg" -ForegroundColor DarkGray } }

function Get-McpPid {
    if (Test-Path $PidFile) {
        $mcpPid = [int](Get-Content $PidFile -Raw).Trim()
        if ($mcpPid -gt 0) {
            try {
                $proc = Get-Process -Id $mcpPid -ErrorAction SilentlyContinue
                if ($proc) { return $mcpPid }
            } catch { }
        }
        Remove-Item $PidFile -ErrorAction SilentlyContinue
    }
    return $null
}

function Show-Status {
    $mcpPid = Get-McpPid
    if ($mcpPid) {
        $proc = Get-Process -Id $mcpPid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Success "chrome-browser-mcp 运行中 (PID: $mcpPid)"
            Write-Host "  命令: $($proc.Path)"
            Write-Host "  启动: $($proc.StartTime)"
            Write-Host "  内存: $([math]::Round($proc.WorkingSet64/1MB,1)) MB"
            $port = Get-NetTCPConnection -OwningProcess $mcpPid -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq 9224 } | Select-Object -First 1
            if ($port) {
                Write-Host "  监听: http://localhost:$($port.LocalPort)"
            }
            # 读取日志
            if (Test-Path $LogFile) {
                $log = Get-Content $LogFile -Raw
                if ($log -match "HTTP 模式启动") {
                    $log -split "`n" | Where-Object { $_ -match "HTTP|MCP|Chrome|Ready" -and $_ -notmatch "^$" } | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" }
                }
            }
            return
        }
    }
    Write-Info "chrome-browser-mcp 未运行"
    Write-Info "使用 '.\start-mcp.ps1 start' 启动"
}

function Stop-Mcp {
    $mcpPid = Get-McpPid
    if ($mcpPid) {
        Write-Info "停止 MCP 服务器 (PID: $mcpPid)..."
        try {
            Stop-Process -Id $mcpPid -Force -ErrorAction Stop
            Start-Sleep 1
            $remaining = Get-Process -Id $mcpPid -ErrorAction SilentlyContinue
            if ($remaining) {
                Write-Warn "进程未响应，强制终止..."
                Stop-Process -Id $mcpPid -Force -Confirm:$false
            }
            Remove-Item $PidFile -ErrorAction SilentlyContinue
            Write-Success "已停止"
        } catch {
            Write-Fail "停止失败: $_"
            exit 1
        }
    } else {
        Write-Info "MCP 服务器未运行"
    }
}

function Find-ChromePort {
    $ports = @(9222, 9223, 9224, 9225)
    foreach ($p in $ports) {
        try {
            $r = Invoke-RestMethod "http://localhost:$p/json/version" -TimeoutSec 1 -ErrorAction SilentlyContinue
            if ($r) {
                Write-Debug "发现 Chrome 调试端口: $p"
                return $p
            }
        } catch { }
    }
    return $null
}

function Start-Mcp {
    $mcpPid = Get-McpPid
    if ($mcpPid) {
        Write-Warn "chrome-browser-mcp 已在运行 (PID: $mcpPid)"
        Write-Info "使用 '.\start-mcp.ps1 stop' 先停止"
        return
    }

    if (-not (Test-Path $HttpFile)) {
        Write-Fail "找不到入口文件: $HttpFile"
        Write-Info "请先运行: cd $ScriptRoot && bun run build"
        exit 1
    }

    # 检查端口是否被占用
    $portInUse = Get-NetTCPConnection -LocalPort $McpPort -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($portInUse) {
        Write-Warn "端口 $McpPort 已被占用 (PID: $($portInUse.OwningProcess))"
        $proc = Get-Process -Id $portInUse.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) { Write-Host "  进程: $($proc.ProcessName)" }
        Write-Info "使用 '.\start-mcp.ps1 start -McpPort 9225' 尝试其他端口"
        exit 1
    }

    # 环境变量
    $env:HEADLESS = $Headless
    $env:DEBUG = $Debug
    $env:MCP_PORT = $McpPort
    if ($CdpPort -ne "0") { $env:CDP_PORT = $CdpPort }

    Write-Info "启动 chrome-browser-mcp (HTTP 模式)..."
    Write-Info "  入口: $HttpFile"
    Write-Info "  MCP 端口: $McpPort"
    Write-Info "  HEADLESS: $Headless"
    Write-Info "  CDP 端口: $(if($CdpPort -eq '0'){'自动查找'} else {$CdpPort})"
    Write-Info "  日志: $LogFile"

    # 查找已有 Chrome
    $chromePort = Find-ChromePort
    if ($chromePort) {
        Write-Success "将接管已有 Chrome (调试端口: $chromePort)"
        $env:CDP_PORT = $chromePort
    } else {
        Write-Info "未找到已有 Chrome，将启动独立实例"
    }

    # 启动进程
    $proc = Start-Process -FilePath "node" `
        -ArgumentList $HttpFile `
        -WorkingDirectory $DistDir `
        -NoNewWindow `
        -PassThru `
        -RedirectStandardOutput $LogFile `
        -RedirectStandardError $ErrFile

    if (-not $proc) {
        Write-Fail "启动进程失败"
        exit 1
    }

    $proc.Id | Out-File -FilePath $PidFile -Encoding UTF8
    Write-Info "进程 PID: $($proc.Id)，等待服务就绪..."

    # 等待服务启动
    $started = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep 1
        try {
            $r = Invoke-RestMethod "http://localhost:$McpPort/health" -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($r -and $r.status -eq "ok") {
                $started = $true
                break
            }
        } catch { }
        # 检查进程是否崩溃
        if ($null -eq (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) {
            Write-Fail "进程已退出"
            if (Test-Path $ErrFile) { Get-Content $ErrFile | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red } }
            exit 1
        }
    }

    if ($started) {
        Write-Success "✅ MCP 服务器已就绪"
        Write-Host "  MCP 端点: http://localhost:$McpPort/mcp"
        Write-Host "  健康检查: http://localhost:$McpPort/health"
        Write-Host "  工具列表: http://localhost:$McpPort/tools"
        Write-Host ""
        Write-Host "Codex 配置示例 (MCP HTTP 模式):"
        Write-Host "  Kind: MCP"
        Write-Host "  ID: browser_control_http"
        Write-Host "  command: node"
        Write-Host "  args: [dist/index_http.js]"
        Write-Host "  HTTP 地址: http://localhost:$McpPort/mcp"
    } else {
        Write-Warn "服务可能未就绪，检查日志:"
        if (Test-Path $LogFile) { Get-Content $LogFile | Select-Object -First 10 }
    }
}

# ============ 主入口 ============
switch ($Action.ToLower()) {
    "start"   { Start-Mcp }
    "stop"    { Stop-Mcp }
    "restart" { Stop-Mcp; Start-Mcp }
    "status"  { Show-Status }
    default {
        Write-Host @"
用法: .\start-mcp.ps1 <命令> [-Headless] [-CdpPort] [-McpPort] [-Debug]

命令:
  start    启动 MCP 服务器 (默认)
  stop     停止 MCP 服务器
  restart  重启 MCP 服务器
  status   查看运行状态

参数:
  -Headless <true|false>  Headless 模式 (默认 false)
  -CdpPort  <端口>        Chrome 调试端口 (默认自动 9222-9225)
  -McpPort  <端口>        MCP HTTP 监听端口 (默认 9224)
  -Debug    <0|1>         调试日志 (默认 0)

示例:
  .\start-mcp.ps1 start                         # 启动，可见 Chrome
  .\start-mcp.ps1 start -Headless true          # headless 模式
  .\start-mcp.ps1 start -CdpPort 9222           # 接管端口 9222 的 Chrome
  .\start-mcp.ps1 start -McpPort 9226           # HTTP 监听端口 9226
  .\start-mcp.ps1 status                         # 查看状态
  .\start-mcp.ps1 stop                           # 停止
"@
        exit 0
    }
}
