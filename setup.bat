@echo off
setlocal enabledelayedexpansion

TITLE PersonalClaw v10 - Setup Wizard

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║          PersonalClaw v10 - Installation             ║
echo   ╚══════════════════════════════════════════════════════╝
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed! 
    echo Please download and install it from: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/5] Installing Brain dependencies...
call npm install

echo [2/5] Installing Browser (Chromium)...
call npx playwright install chromium

echo [3/5] Installing Dashboard dependencies...
cd dashboard
call npm install
cd ..

echo [4/5] Configuring Environment Variables...
if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env >nul
)

:: Prompt for Gemini Key
set /p GEMINI_KEY="Enter your Google Gemini API Key (get it at aistudio.google.com): "
if not "!GEMINI_KEY!"=="" (
    powershell -Command "(gc .env) -replace 'GEMINI_API_KEY=.*', 'GEMINI_API_KEY=!GEMINI_KEY!' | Out-File -encoding ASCII .env"
    echo [OK] Gemini API Key updated.
) else (
    echo [SKIP] Gemini API Key not provided. You will need to add it manually to .env.
)

:: Prompt for Telegram (Optional)
echo.
set /p SETUP_TG="Do you want to set up Telegram now? (y/n): "
if /i "%SETUP_TG%"=="y" (
    set /p TG_TOKEN="Enter your Telegram Bot Token (from @BotFather): "
    if not "!TG_TOKEN!"=="" (
        powershell -Command "(gc .env) -replace 'TELEGRAM_BOT_TOKEN=.*', 'TELEGRAM_BOT_TOKEN=!TG_TOKEN!' | Out-File -encoding ASCII .env"
        
        set /p TG_ID="Enter your Authorized Telegram Chat ID (optional, but recommended): "
        if not "!TG_ID!"=="" (
            powershell -Command "(gc .env) -replace 'AUTHORIZED_CHAT_ID=.*', 'AUTHORIZED_CHAT_ID=!TG_ID!' | Out-File -encoding ASCII .env"
        )
        echo [OK] Telegram configured.
    )
) else (
    echo [SKIP] Telegram setup skipped.
)

echo.
echo [5/5] Finalizing...
if not exist screenshots mkdir screenshots
if not exist memory mkdir memory

echo.
echo   ╔══════════════════════════════════════════════════════╗
echo   ║            Setup Complete! PersonalClaw is ready.     ║
echo   ╠══════════════════════════════════════════════════════╣
echo   ║   To start the system, run: start.bat                ║
echo   ╚══════════════════════════════════════════════════════╝
echo.
pause
