// The Apps page (handlers/apps.js): the network features as tiles, the provider's switch for every company, an
// owner's menu modes (Settings > Business > Menu: everyone / only owners / off), the public router refusing a page
// that is switched off, and the state erpHello carries.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir, call } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': '198.51.100.' + (++N % 250) } }), R)).body;
const menu = (r, k) => r.result.menu.find((m) => m.key === k);

// 1. the catalogue, as anyone
let r = await sales('erpApps', []);
check('sales staff read the catalogue: 10 public features on, the Only-me one off, no switches for them', r.ok && r.result.apps.length === 11 && r.result.apps.filter((a) => !a.labs).length === 10 && r.result.apps.every((a) => (a.labs ? !a.on : a.on) && !a.hidden) && !r.result.owner && !r.result.admin, r);
check('the public ones carry a link; every tile names its screen (Platform ones only for the admin)', r.ok && r.result.apps.filter((a) => a.url).length === 9 && r.result.apps.filter((a) => a.view).length === 9 && r.result.apps.every((a) => typeof a.where === 'string'), r.result.apps.map((a) => a.key + ':' + a.view + ':' + a.url));
check('the menu list: 14 screens, all for everyone', r.ok && r.result.menu.length === 14 && r.result.menu.every((m) => m.mode === 'all' && !m.off), r.result.menu);

// 2. the owner sets who sees a screen; staff cannot; the other business is untouched
r = await mgr('erpAppSet', [{ key: 'repairs', mode: 'owner', scope: 'mine' }]);
check('a manager cannot change the menu', !r.ok, r);
r = await owner('erpAppSet', [{ key: 'repairs', mode: 'owner', scope: 'mine' }]);
check('the owner keeps Repairs for owners only', r.ok && menu(r, 'repairs').mode === 'owner' && menu(r, 'repairs').hidden === true, r);
r = await owner('erpAppSet', [{ key: 'campaigns', mode: 'off', scope: 'mine' }]);
check('...and switches Campaigns off for this business', r.ok && menu(r, 'campaigns').mode === 'off', r);
r = await owner('erpAppSet', [{ key: 'resell', on: false, scope: 'mine' }]);
check('the old on/off still works: off = only owners', r.ok && menu(r, 'resell').mode === 'owner', r);
r = await owner('erpAppSet', [{ key: 'find', mode: 'off', scope: 'mine' }]);
check('a public page is not in the menu', !r.ok, r);
r = await owner('erpAppSet', [{ key: 'dash', mode: 'off', scope: 'mine' }]);
check('a core screen stays in the menu', !r.ok, r);
r = await owner('erpAppSet', [{ key: 'repairs', mode: 'maybe', scope: 'mine' }]);
check('an unknown mode falls back to everyone', r.ok && menu(r, 'repairs').mode === 'all', r);
r = await owner('erpAppSet', [{ key: 'repairs', mode: 'owner', scope: 'mine' }]);
r = await call('erpHello', [], { authHeader: 'Bearer owner:' + FIX.U.owner });
check('hello carries both lists: only-owners and off', r.ok && r.result.apps && r.result.apps.hidden.includes('repairs') && r.result.apps.hidden.includes('resell') && r.result.apps.gone.includes('campaigns') && r.result.apps.off.every((k) => k === 'push'), r.result.apps);
const other = (await sql`select value from business_config where business_id = ${FIX.B2} and key in ('apps_menu', 'apps_hidden')`);
check('the other business is untouched', other.length === 0, other);
for (const k of ['repairs', 'campaigns', 'resell']) r = await owner('erpAppSet', [{ key: k, mode: 'all', scope: 'mine' }]);
check('...and everything back for everyone', r.ok && r.result.menu.every((m) => m.mode === 'all'), r);

// 2b. an old 'apps_hidden' list (before the modes) still reads as only-owners
await sql`update business_config set value = '["tools"]' where business_id = ${FIX.B} and key = 'apps_hidden'`;
await sql`delete from business_config where business_id = ${FIX.B} and key = 'apps_menu'`;
r = await owner('erpApps', []);
check('the old hidden list reads as only owners', r.ok && menu(r, 'tools').mode === 'owner', menu(r, 'tools'));
r = await owner('erpAppSet', [{ key: 'tools', mode: 'all', scope: 'mine' }]);
check('...and is retired once a mode is set', r.ok && menu(r, 'tools').mode === 'all' && (await sql`select value from business_config where business_id = ${FIX.B} and key = 'apps_hidden'`)[0].value === '[]', r.result.menu);

