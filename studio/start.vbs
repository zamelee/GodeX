' GodeX Studio launcher (VBS wrapper, hides PowerShell window)
Set Shell = CreateObject("Wscript.Shell")
ScriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
PSCmd = "powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File """ & ScriptDir & "\start.ps1"""
Shell.Run PSCmd, 0, False
