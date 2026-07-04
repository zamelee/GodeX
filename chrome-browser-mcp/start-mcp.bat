@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=start"

powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start-mcp.ps1" %*

