// installer-2: updating a company's copy to the newest release; its own web address; a new token.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, web, deps, fnDir } from './harness.mjs';
const { installRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'installer.js')));
deps.install = {};
deps.installEnv = { controlUrl: 'https://ctl.test/erp', appUrl: 'https://app.test/' };
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
const route = async (q) => (await installRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET' }))).body;

const T1 = 'sbp_' + 'a'.repeat(40);
const id = (await sql`insert into erp_installs (company, owner_name, owner_email, status, step, ref, api_url, anon_key, version, mgmt_token)
                      values ('Friend Co', 'Ali', 'ali@x.test', 'active', 'done', 'cref', 'https://cref.supabase.co/functions/v1/erp', 'ANON', 'v1', ${T1}) returning id`)[0].id;
await sql`insert into erp_releases (version, files, made_at) values ('v2', ${JSON.stringify({
  'fn/index.ts': 'new server', 'sql/001_a.sql': 'A', 'sql/002_b.sql': 'B', 'sql/003_c.sql': 'create table c (x int);', 'deploy/cron.sql': "select '__FN_URL__', '__CRON_KEY__';" })}::jsonb, now())`;

const q = [], secrets = [];
let deployed = null, auth = '';
const had = new Set(['001_a.sql', '002_b.sql']);
const dbFake = (u, o) => {
  auth = o.headers.Authorization; const s = JSON.parse(o.body).query; q.push(s);
  const m = /insert into public._erp_migrations \(name\) values \('([^']+)'\)/.exec(s); if (m) had.add(m[1]);
  return { status: 201, body: /select name from public._erp_migrations/.test(s) ? [...had].map((name) => ({ name })) : [] };
};
web.on(/api\.supabase\.com\/v1\/projects\/cref\/database\/query$/, dbFake);
web.on(/api\.supabase\.com\/v1\/projects\/cref\/functions\/deploy\?slug=erp$/, (u, o) => { deployed = o.body; return { status: 201, body: {} }; });
web.on(/api\.supabase\.com\/v1\/projects\/cref\/secrets$/, (u, o) => { secrets.push(...JSON.parse(o.body)); return { status: 201, body: {} }; });

let r = await mgr('erpInstallUpdate', [{ id }]);
check('only the platform admin updates', !r.ok, r);
r = await owner('erpInstalls', []);
check('the list shows it behind the release', r.ok && r.result.release.version === 'v2' && r.result.installs[0].version === 'v1', r.result && r.result.release);
const seen = [];
for (let i = 0; i < 10; i++) { r = await owner('erpInstallUpdate', [{ id }]); if (!r.ok) break; seen.push(r.result.step); if (r.result.done || r.result.error) break; }
check('updated step by step to v2', r.ok && r.result.done && r.result.version === 'v2', [r, seen]);
check('only the database file it had not had', q.filter((s) => /create table c/.test(s)).length === 1 && !q.includes('A') && !q.includes('B') && q.some((s) => /insert into public._erp_migrations .*003_c\.sql/.test(s)), q);
check('the new server went up', deployed && deployed.getAll('file').map((f) => f.name).join() === 'index.ts');
const cron = (secrets.find((s) => s.name === 'CRON_KEY') || {}).value;
check('timers renewed with a fresh key, the copy told its version', cron && secrets.some((s) => s.name === 'ERP_RELEASE' && s.value === 'v2') && q.some((s) => s.includes(cron) && s.includes('https://cref.supabase.co/functions/v1/erp')), secrets);
check('with the company\'s own token', auth === 'Bearer ' + T1);
r = await owner('erpInstallUpdate', [{ id }]);
check('already on the newest: nothing is done', r.ok && r.result.already, r.result);

