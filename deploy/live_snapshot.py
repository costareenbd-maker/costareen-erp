"""A read-only snapshot of the LIVE database before an upgrade: every table in public (rows as JSON), the migration
log, row counts, and money/stock check-sums - written to private/snapshots/<time>/ (gitignored, never pushed).

    cd deploy; source secrets.env; python live_snapshot.py

Nothing on the live server is changed: every query is a single SELECT. Restore = the schema of the recorded code version
(the commit in VERSION.txt) + these rows (deploy/live_restore.py, written for this), or the ERP's own backup file.
"""
import datetime, json, os, sys, urllib.request

REF = 'oqzcuuytytqadqjlwdsh'
TOK = os.environ.get('SUPABASE_ACCESS_TOKEN', '').strip()
if not TOK:
    sys.exit('source secrets.env first')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def q(sql):
    if not sql.lstrip().lower().startswith(('select', 'with')):
        raise SystemExit('read-only: ' + sql[:60])
    req = urllib.request.Request('https://api.supabase.com/v1/projects/%s/database/query' % REF, method='POST',
                                 data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': 'Bearer ' + TOK, 'Content-Type': 'application/json', 'User-Agent': 'erp-snapshot'})
    import time
    for i in range(8):
        try:
            time.sleep(0.6)
            return json.loads(urllib.request.urlopen(req, timeout=180).read().decode())
        except urllib.error.HTTPError as e:
            if e.code != 429 or i == 7:
                raise
            time.sleep(5 * (i + 1))   # the management API allows only so many queries a minute


def main():
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M')
    out = os.path.join(ROOT, 'private', 'snapshots', 'live-' + stamp)
    os.makedirs(os.path.join(out, 'tables'), exist_ok=True)
    tables = [r['t'] for r in q("select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")]
    counts = {}
    for t in tables:
        n = q('select count(*)::int as n from public."%s"' % t)[0]['n']
        counts[t] = n
        rows, page = [], 5000
        for off in range(0, n, page):
            part = q('select coalesce(json_agg(x), \'[]\'::json) as j from (select * from public."%s" order by 1 limit %d offset %d) x' % (t, page, off))[0]['j']
            rows.extend(part if isinstance(part, list) else json.loads(part))
        with open(os.path.join(out, 'tables', t + '.json'), 'w', encoding='utf-8') as f:
            json.dump(rows, f, ensure_ascii=False, default=str)
        print('%-40s %7d' % (t, n))
    # check-sums to compare after the upgrade: they must not change
    sums = {}
    for name, sql in {
        'invoices': "select count(*)::int n, round(coalesce(sum(grand_total),0)::numeric,2) total from invoices",
        'payments': "select count(*)::int n, round(coalesce(sum(amount),0)::numeric,2) total from payments",
        'stock': "select count(*)::int n, coalesce(sum(stock),0)::numeric total from product_stock",
        'customers': "select count(*)::int n from customers",
        'products': "select count(*)::int n from products",
        'expenses': "select count(*)::int n, round(coalesce(sum(amount),0)::numeric,2) total from expenses",
    }.items():
        try:
            sums[name] = q(sql)[0]
        except Exception as e:
            sums[name] = {'error': str(e)[:120]}
    migs = [r['name'] for r in q('select name from _erp_migrations order by name')]
    with open(os.path.join(out, 'SNAPSHOT.json'), 'w', encoding='utf-8') as f:
        json.dump({'project': REF, 'at': datetime.datetime.now().isoformat(), 'counts': counts, 'checksums': sums, 'migrations': migs}, f, indent=1, default=str)
    print('\nsnapshot:', out, '|', len(tables), 'tables,', sum(counts.values()), 'rows')
    print('check-sums:', json.dumps(sums, default=str))


if __name__ == '__main__':
    main()
