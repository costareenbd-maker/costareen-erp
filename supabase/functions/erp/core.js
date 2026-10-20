// erpCall, re-implemented (ERP.js:4285): identify, authorise, run, scrub.
//
// Every call runs inside ONE transaction as the calling person
// (role `authenticated`, jwt subject = their auth.users id), so row-level
// security decides which rows exist for them - the same isolation the rest
// of the database relies on. Only sign-in, secrets and the error log use the
// privileged connection, and never with data from another business.

import { controlState } from './lib/control.js';
import { ERP_ALLOW, ERP_READS, ERP_ROLES, ERP_DISCOUNT_CAP, normRole, roleAtLeast, callAllowed, powersMap, discountCapOf } from './allow.js';
import { dashForget, dashKeep } from './handlers/bundle.js';
import { scrub } from './scrub.js';
import { HANDLERS } from './handlers/index.js';
import { keyHash } from './handlers/access.js';
import { appsState } from './handlers/apps.js';

export const ERP_BUILD = 'b261002-1321';      // must equal ERP_BUILD in the page

const SAYS = {
  NO_CODE: 'Enter your code to start.',
  NO_DEVICE: 'This browser could not be identified. Try again.',
  BAD_CODE: 'That code is not recognised.',
  LOCKED: 'Too many wrong codes. Try again in 15 minutes.',
  REVOKED: 'Your access has been withdrawn.',
  NO_ROLE: 'Your access has not been set up yet. Ask the owner.',
  PENDING: 'Your request has been sent. The owner has to allow this ' +
           'device before you can start.',
  DENIED: 'This device was refused. Speak to the owner.',
  DEVICE_REVOKED: 'This device is no longer allowed. Speak to the owner.',
  OTHER_DEVICE: 'That code belongs to a different phone. ' +
                'Ask the owner to allow this one.',
  NO_SESSION: 'Your sign-in has expired. Sign in again.',
  NO_KEY: 'This is a private system. Open it with your access link.',
  BAD_KEY: 'That access link does not work any more. Ask the owner for a new one.',
  IDLE: 'This device has not been used for 30 days, so it has to be allowed again. The owner has been asked.',
  SUSPENDED: 'This business has been suspended. Its owner has been told why; contact the system provider.',
};

class Refused extends Error {}
const DEVICE_IDLE_DAYS = 30;

/** "Android · Chrome" from a user agent, as erpDevLabel_ does. */
function deviceLabel(ua) {
  const s = String(ua || '');
  const os = /Android/i.test(s) ? 'Android' : /iPhone|iPad|iOS/i.test(s) ? 'iPhone'
    : /Windows/i.test(s) ? 'Windows' : /Mac OS/i.test(s) ? 'Mac' : /Linux/i.test(s) ? 'Linux' : 'Device';
  const br = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome'
    : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  return os + ' · ' + br;
}

async function deviceLocked(sql, device, ip) {
  const keys = [device, ip ? 'ip:' + ip : ''].filter(Boolean);
  if (!keys.length) return false;
  const r = await sql`select 1 from erp_device_locks
                      where device_id = any(${keys}) and locked_until > now() limit 1`;
  return r.length > 0;
}

/**
 * Count a wrong code. Five from one device, or twenty from one internet
 * address, inside 15 minutes puts it aside for 15 minutes. The device id is
 * chosen by the browser, so the address is what limits someone guessing.
 */
async function noteBadAttempt(sql, device, ip) {
  for (const [key, limit] of [[device, 5], [ip ? 'ip:' + ip : '', 20]]) {
    if (!key) continue;
    await sql`
      insert into erp_device_locks (device_id, failed, updated_at) values (${key}, 1, now())
      on conflict (device_id) do update set
        failed = case when erp_device_locks.updated_at < now() - interval '15 minutes' then 1
                      else erp_device_locks.failed + 1 end,
        locked_until = case when (case when erp_device_locks.updated_at < now() - interval '15 minutes' then 1
                                       else erp_device_locks.failed + 1 end) >= ${limit}
                            then now() + interval '15 minutes' else null end,
        updated_at = now()`;
  }
}

/**
 * Who is calling. Two doors, as in the original:
 *   - the owner, recognised without a code (was: the Google account that
 *     owns the sheet; now: a Supabase session),
 *   - everyone else by 6-digit code + an allowed device.
 */
