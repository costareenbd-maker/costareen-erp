"""Run the existing PC development sync on the native server, with native-only deployment."""
import pathlib, os, json, subprocess, sys, importlib.util
os.umask(63)
base = pathlib.Path('/opt/erp-dev-migration/devsync')
state = pathlib.Path('/var/lib/erp-devsync')
state.mkdir(exist_ok=True)
root = pathlib.Path('/opt/costareen-erp-devsync')
spec = importlib.util.spec_from_file_location('copied_devsync', base / 'devsync.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.HERE = str(base)
m.MAIN = str(root)
m.COPY = str(root)
m.STATE = str(state / 'state.json')
m.LOG = str(state / 'sync.log')
m.LOCK = str(state / 'sync.lock')

def secrets():
    return dict(os.environ, **json.loads((base / 'native-devsync-secrets.json').read_text()), ERP_TARGET='dev', DEVSYNC_DIR=str(root))
m.secrets = secrets

def deploy(step, env):
    p = subprocess.run(['/usr/bin/python3', str(base / 'deploy.py'), step], cwd=root, env=env, capture_output=True, text=True)
    lines = (p.stdout + p.stderr).strip().splitlines()[-3:]
    m.log('  %s -> %s %s' % (step, 'ok' if p.returncode == 0 else 'FAILED', ' | '.join(lines)[:400]))
    return p.returncode == 0
m.deploy = deploy
m.git.__kwdefaults__['cwd'] = str(root)
errors = []
log = m.log

def checked_log(msg):
    log(msg)
    if msg.startswith('ERROR '):
        errors.append(msg)
m.log = checked_log
m.main()
if errors or ((state / 'state.json').exists() and json.loads((state / 'state.json').read_text()).get('lastError')):
    raise SystemExit(1)
