// The installer: a company's ERP in its own Supabase account; the provider keeps control.
// Since the bridge (2026-10-05): the company's project gets tables, storage and sign-in only - no server code;
// the provider's server runs its ERP over an encrypted database connection. The company's Supabase
// (Management API) is faked; the company's database is this same test database.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, web, deps, fnDir } from './harness.mjs';
const { installRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'installer.js')));
const { installFinish, heartbeat, forgetControl } = await import(pathToFileURL(path.join(fnDir, 'lib', 'control.js')));
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const { tenantSource, openJSON, Locked } = await import(pathToFileURL(path.join(fnDir, 'lib', 'bridge.js')));
const { createHash, randomBytes } = await import('node:crypto');
const KEY = randomBytes(32).toString('base64');
deps.bridgeKey = KEY;
deps.tenantDeps = tenantSource(sql, KEY, async (t) => ({ ...deps, install: { id: t.id, bridged: true }, built: t }));

deps.install = {};
deps.installEnv = { controlUrl: 'https://ctl.test/erp', appUrl: 'https://app.test/', renderUrl: 'https://render.test', renderKey: 'RK' };
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
const route = async (q, body, method = 'POST') => (await installRoute(deps, new Request('https://ctl.test/erp?' + q, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined }))).body;

// a release to build from
await sql`insert into erp_releases (version, files) values ('v-test', ${JSON.stringify({
  'fn/index.ts': 'console.log(1)', 'fn/handlers/a.js': 'export const x = 1;',
  'sql/001_first.sql': 'create table t1 (x int);', 'sql/002_second.sql': 'create table t2 (x int);', 'sql/003_ctl.sql': '-- control-only\ncreate table ctl_secret (x int);',
  'deploy/storage.sql': '-- storage', 'deploy/cron.sql': "select '__FN_URL__', '__CRON_KEY__';" })}::jsonb)`;

// the company's Supabase account
const q = [], secrets = [];
let health = 0, deployed = null, tokenSeen = '';
web.on(/api\.supabase\.com\/v1\/organizations$/, (u, o) => { tokenSeen = o.headers.Authorization; return { status: 200, body: [{ id: 'org1', name: 'Friend Co' }] }; });
web.on(/api\.supabase\.com\/v1\/projects$/, (u, o) => { const b = JSON.parse(o.body); return { status: 201, body: { id: 'newref', name: b.name, region: b.region } }; });
web.on(/api\.supabase\.com\/v1\/projects\/newref$/, () => ({ status: 200, body: { id: 'newref', status: ++health < 2 ? 'COMING_UP' : 'ACTIVE_HEALTHY' } }));
web.on(/api\.supabase\.com\/v1\/projects\/newref\/api-keys/, () => ({ status: 200, body: [{ name: 'anon', api_key: 'ANONKEY' }, { name: 'service_role', api_key: 'SR' }] }));
web.on(/api\.supabase\.com\/v1\/projects\/newref\/database\/query$/, (u, o) => { const s = JSON.parse(o.body).query; q.push(s); return { status: 201, body: /select 1 from public._erp_migrations/.test(s) ? [] : [] }; });
web.on(/api\.supabase\.com\/v1\/projects\/newref\/secrets$/, (u, o) => { secrets.push(...JSON.parse(o.body)); return { status: 201, body: {} }; });
web.on(/api\.supabase\.com\/v1\/projects\/newref\/functions\/deploy\?slug=erp$/, (u, o) => { deployed = o.body; return { status: 201, body: { id: 'f1' } }; });
let newPw = '';
web.on(/api\.supabase\.com\/v1\/projects\/newref\/config\/database\/pooler$/, () => ({ status: 200, body: [{ database_type: 'PRIMARY', db_host: 'pool.test', db_port: 6543 }] }));
web.on(/api\.supabase\.com\/v1\/projects\/newref\/database\/password$/, (u, o) => { newPw = JSON.parse(o.body).password; return { status: 200, body: {} }; });
web.on(/api\.supabase\.com\/v1\/projects\/newref\/config\/auth$/, () => ({ status: 200, body: {} }));
// the new server's last install step runs the copy's own code (here: against this same database)
web.on(/newref\.supabase\.co\/functions\/v1\/erp\?install=finish$/, async (u, o) => {
  const key = secrets.find((s) => s.name === 'ERP_INSTALL_KEY').value;
  const r = await installFinish({ ...deps, install: { id: 'x', key } }, o.headers['x-install-key'], JSON.parse(o.body));
  return { status: r.status, body: r.body };
});

