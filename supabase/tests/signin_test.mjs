// The sign-in screen, step 1 (handlers/signin.js): the e-mail first, then what it needs.
import { sql, FIX, deps, check, done } from './harness.mjs';
import { signinRoute } from '../functions/erp/handlers/signin.js';
const B = FIX.B;
// a member who has signed in before, one who never has, and an address with no account
await sql`update auth.users set email = 'seen@x.test', last_sign_in_at = now() where id = ${FIX.U.owner}`;
await sql`update auth.users set email = 'new@x.test', last_sign_in_at = null where id = ${FIX.U.mgr}`;
deps.mails.length = 0;

let r = await signinRoute(deps, 'check', { email: 'Seen@X.test' });
check('signed in before: the password box', r.ok && r.state === 'password' && deps.mails.length === 0, r);
r = await signinRoute(deps, 'check', { email: 'new@x.test' });
check('never signed in: the choose-a-password e-mail goes out', r.ok && r.state === 'set' && r.sent === true && deps.mails[0] === 'new@x.test', [r, deps.mails]);
r = await signinRoute(deps, 'check', { email: 'nobody@x.test' });
check('no account: says so, sends nothing', r.ok && r.state === 'none' && deps.mails.length === 1, r);
await sql`update memberships set active = false where user_id = ${FIX.U.mgr}`;
r = await signinRoute(deps, 'check', { email: 'new@x.test' });
check('a switched-off user counts as no account', r.ok && r.state === 'none', r);
await sql`update memberships set active = true where user_id = ${FIX.U.mgr}`;
r = await signinRoute(deps, 'forgot', { email: 'seen@x.test' });
const r2 = await signinRoute(deps, 'forgot', { email: 'nobody@x.test' });
check('forgot: the same answer either way, a mail only for a real user', r.ok && r2.ok && r.state === 'forgot' && r2.state === 'forgot' && deps.mails.filter((m) => m === 'seen@x.test').length === 1 && !deps.mails.includes('nobody@x.test'), deps.mails);
r = await signinRoute(deps, 'check', { email: 'not-an-email' });
check('not an e-mail: asked to type one', !r.ok && /e-mail/.test(r.error), r);
const sendFail = { ...deps, async sendReset() { throw new Error('rate'); } };
r = await signinRoute(sendFail, 'check', { email: 'new@x.test' });
check('mail could not go: says so (sent false)', r.ok && r.state === 'set' && r.sent === false, r);
await done();
