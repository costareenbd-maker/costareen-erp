"""The local ERP on this computer: a Postgres that keeps its data in local/data, the same API code the live
Edge Function runs (supabase/functions/erp) on http://localhost:8794, and the web page on http://localhost:8793.

    start.cmd                 start it (first time: builds the database and writes the DEMO data - a made-up shop)
    start.cmd --fresh         throw the local database away and build it again
    start.cmd --no-seed       first build with an empty business (no demo data)
    ERP_SEED_DIR=<folder>     owner only: load a real sheet export instead of the demo (never kept in this folder)

Nothing here touches Supabase or the live ERP. The page is built with ERP_API pointing at this computer, so the
same web/app.html serves both; `deploy.py web` keeps publishing the live build. Mail, PDF and storage are the test
harness's fakes (supabase/tests/harness.mjs) - files land in memory, e-mails are printed, nothing leaves the PC.
"""
import os, sys, json, uuid, glob, shutil, subprocess, signal, time
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SQL_DIR = os.path.join(ROOT, 'supabase')
TESTS = os.path.join(SQL_DIR, 'tests')
DATA = os.path.join(HERE, 'data')
NODE = os.path.join(HERE, 'node')
KEYFILE = os.path.join(HERE, '.owner-key')
API_PORT, WEB_PORT = 8794, 8793

import pgserver, psycopg2

if '--fresh' in sys.argv and os.path.isdir(DATA):
    print('Throwing the local database away...')
    shutil.rmtree(DATA, ignore_errors=True)
    if os.path.exists(KEYFILE): os.remove(KEYFILE)
os.makedirs(DATA, exist_ok=True)
# pgserver waits 10 s for Postgres; after an unclean stop (a killed start) recovery on this drive takes longer,
# and antivirus can hold the log file - so try a few times; the second try finds the server already up
srv = None
for attempt in range(1, 5):
    try:
        srv = pgserver.get_server(DATA, cleanup_mode='stop'); break
    except Exception as e:
        print('Postgres is slow to start (try %d): %s' % (attempt, str(e).splitlines()[-1][:120])); time.sleep(8)
if srv is None:
    sys.exit('Postgres did not start. Close antivirus scans of local/data, or run start.cmd --fresh.')
uri = srv.get_uri()
conn = psycopg2.connect(uri); conn.autocommit = True
cur = conn.cursor()

STUBS = """
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, last_sign_in_at timestamptz,
  encrypted_password text, email_confirmed_at timestamptz, recovery_sent_at timestamptz, updated_at timestamptz, banned_until timestamptz);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), user_agent text, ip text);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, status text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub','')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create function public.gen_random_bytes(n int) returns bytea language sql volatile as $$
  select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
create table public._local_migrations (name text primary key, at timestamptz default now());
create table public._local_fixture (k text primary key, v text);
"""

def done_migrations():
    cur.execute("select 1 from information_schema.tables where table_name = '_local_migrations'")
    if not cur.fetchone(): return None
    cur.execute("select name from _local_migrations")
    return {r[0] for r in cur.fetchall()}

def migrate():
    done = done_migrations()
    first = done is None
    if first:
        print('Building the database for the first time...')
        cur.execute(STUBS); done = set()
    files = sorted(os.path.basename(x) for x in glob.glob(os.path.join(SQL_DIR, '[0-9][0-9][0-9]_*.sql')))
    new = [f for f in files if f not in done]
    for f in new:
        cur.execute(open(os.path.join(SQL_DIR, f), encoding='utf-8').read().replace('create extension if not exists "pgcrypto";', ''))
        cur.execute('insert into _local_migrations (name) values (%s)', (f,))
    if new: print('Applied %d migration(s): %s .. %s' % (len(new), new[0], new[-1]))
    return first

def as_user(uid, sql, params=None):
    c = psycopg2.connect(uri); k = c.cursor()
    k.execute('set local role authenticated')
    k.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': uid}),))
    k.execute(sql, params); r = k.fetchall() if k.description else None
    c.commit(); c.close(); return r

