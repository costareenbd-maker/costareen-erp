// The bridge (lib/bridge.js): sealing, moving a copy made before the bridge onto it, the health check.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { sql, FIX, owner, mgr, check, done, web, deps, fnDir } from './harness.mjs';
const { sealJSON, openJSON, tenantSource, checkTenant } = await import(pathToFileURL(path.join(fnDir, 'lib', 'bridge.js')));

const KEY = randomBytes(32).toString('base64'), OTHER = randomBytes(32).toString('base64');
deps.installEnv = { controlUrl: 'https://ctl.test/erp', appUrl: 'https://app.test/' };
deps.bridgeKey = KEY;
deps.tenantDeps = tenantSource(sql, KEY, async (t) => ({ ...deps, install: { id: t.id, bridged: true }, built: t }));
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;

// 1. sealing
const sealed = await sealJSON(KEY, { dbUrl: 'postgresql://u:p@h/db', service: 'S' });
check('sealed text hides the secret', !sealed.includes('p@h') && sealed.startsWith('v1.'), sealed);
check('opens with the key', (await openJSON(KEY, sealed)).service === 'S');
let bad = ''; try { await openJSON(OTHER, sealed); } catch (e) { bad = 'refused'; }
check('another key cannot open it', bad === 'refused');

// 2. a copy made before the bridge (its own server in its project) is moved onto it
const id = '00000000-0000-4000-8000-0000000000c1';
await sql`insert into erp_installs (id, company, owner_name, owner_email, status, step, ref, mgmt_token, mgmt_kind, api_url, anon_key, secret_hash, key_hash)
          values (${id}, 'Old Co', 'O', 'o@old.test', 'active', 'done', 'oldref', ${'sbp_' + 'c'.repeat(40)}, 'pat', 'https://oldref.supabase.co/functions/v1/erp', 'ANON', 'x', 'beatkeyhash')`;
const calls = [];
web.on(/api\.supabase\.com\/v1\/projects\/oldref\/api-keys/, () => ({ status: 200, body: [{ name: 'anon', api_key: 'ANON2' }, { name: 'service_role', api_key: 'SR2' }] }));
web.on(/api\.supabase\.com\/v1\/projects\/oldref\/config\/database\/pooler$/, () => ({ status: 200, body: [{ database_type: 'PRIMARY', db_host: 'pool.test', db_port: 6543 }] }));
web.on(/api\.supabase\.com\/v1\/projects\/oldref\/database\/password$/, () => { calls.push('password'); return { status: 200, body: {} }; });
web.on(/api\.supabase\.com\/v1\/projects\/oldref\/database\/query$/, (u, o) => { calls.push('sql:' + JSON.parse(o.body).query); return { status: 201, body: [] }; });
web.on(/api\.supabase\.com\/v1\/projects\/oldref\/functions\/erp$/, (u, o) => { calls.push(o.method + ' function'); return { status: 200, body: {} }; });

let r = await mgr('erpInstallBridge', [{ id }]);
check('only the platform admin moves a copy', !r.ok, r);
r = await owner('erpInstallBridge', [{ id }]);
check('moved: it answers over the bridge, then its timers and server code are removed', r.ok && r.result.businesses >= 1 && r.result.removed.join() === 'timers,server code', r);
check('...the password is set before anything is taken away', calls.indexOf('password') < calls.findIndex((c) => /cron\.unschedule/.test(c)) && calls.includes('DELETE function'), calls);
const row = (await sql`select api_url, key_hash from erp_installs where id = ${id}`)[0];
const ten = (await sql`select status, anon_key from erp_tenants where id = ${id}`)[0];
check('its page now goes to the provider\'s server; the old check-in key is retired', row.api_url === 'https://ctl.test/erp' && row.key_hash === null && ten.status === 'active' && ten.anon_key === 'ANON2', [row, ten]);

// 3. the health check: a working connection stays active, a removed one disconnects (and locks the ERP)
let st = await checkTenant(sql, KEY, id, async () => {});
check('reachable: active', st === 'active', st);
st = await checkTenant(sql, KEY, id, async () => { throw new Error('password authentication failed'); });
const after = (await sql`select status, check_error from erp_tenants where id = ${id}`)[0];
check('unreachable (key removed): disconnected, with why', st === 'disconnected' && after.status === 'disconnected' && /password authentication/.test(after.check_error), after);
deps.tenantDeps.forget(id);
let say = ''; try { await deps.tenantDeps(id); } catch (e) { say = e.message; }
check('...and its ERP does not open', /lost its connection/.test(say), say);
await sql`update erp_tenants set status = 'locked', reason = 'Unpaid' where id = ${id}`;
st = await checkTenant(sql, KEY, id, async () => {});
check('a copy the provider switched off stays off after a check', st === 'locked', st);
await done();
