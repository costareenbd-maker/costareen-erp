// alerts-1 (owner 6 Nov 2026): "Phone alerts" - a notification on the phone even when the ERP app is closed.
// A device switches it on in the Inbox (erpPhoneAlertsOn); pushTeam() alerts every such device of the business when a
// chat needs a person (handover, AI off, a customer writing in a chat the team holds - handlers/inbox.js).
// Server-only tables erp_push_vapid / erp_push_subs (155_push.sql), always through ctx.sql.

import { makeVapid, sendPush } from '../lib/webpush.js';

const str = (v) => (v === null || v === undefined ? '' : String(v));

async function vapidOf(ctx) {
  let r = (await ctx.sql`select public_key, private_jwk, subject from erp_push_vapid where id = 1`)[0];
  if (!r) {
    const v = await makeVapid();
    await ctx.sql`insert into erp_push_vapid (id, public_key, private_jwk) values (1, ${v.publicKey}, ${ctx.sql.json(v.privateJwk)}) on conflict (id) do nothing`;
    r = (await ctx.sql`select public_key, private_jwk, subject from erp_push_vapid where id = 1`)[0];
  }
  const jwk = typeof r.private_jwk === 'string' ? JSON.parse(r.private_jwk) : r.private_jwk;
  return { publicKey: r.public_key, privateJwk: jwk, subject: str(r.subject) || 'mailto:alerts@costareen.com' };
}

function cleanSub(sub) {
  const s = sub || {}, keys = s.keys || {};
  const endpoint = str(s.endpoint);
  if (!/^https:\/\/[^\s]{8,}$/.test(endpoint) || endpoint.length > 1000) throw new Error('This browser gave no valid alert address. Try again, or use Chrome on the phone.');
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(str(keys.p256dh)) || !/^[A-Za-z0-9_-]{16,32}$/.test(str(keys.auth))) throw new Error('This browser gave no valid alert keys. Try again.');
  return { endpoint, p256dh: str(keys.p256dh), auth: str(keys.auth) };
}

/** The server's public key, and how many of this person's devices have alerts on here. */
export async function erpPhoneAlerts(ctx) {
  const v = await vapidOf(ctx);
  const n = (await ctx.sql`select count(*)::int as n from erp_push_subs where business_id = ${ctx.biz} and user_id is not distinct from ${ctx.s.userId || null}`)[0].n;
  return { publicKey: v.publicKey, devices: n };
}

/** This device: alerts on. */
export async function erpPhoneAlertsOn(ctx, payload) {
  const p = payload || {}, s = cleanSub(p.sub);
  const label = str(p.label).replace(/[\r\n]/g, ' ').slice(0, 80) || 'Phone';
  await ctx.sql`insert into erp_push_subs (business_id, user_id, endpoint, p256dh, auth, label)
                values (${ctx.biz}, ${ctx.s.userId || null}, ${s.endpoint}, ${s.p256dh}, ${s.auth}, ${label})
                on conflict (business_id, endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
                  label = excluded.label, fails = 0`;
  return erpPhoneAlerts(ctx);
}

/** This device: alerts off. */
export async function erpPhoneAlertsOff(ctx, payload) {
  const endpoint = str(payload && payload.endpoint);
  if (endpoint) await ctx.sql`delete from erp_push_subs where business_id = ${ctx.biz} and endpoint = ${endpoint}`;
  return erpPhoneAlerts(ctx);
}

/** Send one alert to this person's own devices, to see that it arrives. */
export async function erpPhoneAlertsTest(ctx) {
  const subs = await ctx.sql`select * from erp_push_subs where business_id = ${ctx.biz} and user_id is not distinct from ${ctx.s.userId || null}`;
  if (!subs.length) throw new Error('Switch Phone alerts on first, on this phone.');
  const r = await deliverAll(ctx, subs, { title: 'Phone alerts work', body: 'Customers who need a person will show up here.', url: '/#/inbox', tag: 'test' });
  return { ...r, ...(await erpPhoneAlerts(ctx)) };
}

async function deliverAll(ctx, subs, msg) {
  const v = await vapidOf(ctx), f = (ctx.deps && ctx.deps.fetch) || fetch;
  let sent = 0, failed = 0;
  for (const s of subs) {
    const r = await sendPush(f, s, msg, v, v.subject);
    if (r.ok) { sent++; await ctx.sql`update erp_push_subs set last_ok_at = now(), fails = 0 where id = ${s.id}`; }
    else if (r.gone || s.fails >= 20) { failed++; await ctx.sql`delete from erp_push_subs where id = ${s.id}`; }
    else { failed++; await ctx.sql`update erp_push_subs set fails = fails + 1 where id = ${s.id}`; }
  }
  return { sent, failed };
}

/**
 * Alert every device of this business that has Phone alerts on. Never throws: an alert that fails must not stop a
 * message being saved. Runs after the call's transaction is saved when the caller has afterCommit.
 * msg = { title, body, url, tag }
 */
export async function pushTeam(ctx, msg) {
  const run = async () => {
    try {
      const subs = await ctx.sql`select * from erp_push_subs where business_id = ${ctx.biz}`;
      if (!subs.length) return;
      await deliverAll(ctx, subs, { title: str(msg.title).slice(0, 80), body: str(msg.body).slice(0, 180), url: str(msg.url) || '/#/inbox', tag: str(msg.tag) });
    } catch (e) { console.error('pushTeam', e && e.message); }
  };
  if (typeof ctx.afterCommit === 'function') ctx.afterCommit(run); else await run();
}

export const HANDLERS = { erpPhoneAlerts, erpPhoneAlertsOn, erpPhoneAlertsOff, erpPhoneAlertsTest };
