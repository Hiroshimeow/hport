@echo off
setlocal enabledelayedexpansion

title H-PORT Launcher
:: Change to script directory, supports spaces in path
cd /d "%~dp0"

cls
echo ------------------------------------------------
echo         H-PORT LAUNCHER - HCU-LAB.ME
echo ------------------------------------------------
echo.

:: 1. Handle Input Target (IP/Port)
set "TARGET=%~1"
if "!TARGET!"=="" (
    echo [?] Enter Target (e.g., 8080 or 192.168.1.10:8080)
    set /p "TARGET=[>] Target [Enter for 8080]: "
)
if "!TARGET!"=="" set "TARGET=127.0.0.1:8080"

:: 2. Handle Subdomain parameter
set "SUB_NAME=%~3"
if "%~2"=="-s" (
    set "SUB_ARG=-s %~3"
) else (
    echo.
    echo [?] Enter Subdomain (Press Enter for random)
    set /p "USER_SUB=[>] Subdomain: "
    if not "!USER_SUB!"=="" set "SUB_ARG=-s !USER_SUB!"
)

:: 3. Execution
echo.
echo [!] Connecting to H-Lab Edge...
echo.

:: Run node with dist/index.js (Quotes protect paths with spaces)
node "%~dp0dist\index.js" !TARGET! !SUB_ARG!

if %errorlevel% neq 0 (
    echo.
    echo [!] Tunnel stopped.
)
pause
