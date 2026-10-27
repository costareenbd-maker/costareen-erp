// Platform admin (043_platform.sql): the system as a whole, for the people who run it.
//
//   erpPlatform()                               every business: owners, users, last activity,
//                                               errors (7 days), invoices (30 days), storage; the timers
//   erpPlatformCreate({name, ownerName, ownerEmail})   a new business with its first owner, who is e-mailed
//   erpPlatformSuspend({businessId, suspend, reason})  nobody can open a suspended business
//   erpPlatformOwnerReset({businessId, userId})        the owner is e-mailed a link to choose a new password
//   erpPlatformErrors({businessId})                    the last errors in one business
//
// Every call checks platform_admins on the server's own connection; a platform
// admin has no role inside a customer's business. Each action is also written
// to that business's activity log, so its owner can see what was done.

import { formatDate } from '../lib/time.js';
import { setConfig } from '../lib/ext.js';
import { SEED_LISTS } from './settings.js';

const str = (v) => String(v == null ? '' : v).trim();
const when = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy, h:mm a') : '');
const isId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function isPlatformAdmin(sql, userId) {
  if (!isId(userId)) return false;
  // a busy pool at page start can fail the first try; one retry, so the provider is not briefly shown as an ordinary owner
  for (let i = 0; i < 2; i++) {
    try { return (await sql`select 1 from platform_admins where user_id = ${userId}`).length > 0; } catch (_) { /* try again */ }
  }
  return false;
}
/** The platform admin of THIS server. A company running on the provider's server (bridged) never is:
 *  its own platform_admins row (made by the installer) only counts on a copy that runs its own server. */
export async function platformAdmin(ctx) {
  if (ctx.deps && ctx.deps.install && ctx.deps.install.bridged) return false;
  return isPlatformAdmin(ctx.sql, ctx.s.userId);
}
async function need(ctx) {
  if (!(await platformAdmin(ctx))) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).');
}
async function business(ctx, id) {
  if (!isId(id)) throw new Error('Which business?');
  const b = (await ctx.sql`select id, name, suspended_at from businesses where id = ${id}`)[0];
  if (!b) throw new Error('That business does not exist.');
  return b;
}
/** Written where the business's owner reads it (Settings > Security). */
async function note(ctx, businessId, action, detail) {
  await ctx.tx`select platform_log(${businessId}, ${'Platform admin: ' + (str(ctx.s.name) || 'admin')}, ${action}, ${str(detail).slice(0, 300)})`;
}

