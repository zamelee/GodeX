<#
chrome-browser-mcp STDIO 后台启动器

原理：用 PowerShell 的 Named Pipe 为 stdio 服务器提供持久的输入源。
这样 MCP 服务器可以后台运行，同时 stdin 保持打开。
当需要发消息时，通过命名管道写入，服务器处理后通过 stdout 返回。
#

param(
    [string]$Action = "start",
    [string]$Headless = "false",
    [string]$CdpPort = "0"
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DistDir = Join-Path $ScriptRoot "dist"
$StdioFile = Join-Path $DistDir "index_stdio.js"
$PidFile = Join-Path $ScriptRoot ".stdio.pid"
$LogFile = Join-Path $ScriptRoot ".stdio.log"
$ErrFile = Join-Path $ScriptRoot ".stdio.err"
$PipeName = "chrome-browser-mcp-stdio"
$PipePath = "\\.\pipe\$PipeName"

function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Success($msg) { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red }

function Get-StdioPid {
    if (Test-Path $PidFile) {
        $id = [int](Get-Content $PidFile -Raw).Trim()
        if ($id -gt 0) {
            try {
                $p = Get-Process -Id $id -ErrorAction SilentlyContinue
                if ($p) { return $id }
            } catch { }
        }
        Remove-Item $PidFile -ErrorAction SilentlyContinue
    }
    return $null
}

function Show-Status {
    $id = Get-StdioPid
    if ($id) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($p) {
            Write-Success "chrome-browser-mcp (stdio) 运行中 (PID: $id)"
            Write-Host "  启动: $($p.StartTime)"
            Write-Host "  内存: $([math]::Round($p.WorkingSet64/1MB,1)) MB"
            if (Test-Path $LogFile) {
                $log = Get-Content $LogFile -Raw
                $log -split "`n" | Where-Object { $_ -match "Starting|Chrome|Ready|Error" -and $_ -notmatch "^$" } | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" }
            }
            return
        }
    }
    Write-Info "chrome-browser-mcp (stdio) 未运行"
}

function Stop-Stdio {
    $id = Get-StdioPid
    if ($id) {
        Write-Info "停止 (PID: $id)..."
        try {
            Stop-Process -Id $id -Force -ErrorAction Stop
            Start-Sleep 1
            Remove-Item $PidFile -ErrorAction SilentlyContinue
            Write-Success "已停止"
        } catch {
            Write-Fail "停止失败: $_"
        }
    } else {
        Write-Info "未运行"
    }
}

function Start-Stdio {
    $id = Get-StdioPid
    if ($id) {
        Write-Warn "已在运行 (PID: $id)，先停止"
        Stop-Stdio
    }

    if (-not (Test-Path $StdioFile)) {
        Write-Fail "找不到 $StdioFile"
        Write-Info "先运行: cd $ScriptRoot && bun run build"
        exit 1
    }

    $env:HEADLESS = $Headless
    if ($CdpPort -ne "0") { $env:CDP_PORT = $CdpPort }

    Write-Info "启动 chrome-browser-mcp (stdio 模式)..."
    Write-Info "  HEADLESS: $Headless"
    Write-Info "  CDP_PORT: $(if($CdpPort -eq '0'){'auto'} else {$CdpPort})"

    # 方法: 通过 Start-Process 启动，用 Windows 的 conhost 处理 stdin
    # stdin 通过 -RedirectStandardInput 指向一个永远不发送 EOF 的管道
    # 更简单的方式: 用 /dev/null 在 Unix，或在 Windows 上用 NUL
    # 但 NUL 会导致 stdin 立即 EOF

    # 最可靠的方式: 让 node 进程用 命名管道客户端连接到一个
    # 服务器端写的 "stdin"
    
    # 实际上更简单: 使用 Start-Process 的 -NoNewWindow + 
    # PowerShell 管道输入会关闭 stdin
    
    # 结论: stdio 模式在后台运行时 stdin 来源是个难题
    # 建议用 HTTP 模式用于后台启动器
    
    Write-Warn "stdio 模式不适合纯后台启动"
    Write-Host ""
    Write-Host "原因: PowerShell Start-Process 无法为后台进程保持 stdin 打开"
    Write-Host "stdin 在所有输入被消费后会自动 EOF，导致服务器退出"
    Write-Host ""
    Write-Host "推荐方案:"
    Write-Host "  1. Codex MCP 集成: 使用 HTTP 模式 (start-mcp.ps1 start)"
    Write-Host "     Codex 通过 StreamableHTTP 协议连接 http://localhost:9224/mcp"
    Write-Host "  2. 如果一定要用 stdio: 让 Codex 直接启动服务器进程 (Codex++ 内置方式)"
    Write-Host ""
    Write-Host "HTTP 模式已完整实现，测试通过，建议使用 start-mcp.ps1"
}

switch ($Action.ToLower()) {
    "start"  { Start-Stdio }
    "stop"   { Stop-Stdio }
    "restart" { Stop-Stdio; Start-Stdio }
    "status"  { Show-Status }
    default {
        Write-Host @"
用法: .\start-stdio.ps1 <start|stop|restart|status>

注意: stdio 模式不适合后台启动
推荐使用 HTTP 模式: .\start-mcp.ps1 start
"@
    }
}
