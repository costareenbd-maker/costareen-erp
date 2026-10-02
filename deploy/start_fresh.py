"""Go-live: empty the trial data of ONE business in the web app. The sheet ERP is not touched.

    set SUPABASE_ACCESS_TOKEN=sbp_...
    python start_fresh.py <business id>                 # only counts what is there (changes nothing)
    python start_fresh.py <business id> --keep-lists    # the plan: what would go, what would stay
    python start_fresh.py <business id> --keep-lists --yes-delete "<business name>"

What goes (everything that was copied from the sheet for the trial):
    invoices and their lines, payments, returns, stock movements, supplier orders,
    courier bookings and payouts, expenses and expense items, capital book,
    quotations, campaigns, web orders, dues reminders, activity and error logs,
    the kept dashboard.
What stays, always:
    the business itself, its people, codes and devices, settings, lists, keys,
    logo and invoice look, backups.
With --keep-lists (recommended): products (with prices and cost), customers, the
    cost book and the fixed / recurring expense set-up stay too - stock becomes 0
    and customer totals are cleared, ready for the opening stock count. Without
    it, those go as well.
The invoice number counter is left alone, so new invoices carry on after the
    last number and never repeat one the sheet has already used.

A full backup of the tables is written next to this file before anything is deleted.
"""
import json, os, sys, time, urllib.request

REF = 'oqzcuuytytqadqjlwdsh'
ALWAYS_KEEP = {
    'businesses', 'memberships', 'business_config', 'business_secrets', 'lookups', 'quote_settings',
    'erp_people', 'erp_devices', 'erp_prefs', 'erp_backup_log', 'invoice_counters', 'ai_keys', 'erp_ai_keys',
    'pool_partners', 'pool_invites', 'money_accounts', 'erp_access_keys',
}
LISTS = {'products', 'customers', 'cost_book', 'expense_items', 'suppliers'}


def q(sql):
    tok = os.environ.get('SUPABASE_ACCESS_TOKEN', '').strip()
    if not tok:
        sys.exit('Set SUPABASE_ACCESS_TOKEN first.')
    req = urllib.request.Request('https://api.supabase.com/v1/projects/%s/database/query' % REF, method='POST',
                                 headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json',
                                          'User-Agent': 'costareen-deploy'},
                                 data=json.dumps({'query': sql}).encode())
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode() or '[]')
    except urllib.error.HTTPError as e:
        sys.exit('database said: ' + e.read().decode()[:600])


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    biz = sys.argv[1]
    keep_lists = '--keep-lists' in sys.argv
    b = q("select name from businesses where id = '%s'" % biz)
    if not b:
        sys.exit('No such business.')
    name = b[0]['name']
    tables = [r['table_name'] for r in q(
        "select c.table_name from information_schema.columns c join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name "
        "where c.table_schema = 'public' and c.column_name = 'business_id' order by 1")]
    counts = {r['t']: r['n'] for r in q(' union all '.join(
        "select '%s' t, count(*)::int n from public.\"%s\" where business_id = '%s'" % (t, t, biz) for t in tables))}
    keep = set(ALWAYS_KEEP) | (LISTS if keep_lists else set())
    go = [t for t in tables if t not in keep and counts.get(t)]
    stay = [t for t in tables if t in keep and counts.get(t)]
    print('Business: %s (%s)\n' % (name, biz))
    print('GOES:')
    for t in go:
        print('  %-28s %6d rows' % (t, counts[t]))
    print('\nSTAYS:')
    for t in stay:
        print('  %-28s %6d rows' % (t, counts[t]))
    if '--yes-delete' not in sys.argv:
        print('\nNothing was changed. Add  --yes-delete "%s"  to do it.' % name)
        return
    typed = sys.argv[sys.argv.index('--yes-delete') + 1] if len(sys.argv) > sys.argv.index('--yes-delete') + 1 else ''
    if typed != name:
        sys.exit('The name after --yes-delete must be exactly: ' + name)

    # 1. a copy of everything that is about to go (and of the lists), kept on this computer
    stamp = time.strftime('%Y%m%d-%H%M%S')
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'before-start-fresh-%s.json' % stamp)
    dump = {}
    for t in go + [t for t in LISTS if counts.get(t)]:
        dump[t] = q("select coalesce(json_agg(x), '[]'::json) j from public.\"%s\" x where business_id = '%s'" % (t, biz))[0]['j']
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(dump, f, ensure_ascii=False)
    print('\nbackup written: %s (%d tables, %.1f MB)' % (out, len(dump), os.path.getsize(out) / 1e6))

    # 2. one transaction: all of it, or none of it. Triggers that guard closed months and
    #    stock history are for daily work, not for this, so they are off for the transaction.
    stmts = ["set local session_replication_role = replica"]
    for t in go:
        stmts.append("delete from public.\"%s\" where business_id = '%s'" % (t, biz))
    if keep_lists:
        stmts.append("update public.customers set total_orders = 0, total_spent = 0, last_order_at = null, last_product = null where business_id = '%s'" % biz)
    q('begin; ' + '; '.join(stmts) + '; commit;')

    after = {r['t']: r['n'] for r in q(' union all '.join(
        "select '%s' t, count(*)::int n from public.\"%s\" where business_id = '%s'" % (t, t, biz) for t in tables))}
    left = [t for t in go if after.get(t)]
    print('done. emptied %d tables.%s' % (len(go), (' STILL HOLD ROWS: ' + ', '.join(left)) if left else ''))
    stock = q("select count(*)::int n from product_stock ps join products p on p.id = ps.product_id where p.business_id = '%s' and ps.stock <> 0" % biz)
    print('products with stock other than 0:', stock[0]['n'])


if __name__ == '__main__':
    main()
