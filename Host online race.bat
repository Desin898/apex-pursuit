@echo off
title Apex Pursuit - online race host
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is needed to host an online race.
  echo  Install the LTS version from https://nodejs.org , then double-click this file again.
  echo  ^(Playing solo needs nothing: just open play\ApexPursuit.html^)
  echo  ^(Joining a friend's race needs nothing either: open the link they send you^)
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
node server\host.mjs %*
pause
