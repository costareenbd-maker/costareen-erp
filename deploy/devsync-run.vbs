' devsync-1: runs deploy/devsync.py with no window (the Windows task "Costareen dev sync" calls this every 2 minutes)
Set sh = CreateObject("WScript.Shell")
sh.Run """C:\Users\Nazir\AppData\Local\Programs\Python\Python313\python.exe"" ""G:\costareen-erp\deploy\devsync.py""", 0, False
