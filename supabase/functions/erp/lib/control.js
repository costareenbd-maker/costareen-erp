// A company's own copy of the ERP, as seen from inside the copy.
//
//   controlState(sql)      what the provider last said: {status, message}; read at most once a minute
//   heartbeat(deps)        the hourly check-in with the provider (job 'heartbeat'); stores the answer
//   installFinish(deps, req, body)   the installer's last step: the company's business and its owner
//
// deps.install = { id, key, controlUrl, version } comes from the copy's own secrets
// (ERP_INSTALL_ID, ERP_INSTALL_KEY, ERP_CONTROL_URL, ERP_RELEASE). The provider's own
// system has none of them, so none of this does anything there.
// If the provider cannot be reached the copy keeps working on the last answer -
// a network fault never switches a company's ERP off.

import { SEED_LISTS } from '../handlers/settings.js';

const str = (v) => String(v == null ? '' : v).trim();
let kept = { at: 0, v: { status: 'active', message: '' } };

export async function controlState(sql) {
  if (Date.now() - kept.at < 60000) return kept.v;
  let v = { status: 'active', message: '' };
  try {
    const r = await sql`select status, message from erp_control where id = 1`;
    if (r[0]) v = { status: str(r[0].status) || 'active', message: str(r[0].message) };
  } catch (_) { /* before 047: always active */ }
  kept = { at: Date.now(), v };
  return v;
}
export function forgetControl() { kept.at = 0; }

export async function heartbeat(deps) {
  const ins = deps.install || {};
  if (!ins.id || !ins.key || !ins.controlUrl) return 'not a company copy';
  const sql = deps.sql;
  const one = async (q, d) => { try { return (await q)[0]; } catch (_) { return d; } };
  const stats = {
    businesses: (await one(sql`select count(*)::int n from businesses where not coalesce(is_pool, false)`, { n: 0 })).n,
    users: (await one(sql`select count(distinct user_id)::int n from memberships`, { n: 0 })).n,
    invoices30: (await one(sql`select count(*)::int n from invoices where created_at > now() - interval '30 days'`, { n: 0 })).n,
    errors7: (await one(sql`select count(*)::int n from erp_errors where at > now() - interval '7 days'`, { n: 0 })).n,
    lastActivity: ((await one(sql`select max(at) as t from erp_activity`, { t: null })).t || null),
  };
  let reply = null;
  try {
    const r = await (deps.fetch || fetch)(ins.controlUrl + '?control=beat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ins.id, key: ins.key, version: ins.version || '', stats }),
    });
    reply = await r.json();
  } catch (e) { return 'provider not reached: ' + str(e && e.message).slice(0, 120); }
  if (!reply || !reply.ok) return 'provider refused: ' + str(reply && reply.error);
  const status = reply.status === 'suspended' ? 'suspended' : 'active';
  await sql`insert into erp_control (id, status, message, checked_at) values (1, ${status}, ${str(reply.message) || null}, now())
            on conflict (id) do update set status = excluded.status, message = excluded.message, checked_at = now()`;
  forgetControl();
  return status;
}

/** The installer's last call: make the company's business, its owner (e-mailed to choose a password) and its platform admin. */
export async function installFinish(deps, key, body) {
  const ins = deps.install || {};
  if (!ins.key || key !== ins.key) return { status: 403, body: { ok: false, error: 'Not the installer.' } };
  const sql = deps.sql;
  const company = str(body.company).slice(0, 80), name = str(body.ownerName).slice(0, 80), email = str(body.ownerEmail).toLowerCase();
  if (!company || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 400, body: { ok: false, error: 'Company, owner name and e-mail are needed.' } };
  // done once: a second call (a retry) finds the business and only sends the e-mail again
  let biz = (await sql`select id from businesses where lower(name) = ${company.toLowerCase()} limit 1`)[0];
  let userId = ((await sql`select id from auth.users where lower(email) = ${email} limit 1`)[0] || {}).id;
  if (!userId) userId = await deps.createOwner(email, name);
  await sql`insert into profiles (id, email, full_name) values (${userId}, ${email}, ${name})
            on conflict (id) do update set full_name = coalesce(nullif(profiles.full_name, ''), excluded.full_name)`;
  if (!biz) {
    await sql.begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
      const id = (await tx`select create_business(${company}) as id`)[0].id;
      for (const [kind, vals] of Object.entries(SEED_LISTS)) {
        await tx`delete from lookups where business_id = ${id} and kind = ${kind}`;
        const rows = vals.map((v, i) => ({ business_id: id, kind, value: v, sort_order: i + 1 }));
        await tx`insert into lookups ${tx(rows, 'business_id', 'kind', 'value', 'sort_order')}`;
      }
      for (const [k, v] of [['business_name', company], ['currency', 'BDT'], ['default_reorder', '5'], ['default_lead_time', '7']]) {
        await tx`insert into business_config (business_id, key, value) values (${id}, ${k}, ${v})
                 on conflict (business_id, key) do update set value = excluded.value`;
      }
      biz = { id };
    });
  }
  // the company's owner runs their own system: they are its platform admin, nobody else
  await sql`delete from platform_admins where user_id <> ${userId}`;
  await sql`insert into platform_admins (user_id, note) values (${userId}, 'owner of this copy') on conflict do nothing`;
  let mailed = false;
  try { await deps.sendReset(email); mailed = true; } catch (_) { mailed = false; }
  return { status: 200, body: { ok: true, business: biz.id, mailed } };
}
