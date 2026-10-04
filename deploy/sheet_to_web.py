"""ONE-TIME move from the Google-Sheet ERP to the web ERP (go-live, October 2026).

Makes a web-ERP backup file from the sheet, keeping everything set up in the web ERP, so the
web ERP's own Restore (Settings > Security > Backups > Go back) can bring it in: one
transaction, a "before restore" copy made first, users/keys/secrets never touched.

  1. a throwaway local Postgres with every migration; the sheet export imported into it
     (supabase/import/import_sheet.py - the same importer as the trial copy);
  2. the live business read through the Management API (read only);
  3. merged: the sheet's books (invoices, payments, stock, courier payouts, web orders,
     expenses, campaigns, price book, invoice number) replace the trial copy's;
     products are matched by SKU and customers by key - the web ERP's own ids, photos,
     colour families, serial settings and wholesale prices are kept, the sheet's names,
     prices, costs, stock settings win; the web ERP's settings, connections, money
     accounts, website catalogue, quotation look ... stay as they are;
  4. checked: every line points at a product, every invoice at a customer, stock per SKU
     equals the sheet's STOCK_VIEW (the importer's own check);
  5. written as "<business> - backup <date time>.json"; --upload puts it in the business's
     backups, ready for Restore. Nothing is changed live without --upload, and even then
     only the file is added - the Restore itself is a separate, deliberate step.

    <pgenv python> sheet_to_web.py <export_dir> <business_id> [--upload]
"""
import json, os, sys, glob, tempfile, shutil, subprocess, urllib.request, decimal, datetime, uuid, re
import pgserver, psycopg2, psycopg2.extras

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = 'oqzcuuytytqadqjlwdsh'
FROM_SHEET = ['invoices', 'invoice_lines', 'payments', 'stock_movements', 'returns', 'invoice_fixes', 'due_reminders',
              'courier_log', 'courier_payouts', 'courier_payout_lines', 'courier_recon', 'cost_book',
              'expenses', 'expense_items', 'campaign_sends', 'campaigns', 'campaign_leads',
              'web_order_lines', 'web_orders', 'invoice_counters', 'capital_book', 'capital_holders', 'capital_closed']
P_SHEET = ['sku', 'name', 'category', 'brand', 'type', 'color', 'unit', 'supplier', 'cost_price', 'sell_price', 'reorder_level',
           'lead_time_days', 'location_bin', 'status', 'date_added', 'notes', 'image_link', 'supplier_sku', 'barcode']
C_SHEET = ['customer_no', 'name', 'phone', 'email', 'address', 'type', 'total_orders', 'total_spent', 'created_at', 'note',
           'last_order_at', 'last_product', 'source', 'status', 'customer_key']
KEEP_AS_IS = {'businesses', 'memberships', 'business_secrets', 'erp_access_keys', 'erp_ai_keys', 'erp_prefs', 'erp_people', 'erp_devices',
              'erp_backup_log', 'drive_queue', 'sync_queue', 'erp_activity', 'erp_errors', 'erp_speed', 'erp_dash_cache', 'erp_alert_sent', 'platform_admins'}


def tok():
    t = os.environ.get('SUPABASE_ACCESS_TOKEN', '').strip()
    if not t: sys.exit('source secrets.env first (SUPABASE_ACCESS_TOKEN)')
    return t


def api_sql(q):
    req = urllib.request.Request('https://api.supabase.com/v1/projects/%s/database/query' % REF, method='POST',
                                 headers={'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json', 'User-Agent': 'costareen-deploy'},
                                 data=json.dumps({'query': q}).encode())
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        raise SystemExit('live SQL failed (%s): %s' % (e.code, e.read().decode()[:800]))


