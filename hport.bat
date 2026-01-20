@echo off
setlocal enabledelayedexpansion

title H-PORT Launcher
:: Chuyen den thu muc chua script, ho tro dau cach trong duong dan
cd /d "%~dp0"

cls
echo ------------------------------------------------
echo         H-PORT LAUNCHER - HCU-LAB.ME
echo ------------------------------------------------
echo.

:: 1. Xu ly tham so dau vao (IP/Port)
set "TARGET=%~1"
if "!TARGET!"=="" (
    echo [?] Nhap muc tieu (Vi du: 8080 hoac 192.168.1.10:8080)
    set /p "TARGET=[>] Target [Enter for 8080]: "
)
if "!TARGET!"=="" set "TARGET=127.0.0.1:8080"

:: 2. Xu ly tham so Subdomain
set "SUB_NAME=%~3"
if "%~2"=="-s" (
    set "SUB_ARG=-s %~3"
) else (
    echo.
    echo [?] Nhap Subdomain mong muon (Enter de tao ngau nhien)
    set /p "USER_SUB=[>] Subdomain: "
    if not "!USER_SUB!"=="" set "SUB_ARG=-s !USER_SUB!"
)

:: 3. Thuc thi
echo.
echo [!] Dang ket noi den H-Lab Edge...
echo.

:: Chay node voi file dist/index.js (Dung dau ngoac kep de bao ve duong dan co dau cach)
node "%~dp0dist\index.js" !TARGET! !SUB_ARG!

if %errorlevel% neq 0 (
    echo.
    echo [!] Tunnel da dung.
)
pause
