// Order landing pages, unfinished orders and the fake-order shield (135; owner 20 Oct 2026, after comparing with
// Bizmation: "make improvement"). They live in the Inbox (an owner-only app) and use its orders (chat_orders):
// a landing-page order is approved into an invoice exactly like an order taken in a chat.
//
// Screens (signed in):
//   erpLandingPages()                         the pages, each with its link, views, orders, unfinished, conversion
//   erpLandingSave({id?, sku, headline, points, offerPrice, colour, active})   one click: a product is enough  (manager)
//   erpLandingDrafts({status})                visitors who typed their phone number but did not order
//   erpLandingDraftAct({id, action: called|dismiss|reopen|order, note})        'order' makes the chat order    (sales)
//   erpOrderShield()                          the block list and the orders the shield flagged
//   erpOrderShieldSet({block:{kind, value, reason}} | {unblock: id} | {recheck: orderId})                     (manager)
//   orderRisk(ctx, o)                         the shield's reading of one order: { level, score, reasons, blocked }
//
// The public page (index.ts ?inbox=land&p=<token>; web/land.html): GET the page; POST {a:'view'|'draft'|'buy', ...}.

import { num, formatDate } from '../lib/time.js';
import { feat, needFeat } from '../lib/inboxplan.js';
import { profile, catalogue, imageUrl, deliveryFor, nextOrderNo, orderEvent, task, phoneOk } from './inbox.js';
import { orderLink } from './inboxpub.js';
import { roleAtLeast } from '../allow.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { custKey } from '../lib/phone.js';
import { paymentsTab, PAY } from '../lib/tabs.js';

