"""Rehearse a live upgrade on a COPY: a throwaway Postgres on this PC gets live's schema (the migrations live has run)
and live's rows (from deploy/live_snapshot.py), then the new migrations; check-sums before and after must match.
Touches nothing live.

    cd local; ./pgenv/Scripts/python ../deploy/rehearse_upgrade.py [snapshot folder]
"""
import glob, json, os, sys, tempfile, time
import pgserver, psycopg2
from psycopg2 import sql as S

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SQL_DIR = os.path.join(ROOT, 'supabase')
snap = sys.argv[1] if len(sys.argv) > 1 else sorted(glob.glob(os.path.join(ROOT, 'private', 'snapshots', 'live-*')))[-1]
meta = json.load(open(os.path.join(snap, 'SNAPSHOT.json'), encoding='utf-8'))
live_migs = [m for m in meta['migrations'] if m[:3].isdigit()]
by_hand = ['001_schema.sql', '002_functions.sql', '003_sheets.sql', '004_grants.sql']
all_files = sorted(os.path.basename(x) for x in glob.glob(os.path.join(SQL_DIR, '[0-9][0-9][0-9]_*.sql')))
before = [f for f in all_files if f in live_migs or f in by_hand]
new = [f for f in all_files if f not in before]
print('snapshot', os.path.basename(snap), '| schema from', len(before), 'migrations | new:', new)

tmp = tempfile.mkdtemp(prefix='pgrehearse_')
srv = pgserver.get_server(tmp, cleanup_mode='stop')
conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True
cur = conn.cursor()
cur.execute("""
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, last_sign_in_at timestamptz);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), user_agent text, ip text);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, status text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub','')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create function public.gen_random_bytes(n int) returns bytea language sql volatile as $$
  select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
""")

def run_file(f):
    cur.execute(open(os.path.join(SQL_DIR, f), encoding='utf-8').read().replace('create extension if not exists "pgcrypto";', ''))

for f in before:
    run_file(f)
print('schema at the live version built')

# the users the rows point at (auth.users is not in the public snapshot)
tables = {os.path.basename(p)[:-5]: p for p in glob.glob(os.path.join(snap, 'tables', '*.json'))}
uids = set()
for t in ('profiles', 'memberships'):
    if t in tables:
        for r in json.load(open(tables[t], encoding='utf-8')):
            uids.add(r.get('id') if t == 'profiles' else r.get('user_id'))
for u in [x for x in uids if x]:
    cur.execute('insert into auth.users (id, email) values (%s, %s) on conflict do nothing', (u, u[:8] + '@copy.test'))

