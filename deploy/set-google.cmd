@echo off
title Costareen ERP - set up Google Drive
echo Costareen ERP: connect Google Drive (backups, invoice PDFs, live backup sheet).
echo Paste the Client ID, press Enter, then paste the Client secret (nothing shows while you paste) and press Enter.
echo.
"C:\Program Files\Git\bin\bash.exe" -lc "cd /g/costareen-erp/deploy && source secrets.env && export NODE_OPTIONS='--max-semi-space-size=1 --max-old-space-size=400' && python set_google.py --deploy"
echo.
pause
