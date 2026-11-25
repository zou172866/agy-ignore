@echo off
setlocal EnableExtensions
chcp 65001 >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$keys = @('HKCU:\Software\Classes\Directory\shell\AgyIgnore','HKCU:\Software\Classes\Directory\Background\shell\AgyIgnore');" ^
  "foreach($k in $keys){ if(Test-Path $k){ Remove-Item -Path $k -Recurse -Force; Write-Host ('[OK] Removed ' + $k) } else { Write-Host ('[SKIP] Not found: ' + $k) } };" ^
  "$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'agy-ignore.lnk';" ^
  "if(Test-Path $lnk){ Remove-Item -Path $lnk -Force; Write-Host ('[OK] Removed Desktop shortcut: ' + $lnk) } else { Write-Host ('[SKIP] Shortcut not found: ' + $lnk) }"

if errorlevel 1 (
  echo [ERROR] Uninstall failed.
  pause
  exit /b 1
)

if /i not "%~1"=="--no-pause" pause
exit /b 0
