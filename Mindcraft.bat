@echo off
REM Mindcraft — Windows launcher (double-click to start)

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   ✗ Node.js is not installed.
    echo.
    echo   Download it from https://nodejs.org ^(choose the LTS version^)
    echo   Then double-click this file again.
    echo.
    pause
    exit /b 1
)

node launcher.mjs %*

if errorlevel 1 (
    echo.
    echo   Mindcraft exited with an error. See above for details.
    pause
)
