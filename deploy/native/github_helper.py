import sys, json, pathlib
if len(sys.argv) > 1 and sys.argv[1] == 'get':
    req = dict((x.split('=', 1) for x in sys.stdin.read().splitlines() if '=' in x))
    if req.get('host') == 'github.com' and req.get('protocol') == 'https':
        c = json.loads(pathlib.Path('/opt/erp-dev-migration/devsync/github-credential.json').read_text())
        print('username=' + c['username'])
        print('password=' + c['password'])
        print()
