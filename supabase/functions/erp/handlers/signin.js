// The sign-in screen, step 1 (public, no sign-in): what does this e-mail need?
//   POST ?signin=check  {email} -> {state: 'password'}  it has a password: show the password box
//                                  {state: 'set', sent} never signed in: the choose-a-password e-mail goes out now
//                                  {state: 'none'}      no active user here with that e-mail
//   POST ?signin=forgot {email} -> {state: 'forgot'}    a new-password e-mail if there is such a user; the same answer either way
// The e-mail link comes back to this ERP's own address (index.ts sendReset).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signinRoute(deps, what, body) {
  const email = String((body && body.email) || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: 'Type your e-mail address.' };
  const sql = deps.sqlAux || deps.sql;
  let u;
  try {
    u = (await sql`select u.id, u.last_sign_in_at from auth.users u where lower(u.email) = ${email}
                   and exists (select 1 from memberships m where m.user_id = u.id and coalesce(m.active, true)) limit 1`)[0];
  } catch (_) { return { ok: false, error: 'Could not check that e-mail now. Try again in a moment.' }; }
  if (what === 'forgot') {
    if (u) { try { await deps.sendReset(email); } catch (_) { /* rate limited: the earlier link still works */ } }
    return { ok: true, state: 'forgot' };
  }
  if (!u) return { ok: true, state: 'none' };
  if (u.last_sign_in_at) return { ok: true, state: 'password' };
  let sent = true;
  try { await deps.sendReset(email); } catch (_) { sent = false; }
  return { ok: true, state: 'set', sent };
}
