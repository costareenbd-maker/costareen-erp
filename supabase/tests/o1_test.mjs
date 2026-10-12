// Owner safety: recovery checklist, emergency link, two owners agree (each from their own e-mail link) before one loses access.
import { sql, FIX, owner, mgr, call, check, done, deps } from './harness.mjs';
const B = FIX.B, A = FIX.U.owner;
const asUser = (id, name, args) => call(name, args, { authHeader: 'Bearer owner:' + id });
const tokenFor = (email) => { const m = [...deps.magic].reverse().find((x) => x.email === email); return m ? new URL(m.to).searchParams.get('approve') : ''; };
await sql`update auth.users set email = 'a@own.test' where id = ${A}`;

let r = await owner('erpRecovery', []);
check('checklist: one owner, no 2-step, no emergency link, no Drive', r.ok && !r.result.secondOwner && !r.result.mfa && !r.result.emergency && !r.result.drive && r.result.done === 0, r.result);
r = await mgr('erpRecovery', []);
check('the checklist is the owner\'s', !r.ok, r);
r = await owner('erpEmergencyLink', []);
check('an emergency link, shown once', r.ok && /#k=/.test(r.result.link), r);
const first = (await sql`select count(*)::int n from erp_access_keys where user_id = ${A} and label like 'Emergency%' and revoked_at is null`)[0].n;
await owner('erpEmergencyLink', []);
const after = (await sql`select count(*)::int n from erp_access_keys where user_id = ${A} and label like 'Emergency%' and revoked_at is null`)[0].n;
check('a new one stops the old one', first === 1 && after === 1);

// a second owner
const Bu = (await sql`insert into auth.users (id, email) values (gen_random_uuid(), 'b@own.test') returning id`)[0].id;
await sql`insert into memberships (business_id, user_id, role, active) values (${B}, ${Bu}, 'owner', true)`;
r = await owner('erpRecovery', []);
check('two owners: that one is green', r.ok && r.result.secondOwner && r.result.emergency && r.result.done === 2, r.result);

// A switches B off: nothing changes; both get a link in their own e-mail
r = await owner('erpUserSet', [{ userId: Bu, active: false }]);
check('switching off an owner starts the agreement, nothing changes yet', r.ok && r.result.ownerChange && r.result.ownerChange.pending &&
  (await sql`select active from memberships where business_id = ${B} and user_id = ${Bu}`)[0].active === true, r);
const ta = tokenFor('a@own.test'), tb = tokenFor('b@own.test');
check('a link went to each owner\'s own e-mail', ta && tb && ta !== tb && deps.magic.some((m) => m.email === 'b@own.test' && /\?approve=/.test(m.to)));
r = await owner('erpUserSet', [{ userId: Bu, role: 'manager' }]);
check('only one change at a time for an owner', !r.ok && /already waiting/.test(r.error), r);
r = await owner('erpOwnerChange', [{ token: tb }]);
check('one owner cannot use the other\'s link', !r.ok && /another owner/.test(r.error), r);
r = await owner('erpOwnerChanges', []);
check('the Users screen shows it waiting', r.ok && r.result.waiting.length === 1 && r.result.waiting[0].mine && r.result.waiting[0].what === 'switch off', r.result);
r = await owner('erpOwnerChangeAnswer', [{ token: ta, agree: true }]);
check('the first yes: still waiting', r.ok && r.result.status === 'waiting' && r.result.agreed === 1, r.result);
check('...still an owner', (await sql`select active from memberships where business_id = ${B} and user_id = ${Bu}`)[0].active === true);
r = await asUser(Bu, 'erpOwnerChange', [{ token: tb }]);
check('the other owner sees it is about them', r.ok && r.result.youAreTarget && /switch off/.test(r.result.what), r);
r = await asUser(Bu, 'erpOwnerChangeAnswer', [{ token: tb, agree: false }]);
check('one refuses: nothing changes', r.ok && r.result.status === 'refused' && (await sql`select active from memberships where business_id = ${B} and user_id = ${Bu}`)[0].active === true, r);

// again, and both agree
r = await owner('erpUserSet', [{ userId: Bu, role: 'manager' }]);
const ta2 = tokenFor('a@own.test'), tb2 = tokenFor('b@own.test');
await owner('erpOwnerChangeAnswer', [{ token: ta2, agree: true }]);
r = await asUser(Bu, 'erpOwnerChangeAnswer', [{ token: tb2, agree: true }]);
check('both agree: the change is made', r.ok && r.result.status === 'done' && (await sql`select role::text r from memberships where business_id = ${B} and user_id = ${Bu}`)[0].r === 'manager', r);
r = await owner('erpUserSet', [{ userId: Bu, role: 'sales' }]);
check('a manager (no longer owner) changes at once as before', r.ok && !r.result.ownerChange, r);
r = await owner('erpUserSet', [{ userId: A, active: false }]);
check('nobody switches themselves off', !r.ok, r);
await done();
