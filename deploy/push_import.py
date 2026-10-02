"""Copy the sheet export into the LIVE business through the Supabase API.

The importer (supabase/import/import_sheet.py) needs a direct database
connection. The live project is reached with an account token instead, so:
  1. build a throwaway local Postgres with every migration,
  2. run the importer there into a business with the LIVE business's id,
  3. read that business's rows back and send them to the live project as
     INSERTs through the Management API, ids and write order (seq) kept,
  4. move each identity sequence past the copied rows.
It first deletes the live business's existing ERP data, so it can be re-run
(at cutover) to take a fresh copy. Nothing touches the sheet.

    set SUPABASE_ACCESS_TOKEN=sbp_...
    python push_import.py <export_dir> <live_business_id> [--yes]
"""
import json, os, sys, glob, uuid, tempfile, shutil, subprocess, urllib.request
import pgserver, psycopg2
from psycopg2.extras import Json
from psycopg2.extensions import register_adapter
register_adapter(dict, Json)   # jsonb columns (quote_settings, campaigns.spread ...)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = 'oqzcuuytytqadqjlwdsh'
TABLES = ['lookups', 'business_config', 'invoice_counters', 'cost_book', 'products', 'customers',
          'invoices', 'invoice_lines', 'stock_movements', 'payments', 'invoice_fixes', 'due_reminders',
          'courier_payouts', 'courier_payout_lines', 'expense_items', 'expenses', 'campaigns',
          'campaign_sends', 'campaign_leads', 'quote_settings', 'web_orders', 'web_order_lines',
          'capital_holders', 'capital_book', 'capital_closed']


def api_sql(q):
    tok = os.environ['SUPABASE_ACCESS_TOKEN']
    req = urllib.request.Request('https://api.supabase.com/v1/projects/%s/database/query' % REF, method='POST',
                                 headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json',
                                          'User-Agent': 'costareen-deploy'},
                                 data=json.dumps({'query': q}).encode())
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        raise SystemExit('live SQL failed (%s): %s' % (e.code, e.read().decode()[:1500]))


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    src, biz = sys.argv[1], sys.argv[2]
    live = api_sql("select name from businesses where id = '%s'" % biz)
    if not live:
        sys.exit('No live business ' + biz)
    print('live business:', live[0]['name'])

    tmp = tempfile.mkdtemp(prefix='pgpush_')
    srv = pgserver.get_server(tmp, cleanup_mode='stop')
    con = psycopg2.connect(srv.get_uri()); con.autocommit = True
    cur = con.cursor()
    cur.execute("""create role anon nologin; create role authenticated nologin; create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
      create function public.gen_random_bytes(n int) returns bytea language sql volatile as $$
        select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;""")
    for f in sorted(glob.glob(os.path.join(ROOT, 'supabase', '[0-9][0-9][0-9]_*.sql'))):
        cur.execute(open(f, encoding='utf-8').read().replace('create extension if not exists "pgcrypto";', ''))
    cur.execute("insert into businesses (id, name) values (%s, %s)", (biz, live[0]['name']))
    rc = subprocess.call([sys.executable, os.path.join(ROOT, 'supabase', 'import', 'import_sheet.py'),
                          src, srv.get_uri(), biz])
    if rc:
        sys.exit('local import failed')

    if '--yes' not in sys.argv:
        ans = input('Replace the LIVE business data with this import? Type yes: ')
        if ans.strip().lower() != 'yes':
            sys.exit('Stopped. Nothing sent.')

    # 3. wipe the live business's ERP data (children first), then copy
    wipe = ['capital_closed', 'capital_book', 'capital_holders', 'erp_dash_cache', 'web_order_lines', 'web_orders', 'campaign_sends', 'campaigns', 'campaign_leads', 'quote_settings',
            'expenses', 'expense_items', 'courier_payout_lines', 'courier_payouts', 'due_reminders', 'invoice_fixes',
            'payments', 'stock_movements', 'invoice_lines', 'invoices', 'customers', 'products', 'cost_book',
            'invoice_counters', 'business_config', 'lookups']
    api_sql('begin; ' + ' '.join("delete from public.%s where business_id = '%s';" % (t, biz) for t in wipe) + ' commit;')
    print('live business emptied')

    for t in TABLES:
        cur.execute("select column_name, data_type from information_schema.columns where table_schema='public' "
                    "and table_name=%s and is_generated = 'NEVER' order by ordinal_position", (t,))
        meta = cur.fetchall()
        cols = [r[0] for r in meta]
        jsonix = [i for i, r in enumerate(meta) if r[1] in ('json', 'jsonb')]
        cur.execute('select %s from public.%s where business_id = %%s' % (','.join('"%s"' % c for c in cols), t), (biz,))
        rows = [tuple(Json(v) if i in jsonix and v is not None else v for i, v in enumerate(r))
                for r in cur.fetchall()]
        if not rows:
            print('  %-22s 0' % t); continue
        has_identity = 'seq' in cols
        ov = ' overriding system value' if has_identity else ''
        sent = 0
        for i in range(0, len(rows), 300):
            chunk = rows[i:i + 300]
            vals = ','.join(cur.mogrify('(' + ','.join(['%s'] * len(cols)) + ')', r).decode() for r in chunk)
            api_sql('insert into public.%s (%s)%s values %s' % (t, ','.join('"%s"' % c for c in cols), ov, vals))
            sent += len(chunk)
        print('  %-22s %d' % (t, sent))
        if has_identity:
            api_sql("select setval(pg_get_serial_sequence('public.%s','seq'), greatest((select max(seq) from public.%s), 1))" % (t, t))

    # 4. check: stock per SKU and invoice count, live vs local
    cur.execute("select count(*) from invoices where business_id = %s", (biz,))
    n_local = cur.fetchone()[0]
    n_live = api_sql("select count(*)::int n from invoices where business_id = '%s'" % biz)[0]['n']
    cur.execute("""select coalesce(sum(ps.stock),0)::float from products p left join product_stock ps on ps.product_id = p.id
                   where p.business_id = %s""", (biz,))
    s_local = cur.fetchone()[0]
    s_live = api_sql("""select coalesce(sum(ps.stock),0)::float s from products p left join product_stock ps on ps.product_id = p.id
                        where p.business_id = '%s'""" % biz)[0]['s']
    print('CHECK invoices local %s live %s | total stock local %s live %s' % (n_local, n_live, s_local, s_live))
    con.close(); srv.cleanup(); shutil.rmtree(tmp, ignore_errors=True)
    if n_local != n_live or abs(s_local - s_live) > 0.001:
        sys.exit('MISMATCH - check before using the live copy')
    print('DONE - live copy matches')


if __name__ == '__main__':
    main()
