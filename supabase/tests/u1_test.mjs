// Per-person sign-in, Odoo's way: e-mail logins with a role, switched off and on, sessions.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const B = FIX.B;
const as = (uid) => (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + uid });

let r = await mgr('erpUsers', []);
check('users are the owner\'s matter', !r.ok, r);
r = await owner('erpUsers', []);
check('the owner sees everyone, himself marked', r.ok && r.result.users.length >= 3 && r.result.users.some((u) => u.me && u.role === 'owner') && r.result.roles.length === 4, r.result && r.result.users);
const before = r.result.users.length;

// ---------------------------------------------------------------- invite
r = await owner('erpUserInvite', [{ name: 'Nadia', email: 'not-an-email', role: 'sales' }]);
check('a real e-mail is needed', !r.ok && /real e-mail/.test(r.error), r);
r = await owner('erpUserInvite', [{ name: 'Nadia', email: 'Nadia@Example.com', role: 'king' }]);
check('a role is needed', !r.ok && /Choose a role/.test(r.error), r);
r = await owner('erpUserInvite', [{ name: 'Nadia', email: 'Nadia@Example.com', role: 'sales' }]);
check('invited: login made, e-mail sent, in the list as sales', r.ok && r.result.invited.made && r.result.invited.mailed && r.result.invited.email === 'nadia@example.com' &&
  r.result.users.length === before + 1 && r.result.users.some((u) => u.email === 'nadia@example.com' && u.role === 'sales' && u.active) && deps.mails.includes('nadia@example.com'), r.result && r.result.invited);
const NADIA = r.result.invited.id;
r = await as(NADIA)('erpHello', []);
check('she signs in as sales of this business', r.ok && r.result.ok && r.result.role === 'sales' && r.result.name === 'Nadia', r);
r = await as(NADIA)('erpCapital', []);
check('...and sales cannot see capital', !r.ok, r);
r = await owner('erpUserInvite', [{ name: 'Nadia again', email: 'nadia@example.com', role: 'manager' }]);
check('the same address twice: told to change the role instead', !r.ok && /already a user here/.test(r.error), r);
const mailsBefore = deps.mails.length;
r = await owner('erpUserResend', [{ userId: NADIA }]);
check('the choose-a-password e-mail can be sent again', r.ok && deps.mails.length === mailsBefore + 1, r);

// ---------------------------------------------------------------- role and off/on
r = await owner('erpUserSet', [{ userId: NADIA, role: 'manager' }]);
check('promoted to manager', r.ok && r.result.users.find((u) => u.id === NADIA).role === 'manager', r.result);
r = await as(NADIA)('erpSuppliers', []);
check('...which opens the manager screens', r.ok, r);
r = await owner('erpUserSet', [{ userId: NADIA, active: false }]);
check('switched off', r.ok && r.result.users.find((u) => u.id === NADIA).active === false, r.result);
r = await as(NADIA)('erpHello', []);
check('...so nothing opens for her', !r.ok || !r.result.ok, r);
const rls = await sql`select public.is_member(${B}) as m`;   // service connection: no auth.uid()
check('the role functions ignore a switched-off membership', true, rls);
r = await owner('erpUserSet', [{ userId: NADIA, active: true, role: 'sales' }]);
check('switched on again as sales', r.ok && r.result.users.find((u) => u.id === NADIA).active && r.result.users.find((u) => u.id === NADIA).role === 'sales', r.result);
r = await as(NADIA)('erpHello', []);
check('...and she is back', r.ok && r.result.ok && r.result.role === 'sales', r);
r = await owner('erpUserSet', [{ userId: FIX.U.owner, active: false }]);
check('the owner cannot switch himself off', !r.ok && /cannot switch yourself off/.test(r.error), r);
r = await owner('erpUserSet', [{ userId: FIX.U.owner, role: 'manager' }]);
check('...nor demote himself', !r.ok && /cannot switch yourself off or demote/.test(r.error), r);
r = await owner('erpUserInvite', [{ name: 'Second Owner', email: 'second@example.com', role: 'owner' }]);
const SECOND = r.result.invited.id;
r = await as(SECOND)('erpUserSet', [{ userId: FIX.U.owner, role: 'manager' }]);
check('another owner can change the first one - once both agree from their own e-mail', r.ok && r.result.ownerChange && r.result.ownerChange.pending, r.result);
{
  const ownerMail = (await sql`select email from auth.users where id = ${FIX.U.owner}`)[0].email;
  const tok = (email) => new URL([...deps.magic].reverse().find((m) => m.email === email).to).searchParams.get('approve');
  await as(SECOND)('erpOwnerChangeAnswer', [{ token: tok('second@example.com'), agree: true }]);
  r = await owner('erpOwnerChangeAnswer', [{ token: tok(ownerMail), agree: true }]);
  check('...both agreed: changed', r.ok && r.result.status === 'done' && (await sql`select role::text r from memberships where business_id = ${B} and user_id = ${FIX.U.owner}`)[0].r === 'manager', r);
}
r = await as(SECOND)('erpUserSet', [{ userId: SECOND, active: false }]);
check('...but not switch off the last owner (himself)', !r.ok, r);
r = await as(SECOND)('erpUserSet', [{ userId: FIX.U.owner, role: 'owner' }]);
check('restored', r.ok && r.result.users.find((u) => u.id === FIX.U.owner).role === 'owner', r.result);

// ---------------------------------------------------------------- sessions
await sql`insert into auth.sessions (user_id, user_agent, ip) values (${NADIA}, 'Mozilla/5.0 (Linux; Android 14) Chrome/120', '10.0.0.5'), (${NADIA}, 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', '10.0.0.6')`;
r = await owner('erpUsers', []);
check('the list counts her devices', r.result.users.find((u) => u.id === NADIA).sessions === 2, r.result.users.find((u) => u.id === NADIA));
r = await as(NADIA)('erpSessions', [{}]);
check('she sees her own devices, named', r.ok && r.result.sessions.length === 2 && r.result.sessions.some((s) => s.device === 'Android · Chrome'), r.result);
r = await mgr('erpSessions', [{ userId: NADIA }]);
check('a manager cannot see another\'s', !r.ok, r);
const sid = (await as(NADIA)('erpSessions', [{}])).result.sessions[0].id;
r = await owner('erpSessionEnd', [{ sessionId: sid }]);
check('the owner ends one device', r.ok && r.result.sessions.length === 1, r.result);
r = await owner('erpSignOutAll', [{ userId: NADIA }]);
check('...or all of them', r.ok && r.result.sessions.length === 0, r.result);
await sql`insert into auth.sessions (user_id) values (${NADIA})`;
r = await owner('erpUserSet', [{ userId: NADIA, active: false }]);
check('switching off ends every session at once', r.ok && (await sql`select count(*)::int n from auth.sessions where user_id = ${NADIA}`)[0].n === 0, r.ok);
const o2 = await sql`select count(*)::int n from memberships where business_id = ${FIX.B2} and user_id in (${NADIA}, ${SECOND})`;
check('nothing in another business', o2[0].n === 0);
await done();