// an invite is needed
let r = await route('install=start', { code: 'nope', company: 'Friend Co', ownerName: 'Ali', ownerEmail: 'ali@friend.test', token: 'sbp_' + 'a'.repeat(40) });
check('no install without a valid invite', !r.ok && /not valid/.test(r.error), r);
r = await mgr('erpInstallInvite', [{ note: 'x' }]);
check('only the platform admin makes install links', !r.ok, r);
r = await owner('erpInstallInvite', [{ note: 'Friend Co' }]);
const code = r.ok && r.result.code;
check('an install link', r.ok && r.result.link === 'https://app.test/#/install/' + code, r);
r = await route('install=start', { code, company: 'Friend Co', ownerName: 'Ali', ownerEmail: 'ali@friend.test', token: 'not-a-token' });
check('a wrong token is refused before anything', !r.ok && /sbp_/.test(r.error), r);
const TOKEN = 'sbp_' + 'b'.repeat(40);
r = await route('install=start', { code, company: 'Friend Co', ownerName: 'Ali', ownerEmail: 'ali@friend.test', token: TOKEN });
check('started with the company\'s own token', r.ok && r.id && r.secret && tokenSeen === 'Bearer ' + TOKEN, r);
const { id, secret } = r;
r = await route('install=start', { code, company: 'Again', ownerName: 'Ali', ownerEmail: 'ali@friend.test', token: TOKEN });
check('the link works once', !r.ok, r);
r = await route('install=step', { id, secret: 'wrong' });
check('the steps need the install\'s own secret', !r.ok, r);

// step by step until done
const seen = [];
for (let i = 0; i < 30; i++) {
  r = await route('install=step', { id, secret });
  if (!r.ok) break;
  seen.push(r.step);
  if (r.done || r.status === 'failed') break;
}
check('every step ran and it is ready', r.ok && r.done && r.status === 'active', [r, seen]);
check('...in Singapore, the project waited for, two database files in order then storage', q.some((s) => /create table t1/.test(s)) && q.findIndex((s) => /t1/.test(s)) < q.findIndex((s) => /t2/.test(s)) && q.some((s) => s === '-- storage') && seen.includes('wait'), seen);
check('no server code and no timers or settings were put into the company\'s project', deployed === null && secrets.length === 0 && !q.some((x) => /__FN_URL__|cron\.schedule/.test(x)), [deployed, secrets]);
check('the provider\'s own control tables stay out of the company\'s database', !q.some((x) => /ctl_secret/.test(x)));
const ten = (await sql`select status, url, anon_key, secret_enc from erp_tenants where id = ${id}`)[0];
const opened = ten && await openJSON(KEY, ten.secret_enc);
check('the bridge: a fresh database password set through Supabase, kept only sealed', ten && ten.status === 'active' && ten.url === 'https://newref.supabase.co' && newPw.length > 20 &&
  !ten.secret_enc.includes(newPw) && opened.dbUrl === 'postgresql://postgres.newref:' + encodeURIComponent(newPw) + '@pool.test:6543/postgres' && opened.service === 'SR', ten);
const biz = (await sql`select b.id from businesses b join memberships m on m.business_id = b.id join auth.users u on u.id = m.user_id where b.name = 'Friend Co' and u.email = 'ali@friend.test' and m.role = 'owner'`)[0];
check('the company\'s business with its owner, who is e-mailed to choose a password', !!biz && deps.mails.includes('ali@friend.test'));
const row = (await sql`select install_key, mgmt_token, key_hash from erp_installs where id = ${id}`)[0];
check('the one-time keys are wiped after use', !row.install_key);
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;   // the finish step made Ali the only admin here

