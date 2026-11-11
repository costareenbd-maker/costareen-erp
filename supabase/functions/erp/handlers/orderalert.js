// sales-3 (owner 10 Nov 2026): "when the AI takes an order, tell us on WhatsApp - on our first connected number, or in
// a WhatsApp group (made if there is none) with the invoice: here is the phone, here is the address, call to confirm,
// then send the parcel."
//
// Sent from the business's first WhatsApp number on its own Evolution server (kind wa_evo), after the customer's
// replies went out. Where it goes (Agent Desk, inbox_profile):
//   order_wa_to     blank  = that number's own chat ("message yourself")
//                   phones = each of them (comma separated, 01... or 8801...)
//                   'off'  = no alert
//   order_wa_group  a group's name: the group is found on that number, or made with the order_wa_to phones; the alert
//                   and the bill picture go there instead
// A failure never stops the order: agentReply writes it as a note in the chat.

import { call, chSecret, sendOut } from './inboxch.js';
import { billLink } from './inboxpub.js';

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const tk = (n) => '৳' + Math.round(num(n)).toLocaleString('en-IN');

/** The alert's words (shown in the Agent Desk test, sent for a real order). */
export function orderAlertText(p, o, ch) {
  const items = o.items || [];
  const goods = items.reduce((t, x) => t + num(x.qty) * num(x.price), 0);
  const where = ch && ch.name ? ' (' + str(ch.name) + ')' : '';
  return '🛒 নতুন অর্ডার ' + str(o.no) + where + '\n' +
    'নাম: ' + str(o.name) + '\nফোন: ' + str(o.phone) + '\nঠিকানা: ' + str(o.address) + '\n' +
    items.map((x) => '• ' + str(x.name) + ' × ' + num(x.qty) + ' = ' + tk(num(x.qty) * num(x.price))).join('\n') +
    (items.length ? '\n' : '') + 'ডেলিভারি: ' + tk(o.delivery_charge) + '\nমোট (ক্যাশ অন ডেলিভারি): ' + tk(goods + num(o.delivery_charge)) +
    (str(o.note) ? '\nনোট: ' + str(o.note) : '') +
    '\n\nফোন দিয়ে কনফার্ম করে পার্সেল পাঠিয়ে দিন।';
}

/** '01712-345678, +8801812...' -> ['8801712345678', '8801812...']. */
export function alertPhones(v) {
  return str(v).split(/[,;\n]+/).map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean)
    .map((d) => (d.length === 11 && d[0] === '0' ? '88' + d : d)).filter((d) => d.length >= 11 && d.length <= 15);
}

async function evo(ctx, ch) {
  const base = (await chSecret(ctx, ch, 'URL')).replace(/\/+$/, ''), key = await chSecret(ctx, ch, 'KEY'), inst = str(ch.external_id);
  return base && key && inst ? { base, key, inst } : null;
}

/** The number's own WhatsApp id (for "message yourself"). */
async function ownNumber(ctx, e) {
  const r = await call(ctx, e.base + '/instance/fetchInstances?instanceName=' + encodeURIComponent(e.inst), { method: 'GET', headers: { apikey: e.key } });
  const list = Array.isArray(r.json) ? r.json : [r.json];
  const one = list.find(Boolean) || {};
  const jid = str(one.ownerJid || one.owner || (one.instance && (one.instance.ownerJid || one.instance.owner)));
  return jid.replace(/@.*$/, '').replace(/[^0-9]/g, '') || '';
}

/** The group with this name on the number, or a new one with these phones. */
async function groupOf(ctx, e, name, phones) {
  const r = await call(ctx, e.base + '/group/fetchAllGroups/' + encodeURIComponent(e.inst) + '?getParticipants=false', { method: 'GET', headers: { apikey: e.key } });
  const list = Array.isArray(r.json) ? r.json : [];
  const g = list.find((x) => str(x && x.subject).toLowerCase() === name.toLowerCase());
  if (g && str(g.id)) return { id: str(g.id) };
  if (!phones.length) return { error: 'no WhatsApp group named "' + name + '" on this number, and no phone numbers to make it with' };
  const c = await call(ctx, e.base + '/group/create/' + encodeURIComponent(e.inst), { headers: { apikey: e.key }, body: { subject: name, description: 'Orders from the inbox', participants: phones } });
  const id = str(c.json && (c.json.id || (c.json.groupMetadata && c.json.groupMetadata.id)));
  return id ? { id, made: true } : { error: 'the WhatsApp group could not be made (' + (c.code || 'no answer') + ')' };
}

/** Tell the team about a chat order on WhatsApp. Returns { ok, to } or { ok:false, error } / { off:true }. */
export async function orderAlert(ctx, p, o, fromCh) {
  const to = str(p.order_wa_to), group = str(p.order_wa_group);
  if (to.toLowerCase() === 'off') return { ok: false, off: true };
  const chs = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind = 'wa_evo' and status <> 'removed' order by created_at, id`;
  if (!chs.length) return { ok: false, error: 'there is no WhatsApp number connected to the inbox' };
  const text = orderAlertText(p, o, fromCh);
  const bill = ctx.deps && ctx.deps.svgPng && o.page_token ? billLink(ctx, o) : '';
  let last = 'no WhatsApp number could send it';
  const { isChatCh } = await import('./inbox.js');
  for (const ch of chs.filter((c) => isChatCh(c))) {   // mgr-quiet-1: never from the manager's number
    const e = await evo(ctx, ch);
    if (!e) { last = 'the WhatsApp number "' + str(ch.name) + '" has no server set'; continue; }
    const phones = alertPhones(to);
    let targets;
    if (group) {
      const g = await groupOf(ctx, e, group, phones);
      if (g.error) { last = g.error; continue; }
      targets = [g.id];
    } else if (phones.length) targets = phones;
    else { const me = await ownNumber(ctx, e); if (!me) { last = 'the number "' + str(ch.name) + '" did not say its own phone'; continue; } targets = [me]; }
    let sent = 0;
    for (const t of targets) {
      const r = await sendOut(ctx, ch, { external_id: t }, { kind: 'text', text });
      if (r.ok) { sent++; if (bill) await sendOut(ctx, ch, { external_id: t }, { kind: 'image', url: bill, caption: 'Invoice ' + str(o.no) }); }
      else last = r.error || 'WhatsApp did not take it';
    }
    if (sent) return { ok: true, to: targets, from: str(ch.name) };
  }
  return { ok: false, error: last };
}

/** Agent Desk: send a made-up order alert now, to check the number / group (owner only). */
export async function erpOrderAlertTest(ctx) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner sends a test order alert.');
  const { profile } = await import('./inbox.js');
  const p = await profile(ctx, false);
  if (str(p.order_wa_to).toLowerCase() === 'off') throw new Error('Order alerts are off in the Agent Desk (the WhatsApp alert box says off).');
  const r = await orderAlert(ctx, p, { no: 'TEST', name: 'Test customer', phone: '01700000000', address: 'Test address (this is a test alert)',
    items: [{ name: 'Test product', qty: 1, price: 100 }], delivery_charge: 70 }, { name: 'test' });
  if (!r.ok) throw new Error('The test alert was not sent: ' + r.error);
  return { sent: true, to: r.to, from: r.from };
}

export const HANDLERS = { erpOrderAlertTest };
