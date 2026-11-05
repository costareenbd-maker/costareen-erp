import pathlib, json, subprocess, os
os.umask(63)
b = pathlib.Path('/opt/erp-dev-migration')
n = json.loads((b / 'config.json').read_text())
cs = {k: json.loads(subprocess.check_output(['docker', 'inspect', v], text=True))[0] for k, v in [('auth', 'supabase-auth'), ('storage', 'supabase-storage'), ('edge', 'supabase-edge-functions')]}
out = {'name': 'erp-dev-native', 'services': {}, 'networks': {'default': {'external': True, 'name': 'supabase_default'}}, 'volumes': {'deno-cache': {'external': True, 'name': 'supabase_deno-cache'}}}
for kind in ['auth', 'storage', 'edge']:
    c = cs[kind]
    env = dict((x.split('=', 1) for x in c['Config']['Env'])) if kind != 'edge' else {}
    v = {'image': c['Config']['Image'], 'container_name': 'erp-dev-' + kind, 'restart': 'unless-stopped', 'networks': ['default']}
    if kind == 'auth':
        env.update(GOTRUE_DB_DATABASE_URL=n['dbUrl'] + '?options=-csearch_path%3Dauth', GOTRUE_JWT_SECRET=n['jwtSecret'], GOTRUE_JWT_KEYS=json.dumps(n['jwtKeys'], separators=(',', ':')), GOTRUE_JWT_ISSUER='https://' + n['ref'] + '.supabase.co/auth/v1', API_EXTERNAL_URL=n['url'], GOTRUE_SITE_URL=n['appUrl'], GOTRUE_URI_ALLOW_LIST=n['appUrl'] + ',https://*.costareen-erp-dev.pages.dev', GOTRUE_RATE_LIMIT_EMAIL_SENT='2')
        port = n['authPort']
        target = 9999
    elif kind == 'storage':
        env.update(DATABASE_URL=n['dbUrl'], AUTH_JWT_SECRET=n['jwtSecret'], ANON_KEY=n['anon'], SERVICE_KEY=n['service'], TENANT_ID=n['ref'], GLOBAL_S3_BUCKET=n['ref'], STORAGE_PUBLIC_URL=n['url'] + '/storage/v1', ENABLE_IMAGE_TRANSFORMATION='false', JWT_JWKS=json.dumps({'keys': n['publicJwtKeys']}, separators=(',', ':')))
        files = pathlib.Path('/data/erp-dev/files')
        files.mkdir(parents=True, exist_ok=True)
        v['volumes'] = [str(files) + ':/var/lib/storage:z']
        port = n['storagePort']
        target = 5000
    else:
        env.update(SUPABASE_URL=n['url'], SUPABASE_ANON_KEY=n['anon'], SUPABASE_SERVICE_ROLE_KEY=n['service'], SUPABASE_DB_URL=n['dbUrl'], ERP_APP_URL=n['appUrl'], VERIFY_JWT='false', JWT_SECRET=n['jwtSecret'])
        v['command'] = c['Config']['Cmd']
        v['volumes'] = [str(b / 'functions') + ':/home/deno/functions:ro', 'deno-cache:/root/.cache/deno']
        port = n['edgePort']
        target = 9000
    extra = b / 'runtime-extra.env.json'
    if kind == 'edge' and extra.exists():
        env.update(json.loads(extra.read_text()))
    v['environment'] = env
    v['ports'] = [{'host_ip': '127.0.0.1', 'published': str(port), 'target': target, 'protocol': 'tcp'}]
    out['services']['dev-' + kind] = v
(b / 'docker-compose.json').write_text(json.dumps(out, indent=2))
(b / 'runtime.env').write_text('\n'.join((k + '=' + v for k, v in out['services']['dev-edge']['environment'].items())) + '\n')
subprocess.run(['docker', 'compose', '-f', str(b / 'docker-compose.json'), 'up', '-d', '--pull', 'never'], check=True)
print('Original development source and isolated Auth/Storage started on private ports')
