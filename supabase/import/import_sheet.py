"""Import the sheet ERP's tabs into one business of the web app.

READ-ONLY toward the sheet: it works from a folder of JSON exports
(gog sheets get <id> <TAB> --render UNFORMATTED_VALUE --json --results-only),
never from the live sheet itself.

    python import_sheet.py <export_dir> <db_url> <business_id> [--replace] [--dry-run]

--replace  delete this business's existing ERP data first (products, sales,
           stock, customers, payments ...) so the import can be re-run.
Everything runs in one transaction: it all goes in, or nothing does.
Prints a report of what was imported and what was skipped and why, then
checks stock: the ledger total per SKU must equal the sheet's STOCK_VIEW.
"""
import json, os, sys, re
from datetime import datetime, timedelta, timezone
import psycopg2, psycopg2.extras

DHAKA = timezone(timedelta(hours=6))

def load(d, tab):
    p = os.path.join(d, tab + '.json')
    if not os.path.exists(p):
        return [], []
    v = json.load(open(p, encoding='utf-8'))
    v = v.get('values', v) if isinstance(v, dict) else v
    if not v:
        return [], []
    head = [str(h).strip() for h in v[0]]
    rows = [r + [''] * (len(head) - len(r)) for r in v[1:]]
    return head, rows

def s(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()

def n(v):
    try:
        x = float(v)
        return x if x == x else 0.0
    except (TypeError, ValueError):
        return 0.0

def when(v):
    """A sheet date (serial days in Dhaka time) or date text -> aware datetime, or None."""
    if v in ('', None):
        return None
    try:
        x = float(v)
        if 20000 < x < 80000:
            return datetime(1899, 12, 30, tzinfo=DHAKA) + timedelta(days=x)
    except (TypeError, ValueError):
        pass
    t = s(v)
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M', '%Y-%m-%d'):
        try:
            return datetime.strptime(t, fmt).replace(tzinfo=DHAKA)
        except ValueError:
            pass
    return None

def month(v):
    """EXPENSES months were typed as yyyy-MM and Sheets turned them into dates."""
    d = when(v)
    if d:
        return d.strftime('%Y-%m')
    t = s(v)
    return t if re.match(r'^\d{4}-\d{2}$', t) else ''

def key(phone, name):
    d = re.sub(r'\D', '', s(phone))
    return d[-10:] if len(d) >= 10 else 'n:' + s(name).lower()

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 3:
        sys.exit(__doc__)
    src, url, biz = args
    replace, dry = '--replace' in sys.argv, '--dry-run' in sys.argv
    con = psycopg2.connect(url)
    cur = con.cursor()
    rep, skip = {}, []

    def ins(table, cols, rows):
        if not rows:
            rep[table] = rep.get(table, 0)
            return []
        q = 'insert into %s (%s) values %%s returning id' % (table, ','.join(cols))
        out = psycopg2.extras.execute_values(cur, q, rows, page_size=500, fetch=True)
        rep[table] = rep.get(table, 0) + len(rows)
        return [r[0] for r in out]

    cur.execute('select name from businesses where id = %s', (biz,))
    if not cur.fetchone():
        sys.exit('No business ' + biz)

    if replace:
        for t in ['stock_movements', 'invoice_lines', 'payments', 'returns', 'invoice_fixes', 'due_reminders',
                  'courier_log', 'courier_payouts', 'courier_payout_lines', 'courier_recon', 'cost_book',
                  'capital_book', 'capital_holders', 'capital_closed',
                  'expenses', 'expense_items', 'campaign_sends', 'campaigns', 'campaign_leads',
                  'web_order_lines', 'web_orders', 'quote_settings', 'business_config']:
            cur.execute('delete from %s where business_id = %%s' % t, (biz,))
        cur.execute('delete from invoices where business_id = %s', (biz,))
        cur.execute('delete from customers where business_id = %s', (biz,))
        cur.execute('delete from products where business_id = %s', (biz,))
        cur.execute("delete from lookups where business_id = %s", (biz,))

    # ---- SETTINGS: lists A-G, config I:J ---------------------------------
    h, rows = load(src, 'SETTINGS')
    kinds = ['categories', 'brands', 'types', 'suppliers', 'units', 'colors', 'payment_methods']
    lk = []
    for i, r in enumerate(rows):
        for c, k in enumerate(kinds):
            v = s(r[c]) if c < len(r) else ''
            if v:
                lk.append((biz, k, v, i))
    if lk:
        psycopg2.extras.execute_values(cur, 'insert into lookups (business_id, kind, value, sort_order) values %s on conflict do nothing', lk)
        rep['lookups'] = len(lk)
    SECRET = {'website_sync_key', 'n8n_webhook_url'}
    cfg = []
    for r in rows:
        k, v = s(r[8]) if len(r) > 8 else '', s(r[9]) if len(r) > 9 else ''
        if not k:
            continue
        if k in SECRET:
            skip.append('config %s: a credential - enter it again in Settings' % k)
            continue
        if k == 'next_invoice_num':
            cur.execute("""insert into invoice_counters (business_id, next_number, prefix) values (%s, %s, 'INV')
                           on conflict (business_id) do update set next_number = excluded.next_number""", (biz, int(n(v)) or 1001))
        cfg.append((biz, k, v))
    # ---- COST_PRICES -> cost_book (+ O2:O4 -> config) -------------------
    h, rows = load(src, 'COST_PRICES')
    book = []
    for i, r in enumerate(rows):
        if len(r) > 14 and s(r[13]):
            lab = s(r[13]).lower()
            if 'rate' in lab: cfg.append((biz, 'cost_rate', s(r[14])))
            elif 'handling' in lab: cfg.append((biz, 'cost_handling', s(r[14])))
            elif 'margin' in lab: cfg.append((biz, 'cost_min_margin', s(r[14])))
        if not s(r[0]) and not s(r[2]):
            continue
        book.append((biz, i, s(r[0]), s(r[1]), s(r[2]),
                     n(r[3]) if s(r[3]) else None, n(r[4]) if s(r[4]) else None, n(r[5]) if s(r[5]) else None,
                     int(n(r[7])), n(r[8]), when(r[10]), s(r[11]) or None))
    ins('cost_book', ['business_id', 'sort_order', 'category', 'brand', 'type', 'buy_rmb', 'buy_bdt', 'handling',
                      'products', 'typical_sell', 'updated_at', 'note'], book)
    if cfg:
        psycopg2.extras.execute_values(cur, """insert into business_config (business_id, key, value) values %s
            on conflict (business_id, key) do update set value = excluded.value""", list({(a, b): (a, b, c) for a, b, c in cfg}.values()))
        rep['business_config'] = len(cfg)

    # ---- PRODUCT_MASTER ------------------------------------------------
    h, rows = load(src, 'PRODUCT_MASTER')
    prods, seen = [], set()
    for r in rows:
        sku = s(r[0])
        if not sku:
            continue
        if sku.lower() in seen:
            skip.append('product %s: listed twice in PRODUCT_MASTER (kept the first)' % sku)
            continue
        seen.add(sku.lower())
        prods.append((biz, sku, s(r[1]) or sku, s(r[2]), s(r[3]), s(r[4]), s(r[5]), s(r[6]) or 'Piece', s(r[7]),
                      n(r[8]), n(r[9]), n(r[11]), int(n(r[12])), s(r[13]), s(r[14]) or 'Active',
                      when(r[15]) or datetime.now(DHAKA), s(r[16]) or None,
                      s(r[17]) if len(r) > 17 else None, s(r[18]) if len(r) > 18 else None, s(r[19]) if len(r) > 19 else None))
    pids = ins('products', ['business_id', 'sku', 'name', 'category', 'brand', 'type', 'color', 'unit', 'supplier',
                            'cost_price', 'sell_price', 'reorder_level', 'lead_time_days', 'location_bin', 'status',
                            'date_added', 'notes', 'image_link', 'supplier_sku', 'barcode'], prods)
    pid = {p[1].lower(): i for p, i in zip(prods, pids)}

    # ---- CUSTOMERS -----------------------------------------------------
    h, rows = load(src, 'CUSTOMERS')
    cus = []
    for r in rows:
        if not s(r[0]) and not s(r[1]):
            continue
        cus.append((biz, s(r[0]), s(r[1]), s(r[2]), s(r[3]), s(r[4]), s(r[5]) or 'Retail', int(n(r[6])), n(r[7]),
                    when(r[8]) or datetime.now(DHAKA), s(r[9]), when(r[10]), s(r[11]), s(r[12]), s(r[13]),
                    key(r[2], r[1])))
    cids = ins('customers', ['business_id', 'customer_no', 'name', 'phone', 'email', 'address', 'type', 'total_orders',
                             'total_spent', 'created_at', 'note', 'last_order_at', 'last_product', 'source', 'status',
                             'customer_key'], cus)
    by_key = {}
    for c, i in zip(cus, cids):
        by_key.setdefault(c[-1], i)

    # ---- SALES_LOG -> invoices + lines (row order kept) ------------------
    h, rows = load(src, 'SALES_LOG')
    order, inv, noid = [], {}, []
    for r in rows:
        oid = s(r[0])
        if not oid:
            if any(s(x) for x in r):
                noid.append(r)
            continue
        if oid not in inv:
            inv[oid] = {'rows': []}
            order.append(oid)
        inv[oid]['rows'].append(r)
    if noid:
        nr = noid
        skip.append('SALES_LOG: %d row(s) with no order id (%d units) - the sheet ERP ignores these too '
                    '(dues, sales list, sold counts); their stock moves are in TXN_LOG and were imported'
                    % (len(nr), int(sum(n(x[7]) for x in nr))))
    invrows = []
    for oid in order:
        rs = inv[oid]['rows']; f = rs[0]
        sub = sum(n(x[7]) * n(x[8]) for x in rs if n(x[7]) > 0)
        k = key(f[3], f[2])
        invrows.append((biz, oid, by_key.get(k) if not k.startswith('n:') else None, s(f[2]), s(f[3]), s(f[4]),
                        s(f[19]) or 'Walk-in', sub, max(n(x[14]) for x in rs), max(n(x[15]) for x in rs),
                        max(n(x[16]) for x in rs), max(n(x[17]) for x in rs), max(n(x[18]) for x in rs),
                        s(f[10]), s(f[11]) or 'Pending', s(f[12]) or 'Processing', s(f[13]),
                        when(f[1]) or datetime.now(DHAKA), k,
                        (re.match(r'^(WEB-\S+)', s(f[13])) or [None, None])[1]))
    iids = ins('invoices', ['business_id', 'invoice_no', 'customer_id', 'customer_name', 'customer_phone',
                            'customer_address', 'source', 'subtotal', 'discount', 'delivery_charge', 'grand_total',
                            'advance_paid', 'due_amount', 'payment_method', 'payment_status', 'delivery_status',
                            'note', 'created_at', 'customer_key', 'web_order_no'], invrows)
    iid = dict(zip(order, iids))
    lines = []
    for oid in order:
        for ln, r in enumerate(inv[oid]['rows'], 1):
            q, u, t = n(r[7]), n(r[8]), n(r[9])
            sku = s(r[5])
            lines.append((biz, iid[oid], pid.get(sku.lower()), sku, s(r[6]), q, u,
                          max(0.0, round(q * u - t, 2)) if q > 0 and t > 0 else 0.0, t, ln))
    ins('invoice_lines', ['business_id', 'invoice_id', 'product_id', 'sku', 'name', 'qty', 'unit_price', 'discount',
                          'line_total', 'line_no'], lines)
    # web_order_no is the part after WEB-
    cur.execute("update invoices set web_order_no = substr(web_order_no, 5) where business_id = %s and web_order_no like 'WEB-%%'", (biz,))

    # ---- TXN_LOG -> stock_movements -------------------------------------
    h, rows = load(src, 'TXN_LOG')
    KINDS = {'RECEIVE', 'SALE', 'RETURN', 'DAMAGE', 'ADJUSTMENT', 'OPENING', 'ADJUST', 'VOID'}
    mv, unknown = [], {}
    for r in rows:
        sku = s(r[2])
        if not sku:
            continue
        p = pid.get(sku.lower())
        if not p:
            unknown[sku] = unknown.get(sku, 0) + 1
            continue
        q = n(r[6]); d = s(r[5]).upper()
        kind = s(r[4]).upper()
        if kind not in KINDS:
            skip.append('TXN %s: unknown type %s - stored as ADJUSTMENT' % (s(r[0]), kind)); kind = 'ADJUSTMENT'
        if q < 0:
            q, d = -q, ('OUT' if d == 'IN' else 'IN')
        if q == 0:
            skip.append('TXN %s: quantity 0, nothing moved' % s(r[0])); continue
        if d not in ('IN', 'OUT'):
            skip.append('TXN %s: direction "%s" - skipped' % (s(r[0]), d)); continue
        ref = s(r[9])
        m = re.match(r'^Invoice:\s*(\S+)', ref)
        mv.append((biz, p, kind, d, q, n(r[7]), n(r[8]), ref, s(r[10]), s(r[12]) or None,
                   iid.get(m.group(1)) if m else None, when(r[1]) or datetime.now(DHAKA), s(r[0]), s(r[11]), s(r[3])))
    ins('stock_movements', ['business_id', 'product_id', 'kind', 'direction', 'qty', 'unit_price', 'total', 'reference',
                            'supplier', 'note', 'invoice_id', 'created_at', 'txn_no', 'operator', 'product_name'], mv)
    for sku, c in unknown.items():
        skip.append('TXN_LOG: %d movement(s) for %s, which is not in PRODUCT_MASTER' % (c, sku))

    # ---- PAYMENTS --------------------------------------------------------
    h, rows = load(src, 'PAYMENTS')
    pays = []
    for r in rows:
        if not s(r[0]) and not n(r[4]):
            continue
        note = s(r[6])
        m = re.search(r'\[acct:([^\]]+)\]', note)
        pays.append((biz, s(r[0]), s(r[1]) or None, s(r[2]), m.group(1) if m else None,
                     when(r[3]) or datetime.now(DHAKA), n(r[4]), s(r[5]), note, s(r[7])))
    ins('payments', ['business_id', 'payment_no', 'invoice_no', 'customer', 'customer_key', 'paid_at', 'amount',
                     'method', 'note', 'recorded_by'], pays)

    # ---- smaller tabs ----------------------------------------------------
    h, rows = load(src, 'INVOICE_FIXES')
    ins('invoice_fixes', ['business_id', 'fixed_at', 'invoice_no', 'field', 'was', 'now', 'fixed_by'],
        [(biz, when(r[0]) or datetime.now(DHAKA), s(r[1]), s(r[2]), s(r[3]), s(r[4]), s(r[5])) for r in rows if s(r[1])])
    h, rows = load(src, 'DUE_REMINDERS')
    ins('due_reminders', ['business_id', 'reminded_at', 'customer_key', 'customer', 'phone', 'due', 'reminded_by'],
        [(biz, when(r[0]) or datetime.now(DHAKA), s(r[1]), s(r[2]), s(r[3]), n(r[4]), s(r[5])) for r in rows if s(r[1])])
    h, rows = load(src, 'COURIER_PAYOUTS')
    ins('courier_payouts', ['business_id', 'payout_id', 'created_src', 'paid_at', 'cod_collected', 'delivery_charges',
                            'cod_fee', 'paid_to_bank', 'parcels', 'synced_at', 'fields_seen'],
        [(biz, s(r[0]), s(r[1]), s(r[2]), n(r[3]), n(r[4]), n(r[5]), n(r[6]), int(n(r[7])),
          when(r[8]) or datetime.now(DHAKA), s(r[9])) for r in rows if s(r[0])])
    h, rows = load(src, 'COURIER_PAYOUT_LINES')
    ins('courier_payout_lines', ['business_id', 'payout_id', 'consignment_id', 'tracking_code', 'cod_amount', 'status',
                                 'recipient_name', 'recipient_phone', 'parcel_created', 'invoice_no', 'match',
                                 'delivery_charge', 'cod_charge'],
        [(biz, s(r[0]), s(r[1]), s(r[2]), n(r[3]), s(r[4]), s(r[5]), s(r[6]), s(r[7]), s(r[8]), s(r[9]),
          n(r[10]), n(r[11])) for r in rows if s(r[0])])
    h, rows = load(src, 'EXPENSE_ITEMS')
    ins('expense_items', ['business_id', 'item_no', 'kind', 'name', 'category', 'amount', 'from_month', 'to_month',
                          'note', 'set_by'],
        [(biz, s(r[0]), s(r[1]), s(r[2]), s(r[3]), n(r[4]) if s(r[4]) else None, month(r[5]), month(r[6]) or None,
          s(r[7]), s(r[8])) for r in rows if s(r[0])])
    h, rows = load(src, 'EXPENSES')
    ins('expenses', ['business_id', 'expense_no', 'recorded_at', 'month', 'kind', 'category', 'description', 'amount',
                     'item_no', 'recorded_by', 'voided'],
        [(biz, s(r[0]), when(r[1]) or datetime.now(DHAKA), month(r[2]), s(r[3]), s(r[4]), s(r[5]), n(r[6]),
          s(r[7]) or None, s(r[8]), s(r[9]) or None) for r in rows if s(r[0])])
    h, rows = load(src, 'CAMPAIGNS')
    ins('campaigns', ['business_id', 'campaign_no', 'created_at', 'created_by', 'name', 'message', 'recipients'],
        [(biz, s(r[0]), when(r[1]) or datetime.now(DHAKA), s(r[2]), s(r[3]), s(r[4]), int(n(r[5]))) for r in rows if s(r[0])])
    h, rows = load(src, 'CAMPAIGN_SENDS')
    ins('campaign_sends', ['business_id', 'campaign_no', 'customer_key', 'customer', 'phone', 'status', 'updated_at', 'by'],
        [(biz, s(r[0]), s(r[1]), s(r[2]), s(r[3]), s(r[4]) or 'waiting', when(r[5]) or datetime.now(DHAKA), s(r[6]))
         for r in rows if s(r[0])])
    h, rows = load(src, 'CAMPAIGN_LEADS')
    ins('campaign_leads', ['business_id', 'lead_key', 'name', 'phone', 'source', 'note', 'added_at', 'by'],
        [(biz, s(r[0]), s(r[1]), s(r[2]), s(r[3]), s(r[4]), when(r[5]) or datetime.now(DHAKA), s(r[6])) for r in rows if s(r[0])])
    h, rows = load(src, 'QUOTE_SETTINGS')
    qs = []
    for r in rows:
        if not s(r[0]):
            continue
        try:
            qs.append((biz, s(r[0]), json.dumps(json.loads(s(r[1])))))
        except ValueError:
            skip.append('QUOTE_SETTINGS %s: not valid JSON' % s(r[0]))
    if qs:
        psycopg2.extras.execute_values(cur, 'insert into quote_settings (business_id, key, value) values %s on conflict (business_id, key) do update set value = excluded.value', qs)
        rep['quote_settings'] = len(qs)
        skip.append('QUOTE_SETTINGS: logo/QR/signature image ids point at Google Drive - upload the images again in Settings')

    # ---- WEB_ORDERS -> web_orders + lines --------------------------------
    h, rows = load(src, 'WEB_ORDERS')
    wo, worder = {}, []
    for r in rows:
        no = s(r[2])
        if not no:
            continue
        if no not in wo:
            wo[no] = []; worder.append(no)
        wo[no].append(r)
    wrows = []
    for no in worder:
        f = wo[no][0]
        wrows.append((biz, no, when(f[1]), s(f[3]), s(f[8]), s(f[9]), s(f[10]), s(f[11]), n(f[12]),
                      when(f[0]) or datetime.now(DHAKA), any(s(x[13]).lower() == 'yes' for x in wo[no]), s(f[14]) or None))
    wids = ins('web_orders', ['business_id', 'order_no', 'order_date', 'status', 'customer_name', 'customer_phone',
                              'customer_address', 'payment', 'order_total', 'pulled_at', 'entered', 'manager_note'], wrows)
    wid = dict(zip(worder, wids))
    ins('web_order_lines', ['business_id', 'web_order_id', 'sku', 'product_name', 'qty', 'line_total', 'status', 'entered'],
        [(biz, wid[no], s(r[4]), s(r[5]), n(r[6]), n(r[7]), s(r[3]), s(r[13]).lower() == 'yes') for no in worder for r in wo[no]])   # each line's own "entered

    # ---- CAPITAL (build b261002-1321; the tabs exist only once the screen was used) ----
    h, rows = load(src, 'CAPITAL_HOLDERS')
    ins('capital_holders', ['business_id', 'holder_no', 'kind', 'name', 'phone', 'share_pct', 'return_kind', 'return_value',
                            'since_month', 'private', 'ended_month', 'note', 'set_by', 'set_at'],
        [(biz, s(r[0]), 'investor' if s(r[1]) == 'investor' else 'shareholder', s(r[2]), s(r[3]),
          n(r[4]) if s(r[4]) else None, s(r[5]), n(r[6]) if s(r[6]) else None, month(r[7]), s(r[8]).lower() == 'yes',
          month(r[9]) or None, s(r[10]), s(r[11]), when(r[12]) or datetime.now(DHAKA)) for r in rows if s(r[0])])
    h, rows = load(src, 'CAPITAL_BOOK')
    ins('capital_book', ['business_id', 'entry_no', 'recorded_at', 'on_date', 'holder_no', 'type', 'amount', 'method',
                         'note', 'by', 'voided', 'expense_no', 'month'],
        [(biz, s(r[0]), when(r[1]) or datetime.now(DHAKA), when(r[2]), s(r[3]), s(r[4]), n(r[5]), s(r[6]), s(r[7]),
          s(r[8]), s(r[9]) or None, s(r[10]) or None, month(r[11])) for r in rows if s(r[0])])
    h, rows = load(src, 'CAPITAL_CLOSED')
    closed = []
    for r in rows:
        if not month(r[0]):
            continue
        try:
            sh = json.loads(s(r[2]) or '{}')
        except ValueError:
            sh = {}
        closed.append((biz, month(r[0]), n(r[1]), json.dumps(sh), when(r[3]) or datetime.now(DHAKA), s(r[4])))
    if closed:
        psycopg2.extras.execute_values(cur, 'insert into capital_closed (business_id, month, net_profit, shares, closed_at, by) values %s', closed)
        rep['capital_closed'] = len(closed)

    h, rows = load(src, 'ERP_USERS')
    if rows:
        skip.append('ERP_USERS: %d staff login(s) not imported - add them again in Settings > Staff (new codes)' % len(rows))

    # ---- check: stock per SKU against the sheet's STOCK_VIEW --------------
    h, rows = load(src, 'STOCK_VIEW')
    cur.execute("""select lower(p.sku), coalesce(ps.stock, 0) from products p
                   left join product_stock ps on ps.product_id = p.id where p.business_id = %s""", (biz,))
    mine = dict(cur.fetchall())
    diff = []
    for r in rows:
        sku = s(r[0]).lower()
        if sku and abs(n(r[8]) - float(mine.get(sku, 0))) > 0.001:
            diff.append('%s: sheet %s, ledger %s' % (s(r[0]), s(r[8]), mine.get(sku)))

    print('IMPORTED:')
    for k, v in rep.items():
        print('  %-22s %d' % (k, v))
    print('SKIPPED / NOTES (%d):' % len(skip))
    for x in skip[:200]:
        print('  - ' + x)
    print('STOCK CHECK: %d of %d SKUs differ from STOCK_VIEW' % (len(diff), len(rows)))
    for x in diff[:50]:
        print('  ! ' + x)

    if dry:
        con.rollback(); print('DRY RUN - rolled back, nothing written.')
    else:
        con.commit(); print('COMMITTED.')

if __name__ == '__main__':
    main()