async function authenticate(sql, deps, token, authHeader, ip) {
  token = token || {};
  const code = String(token.code || '').replace(/\D/g, '');
  const device = String(token.device || '').trim().slice(0, 64);

  // ---- access by private link (027): the key, held by the device, is the whole sign-in
  const key = String(token.key || '').trim();
  if (key) {
    const ok = /^[A-Za-z0-9_-]{40,128}$/.test(key);
    const rows = ok ? await sql`select id, user_id, label, last_used from erp_access_keys
                               where key_hash = ${await keyHash(key)} and revoked_at is null` : [];
    if (!rows[0]) { await noteBadAttempt(sql, '', ip); throw new Refused('BAD_KEY'); }
    const k = rows[0];
    if (!k.last_used || Date.now() - new Date(k.last_used).getTime() > 5 * 60 * 1000) {
      await sql`update erp_access_keys set last_used = now() where id = ${k.id}`;
    }
    return { userId: k.user_id, device, viaKey: true, keyId: k.id, name: String(k.label || '').trim() || 'Access link' };
  }
  // with the sign-in screen switched off, nothing else opens the door
  if (deps.linkOnly) throw new Refused('NO_KEY');

  if (!code) {
    const userId = authHeader ? await deps.verifyUser(authHeader) : null;
    if (!userId) throw new Refused('NO_CODE');
    const p = await sql`select full_name, email from profiles where id = ${userId}`;
    return { userId, device, implicit: true,
             name: (p[0] && (p[0].full_name || p[0].email)) || 'Owner' };
  }
  if (!device) throw new Refused('NO_DEVICE');

  const rows = await sql`select * from erp_people where code = ${code}`;
  const me = rows[0];
  if (!me) { await noteBadAttempt(sql, device, ip); throw new Refused('BAD_CODE'); }
  if (me.locked_until && new Date(me.locked_until) > new Date()) throw new Refused('LOCKED');
  if (String(me.status) === 'revoked') throw new Refused('REVOKED');

  // erpDevCheck_: each device is asked for and allowed separately.
  const d = await sql`select * from erp_devices where user_id = ${me.user_id} and device_id = ${device}`;
  if (!d[0]) {
    await sql`insert into erp_devices (device_id, user_id, label, status)
              values (${device}, ${me.user_id}, ${deviceLabel(token.label)}, 'pending')
              on conflict (device_id, user_id) do nothing`;
    throw new Refused('PENDING');
  }
  const st = String(d[0].status || '').toLowerCase();
  if (st === 'denied') throw new Refused('DENIED');
  if (st === 'revoked') throw new Refused('DEVICE_REVOKED');
  if (st !== 'approved') throw new Refused('PENDING');
  // A phone or computer nobody has used for 30 days is no longer taken on trust:
  // it asks the owner again, like a new one. (A lost phone, a member who left.)
  // the newest of: last used, allowed, asked - so a device just allowed again is not idle
  const lastSeen = Math.max(...[d[0].last_used, d[0].decided_at, d[0].requested_at].map((t) => (t ? new Date(t).getTime() : 0)));
  if (lastSeen && Date.now() - lastSeen > DEVICE_IDLE_DAYS * 86400e3) {
    await sql`update erp_devices set status = 'pending', requested_at = now(), note = 'not used for 30 days' where id = ${d[0].id}`;
    throw new Refused('IDLE');
  }

  // "last used" is for the owner's Staff screen; minute precision is plenty,
  // and writing it on every call made every call a write
  const stale = (t) => !t || Date.now() - new Date(t).getTime() > 5 * 60 * 1000;
  if (stale(d[0].last_used)) await sql`update erp_devices set last_used = now() where id = ${d[0].id}`;
  if (stale(me.last_used) || Number(me.failed) > 0) {
    await sql`update erp_people set last_used = now(), failed = 0 where user_id = ${me.user_id}`;
  }
  return { userId: me.user_id, device, code, name: String(me.name || '').trim() || 'User' };
}

/** The business this person is working in, and their role there. */
async function activeBusiness(sql, userId) {
  const mem = await sql`
    select m.business_id, m.role, m.powers, b.name, b.is_pool, b.suspended_at
    from memberships m join businesses b on b.id = m.business_id
    where m.user_id = ${userId} and coalesce(m.active, true)
    order by m.created_at`;
  if (!mem.length) throw new Refused('NO_ROLE');
  // a suspended business opens for nobody; the person's other businesses still do
  const open = mem.filter((m) => !m.suspended_at);
  if (!open.length) throw new Refused('SUSPENDED');
  mem.splice(0, mem.length, ...open);
  const pref = await sql`select active_business from erp_prefs where user_id = ${userId}`;
  const want = pref[0] && pref[0].active_business;
  // joint-fix-1 (20 Oct 2026): a joint stock is never opened as a business of its own. Its book is kept from
  // Joint stock in the partner's own company; inside it, a sale or an expense would skip the joint flow.
  const own = mem.filter((m) => !m.is_pool);
  const from = own.length ? own : mem;
  const hit = from.find((m) => m.business_id === want) || from[0];
  const role = normRole(hit.role);
  if (!ERP_ROLES[role]) throw new Refused('NO_ROLE');
  const powers = (hit.powers && typeof hit.powers === 'object') ? hit.powers : {};
  return { businessId: hit.business_id, businessName: hit.name, role, powers, memberships: mem };
}

