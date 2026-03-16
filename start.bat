@echo off
TITLE PersonalClaw v10 - Runner

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║          PersonalClaw v10 - Starting System          ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

:: Check if node_modules exists
if not exist node_modules (
    echo [ERROR] Dependencies not found! Please run setup.bat first.
    pause
    exit /b 1
)

:: Check if .env exists
if not exist .env (
    echo [ERROR] .env file not found! Please run setup.bat first.
    pause
    exit /b 1
)

echo [Server] Dashboard will be at http://localhost:5173
echo [Server] Control-C to stop both processes.
echo.

:: Launch everything using the 'all' script in package.json
call npm run all
