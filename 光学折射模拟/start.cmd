@echo off
rem ===========================================================
rem  Optics Lab - one click launcher (Windows)
rem
rem  NOTE: keep this file pure ASCII.
rem  cmd.exe reads .cmd files with the system ANSI codepage,
rem  so Chinese text here turns into garbled commands on most
rem  zh-CN Windows installs.
rem ===========================================================
setlocal
cd /d "%~dp0"

set "PORT=5180"
if not "%~1"=="" set "PORT=%~1"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] "node" was not found in PATH.
  echo         Install Node.js 22.6 or newer: https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo.
echo   Optics Lab
echo   Project : %CD%
echo   Port    : %PORT%
echo.

rem --- Is something already listening on this port? ---
set "PID="
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:":%PORT% .*LISTENING"') do set "PID=%%P"
if defined PID (
  echo   [WARN] Port %PORT% is already in use by PID %PID%.
  echo          That is probably an older instance of this app.
  echo          If the page below already works, just close this window.
  echo.
)

echo   URL     : http://127.0.0.1:%PORT%/
echo   Note    : keep this window open; Ctrl+C stops the server.
echo.

rem --- Open the browser a moment later, so the server is up ---
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:%PORT%/"

node "%~dp0server.mjs" --port %PORT%

echo.
echo   Server stopped.
pause
