// hold-1 (owner 6 Nov 2026): "Waiting for confirmation" - an order that becomes an invoice only after the customer's OK.
//
//   The New invoice screen's second button, "Send for confirmation", sends the same call as Save (erpCreateInvoice)
//   with `hold`. It is checked by exactly the invoice's own rules (createInvoice opts.preview: stock, prices, discount
//   limit, cash-on-delivery rules, pre-order holds) and kept here; nothing is written to stock, money or the invoice
//   counter. The customer gets the bill picture and a link on WhatsApp (or the link by hand). They press Confirm on
//   the page, or answer "confirm" / "ok" on WhatsApp: that marks it "customer said yes" and alerts the team. The team
//   presses Confirm: the invoice is made through erpCreateInvoice (every check again, as the person confirming), the
//   stock goes down, and the page books the parcel on Steadfast when that was ticked. Not confirmed in time: expired
//   by the nightly job. Nothing is ever deleted.
//
//   erpHolds({pile})          the list: waiting (default) | closed (last 60 days)
//   erpHoldGet({id})          one order with what it would put on the New invoice screen (Edit)
//   erpHoldSend({id, channelId})  send (again) on a WhatsApp number
//   erpHoldConfirm({id})      make the invoice
//   erpHoldCancel({id, reason})
//   public (index.ts ?inbox=hold|holdbill&h=<token>): holdPage, holdAct ('yes' | 'no'), holdBill (PNG)

import { createInvoice, erpCreateInvoice } from './invoice.js';
import { erpCatalog } from './catalog.js';
import { lock } from './money.js';
import { num, formatDate } from '../lib/time.js';
import { billSvg } from '../lib/billsvg.js';
import { profile, deliver, upsertContact, upsertConv, writeMsgNote } from './inbox.js';
import { purposeOf } from './wanumbers.js';
import { pushTeam } from './phonealerts.js';

const str = (v) => String(v == null ? '' : v).trim();
const DAY = 86400000;
const NF = { status: 404, body: { ok: false, error: 'This page is not available.' } };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const last10 = (p) => str(p).replace(/[^0-9]/g, '').slice(-10);
const waDigits = (p) => { const d = str(p).replace(/[^0-9]/g, ''); return d.length === 11 && d.startsWith('0') ? '88' + d : d.startsWith('880') ? d : d; };
/** "confirm", "ok", "yes", "হ্যাঁ", "ঠিক আছে", "কনফার্ম" ... on its own (a short answer, not a sentence that mentions it). */
export const YES = /^\s*(confirm(ed)?|ok(ay)?|yes|yep|done|thik ache|thik|hya|ha|haa|জি|জ্বি|হ্যাঁ|হা|হ্যা|ঠিক আছে|ঠিক|কনফার্ম|কনফার্ম করলাম|কনফার্ম করুন|ওকে|অর্ডার কনফার্ম)\s*[.!।✅👍]*\s*$/i;

