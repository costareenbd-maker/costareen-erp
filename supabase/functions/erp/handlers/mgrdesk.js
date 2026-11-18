// mgrdesk-1 (owner 19 Nov 2026, "give Alvi every power that makes the manager's work easier"): what the manager and the
// MD can ask Alvi for on WhatsApp (bosschat.js runs the conversation), plus two timers for the manager.
//
//   web_order        a website order by number, or the day's orders
//   parcel_status    where a parcel is (Steadfast, live) by invoice or phone; tell=true also tells the customer
//   due_reminders    who owes money; propose -> after a yes every one gets a polite reminder (group, else WhatsApp)
//   group_rename / group_add / group_logo_all   the customer's WhatsApp group (from the manager's number, its admin)
//   payment thanks   after a confirmed payment (propose_payment): thanks + ❤️ on the customer's last message
//   invoice to group after a confirmed invoice (propose_invoice): the PDF goes into the customer's group
//   mgrTick          21:30 Dhaka: the day's summary to the manager; 10-21 h hourly: stock running out / back in stock
//                    (back in stock lists the customers who asked for it - the manager decides who is told)
//
// Every message to a customer goes from Alvi's number (mgr-quiet-1); group admin work is done by the manager's number
// because it made the groups. Picture changes go slowly (one group every 15 minutes) - a burst of profile changes once
// coincided with WhatsApp's "conflict: replaced" loop.

import { formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { call, chSecret, sendOut } from './inboxch.js';
import { bossPhones } from './superior.js';

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n) => '৳' + Math.round(num(n)).toLocaleString('en-IN');
const MIN = 60e3;
const phone88 = (v) => { const d = str(v).replace(/[^0-9]/g, ''); return d.length === 11 && d[0] === '0' ? '88' + d : d.length === 10 && d[0] === '1' ? '880' + d : d; };
const salute = (g) => (g === 'f' ? 'আপু' : 'ভাই');

export const MGR_TOOLS = [
  { name: 'web_order', description: 'Website orders (costareen.com): one by its number (e.g. 8968) with customer, items, total, status and whether it is entered as an invoice; or without a number the orders of a day (day = today | yesterday | YYYY-MM-DD).', parameters: { type: 'OBJECT', properties: { order: { type: 'STRING' }, day: { type: 'STRING' } } } },
  { name: 'parcel_status', description: 'Where a parcel is now (asked from the courier live): by invoice number or the customer\'s phone. tell = true also tells the customer the status (in their group, else on WhatsApp) - only when they asked for that.', parameters: { type: 'OBJECT', properties: { invoice: { type: 'STRING' }, phone: { type: 'STRING' }, tell: { type: 'BOOLEAN' } } } },
  { name: 'due_reminders', description: 'Customers who owe money. action list = who owes what; action propose = prepare a polite reminder to each of them (or only phones = the ones they named) - sent after their yes. People reminded in the last 3 days are left out.', parameters: { type: 'OBJECT', properties: { action: { type: 'STRING' }, phones: { type: 'ARRAY', items: { type: 'STRING' } } } } },
  { name: 'group_rename', description: 'Change the name of a customer\'s WhatsApp group. who = the customer\'s phone or an invoice number; name = the new group name.', parameters: { type: 'OBJECT', properties: { who: { type: 'STRING' }, name: { type: 'STRING' } }, required: ['who', 'name'] } },
  { name: 'group_add', description: 'Add a person to a customer\'s WhatsApp group (e.g. the customer\'s partner or a new staff member). who = the customer\'s phone or an invoice number; phone = the person to add.', parameters: { type: 'OBJECT', properties: { who: { type: 'STRING' }, phone: { type: 'STRING' } }, required: ['who', 'phone'] } },
  { name: 'group_logo_all', description: 'Prepare: put the shop logo as the picture of every customer group (slowly, one group every 15 minutes). Done after their yes.', parameters: { type: 'OBJECT', properties: {} } },
];
export const MGR_NAMES = MGR_TOOLS.map((t) => t.name);

