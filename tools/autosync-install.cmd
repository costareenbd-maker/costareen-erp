@echo off
rem devsync-2: run ONCE on each developer's PC, inside the costareen-erp folder (double-click, or: tools\autosync-install.cmd)
rem  1. every commit goes to GitHub at once (.githooks/post-commit); keys / private files are refused (.githooks/pre-push)
rem  2. every 2 minutes: the other developer's work is pulled in, and anything not yet on GitHub is pushed
rem Undo:  git config --unset core.hooksPath   and   schtasks /delete /tn "Costareen git autosync" /f
setlocal
cd /d "%~dp0.."
git config core.hooksPath .githooks
for /f "delims=" %%p in ('python -c "import sys;print(sys.executable)"') do set PY=%%p
set VBS=%~dp0autosync-run.vbs
> "%VBS%" echo Set sh = CreateObject("WScript.Shell")
>> "%VBS%" echo sh.Run """%PY%"" ""%~dp0autosync.py""", 0, False
schtasks /create /tn "Costareen git autosync" /sc minute /mo 2 /tr "wscript.exe \"%VBS%\"" /f
"%PY%" "%~dp0autosync.py"
echo.
echo Done: commits go to GitHub by themselves; the other developer's work arrives every 2 minutes.
echo Log: tools\autosync.log
endlocal
