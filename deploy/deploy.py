"""Put the web app live. Nothing here touches the sheet ERP.

    set SUPABASE_ACCESS_TOKEN=sbp_...      (Supabase account token)
    set CLOUDFLARE_API_TOKEN=...           (Pages: Edit, DNS: Edit, Zone: Read on costareen.com)
    set CLOUDFLARE_ACCOUNT_ID=...
    python deploy.py db          # apply supabase/0NN_*.sql in order + deploy/storage.sql
    python deploy.py function    # deploy the `erp` Edge Function (JWT check off; it checks callers itself)
    python deploy.py secrets RENDER_URL=... RENDER_KEY=...
    python deploy.py web         # build web/index.html and publish to Cloudflare Pages
    python deploy.py domain      # attach erp.costareen.com to the Pages project
    python deploy.py cron        # nightly / 10-min campaigns / 15-min website sync timers
    python deploy.py release     # keep this version for the installer (every company's copy is built from it)
    python deploy.py domains     # add company copies' own web addresses to the Pages project
    python deploy.py all         # db + function + web + release in one go: everything live, every company copy follows within the hour

    set ERP_TARGET=dev             the shared DEVELOPMENT project instead (demo data, both developers). Only db, function,
                                   secrets and web work there; the live project and its pages are never touched.

Each step prints what it did and stops at the first error.
"""
import glob, json, os, shutil, subprocess, sys, tempfile, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = 'oqzcuuytytqadqjlwdsh'
PAGES_PROJECT = 'costareen-erp'
DEV = os.environ.get('ERP_TARGET', '').strip().lower() == 'dev'
if DEV:
    REF = 'zukqxkcpmxcogbhkdpyw'          # costareen-dev: demo data only, shared by both developers
    PAGES_PROJECT = 'costareen-erp-dev'
# the neutral address customers see (install links; a company copy without its own address): no company name in it
PUBLIC_PROJECT = 'office-erp'
CREATOR_PROJECT = 'creatorsdesk'      # the creator / sponsor pages alone, on a host with no company name (ERP_CREATOR_URL)
DOMAIN = 'erp.costareen.com'
ZONE = 'costareen.com'


def need(var):
    v = os.environ.get(var, '').strip()
    if not v:
        sys.exit('Set %s first.' % var)
    return v


