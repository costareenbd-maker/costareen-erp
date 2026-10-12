@echo off
rem Stop a local ERP left running (API :8794, web :8793). The database is stopped by run.py itself.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8794 .*LISTENING" /c:":8793 .*LISTENING"') do taskkill /PID %%p /F >nul 2>&1
echo Stopped.
