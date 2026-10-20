@echo off
rem devsync-1: every 2 minutes, bring what is on GitHub onto the DEV ERP (https://costareen-erp-dev.pages.dev).
rem Run once on the owner's PC. Remove with:  schtasks /delete /tn "Costareen dev sync" /f
schtasks /create /tn "Costareen dev sync" /sc minute /mo 2 /tr "wscript.exe \"G:\costareen-erp\deploy\devsync-run.vbs\"" /f
