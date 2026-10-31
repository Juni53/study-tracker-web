@echo off
rem Study Tracker (Web) - start on this PC only (http://localhost:8000/)
cd /d "%~dp0"
where python >nul 2>nul
if %errorlevel%==0 (python tools\serve.py %*) else (py tools\serve.py %*)
pause
