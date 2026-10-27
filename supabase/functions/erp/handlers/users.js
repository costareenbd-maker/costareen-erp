// Users of a business: e-mail logins with a role (Odoo's way). 042_users.sql.
//
//   erpUsers()                              everyone in this business, with role, last sign-in, sessions
//   erpUserInvite({name, email, role})      a login is made (or an existing one found) and an e-mail
//                                           sent to choose a password; the person joins with that role
//   erpUserSet({userId, role, active})      change the role, switch off / on
//   erpUserResend({userId})                 send the choose-a-password e-mail again
//   erpUserPowers({userId, powers})         switch single abilities on / off, own discount limit (058)
//   erpSessions({userId})                   the devices signed in as that person
//   erpSessionEnd({sessionId})              end one; erpSignOutAll({userId}) ends them all
//
// All of it is owner-only except erpSessions / erpSessionEnd on one's own account.
// Sessions live in auth.sessions, which the business connection cannot see, so
// those reads go through the server-only connection (ctx.sql) and are always
// limited to members of this business.

import { formatDate } from '../lib/time.js';
import { ERP_ROLES, ERP_POWERS, ERP_DISCOUNT_CAP, normRole, roleAtLeast, powerOn, discountCapOf } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
const when = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy, h:mm a') : '');
const isId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function needOwner(ctx) { if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder manages users.'); }

async function member(ctx, userId) {
  if (!isId(userId)) throw new Error('Which user?');
  const r = (await ctx.tx`select user_id, role, active from memberships where business_id = ${ctx.biz} and user_id = ${userId}`)[0];
  if (!r) throw new Error('That person is not in this business.');
  return r;
}

export async function erpUsers(ctx) {
  needOwner(ctx);
  const rows = await ctx.tx`select m.user_id, m.role, m.active, m.added_at, m.powers, p.full_name, p.email
                            from memberships m left join profiles p on p.id = m.user_id
                            where m.business_id = ${ctx.biz} order by m.active desc, m.role, p.full_name`;
  const ids = rows.map((r) => r.user_id);
  let auth = {}, sess = {}, mfa = {};
  if (ids.length) {
    for (const u of await ctx.sql`select id, email, last_sign_in_at from auth.users where id = any(${ids})`) auth[u.id] = u;
    for (const s of await ctx.sql`select user_id, count(*)::int n from auth.sessions where user_id = any(${ids}) group by user_id`) sess[s.user_id] = s.n;
    try { for (const f of await ctx.sql`select user_id, count(*)::int n from auth.mfa_factors where user_id = any(${ids}) and status = 'verified' group by user_id`) mfa[f.user_id] = f.n; } catch (_) { mfa = {}; }
  }
  const people = await ctx.tx`select user_id, name, code, status from erp_people where home_business = ${ctx.biz}`;
  const codes = {}; people.forEach((p) => { codes[p.user_id] = p; });
  return {
    users: rows.map((r) => {
      const a = auth[r.user_id] || {}, email = str(r.email) || str(a.email), code = codes[r.user_id];
      return { id: r.user_id, name: str(r.full_name) || (code ? str(code.name) : '') || email.split('@')[0], email: /@(people|link)\.erp\.invalid$/.test(email) ? '' : email,
               role: normRole(r.role), roleLabel: (ERP_ROLES[normRole(r.role)] || {}).label || r.role, active: !!r.active, me: r.user_id === ctx.s.userId,
               lastSignIn: when(a.last_sign_in_at), sessions: sess[r.user_id] || 0, mfa: (mfa[r.user_id] || 0) > 0, added: when(r.added_at),
               codeLogin: !!code && !/@(people|link)\.erp\.invalid$/.test(email) === false && !!code,
               powers: abilitiesOf(r) };
    }),
    roles: Object.keys(ERP_ROLES).map((k) => ({ id: k, label: ERP_ROLES[k].label })),
    abilities: ERP_POWERS.map((p) => ({ id: p.id, label: p.label, help: p.help, min: p.min })),
    discountCaps: ERP_DISCOUNT_CAP,
  };
}

/** One person's abilities: each on/off, whether the owner set it or the role gives it, and the discount limit. */
function abilitiesOf(r) {
  const role = normRole(r.role), set = (r.powers && typeof r.powers === 'object') ? r.powers : {};
  const s = { role, powers: set };
  const out = { list: {}, discount: discountCapOf(role, set), discountSet: set.discount !== undefined && set.discount !== null };
  ERP_POWERS.forEach((p) => {
    out.list[p.id] = { on: powerOn(s, p.id), byRole: roleAtLeast(role, p.min), set: set[p.id] === true || set[p.id] === false };
  });
  return out;
}

export async function erpUserPowers(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const m = await member(ctx, payload.userId);
  if (normRole(m.role) === 'owner') throw new Error('An owner always has every ability.');
  const want = (payload.powers && typeof payload.powers === 'object') ? payload.powers : {};
  const cur = (await ctx.tx`select powers from memberships where business_id = ${ctx.biz} and user_id = ${m.user_id}`)[0];
  const next = { ...((cur && cur.powers) || {}) };
  for (const [k, v] of Object.entries(want)) {
    if (k === 'discount') {
      if (v === null || v === '') { delete next.discount; continue; }
      const d = Number(v);
      if (!isFinite(d) || d < 0 || d > 100) throw new Error('A discount limit is a number from 0 to 100.');
      next.discount = Math.round(d * 10) / 10;
      continue;
    }
    if (!ERP_POWERS.some((p) => p.id === k)) throw new Error('Unknown ability: ' + k);
    // the same as the role gives = no switch at all, so a later role change carries the right default
    const byRole = roleAtLeast(m.role, ERP_POWERS.find((p) => p.id === k).min);
    if (v === null || v === byRole) delete next[k];
    else if (v === true || v === false) next[k] = v;
    else throw new Error('Switch ' + k + ' on or off.');
  }
  await ctx.tx`update memberships set powers = ${ctx.tx.json(next)} where business_id = ${ctx.biz} and user_id = ${m.user_id}`;
  return erpUsers(ctx);
}

export async function erpUserInvite(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const name = str(payload.name).slice(0, 80), email = str(payload.email).toLowerCase(), role = normRole(payload.role);
  if (!name) throw new Error('Whose login is it? Type the name.');
  if (!EMAIL.test(email)) throw new Error('Type a real e-mail address - the invitation goes there.');
  if (!ERP_ROLES[role]) throw new Error('Choose a role.');
  if (role === 'owner' && ctx.s.role !== 'owner') throw new Error('Only an owner makes another owner.');   // a shareholder manages everyone but the owners
  if (!ctx.deps || !ctx.deps.createOwner) throw new Error('Creating a login is not available here.');
  const have = await ctx.sql`select id from auth.users where lower(email) = ${email} limit 1`;
  let userId = have[0] ? have[0].id : '';
  let made = false;
  if (!userId) { userId = await ctx.deps.createOwner(email, name); made = true; }
  else {
    const dup = await ctx.tx`select active from memberships where business_id = ${ctx.biz} and user_id = ${userId}`;
    if (dup[0] && dup[0].active) throw new Error(email + ' is already a user here. Change their role in the list instead.');
  }
  await ctx.sql`insert into profiles (id, email, full_name) values (${userId}, ${email}, ${name})
                on conflict (id) do update set full_name = case when coalesce(profiles.full_name, '') = '' then excluded.full_name else profiles.full_name end,
                                                email = coalesce(nullif(profiles.email, ''), excluded.email)`;
  await ctx.tx`select erp_add_member(${ctx.biz}, ${userId}, ${role}::member_role)`;
  let mailed = false;
  try { await ctx.deps.sendReset(email); mailed = true; } catch (_) { mailed = false; }
  return { ...(await erpUsers(ctx)), invited: { id: userId, name, email, role, made, mailed } };
}

export async function erpUserSet(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const m = await member(ctx, payload.userId);
  const role = payload.role === undefined ? normRole(m.role) : normRole(payload.role);
  if (!ERP_ROLES[role]) throw new Error('Choose a role.');
  if (ctx.s.role !== 'owner' && (role === 'owner' || normRole(m.role) === 'owner')) throw new Error('Only an owner changes an owner, or makes one.');
  const active = payload.active === undefined ? !!m.active : !!payload.active;
  // taking access from another owner: both owners must agree, each from their own e-mail (owners.js)
  if (normRole(m.role) === 'owner' && m.active && m.user_id !== ctx.s.userId && (role !== 'owner' || !active)) {
    const { ownerChangeStart } = await import('./owners.js');
    return { ...(await erpUsers(ctx)), ownerChange: await ownerChangeStart(ctx, m, role, active) };
  }
  await ctx.tx`select erp_set_member(${ctx.biz}, ${m.user_id}, ${role}::member_role, ${active})`;
  if (!active) await ctx.sql`delete from auth.sessions where user_id = ${m.user_id}`;      // switched off: out everywhere, now
  return erpUsers(ctx);
}

export async function erpUserResend(ctx, payload) {
  needOwner(ctx);
  const m = await member(ctx, payload && payload.userId);
  const u = (await ctx.sql`select email from auth.users where id = ${m.user_id}`)[0];
  const email = str(u && u.email).toLowerCase();
  if (!EMAIL.test(email) || /\.invalid$/.test(email)) throw new Error('That person has no e-mail login (an old code login). Invite them by e-mail instead.');
  await ctx.deps.sendReset(email);
  return { ok: true, email };
}

export async function erpSessions(ctx, payload) {
  const userId = str(payload && payload.userId) || ctx.s.userId;
  if (userId !== ctx.s.userId) needOwner(ctx);
  await member(ctx, userId);
  const rows = await ctx.sql`select id, created_at, updated_at, user_agent, ip from auth.sessions where user_id = ${userId} order by updated_at desc limit 50`;
  return { userId, sessions: rows.map((s) => ({ id: s.id, started: when(s.created_at), lastSeen: when(s.updated_at), device: deviceLabel(s.user_agent), ip: str(s.ip) })) };
}
function deviceLabel(ua) {
  ua = str(ua);
  if (!ua) return 'Unknown device';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//i.test(ua) ? 'Edge' : /Chrome\//i.test(ua) ? 'Chrome' : /Safari\//i.test(ua) ? 'Safari' : /Firefox\//i.test(ua) ? 'Firefox' : 'Browser';
  return os + ' · ' + br;
}

export async function erpSessionEnd(ctx, payload) {
  const id = str(payload && payload.sessionId);
  if (!isId(id)) throw new Error('Which session?');
  const s = (await ctx.sql`select user_id from auth.sessions where id = ${id}`)[0];
  if (!s) throw new Error('That session is already over.');
  if (s.user_id !== ctx.s.userId) { needOwner(ctx); await member(ctx, s.user_id); }
  await ctx.sql`delete from auth.sessions where id = ${id}`;
  return erpSessions(ctx, { userId: s.user_id });
}

export async function erpSignOutAll(ctx, payload) {
  const userId = str(payload && payload.userId) || ctx.s.userId;
  if (userId !== ctx.s.userId) needOwner(ctx);
  await member(ctx, userId);
  await ctx.sql`delete from auth.sessions where user_id = ${userId}`;
  return erpSessions(ctx, { userId });
}

export const HANDLERS = { erpUsers, erpUserInvite, erpUserSet, erpUserPowers, erpUserResend, erpSessions, erpSessionEnd, erpSignOutAll };
