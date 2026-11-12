@echo off
rem Starts the dashboard's local admin page and opens it in the browser.
rem Double-click this file. Close its window to stop the admin page.
rem (For testing: set NO_BROWSER=1 to skip opening the browser.)
title Dashboard admin - close this window to stop
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on this computer. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

rem Already running? Then only open the page.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8081/admin/ | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo The admin page is already running.
  if not defined NO_BROWSER start "" "http://localhost:8081/admin/"
  timeout /t 3 >nul
  exit /b 0
)

rem Open the browser two seconds from now, once the server is listening.
if not defined NO_BROWSER start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8081/admin/'"

echo Dashboard admin: http://localhost:8081/admin/
echo Keep this window open while you work. Close it to stop.
echo.
node scripts\admin-server.mjs
echo.
echo The admin page has stopped.
pause