export async function erpPlatform(ctx) {
  await need(ctx);
  const biz = await ctx.sql`select id, name, is_pool, created_at, suspended_at, suspended_reason from businesses order by created_at`;
  const ids = biz.map((b) => b.id);
  const by = (rows, key = 'business_id') => { const o = {}; rows.forEach((r) => { o[r[key]] = r; }); return o; };
  const members = by(await ctx.sql`select business_id, count(*) filter (where active)::int as active, count(*)::int as all from memberships where business_id = any(${ids}) group by business_id`);
  const owners = {};
  for (const o of await ctx.sql`select m.business_id, u.id, u.email, u.last_sign_in_at, p.full_name from memberships m join auth.users u on u.id = m.user_id
                                left join profiles p on p.id = u.id where m.business_id = any(${ids}) and m.role = 'owner' and m.active order by u.email`) {
    (owners[o.business_id] = owners[o.business_id] || []).push({ id: o.id, email: /\.invalid$/.test(str(o.email)) ? '' : str(o.email), name: str(o.full_name), lastSignIn: when(o.last_sign_in_at) });
  }
  const act = by(await ctx.sql`select business_id, max(at) as last from erp_activity where business_id = any(${ids}) group by business_id`);
  const errs = by(await ctx.sql`select business_id, count(*)::int as n, max(at) as last from erp_errors where business_id = any(${ids}) and at > now() - interval '7 days' group by business_id`);
  const inv = by(await ctx.sql`select business_id, count(*)::int as n from invoices where business_id = any(${ids}) and created_at > now() - interval '30 days' group by business_id`);
  let storage = {};
  try {
    for (const s of await ctx.sql`select split_part(name, '/', 1) as biz, sum(coalesce((metadata->>'size')::bigint, 0))::bigint as bytes, count(*)::int as files
                                   from storage.objects group by 1`) storage[s.biz] = { bytes: Number(s.bytes) || 0, files: s.files };
  } catch (_) { storage = {}; }
  let joint = {};
  try { for (const j of await ctx.sql`select business_id from joint_flags where enabled`) joint[j.business_id] = true; } catch (_) { joint = {}; }
  let timers = [];
  try {
    timers = (await ctx.sql`select j.jobname, j.schedule, d.status, d.start_time, d.return_message
                            from cron.job j left join lateral (select status, start_time, return_message from cron.job_run_details r
                                                               where r.jobid = j.jobid order by start_time desc limit 1) d on true
                            where j.jobname like 'erp-%' order by j.jobname`)
      .map((t) => ({ name: str(t.jobname), schedule: str(t.schedule), status: str(t.status) || 'not run yet', last: when(t.start_time), message: str(t.return_message).slice(0, 200) }));
  } catch (_) { timers = []; }
  return {
    me: ctx.biz,
    businesses: biz.map((b) => ({
      id: b.id, name: str(b.name), pool: !!b.is_pool, joint: !!joint[b.id], created: when(b.created_at), current: b.id === ctx.biz,
      suspended: !!b.suspended_at, suspendedWhen: when(b.suspended_at), suspendedReason: str(b.suspended_reason),
      owners: owners[b.id] || [], users: members[b.id] ? members[b.id].active : 0, usersAll: members[b.id] ? members[b.id].all : 0,
      lastActivity: act[b.id] ? when(act[b.id].last) : '', errors7: errs[b.id] ? errs[b.id].n : 0, lastError: errs[b.id] ? when(errs[b.id].last) : '',
      invoices30: inv[b.id] ? inv[b.id].n : 0, storageMb: storage[b.id] ? Math.round(storage[b.id].bytes / 1048576 * 10) / 10 : 0, files: storage[b.id] ? storage[b.id].files : 0,
    })),
    timers,
  };
}

export async function erpPlatformCreate(ctx, payload) {
  await need(ctx);
  payload = payload || {};
  const name = str(payload.name).slice(0, 80), ownerName = str(payload.ownerName).slice(0, 80), email = str(payload.ownerEmail).toLowerCase();
  if (!name) throw new Error('What is the business called?');
  if (!ownerName) throw new Error('Who is its owner? Type the name.');
  if (!EMAIL.test(email)) throw new Error('Type the owner\u2019s e-mail address - the invitation goes there.');
  if ((await ctx.sql`select 1 from businesses where lower(name) = ${name.toLowerCase()}`).length) throw new Error('A business called "' + name + '" already exists.');
  let userId = ((await ctx.sql`select id from auth.users where lower(email) = ${email} limit 1`)[0] || {}).id;
  let made = false;
  if (!userId) { userId = await ctx.deps.createOwner(email, ownerName); made = true; }
  await ctx.sql`insert into profiles (id, email, full_name) values (${userId}, ${email}, ${ownerName})
                on conflict (id) do update set full_name = coalesce(nullif(profiles.full_name, ''), excluded.full_name)`;
  // the business is made AS its owner, so it is theirs from the first row; the platform admin gets no role in it
  const mine = JSON.stringify({ sub: ctx.s.userId, role: 'authenticated' });
  let id;
  try {
    await ctx.tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    id = (await ctx.tx`select create_business(${name}) as id`)[0].id;
    const nctx = { ...ctx, biz: id, memo: {} };
    for (const [kind, vals] of Object.entries(SEED_LISTS)) {
      await ctx.tx`delete from lookups where business_id = ${id} and kind = ${kind}`;
      const rows = vals.map((v, i) => ({ business_id: id, kind, value: v, sort_order: i + 1 }));
      await ctx.tx`insert into lookups ${ctx.tx(rows, 'business_id', 'kind', 'value', 'sort_order')}`;
    }
    for (const [k, v] of [['business_name', name], ['currency', 'BDT'], ['default_reorder', '5'], ['default_lead_time', '7']]) await setConfig(nctx, k, v);
    await ctx.tx`select set_config('request.jwt.claims', ${mine}, true)`;
  } catch (e) {
    await ctx.tx`select set_config('request.jwt.claims', ${mine}, true)`;
    if (made) { try { await ctx.deps.removeUser(userId); } catch (_) { /* best effort */ } }
    throw e;
  }
  let mailed = false;
  try { await ctx.deps.sendReset(email); mailed = true; } catch (_) { mailed = false; }
  await note(ctx, id, 'erpPlatformCreate', 'business created with owner ' + email);
  // the list is read on the server's own connection, which cannot see this business until the call has finished: the page reads it again
  return { created: { id, name, email, made, mailed } };
}

