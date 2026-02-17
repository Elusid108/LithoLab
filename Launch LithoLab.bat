@echo off
cd /d "%~dp0"
title LithoLab Backend
start "LithoLab Backend" cmd /k "node server.js"
timeout /t 2 /nobreak >nul
start "" "%~dp0index.html"
