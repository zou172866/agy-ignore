@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
set "CLI_PATH=%SCRIPT_DIR%..\bin\agy-ignore.mjs"

where node >nul 2>&1
if errorlevel 1 (
  echo [agy-ignore] Node.js ^>= 18 is required. Please install Node.js first.
  pause
  exit /b 1
)

set "TARGET=%~1"
if not "%TARGET%"=="" goto :run_with_target

for /f "usebackq delims=" %%D in (`powershell -NoProfile -STA -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Select workspace folder for agy-ignore'; $d.ShowNewFolderButton=$false; if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){ Write-Output $d.SelectedPath }"`) do set "TARGET=%%D"

if "%TARGET%"=="" exit /b 0

:run_with_target
if "%TARGET:~-1%"=="\" set "TARGET=%TARGET%."

shift
set "EXTRA_ARGS="
:collect_args
if "%~1"=="" goto :dispatch
set "EXTRA_ARGS=%EXTRA_ARGS% %1"
shift
goto :collect_args

:dispatch
if "%EXTRA_ARGS%"=="" goto :exec_interactive
node "%CLI_PATH%" "%TARGET%"%EXTRA_ARGS%
exit /b %ERRORLEVEL%

:exec_interactive
node "%CLI_PATH%" "%TARGET%" --interactive --pause
exit /b %ERRORLEVEL%