function pageBase(ctx) { return String((ctx.deps && ctx.deps.google && ctx.deps.google.appUrl) || 'https://erp.costareen.com/').replace(/#.*$/, '').replace(/\/+$/, ''); }
function api(ctx) { return String((ctx.deps && ctx.deps.hookBase) || ''); }
const withQ = (url, q) => url + (url.includes('?') ? '&' : '?') + q;
export function holdLink(ctx, h) { return pageBase(ctx) + '/hold.html?h=' + h.token + (api(ctx) ? '&api=' + encodeURIComponent(api(ctx)) : ''); }
export function holdBillLink(ctx, h) { return api(ctx) ? withQ(api(ctx), 'inbox=holdbill&h=' + h.token) : ''; }
function token() { const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
async function shop(ctx) {
  let p = {}; try { p = await profile(ctx, false); } catch (_) { p = {}; }
  const b = (await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0] || {};
  return { name: str(p.name) || str(b.name), phone: str(p.phone), address: str(p.address), colour: str(p.colour), lang: p.lang === 'en' ? 'en' : 'bn' };
}
const live = (h, now) => h.status === 'waiting' && !(h.expires_at && new Date(h.expires_at) <= now);

/** erpCreateInvoice with `hold`: checked like the invoice, then kept (nothing written to the books). */
export async function makeHold(ctx, payload) {
  const opt = payload.hold && typeof payload.hold === 'object' ? payload.hold : {};
  const clean = { ...payload }; delete clean.hold;
  if (str(clean.restockId)) throw new Error('An order from the waiting list is saved as an invoice straight away.');
  const pv = await createInvoice(ctx, clean, { preview: true });
  if (pv.lines.some((l) => l.joint)) throw new Error('Joint-stock lines are sold at once: save this one as an invoice.');
  const days = Math.max(1, Math.min(30, Math.round(num(opt.days) || 7)));
  await lock(ctx, 'hold');
  const n = num((await ctx.tx`select count(*)::int n from order_holds where business_id = ${ctx.biz}`)[0].n) + 1;
  const no = 'ORD-' + String(n).padStart(4, '0');
  const snap = { lines: pv.lines, sub: pv.sub, discount: pv.discount, delivery: pv.delivery, grand: pv.grand, took: pv.took, mode: pv.mode,
                 method: pv.method, name: pv.name, phone: pv.phone, address: pv.address, source: pv.source };
  const h = (await ctx.tx`insert into order_holds (business_id, hold_no, payload, snap, customer_name, customer_phone, grand_total, token, book_courier,
                            created_by, created_name, expires_at)
                          values (${ctx.biz}, ${no}, ${ctx.tx.json(clean)}, ${ctx.tx.json(snap)}, ${pv.name}, ${pv.phone || null}, ${pv.grand}, ${token()},
                            ${!!opt.courier}, ${ctx.s.userId || null}, ${ctx.s.name || null}, ${new Date(ctx.now.getTime() + days * DAY)}) returning *`)[0];
  let sent = { ok: false, error: '' };
  if (opt.send === 'wa') sent = await sendWa(ctx, h, str(opt.channelId));
  return { held: true, id: h.id, holdNo: no, grandTotal: pv.grand, link: holdLink(ctx, h), sent: !!sent.ok, sendError: sent.ok ? '' : str(sent.error),
           via: sent.via || '', customer: pv.name, phone: pv.phone, expires: formatDate(new Date(h.expires_at), 'd MMM yyyy') };
}

/** The WhatsApp numbers that can send it: live ones, the "Sending only" number first. */
async function senders(ctx) {
  const rows = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind in ('wa_evo', 'wa_cloud', 'wa_sender') and status = 'live' order by created_at`;
  const rank = (c) => (purposeOf(c) === 'send' ? 0 : purposeOf(c) === 'chat' ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b));
}
function message(ctx, h, lang) {
  const s = h.snap || {}, link = holdLink(ctx, h), tk = '৳' + Math.round(num(s.grand)).toLocaleString('en-IN');
  return lang === 'en'
    ? 'Hello ' + str(h.customer_name) + ', here is your order ' + h.hold_no + ' - total ' + tk + '.\nIf everything is right, press Confirm here: ' + link + '\nor simply reply CONFIRM.'
    : 'আসসালামু আলাইকুম ' + str(h.customer_name) + ', আপনার অর্ডার ' + h.hold_no + ' - মোট ' + tk + '।\nসব ঠিক থাকলে এই লিংকে Confirm চাপুন: ' + link + '\nঅথবা এখানে শুধু CONFIRM লিখে উত্তর দিন।';
}
async function sendWa(ctx, h, channelId) {
  const digits = waDigits(h.customer_phone);
  if (!/^8801[3-9][0-9]{8}$/.test(digits)) return { ok: false, error: 'This order has no customer phone, so it cannot go on WhatsApp. Send the link by hand.' };
  const list = await senders(ctx);
  const ch = channelId ? list.find((c) => c.id === channelId) : list[0];
  if (!ch) return { ok: false, error: channelId ? 'That WhatsApp number is not live.' : 'No WhatsApp number is connected yet (Inbox > Chat settings).' };
  const sh = await shop(ctx);
  const contact = await upsertContact(ctx, ch, { from: digits, name: str(h.customer_name) });
  const conv = await upsertConv(ctx, ch, contact);
  const text = message(ctx, h, sh.lang), bill = holdBillLink(ctx, h);
  const msg = bill && ctx.deps && ctx.deps.svgPng ? { kind: 'image', url: bill, caption: text } : { kind: 'text', text };
  let r;
  try { r = await deliver(ctx, ch, conv, contact, msg, { author: 'team', userId: ctx.s.userId || null, userName: ctx.s.name || 'ERP' }); }
  catch (e) { r = { ok: false, error: str(e && e.message ? e.message : e) }; }
  if (r.ok) await ctx.tx`update order_holds set sent_at = now(), sent_via = ${ch.name} where id = ${h.id}`;
  return { ok: !!r.ok, error: r.ok ? '' : (str(r.error) || 'WhatsApp did not take the message.'), via: ch.name };
}

async function holdOf(ctx, id) {
  const h = (await ctx.tx`select * from order_holds where business_id = ${ctx.biz} and id = ${str(id)}`)[0];
  if (!h) throw new Error('No such order.');
  return h;
}
function out(ctx, h, stock) {
  const s = h.snap || {}, now = ctx.now;
  const short = stock ? (s.lines || []).filter((l) => { const p = stock[str(l.sku).toLowerCase()]; return !p || num(p.stock) < num(l.qty); }).map((l) => l.name) : [];
  return { id: h.id, no: h.hold_no, status: live(h, now) ? 'waiting' : h.status === 'waiting' ? 'expired' : h.status,
    customer: str(h.customer_name), phone: str(h.customer_phone), grand: num(h.grand_total), items: (s.lines || []).length,
    lines: (s.lines || []).map((l) => ({ name: l.name, qty: l.qty, total: l.total })),
    made: formatDate(new Date(h.created_at), 'd MMM, h:mm a'), madeBy: str(h.created_name), days: Math.floor((now - new Date(h.created_at)) / DAY),
    expires: h.expires_at ? formatDate(new Date(h.expires_at), 'd MMM') : '', sentVia: str(h.sent_via), sent: !!h.sent_at,
    customerOk: !!h.customer_ok_at, customerOkHow: str(h.customer_ok_how), customerOkAt: h.customer_ok_at ? formatDate(new Date(h.customer_ok_at), 'd MMM, h:mm a') : '',
    customerNo: !!h.customer_no_at, courier: !!h.book_courier, invoiceNo: str(h.invoice_no), reason: str(h.closed_reason),
    confirmedBy: str(h.confirmed_name), link: holdLink(ctx, h), short };
}

export async function erpHolds(ctx, payload) {
  const pile = str(payload && payload.pile) === 'closed' ? 'closed' : 'waiting';
  const rows = pile === 'waiting'
    ? await ctx.tx`select * from order_holds where business_id = ${ctx.biz} and status = 'waiting' order by (customer_ok_at is null), created_at desc limit 300`
    : await ctx.tx`select * from order_holds where business_id = ${ctx.biz} and status <> 'waiting' and created_at > ${new Date(ctx.now.getTime() - 60 * DAY)} order by created_at desc limit 300`;
  let stock = null;
  if (pile === 'waiting' && rows.length) { stock = {}; for (const p of await erpCatalog(ctx)) stock[str(p.sku).toLowerCase()] = p; }
  const list = rows.map((h) => out(ctx, h, stock));
  const chans = (await senders(ctx)).map((c) => ({ id: c.id, name: c.name, purpose: purposeOf(c) }));
  return { list, waiting: list.filter((x) => x.status === 'waiting').length, saidYes: list.filter((x) => x.status === 'waiting' && x.customerOk).length, channels: chans };
}

export async function erpHoldGet(ctx, payload) {
  const h = await holdOf(ctx, payload && payload.id);
  return { ...out(ctx, h, null), payload: h.payload };
}

export async function erpHoldSend(ctx, payload) {
  const h = await holdOf(ctx, payload && payload.id);
  if (!live(h, ctx.now)) throw new Error('This order is no longer waiting.');
  const r = await sendWa(ctx, h, str(payload && payload.channelId));
  if (!r.ok) throw new Error(r.error);
  return { sent: true, via: r.via };
}

export async function erpHoldConfirm(ctx, payload) {
  await lock(ctx, 'hold');
  const h = await holdOf(ctx, payload && payload.id);
  if (h.status === 'confirmed') throw new Error(h.hold_no + ' is already invoice ' + h.invoice_no + '.');
  if (!live(h, ctx.now)) throw new Error(h.hold_no + ' is no longer waiting (' + (h.status === 'waiting' ? 'expired' : h.status) + '). Make it again from New invoice.');
  const p = { ...(h.payload || {}) };
  const how = h.customer_ok_at ? 'the customer confirmed ' + (h.customer_ok_how === 'whatsapp' ? 'on WhatsApp' : 'on the page') : 'confirmed by ' + str(ctx.s.name || 'the team');
  p.note = [str(p.note), 'Order ' + h.hold_no + ' - ' + how].filter(Boolean).join('; ');
  delete p.date;   // the sale is today's: the day it was confirmed
  const res = await erpCreateInvoice(ctx, p);
  await ctx.tx`update order_holds set status = 'confirmed', confirmed_at = now(), confirmed_name = ${ctx.s.name || null}, invoice_no = ${res.invoiceNo} where id = ${h.id}`;
  return { ...res, holdNo: h.hold_no, bookCourier: !!h.book_courier };
}

export async function erpHoldCancel(ctx, payload) {
  const h = await holdOf(ctx, payload && payload.id);
  if (h.status !== 'waiting') throw new Error(h.hold_no + ' is already ' + h.status + '.');
  const why = str(payload && payload.reason).slice(0, 200) || 'Cancelled';
  await ctx.tx`update order_holds set status = 'cancelled', closed_reason = ${why + ' (' + str(ctx.s.name || 'team') + ')'} where id = ${h.id}`;
  return { cancelled: true, no: h.hold_no };
}

/** nightly: waiting orders past their day are closed. */
export async function expireHolds(ctx) {
  const r = await ctx.tx`update order_holds set status = 'expired', closed_reason = 'Not confirmed in time'
                         where business_id = ${ctx.biz} and status = 'waiting' and expires_at <= ${ctx.now} returning id`;
  return { expired: r.length };
}

/** A customer's short "confirm" / "ok" on WhatsApp, while one of their orders waits: marked, and the team is told. */
export async function holdReply(ctx, ch, contact, conv, text) {
  if (!/^wa_/.test(str(ch && ch.kind)) || !YES.test(str(text))) return false;
  const ph = last10(contact && (contact.phone || contact.external_id));
  if (ph.length !== 10) return false;
  const rows = await ctx.tx`select * from order_holds where business_id = ${ctx.biz} and status = 'waiting' and customer_ok_at is null and sent_at is not null
                            and expires_at > ${ctx.now} order by sent_at desc limit 20`;
  const h = rows.find((x) => last10(x.customer_phone) === ph);
  if (!h) return false;
  await ctx.tx`update order_holds set customer_ok_at = now(), customer_ok_how = 'whatsapp' where id = ${h.id}`;
  try { await writeMsgNote(ctx, conv, 'Customer confirmed order ' + h.hold_no + ' (' + '৳' + Math.round(num(h.grand_total)) + '). Waiting for the team\'s Confirm.'); } catch (_) { /* the note is a nicety */ }
  await pushTeam(ctx, { title: 'Order ' + h.hold_no + ' confirmed by the customer', body: str(h.customer_name) + ' said yes on WhatsApp. Press Confirm to make the invoice.', url: '/#/holds', tag: 'hold-' + h.id });
  return h.hold_no;
}

// ------------------------------------------------------------------ the customer's page
const WORDS = {
  en: { title: 'Your order', waiting: 'Waiting for your confirmation', yes: 'Confirm the order', no: 'Not now', okDone: 'Thank you - you confirmed. We will send it soon.',
        noDone: 'Noted - we will not send it. Call us if you change your mind.', confirmed: 'Confirmed - the invoice is made', cancelled: 'This order was cancelled', expired: 'This order has expired - ask us again',
        sub: 'Subtotal', disc: 'Discount', del: 'Delivery', total: 'Total', paid: 'Paid already', cod: 'Pay on delivery', call: 'Call the shop' },
  bn: { title: 'আপনার অর্ডার', waiting: 'আপনার নিশ্চিতকরণের অপেক্ষায়', yes: 'অর্ডার কনফার্ম করুন', no: 'এখন না', okDone: 'ধন্যবাদ - আপনি কনফার্ম করেছেন। শিগগিরই পাঠানো হবে।',
        noDone: 'লেখা হলো - পাঠানো হবে না। মত বদলালে ফোন করুন।', confirmed: 'কনফার্ম হয়েছে - ইনভয়েস তৈরি', cancelled: 'এই অর্ডার বাতিল হয়েছে', expired: 'এই অর্ডারের সময় শেষ - আবার জানান',
        sub: 'মোট পণ্য', disc: 'ছাড়', del: 'ডেলিভারি', total: 'সর্বমোট', paid: 'আগে দেওয়া', cod: 'ডেলিভারিতে দিতে হবে', call: 'দোকানে কল' },
};
async function byToken(ctx, tok) {
  if (!/^[0-9a-f]{32}$/.test(str(tok))) return null;
  return (await ctx.tx`select * from order_holds where business_id = ${ctx.biz} and token = ${tok}`)[0] || null;
}
function maskPhone(ph) { ph = str(ph); return ph.length > 6 ? ph.slice(0, 3) + '•••••' + ph.slice(-3) : ph; }
async function pageBody(ctx, h) {
  const sh = await shop(ctx), s = h.snap || {};
  const state = h.status === 'confirmed' ? 'confirmed' : h.status === 'cancelled' ? 'cancelled' : !live(h, ctx.now) ? 'expired'
              : h.customer_no_at ? 'said_no' : h.customer_ok_at ? 'said_yes' : 'waiting';
  return { status: 200, body: { ok: true, lang: sh.lang, words: WORDS, shop: { name: sh.name, phone: sh.phone }, bill: holdBillLink(ctx, h),
    order: { no: h.hold_no, date: formatDate(new Date(h.created_at), 'd MMM yyyy'), name: str(h.customer_name), phone: maskPhone(h.customer_phone), address: str(s.address),
      lines: (s.lines || []).map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, total: l.total })),
      sub: num(s.sub), discount: num(s.discount), delivery: num(s.delivery), grand: num(s.grand), paid: num(s.took), cod: s.mode === 'cod',
      state, canAnswer: state === 'waiting' } } };
}
export async function holdPage(ctx, tok) { const h = await byToken(ctx, tok); return h ? pageBody(ctx, h) : NF; }
export async function holdAct(ctx, tok, b) {
  const h = await byToken(ctx, tok);
  if (!h) return NF;
  const a = str(b && b.a);
  if (live(h, ctx.now) && !h.customer_ok_at && !h.customer_no_at && (a === 'yes' || a === 'no')) {
    if (a === 'yes') await ctx.tx`update order_holds set customer_ok_at = now(), customer_ok_how = 'page' where id = ${h.id}`;
    else await ctx.tx`update order_holds set customer_no_at = now() where id = ${h.id}`;
    await pushTeam(ctx, { title: 'Order ' + h.hold_no + (a === 'yes' ? ' confirmed by the customer' : ': the customer said no'),
      body: str(h.customer_name) + (a === 'yes' ? ' pressed Confirm. Press Confirm to make the invoice.' : ' pressed "Not now".'), url: '/#/holds', tag: 'hold-' + h.id });
  }
  return pageBody(ctx, (await byToken(ctx, tok)));
}
export async function holdBill(ctx, tok) {
  const h = await byToken(ctx, tok);
  if (!h || !ctx.deps.svgPng) return null;
  const sh = await shop(ctx), s = h.snap || {};
  const svg = billSvg({ name: sh.name, phone: sh.phone, address: sh.address, colour: sh.colour },
    { no: h.hold_no, label: sh.lang === 'en' ? 'ORDER - PLEASE CONFIRM' : 'অর্ডার - কনফার্ম করুন', date: formatDate(new Date(h.created_at), 'd MMM yyyy'),
      name: h.customer_name, phone: h.customer_phone, address: s.address,
      items: (s.lines || []).map((l) => ({ name: l.name, qty: l.qty, price: l.unit })), discount: num(s.discount), delivery: num(s.delivery),
      payNote: s.mode === 'cod' ? (sh.lang === 'en' ? 'Pay on delivery: ' : 'ডেলিভারিতে দিতে হবে: ') + '৳' + Math.round(num(s.grand) - num(s.took)).toLocaleString('en-IN')
             : num(s.took) >= num(s.grand) - 0.5 ? (sh.lang === 'en' ? 'Paid' : 'পরিশোধিত') : (sh.lang === 'en' ? 'Reply CONFIRM to confirm' : 'কনফার্ম করতে CONFIRM লিখুন') });
  return await ctx.deps.svgPng(svg);
}

export const HANDLERS = { erpHolds, erpHoldGet, erpHoldSend, erpHoldConfirm, erpHoldCancel };
