@echo off
setlocal enabledelayedexpansion
title NextDM - Browser Integration Setup for Windows

echo ========================================================
echo   NextDM Native Messaging Host Installer for Windows
echo ========================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "HOST_EXE="

:: 1. Search for NextDM binary
if exist "%SCRIPT_DIR%nextdm-host.exe" (
    set "HOST_EXE=%SCRIPT_DIR%nextdm-host.exe"
) else if exist "%SCRIPT_DIR%NextDM.exe" (
    set "HOST_EXE=%SCRIPT_DIR%NextDM.exe"
) else if exist "%SCRIPT_DIR%NextDM_0.1.0_x64_portable.exe" (
    set "HOST_EXE=%SCRIPT_DIR%NextDM_0.1.0_x64_portable.exe"
) else if exist "%LOCALAPPDATA%\Programs\NextDM\NextDM.exe" (
    set "HOST_EXE=%LOCALAPPDATA%\Programs\NextDM\NextDM.exe"
) else if exist "%ProgramFiles%\NextDM\NextDM.exe" (
    set "HOST_EXE=%ProgramFiles%\NextDM\NextDM.exe"
) else if exist "%ProgramFiles(x86)%\NextDM\NextDM.exe" (
    set "HOST_EXE=%ProgramFiles(x86)%\NextDM\NextDM.exe"
)

if "%HOST_EXE%"=="" (
    echo [ERROR] Could not automatically locate NextDM.exe or nextdm-host.exe!
    echo Please make sure this script is located in the same folder as NextDM.exe.
    echo.
    if not "%1"=="/quiet" if not "%1"=="/silent" pause
    exit /b 1
)

echo [*] Target executable found: "%HOST_EXE%"

:: Escape backslashes for JSON manifest
set "JSON_ESC_EXE=!HOST_EXE:\=\\!"

:: Setup target paths
set "MOZILLA_DIR=%APPDATA%\Mozilla\NativeMessagingHosts"
set "CHROME_DIR=%LOCALAPPDATA%\nextdm"
set "EXT_DIR=%APPDATA%\nextdm\browser-extension"
set "FF_MANIFEST=%MOZILLA_DIR%\com.nextdm.host.json"
set "CHR_MANIFEST=%CHROME_DIR%\com.nextdm.host.chromium.json"

if not exist "%MOZILLA_DIR%" mkdir "%MOZILLA_DIR%" 2>nul
if not exist "%CHROME_DIR%" mkdir "%CHROME_DIR%" 2>nul
if not exist "%EXT_DIR%" mkdir "%EXT_DIR%" 2>nul

echo [*] Writing Firefox manifest: "%FF_MANIFEST%"
(
    echo {
    echo   "name": "com.nextdm.host",
    echo   "description": "NextDM download handoff host",
    echo   "path": "!JSON_ESC_EXE!",
    echo   "type": "stdio",
    echo   "allowed_extensions": [
    echo     "nextdm@nextdm.app"
    echo   ]
    echo }
) > "%FF_MANIFEST%"

echo [*] Writing Chromium manifest: "%CHR_MANIFEST%"
(
    echo {
    echo   "name": "com.nextdm.host",
    echo   "description": "NextDM download handoff host",
    echo   "path": "!JSON_ESC_EXE!",
    echo   "type": "stdio",
    echo   "allowed_origins": [
    echo     "chrome-extension://ciljeaclhfhipchfaocjmoanpbacibli/",
    echo     "chrome-extension://ngpampappnmepgilojfohadhhmbhlaek/",
    echo     "chrome-extension://llbjbkhnmlidjebalopleeepgdfgcpec/"
    echo   ]
    echo }
) > "%CHR_MANIFEST%"

copy /Y "%CHR_MANIFEST%" "%EXT_DIR%\com.nextdm.host.json" >nul 2>&1

echo [*] Registering native host in Windows Registry (HKCU)...

:: Firefox
reg add "HKCU\Software\Mozilla\NativeMessagingHosts\com.nextdm.host" /ve /t REG_SZ /d "%FF_MANIFEST%" /f >nul
if !errorlevel! equ 0 (
    echo   [+] Mozilla Firefox registered successfully
) else (
    echo   [-] Failed to register Mozilla Firefox key
)

:: Google Chrome
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.nextdm.host" /ve /t REG_SZ /d "%CHR_MANIFEST%" /f >nul
if !errorlevel! equ 0 (
    echo   [+] Google Chrome registered successfully
) else (
    echo   [-] Failed to register Google Chrome key
)

:: Microsoft Edge
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.nextdm.host" /ve /t REG_SZ /d "%CHR_MANIFEST%" /f >nul
if !errorlevel! equ 0 (
    echo   [+] Microsoft Edge registered successfully
) else (
    echo   [-] Failed to register Microsoft Edge key
)

:: Brave Browser
reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.nextdm.host" /ve /t REG_SZ /d "%CHR_MANIFEST%" /f >nul
if !errorlevel! equ 0 (
    echo   [+] Brave Browser registered successfully
) else (
    echo   [-] Failed to register Brave Browser key
)

:: Vivaldi
reg add "HKCU\Software\Vivaldi\NativeMessagingHosts\com.nextdm.host" /ve /t REG_SZ /d "%CHR_MANIFEST%" /f >nul
if !errorlevel! equ 0 (
    echo   [+] Vivaldi registered successfully
) else (
    echo   [-] Failed to register Vivaldi key
)

echo.
echo ========================================================
echo   Registration Complete!
echo ========================================================
echo NextDM native messaging is now active.
echo You can now download files with the NextDM Firefox and Chrome
echo extensions without the "no such native application" error.
echo.
if not "%1"=="/quiet" if not "%1"=="/silent" pause
exit /b 0