async function session(sql, deps, token, authHeader, ip) {
  const who = await authenticate(sql, deps, token, authHeader, ip);
  const biz = await activeBusiness(sql, who.userId);
  return { ...who, ...biz, roleLabel: ERP_ROLES[biz.role].label,
           discountCap: discountCapOf(biz.role, biz.powers) };
}

/** erpMe / erpHello: what the browser is told about the person using it. */
async function hello(sql, deps, token, authHeader, ip) {
  const device = String((token && token.device) || '').trim();
  if (await deviceLocked(sql, device, ip)) return { ok: false, reason: 'LOCKED', message: SAYS.LOCKED };
  try {
    const s = await session(sql, deps, token, authHeader, ip);
    await logActivity(sql, s, 'sign-in', null, token, ip);
    let platform = false;
    if (!(deps.install && deps.install.bridged)) {
      try { platform = (await sql`select 1 from platform_admins where user_id = ${s.userId}`).length > 0; } catch (_) { platform = false; }
    }
    let joint = false;   // joint stock with a partner company: only where the provider switched it on
    try {
      if (deps.install && deps.install.bridged && deps.control) joint = !!((await deps.control`select joint from erp_tenants where id = ${deps.install.id}`)[0] || {}).joint;
      else joint = (await sql`select 1 from joint_flags where business_id = ${s.businessId} and enabled`).length > 0;
    } catch (_) { joint = false; }
    let apps = { off: [], hidden: [] };   // the Apps page: what the provider switched off, what this company hides
    try {
      apps = await appsState(deps, sql, s.businessId, async (k) => { const r = await sql`select value from business_config where business_id = ${s.businessId} and key = ${k}`; return r[0] ? r[0].value : ''; });
    } catch (_) { apps = { off: [], hidden: [] }; }
    return { ok: true, role: s.role, roleLabel: s.roleLabel, name: s.name,
             implicit: !!s.implicit, link: !!s.viaKey, discountCap: s.discountCap, powers: powersMap(s), platform, joint, apps };
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    return { ok: false, reason: e.message, message: SAYS[e.message] || 'Could not sign you in.' };
  }
}

// ---------------------------------------------------------------- activity
// Who opened the app and who changed what (Settings > Security). Written on
// the server's own connection, after the call has succeeded. Only a few safe
// words of what was touched are kept - never a whole payload, which may hold
// a key or a code.
const QUIET = /^(erpSetTheme|erpSetLook|erpSetBusiness|erpHello|erpMe|erpEvo\w*|erpCampaignTick)$/;
const DETAIL_KEYS = ['invoiceNo', 'invoice', 'sku', 'month', 'kind', 'business'];
function activityDetail(args) {
  const a = Array.isArray(args) ? args[0] : null;
  if (typeof a === 'string') return /^[A-Za-z]{2,4}-[\w-]{3,30}$/.test(a) ? a : '';
  if (a && typeof a === 'object') {
    for (const k of DETAIL_KEYS) {
      if (a[k] !== undefined && a[k] !== null && typeof a[k] !== 'object' && String(a[k]).trim()) return String(a[k]).trim().slice(0, 60);
    }
  }
  return '';
}
async function logActivity(sql, s, action, args, token, ip, result) {
  try {
    if (!s || !s.businessId || QUIET.test(action)) return;
    const label = String((token && token.label) || '');
    const device = s.viaKey ? 'Access link' + (label ? ' · ' + deviceLabel(label) : '')
      : s.implicit ? 'Owner sign-in' + (label ? ' · ' + deviceLabel(label) : '') : (label ? deviceLabel(label) : 'Staff code');
    if (action === 'sign-in') {
      // once per half hour per person is enough to show who has been in
      await sql`insert into erp_activity (business_id, user_id, who, role, action, device, ip)
                select ${s.businessId}, ${s.userId}, ${s.name}, ${s.role}, 'sign-in', ${device}, ${ip || null}
                where not exists (select 1 from erp_activity where business_id = ${s.businessId} and user_id = ${s.userId}
                                  and action = 'sign-in' and at > now() - interval '30 minutes')`;
      return;
    }
    await sql`insert into erp_activity (business_id, user_id, who, role, action, detail, device, ip)
              values (${s.businessId}, ${s.userId}, ${s.name}, ${s.role}, ${action}, ${activityDetail(args) || activityDetail([result]) || null}, ${device}, ${ip || null})`;
    if (Math.random() < 0.02) await sql`delete from erp_activity where business_id = ${s.businessId} and at < now() - interval '90 days'`;
  } catch (_) { /* the log must never be what breaks a call */ }
}

