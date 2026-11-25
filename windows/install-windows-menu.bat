@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
set "TOOL_BAT=%SCRIPT_DIR%agy-ignore.bat"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$tool = [System.IO.Path]::GetFullPath($env:TOOL_BAT);" ^
  "$pct = [char]37;" ^
  "$label = 'agy-ignore (.antigravityignore)';" ^
  "$dirKey = 'HKCU:\Software\Classes\Directory\shell\AgyIgnore';" ^
  "$bgKey  = 'HKCU:\Software\Classes\Directory\Background\shell\AgyIgnore';" ^
  "New-Item -Path ($dirKey + '\command') -Force | Out-Null;" ^
  "Set-ItemProperty -Path $dirKey -Name '(default)' -Value $label;" ^
  "Set-ItemProperty -Path $dirKey -Name 'Icon' -Value 'shell32.dll,21';" ^
  "Set-ItemProperty -Path ($dirKey + '\command') -Name '(default)' -Value ('\"' + $tool + '\" \"' + $pct + '1\"');" ^
  "New-Item -Path ($bgKey + '\command') -Force | Out-Null;" ^
  "Set-ItemProperty -Path $bgKey -Name '(default)' -Value $label;" ^
  "Set-ItemProperty -Path $bgKey -Name 'Icon' -Value 'shell32.dll,21';" ^
  "Set-ItemProperty -Path ($bgKey + '\command') -Name '(default)' -Value ('\"' + $tool + '\" \"' + $pct + 'V\"');" ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$lnkPath = Join-Path $desktop 'agy-ignore.lnk';" ^
  "$wsh = New-Object -ComObject WScript.Shell;" ^
  "$sc = $wsh.CreateShortcut($lnkPath);" ^
  "$sc.TargetPath = $tool;" ^
  "$sc.WorkingDirectory = (Split-Path $tool -Parent);" ^
  "$sc.Description = 'Drag a folder here or double-click to audit and generate .antigravityignore';" ^
  "$sc.IconLocation = 'shell32.dll,21';" ^
  "$sc.Save();" ^
  "Write-Host '[OK] Registered HKCU Explorer context menu (no admin needed).';" ^
  "Write-Host ('[OK] Created Desktop shortcut: ' + $lnkPath);"

if errorlevel 1 (
  echo [ERROR] Installation failed.
  pause
  exit /b 1
)

if /i not "%~1"=="--no-pause" pause
exit /b 0
