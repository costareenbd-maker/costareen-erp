"""Local test of 001-005 on a throwaway embedded Postgres, Supabase auth stubbed. Touches nothing live.
Setup: py -3.12 -m venv pgenv; pgenv\Scripts\pip install pgserver psycopg2-binary tzdata, then copy tzdata/zoneinfo/* into
pgserver/pginstall/share/postgresql/timezone (the embedded build ships no time zones)."""
import json, uuid, datetime, shutil, tempfile, sys
import pgserver, psycopg2

SQL_DIR = r"G:\costareen-erp\supabase"
tmp = tempfile.mkdtemp(prefix="pgtest_")
srv = pgserver.get_server(tmp, cleanup_mode="stop")
conn = psycopg2.connect(srv.get_uri())
conn.autocommit = True
cur = conn.cursor()

cur.execute("""
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
-- pgcrypto stand-in (not shipped with the embedded build)
create function public.gen_random_bytes(n int) returns bytea language sql volatile as $$
  select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;
""")
for f in ["001_schema.sql", "002_functions.sql", "003_sheets.sql", "004_grants.sql", "005_partnership.sql",
          "006_roles.sql", "007_erp_core.sql", "007_erp_core.sql"]:
    cur.execute(open(f"{SQL_DIR}\\{f}", encoding="utf-8").read().replace('create extension if not exists "pgcrypto";', ''))
# idempotency: 005 twice
cur.execute(open(f"{SQL_DIR}\\005_partnership.sql", encoding="utf-8").read())
print("schema applied (005 applied twice OK)")

U = {n: str(uuid.uuid4()) for n in ["rahman", "partner", "rstaff", "outsider"]}
for n, i in U.items():
    cur.execute("insert into auth.users(id,email) values (%s,%s)", (i, n + "@t.test"))

fails = 0
def check(label, ok, extra=""):
    global fails
    print(("PASS " if ok else "FAIL ") + label + (f"  [{extra}]" if extra else ""))
    if not ok: fails += 1

def as_user(who, sql, params=None, fetch=True):
    c = psycopg2.connect(srv.get_uri()); c.autocommit = False
    k = c.cursor()
    try:
        k.execute("set local role authenticated")
        k.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": U[who]}),))
        k.execute(sql, params)
        rows = k.fetchall() if fetch and k.description else None
        c.commit()
        return rows
    finally:
        c.close()

def expect_error(label, who, sql, params=None, contains=""):
    try:
        as_user(who, sql, params)
        check(label, False, "no error raised")
    except psycopg2.Error as e:
        msg = (e.pgerror or str(e)).strip().splitlines()[0]
        check(label, contains.lower() in msg.lower(), msg)

A = as_user("rahman", "select create_business('Costareen')")[0][0]
B = as_user("partner", "select create_business('Partner Shop')")[0][0]
C = as_user("outsider", "select create_business('Outsider')")[0][0]
cur.execute("insert into memberships values (%s,%s,'staff')", (A, U["rstaff"]))

POOL = as_user("rahman", "select create_pool('ProtoReen JV', %s, 'Costareen', 'wholesale')", (A,))[0][0]
code = as_user("rahman", "select create_pool_invite(%s)", (POOL,))[0][0]
expect_error("outsider cannot join with another's business", "outsider",
             "select join_pool(%s, %s)", (code, A), "owner")
as_user("partner", "select join_pool(%s, %s, 'Partner', 'retail')", (code, B))
expect_error("invite code is single-use", "outsider", "select join_pool(%s, %s)", (code, C), "invalid")

# private stock in each shop
as_user("rahman", "insert into products(business_id,sku,name,cost_price,sell_price) values (%s,'A1','Rahman Lamp',500,900)", (A,), fetch=False)
pa = as_user("rahman", "select id from products where business_id=%s", (A,))[0][0]
as_user("rahman", "select receive_stock(%s, %s::jsonb)", (A, json.dumps([{"product_id": str(pa), "qty": 7, "unit_cost": 500}])))

# pool product: cost 100, wholesale 125, retail 150
as_user("rahman", "insert into products(business_id,sku,name,cost_price,sell_price,wholesale_price) values (%s,'X1','Owala Lamp',100,150,125)", (POOL,), fetch=False)
px = as_user("rahman", "select id from products where business_id=%s", (POOL,))[0][0]

last_month = (datetime.date.today().replace(day=1) - datetime.timedelta(days=1)).replace(day=15)
as_user("rahman", "insert into pool_ledger(pool_id,kind,partner_business_id,amount,entry_date) values (%s,'CAPITAL_IN',%s,60000,%s)", (POOL, A, last_month), fetch=False)
as_user("partner", "insert into pool_ledger(pool_id,kind,partner_business_id,amount,entry_date) values (%s,'CAPITAL_IN',%s,40000,%s)", (POOL, B, last_month), fetch=False)

