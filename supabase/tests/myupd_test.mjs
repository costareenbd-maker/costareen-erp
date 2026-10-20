// myupd-1 (owner 21 Oct 2026: "he can't see the Platform tab - every company should push its own update"): a company
// copy's owner sees their version, saves their own Supabase access token and runs the update from their own Settings.
// The copy is the one the request came through - nothing in the payload can point at another company.
import { sql, deps, owner, mgr, web, check, done } from './harness.mjs';

const ID = crypto.randomUUID(), OTHER = crypto.randomUUID();
await sql`insert into erp_installs (id, company, owner_name, owner_email, status, step, ref, version, mgmt_token, upd_error)
          values (${ID}, 'Proto Shop', 'Proto Owner', 'proto@t.test', 'active', 'done', 'protoref0001', 'v-old', 'sbp_oldoldoldoldoldoldoldold',
                  'Supabase refused the access token (401). Make a new token and start again.'),
                 (${OTHER}, 'Other Shop', 'Other', 'o@t.test', 'active', 'done', 'otherref0001', 'v-old', 'sbp_otherotherotherotherother', null)`;
await sql`insert into erp_tenants (id, url, anon_key, secret_enc) values (${ID}, 'https://protoref0001.supabase.co', 'anon', 'x')`;
await sql`insert into erp_releases (version, files) values ('v-new', ${sql.json({ 'sql/901_a.sql': 'select 1', 'sql/902_b.sql': 'select 2' })})`;

// the provider's own ERP: no card
let r = await owner('erpMyUpdates', []);
check('the provider\'s own ERP: nothing to update here', r.ok && r.result.copy === false, r);

// the request comes through the company's copy
const keep = { install: deps.install, control: deps.control };
deps.install = { id: ID, bridged: true }; deps.control = sql;
r = await owner('erpMyUpdates', []);
check('the owner sees the version, the newest and why the last update stopped', r.ok && r.result.copy && r.result.version === 'v-old' && r.result.latest === 'v-new' &&
  !r.result.upToDate && r.result.tokenProblem, r.result);
r = await mgr('erpMyUpdates', []);
check('a manager does not', !r.ok, r);
r = await mgr('erpMyUpdateToken', [{ token: 'sbp_' + 'a'.repeat(30) }]);
check('...nor saves a token', !r.ok, r);

r = await owner('erpMyUpdateToken', [{ token: 'hello' }]);
check('a token that is not a Supabase one is refused', !r.ok && /sbp_/.test(r.error), r);
web.on(/api\.supabase\.com\/v1\/projects\/protoref0001$/, (url, o) => (/sbp_good/.test(o.headers.Authorization) ? { body: { ref: 'protoref0001' } } : { status: 401, body: { message: 'Invalid access token' } }));
r = await owner('erpMyUpdateToken', [{ token: 'sbp_bad' + 'b'.repeat(30) }]);
check('a token Supabase refuses is not saved', !r.ok && /refused/.test(r.error), r);
r = await owner('erpMyUpdateToken', [{ token: 'sbp_good' + 'g'.repeat(30) }]);
let row = (await sql`select mgmt_token, upd_error from erp_installs where id = ${ID}`)[0];
check('a working token is saved for THIS company and the error is cleared', r.ok && row.mgmt_token.startsWith('sbp_good') && !row.upd_error, row);
const other = (await sql`select mgmt_token from erp_installs where id = ${OTHER}`)[0];
check('...the other company is untouched', other.mgmt_token === 'sbp_otherotherotherotherother', other);

// the update: each database file once, then the copy is on the newest version
const ran = [];
web.on(/api\.supabase\.com\/v1\/projects\/protoref0001\/database\/query$/, (url, o) => {
  const q = JSON.parse(o.body).query; ran.push(q);
  if (/select name from public\._erp_migrations/.test(q)) return { body: ran.filter((x) => /^insert into public\._erp_migrations/.test(x)).map((x) => ({ name: /values \('([^']+)'/.exec(x)[1] })) };
  return { body: [] };
});
r = await owner('erpMyUpdateRun', []);
row = (await sql`select version, upd_step, upd_error from erp_installs where id = ${ID}`)[0];
check('Update now runs both database files and the copy is on the newest version', r.ok && r.result.done && row.version === 'v-new' && !row.upd_step && !row.upd_error &&
  ran.includes('select 1') && ran.includes('select 2'), { r, row, ran });
r = await owner('erpMyUpdates', []);
check('...and says it is up to date', r.ok && r.result.upToDate && !r.result.error, r.result);

deps.install = keep.install; deps.control = keep.control;
await done();