async function logError(sql, s, name, err) {
  try {
    await sql`insert into erp_errors (business_id, who, role, action, message, build)
              values (${(s && s.businessId) || null}, ${(s && s.name) || ''}, ${(s && s.role) || ''},
                      ${name}, ${String((err && err.message) || err).slice(0, 500)}, ${ERP_BUILD})`;
  } catch (_) { /* writing the log must never be what breaks a call */ }
}

/**
 * One request from the page: { name, args, token }.
 * Returns { ok:true, result } or { ok:false, error }.
 */
export async function erpCall(deps, { name, args, token, authHeader, ip }) {
  ip = String(ip || '').trim().slice(0, 64);
  const sql = deps.sql;
  name = String(name || '');

  // a company's copy that its provider switched off opens for nobody (lib/control.js)
  if (deps.install && deps.install.id) {
    const c = await controlState(sql);
    if (c.status === 'suspended') return { ok: false, error: 'This ERP has been switched off by its provider' + (c.message ? ': ' + c.message : '.') };
  }
  if (name === 'erpHello') return { ok: true, result: await hello(sql, deps, token, authHeader, ip) };

  const need = ERP_ALLOW[name];
  const fn = HANDLERS[name];
  if (!need) return { ok: false, error: 'Unknown action: ' + name };
  // Allowed but not ported yet: say so plainly. "Unknown action" would make
  // the page show its "this page is out of date" banner.
  if (!fn) return { ok: false, error: 'This part is not in the web app yet (' + name + ').' };

  let s = null;
  try {
    if (await deviceLocked(sql, String((token && token.device) || '').trim(), ip)) {
      throw new Error(SAYS.LOCKED);
    }
    try {
      s = await session(sql, deps, token, authHeader, ip);
    } catch (e) {
      if (e instanceof Refused) throw new Error(SAYS[e.message] || 'Sign in to the ERP first.');
      throw e;
    }
    if (!callAllowed(s, name)) throw new Error('Your account does not have access to that.');

    const claims = JSON.stringify({ sub: s.userId, role: 'authenticated' });
    // work that must happen only once this call's own transaction is saved (afterCommit), or undone
    // elsewhere if it is not (onRollback) - e.g. a joint sale's copy in another database (handlers/joint.js)
    const hooks = { after: [], undo: [] };
    let result;
    try { result = await sql.begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true),
                      set_config('request.jwt.claims', ${claims}, true)`;
      // ctx.sql is for the few privileged side-queries a handler makes while its own
      // transaction is open. It must NOT be the pool the transaction came from: with
      // every connection held by a transaction waiting for one more, nothing moves.
      const ctx = { tx, sql: deps.sqlAux || sql, s, biz: s.businessId, now: new Date(), memo: {}, deps,
                    afterCommit: (f) => hooks.after.push(f), onRollback: (f) => hooks.undo.push(f) };
      // a save sent twice is saved once: the page's one-time key (opKey) is claimed in this same transaction
      let list = Array.isArray(args) ? args.slice() : [], opKey = null;
      if (list[0] && typeof list[0] === 'object' && !Array.isArray(list[0]) && 'opKey' in list[0]) {
        const { opKey: k, ...rest } = list[0]; list[0] = rest;
        if (!ERP_READS.test(name) && typeof k === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(k)) opKey = k;
      }
      if (opKey) {
        const got = await tx`insert into erp_op_keys (business_id, op_key, name) values (${s.businessId}, ${opKey}, ${name})
                             on conflict do nothing returning op_key`;
        if (!got.length) {
          const prev = await tx`select result from erp_op_keys where business_id = ${s.businessId} and op_key = ${opKey}`;
          if (prev[0] && prev[0].result !== null) return { __replay: true, value: prev[0].result };
          throw new Error('This was already sent and is still being saved. Wait a moment and reload before trying again.');
        }
      }
      const out = await fn(ctx, ...list);
      if (opKey) await tx`update erp_op_keys set result = ${tx.json(out === undefined ? null : out)} where business_id = ${s.businessId} and op_key = ${opKey}`;
      return out;
    }); } catch (e) {
      for (const f of hooks.undo) { try { await f(); } catch (u) { console.error('undo after a failed call', name, u); } }
      throw e;
    }
    for (const f of hooks.after) { try { await f(); } catch (a) { console.error('after-save step', name, a); await logError(sql, s, name + ' (after save)', a); } }
    if (result && result.__replay === true) return { ok: true, result: scrub(name, result.value, s), replayed: true };
    // the books may have changed: the kept dashboard is no longer to be trusted
    if (!ERP_READS.test(name)) { await dashForget(sql, s.businessId); await logActivity(sql, s, name, args, token, ip, result); }
    else if (name === 'erpDashboardData') await dashKeep({ sql, biz: s.businessId, s, now: new Date() }, result);
    return { ok: true, result: scrub(name, result, s) };
  } catch (err) {
    await logError(sql, s, name, err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}
