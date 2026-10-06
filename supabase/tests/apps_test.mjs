// The Apps page (handlers/apps.js): the catalogue, the provider's switch for every company, an owner's switch for
// his own menu, the public router refusing a page that is switched off, and the state erpHello carries.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir, call } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': '198.51.100.' + (++N % 250) } }), R)).body;

// 1. the catalogue, as anyone
let r = await sales('erpApps', []);
check('sales staff read the catalogue: every app on, nothing hidden, no switches for them', r.ok && r.result.apps.length > 20 && r.result.apps.every((a) => a.on && !a.hidden) && !r.result.owner && !r.result.admin, r);
check('public pages carry a link; screens do not', r.ok && r.result.apps.filter((a) => a.kind === 'page').every((a) => /\/(find|choose|check|my|doctor|print|quote|design|ideas)$/.test(a.url)) && r.result.apps.filter((a) => a.kind === 'screen').every((a) => a.url === ''), r.result.apps.map((a) => a.url));
check('every app says where its settings are, or nothing', r.ok && r.result.apps.every((a) => typeof a.where === 'string'), r);

// 2. an owner hides an app in his own menu - the other business does not see that
r = await mgr('erpAppSet', [{ key: 'repairs', on: false, scope: 'mine' }]);
check('a manager cannot change the menu', !r.ok, r);
r = await owner('erpAppSet', [{ key: 'repairs', on: false, scope: 'mine' }]);
check('the owner hides Repairs', r.ok && r.result.apps.find((a) => a.key === 'repairs').hidden === true, r);
r = await owner('erpAppSet', [{ key: 'find', on: false, scope: 'mine' }]);
check('a public page cannot be hidden from a menu (it is not in one)', !r.ok, r);
r = await owner('erpAppSet', [{ key: 'dash', on: false, scope: 'mine' }]);
check('a core screen is not an app', !r.ok, r);
r = await call('erpHello', [], { authHeader: 'Bearer owner:' + FIX.U.owner });
check('hello carries the hidden list', r.ok && r.result.apps && r.result.apps.hidden.includes('repairs') && r.result.apps.off.length === 0, r.result.apps);
const other = (await sql`select value from business_config where business_id = ${FIX.B2} and key = 'apps_hidden'`)[0];
check('the other business is untouched', !other, other);
r = await owner('erpAppSet', [{ key: 'repairs', on: true, scope: 'mine' }]);
check('...and shows it again', r.ok && r.result.apps.find((a) => a.key === 'repairs').hidden === false, r);

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
r = await owner('erpAppSet', [{ key: 'find', on: false, scope: 'all' }]);
r = await get('pub=find&q=pla');
check('Find stock off: its search is refused', !r.ok && r.off === true, r);
r = await owner('erpApps', []);
check('the colour finder follows Find stock (same data)', r.ok && r.result.apps.find((a) => a.key === 'choose').on === false, r);
r = await owner('erpAppSet', [{ key: 'find', on: true, scope: 'all' }]);
r = await owner('erpAppSet', [{ key: 'ideas', on: true, scope: 'all' }]);
r = await get('pub=ideas');
check('switched back on: the page answers again', r.ok, r);
r = await owner('erpAppSet', [{ key: 'nothing', on: true, scope: 'all' }]);
check('an unknown app is refused', !r.ok, r);
const log = await sql`select action from erp_activity where business_id = ${FIX.B} and action = 'erpAppSet'`;
check('the switch is in the activity log', log.length >= 3, log.length);
await done();
