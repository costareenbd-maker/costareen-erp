// Platform admin: every business on the system, for the people who run it.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, deps, fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const as = (uid) => (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + uid });

let r = await owner('erpPlatform', []);
check('an owner who is not a platform admin is refused', !r.ok && /does not have permission/.test(r.error), r);
r = await owner('erpHello', []);
check('...and is not told he is one', r.ok && r.result.ok && r.result.platform === false, r);
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test')`;
r = await owner('erpHello', []);
check('a platform admin is told so at sign-in', r.result.platform === true, r.result);
r = await mgr('erpPlatform', []);
check('a manager never is', !r.ok, r);

r = await owner('erpPlatform', []);
const mine = r.ok && r.result.businesses.find((b) => b.id === FIX.B);
check('every business, with owners, users, activity, errors, invoices', r.ok && r.result.businesses.length >= 2 && mine && mine.current && mine.owners.length >= 1 && mine.users >= 3 &&
  typeof mine.errors7 === 'number' && typeof mine.invoices30 === 'number' && Array.isArray(r.result.timers), mine);

// ---------------------------------------------------------------- create
r = await owner('erpPlatformCreate', [{ name: '', ownerName: 'X', ownerEmail: 'x@y.co' }]);
check('a name is needed', !r.ok && /called/.test(r.error), r);
r = await owner('erpPlatformCreate', [{ name: 'Costareen', ownerName: 'X', ownerEmail: 'x@y.co' }]);
check('a name already used is refused', !r.ok && /already exists/.test(r.error), r);
r = await owner('erpPlatformCreate', [{ name: 'Dhaka Prints', ownerName: 'Karim', ownerEmail: 'Karim@DhakaPrints.test' }]);
check('a new business with its owner, who is e-mailed', r.ok && r.result.created.made && r.result.created.mailed && deps.mails.includes('karim@dhakaprints.test'), r.result && r.result.created);
const NB = r.result.created.id;
r = await owner('erpPlatform', []);
check('...in the list with its owner', r.result.businesses.some((b) => b.id === NB && b.name === 'Dhaka Prints' && b.owners.some((o) => o.email === 'karim@dhakaprints.test')), r.result.businesses.map((b) => b.name));
const KARIM = (await sql`select id from auth.users where email = 'karim@dhakaprints.test'`)[0].id;
check('the platform admin has no role in it', (await sql`select count(*)::int n from memberships where business_id = ${NB} and user_id = ${FIX.U.owner}`)[0].n === 0);
r = await as(KARIM)('erpHello', []);
check('its owner signs in as owner of it', r.ok && r.result.ok && r.result.role === 'owner' && r.result.platform === false, r);
r = await as(KARIM)('erpSettingsLists', []);
check('...with its lists seeded', r.ok && r.result.categories.length > 0, r.ok);
r = await as(KARIM)('erpPlatform', []);
check('...and no way into the platform panel', !r.ok, r);
const log = await sql`select who, role, action from erp_activity where business_id = ${NB}`;
check('the creation is in that business\'s own log, named', log.some((l) => l.action === 'erpPlatformCreate' && /^Platform admin: /.test(l.who) && l.role === 'platform'), log);

// ---------------------------------------------------------------- suspend
r = await owner('erpPlatformSuspend', [{ businessId: FIX.B, suspend: true, reason: 'x' }]);
check('the business you work in cannot be suspended from inside it', !r.ok && /lock you out/.test(r.error), r);
r = await owner('erpPlatformSuspend', [{ businessId: NB, suspend: true }]);
check('a reason is needed', !r.ok && /Say why/.test(r.error), r);
r = await owner('erpPlatformSuspend', [{ businessId: NB, suspend: true, reason: 'unpaid' }]);
check('suspended', r.ok && r.result.businesses.find((b) => b.id === NB).suspended && r.result.businesses.find((b) => b.id === NB).suspendedReason === 'unpaid', r.result);
r = await as(KARIM)('erpHello', []);
check('...so nothing opens for its owner, who is told why', r.ok && !r.result.ok && r.result.reason === 'SUSPENDED' && /suspended/.test(r.result.message), r);
r = await as(KARIM)('erpCatalog', []);
check('...not a single call', !r.ok, r);
r = await owner('erpPlatformSuspend', [{ businessId: NB, suspend: false }]);
r = await as(KARIM)('erpHello', []);
check('resumed: open again', r.ok && r.result.ok, r);

// ---------------------------------------------------------------- owner reset, errors
const before = deps.mails.length;
r = await owner('erpPlatformOwnerReset', [{ businessId: NB, userId: FIX.U.owner }]);
check('a reset only for an owner of that business', !r.ok && /not an owner/.test(r.error), r);
r = await owner('erpPlatformOwnerReset', [{ businessId: NB, userId: KARIM }]);
check('the owner is e-mailed a reset link', r.ok && r.result.email === 'karim@dhakaprints.test' && deps.mails.length === before + 1, r);
await sql`insert into erp_errors (business_id, who, role, action, message, build) values (${NB}, 'Karim', 'owner', 'erpCatalog', 'boom', 'test')`;
r = await owner('erpPlatformErrors', [{ businessId: NB }]);
check('the last errors of one business, newest first', r.ok && r.result.errors.some((e) => e.message === 'boom'), r.result);
r = await owner('erpPlatform', []);
check('...and the count in the list', r.result.businesses.find((b) => b.id === NB).errors7 >= 1, r.result.businesses.find((b) => b.id === NB));
const acts = (await sql`select action from erp_activity where business_id = ${NB} order by at`).map((x) => x.action);
check('every platform action is in that business\'s log', ['erpPlatformCreate', 'erpPlatformSuspend', 'erpPlatformResume', 'erpPlatformOwnerReset'].every((a) => acts.includes(a)), acts);
await done();
