@echo off
title Costareen ERP - set up e-mail sending
echo.
echo  Costareen ERP: send invitations and password e-mails through your Gmail.
echo  You need a Gmail APP PASSWORD (Google Account - Security - 2-Step Verification - App passwords).
echo  When asked for the password, paste the 16-letter app password and press Enter (nothing shows while typing).
echo.
"C:\Program Files\Git\bin\bash.exe" -lc "cd /g/costareen-erp/deploy && source secrets.env && python set_smtp.py --host smtp.gmail.com --port 587 --user costareen.bd@gmail.com --from costareen.bd@gmail.com --name 'Costareen ERP'"
echo.
pause