# load every table's rows (constraints and triggers off while loading, like a restore)
cur.execute("set session_replication_role = replica")
cur.execute("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
here = {r[0] for r in cur.fetchall()}
loaded, skipped = 0, []
for t, path in sorted(tables.items()):
    rows = json.load(open(path, encoding='utf-8'))
    if t == '_erp_migrations' or not rows:
        continue
    if t not in here:
        skipped.append(t); continue
    cur.execute("""select column_name from information_schema.columns where table_schema='public' and table_name=%s
                   and is_generated = 'NEVER' order by ordinal_position""", (t,))
    cols = [c[0] for c in cur.fetchall() if c[0] in rows[0]]
    q = S.SQL('insert into public.{} ({}) overriding system value select {} from json_populate_recordset(null::public.{}, %s)').format(
        S.Identifier(t), S.SQL(',').join(map(S.Identifier, cols)), S.SQL(',').join(map(S.Identifier, cols)), S.Identifier(t))
    cur.execute(S.SQL('delete from public.{}').format(S.Identifier(t)))   # rows a migration seeded
    cur.execute(q, (json.dumps(rows),))
    loaded += len(rows)
cur.execute("set session_replication_role = origin")
cur.execute('create table if not exists public._erp_migrations (name text primary key, at timestamptz default now())')
for m in live_migs:
    cur.execute('insert into _erp_migrations(name) values (%s) on conflict do nothing', (m,))
# identity / serial counters past the loaded rows
cur.execute("""select table_name, column_name from information_schema.columns where table_schema='public' and (is_identity='YES' or column_default like 'nextval%%')""")
for t, c in cur.fetchall():
    cur.execute(S.SQL("select pg_get_serial_sequence({}, {})").format(S.Literal('public.' + t), S.Literal(c)))
    seq = cur.fetchone()[0]
    if seq:
        cur.execute(S.SQL("select setval({}, greatest(1, coalesce((select max({}) from public.{}), 0)))").format(S.Literal(seq), S.Identifier(c), S.Identifier(t)))
print('loaded', loaded, 'rows; tables not in the old schema:', skipped)

CHECKS = {
    'invoices': "select count(*)::int, round(coalesce(sum(grand_total),0)::numeric,2) from invoices",
    'invoice lines': "select count(*)::int, round(coalesce(sum(qty * unit_price),0)::numeric,2) from invoice_items",
    'payments': "select count(*)::int, round(coalesce(sum(amount),0)::numeric,2) from payments",
    'stock': "select count(*)::int, coalesce(sum(stock),0)::numeric from product_stock",
    'stock movements': "select count(*)::int, coalesce(sum(qty),0)::numeric from stock_movements",
    'customers': "select count(*)::int, 0 from customers",
    'products': "select count(*)::int, 0 from products",
    'expenses': "select count(*)::int, round(coalesce(sum(amount),0)::numeric,2) from expenses",
    'returns': "select count(*)::int, 0 from returns",
    'money accounts': "select count(*)::int, 0 from money_accounts",
}
def measure():
    out = {}
    for k, q in CHECKS.items():
        try:
            cur.execute(q); out[k] = [str(x) for x in cur.fetchone()]
        except Exception as e:
            conn.rollback() if not conn.autocommit else None; out[k] = ['ERR ' + str(e).split('\n')[0][:80]]
    return out

import subprocess
LIVE_BIZ = '81e318e7-fbde-4fcc-9b9f-b0061fe29c14'
cur.execute("select user_id from memberships where business_id = %s and role = 'owner' and active order by added_at limit 1", (LIVE_BIZ,))
OWNER = str(cur.fetchone()[0])
cur.execute("insert into erp_prefs (user_id, active_business) values (%s, %s) on conflict (user_id) do update set active_business = excluded.active_business", (OWNER, LIVE_BIZ))
NODE_CWD = os.environ.get('ERP_NODE_CWD', os.path.join(ROOT, 'local', 'node'))
OLD_FN = os.environ.get('OLD_FN', 'G:/costareen-erp-livefix/supabase/functions/erp')
NEW_FN = os.path.join(ROOT, 'supabase', 'functions', 'erp')
def reports(fn, out):
    r = subprocess.run(['node', os.path.join(ROOT, 'deploy', 'compare_reports.mjs'), fn, srv.get_uri(), OWNER, out], cwd=NODE_CWD,
                       env=dict(os.environ, ERP_NODE_CWD=NODE_CWD), capture_output=True, text=True, timeout=600)
    if r.returncode: print('reports failed:', (r.stderr or r.stdout)[-600:])
    return json.load(open(out, encoding='utf-8')) if os.path.exists(out) else {}
VOLATILE = {'at', 'ago', 'now', 'build', 'time', 'generated', 'asOf', 'today', 'updated', 'lastUsed', 'stamp', 'took'}
def leaves(x, p=''):
    if isinstance(x, dict):
        for k, v in x.items():
            if k in VOLATILE: continue
            yield from leaves(v, p + '.' + k)
    elif isinstance(x, list):
        for i, v in enumerate(x[:400]): yield from leaves(v, p + '[%d]' % i)
    elif isinstance(x, (int, float)) and not isinstance(x, bool):
        yield p, round(float(x), 2)
rep_before = reports(OLD_FN, os.path.join(tmp, 'rep_old.json'))
b = measure()
print('\nbefore:', json.dumps(b))
print('live said:', json.dumps(meta.get('checksums'), default=str))
t0 = time.time()
for f in new:
    try:
        run_file(f); print('  applied', f)
    except Exception as e:
        print('  FAILED', f, '->', str(e).split('\n')[0]); raise SystemExit(1)
    cur.execute('insert into _erp_migrations(name) values (%s) on conflict do nothing', (f,))
print('upgrade took %.1fs' % (time.time() - t0))
a = measure()
rep_after = reports(NEW_FN, os.path.join(tmp, 'rep_new.json'))
print('\nSCREENS (live code on live data  vs  new code on the upgraded copy):')
for k in rep_before:
    ob, nb = rep_before.get(k), rep_after.get(k)
    if isinstance(ob, dict) and 'error' in ob and len(ob) == 1: print('  %-26s old code: %s' % (k, ob['error'][:80])); continue
    if isinstance(nb, dict) and 'error' in nb and len(nb) == 1: print('  %-26s NEW CODE ERROR: %s' % (k, nb['error'][:120])); continue
    lo, ln = dict(leaves(ob)), dict(leaves(nb))
    common = [p for p in lo if p in ln]
    bad = [(p, lo[p], ln[p]) for p in common if abs(lo[p] - ln[p]) > 0.01]
    print('  %-26s %4d numbers compared, %d differ%s' % (k, len(common), len(bad), (': ' + '; '.join('%s %s->%s' % x for x in bad[:6])) if bad else ''))
print('after: ', json.dumps(a))
diff = {k: (b[k], a[k]) for k in b if b[k] != a[k]}
print('\nRESULT:', 'every check-sum unchanged' if not diff else 'CHANGED: ' + json.dumps(diff))
# what the new tables hold after the upgrade (data the migrations created from existing rows)
cur.execute("""select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1""")
for (t,) in cur.fetchall():
    if t in here: continue
    cur.execute(S.SQL('select count(*) from public.{}').format(S.Identifier(t)))
    n = cur.fetchone()[0]
    if n: print('  new table', t, n, 'rows')
if os.environ.get('AFTER_JS'):
    outp = os.path.join(tmp, 'after.json')
    r = subprocess.run(['node', os.environ['AFTER_JS'], NEW_FN, srv.get_uri(), OWNER, outp], cwd=NODE_CWD, env=dict(os.environ, ERP_NODE_CWD=NODE_CWD), capture_output=True, text=True, timeout=600)
    print('AFTER_JS:', (r.stderr or '')[-800:]); print(open(outp, encoding='utf-8').read() if os.path.exists(outp) else 'no output')
print('copy kept at', srv.get_uri())
if os.environ.get('KEEP'):
    input('copy running - press Enter to stop')
