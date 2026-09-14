@echo off
REM ==============================================================================
REM Quick Launcher for Automate Security Export & SonarQube Scan
REM ==============================================================================
setlocal
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\automate_sonar_scan.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Pipeline failed with exit code %ERRORLEVEL%
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [DONE] Pipeline finished successfully.
pause
