"""Compare the live web ERP with the sheet export, field by field (read only, both sides).

    python audit_vs_sheet.py <export_dir> <business_id>
Prints, per tab, how many rows match and the first examples of every field that differs.
"""
import json, os, sys, urllib.request, collections, re, datetime

REF = 'oqzcuuytytqadqjlwdsh'


def sql(q):
    r = urllib.request.Request('https://api.supabase.com/v1/projects/%s/database/query' % REF, method='POST', data=json.dumps({'query': q}).encode(),
                               headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'], 'Content-Type': 'application/json', 'User-Agent': 'costareen-deploy'})
    return json.loads(urllib.request.urlopen(r, timeout=300).read())


def tab(d, name):
    p = os.path.join(d, name + '.json')
    if not os.path.exists(p): return [], []
    v = json.load(open(p, encoding='utf-8')); v = v.get('values', v) if isinstance(v, dict) else v
    h = [str(x).strip() for x in v[0]]
    return h, [dict(zip(h, r + [''] * (len(h) - len(r)))) for r in v[1:]]


def num(x):
    try: return round(float(str(x).replace(',', '')), 2) if str(x).strip() != '' else 0.0
    except Exception: return None


def txt(x): return re.sub(r'\s+', ' ', str(x if x is not None else '')).strip().lower()


def phone(x):
    d = re.sub(r'\D', '', str(x or ''))
    return d[-10:] if d else ''


class Rep:
    def __init__(self, name): self.name, self.rows, self.missing, self.extra, self.diffs = name, 0, [], [], collections.defaultdict(list)
    def diff(self, key, field, sheet, erp):
        self.diffs[field].append((key, sheet, erp))
    def show(self):
        bad = sum(len(v) for v in self.diffs.values())
        print('\n== %s: %d compared, %d missing in ERP, %d only in ERP, %d field differences' % (self.name, self.rows, len(self.missing), len(self.extra), bad))
        if self.missing: print('   missing in ERP:', self.missing[:8])
        if self.extra: print('   only in ERP:', self.extra[:8])
        for f, xs in self.diffs.items():
            print('   %-18s %4d differ, e.g. %s' % (f, len(xs), '; '.join('%s: sheet=%r erp=%r' % x for x in xs[:3])))
        return bad + len(self.missing)


def main():
    d, biz = sys.argv[1], sys.argv[2]
    B = "business_id = '%s'" % biz
    problems = 0

    # ---- invoices (SALES_LOG has one row per line; invoice fields repeat on each line)
    h, sl = tab(d, 'SALES_LOG')
    inv = collections.OrderedDict()
    for r in sl:
        oid = str(r['order_id']).strip()
        if not oid: continue
        inv.setdefault(oid, []).append(r)
    erp = {r['invoice_no']: r for r in sql("select * from invoices where %s" % B)}
    lines = collections.defaultdict(list)
    for l in sql("select l.*, i.invoice_no from invoice_lines l join invoices i on i.id = l.invoice_id where l.%s" % B.replace('business_id', 'business_id')):
        lines[l['invoice_no']].append(l)
    R = Rep('Invoices (SALES_LOG)')
    for oid, rows in inv.items():
        e = erp.get(oid)
        if not e: R.missing.append(oid); continue
        R.rows += 1
        f = rows[0]
        for sk, ek in [('grand_total', 'grand_total'), ('discount', 'discount'), ('delivery_charge', 'delivery_charge'), ('advance_paid', 'advance_paid'), ('due_amount', 'due_amount')]:
            a, b = num(f[sk]), num(e.get(ek))
            if a is not None and b is not None and abs(a - b) > 0.5: R.diff(oid, sk, a, b)
        for sk, ek in [('payment_status', 'payment_status'), ('delivery_status', 'delivery_status'), ('payment_method', 'payment_method'), ('customer_name', 'customer_name')]:
            if txt(f[sk]) != txt(e.get(ek)): R.diff(oid, sk, f[sk], e.get(ek))
        if phone(f['customer_contact']) != phone(e.get('customer_phone')): R.diff(oid, 'phone', f['customer_contact'], e.get('customer_phone'))
        # lines: count, quantity, money
        el = lines.get(oid, [])
        if len(el) != len(rows): R.diff(oid, 'line count', len(rows), len(el))
        sq, eq = sum(num(r['quantity']) or 0 for r in rows), sum(num(l.get('qty') if 'qty' in l else l.get('quantity')) or 0 for l in el)
        if abs(sq - eq) > 0.001: R.diff(oid, 'units', sq, eq)
    R.extra = [k for k in erp if k not in inv][:20]
    problems += R.show()

    # ---- payments
    h, pay = tab(d, 'PAYMENTS')
    ep = sql("select * from payments where %s" % B)
    cols = list(ep[0].keys()) if ep else []
    R = Rep('Payments')
    def k(order, amount): return (str(order).strip(), round(float(amount or 0), 2))
    have = collections.Counter(k(p.get('invoice_no') or p.get('order_id'), p.get('amount')) for p in ep)
    for p in pay:
        if not str(p['order_id']).strip(): continue
        R.rows += 1
        kk = k(p['order_id'], num(p['amount']))
        if have[kk] > 0: have[kk] -= 1
        else: R.missing.append(kk)
    R.extra = [x for x, c in have.items() if c > 0][:20]
    print('   (payment columns in ERP: %s)' % ', '.join(cols[:20]))
    s_sum = sum(num(p['amount']) or 0 for p in pay); e_sum = sum(float(p.get('amount') or 0) for p in ep)
    print('   sum of payments: sheet %.2f  erp %.2f' % (s_sum, e_sum))
    problems += R.show()

    # ---- customers
    h, cus = tab(d, 'CUSTOMERS')
    ec = sql("select * from customers where %s" % B)
    byp = {}
    for c in ec:
        if phone(c.get('phone')): byp.setdefault(phone(c['phone']), c)
    byname = {txt(c.get('name')): c for c in ec}
    byno = {txt(c.get('customer_no')): c for c in ec if c.get('customer_no')}
    R = Rep('Customers')
    for c in cus:
        e = byno.get(txt(c['customer_id'])) or byp.get(phone(c['contact_number'])) or byname.get(txt(c['customer_name']))
        if not e: R.missing.append(c['customer_name']); continue
        R.rows += 1
        for sk, ek in [('total_orders', 'total_orders'), ('total_spent', 'total_spent')]:
            a, b = num(c[sk]), num(e.get(ek))
            if a is not None and b is not None and abs(a - b) > 0.5: R.diff(c['customer_name'], sk, a, b)
        for sk, ek in [('customer_type', 'type'), ('customer_source', 'source'), ('customer_status', 'status'), ('customer_name', 'name')]:
            if txt(c[sk]) != txt(e.get(ek)): R.diff(c['customer_name'], sk, c[sk], e.get(ek))
    problems += R.show()

    # ---- products
    h, pm = tab(d, 'PRODUCT_MASTER')
    epr = {txt(p['sku']): p for p in sql("select * from products where %s" % B)}
    R = Rep('Products')
    for p in pm:
        e = epr.get(txt(p['sku']))
        if not e: R.missing.append(p['sku']); continue
        R.rows += 1
        for sk, ek in [('cost_price', 'cost_price'), ('sell_price', 'sell_price'), ('reorder_level', 'reorder_level')]:
            a, b = num(p[sk]), num(e.get(ek))
            if a is not None and b is not None and abs(a - b) > 0.01: R.diff(p['sku'], sk, a, b)
        for sk in ['product_name', 'category', 'brand', 'color', 'status']:
            ek = 'name' if sk == 'product_name' else sk
            if txt(p[sk]) != txt(e.get(ek)): R.diff(p['sku'], sk, p[sk], e.get(ek))
    problems += R.show()

    # ---- courier payout lines
    h, cpl = tab(d, 'COURIER_PAYOUT_LINES')
    ecl = {(str(l.get('payout_id')), str(l.get('consignment_id'))): l for l in sql("select * from courier_payout_lines where %s" % B)}
    R = Rep('Courier payout lines')
    for l in cpl:
        kk = (str(l['payout_id']), str(int(l['consignment_id'])) if isinstance(l['consignment_id'], float) else str(l['consignment_id']))
        e = ecl.get(kk)
        if not e: R.missing.append(kk); continue
        R.rows += 1
        if abs((num(l['cod_amount']) or 0) - (num(e.get('cod_amount')) or 0)) > 0.5: R.diff(kk, 'cod_amount', l['cod_amount'], e.get('cod_amount'))
        if txt(l['invoice_no']) != txt(e.get('invoice_no')): R.diff(kk, 'invoice_no', l['invoice_no'], e.get('invoice_no'))
        if txt(l['status']) != txt(e.get('status')): R.diff(kk, 'status', l['status'], e.get('status'))
    problems += R.show()

    print('\nTOTAL problems: %d' % problems)


if __name__ == '__main__':
    main()