r = await route('install=info&id=' + id, null, 'GET');
check('the page can open it: the provider\'s server for this company, its own sign-in and public key', r.ok && r.api === 'https://ctl.test/erp' && r.tenant === id && r.url === 'https://newref.supabase.co' && r.anon === 'ANONKEY' && r.name === 'Friend Co', r);
r = await owner('erpInstallSet', [{ id, status: 'suspended', reason: 'Unpaid' }]);
let lockSay = ''; try { await deps.tenantDeps(id); } catch (e) { lockSay = e instanceof Locked ? e.message : 'other: ' + e.message; }
check('switched off: the bridged ERP is locked at once, with the reason', /switched off by its provider\. Unpaid/.test(lockSay), lockSay);
await owner('erpInstallSet', [{ id, status: 'active' }]);
let back = null; try { back = await deps.tenantDeps(id); } catch (e) { back = e.message; }
check('...and opens again', back && back.install && back.install.id === id, back);
await sql`update erp_tenants set status = 'disconnected' where id = ${id}`; deps.tenantDeps.forget(id);
lockSay = ''; try { await deps.tenantDeps(id); } catch (e) { lockSay = e.message; }
check('the provider\'s connection removed: the ERP says so and does not open', /lost its connection to the provider/.test(lockSay), lockSay);
await sql`update erp_tenants set status = 'active' where id = ${id}`; deps.tenantDeps.forget(id);

// the copy checks in; the provider switches it off and on
const key = randomBytes(16).toString('hex');   // a copy made before the bridge had its own check-in key
await sql`update erp_installs set key_hash = ${createHash('sha256').update(key).digest('hex')} where id = ${id}`;
const copy = { ...deps, install: { id, key, controlUrl: 'https://ctl.test/erp', version: 'v-test' } };
web.on(/ctl\.test\/erp\?control=beat$/, async (u, o) => ({ status: 200, body: await route('control=beat', JSON.parse(o.body)) }));
r = await heartbeat({ ...copy, install: { ...copy.install, key: 'wrong' } });
check('a wrong check-in key is refused', /refused/.test(r), r);
r = await heartbeat(copy);
check('check-in: active', r === 'active', r);
r = await owner('erpInstalls', []);
const me = r.ok && r.result.installs.find((x) => x.id === id);
check('the provider sees it: version, last check-in, figures', me && me.version === 'v-test' && me.last_seen && me.stats && typeof me.stats.invoices30 === 'number', me);
r = await owner('erpInstallSet', [{ id, status: 'suspended' }]);
check('switching off needs a reason', !r.ok, r);
r = await owner('erpInstallSet', [{ id, status: 'suspended', reason: 'Unpaid' }]);
await heartbeat(copy);
r = await erpCall(copy, { name: 'erpCatalog', args: [], authHeader: 'Bearer owner:' + FIX.U.owner });
check('switched off: the copy opens for nobody, with the reason', !r.ok && /switched off by its provider: Unpaid/.test(r.error), r);
await owner('erpInstallSet', [{ id, status: 'active' }]);
await heartbeat(copy);
r = await erpCall(copy, { name: 'erpCatalog', args: [], authHeader: 'Bearer owner:' + FIX.U.owner });
check('switched on again: it works', r.ok, r.error);
web.on(/ctl\.test\/erp\?control=beat$/, () => { throw new Error('offline'); });
r = await heartbeat(copy);
r = await erpCall(copy, { name: 'erpCatalog', args: [], authHeader: 'Bearer owner:' + FIX.U.owner });
check('the provider unreachable: the copy keeps working', r.ok);

// a copy never installs others; the provider's own system is never switched off by this
r = (await installRoute(copy, new Request('https://newref.supabase.co/functions/v1/erp?install=start', { method: 'POST', body: '{}' }))).status;
check('a copy does not install others', r === 404);
await sql`update erp_control set status = 'active'`; forgetControl();
r = await owner('erpCatalog', []);
check('the provider\'s own system is not affected', r.ok);

// a failed install says why and can carry on
r = await owner('erpInstallInvite', [{}]);
const code2 = r.result.code;
web.on(/api\.supabase\.com\/v1\/projects$/, () => ({ status: 402, body: { message: 'The following organization members have reached their maximum limits for the number of active free projects' } }));
r = await route('install=start', { code: code2, company: 'Second Co', ownerName: 'B', ownerEmail: 'b@x.test', token: TOKEN });
r = await route('install=step', { id: r.id, secret: r.secret });
check('a failed step is said plainly (e.g. the free plan\'s 2 projects)', r.ok && r.status === 'failed' && /maximum limits/.test(r.error), r);
await done();