as_user("rahman", "select pool_receive_stock(%s, %s::jsonb)", (POOL, json.dumps([{"product_id": str(px), "qty": 600, "unit_cost": 100}])))
as_user("partner", "select pool_receive_stock(%s, %s::jsonb)", (POOL, json.dumps([{"product_id": str(px), "qty": 400, "unit_cost": 100}])))

items = lambda q: json.dumps([{"product_id": str(px), "qty": q}])
ra = as_user("rahman", "select (create_invoice(%s,'Wholesale Buyer','01711000000','Dhaka','Phone',%s::jsonb)).grand_total", (POOL, items(160)))[0][0]
pa_ = as_user("partner", "select (create_invoice(%s,'Retail Buyer','01811000000','Dhaka','Walk-in',%s::jsonb)).grand_total", (POOL, items(200)))[0][0]
check("Rahman sells at wholesale price (160 x 125 = 20000)", float(ra) == 20000, ra)
check("Partner sells at retail price (200 x 150 = 30000)", float(pa_) == 30000, pa_)
sb = as_user("rahman", "select sold_by, count(*) from invoices where business_id=%s group by sold_by order by 2", (POOL,))
check("sold_by stamped automatically", {str(r[0]) for r in sb} == {A, B}, sb)

rep = as_user("rahman", "select pool_settlement(%s)", (POOL,))[0][0]
P = {p["name"]: p for p in rep["partners"]}
print(json.dumps({k: rep[k] for k in ["this_month", "to_date", "transfers", "balance_check", "ratio_basis"]}, indent=1))
check("ratio 60/40 from capital", abs(P["Costareen"]["ratio"] - 0.6) < 1e-9 and abs(P["Partner"]["ratio"] - 0.4) < 1e-9)
check("profit 14000 this month", float(rep["this_month"]["profit"]) == 14000)
check("profit shares 8400 / 5600", P["Costareen"]["profit_share"] == 8400 and P["Partner"]["profit_share"] == 5600)
check("stock at cost 64000", float(rep["to_date"]["stock_at_cost"]) == 64000)
check("Costareen receives 10000", P["Costareen"]["balance"] == -10000 and P["Partner"]["balance"] == 10000)
check("balances sum to zero", float(rep["balance_check"]) == 0)
check("transfer Partner -> Costareen 10000",
      rep["transfers"] == [{"from": B, "to": A, "amount": 10000}], rep["transfers"])

# paying the settlement zeroes it
as_user("partner", "insert into pool_ledger(pool_id,kind,partner_business_id,to_business_id,amount) values (%s,'TRANSFER',%s,%s,10000)", (POOL, B, A), fetch=False)
rep2 = as_user("partner", "select pool_settlement(%s)", (POOL,))[0][0]
check("after transfer, nobody owes", all(p["balance"] == 0 for p in rep2["partners"]) and rep2["transfers"] == [])

# ---- isolation ----
check("partner cannot read Rahman's private products",
      as_user("partner", "select count(*) from products where business_id=%s", (A,))[0][0] == 0)
ps = as_user("partner", "select * from partner_stock(%s)", (A,))
check("partner sees Rahman's stock COUNT via partner_stock", ps and float(ps[0][6]) == 7, ps)
cols = as_user("partner", "select column_name from information_schema.columns where false")  # noqa
check("partner_stock exposes no cost/price columns",
      not any(x in str(ps) for x in ["500", "900"]))
expect_error("outsider cannot see Rahman's stock", "outsider", "select * from partner_stock(%s)", (A,), "does not share")
as_user("partner", "select set_share_stock(%s, false)", (B,))
expect_error("stock sharing can be switched off", "rahman", "select * from partner_stock(%s)", (B,), "does not share")
check("staff of Costareen sees no pool money",
      as_user("rstaff", "select count(*) from pool_ledger")[0][0] == 0)
expect_error("staff cannot open settlement", "rstaff", "select pool_settlement(%s)", (POOL,), "manager")
expect_error("outsider cannot write pool ledger", "outsider",
             "insert into pool_ledger(pool_id,kind,partner_business_id,amount) values (%s,'EXPENSE',%s,1)", (POOL, A), "")
expect_error("partner's staff cannot write pool ledger (RLS)", "rstaff",
             "insert into pool_ledger(pool_id,kind,partner_business_id,amount) values (%s,'EXPENSE',%s,1)", (POOL, A), "row-level security")
expect_error("outsider cannot sell from pool", "outsider",
             "select create_invoice(%s,'x','01700000000','x','x',%s::jsonb)", (POOL, items(1)), "access")
check("outsider sees no pool rows",
      as_user("outsider", "select (select count(*) from invoices where business_id=%s) + (select count(*) from products where business_id=%s)", (POOL, POOL))[0][0] == 0)
