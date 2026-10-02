"""Build the page that is published.

web/app.html is the source of the web app (it was forked on 2026-10-02 from the
sheet ERP's page plus the patches in legacy/build_ui.py; the sheet ERP is no
longer followed). This only stamps in where the server is.

    python build.py                      -> index.html (live server)
    ERP_API=http://localhost:8794/ ERP_OUT=index-local.html python build.py
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = 'https://oqzcuuytytqadqjlwdsh.supabase.co/functions/v1/erp'
api = os.environ.get('ERP_API', LIVE)
out = os.path.join(HERE, os.environ.get('ERP_OUT', 'index.html'))

s = open(os.path.join(HERE, 'app.html'), encoding='utf-8').read()
s, n = re.subn(r"^var ERP_API = '[^']*';", "var ERP_API = '%s';" % api, s, count=1, flags=re.M)
if n != 1:
    sys.exit('ERP_API line not found in app.html')
open(out, 'w', encoding='utf-8', newline='\n').write(s)
print('built', out, len(s), 'bytes ->', api)
