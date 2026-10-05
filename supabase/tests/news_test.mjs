// Stage 1c: announcements to every company, "Check now" and the usage figures read over the bridge.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { sql, FIX, owner, mgr, check, done, deps, fnDir } from './harness.mjs';
const { installRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'installer.js')));
const { checkTenant, saveTenant } = await import(pathToFileURL(path.join(fnDir, 'lib', 'bridge.js')));
const { copyStats } = await import(pathToFileURL(path.join(fnDir, 'lib', 'control.js')));

deps.installEnv = { controlUrl: 'https://ctl.test/erp' };
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
const pub = async (q) => (await installRoute(deps, new Request('https://ctl.test/erp?' + q))).body;

// 1. announcements
let r = await mgr('erpNewsAdd', [{ text: 'x' }]);
check('only the platform admin posts', !r.ok, r);
r = await owner('erpNewsAdd', [{ text: '' }]);
check('an empty message is refused', !r.ok, r);
r = await owner('erpNewsAdd', [{ text: 'The market opens on Monday.', level: 'info', days: 7 }]);
r = await owner('erpNewsAdd', [{ text: 'Short maintenance tonight 11 pm.', level: 'warn', days: 0 }]);
check('posted (with an end date, or until ended)', r.ok && r.result.items.length === 2 && r.result.items.every((n) => n.live), r);
let p = await pub('install=news');
check('every company reads the live ones (no sign-in needed)', p.ok && p.items.length === 2 && p.items.some((n) => n.level === 'warn'), p);
const first = r.result.items.find((n) => /market/.test(n.text));
r = await owner('erpNewsEnd', [{ id: first.id }]);
p = await pub('install=news');
check('an ended one is no longer shown', p.items.length === 1 && !/market/.test(p.items[0].text), p);
await sql`update erp_news set until = now() - interval '1 minute' where ended_at is null`;
p = await pub('install=news');
check('nor one past its date', p.items.length === 0, p);

// 2. "Check now" and the figures the check reads
const KEY = randomBytes(32).toString('base64');
const id = '00000000-0000-4000-8000-0000000000d1';
await sql`insert into erp_installs (id, company, owner_name, owner_email, status, step, ref, secret_hash) values (${id}, 'Health Co', 'H', 'h@h.test', 'active', 'done', 'href', 'x')`;
await saveTenant(sql, KEY, id, { url: 'https://href.supabase.co', anon: 'A', service: 'S', dbUrl: 'postgresql://x' });
deps.checkTenantNow = (tid) => checkTenant(sql, KEY, tid, async () => copyStats(sql));
r = await mgr('erpInstallHealth', [{ id }]);
check('only the platform admin checks', !r.ok, r);
r = await owner('erpInstallHealth', [{ id }]);
const row = (await sql`select stats, last_seen from erp_installs where id = ${id}`)[0];
if (typeof row.stats === 'string') row.stats = JSON.parse(row.stats);
check('checked: connected, and its figures kept for the list', r.ok && r.result.status === 'active' && row.stats && typeof row.stats.invoices30 === 'number' && row.stats.users >= 1 && row.last_seen, [r, row]);
r = await owner('erpInstalls', []);
const me = r.ok && r.result.installs.find((x) => x.id === id);
check('the list shows the connection and when it was checked', me && me.bridge === 'active' && me.checked_at, me);
deps.checkTenantNow = (tid) => checkTenant(sql, KEY, tid, async () => { throw new Error('password authentication failed'); });
r = await owner('erpInstallHealth', [{ id }]);
r = await owner('erpInstalls', []);
const me2 = r.result.installs.find((x) => x.id === id);
check('a lost connection shows, with why', me2.bridge === 'disconnected' && /password/.test(me2.check_error), me2);
r = await owner('erpInstallHealth', [{ id: '00000000-0000-4000-8000-0000000000ff' }]);
check('a company not on the provider\'s server: said plainly', !r.ok && /not on the provider/.test(r.error), r);
await done();