def plain(v):
    if isinstance(v, decimal.Decimal): return float(v)
    if isinstance(v, (datetime.datetime, datetime.date)): return v.isoformat()
    if isinstance(v, uuid.UUID): return str(v)
    return v


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2: sys.exit(__doc__)
    src, biz = args[0], args[1]
    live_biz = api_sql("select id, name from businesses where id = '%s'" % biz)
    if not live_biz: sys.exit('No live business ' + biz)
    name = live_biz[0]['name']
    print('business:', name)

    # ---- 1. the sheet, through the importer, into a throwaway database
    tmp = tempfile.mkdtemp(prefix='pgmove_')
    srv = pgserver.get_server(tmp, cleanup_mode='stop')
    try:
        con = psycopg2.connect(srv.get_uri()); con.autocommit = True
        cur = con.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""create role anon nologin; create role authenticated nologin; create schema auth;
          create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
          create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
          create function public.gen_random_bytes(n int) returns bytea language sql volatile as $$
            select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;""")
        for f in sorted(glob.glob(os.path.join(ROOT, 'supabase', '[0-9][0-9][0-9]_*.sql'))):
            cur.execute(open(f, encoding='utf-8').read().replace('create extension if not exists "pgcrypto";', ''))
        cur.execute("insert into businesses (id, name) values (%s, %s)", (biz, name))
        rc = subprocess.call([sys.executable, os.path.join(ROOT, 'supabase', 'import', 'import_sheet.py'), src, srv.get_uri(), biz])
        if rc: sys.exit('the import of the sheet failed - nothing was made')
        sheet = {}
        for t in FROM_SHEET + ['products', 'customers', 'lookups', 'business_config']:
            cur.execute("select to_regclass(%s) as r", ('public.' + t,))
            if not cur.fetchone()['r']: continue
            cur.execute('select * from public.%s where business_id = %%s' % t, (biz,))
            sheet[t] = [{k: plain(v) for k, v in r.items()} for r in cur.fetchall()]
        cur.execute("""select p.sku, coalesce(ps.stock, 0)::float s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = %s""", (biz,))
        sheet_stock = {r['sku'].lower(): r['s'] for r in cur.fetchall()}
        con.close()
    finally:
        srv.cleanup(); shutil.rmtree(tmp, ignore_errors=True)
    print('sheet: %d invoices, %d lines, %d payments, %d stock moves, %d products, %d customers' % (
        len(sheet['invoices']), len(sheet['invoice_lines']), len(sheet['payments']), len(sheet['stock_movements']), len(sheet['products']), len(sheet['customers'])))

    # ---- 2. the live business, read only
    tabs = [r['t'] for r in api_sql("""select c.table_name t from information_schema.columns c join information_schema.tables x
        on x.table_schema = c.table_schema and x.table_name = c.table_name
        where c.table_schema = 'public' and c.column_name = 'business_id' and x.table_type = 'BASE TABLE' order by 1""")]
    live = {}
    for t in tabs:
        if t == 'business_secrets': continue
        r = api_sql("select coalesce(json_agg(x), '[]'::json) j from public.%s x where business_id = '%s'" % (t, biz))
        live[t] = r[0]['j'] if r else []
    live['businesses'] = api_sql("select coalesce(json_agg(x), '[]'::json) j from businesses x where id = '%s'" % biz)[0]['j']
    print('live: %d tables, %d invoices, %d products, %d customers' % (len(live), len(live.get('invoices', [])), len(live.get('products', [])), len(live.get('customers', []))))

    # ---- 3. merge
    out = {t: rows for t, rows in live.items()}
    # products by SKU: the web ERP's id and its own fields stay, the sheet's fields win
    lp = {str(p['sku']).lower(): p for p in live.get('products', [])}
    pmap, prods, seq = {}, [], max([p.get('seq') or 0 for p in live.get('products', [])] + [0])
    for p in sheet['products']:
        k = str(p['sku']).lower(); old = lp.pop(k, None)
        if old:
            row = dict(old); row.update({c: p.get(c) for c in P_SHEET}); pmap[p['id']] = old['id']
        else:
            row = dict(p); seq += 1
            if 'seq' in row: row['seq'] = seq
            pmap[p['id']] = p['id']
        prods.append(row)
    prods += list(lp.values())                      # products only the web ERP has
    out['products'] = prods
    # customers by key (else phone)
    lc = {}
    for c in live.get('customers', []):
        lc.setdefault('k:' + str(c.get('customer_key') or '').lower(), c)
        if c.get('phone'): lc.setdefault('p:' + re.sub(r'\D', '', str(c['phone']))[-10:], c)
    cmap, custs, used, seqc = {}, [], set(), max([c.get('seq') or 0 for c in live.get('customers', [])] + [0])
    for c in sheet['customers']:
        old = lc.get('k:' + str(c.get('customer_key') or '').lower()) or (lc.get('p:' + re.sub(r'\D', '', str(c.get('phone') or ''))[-10:]) if c.get('phone') else None)
        if old and old['id'] not in used:
            used.add(old['id']); row = dict(old); row.update({k: c.get(k) for k in C_SHEET}); cmap[c['id']] = old['id']
        else:
            row = dict(c); seqc += 1
            if 'seq' in row: row['seq'] = seqc
            cmap[c['id']] = c['id']
        custs.append(row)
    custs += [c for c in live.get('customers', []) if c['id'] not in used]
    out['customers'] = custs
    # the books come from the sheet, pointing at the kept ids
    for t in FROM_SHEET:
        rows = [dict(r) for r in sheet.get(t, [])]
        for r in rows:
            if r.get('product_id') in pmap: r['product_id'] = pmap[r['product_id']]
            if t == 'invoices' and r.get('customer_id') in cmap: r['customer_id'] = cmap[r['customer_id']]
        out[t] = rows
    # lists: the web ERP's, plus anything new in the sheet
    have = {(l['kind'], str(l['value']).lower()) for l in live.get('lookups', [])}
    out['lookups'] = live.get('lookups', []) + [l for l in sheet.get('lookups', []) if (l['kind'], str(l['value']).lower()) not in have]
    # settings: the web ERP's win; a sheet setting the web ERP never had is added
    hk = {c['key'] for c in live.get('business_config', [])}
    out['business_config'] = live.get('business_config', []) + [c for c in sheet.get('business_config', []) if c['key'] not in hk]
    out['erp_dash_cache'] = []                         # the dashboard is worked out again

    # ---- 4. checks
    pid = {p['id'] for p in out['products']}; cid = {c['id'] for c in out['customers']}; iid = {i['id'] for i in out['invoices']}
    bad = [('line', l.get('id')) for l in out['invoice_lines'] if l.get('product_id') and l['product_id'] not in pid]
    bad += [('move', m.get('id')) for m in out['stock_movements'] if m.get('product_id') and m['product_id'] not in pid]
    bad += [('invoice', i.get('invoice_no')) for i in out['invoices'] if i.get('customer_id') and i['customer_id'] not in cid]
    bad += [('web order', w.get('id')) for w in out['web_orders'] if w.get('invoice_id') and w['invoice_id'] not in iid]
    for t in ['serials', 'product_changes', 'web_product_links']:
        bad += [(t, r.get('id')) for r in out.get(t, []) if r.get('product_id') and r['product_id'] not in pid]
    skus = [str(p['sku']).lower() for p in out['products']]
    if len(skus) != len(set(skus)): bad.append(('duplicate SKU', [s for s in set(skus) if skus.count(s) > 1][:5]))
    if bad:
        print('PROBLEMS - no file made:'); [print('  ', b) for b in bad[:30]]; sys.exit(1)
    ctr = (out['invoice_counters'] or [{}])[0]
    print('checked: every line, move, invoice and web order points at something real (stock per SKU: the importer checked it against STOCK_VIEW above); next invoice number %s' % ctr.get('next_number'))
    json.dump(sheet_stock, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sheet_stock.json'), 'w'))   # for the check after the restore

    # ---- 5. the file
    now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=6)))
    fname = '%s - backup %s.json' % (name, now.strftime('%Y-%m-%d %H%M%S'))
    doc = {'business': {'id': biz, 'name': name}, 'made_at': now.isoformat(), 'why': 'from the sheet ERP (go-live)', 'tables': out}
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), fname)
    open(path, 'w', encoding='utf-8').write(json.dumps(doc, ensure_ascii=False, default=plain))
    print('made', path, '(%d KB)' % (os.path.getsize(path) // 1024))
    for t in ['invoices', 'invoice_lines', 'payments', 'stock_movements', 'products', 'customers', 'courier_payouts', 'web_orders', 'expenses']:
        print('  %-18s live now %5d  ->  after %5d' % (t, len(live.get(t, [])), len(out.get(t, []))))
    if '--upload' in sys.argv:
        print('upload: not in this run - the Restore step is done deliberately at the switchover')


if __name__ == '__main__':
    main()