def fixture(first):
    """The owner, his business, the seed. Kept in _local_fixture so every start finds the same ids."""
    cur.execute("select k, v from _local_fixture"); fx = dict(cur.fetchall())
    if fx.get('owner'): return fx
    owner = str(uuid.uuid4()); other = str(uuid.uuid4())
    cur.execute("insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values (%s,%s,%s,now()), (%s,%s,%s,now())",
                (owner, 'owner@local.test', json.dumps({'full_name': 'Owner'}), other, 'other@local.test', json.dumps({'full_name': 'Other'})))
    biz = as_user(owner, "select create_business('Costareen Live')")[0][0]
    b2 = as_user(other, "select create_business('Elsewhere')")[0][0]
    cur.execute("insert into erp_prefs(user_id, active_business) values (%s,%s) on conflict (user_id) do update set active_business = excluded.active_business", (owner, biz))
    cur.execute("insert into erp_people(user_id, home_business, name, code) values (%s,%s,'Owner','999000') on conflict do nothing", (owner, biz))
    try: cur.execute("insert into platform_admins (user_id, note) values (%s, 'local') on conflict do nothing", (owner,))
    except Exception: pass
    seed_dir = os.environ.get('ERP_SEED_DIR', '')
    if seed_dir and glob.glob(os.path.join(seed_dir, '*.json')):
        # the owner's own machine only: a real sheet export (never kept in this folder - it is confidential)
        print('Loading the sheet export from ' + seed_dir + '...')
        rc = subprocess.call([sys.executable, os.path.join(SQL_DIR, 'import', 'import_sheet.py'), seed_dir, uri, biz])
        if rc: print('The export did not load (code %d); the business is empty.' % rc)
    elif '--no-seed' not in sys.argv:
        print('Writing the demo data (a made-up shop - nothing real)...')
        env = dict(os.environ, DB_URL=uri, FIX=json.dumps({'U': {'owner': owner, 'other': other}, 'B': biz, 'B2': b2}), ERP_NODE_CWD=NODE)
        rc = subprocess.call(['node', os.path.join(HERE, 'demo.mjs')], env=env, cwd=NODE)
        if rc: print('The demo data did not finish (code %d); what was written stays.' % rc)
    for k, v in [('owner', owner), ('other', other), ('biz', biz), ('b2', b2)]:
        cur.execute("insert into _local_fixture (k, v) values (%s, %s)", (k, v))
    return {'owner': owner, 'other': other, 'biz': biz, 'b2': b2}

first = migrate()
fx = fixture(first)
conn.close()

# every feature on (joint stock + a demo joint stock), on every start - see features.mjs; demo data only
if not os.environ.get('ERP_SEED_DIR'):
    subprocess.call(['node', os.path.join(HERE, 'features.mjs')], cwd=NODE,
                    env=dict(os.environ, DB_URL=uri, FIX=json.dumps({'U': {'owner': fx['owner'], 'other': fx['other']}, 'B': fx['biz'], 'B2': fx['b2']}), ERP_NODE_CWD=NODE))

# the page, built for this computer; demo data only, so it opens with no sign-in (the owner key is stamped in;
# on the very first start the key is made by the API below, so the link is needed once)
link_key = open(KEYFILE).read().strip() if os.path.exists(KEYFILE) else ''
subprocess.check_call([sys.executable, os.path.join(ROOT, 'web', 'build.py')],
                      env=dict(os.environ, ERP_API='http://localhost:%d/' % API_PORT, ERP_OUT='index-local.html', ERP_OPEN_KEY=link_key))

# the API (the real function code) and the static web server
env = dict(os.environ, DB_URL=uri, FIX=json.dumps({'U': {'owner': fx['owner'], 'other': fx['other']}, 'B': fx['biz'], 'B2': fx['b2'], 'IMP': fx['biz']}),
           ERP_NODE_CWD=NODE, LINK_ONLY='1', LINK_KEY=link_key, LINK_KEY_FILE=KEYFILE, PORT=str(API_PORT), AUTO_APPROVE='1')
api = subprocess.Popen(['node', os.path.join(TESTS, 'local_server.mjs')], env=env, cwd=NODE)
web = subprocess.Popen([sys.executable, '-m', 'http.server', str(WEB_PORT), '--bind', '127.0.0.1', '--directory', os.path.join(ROOT, 'web')],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print('')
print('  Database  local/data   (kept between starts; start.cmd --fresh rebuilds it with fresh demo data)')
print('  API       http://localhost:%d/' % API_PORT)
print('  Web       http://localhost:%d/index-local.html   (the owner link is printed above as LINK ...)' % WEB_PORT)
print('  Sign-in   the owner link only, as live (owner e-mail sign-in is not simulated here)')
print('  Public    http://localhost:%d/creator.html?api=http://localhost:%d/&...' % (WEB_PORT, API_PORT))
print('')
print('Ctrl+C stops everything. The data stays.')
try:
    while True:
        time.sleep(1)
        if api.poll() is not None:
            print('The API server stopped (code %s).' % api.returncode); break
except KeyboardInterrupt:
    pass
finally:
    for p in (api, web):
        try: p.terminate()
        except Exception: pass
    srv.cleanup()
    print('Stopped.')