// ---------------------------------------------------------------- numbers
async function evoOf(ctx, ch) {
  const base = (await chSecret(ctx, ch, 'URL')).replace(/\/+$/, ''), key = await chSecret(ctx, ch, 'KEY'), inst = str(ch.external_id);
  return base && key && inst ? { base, key, inst } : null;
}
/** Alvi's channel (newest live chat WhatsApp) and the manager's (the number that made the groups). */
export async function channels(ctx, p) {
  const chs = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind = 'wa_evo' and status = 'live' order by created_at desc, id`;
  const boss = bossPhones(p.superior_wa)[0] || '';
  let ai = null, maker = null;
  for (const c of chs) {
    const purpose = str((c.settings || {}).purpose || 'chat');
    if (!ai && purpose === 'chat') ai = c;
    if (!maker && purpose !== 'chat') maker = c;
  }
  // the manager's number is the collect channel; fall back to asking WhatsApp who owns which number
  if (!maker && boss) {
    for (const c of chs) {
      const e = await evoOf(ctx, c);
      if (!e) continue;
      const r = await call(ctx, e.base + '/instance/fetchInstances?instanceName=' + encodeURIComponent(e.inst), { method: 'GET', headers: { apikey: e.key } });
      const one = (Array.isArray(r.json) ? r.json : [r.json]).find(Boolean) || {};
      if (str(one.ownerJid || one.owner).replace(/@.*$/, '') === boss) { maker = c; break; }
    }
  }
  return { ai, maker };
}
/** A message from Alvi's number to the customer: into their group when they have one, else their WhatsApp. */
async function toCustomer(ctx, p, phone, text) {
  const { ai } = await channels(ctx, p);
  if (!ai) return { ok: false, error: "Alvi's WhatsApp is not linked" };
  const cg = await import('./cgroups.js');
  const g = await cg.groupOf(ctx, phone);
  const r = await sendOut(ctx, ai, { external_id: g ? g.group_jid : phone }, { kind: 'text', text });
  if (r.ok) {
    const v = g && g.conversation_id ? (await ctx.tx`select * from inbox_conversations where id = ${g.conversation_id}`)[0]
      : (await ctx.tx`select v.* from inbox_conversations v join inbox_contacts k on k.id = v.contact_id where v.channel_id = ${ai.id} and k.external_id = ${phone} limit 1`)[0];
    if (v) { const { writeMsg } = await import('./inbox.js'); await writeMsg(ctx, v, { direction: 'out', author: 'ai', kind: 'text', text, externalId: r.externalId || null }); }
  }
  return { ok: !!r.ok, where: g ? 'group' : 'whatsapp', error: r.ok ? '' : str(r.error) };
}
/** The customer group for a phone or an invoice number. */
async function groupFor(ctx, who) {
  let ph = phone88(who);
  if (!/^8801[3-9][0-9]{8}$/.test(ph)) {
    const d = str(who).replace(/^#/, ''), tail = d.replace(/[^0-9]/g, '');
    const inv = (await ctx.tx`select customer_phone from invoices where business_id = ${ctx.biz} and voided_at is null
                              and (upper(invoice_no) = ${d.toUpperCase()} or (${tail.length >= 3} and invoice_no like ${'%-' + tail})) order by created_at desc limit 1`)[0];
    ph = inv ? phone88(inv.customer_phone) : '';
  }
  if (!ph) return { error: 'Customer not found - give their phone or an invoice number.' };
  const g = await (await import('./cgroups.js')).groupOf(ctx, ph);
  return g ? { g, phone: ph } : { error: 'This customer (' + ph + ') has no WhatsApp group yet.' };
}

// ---------------------------------------------------------------- parcel status
const SF_BN = { pending: 'বুক হয়েছে, কুরিয়ার এখনো তোলেনি', in_review: 'কুরিয়ারের কাছে, পথে আছে', hold: 'কুরিয়ারে হোল্ডে আছে', delivered: 'ডেলিভারি হয়ে গেছে',
  partial_delivered: 'আংশিক ডেলিভারি হয়েছে', cancelled: 'বাতিল হয়েছে', unknown: 'কুরিয়ার এখনো জানায়নি', delivered_approval_pending: 'ডেলিভারি হয়েছে (কুরিয়ার মিলিয়ে নিচ্ছে)',
  partial_delivered_approval_pending: 'আংশিক ডেলিভারি (কুরিয়ার মিলিয়ে নিচ্ছে)', cancelled_approval_pending: 'বাতিল (কুরিয়ার মিলিয়ে নিচ্ছে)', unknown_approval_pending: 'কুরিয়ার মিলিয়ে নিচ্ছে' };
export const parcelBn = (st) => SF_BN[str(st).toLowerCase()] || str(st) || 'জানা নেই';
async function parcels(ctx, a) {
  const d = str(a.invoice).replace(/^#/, ''), tail = d.replace(/[^0-9]/g, ''), ph = phone88(a.phone);
  if (!d && !ph) return { error: 'Give an invoice number or the customer\'s phone.' };
  const rows = d
    ? await ctx.tx`select * from courier_log where business_id = ${ctx.biz} and (upper(invoice_no) = ${d.toUpperCase()} or (${tail.length >= 3} and invoice_no like ${'%-' + tail})) order by booked_at desc limit 3`
    : await ctx.tx`select * from courier_log where business_id = ${ctx.biz} and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${ph.slice(-10)} order by booked_at desc limit 3`;
  if (!rows.length) return { error: 'No parcel was booked with the courier for ' + (d || ph) + ' (maybe walk-in, pickup or not booked yet).' };
  const C = await import('./courier.js');
  const out = [];
  for (const r of rows) {
    let st = '';
    try { const s = await C.sfStatus(ctx, r.consignment_id); st = s ? s.status : ''; } catch (_) { st = ''; }
    out.push({ invoice: str(r.invoice_no), customer: str(r.customer), phone: str(r.phone), booked: r.booked_at ? formatDate(new Date(r.booked_at), 'd MMM') : '', tracking: str(r.tracking_code),
      cod: num(r.cod_amount), status: st || 'unknown', statusBn: parcelBn(st || 'unknown') });
  }
  return { parcels: out };
}

// ---------------------------------------------------------------- web orders
async function webOrder(ctx, a) {
  const no = str(a.order).replace(/[^0-9A-Za-z-]/g, '');
  if (no) {
    const o = (await ctx.tx`select * from web_orders where business_id = ${ctx.biz} and order_no::text = ${no} limit 1`)[0];
    if (!o) return { error: 'No website order ' + no + ' in the ERP yet (the website sync brings new ones every few minutes).' };
    const lines = await ctx.tx`select product_name, qty, line_total from web_order_lines where web_order_id = ${o.id} order by seq nulls last, id`;
    const inv = o.invoice_id ? (await ctx.tx`select invoice_no from invoices where id = ${o.invoice_id}`)[0] : null;
    return { order: no, date: str(o.order_date_text) || (o.order_date ? formatDate(new Date(o.order_date), 'd MMM yyyy') : ''), status: str(o.status), customer: str(o.customer_name), phone: str(o.customer_phone),
      address: str(o.customer_address), payment: str(o.payment), total: money(o.order_total), enteredAsInvoice: inv ? str(inv.invoice_no) : (o.entered ? 'yes' : 'not yet'),
      items: lines.map((l) => ({ name: str(l.product_name), qty: num(l.qty), total: money(l.line_total) })) };
  }
  const dd = str(a.day).toLowerCase();
  const day = !dd || dd === 'today' ? formatDate(ctx.now, 'yyyy-MM-dd') : dd === 'yesterday' ? formatDate(new Date(ctx.now.getTime() - 24 * 3600e3), 'yyyy-MM-dd') : dd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Which day? today, yesterday or YYYY-MM-DD.' };
  const rows = await ctx.tx`select order_no, status, customer_name, order_total, entered from web_orders where business_id = ${ctx.biz}
                            and (order_date at time zone 'Asia/Dhaka')::date = ${day}::date order by order_no`;
  return { day, count: rows.length, total: money(rows.reduce((s, r) => s + num(r.order_total), 0)),
    orders: rows.slice(0, 25).map((r) => ({ order: str(r.order_no), status: str(r.status), customer: str(r.customer_name), total: money(r.order_total), entered: !!r.entered })) };
}

// ---------------------------------------------------------------- dues
async function duesList(ctx, roleCtx) {
  const A = await import('./assistant.js');
  const r = await A.runTool(roleCtx, 'dues', {});
  return r;
}
function remindText(name, due, gender) {
  return 'আসসালামু আলাইকুম ' + salute(gender) + ' 🌸\nআপনার কাছে আমাদের ' + money(due) + ' বাকি আছে' + (str(name) ? ' (' + str(name) + ')' : '') + '। সুবিধামতো সময়ে পরিশোধ করে দিলে খুব উপকার হয়।\n' +
    'বিকাশ / ব্যাংকের তথ্য লাগলে এখানে লিখুন, দিয়ে দিচ্ছি। ধন্যবাদ 💙';
}

// ---------------------------------------------------------------- run one tool (bosschat calls this)
export async function runMgrTool(ctx, roleCtx, p, name, a, propose) {
  a = a || {};
  if (name === 'web_order') return webOrder(ctx, a);
  if (name === 'parcel_status') {
    const r = await parcels(ctx, a);
    if (r.error || !a.tell) return r;
    const x = r.parcels[0], ph = phone88(x.phone);
    if (!/^8801[3-9][0-9]{8}$/.test(ph)) return { ...r, told: false, why: 'no usable phone' };
    const g = (await ctx.tx`select gender from customer_groups where business_id = ${ctx.biz} and phone = ${ph} limit 1`)[0];
    const t = await toCustomer(ctx, p, ph, salute(g && g.gender) + ', আপনার পার্সেলের খবর (' + x.invoice + '): ' + x.statusBn + '।' + (x.tracking ? '\nট্র্যাকিং: https://steadfast.com.bd/t/' + x.tracking : ''));
    return { ...r, told: t.ok, toldWhere: t.where, error: t.ok ? undefined : t.error };
  }
  if (name === 'due_reminders') {
    const d = await duesList(ctx, roleCtx);
    if (d.error) return d;
    const list = (d.customers || []).filter((c) => num(c.owes) > 0);
    if (str(a.action) !== 'propose') return { total: money(d.total), people: d.count, customers: list.map((c) => ({ name: c.name, phone: c.phone, owes: money(c.owes), oldest: c.oldest })) };
    let seen = {};
    try { seen = JSON.parse(str(await getConfig(ctx, 'mgr_due_reminded', '')) || '{}') || {}; } catch (_) { seen = {}; }
    const want = (Array.isArray(a.phones) ? a.phones : []).map((x) => phone88(x).slice(-10)).filter(Boolean);
    const pick = list.filter((c) => /^8801[3-9][0-9]{8}$/.test(phone88(c.phone)) && (!want.length || want.includes(phone88(c.phone).slice(-10))))
      .filter((c) => !seen[phone88(c.phone)] || ctx.now.getTime() - new Date(seen[phone88(c.phone)]).getTime() > 3 * 24 * 3600e3).slice(0, 25);
    if (!pick.length) return { error: 'Nobody to remind (no dues with a phone, or all were reminded in the last 3 days).' };
    return propose({ tool: 'due_remind', args: { people: pick.map((c) => ({ phone: phone88(c.phone), name: str(c.name), due: num(c.owes) })) },
      summary: pick.length + ' জনকে বাকির কথা ভদ্রভাবে মনে করানো: ' + pick.map((c) => str(c.name) + ' ' + money(c.owes)).join(', ') });
  }
  if (name === 'group_rename' || name === 'group_add') {
    const f = await groupFor(ctx, a.who);
    if (f.error) return f;
    const { maker } = await channels(ctx, p);
    const e = maker && await evoOf(ctx, maker);
    if (!e) return { error: "The manager's WhatsApp (the groups' admin) is not linked." };
    const q = '?groupJid=' + encodeURIComponent(f.g.group_jid);
    if (name === 'group_rename') {
      const subject = str(a.name).slice(0, 60);
      if (!subject) return { error: 'What name?' };
      const r = await call(ctx, e.base + '/group/updateGroupSubject/' + encodeURIComponent(e.inst) + q, { headers: { apikey: e.key }, body: { subject } });
      if (!r.ok) return { error: 'WhatsApp refused (' + r.code + ')' };
      await ctx.tx`update customer_groups set subject = ${subject} where id = ${f.g.id}`;
      return { renamed: true, name: subject };
    }
    const add = phone88(a.phone);
    if (!/^[0-9]{11,15}$/.test(add)) return { error: 'Which phone number to add?' };
    const r = await call(ctx, e.base + '/group/updateParticipant/' + encodeURIComponent(e.inst) + q, { headers: { apikey: e.key }, body: { action: 'add', participants: [add] } });
    if (!r.ok) return { error: 'WhatsApp refused (' + r.code + ') - the person may allow only their contacts to add them; send them the group link instead.' };
    return { added: add, group: str(f.g.subject) };
  }
  if (name === 'group_logo_all') {
    const n = (await ctx.tx`select count(*)::int n from customer_groups where business_id = ${ctx.biz} and status in ('made', 'invited') and group_jid is not null`)[0].n;
    if (!n) return { error: 'There are no customer groups yet.' };
    const S = await import('./sales.js');
    const q = await S.qProfile(ctx);
    if (!str(q.logoId) && !str(q.logoTrimId)) return { error: 'No shop logo is set (Settings > Invoice design > logo).' };
    return propose({ tool: 'group_logo_all', args: {}, summary: 'shop logo as the picture of all ' + n + ' customer groups, one group every 15 minutes (about ' + Math.ceil(n * 15 / 60) + ' hours, 10am-9pm)' });
  }
  return { error: 'Not available.' };
}

/** The confirmed change (bosschat confirm). */
export async function doMgrChange(ctx, p, c) {
  const a = c.args || {};
  if (c.tool === 'due_remind') {
    let seen = {};
    try { seen = JSON.parse(str(await getConfig(ctx, 'mgr_due_reminded', '')) || '{}') || {}; } catch (_) { seen = {}; }
    let sent = 0; const failed = [];
    for (const x of a.people || []) {
      const g = (await ctx.tx`select gender from customer_groups where business_id = ${ctx.biz} and phone = ${x.phone} limit 1`)[0];
      const r = await toCustomer(ctx, p, x.phone, remindText(x.name, x.due, g && g.gender));
      if (r.ok) { sent++; seen[x.phone] = ctx.now.toISOString(); } else failed.push(x.name || x.phone);
    }
    await setConfig(ctx, 'mgr_due_reminded', JSON.stringify(seen));
    return { sent, failed };
  }
  if (c.tool === 'group_logo_all') {
    const ids = (await ctx.tx`select id from customer_groups where business_id = ${ctx.biz} and status in ('made', 'invited') and group_jid is not null order by made_at`).map((r) => r.id);
    await setConfig(ctx, 'mgr_pic_queue', JSON.stringify({ ids, at: 0 }));
    return { queued: ids.length };
  }
  return null;
}

/** After a confirmed payment: thanks in the customer's group / WhatsApp and ❤️ on their last message there. */
export async function thankPayment(ctx, p, invoiceNo, amount) {
  const inv = (await ctx.tx`select customer_phone, customer_name from invoices where business_id = ${ctx.biz} and invoice_no = ${str(invoiceNo)} limit 1`)[0];
  const ph = inv ? phone88(inv.customer_phone) : '';
  if (!/^8801[3-9][0-9]{8}$/.test(ph)) return { thanked: false };
  const g = await (await import('./cgroups.js')).groupOf(ctx, ph);
  const { ai } = await channels(ctx, p);
  if (!ai) return { thanked: false };
  const t = await toCustomer(ctx, p, ph, 'জি ' + salute(g && g.gender) + ', ' + money(amount) + ' পেয়েছি, অনেক ধন্যবাদ 💙');
  // ❤️ on their last message in the same place (the payment screenshot, usually)
  try {
    const v = g && g.conversation_id ? g.conversation_id
      : ((await ctx.tx`select v.id from inbox_conversations v join inbox_contacts k on k.id = v.contact_id where v.channel_id = ${ai.id} and k.external_id = ${ph} limit 1`)[0] || {}).id;
    const m = v ? (await ctx.tx`select external_id, payload from inbox_messages where conversation_id = ${v} and direction = 'in' and coalesce(external_id, '') <> '' order by created_at desc limit 1`)[0] : null;
    const e = m && await evoOf(ctx, ai);
    if (e) {
      const remoteJid = g ? g.group_jid : ph + '@s.whatsapp.net';
      const participant = str(m.payload && (m.payload.participant || (m.payload.key && m.payload.key.participant)));
      await call(ctx, e.base + '/message/sendReaction/' + encodeURIComponent(e.inst), { headers: { apikey: e.key },
        body: { key: { remoteJid, fromMe: false, id: m.external_id, ...(participant ? { participant } : {}) }, reaction: '❤️' } });
    }
  } catch (_) { /* the thanks is enough */ }
  return { thanked: t.ok };
}

// ---------------------------------------------------------------- timers
async function toManager(ctx, p, text) {
  const { ai } = await channels(ctx, p);
  const phones = bossPhones(p.superior_wa);
  if (!ai || !phones.length) return 0;
  let n = 0;
  for (const ph of phones) { try { const r = await sendOut(ctx, ai, { external_id: ph }, { kind: 'text', text }); if (r.ok) n++; } catch (_) { /* next */ } }
  return n;
}
/** The day's summary for the manager (also erpMgrDaily for a test). */
export async function dailySummary(ctx) {
  const day = formatDate(ctx.now, 'yyyy-MM-dd');
  const sales = (await ctx.tx`select count(*)::int n, coalesce(sum(grand_total), 0) t from invoices where business_id = ${ctx.biz} and voided_at is null
                              and (created_at at time zone 'Asia/Dhaka')::date = ${day}::date`)[0];
  const web = (await ctx.tx`select count(*)::int n from web_orders where business_id = ${ctx.biz} and (order_date at time zone 'Asia/Dhaka')::date = ${day}::date`)[0].n;
  const waiting = await ctx.tx`select k.name from inbox_conversations v left join inbox_contacts k on k.id = v.contact_id
                               where v.business_id = ${ctx.biz} and v.last_in_at > ${new Date(ctx.now.getTime() - 24 * 3600e3)} and (v.last_out_at is null or v.last_in_at > v.last_out_at)
                               and v.last_in_at < ${new Date(ctx.now.getTime() - 30 * MIN)} order by v.last_in_at limit 30`;
  // parcels booked 3-10 days ago that the courier has not delivered yet (asked live, at most 15)
  const booked = await ctx.tx`select * from courier_log where business_id = ${ctx.biz} and booked_at between ${new Date(ctx.now.getTime() - 10 * 24 * 3600e3)} and ${new Date(ctx.now.getTime() - 3 * 24 * 3600e3)} order by booked_at limit 15`;
  const C = await import('./courier.js');
  const stuck = [];
  for (const b of booked) {
    let st = '';
    try { const s = await C.sfStatus(ctx, b.consignment_id); st = s ? s.status : ''; } catch (_) { st = ''; }
    if (st && !/delivered|cancelled/.test(st)) stuck.push(str(b.customer) + ' (' + str(b.invoice_no) + ', ' + parcelBn(st) + ')');
  }
  let dues = null;
  try { dues = await (await import('./money.js')).erpDues(ctx); } catch (_) { dues = null; }
  const L = ['📋 আজকের হিসাব (' + formatDate(ctx.now, 'd MMM') + ')',
    '• বিক্রি: ' + sales.n + 'টা ইনভয়েস, মোট ' + money(sales.t),
    '• ওয়েবসাইট অর্ডার: ' + web + 'টা',
    '• উত্তর বাকি চ্যাট: ' + (waiting.length ? waiting.length + 'টা (' + waiting.slice(0, 6).map((w) => str(w.name) || 'নাম নেই').join(', ') + (waiting.length > 6 ? '...' : '') + ')' : 'নেই'),
    '• আটকে থাকা পার্সেল: ' + (stuck.length ? stuck.length + 'টা - ' + stuck.slice(0, 5).join('; ') : 'নেই'),
    dues ? '• মোট বাকি: ' + money(dues.total) + ' (' + num(dues.count) + ' জন)' : ''];
  return L.filter(Boolean).join('\n');
}
export async function stockWatch(ctx, p) {
  const ib = await import('./inbox.js');
  const cat = await ib.catalogue(ctx);
  let seen = null;
  try { seen = JSON.parse(str(await getConfig(ctx, 'mgr_stock_seen', '')) || 'null'); } catch (_) { seen = null; }
  const now = {};
  for (const x of cat) if (str(x.status || 'Active') === 'Active' || num(x.stock) > 0) now[x.sku] = num(x.stock);
  await setConfig(ctx, 'mgr_stock_seen', JSON.stringify(now));
  if (!seen) return { first: true };
  const low = [], back = [];
  for (const x of cat) {
    const was = seen[x.sku], is = num(x.stock);
    if (was == null) continue;
    if (was > 2 && is <= 2) low.push(x.name + (is <= 0 ? ' - শেষ' : ' - আর ' + is + 'টা'));
    if (was <= 0 && is > 0) back.push(x);
  }
  const lines = [];
  if (low.length) lines.push('⚠️ স্টক ফুরিয়ে আসছে:\n' + low.slice(0, 15).map((s) => '• ' + s).join('\n'));
  for (const x of back.slice(0, 6)) {
    const color = str(x.color || (x.name.match(/(black|white|red|blue|green|grey|gray|yellow|pink|orange|purple|brown|silver|gold|beige|transparent|clear)/i) || [])[0]);
    const words = [color, str(x.brand)].filter((w) => w.length >= 3);
    let who = [];
    if (words.length) {
      who = await ctx.tx`select distinct on (v.id) k.name from inbox_messages m join inbox_conversations v on v.id = m.conversation_id left join inbox_contacts k on k.id = v.contact_id
                         where m.business_id = ${ctx.biz} and m.direction = 'in' and m.created_at > ${new Date(ctx.now.getTime() - 30 * 24 * 3600e3)}
                         and m.text ilike ${'%' + words[0] + '%'} and (${words.length < 2} or m.text ilike ${'%' + (words[1] || '') + '%'}) limit 5`;
    }
    lines.push('✅ আবার স্টকে: ' + x.name + ' (' + num(x.stock) + 'টা)' + (who.length ? '\n   আগে জানতে চেয়েছিলেন: ' + who.map((w) => str(w.name) || 'নাম নেই').join(', ') + ' - জানাতে বললে জানিয়ে দেব।' : ''));
  }
  if (!lines.length) return { quiet: true };
  return { sent: await toManager(ctx, p, lines.join('\n\n')) };
}
async function picStep(ctx, p) {
  let q = null;
  try { q = JSON.parse(str(await getConfig(ctx, 'mgr_pic_queue', '')) || 'null'); } catch (_) { q = null; }
  if (!q || !Array.isArray(q.ids) || !q.ids.length) return null;
  if (q.at && ctx.now.getTime() - q.at < 15 * MIN) return { wait: true };
  const id = q.ids.shift();
  q.at = ctx.now.getTime();
  await setConfig(ctx, 'mgr_pic_queue', JSON.stringify(q));
  const g = (await ctx.tx`select * from customer_groups where id = ${id}`)[0];
  const { maker } = await channels(ctx, p);
  const e = maker && await evoOf(ctx, maker);
  if (!g || !g.group_jid || !e) return { skipped: id };
  const S = await import('./sales.js');
  const pq = await S.qProfile(ctx);
  const data = (await S.docImg(ctx, pq.logoId)) || (await S.docImg(ctx, pq.logoTrimId));
  if (!data) { await setConfig(ctx, 'mgr_pic_queue', ''); return { error: 'no logo' }; }
  const r = await call(ctx, e.base + '/group/updateGroupPicture/' + encodeURIComponent(e.inst) + '?groupJid=' + encodeURIComponent(g.group_jid), { headers: { apikey: e.key }, body: { image: data.replace(/^data:[^,]+,/, '') } });
  if (!q.ids.length) await toManager(ctx, p, '✅ সব কাস্টমার গ্রুপে লোগো বসানো শেষ।');
  return { pic: g.id, ok: r.ok, left: q.ids.length };
}
/** The inbox timer (every minute). */
export async function mgrTick(ctx) {
  const { profile } = await import('./inbox.js');
  const p = await profile(ctx, false);
  if (!bossPhones(p.superior_wa).length) return { off: true };
  const h = Number(formatDate(ctx.now, 'H')), m = Number(formatDate(ctx.now, 'm')), day = formatDate(ctx.now, 'yyyy-MM-dd');
  const out = {};
  if (h >= 10 && h < 21) { try { out.pic = await ctx.tx.savepoint(() => picStep(ctx, p)); } catch (e) { out.pic = { error: str(e && e.message).slice(0, 120) }; } }
  if (h >= 10 && h <= 21 && m < 5) {
    const hk = day + ' ' + h;
    if (str(await getConfig(ctx, 'mgr_stock_hour', '')) !== hk) {
      await setConfig(ctx, 'mgr_stock_hour', hk);
      try { out.stock = await ctx.tx.savepoint(() => stockWatch(ctx, p)); } catch (e) { out.stock = { error: str(e && e.message).slice(0, 120) }; }
    }
  }
  if ((h === 21 && m >= 30) || h === 22) {
    if (str(await getConfig(ctx, 'mgr_daily_last', '')) !== day) {
      await setConfig(ctx, 'mgr_daily_last', day);
      try { out.daily = { sent: await toManager(ctx, p, await dailySummary(ctx)) }; } catch (e) { out.daily = { error: str(e && e.message).slice(0, 120) }; }
    }
  }
  return out;
}
