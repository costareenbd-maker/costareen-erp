"""Existing ERP development deploy steps against the native development stack only."""
import pathlib, json, os, sys, subprocess, importlib.util, inspect, shutil, datetime, urllib.request, psycopg2, psycopg2.extras
BASE = pathlib.Path('/opt/erp-dev-migration')
ROOT = pathlib.Path(os.environ.get('DEVSYNC_DIR', '/opt/costareen-erp-devsync')).resolve()
n = json.loads((BASE / 'config.json').read_text())
assert n['ref'] == 'zukqxkcpmxcogbhkdpyw' and n['dbName'] == 'dev_zukqxkcpmxcogbhkdpyw_native'
os.environ['ERP_TARGET'] = 'dev'
os.umask(63)
for k, v in json.loads((BASE / 'devsync/native-devsync-secrets.json').read_text()).items():
    os.environ[k] = v
spec = importlib.util.spec_from_file_location('original_dev_deployer', ROOT / 'deploy/deploy.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert m.DEV and m.REF == n['ref'] and (m.PAGES_PROJECT == 'costareen-erp-dev')
ip = subprocess.check_output(['docker', 'inspect', 'supabase-db', '--format', '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}'], text=True).strip()

def sql(query):
    c = psycopg2.connect(host=ip, dbname=n['dbName'], user=n['dbRole'], password=n['dbPassword'])
    q = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        q.execute(query)
        out = [dict(r) for r in q.fetchall()] if q.description else []
        c.commit()
        return out
    finally:
        c.close()
m.sql = sql
api = m.api

def native_api(url, *a, **kw):
    if url == 'https://api.supabase.com/v1/projects/' + n['ref'] + '/api-keys':
        return (200, [{'name': 'anon', 'api_key': n['anon']}])
    if 'api.supabase.com' in url:
        raise SystemExit('Blocked Cloud API from native development deployment')
    return api(url, *a, **kw)
m.api = native_api
original_copy = shutil.copy

def copy_file(src, dst, *a, **kw):
    result = original_copy(src, dst, *a, **kw)
    p = pathlib.Path(result)
    if p.name == '_headers':
        s = p.read_text()
        s = s.replace('connect-src ', 'connect-src ' + n['url'] + ' ', 1).replace('img-src ', 'img-src ' + n['url'] + ' ', 1)
        p.write_text(s)
    elif p.name == 'sw.js':
        s = p.read_text()
        s = s.replace("var VERSION = 'cz-shell-v3'", "var VERSION = 'cz-shell-v3-native-dev-" + subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', '--short', 'HEAD'], text=True).strip() + "'")
        p.write_text(s)
    return result
shutil.copy = copy_file
web = inspect.getsource(m.step_web)
a = "ERP_API='https://%s.supabase.co/functions/v1/erp' % REF"
b = "ERP_SB_URL='https://%s.supabase.co' % REF"
assert a in web and b in web
web = web.replace("tok = need('SUPABASE_ACCESS_TOKEN')", 'tok = None  # Native bindings; no Cloud token or request').replace(a, "ERP_API=NATIVE_URL + '/functions/v1/erp'").replace(b, 'ERP_SB_URL=NATIVE_URL')
web = web.replace("        subprocess.check_call([sys.executable, os.path.join(ROOT, 'web', 'build.py')])   # leave index.html built for live", '        pass  # Dedicated native dev checkout; never build the Cloud/live template')
m.NATIVE_URL = n['url']
exec(compile(web, 'native-dev-web-wrapper', 'exec'), m.__dict__)

def smoke():
    secret = json.loads((BASE / 'smoke-secret.json').read_text())
    for action in ['erpHello', 'erpDashboardData', 'erpSelfTest']:
        req = urllib.request.Request('http://127.0.0.1:9342/erp', data=json.dumps({'name': action, 'args': [], 'token': {'key': secret['owner_key'], 'device': 'native-dev-deploy'}}).encode(), headers={'Content-Type': 'application/json', 'apikey': n['anon'], 'Origin': n['appUrl'].rstrip('/')})
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.load(r)
            assert d.get('ok'), action
    if action == 'erpSelfTest':
        assert all((not p.get('error') for p in d.get('result', [])))

def function():
    src = ROOT / 'supabase/functions/erp'
    assert (src / 'index.ts').exists()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    folder = BASE / 'functions'
    stage = folder / ('stage-' + stamp)
    previous = folder / ('before-' + stamp)
    shutil.copytree(src, stage)
    (folder / 'erp').rename(previous)
    stage.rename(folder / 'erp')
    try:
        subprocess.run(['docker', 'restart', 'erp-dev-edge'], check=True, stdout=subprocess.DEVNULL)
        smoke()
    except Exception:
        (folder / 'erp').rename(folder / ('failed-' + stamp))
        previous.rename(folder / 'erp')
        subprocess.run(['docker', 'restart', 'erp-dev-edge'], check=True, stdout=subprocess.DEVNULL)
        raise
    print('Native development function deployed; dashboard and self-test pass')

def secrets_step(pairs):
    f = BASE / 'runtime-extra.env.json'
    d = json.loads(f.read_text()) if f.exists() else {}
    for pair in pairs:
        k, v = pair.split('=', 1)
        assert k not in ['SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
        d[k] = v
    f.write_text(json.dumps(d))
    subprocess.run(['python3', str(BASE / 'start.py')], check=True)
if __name__ == '__main__':
    step = sys.argv[1] if len(sys.argv) > 1 else ''
    if step == 'db':
        backup = pathlib.Path('/data/backups/dev-deploy')
        backup.mkdir(exist_ok=True)
        f = backup / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.dump')
        with f.open('wb') as h:
            subprocess.run(['docker', 'exec', 'supabase-db', 'pg_dump', '-U', 'supabase_admin', '-d', n['dbName'], '-Fc'], stdout=h, check=True)
        m.step_db()
    elif step == 'function':
        function()
    elif step == 'web':
        m.step_web()
    elif step == 'secrets':
        secrets_step(sys.argv[2:])
    elif step == 'check':
        assert sql('select current_database() as db')[0]['db'] == n['dbName']
        smoke()
        print('Native target guard, development DB and existing backend checks pass')
    else:
        raise SystemExit('Only development db/function/web/secrets/check supported; no production deployment')