// 3. the provider switches an app off for everyone
r = await owner('erpAppSet', [{ key: 'ideas', on: false, scope: 'all' }]);
check('not the provider: refused', !r.ok && /provider/.test(r.error), r);
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
r = await get('pub=ideas');
check('before: the ideas page answers', r.ok, r);
r = await owner('erpAppSet', [{ key: 'ideas', on: false, scope: 'all' }]);
check('the provider switches Ideas off', r.ok && r.result.admin && r.result.apps.find((a) => a.key === 'ideas').on === false, r);
r = await get('pub=ideas');
check('the public page now says it is not open', !r.ok && r.off === true && /not open/.test(r.error), r);
r = await sales('erpApps', []);
check('every company sees it off', r.ok && r.result.apps.find((a) => a.key === 'ideas').on === false, r);
r = await call('erpHello', [], { token: { code: '222222', device: 'dev-sales' } });
check('hello carries the off list', r.ok && r.result.apps.off.includes('ideas'), r.result.apps);
r = await owner('erpAppSet', [{ key: 'resell', on: false, scope: 'all' }]);
check('Resell is a menu screen, not an app the provider switches', !r.ok, r);
r = await owner('erpAppSet', [{ key: 'find', on: false, scope: 'all' }]);
r = await get('pub=find&q=pla');
check('Find stock off: its search is refused', !r.ok && r.off === true, r);
r = await owner('erpApps', []);
check('the colour finder follows Find stock (same data)', r.ok && r.result.apps.find((a) => a.key === 'choose').on === false, r);
r = await owner('erpAppSet', [{ key: 'weborders', on: false, scope: 'all' }]);
check('a plain menu screen is not an app the provider switches', !r.ok, r);
r = await owner('erpAppSet', [{ key: 'find', on: true, scope: 'all' }]);
r = await owner('erpAppSet', [{ key: 'ideas', on: true, scope: 'all' }]);
r = await get('pub=ideas');
check('switched back on: the page answers again', r.ok, r);
r = await owner('erpAppSet', [{ key: 'nothing', on: true, scope: 'all' }]);
check('an unknown app is refused', !r.ok, r);
const log = await sql`select action from erp_activity where business_id = ${FIX.B} and action = 'erpAppSet'`;
check('the switch is in the activity log', log.length >= 3, log.length);

// 4. the share card and Feedback
r = await sales('erpAppQr', [{ key: 'find' }]);
check('the QR of a public page', r.ok && /\/find$/.test(r.result.url) && /^data:image\/svg\+xml;base64,/.test(r.result.qr), r);
r = await sales('erpAppQr', [{ key: 'feedback' }]);
check('no QR for an app without a public page', !r.ok, r);
r = await sales('erpFeedbackSend', [{ kind: 'complaint', text: 'The invoice PDF opens blank on my phone.', screen: 'Sales', contact: '01712345678' }]);
check('sales staff send a complaint', r.ok && r.result.id > 0 && r.result.mine.length === 1 && r.result.mine[0].kind === 'complaint' && r.result.mine[0].status === 'new', r);
r = await sales('erpFeedbackSend', [{ kind: 'praise', text: 'Hi' }]);
check('too short: refused', !r.ok, r);
r = await mgr('erpFeedback', []);
check('the company sees its own reports, no inbox', r.ok && !r.result.admin && r.result.mine.length === 1 && r.result.inbox.length === 0, r);
const fid = (await mgr('erpFeedback', [])).result.mine[0].id;
r = await mgr('erpFeedbackSet', [{ id: fid, status: 'fixed' }]);
check('a manager cannot answer feedback', !r.ok, r);
r = await owner('erpFeedback', []);
check('the provider: the inbox with company, who and contact', r.ok && r.result.admin && r.result.inbox.length === 1 && r.result.inbox[0].company && r.result.inbox[0].contact === '01712345678' && r.result.counts.new === 1, r);
r = await owner('erpFeedbackSet', [{ id: fid, status: 'fixed', reply: 'Fixed in the next build - thank you.' }]);
check('the provider answers', r.ok && r.result.inbox[0].status === 'fixed' && /thank you/.test(r.result.inbox[0].reply) && r.result.counts.fixed === 1, r);
r = await sales('erpFeedback', []);
check('the sender sees the answer', r.ok && r.result.mine[0].status === 'fixed' && /thank you/.test(r.result.mine[0].reply), r);
r = await owner('erpFeedbackSet', [{ id: 999999, status: 'fixed' }]);
check('an unknown report is refused', !r.ok, r);
await done();
