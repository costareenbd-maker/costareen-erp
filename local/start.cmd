@echo off
rem Start the local ERP: database + API (:8794) + web page (:8793). Ctrl+C stops everything; the data stays.
cd /d "%~dp0"
if not exist pgenv\Scripts\python.exe (
  echo Run setup.cmd first.
  exit /b 1
)
pgenv\Scripts\python run.py %*