export async function erpPlatformSuspend(ctx, payload) {
  await need(ctx);
  payload = payload || {};
  const b = await business(ctx, payload.businessId);
  const on = !!payload.suspend, why = str(payload.reason).slice(0, 300);
  if (on && b.id === ctx.biz) throw new Error('That is the business you are working in. Switch to another first - suspending it would lock you out.');
  if (on && !why) throw new Error('Say why it is suspended. The owner sees the reason.');
  await ctx.sql`update businesses set suspended_at = ${on ? new Date() : null}, suspended_reason = ${on ? why : null} where id = ${b.id}`;
  if (on) await ctx.sql`delete from erp_dash_cache where business_id = ${b.id}`;
  await note(ctx, b.id, on ? 'erpPlatformSuspend' : 'erpPlatformResume', on ? why : 'resumed');
  return erpPlatform(ctx);
}

/** Joint stock (a co-owned pool with a partner company) is off everywhere until switched on here, company by company. */
export async function erpPlatformJoint(ctx, payload) {
  await need(ctx);
  payload = payload || {};
  const b = await business(ctx, payload.businessId);
  const on = !!payload.on;
  if ((await ctx.sql`select is_pool from businesses where id = ${b.id}`)[0].is_pool) throw new Error('That is a joint pool itself. Switch it on for the companies that own it.');
  if (!on && (await ctx.sql`select 1 from pool_partners where partner_business_id = ${b.id} limit 1`).length) {
    throw new Error(str(b.name) + ' is a partner in a joint pool. Switching it off would hide stock and money that two companies own - it stays on while the pool exists.');
  }
  await ctx.sql`insert into joint_flags (business_id, enabled, set_by) values (${b.id}, ${on}, ${ctx.s.userId})
                on conflict (business_id) do update set enabled = excluded.enabled, set_by = excluded.set_by, set_at = now()`;
  await note(ctx, b.id, 'erpPlatformJoint', on ? 'joint stock switched on' : 'joint stock switched off');
  return erpPlatform(ctx);
}

export async function erpPlatformOwnerReset(ctx, payload) {
  await need(ctx);
  payload = payload || {};
  const b = await business(ctx, payload.businessId);
  const o = (await ctx.sql`select u.email from memberships m join auth.users u on u.id = m.user_id
                           where m.business_id = ${b.id} and m.user_id = ${isId(payload.userId) ? payload.userId : null} and m.role = 'owner' and m.active`)[0];
  if (!o) throw new Error('That person is not an owner of ' + str(b.name) + '.');
  const email = str(o.email).toLowerCase();
  if (!EMAIL.test(email) || /\.invalid$/.test(email)) throw new Error('That owner has no e-mail login.');
  await ctx.deps.sendReset(email);
  await note(ctx, b.id, 'erpPlatformOwnerReset', 'password reset e-mail sent to ' + email);
  return { ok: true, email };
}

export async function erpPlatformErrors(ctx, payload) {
  await need(ctx);
  const b = await business(ctx, payload && payload.businessId);
  const rows = await ctx.sql`select at, who, role, action, message, build from erp_errors where business_id = ${b.id} order by at desc limit 50`;
  return { businessId: b.id, name: str(b.name), errors: rows.map((r) => ({ when: when(r.at), who: str(r.who), role: str(r.role), action: str(r.action), message: str(r.message), build: str(r.build) })) };
}

export const HANDLERS = { erpPlatform, erpPlatformCreate, erpPlatformSuspend, erpPlatformJoint, erpPlatformOwnerReset, erpPlatformErrors };
