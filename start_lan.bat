@echo off
rem Study Tracker (Web) - also open to other devices on the same LAN / Wi-Fi
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (python tools\serve.py --lan %*) else (py tools\serve.py --lan %*)
pause
