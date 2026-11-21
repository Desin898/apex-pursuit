@echo off
title Apex Pursuit - online race host
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is needed to host an online race.
  echo  Install the LTS version from https://nodejs.org , then double-click this file again.
  echo  ^(Playing solo needs nothing: just open play\ApexPursuit.html^)
  echo.
  pause
  exit /b 1
)
if not exist "node_modules\ws" (
  echo Setting up for the first time ^(one small download^)...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo Setup failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
echo.
echo  Starting the race server. Keep this window open while you play.
echo  Friends on the same Wi-Fi: open the "Same network" address below in Chrome or Edge.
echo  If Windows asks about the firewall, allow access on private networks.
echo.
start "" "http://localhost:8080/?room=friends"
node server\relay.mjs
pause
