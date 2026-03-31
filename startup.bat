@echo off
echo ===================================
echo MangaMaker Web App Startup Script
echo ===================================
echo.

REM Automatically attempt to install pnpm if missing
where pnpm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [INFO] pnpm is missing. Attempting to install pnpm via npm...
    call npm install -g pnpm
    if %ERRORLEVEL% neq 0 (
        echo [WARNING] Failed to install pnpm. Falling back to npm.
        echo [1/2] Installing dependencies with npm...
        call npm install
        if %ERRORLEVEL% neq 0 (
            echo [ERROR] Failed to install dependencies via npm.
            pause
            exit /b 1
        )
        echo.
        echo [2/2] Starting Web Application with npm...
        if exist "%USERPROFILE%\Desktop\ngrok.exe" (
            set "NGROK_BIN=%USERPROFILE%\Desktop\ngrok.exe"
            echo Using ngrok binary: %NGROK_BIN%
        )
        echo Share provider: ngrok
        echo.
        call npm run dev -- --share --share-provider ngrok --port 5173
        pause
        exit /b 0
    )
)

echo [1/2] Installing dependencies...
call pnpm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)
echo.

echo [2/2] Starting Web Application...
echo The application will start at http://localhost:5173
if exist "%USERPROFILE%\Desktop\ngrok.exe" (
    set "NGROK_BIN=%USERPROFILE%\Desktop\ngrok.exe"
    echo Using ngrok binary: %NGROK_BIN%
)
echo Share provider: ngrok
echo.
call pnpm dev -- --share --share-provider ngrok --port 5173

pause
 