def api(url, method='GET', body=None, token=None, headers=None):
    h = {'Content-Type': 'application/json', 'User-Agent': 'costareen-deploy'}
    if token:
        h['Authorization'] = 'Bearer ' + token
    h.update(headers or {})
    req = urllib.request.Request(url, method=method, headers=h,
                                 data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            t = r.read().decode()
            return r.status, (json.loads(t) if t.strip() else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:2000]


def sql(query):
    tok = need('SUPABASE_ACCESS_TOKEN')
    for wait in (0, 10, 20, 40, 60, 90):
        if wait:
            print('  Supabase says too many requests; waiting %d s' % wait); time.sleep(wait)
        code, out = api('https://api.supabase.com/v1/projects/%s/database/query' % REF, 'POST', {'query': query}, tok)
        if code != 429:
            break
    if code >= 300:
        raise SystemExit('SQL failed (%s): %s' % (code, out))
    return out


def step_db():
    files = sorted(glob.glob(os.path.join(ROOT, 'supabase', '[0-9][0-9][0-9]_*.sql')))
    done = {r['name'] for r in (sql("""
        create table if not exists public._erp_migrations (name text primary key, at timestamptz default now());
        alter table public._erp_migrations enable row level security;
        select name from public._erp_migrations;""") or [])}
    # 002 changed after it was first applied (create_invoice now prices through
    # sale_price_for). Re-apply it once, BEFORE 005, which replaces
    # sale_price_for with the partner-aware version.
    if '005_partnership.sql' not in done and not DEV:
        print('re-apply 002_functions.sql')
        sql(open(os.path.join(ROOT, 'supabase', '002_functions.sql'), encoding='utf-8').read())
    # 001-004 were applied by hand on 2026-09-20, before this log existed
    by_hand = {'001_schema.sql', '002_functions.sql', '003_sheets.sql', '004_grants.sql'}
    for f in files + [os.path.join(ROOT, 'supabase', 'deploy', 'storage.sql')]:
        name = os.path.basename(f)
        if name in done:
            continue
        if name in by_hand and '--all' not in sys.argv and not DEV:
            print('skip (applied by hand 2026-09-20):', name)
            continue
        print('apply', name)
        sql(open(f, encoding='utf-8').read())
        sql("insert into public._erp_migrations(name) values ('%s') on conflict do nothing" % name)
    print('database is up to date')


def step_function():
    need('SUPABASE_ACCESS_TOKEN')
    cmd = ['npx', '-y', 'supabase@latest', 'functions', 'deploy', 'erp', '--project-ref', REF,
           '--no-verify-jwt', '--use-api']
    print(' '.join(cmd))
    # the upload sometimes fails once for no reason of ours: try again before giving up
    for attempt in (1, 2, 3):
        if subprocess.call(cmd, cwd=ROOT, shell=(os.name == 'nt')) == 0:
            return
        print('  the function upload failed (try %d of 3)' % attempt)
        time.sleep(5 * attempt)
    raise SystemExit('The function upload failed three times.')


def step_secrets(pairs):
    tok = need('SUPABASE_ACCESS_TOKEN')
    body = []
    for p in pairs:
        k, _, v = p.partition('=')
        body.append({'name': k, 'value': v})
    code, out = api('https://api.supabase.com/v1/projects/%s/secrets' % REF, 'POST', body, tok)
    print('secrets', code, '' if code < 300 else out)


def step_web():
    need('CLOUDFLARE_API_TOKEN'); need('CLOUDFLARE_ACCOUNT_ID')
    env = None
    if DEV:
        tok = need('SUPABASE_ACCESS_TOKEN')
        code, keys = api('https://api.supabase.com/v1/projects/%s/api-keys' % REF, token=tok)
        anon = [k['api_key'] for k in keys if k.get('name') == 'anon'][0]
        env = dict(os.environ, ERP_API='https://%s.supabase.co/functions/v1/erp' % REF,
                   ERP_SB_URL='https://%s.supabase.co' % REF, ERP_SB_ANON=anon,
                   ERP_OPEN_KEY=os.environ.get('ERP_DEV_OPEN_KEY', ''))   # demo data only: the dev page opens with no sign-in
    subprocess.check_call([sys.executable, os.path.join(ROOT, 'web', 'build.py')], env=env)
    out = tempfile.mkdtemp(prefix='erp-web-')
    for f in ['index.html', 'manifest.webmanifest', 'sw.js', '_headers', 'check.html', 'my.html', 'confirm.html', 'lite.html', 'doctor.html', 'doctor-data.js', 'quote.html', 'find.html', 'ideas.html', 'choose.html', 'colour-math.js', 'colour-data.js', 'print.html', 'design.html', 'creator.html', 'sponsor.html', 'investor.html', 'fd-public.css', 'help-guides.js']:
        shutil.copy(os.path.join(ROOT, 'web', f), out)
    shutil.copytree(os.path.join(ROOT, 'web', 'icons'), os.path.join(out, 'icons'))
    shutil.copytree(os.path.join(ROOT, 'web', 'brand'), os.path.join(out, 'brand'))     # sponsoring brands' logos (creator / sponsor pages)
    shutil.copytree(os.path.join(ROOT, 'web', 'vendor'), os.path.join(out, 'vendor'))   # the barcode reader (loaded only when scanning)
    shutil.copytree(os.path.join(ROOT, 'web', 'games'), os.path.join(out, 'games'))   # games load on demand (no photos in them)
    shutil.copytree(os.path.join(ROOT, 'web', 'fonts'), os.path.join(out, 'fonts'))   # the FilaDash look's fonts (Inter + Noto Sans Bengali, OFL)
    # Stage 1e: only the published copy is minified (the source stays readable); a failed minify stops the deploy
    games = [os.path.join(out, 'games', f) for f in os.listdir(os.path.join(out, 'games')) if f.endswith('.js')]
    subprocess.check_call(['node', os.path.join(ROOT, 'deploy', 'minify.mjs'), os.path.join(out, 'index.html')] + games)
    # never publish web/.env.local, web/src, web/original or the old app
    for proj in ([PAGES_PROJECT] if DEV else [PAGES_PROJECT, PUBLIC_PROJECT]):
        if proj == PUBLIC_PROJECT or DEV:
            # made once, on first use
            base = 'https://api.cloudflare.com/client/v4/accounts/%s/pages/projects' % os.environ['CLOUDFLARE_ACCOUNT_ID']
            code, _ = api(base + '/' + proj, token=os.environ['CLOUDFLARE_API_TOKEN'])
            if code == 404:
                code, out2 = api(base, 'POST', {'name': proj, 'production_branch': 'main'}, os.environ['CLOUDFLARE_API_TOKEN'])
                print('made the neutral Pages project', proj, code, '' if code < 300 else out2)
        cmd = ['npx', '-y', 'wrangler@3', 'pages', 'deploy', out, '--project-name=' + proj,
               '--branch=main', '--commit-dirty=true']
        print(' '.join(cmd))
        subprocess.check_call(cmd, shell=(os.name == 'nt'))
    if DEV:
        subprocess.check_call([sys.executable, os.path.join(ROOT, 'web', 'build.py')])   # leave index.html built for live
        print('dev page: https://%s.pages.dev' % PAGES_PROJECT)
        return
    # the creator / sponsor pages on their own host: only those two pages, the logos and the icons
    cdir = tempfile.mkdtemp(prefix='erp-creator-')
    for f in ['creator.html', 'sponsor.html']:
        shutil.copy(os.path.join(ROOT, 'web', f), cdir)
    shutil.copy(os.path.join(ROOT, 'web', 'go.html'), cdir)   # a creator's project link: counted, then on to the product
    shutil.copy(os.path.join(ROOT, 'web', '_headers.creator'), os.path.join(cdir, '_headers'))   # may be framed by the ERP (owner's preview)
    shutil.copytree(os.path.join(ROOT, 'web', 'brand'), os.path.join(cdir, 'brand'))
    shutil.copy(os.path.join(ROOT, 'web', 'fd-public.css'), cdir)                       # the FilaDash look of the public pages
    shutil.copytree(os.path.join(ROOT, 'web', 'fonts'), os.path.join(cdir, 'fonts'))
    shutil.copytree(os.path.join(ROOT, 'web', 'icons'), os.path.join(cdir, 'icons'))
    open(os.path.join(cdir, 'index.html'), 'w', encoding='utf-8').write('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/creator"><title>Creator programme</title>')
    cmd = ['npx', '-y', 'wrangler@3', 'pages', 'deploy', cdir, '--project-name=' + CREATOR_PROJECT, '--branch=main', '--commit-dirty=true']
    print(' '.join(cmd))
    subprocess.check_call(cmd, shell=(os.name == 'nt'))


def step_domain():
    tok = need('CLOUDFLARE_API_TOKEN'); acct = need('CLOUDFLARE_ACCOUNT_ID')
    base = 'https://api.cloudflare.com/client/v4'
    code, out = api('%s/accounts/%s/pages/projects/%s/domains' % (base, acct, PAGES_PROJECT), 'POST', {'name': DOMAIN}, tok)
    print('pages domain', code, out if code >= 300 else 'ok')
    code, z = api('%s/zones?name=%s' % (base, ZONE), token=tok)
    zid = z['result'][0]['id']
    code, recs = api('%s/zones/%s/dns_records?name=%s' % (base, zid, DOMAIN), token=tok)
    target = PAGES_PROJECT + '.pages.dev'
    rec = {'type': 'CNAME', 'name': DOMAIN, 'content': target, 'proxied': True}
    if recs['result']:
        code, out = api('%s/zones/%s/dns_records/%s' % (base, zid, recs['result'][0]['id']), 'PUT', rec, tok)
    else:
        code, out = api('%s/zones/%s/dns_records' % (base, zid), 'POST', rec, tok)
    print('dns', code, 'ok' if code < 300 else out)


def step_cron():
    import secrets as _s
    key = _s.token_hex(24)
    step_secrets(['CRON_KEY=' + key])
    q = open(os.path.join(ROOT, 'supabase', 'deploy', 'cron.sql'), encoding='utf-8').read()
    q = q.replace('__FN_URL__', 'https://%s.supabase.co/functions/v1/erp' % REF).replace('__CRON_KEY__', key)
    sql(q)
    print('timers installed: erp-nightly 03:00 Dhaka, erp-campaigns and erp-alerts every 10 min, erp-websync every 15 min, erp-deliveries every hour, erp-drive every 10 min, erp-sheet every 10 min, erp-heartbeat hourly (copies only)')


def step_domains():
    """Every company copy's own web address (Platform > Company copies) is added to the Pages project, so it opens the ERP page."""
    tok = need('CLOUDFLARE_API_TOKEN'); acct = need('CLOUDFLARE_ACCOUNT_ID')
    base = 'https://api.cloudflare.com/client/v4/accounts/%s/pages/projects/%s/domains' % (acct, PUBLIC_PROJECT)
    code, have = api(base, token=tok)
    known = {d['name'] for d in (have.get('result') or [])} if isinstance(have, dict) else set()
    for r in sql("select company, domain from public.erp_installs where domain is not null") or []:
        d = r['domain']
        if d in known:
            print('already on:', d, '(' + r['company'] + ')'); continue
        code, out = api(base, 'POST', {'name': d}, tok)
        print('added' if code < 300 else 'FAILED', d, '(' + r['company'] + ')', '' if code < 300 else out)
    print('each company points its address with a CNAME record to %s.pages.dev' % PUBLIC_PROJECT)


def step_release():
    """Keep a copy of this version's server and database steps on the provider's system: the installer builds every company's copy from it."""
    files = {}
    fdir = os.path.join(ROOT, 'supabase', 'functions', 'erp')
    for base, _, names in os.walk(fdir):
        for n in names:
            if n.endswith(('.ts', '.js', '.json')):
                full = os.path.join(base, n)
                files['fn/' + os.path.relpath(full, fdir).replace(os.sep, '/')] = open(full, encoding='utf-8').read()
    for f in sorted(glob.glob(os.path.join(ROOT, 'supabase', '[0-9][0-9][0-9]_*.sql'))):
        files['sql/' + os.path.basename(f)] = open(f, encoding='utf-8').read()
    for n in ['storage.sql', 'cron.sql']:
        files['deploy/' + n] = open(os.path.join(ROOT, 'supabase', 'deploy', n), encoding='utf-8').read()
    version = subprocess.check_output(['git', 'describe', '--tags', '--always'], cwd=ROOT).decode().strip()
    body = json.dumps(files)
    if '$rel$' in body:
        sys.exit('the release text contains $rel$ - change the quoting')
    sql("insert into public.erp_releases (version, files) values ('%s', $rel$%s$rel$::jsonb) "
        "on conflict (version) do update set files = excluded.files, made_at = now()" % (version.replace("'", ""), body))
    print('release', version, 'published:', len(files), 'files,', len(body) // 1024, 'KB')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    s = sys.argv[1]
    if DEV and s not in ('db', 'function', 'secrets', 'web'):
        sys.exit('ERP_TARGET=dev allows only db, function, secrets and web.')
    print('target:', 'DEV project ' + REF if DEV else 'LIVE project ' + REF)
    {'db': step_db, 'function': step_function, 'web': step_web, 'domain': step_domain, 'cron': step_cron, 'release': step_release, 'domains': step_domains,
     'all': lambda: [step_db(), step_function(), step_web(), step_release()]}.get(
        s, lambda: step_secrets(sys.argv[2:]) if s == 'secrets' else sys.exit(__doc__))()