const str = (v) => String(v == null ? '' : v).trim();
const NF = { status: 404, body: { ok: false, error: 'This page is not available.' } };
const isId = (s) => /^[0-9a-f-]{36}$/i.test(str(s));
function need(ctx, role) { if (!roleAtLeast(ctx.s.role, role || 'sales')) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).'); }
function pageBase(ctx) { return String((ctx.deps && ctx.deps.google && ctx.deps.google.appUrl) || 'https://erp.costareen.com/').replace(/#.*$/, '').replace(/\/+$/, ''); }
export function landingLink(ctx, pg) {
  const api = str(ctx.deps && ctx.deps.hookBase);
  return pageBase(ctx) + '/land.html?p=' + pg.token + (api ? '&api=' + encodeURIComponent(api) : '');
}

// ------------------------------------------------------------------ the shield
/**
 * One order's risk, from what this business knows: the block list, the buyer's own parcels with us (returned before?),
 * the same number with another open order, many orders from one internet address, a name / address that cannot be
 * real, a big cash-on-delivery quantity. -> { level: ok|watch|risky|blocked, score 0-100, reasons: [] }
 */
export async function orderRisk(ctx, o) {
  const reasons = []; let score = 0;
  const phone = phoneOk(o.phone) || str(o.phone), ip = str(o.ip);
  const blocks = await ctx.tx`select kind, value, reason from order_blocks where business_id = ${ctx.biz}
                              and ((kind = 'phone' and value = ${phone}) or (kind = 'ip' and ${ip} <> '' and value = ${ip}))`;
  if (blocks.length) return { level: 'blocked', score: 100, reasons: blocks.map((b) => (b.kind === 'phone' ? 'This number is on the block list' : 'This internet address is on the block list') + (b.reason ? ': ' + b.reason : '')), blocked: true };
  if (!phoneOk(o.phone)) { score += 40; reasons.push('Not a Bangladeshi mobile number'); }
  // the buyer's own parcels and cancelled orders with this shop - fairly (136): the shop's own faults never count,
  // old ones count less and fade out, and good deliveries since then count for the buyer. One bad day is not a ban.
  const h = await fairHistory(ctx, phone, o.id);
  const returns = [];
  if (h.returnedW >= 2 && h.rate >= 0.4) { score += 50; reasons.push('Returned ' + h.returned + ' of ' + h.parcels + ' parcels before'); }
  else if (h.returnedW >= 1) { score += 20; reasons.push(h.returned + ' parcel returned before'); }
  else if (h.returnedW > 0) { score += 8; reasons.push(h.returned + ' parcel returned a long time ago'); }
  else if (h.delivered) { score -= 15; reasons.push(h.delivered + ' parcel(s) delivered before, none returned'); }
  if (h.returned && h.deliveredSince >= 2) { score -= 20; reasons.push(h.deliveredSince + ' delivered since the last return'); }
  if (h.cancelledW >= 2) { score += 15; reasons.push(h.cancelled + ' earlier orders cancelled'); } else if (h.cancelled) { score += 5; reasons.push(h.cancelled + ' earlier order cancelled'); }
  if (h.excused) reasons.push(h.excused + ' return(s) / cancellation(s) were our own fault - not counted');
  for (const r of h.returnList) returns.push(r);
  // the same number with another order still open (a double order, or a game)
  const open = (await ctx.tx`select count(*)::int as n from chat_orders where business_id = ${ctx.biz} and phone = ${phone} and status in ('pending', 'hold')
                             and created_at > now() - interval '3 days' and id <> coalesce(${o.id || null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`)[0].n;
  if (open) { score += 20; reasons.push(open + ' other open order(s) from the same number'); }
  if (ip) {
    const sameIp = (await ctx.tx`select count(distinct phone)::int as n from chat_orders where business_id = ${ctx.biz} and ip = ${ip} and created_at > now() - interval '1 day'
                                 and id <> coalesce(${o.id || null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`)[0].n;
    if (sameIp >= 2) { score += 25; reasons.push(sameIp + ' other numbers ordered from the same internet address today'); }
  }
  const name = str(o.name);
  if (name.length < 3 || /^(test|asdf|abc|xyz|qwe|na|n\/a|fake|\d+)$/i.test(name) || /(.)\1{3,}/.test(name)) { score += 20; reasons.push('The name does not look real'); }
  const addr = str(o.address);
  if (addr.length < 10 || !/[a-zঀ-৿]{3,}/i.test(addr) || /^(test|asdf|abc|xyz)/i.test(addr)) { score += 15; reasons.push('The address is too short to deliver to'); }
  const qty = (o.items || []).reduce((t, x) => t + num(x.qty), 0);
  if (qty >= 6) { score += 10; reasons.push(qty + ' pieces on cash on delivery'); }
  score = Math.max(0, Math.min(99, score));
  return { level: score >= 50 ? 'risky' : score >= 20 ? 'watch' : 'ok', score, reasons, blocked: false, returns };
}

/** How long ago, in months. Within 6 months a return counts whole, 6-12 months half, older not at all. */
const weightOf = (when, now) => { const m = (now.getTime() - new Date(when).getTime()) / (30.4 * 864e5); return m <= 6 ? 1 : m <= 12 ? 0.5 : 0; };
/** What the shop says was its own doing when it cancelled (these never count against the customer). */
const OUR_SIDE = /our (fault|side|mistake)|we (were|are|sent)|wrong (item|product|colou?r|size)|out of stock|no stock|stock out|late|delay|price (changed|wrong)|damaged by|courier lost|lost by/i;
/**
 * The buyer's own record with this shop (136): parcels delivered and returned (from the invoices and the courier),
 * cancelled chat orders - minus what the shop marked as its own fault (delivery_excuses) or cancelled for its own
 * reasons - with old events weighted down. -> { parcels, delivered, returned, returnedW, rate, deliveredSince,
 * cancelled, cancelledW, excused, returnList: [{ ref, at }] }
 */
export async function fairHistory(ctx, phone, skipOrderId) {
  const key = custKey(phone, '');
  const out = { parcels: 0, delivered: 0, returned: 0, returnedW: 0, rate: 0, deliveredSince: 0, cancelled: 0, cancelledW: 0, excused: 0, returnList: [] };
  if (!key || key === 'n:') return out;
  const excused = new Set((await ctx.tx`select ref from delivery_excuses where business_id = ${ctx.biz}`).map((r) => str(r.ref)));
  const rows = await ctx.tx`select invoice_no, delivery_status, customer_phone, customer_name, created_at from invoices
                            where business_id = ${ctx.biz} and voided_at is null and invoice_no not like 'RTN-%' order by created_at`;
  const booked = new Set((await ctx.tx`select invoice_no from courier_log where business_id = ${ctx.biz}`).map((r) => str(r.invoice_no)));
  const codPaid = new Set();
  try { for (const p of await paymentsTab(ctx)) if (/steadfast|courier/i.test(String(p[PAY.method] || ''))) codPaid.add(str(p[PAY.order_id])); } catch (_) { /* none */ }
  let returnedRaw = 0, deliveredW = 0;
  for (const r of rows) {
    if (custKey(r.customer_phone, r.customer_name) !== key) continue;
    const no = str(r.invoice_no), st = str(r.delivery_status).toLowerCase();
    if (!booked.has(no) && !codPaid.has(no) && !/deliver|return|cancel|refus/.test(st)) continue;
    const ret = /return|cancel|refus/.test(st), w = weightOf(r.created_at, ctx.now);
    if (ret && excused.has(no)) { out.excused++; continue; }
    out.parcels++;
    if (ret) { out.returned++; returnedRaw++; out.returnedW += w; out.deliveredSince = 0; out.returnList.push({ ref: no, at: formatDate(new Date(r.created_at), 'd MMM yyyy') }); }
    else if (/deliver/.test(st) || codPaid.has(no)) { out.delivered++; deliveredW += w || 0.25; if (returnedRaw) out.deliveredSince++; }
  }
  out.rate = out.returnedW / Math.max(0.0001, out.returnedW + deliveredW);
  for (const c of await ctx.tx`select no, cancel_reason, created_at from chat_orders where business_id = ${ctx.biz} and phone = ${phoneOk(phone) || phone} and status = 'cancelled'
                               and id <> coalesce(${skipOrderId || null}::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`) {
    if (excused.has(str(c.no)) || OUR_SIDE.test(str(c.cancel_reason))) { out.excused++; continue; }
    out.cancelled++; out.cancelledW += weightOf(c.created_at, ctx.now);
  }
  out.returnList = out.returnList.slice(-5);
  return out;
}

// ------------------------------------------------------------------ what happens to a RISKY order (136)
// 'warn'    it comes in like any other, marked RISKY (the default)
// 'advance' it waits (on hold) until the delivery charge (or a set amount) is paid by bKash / Nagad; the page says how
// 'confirm' it waits (on hold) until the team has called and confirmed
// Only a number on the block list is refused online - never a customer for one bad delivery.
export async function shieldSettings(ctx) {
  let s = {}; try { s = JSON.parse(str(await getConfig(ctx, 'order_shield', '')) || '{}') || {}; } catch (_) { s = {}; }
  return { risky: ['warn', 'advance', 'confirm'].includes(s.risky) ? s.risky : 'warn', advanceHow: str(s.advanceHow), advanceAmount: Math.max(0, num(s.advanceAmount)) };
}
/** A RISKY order is held as the settings say. -> { status, hold, advance? } */
export async function riskyHold(ctx, risk, charge) {
  if (!risk || risk.level !== 'risky') return null;
  const S = await shieldSettings(ctx);
  if (S.risky === 'advance') {
    const amount = S.advanceAmount || num(charge);
    return { hold: 'Advance asked: ৳' + Math.round(amount) + (S.advanceHow ? ' (' + S.advanceHow + ')' : '') + ' - the shield said RISKY', advance: { amount: Math.round(amount), how: S.advanceHow } };
  }
  if (S.risky === 'confirm') return { hold: 'Call to confirm - the shield said RISKY' };
  return null;
}

// ------------------------------------------------------------------ the pages (signed in)
async function pageView(ctx, pg, cat) {
  const x = cat.find((y) => y.sku.toLowerCase() === str(pg.sku).toLowerCase());
  const st = (await ctx.tx`select count(*) filter (where landing_id = ${pg.id})::int as orders,
                                  count(*) filter (where landing_id = ${pg.id} and status = 'approved')::int as approved
                           from chat_orders where business_id = ${ctx.biz}`)[0];
  const dr = (await ctx.tx`select count(*) filter (where status = 'open')::int as open, count(*)::int as all from landing_drafts where page_id = ${pg.id}`)[0];
  return { id: pg.id, sku: pg.sku, name: x ? x.name : pg.sku + ' (not in the product list)', image: x ? await imageUrl(ctx, x) : '', price: x ? num(x.sell) : 0,
           offer: pg.offer_price === null ? null : num(pg.offer_price), stock: x ? num(x.stock) : 0, headline: str(pg.headline), points: pg.points || [], colour: str(pg.colour),
           active: pg.active, views: pg.views, orders: st.orders, approved: st.approved, unfinished: dr.open, started: dr.all + st.orders,
           conversion: pg.views ? Math.round((st.orders / pg.views) * 1000) / 10 : 0, link: landingLink(ctx, pg), at: formatDate(new Date(pg.created_at), 'd MMM yyyy') };
}
export async function erpLandingPages(ctx) {
  await needFeat(ctx, 'landing');
  need(ctx, 'manager');
  const cat = await catalogue(ctx), out = [];
  for (const pg of await ctx.tx`select * from landing_pages where business_id = ${ctx.biz} order by created_at desc`) out.push(await pageView(ctx, pg, cat));
  const drafts = (await ctx.tx`select count(*)::int as n from landing_drafts where business_id = ${ctx.biz} and status = 'open'`)[0].n;
  return { pages: out, unfinished: drafts, products: cat.filter((p) => p.sell > 0).slice(0, 2000).map((p) => ({ sku: p.sku, name: p.name, stock: num(p.stock), price: num(p.sell) })) };
}
/** One click: from a product alone the page gets its headline and selling points; everything can be changed. */
function autoPoints(x, p) {
  const out = [];
  const bn = p.lang !== 'en';   // the page speaks the shop's language
  if (x.brand) out.push((x.brand + (bn ? ' — ১০০% অরিজিনাল' : ' — 100% original')).slice(0, 120));
  for (const [k, v] of Object.entries(x.details || {}).slice(0, 3)) out.push((k + ': ' + v).slice(0, 120));
  if (p.delivery_in || p.delivery_out) out.push(bn ? 'সারা বাংলাদেশে ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন' : 'Cash on delivery all over Bangladesh - pay when you get it');
  if (str(p.returns)) out.push(str(p.returns).split(/[.\n]/)[0].slice(0, 120));
  return out.slice(0, 6);
}
export async function erpLandingSave(ctx, payload) {
  await needFeat(ctx, 'landing');
  need(ctx, 'manager');
  const p = payload || {}, cat = await catalogue(ctx);
  let pg = isId(p.id) ? (await ctx.tx`select * from landing_pages where business_id = ${ctx.biz} and id = ${p.id}`)[0] : null;
  const sku = str(p.sku) || (pg && pg.sku);
  const x = cat.find((y) => y.sku.toLowerCase() === str(sku).toLowerCase());
  if (!x) throw new Error('Choose a product from the list.');
  if (!(x.sell > 0)) throw new Error(x.name + ' has no selling price yet.');
  const pr = await profile(ctx, false);
  const points = Array.isArray(p.points) ? p.points.map((s) => str(s).slice(0, 160)).filter(Boolean).slice(0, 8) : null;
  const offer = p.offerPrice === undefined ? undefined : (num(p.offerPrice) > 0 ? Math.round(num(p.offerPrice)) : null);
  if (offer && offer >= x.sell) throw new Error('The offer price must be below the normal price (' + x.sell + ').');
  if (offer && x.cost > 0 && offer < x.cost && !roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('That offer is below cost - only the owner can set it.');
  const colour = /^#[0-9a-f]{6}$/i.test(str(p.colour)) ? str(p.colour) : undefined;
  if (!pg) {
    pg = (await ctx.tx`insert into landing_pages (business_id, sku, headline, points, offer_price, colour, created_by)
           values (${ctx.biz}, ${x.sku}, ${str(p.headline).slice(0, 160) || x.name}, ${ctx.tx.json(points || autoPoints(x, pr))}, ${offer === undefined ? null : offer},
                   ${colour || null}, ${ctx.s.name}) returning *`)[0];
  } else {
    pg = (await ctx.tx`update landing_pages set sku = ${x.sku},
           headline = ${p.headline !== undefined ? (str(p.headline).slice(0, 160) || x.name) : pg.headline},
           points = ${ctx.tx.json(points || pg.points || [])}, offer_price = ${offer === undefined ? pg.offer_price : offer},
           colour = ${colour !== undefined ? colour : pg.colour}, active = ${p.active === undefined ? pg.active : !!p.active}, updated_at = now()
           where id = ${pg.id} returning *`)[0];
  }
  return { saved: await pageView(ctx, pg, cat), ...(await erpLandingPages(ctx)) };
}

export async function erpLandingDrafts(ctx, payload) {
  await needFeat(ctx, 'landing');
  need(ctx);
  const st = ['open', 'called', 'ordered', 'dismissed', 'all'].includes(payload && payload.status) ? payload.status : 'open';
  const rows = await ctx.tx`select d.*, lp.sku from landing_drafts d join landing_pages lp on lp.id = d.page_id
                            where d.business_id = ${ctx.biz} and (${st} = 'all' or d.status = ${st}) order by d.updated_at desc limit 200`;
  const cat = await catalogue(ctx);
  return { drafts: rows.map((d) => { const x = cat.find((y) => y.sku.toLowerCase() === str(d.sku).toLowerCase());
    return { id: d.id, name: str(d.name), phone: str(d.phone), address: str(d.address), qty: d.qty, area: str(d.area), product: x ? x.name : d.sku, status: d.status,
             order: str(d.order_no), note: str(d.note), at: formatDate(new Date(d.updated_at), 'd MMM, h:mm a') }; }),
    counts: (await ctx.tx`select count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'called')::int as called,
                                 count(*) filter (where status = 'ordered')::int as ordered from landing_drafts where business_id = ${ctx.biz}`)[0] };
}
export async function erpLandingDraftAct(ctx, payload) {
  await needFeat(ctx, 'landing');
  need(ctx);
  const p = payload || {};
  const d = isId(p.id) ? (await ctx.tx`select d.*, lp.sku, lp.offer_price from landing_drafts d join landing_pages lp on lp.id = d.page_id where d.business_id = ${ctx.biz} and d.id = ${p.id}`)[0] : null;
  if (!d) throw new Error('No such unfinished order.');
  const note = str(p.note).slice(0, 300) || null;
  if (p.action === 'called') await ctx.tx`update landing_drafts set status = 'called', note = coalesce(${note}, note), updated_at = now() where id = ${d.id}`;
  else if (p.action === 'dismiss') await ctx.tx`update landing_drafts set status = 'dismissed', note = coalesce(${note}, note), updated_at = now() where id = ${d.id}`;
  else if (p.action === 'reopen') await ctx.tx`update landing_drafts set status = 'open', updated_at = now() where id = ${d.id}`;
  else if (p.action === 'order') {
    if (d.status === 'ordered') throw new Error('Already ordered: ' + d.order_no + '.');
    // the call finished the order: what the visitor typed, corrected by the team
    const r = await placeOrder(ctx, { id: d.page_id, sku: d.sku, offer_price: d.offer_price }, {
      name: str(p.name) || d.name, phone: str(p.phone) || d.phone, address: str(p.address) || d.address, qty: num(p.qty) || d.qty, area: str(p.area) || d.area, ip: d.ip },
      'team (called back)', ctx.s.name);
    if (!r.ok) throw new Error(r.error);
    await ctx.tx`update landing_drafts set status = 'ordered', order_no = ${r.no}, note = coalesce(${note}, note), updated_at = now() where id = ${d.id}`;
  } else throw new Error('Called, dismiss, reopen or order?');
  return erpLandingDrafts(ctx, { status: p.status || 'open' });
}

export async function erpOrderShield(ctx) {
  need(ctx, 'manager');
  const blocks = await ctx.tx`select id, kind, value, reason, created_by, created_at from order_blocks where business_id = ${ctx.biz} order by created_at desc`;
  const flagged = await ctx.tx`select id, no, name, phone, status, risk, created_at from chat_orders where business_id = ${ctx.biz} and risk is not null
                               and (risk->>'level') in ('risky', 'blocked', 'watch') and created_at > now() - interval '60 days' order by created_at desc limit 100`;
  const ex = await ctx.tx`select ref, reason, created_by, created_at from delivery_excuses where business_id = ${ctx.biz} order by created_at desc limit 50`;
  return { settings: await shieldSettings(ctx),
           excuses: ex.map((e) => ({ ref: e.ref, reason: str(e.reason), by: str(e.created_by), at: formatDate(new Date(e.created_at), 'd MMM yyyy') })),
           blocks: blocks.map((b) => ({ id: b.id, kind: b.kind, value: b.value, reason: str(b.reason), by: str(b.created_by), at: formatDate(new Date(b.created_at), 'd MMM yyyy') })),
           flagged: flagged.map((o) => ({ id: o.id, no: o.no, name: o.name, phone: o.phone, status: o.status, level: o.risk.level, score: o.risk.score, reasons: o.risk.reasons || [],
                                          at: formatDate(new Date(o.created_at), 'd MMM, h:mm a') })) };
}
export async function erpOrderShieldSet(ctx, payload) {
  need(ctx, 'manager');
  const p = payload || {};
  if (p.block) {
    const kind = p.block.kind === 'ip' ? 'ip' : 'phone';
    const value = kind === 'phone' ? phoneOk(p.block.value) : str(p.block.value).slice(0, 60);
    if (!value) throw new Error(kind === 'phone' ? 'Type the mobile number (11 digits, 01...).' : 'Which internet address?');
    await ctx.tx`insert into order_blocks (business_id, kind, value, reason, created_by) values (${ctx.biz}, ${kind}, ${value}, ${str(p.block.reason).slice(0, 200) || null}, ${ctx.s.name})
                 on conflict (business_id, kind, value) do update set reason = excluded.reason`;
  } else if (isId(p.unblock)) await ctx.tx`delete from order_blocks where business_id = ${ctx.biz} and id = ${p.unblock}`;
  else if (p.settings) {
    if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder or a shareholder decides what happens to risky orders.');
    const S = { risky: ['warn', 'advance', 'confirm'].includes(p.settings.risky) ? p.settings.risky : 'warn', advanceHow: str(p.settings.advanceHow).slice(0, 160),
                advanceAmount: Math.max(0, Math.round(num(p.settings.advanceAmount))) };
    if (S.risky === 'advance' && !S.advanceHow) throw new Error('Say how to pay the advance (e.g. bKash 01XXXXXXXXX, send money).');
    await setConfig(ctx, 'order_shield', JSON.stringify(S));
  } else if (p.excuse) {
    // a return or a cancellation that was the shop's own fault: never counted against the customer again
    const ref = str(p.excuse.ref).slice(0, 60);
    if (!ref) throw new Error('Which invoice or order?');
    const known = (await ctx.tx`select 1 from invoices where business_id = ${ctx.biz} and invoice_no = ${ref} union all select 1 from chat_orders where business_id = ${ctx.biz} and no = ${ref} limit 1`).length;
    if (!known) throw new Error('No invoice or order ' + ref + '.');
    if (p.excuse.remove) await ctx.tx`delete from delivery_excuses where business_id = ${ctx.biz} and ref = ${ref}`;
    else await ctx.tx`insert into delivery_excuses (business_id, ref, reason, created_by) values (${ctx.biz}, ${ref}, ${str(p.excuse.reason).slice(0, 200) || null}, ${ctx.s.name})
                      on conflict (business_id, ref) do update set reason = excluded.reason`;
    // the open orders of that customer are read again
    await ctx.tx`update chat_orders set risk = null where business_id = ${ctx.biz} and status in ('pending', 'hold') and risk is not null`;
    await shieldOpenOrders(ctx);
  }
  else if (isId(p.recheck)) {
    const o = (await ctx.tx`select * from chat_orders where business_id = ${ctx.biz} and id = ${p.recheck}`)[0];
    if (!o) throw new Error('No such order.');
    await ctx.tx`update chat_orders set risk = ${ctx.tx.json(await orderRisk(ctx, o))} where id = ${o.id}`;
  } else throw new Error('Block, unblock or check again?');
  return erpOrderShield(ctx);
}
/** The Orders tab: every open order gets the shield's reading once (chat, product page, landing page). */
export async function shieldOpenOrders(ctx) {
  for (const o of await ctx.tx`select * from chat_orders where business_id = ${ctx.biz} and risk is null and status in ('pending', 'hold') limit 50`) {
    const risk = await orderRisk(ctx, o);
    await ctx.tx`update chat_orders set risk = ${ctx.tx.json(risk)} where id = ${o.id}`;
    const held = o.status === 'pending' ? await riskyHold(ctx, risk, num(o.delivery_charge)) : null;
    if (held) {
      await ctx.tx`update chat_orders set status = 'hold', hold_reason = ${held.hold} where id = ${o.id}`;
      await orderEvent(ctx, o.id, held.hold, 'Shield');
    }
  }
}

// ------------------------------------------------------------------ the public page
async function shopOf(ctx) {
  const p = await profile(ctx, false);
  const b = (await ctx.tx`select name, phone from businesses where id = ${ctx.biz}`)[0] || {};
  return { name: str(p.name) || str(b.name), phone: str(p.phone) || str(b.phone), lang: p.lang === 'en' ? 'en' : 'bn', p };
}
export async function landingPage(ctx, token) {
  if (!(await feat(ctx, 'landing'))) return NF;
  const pg = (await ctx.tx`select * from landing_pages where business_id = ${ctx.biz} and token = ${token}`)[0];
  if (!pg || !pg.active) return NF;
  const cat = await catalogue(ctx), x = cat.find((y) => y.sku.toLowerCase() === str(pg.sku).toLowerCase());
  if (!x) return NF;
  const shop = await shopOf(ctx);
  const price = pg.offer_price !== null && num(pg.offer_price) > 0 ? num(pg.offer_price) : num(x.sell);
  const images = [];
  const main = await imageUrl(ctx, x); if (main) images.push(main);
  const pixel = await (await import('./pixel.js')).pixelPublic(ctx);
  return { status: 200, body: { ok: true, lang: shop.lang, colour: str(pg.colour), pixel,
    shop: { name: shop.name, phone: shop.phone },
    product: { name: x.name, brand: str(x.brand), headline: str(pg.headline) || x.name, points: pg.points || [], about: str(x.desc || x.notes || ''), images,
               price, was: price < num(x.sell) ? num(x.sell) : null, available: x.stock > 0 },
    delivery: { inside: num(shop.p.delivery_in), outside: num(shop.p.delivery_out), daysIn: str(shop.p.days_in), daysOut: str(shop.p.days_out) },
    payment: str(shop.p.payment), returns: str(shop.p.returns) } };
}
const HITS = new Map();
function tooMany(key, max, ms) {
  const now = Date.now(), r = (HITS.get(key) || []).filter((t) => now - t < ms);
  if (r.length >= max) return true;
  r.push(now); HITS.set(key, r); return false;
}
/** A landing-page order (or one finished by phone): checked by the shield, then a chat order like any other. */
async function placeOrder(ctx, pg, b, takenBy, by) {
  const cat = await catalogue(ctx), x = cat.find((y) => y.sku.toLowerCase() === str(pg.sku).toLowerCase());
  if (!x) return { ok: false, error: 'This product is not available now.' };
  const ph = phoneOk(b.phone);
  if (!str(b.name)) return { ok: false, error: 'name' };
  if (!ph) return { ok: false, error: 'phone' };
  if (str(b.address).length < 6) return { ok: false, error: 'address' };
  if (!(x.stock > 0)) return { ok: false, error: 'stock' };
  const qty = Math.max(1, Math.min(20, Math.round(num(b.qty) || 1)));
  const price = pg.offer_price !== null && pg.offer_price !== undefined && num(pg.offer_price) > 0 ? num(pg.offer_price) : num(x.sell);
  const p = await profile(ctx, false);
  const charge = b.area === 'inside' ? num(p.delivery_in) : b.area === 'outside' ? num(p.delivery_out) : (deliveryFor(p, b.address).charge ?? num(p.delivery_out));
  const items = [{ sku: x.sku, name: x.name, qty, price }];
  const risk = await orderRisk(ctx, { phone: ph, ip: str(b.ip), name: b.name, address: b.address, items });
  if (risk.blocked) return { ok: false, error: 'blocked', risk };
  const no = await nextOrderNo(ctx);
  const held = takenBy === 'landing page' ? await riskyHold(ctx, risk, charge) : null;   // a call that finished it is already confirmed
  const meta = b.meta && typeof b.meta === 'object' ? { fbp: str(b.meta.fbp).slice(0, 120), fbc: str(b.meta.fbc).slice(0, 200), ua: str(b.meta.ua).slice(0, 300), url: str(b.meta.url).slice(0, 300), sent: {} } : { sent: {} };
  const o = (await ctx.tx`insert into chat_orders (business_id, no, conversation_id, name, phone, address, items, delivery_charge, note, taken_by, risk, landing_id, ip, status, hold_reason, meta)
             values (${ctx.biz}, ${no}, null, ${str(b.name).slice(0, 80)}, ${ph}, ${str(b.address).slice(0, 300)}, ${ctx.tx.json(items)}, ${charge}, ${str(b.note).slice(0, 300) || null},
                     ${takenBy}, ${ctx.tx.json(risk)}, ${pg.id || null}, ${str(b.ip) || null}, ${held ? 'hold' : 'pending'}, ${held ? held.hold : null}, ${ctx.tx.json(meta)}) returning *`)[0];
  await orderEvent(ctx, o.id, 'Placed on the landing page' + (takenBy !== 'landing page' ? ' (finished by phone)' : '') + (risk.level !== 'ok' ? ' - shield: ' + risk.level + ' (' + risk.reasons.join('; ') + ')' : ''), by || 'Customer');
  await task(ctx, null, 'order', null, 'New order ' + no + ' from the landing page: ' + str(b.name) + ' (' + ph + '): ' + x.name + ' × ' + qty +
    (risk.level === 'risky' ? ' ⚠ the shield says RISKY: ' + risk.reasons.join('; ') : risk.level === 'watch' ? ' · check: ' + risk.reasons.join('; ') : ''));
  if (held) await orderEvent(ctx, o.id, held.hold, 'Shield');
  return { ok: true, no, total: qty * price + charge, risk, advance: held && held.advance ? { ...held.advance, ref: no } : null, confirm: !!(held && !held.advance),
           page: (await feat(ctx, 'order_page')) ? orderLink(ctx, o) : '' };
}
export async function landingAct(ctx, token, b, ip) {
  if (!(await feat(ctx, 'landing'))) return NF;
  const pg = (await ctx.tx`select * from landing_pages where business_id = ${ctx.biz} and token = ${token}`)[0];
  if (!pg || !pg.active) return NF;
  const visitor = str(b.visitor).replace(/[^a-z0-9-]/gi, '').slice(0, 40);
  if (b.a === 'view') {
    if (!tooMany('v:' + ip + ':' + pg.id, 3, 3600e3)) await ctx.tx`update landing_pages set views = views + 1 where id = ${pg.id}`;
    return { status: 200, body: { ok: true } };
  }
  if (b.a === 'draft') {
    // failed-order tracking: a valid phone number typed is enough to call back
    const ph = phoneOk(b.phone);
    if (!ph || !visitor) return { status: 200, body: { ok: true } };
    if (tooMany('d:' + ip, 30, 3600e3)) return { status: 429, body: { ok: false } };
    await ctx.tx`insert into landing_drafts (business_id, page_id, visitor, name, phone, address, qty, area, ip)
                 values (${ctx.biz}, ${pg.id}, ${visitor}, ${str(b.name).slice(0, 80) || null}, ${ph}, ${str(b.address).slice(0, 300) || null}, ${Math.max(1, Math.min(20, Math.round(num(b.qty) || 1)))},
                         ${str(b.area).slice(0, 20) || null}, ${str(ip) || null})
                 on conflict (page_id, visitor) do update set name = excluded.name, phone = excluded.phone, address = excluded.address, qty = excluded.qty, area = excluded.area, updated_at = now()
                 where landing_drafts.status = 'open'`;
    return { status: 200, body: { ok: true } };
  }
  if (b.a !== 'buy') return { status: 400, body: { ok: false, error: 'What to do?' } };
  if (tooMany('b:' + ip, 6, 3600e3)) return { status: 429, body: { ok: false, error: 'busy' } };
  const r = await placeOrder(ctx, pg, { ...b, ip }, 'landing page', 'Customer');
  if (!r.ok) return { status: 200, body: { ok: false, error: r.error } };
  if (visitor) await ctx.tx`update landing_drafts set status = 'ordered', order_no = ${r.no}, updated_at = now() where page_id = ${pg.id} and visitor = ${visitor}`;
  // the same number typed on another device: that draft is done too
  await ctx.tx`update landing_drafts set status = 'ordered', order_no = ${r.no}, updated_at = now() where page_id = ${pg.id} and phone = ${phoneOk(b.phone)} and status = 'open'`;
  // the page never learns the shield's reading; it hears only what to do next (pay an advance, wait for a call)
  return { status: 200, body: { ok: true, no: r.no, total: r.total, page: r.page, advance: r.advance, confirm: r.confirm, pixel: r.risk && /risky|blocked/.test(r.risk.level) ? false : true } };
}

export const HANDLERS = { erpLandingPages, erpLandingSave, erpLandingDrafts, erpLandingDraftAct, erpOrderShield, erpOrderShieldSet };
