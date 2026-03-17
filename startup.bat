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
        call npm run dev
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
echo.
call pnpm dev

pause
 