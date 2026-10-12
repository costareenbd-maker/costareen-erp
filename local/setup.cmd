@echo off
rem One-time setup of the local ERP: a Python venv with the embedded Postgres, and the node packages.
rem Needs: Python 3.12 (pgserver has no wheel for 3.13 yet) and Node 20+.
setlocal
cd /d "%~dp0"
set PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe
if not exist "%PY%" set PY=py -3.12
if not exist pgenv (
  echo Making the Python environment...
  "%PY%" -m venv pgenv || goto :fail
)
pgenv\Scripts\python -m pip install --quiet --upgrade pip
pgenv\Scripts\python -m pip install --quiet pgserver==0.1.4 psycopg2-binary==2.9.13 openpyxl || goto :fail
echo Installing node packages...
pushd node
call npm install --silent --no-audit --no-fund || (popd & goto :fail)
popd
echo.
echo Done. Start the ERP with start.cmd
exit /b 0
:fail
echo.
echo Setup failed. Is Python 3.12 installed at %PY% and node on the PATH?
exit /b 1