expect_error("staff cannot sell from pool (not a pool member)", "rstaff",
             "select create_invoice(%s,'x','01700000000','x','x',%s::jsonb)", (POOL, items(1)), "access")

# ---- partner deals ----
d = as_user("rahman", "select (record_partner_deal(%s,%s,'2 x Partner lamp',1800,2)).id", (B, A))[0][0]
expect_error("recorder cannot confirm own deal", "rahman", "select confirm_partner_deal(%s)", (d,), "other company")
as_user("partner", "select confirm_partner_deal(%s)", (d,))
rep3 = as_user("rahman", "select pool_settlement(%s)", (POOL,))[0][0]
check("open deal shows on report", len(rep3["partner_deals_open"]) == 1 and rep3["partner_deals_open"][0]["confirmed"])
expect_error("only the owed side marks paid", "rahman", "select settle_partner_deal(%s)", (d,), "owed")
as_user("partner", "select settle_partner_deal(%s)", (d,))
expect_error("deal needs linked partners", "rahman", "select record_partner_deal(%s,%s,'x',1)", (C, A), "not partners")

# ---- month closing ----
expect_error("cannot close current month", "rahman", "select close_pool_month(%s, current_date)", (POOL,), "after it has ended")
as_user("rahman", "select close_pool_month(%s, %s)", (POOL, last_month))
expect_error("ledger locked for closed month", "partner",
             "insert into pool_ledger(pool_id,kind,partner_business_id,amount,entry_date) values (%s,'EXPENSE',%s,50,%s)", (POOL, B, last_month), "settled")
expect_error("closed capital entry cannot be edited", "rahman",
             "update pool_ledger set amount=1 where pool_id=%s and kind='CAPITAL_IN'", (POOL,), "settled")
expect_error("cannot close same month twice", "partner", "select close_pool_month(%s, %s)", (POOL, last_month), "already closed")
expect_error("staff cannot close a month", "rstaff", "select close_pool_month(%s, %s)", (POOL, last_month), "owner")

# ---- ratio follows investment: partner tops up mid-month -> counts next month only ----
as_user("partner", "insert into pool_ledger(pool_id,kind,partner_business_id,amount) values (%s,'CAPITAL_IN',%s,20000)", (POOL, B), fetch=False)
rep4 = as_user("rahman", "select pool_settlement(%s)", (POOL,))[0][0]
P4 = {p["name"]: p for p in rep4["partners"]}
check("mid-month capital does not change this month's ratio", abs(P4["Partner"]["ratio"] - 0.4) < 1e-9)
check("top-up suggestion shown", P4["Partner"]["top_up_to_equal"] == 0 and P4["Costareen"]["top_up_to_equal"] == 0,
      (P4["Costareen"]["capital"], P4["Partner"]["capital"]))
check("balances still sum to zero", float(rep4["balance_check"]) == 0)

# ---- normal (non-pool) business unaffected ----
inv = as_user("rahman", "select (create_invoice(%s,'Walkin','01911000000','x','Walk-in',%s::jsonb)).grand_total", (A, json.dumps([{"product_id": str(pa), "qty": 1}])))[0][0]
check("own shop still sells at its own price, no sold_by", float(inv) == 900 and
      as_user("rahman", "select sold_by from invoices where business_id=%s", (A,))[0][0] is None)

# ---- 007: roles, secrets, new tables ----
cur.execute("insert into business_secrets(business_id,key,value) values (%s,'sf_key','topsecret')", (A,))
# Re-running an older file's blanket GRANT can give the table back to
# `authenticated`; RLS with no policy must still return nothing.
try:
    seen = as_user("rahman", "select count(*) from business_secrets")[0][0]
except psycopg2.Error:
    seen = 0
check("owner cannot read business secrets", seen == 0)
cur.execute("update memberships set role='shareholder' where business_id=%s and user_id=%s", (A, U["rstaff"]))
check("shareholder counts as manager",
      as_user("rstaff", "select is_manager(%s), is_shareholder(%s), my_rank(%s)", (A, A, A))[0] == (True, True, 3))
cur.execute("update memberships set role='sales' where business_id=%s and user_id=%s", (A, U["rstaff"]))
check("sales is not manager", as_user("rstaff", "select is_manager(%s), my_rank(%s)", (A, A))[0] == (False, 1))
as_user("rstaff", "insert into payments(business_id,payment_no,amount) values (%s,'P1',100)", (A,), fetch=False)
check("member can write payments",
      as_user("rahman", "select count(*) from payments where business_id=%s", (A,))[0][0] == 1)
check("outsider cannot see payments", as_user("outsider", "select count(*) from payments")[0][0] == 0)
n = as_user("rstaff", "with d as (delete from payments where business_id=%s returning id) select count(*) from d", (A,))[0][0]
check("sales cannot delete payments (RLS)", n == 0)

print(f"\n{fails} failure(s)")
conn.close()
srv.cleanup()
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(1 if fails else 0)
