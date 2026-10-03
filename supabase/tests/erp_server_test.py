"""Local test of the `erp` Edge Function core against a throwaway Postgres.

Builds the schema (001-007) with Supabase auth stubbed, seeds a small
business, then runs erp_server_test.mjs in Node with the connection string.
Touches nothing live. Same setup as test_partnership.py (pgserver + tzdata).
Usage: python erp_server_test.py
  env ERP_NODE_CWD = a folder whose node_modules has postgres@3.4.5
  env TEST_SCRIPT  = which .mjs in this folder to run (default erp_server_test.mjs)
  env MODE=serve   = run local_server.mjs on :8794 instead of tests
"""
import os, sys, json, uuid, shutil, tempfile, subprocess
import pgserver, psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
SQL_DIR = os.path.dirname(HERE)
tmp = tempfile.mkdtemp(prefix="pgtest_")
srv = pgserver.get_server(tmp, cleanup_mode="stop")
conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True
cur = conn.cursor()
cur.execute("""
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
alter table auth.users add column last_sign_in_at timestamptz;
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
import glob
# every migration, in number order (each file is its own transaction, which 006 needs)
for f in sorted(os.path.basename(x) for x in glob.glob(os.path.join(SQL_DIR, "[0-9][0-9][0-9]_*.sql"))):
    cur.execute(open(os.path.join(SQL_DIR, f), encoding="utf-8").read()
                .replace('create extension if not exists "pgcrypto";', ''))

# --- fixture --------------------------------------------------------------
U = {n: str(uuid.uuid4()) for n in ["owner", "mgr", "sales", "other"]}
for n, i in U.items():
    cur.execute("insert into auth.users(id,email,raw_user_meta_data) values (%s,%s,%s)",
                (i, n + "@t.test", json.dumps({"full_name": n.title()})))

def as_user(uid, sql, params=None):
    c = psycopg2.connect(srv.get_uri()); k = c.cursor()
    k.execute("set local role authenticated")
    k.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": uid}),))
    k.execute(sql, params); r = k.fetchall() if k.description else None
    c.commit(); c.close(); return r

B = as_user(U["owner"], "select create_business('Costareen')")[0][0]
B2 = as_user(U["other"], "select create_business('Elsewhere')")[0][0]
cur.execute("insert into memberships(business_id,user_id,role) values (%s,%s,'manager'),(%s,%s,'sales')",
            (B, U["mgr"], B, U["sales"]))
cur.execute("""insert into erp_people(user_id, home_business, name, code) values
               (%s,%s,'Mehedi','111111'), (%s,%s,'Rina','222222')""", (U["mgr"], B, U["sales"], B))
cur.execute("insert into erp_devices(device_id,user_id,status) values ('dev-mgr',%s,'approved'),('dev-sales',%s,'approved')",
            (U["mgr"], U["sales"]))
for kind, vals in {"categories": ["Filaments", "Printers"], "brands": ["Sunlu", "Bambulab", "sunlu"],
                   "payment_methods": ["bKash", "Cash", "COD"], "units": ["Roll", "Piece"]}.items():
    for v in vals:
        cur.execute("insert into lookups(business_id,kind,value) values (%s,%s,%s) on conflict do nothing", (B, kind, v))
cur.execute("""insert into products(business_id,sku,name,category,brand,type,color,cost_price,sell_price,reorder_level,lead_time_days,supplier)
  values (%s,'FIL-SUN-PLA-BLA-001','Sunlu PLA Black','Filaments','Sunlu','PLA','Black',900,1350,0,0,'Sunlu Direct'),
         (%s,'PRT-BAM-A1-001','Bambu A1','Printers','Bambulab','A1','',40000,52000,2,50,'Local')""", (B, B))
cur.execute("insert into products(business_id,sku,name,sell_price) values (%s,'X-OTHER','Other shop item',10)", (B2,))
pid = {r[0]: r[1] for r in (cur.execute("select sku, id from products where business_id=%s", (B,)) or cur.fetchall())}
cur.execute("insert into stock_movements(business_id,product_id,kind,direction,qty) values (%s,%s,'RECEIVE','IN',20),(%s,%s,'RECEIVE','IN',3)",
            (B, pid['FIL-SUN-PLA-BLA-001'], B, pid['PRT-BAM-A1-001']))
cur.execute("""insert into invoices(business_id,invoice_no,customer_name,created_at) values
   (%s,'INV-1',  'A', now() - interval '10 days'),
   (%s,'INV-2',  'B', now() - interval '200 days')""", (B, B))
inv = {r[0]: r[1] for r in (cur.execute("select invoice_no,id from invoices") or cur.fetchall())}
cur.execute("""insert into invoice_lines(business_id,invoice_id,sku,qty) values
   (%s,%s,'FIL-SUN-PLA-BLA-001',9),(%s,%s,'fil-sun-pla-bla-001',4)""", (B, inv['INV-1'], B, inv['INV-2']))
cur.execute("insert into stock_movements(business_id,product_id,kind,direction,qty) values (%s,%s,'SALE','OUT',13)",
            (B, pid['FIL-SUN-PLA-BLA-001']))
# a return note, as the sheet wrote it: RTN- row with -qty for goods back on the shelf
cur.execute("insert into invoices(business_id,invoice_no,customer_name,created_at,payment_status) values (%s,'RTN-1','A',now()-interval '5 days','Paid') returning id", (B,))
rtn = cur.fetchone()[0]
cur.execute("insert into invoice_lines(business_id,invoice_id,sku,qty) values (%s,%s,'FIL-SUN-PLA-BLA-001',-2)", (B, rtn))
cur.execute("insert into customers(business_id,name,phone,address,total_orders,total_spent) values (%s,'Karim','01712345678','Dhaka',3,4500.4)", (B,))

IMP = None
if os.environ.get("IMPORT_DIR"):
    # import a sheet export into a fresh business owned by the fixture owner,
    # and make it the owner's active business
    IMP = as_user(U["owner"], "select create_business('Costareen Live')")[0][0]
    rc = subprocess.call([sys.executable, os.path.join(SQL_DIR, "import", "import_sheet.py"),
                          os.environ["IMPORT_DIR"], srv.get_uri(), IMP])
    if rc:
        sys.exit(rc)
    cur.execute("insert into erp_prefs(user_id, active_business) values (%s,%s) on conflict (user_id) do update set active_business = excluded.active_business", (U["owner"], IMP))
    if os.environ.get("MODE") == "serve":
        # local trial: the owner signs in with code 999000 (owner email sign-in is not simulated)
        cur.execute("insert into erp_people(user_id, home_business, name, code) values (%s,%s,'Owner','999000') on conflict do nothing", (U["owner"], IMP))
env = dict(os.environ, DB_URL=srv.get_uri(), FIX=json.dumps({"U": U, "B": B, "B2": B2, "IMP": IMP}))
node_modules = os.environ.get("ERP_NODE_MODULES", "")
if node_modules:
    env["NODE_PATH"] = node_modules
script = "local_server.mjs" if os.environ.get("MODE") == "serve" else os.environ.get("TEST_SCRIPT", "erp_server_test.mjs")
code = subprocess.call(["node", os.path.join(HERE, script)], env=env, cwd=os.environ.get("ERP_NODE_CWD", HERE))
conn.close(); srv.cleanup(); shutil.rmtree(tmp, ignore_errors=True)
sys.exit(code)
