@echo off
title Costareen ERP - accounts
"C:\Program Files\Git\bin\bash.exe" -lc "cd /g/costareen-erp/deploy && source secrets.env && python accounts.py"
echo.
pause