// a refused token stops the update and says so; a new token carries on
await sql`insert into erp_releases (version, files, made_at) values ('v3', ${JSON.stringify({ 'fn/index.ts': 'v3', 'sql/004_d.sql': 'D', 'deploy/cron.sql': '' })}::jsonb, now() + interval '1 second')`;
web.on(/api\.supabase\.com\/v1\/projects\/cref\/database\/query$/, () => ({ status: 401, body: { message: 'Unauthorized' } }));
r = await owner('erpInstallUpdate', [{ id }]);
check('a refused token: update stops with the reason', r.ok && /refused the access token/.test(r.result.error), r.result);
r = await owner('erpInstalls', []);
check('...and the list shows it', /refused/.test(r.result.installs.find((x) => x.id === id).upd_error));
r = await owner('erpInstallToken', [{ id, token: 'nope' }]);
check('a wrong token is refused', !r.ok, r);
web.on(/api\.supabase\.com\/v1\/projects\/cref$/, () => ({ status: 200, body: { id: 'cref' } }));
web.on(/api\.supabase\.com\/v1\/projects\/cref\/database\/query$/, dbFake);
r = await owner('erpInstallToken', [{ id, token: 'sbp_' + 'n'.repeat(40) }]);
check('a new token that reaches the project is kept', r.ok, r);
for (let i = 0; i < 10; i++) { r = await owner('erpInstallUpdate', [{ id }]); if (!r.ok || r.result.done || r.result.error) break; }
check('...and the update carries on to v3', r.ok && r.result.done && r.result.version === 'v3' && q.includes('D'), r.result);

// the timer: every copy follows the newest release by itself, no button
const { updateAll } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'installer.js')));
await sql`insert into erp_releases (version, files, made_at) values ('v4', ${JSON.stringify({ 'fn/index.ts': 'v4', 'sql/005_e.sql': 'E', 'deploy/cron.sql': '' })}::jsonb, now() + interval '2 seconds')`;
let up = await updateAll(deps);
check('the hourly timer brings the copy to v4 by itself', up.done.length === 1 && /Friend Co -> v4/.test(up.done[0]) && q.includes('E') &&
  (await sql`select version from erp_installs where id = ${id}`)[0].version === 'v4', up);
up = await updateAll(deps);
check('nothing to do when every copy is on the newest', up.done.length === 0 && up.busy.length === 0 && up.errors.length === 0, up);
await sql`update erp_installs set upd_error = 'Supabase refused the access token', version = 'v1' where id = ${id}`;
up = await updateAll(deps);
check('a copy stopped by an error is left for a person (Platform), not retried blindly', up.done.length === 0 && up.errors.length === 1 && /refused/.test(up.errors[0]), up);
await sql`update erp_installs set upd_error = null, version = 'v4' where id = ${id}`;

// its own web address
r = await owner('erpInstallDomain', [{ id, domain: 'https://ERP.Friend.test/' }]);
check('a web address is saved cleaned, with the CNAME to point it at', r.ok && r.result.domain === 'erp.friend.test' && r.result.cname === 'costareen-erp.pages.dev', r);
r = await owner('erpInstallDomain', [{ id, domain: 'erp.costareen.com' }]);
check('the provider\'s own address cannot be taken', !r.ok, r);
const id2 = (await sql`insert into erp_installs (company, owner_name, owner_email, status, ref, api_url, anon_key) values ('Other', 'O', 'o@x.test', 'active', 'oref', 'https://oref.supabase.co/functions/v1/erp', 'A2') returning id`)[0].id;
r = await owner('erpInstallDomain', [{ id: id2, domain: 'erp.friend.test' }]);
check('two copies cannot share an address', !r.ok, r);
r = await route('install=host&h=erp.friend.test');
check('the page opened on that address finds its copy', r.ok && r.id === id && r.api === 'https://cref.supabase.co/functions/v1/erp' && r.name === 'Friend Co', r);
r = await route('install=host&h=nothing.test');
check('an unknown address finds nothing', !r.ok, r);
await sql`update erp_installs set status = 'suspended', reason = 'x' where id = ${id}`;
r = await route('install=host&h=erp.friend.test');
check('a switched-off copy still opens (its sign-in page says why)', r.ok, r);
await done();
