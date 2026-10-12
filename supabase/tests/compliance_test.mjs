// Stage 1d: the provider's disclosed, logged, read-only compliance view; the company's view of the provider key.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { sql, FIX, owner, mgr, check, done, deps, fnDir } from './harness.mjs';
const { tenantSource, saveTenant } = await import(pathToFileURL(path.join(fnDir, 'lib', 'bridge.js')));

const KEY = randomBytes(32).toString('base64');
const id = '00000000-0000-4000-8000-0000000000e1';
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
await sql`insert into erp_installs (id, company, owner_name, owner_email, status, step, ref, secret_hash) values (${id}, 'Checked Co', 'C', 'c@c.test', 'active', 'done', 'cref', 'x')`;
await saveTenant(sql, KEY, id, { url: 'https://cref.supabase.co', anon: 'A', service: 'S', dbUrl: 'postgresql://x' });
deps.tenantDeps = tenantSource(sql, KEY, async (t) => ({ ...deps, sql, install: { id: t.id, bridged: true } }));   // the company's database = this test database
const view = (fn, p) => fn('erpComplianceView', [{ id, ...p }]);

// 1. refusals
let r = await view(mgr, { what: 'stock', reason: 'Police request number 1' });
check('only the platform admin', !r.ok, r);
r = await view(owner, { what: 'stock', reason: 'short' });
check('a reason is required (10+ characters)', !r.ok && /reason/.test(r.error), r);
r = await view(owner, { what: 'customers', reason: 'Police request number 1' });
check('only stock, invoices, payments or money', !r.ok, r);
r = await owner('erpComplianceView', [{ id: '00000000-0000-4000-8000-0000000000ff', what: 'stock', reason: 'Police request number 1' }]);
check('a company not on the provider\'s server', !r.ok && /not on the provider/.test(r.error), r);

// 2. the views (read only) - and each is logged where the company reads it
const before = (await sql`select count(*)::int n from erp_activity where action = 'compliance-view'`)[0].n;
r = await view(owner, { what: 'stock', reason: 'Police request no. 123 about stolen printers' });
check('stock: every product with its stock and prices', r.ok && r.result.columns.includes('In stock') && r.result.rows.some((x) => x[1] === 'FIL-SUN-PLA-BLA-001'), r.ok ? r.result.rows.length : r);
const logs = await sql`select business_id, who, detail from erp_activity where action = 'compliance-view' order by id desc`;
check('written into the company\'s own activity log, with the reason, for each of its businesses', logs.length - before === (await sql`select count(*)::int n from businesses`)[0].n &&
  logs[0].who === 'Provider (compliance check)' && /stolen printers/.test(logs[0].detail), logs.slice(0, 2));
r = await view(owner, { what: 'invoices', reason: 'Tax office letter about sales', from: '2020-01-01', to: '2099-12-31' });
check('invoices in the period', r.ok && r.result.columns[1] === 'Invoice' && r.result.rows.length > 0, r.ok ? r.result.rows.length : r);
r = await view(owner, { what: 'payments', reason: 'Tax office letter about sales', from: '2020-01-01', to: '2099-12-31' });
check('payments', r.ok && r.result.label === 'Payments', r);
r = await view(owner, { what: 'money', reason: 'Bank asked about large transfers', from: '2020-01-01', to: '2099-12-31' });
check('money movements: payments in, expenses out, transfers, in one list', r.ok && r.result.label === 'Money movements' && r.result.rows.every((x) => ['Payment in', 'Expense out', 'Transfer', 'Correction'].includes(x[2])), r.ok ? r.result.rows.slice(0, 3) : r);
const plog = await sql`select what, reason, rows from erp_compliance_log order by id desc`;
check('the provider\'s own list keeps every check', plog.length === 4 && plog[3].what === 'stock' && plog[0].what === 'money', plog);
r = await owner('erpComplianceLog', []);
check('...and shows it', r.ok && r.result.items.length === 4 && r.result.items[0].company === 'Checked Co', r);
const tx0 = (await sql`select count(*)::int n from products`)[0].n;
check('nothing changed in the company\'s data', tx0 > 0);

// 3. a switched-off company can still be checked
await sql`update erp_tenants set status = 'locked', reason = 'Unpaid' where id = ${id}`; deps.tenantDeps.forget(id);
r = await view(owner, { what: 'stock', reason: 'Check while switched off for police' });
check('a switched-off company can still be checked (read only)', r.ok, r.error);
let lockedSay = ''; try { await deps.tenantDeps(id); } catch (e) { lockedSay = e.message; }
check('...while its own ERP stays locked', /switched off/.test(lockedSay), lockedSay);
await sql`update erp_tenants set status = 'active', reason = null where id = ${id}`; deps.tenantDeps.forget(id);

// 4. the company's Security page: the provider key, the logins, the checks
r = await owner('erpProviderKey', []);
check('the provider\'s own business (not on the bridge) shows nothing', r.ok && r.result.bridged === false, r);
deps.install = { id, bridged: true }; deps.providerFingerprint = 'ABCD-1234-EF56-7890';
await sql`create role sneaky_login login password 'x'`;
r = await owner('erpProviderKey', []);
check('on the bridge: verified, with its fingerprint and what it is for', r.ok && r.result.bridged && r.result.verified && r.result.fingerprint === 'ABCD-1234-EF56-7890' && r.result.uses.length === 3, r);
check('an unknown database login is flagged', r.result.logins.some((l) => l.name === 'sneaky_login' && !l.known) && r.result.unknown >= 1, r.result.logins);
check('every provider check is listed for the owner, with its reason', r.result.checks.length >= 5 && r.result.checks.some((c) => /stolen printers/.test(c.detail)), r.result.checks.length);
r = await mgr('erpProviderKey', []);
check('only the owner sees it', !r.ok, r);
await sql`drop role sneaky_login`;
await done();
