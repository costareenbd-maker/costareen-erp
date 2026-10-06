// Stage N6 (docs/NETWORK-BLUEPRINT.md section 4, "keep-customers kit"): points and levels, refill reminders,
// a delivery-history check before a parcel ships.
//
// Points: every PAID invoice earns points (rate per 100 taka, settings); the ledger row for an invoice follows what
// was really paid (a refund takes points back), so it is idempotent. Levels from lifetime points (Silver, Gold) with
// a perk line the owner writes. Staff give bonus points (a photo review, a referral) or redeem them against an
// invoice they discount by hand - the points never move money by themselves.
// Reminders: a customer's own buying rhythm for consumables (filament) says when he is likely to run out; the list
// shows who is due, with a one-tap WhatsApp message - only for customers who agreed (consent recorded: who, when,
// how). The customer can switch it on or off on his own page.
// Delivery history: this business's own parcels for the number - delivered, returned, pending - and a plain risk
// word with advice (confirm on WhatsApp, ask an advance). Own data only: no cross-network checker is used.
//
// Signed in: erpLoyalty, erpLoyaltySave, erpCustomerPoints, erpPointsAdjust, erpConsentSet, erpRefillDue,
//            erpReminderSent, erpDeliveryHistory, erpDeliveryHistoryMany
// Hooks: pointsSync (money.js, after an invoice's payment status changes); passport.js adds points and the
//        reminder switch to the customer page.

import { formatDate, num, round2 } from '../lib/time.js';
import { custKey, phone11 } from '../lib/phone.js';
import { roleAtLeast } from '../allow.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { paymentsTab, PAY } from '../lib/tabs.js';
import { who } from './money.js';

const str = (v) => String(v == null ? '' : v).trim();
const day = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const DAY = 86400e3;

// ---------------------------------------------------------------- settings
const DEF = { on: true, rate: 1, silver: 500, gold: 2000, taka: 1, silverPerk: 'Priority on new colours', goldPerk: 'Free delivery in the city', refillOn: true };
export async function settings(ctx) {
  const g = async (k, d) => { const v = await getConfig(ctx, 'loyalty_' + k, ''); return v === '' ? d : v; };
  return { on: (await g('on', '1')) === '1', rate: num(await g('rate', DEF.rate)), silver: num(await g('silver', DEF.silver)), gold: num(await g('gold', DEF.gold)), taka: num(await g('taka', DEF.taka)),
    silverPerk: str(await g('silver_perk', DEF.silverPerk)), goldPerk: str(await g('gold_perk', DEF.goldPerk)), refillOn: (await g('refill_on', '1')) === '1' };
}
export async function erpLoyalty(ctx) {
  const S = await settings(ctx);
  const t = (await ctx.tx`select count(distinct customer_key)::int as members, coalesce(sum(points), 0)::int as points from customer_points where business_id = ${ctx.biz}`)[0];
  const c = (await ctx.tx`select count(*)::int as n from customer_consent where business_id = ${ctx.biz} and reminders`)[0];
  return { settings: S, members: num(t.members), pointsOut: num(t.points), consented: num(c.n), canManage: roleAtLeast(ctx.s.role, 'manager') };
}
export async function erpLoyaltySave(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner changes the points rules.');
  const p = payload || {};
  const n = (v, lo, hi, what) => { const x = num(v); if (!(x >= lo && x <= hi)) throw new Error(what + ' should be between ' + lo + ' and ' + hi + '.'); return x; };
  // check the whole picture before writing anything
  const S = await settings(ctx), want = { ...S };
  if (p.on !== undefined) want.on = !!p.on;
  if (p.refillOn !== undefined) want.refillOn = !!p.refillOn;
  if (p.rate !== undefined) want.rate = n(p.rate, 0, 100, 'Points per 100 taka');
  if (p.silver !== undefined) want.silver = Math.round(n(p.silver, 1, 1000000, 'Silver from'));
  if (p.gold !== undefined) want.gold = Math.round(n(p.gold, 1, 10000000, 'Gold from'));
  if (p.taka !== undefined) want.taka = n(p.taka, 0, 1000, 'Taka per point');
  if (p.silverPerk !== undefined) want.silverPerk = str(p.silverPerk).slice(0, 120);
  if (p.goldPerk !== undefined) want.goldPerk = str(p.goldPerk).slice(0, 120);
  if (want.gold <= want.silver) throw new Error('Gold must need more points than Silver.');
  await setConfig(ctx, 'loyalty_on', want.on ? '1' : '0');
  await setConfig(ctx, 'loyalty_refill_on', want.refillOn ? '1' : '0');
  await setConfig(ctx, 'loyalty_rate', String(want.rate));
  await setConfig(ctx, 'loyalty_silver', String(want.silver));
  await setConfig(ctx, 'loyalty_gold', String(want.gold));
  await setConfig(ctx, 'loyalty_taka', String(want.taka));
  await setConfig(ctx, 'loyalty_silver_perk', want.silverPerk);
  await setConfig(ctx, 'loyalty_gold_perk', want.goldPerk);
  return erpLoyalty(ctx);
}

// ---------------------------------------------------------------- points
export function levelOf(S, lifetime) {
  if (lifetime >= S.gold) return { name: 'Gold', next: '', toNext: 0, perk: S.goldPerk, pct: 100 };
  if (lifetime >= S.silver) return { name: 'Silver', next: 'Gold', toNext: S.gold - lifetime, perk: S.silverPerk, pct: Math.round((lifetime - S.silver) / Math.max(1, S.gold - S.silver) * 100) };
  return { name: 'Bronze', next: 'Silver', toNext: S.silver - lifetime, perk: '', pct: Math.round(lifetime / Math.max(1, S.silver) * 100) };
}
/** money.js calls this after an invoice's payment status is recomputed: the invoice's points follow what was paid. */
export async function pointsSync(ctx, invoiceNo) {
  const S = await settings(ctx);
  if (!S.on) return;
  const no = str(invoiceNo);
  if (!no || /^RTN-/.test(no)) return;
  const inv = (await ctx.tx`select customer_name, customer_phone, advance_paid, grand_total, voided_at from invoices where business_id = ${ctx.biz} and invoice_no = ${no}`)[0];
  if (!inv) return;
  const key = custKey(inv.customer_phone, inv.customer_name);
  if (!key || key === 'n:') return;
  // what was really paid for goods kept: money in (refunds and money moved to advance count negative), against the
  // invoice less what came back ("Returned" entries are the books' credit for goods back, not money)
  let paid = 0, returned = 0;
  for (const p of await paymentsTab(ctx)) {
    if (str(p[PAY.order_id]) !== no) continue;
    if (/^returned$/i.test(String(p[PAY.method] || ''))) returned += num(p[PAY.amount]); else paid += num(p[PAY.amount]);
  }
  const kept = Math.max(0, num(inv.grand_total) - returned);
  const base = inv.voided_at ? 0 : Math.max(0, Math.min(paid, kept));
  const want = Math.floor(base * S.rate / 100);
  const had = (await ctx.tx`select id, points from customer_points where business_id = ${ctx.biz} and invoice_no = ${no} and kind = 'order'`)[0];
  if (!had && want <= 0) return;
  if (!had) await ctx.tx`insert into customer_points (business_id, customer_key, invoice_no, kind, points, note, created_by) values (${ctx.biz}, ${key}, ${no}, 'order', ${want}, ${'Invoice ' + no}, 'erp')`;
  else if (num(had.points) !== want) await ctx.tx`update customer_points set points = ${want}, customer_key = ${key}, updated_at = now() where id = ${had.id}`;
}
async function totals(ctx, key) {
  const r = (await ctx.tx`select coalesce(sum(points), 0)::int as total, coalesce(sum(points) filter (where points > 0 and kind in ('order', 'bonus')), 0)::int as lifetime from customer_points where business_id = ${ctx.biz} and customer_key = ${key}`)[0];
  return { total: num(r.total), lifetime: num(r.lifetime) };
}
export async function consentOf(ctx, key) {
  const r = (await ctx.tx`select * from customer_consent where business_id = ${ctx.biz} and customer_key = ${key}`)[0];
  return r ? { reminders: !!r.reminders, at: day(r.at), by: str(r.by), how: str(r.how) } : { reminders: false, at: '', by: '', how: '' };
}
export async function pointsFor(ctx, key) {
  const S = await settings(ctx), t = await totals(ctx, key), lv = levelOf(S, t.lifetime);
  return { on: S.on, total: t.total, lifetime: t.lifetime, level: lv.name, next: lv.next, toNext: lv.toNext, pct: lv.pct, perk: lv.perk, taka: S.taka, silver: S.silver, gold: S.gold, silverPerk: S.silverPerk, goldPerk: S.goldPerk };
}
export async function erpCustomerPoints(ctx, payload) {
  const key = custKey(payload && payload.phone, payload && payload.name);
  if (!key || key === 'n:') throw new Error('A customer needs a phone number or a name.');
  const pts = await pointsFor(ctx, key);
  const ledger = (await ctx.tx`select * from customer_points where business_id = ${ctx.biz} and customer_key = ${key} order by created_at desc limit 30`)
    .map((r) => ({ id: r.id, kind: str(r.kind), points: num(r.points), note: str(r.note), by: str(r.created_by), when: day(r.created_at) }));
  const refill = (await rhythms(ctx))[key] || null;
  return { key, ...pts, ledger, consent: await consentOf(ctx, key), refill: refill ? refillView(refill) : null, delivery: await deliveryFor(ctx, key), canManage: roleAtLeast(ctx.s.role, 'manager') };
}
export async function erpPointsAdjust(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner gives or redeems points.');
  const p = payload || {};
  const key = custKey(p.phone, p.name);
  if (!key || key === 'n:') throw new Error('Which customer?');
  const kind = p.kind === 'redeem' ? 'redeem' : p.kind === 'adjust' ? 'adjust' : 'bonus';
  let points = Math.round(num(p.points));
  if (!points) throw new Error('How many points?');
  if (kind === 'bonus' && points < 0) throw new Error('A bonus is positive; use Redeem to take points.');
  if (kind === 'redeem') { points = -Math.abs(points); const t = await totals(ctx, key); if (-points > t.total) throw new Error('Only ' + t.total + ' points to redeem.'); }
  const note = str(p.note).slice(0, 200);
  if (!note) throw new Error('Say why (e.g. "photo review", "redeemed on INV-… as 200 taka off").');
  await ctx.tx`insert into customer_points (business_id, customer_key, kind, points, note, created_by) values (${ctx.biz}, ${key}, ${kind}, ${points}, ${note}, ${who(ctx)})`;
  return erpCustomerPoints(ctx, { phone: p.phone, name: p.name });
}
export async function consentSet(ctx, key, on, by, how) {
  await ctx.tx`insert into customer_consent (business_id, customer_key, reminders, at, by, how) values (${ctx.biz}, ${key}, ${!!on}, now(), ${by}, ${how})
               on conflict (business_id, customer_key) do update set reminders = excluded.reminders, at = now(), by = excluded.by, how = excluded.how`;
}
export async function erpConsentSet(ctx, payload) {
  const p = payload || {};
  const key = custKey(p.phone, p.name);
  if (!key || key === 'n:') throw new Error('Which customer?');
  const how = str(p.how).slice(0, 80) || 'asked by staff';
  await consentSet(ctx, key, p.reminders === true, who(ctx), how);
  return { consent: await consentOf(ctx, key) };
}

// ---------------------------------------------------------------- refill reminders
/** Each customer's rhythm on consumables: the dates they bought filament, the average gap, what they buy. */
async function rhythms(ctx) {
  if (ctx.memo.refillRhythms) return ctx.memo.refillRhythms;
  // straight from the invoices (not the cached sales log): consumables bought in the last 18 months
  const rows = await ctx.tx`
    select i.invoice_no, i.created_at, i.customer_name, i.customer_phone, l.qty, p.name
      from invoice_lines l join invoices i on i.id = l.invoice_id
      join products p on p.business_id = i.business_id and lower(btrim(p.sku)) = lower(btrim(l.sku))
     where i.business_id = ${ctx.biz} and i.voided_at is null and i.invoice_no not like 'RTN-%'
       and coalesce(p.category, '') ~* 'filament|consumable|resin' and i.created_at > now() - interval '18 months'`;
  const byCust = {};
  for (const r of rows) {
    const key = custKey(r.customer_phone, r.customer_name);
    if (!key || key === 'n:') continue;
    const at = r.created_at ? new Date(r.created_at) : null; if (!at) continue;
    const c = byCust[key] || (byCust[key] = { key, name: str(r.customer_name), phone: str(r.customer_phone), days: {}, items: {} });
    c.days[formatDate(at, 'yyyy-MM-dd')] = at.getTime();
    c.items[str(r.name)] = (c.items[str(r.name)] || 0) + num(r.qty);
  }
  const out = {};
  for (const c of Object.values(byCust)) {
    const times = Object.values(c.days).sort((a, b) => a - b);
    if (times.length < 2) continue;
    const gaps = []; for (let i = 1; i < times.length; i++) gaps.push((times[i] - times[i - 1]) / DAY);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avg < 3) continue;
    const last = times[times.length - 1];
    out[c.key] = { ...c, buys: times.length, avgDays: Math.round(avg), lastAt: last, nextAt: last + avg * DAY, items: Object.entries(c.items).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, q]) => ({ name: n, qty: q })) };
  }
  ctx.memo.refillRhythms = out;
  return out;
}
/** For the customer's own page: when he is likely to need more, in plain words. */
export async function refillFor(ctx, key) { const r = (await rhythms(ctx))[key]; return r ? refillView(r) : null; }
function refillView(r) { return { buys: r.buys, avgDays: r.avgDays, lastAt: day(r.lastAt), nextAt: day(r.nextAt), due: Date.now() >= r.lastAt + r.avgDays * 0.9 * DAY, items: r.items }; }
function waText(name, items, shop) { return 'Hello ' + (name || '') + ', time for more ' + items.map((i) => i.name).join(' / ') + '? Reply here and ' + (shop || 'we') + ' will keep it aside for you.'; }
export async function erpRefillDue(ctx) {
  const S = await settings(ctx);
  const all = Object.values(await rhythms(ctx));
  const now = Date.now();
  const sent = {}; for (const r of await ctx.tx`select customer_key, max(sent_at) as at from reminder_log where business_id = ${ctx.biz} and kind = 'refill' group by customer_key`) sent[str(r.customer_key)] = new Date(r.at).getTime();
  const consent = {}; for (const r of await ctx.tx`select customer_key, reminders from customer_consent where business_id = ${ctx.biz}`) consent[str(r.customer_key)] = !!r.reminders;
  let shop = str(ctx.s.businessName); try { shop = str((await (await import('./sales.js')).qProfile(ctx)).name) || shop; } catch (_) { /* the business name */ }
  const due = all.filter((r) => now >= r.lastAt + r.avgDays * 0.9 * DAY && !(sent[r.key] && now - sent[r.key] < 14 * DAY)).sort((a, b) => (a.lastAt + a.avgDays * DAY) - (b.lastAt + b.avgDays * DAY));
  const row = (r) => { const d = str(r.phone).replace(/[^0-9]/g, ''); return { key: r.key, name: r.name, phone: r.phone, buys: r.buys, avgDays: r.avgDays, lastAt: day(r.lastAt), nextAt: day(r.nextAt), overdueDays: Math.max(0, Math.round((now - r.nextAt) / DAY)), items: r.items, consent: !!consent[r.key],
    whatsapp: d ? 'https://wa.me/' + (d.startsWith('0') ? '88' + d : d) + '?text=' + encodeURIComponent(consent[r.key] ? waText(r.name, r.items, shop) : 'Hello ' + (r.name || '') + ', may we message you when you are likely to need more filament? Reply YES and we will.') : '' }; };
  return { on: S.refillOn, ready: due.filter((r) => consent[r.key]).map(row), askFirst: due.filter((r) => !consent[r.key]).map(row), tracked: all.length };
}
export async function erpReminderSent(ctx, payload) {
  const p = payload || {};
  const key = custKey(p.phone, p.name);
  if (!key || key === 'n:') throw new Error('Which customer?');
  await ctx.tx`insert into reminder_log (business_id, customer_key, kind, note, sent_by) values (${ctx.biz}, ${key}, 'refill', ${str(p.note).slice(0, 200) || null}, ${who(ctx)})`;
  return { sent: true };
}

// ---------------------------------------------------------------- delivery history (own parcels)
async function deliveryFor(ctx, key) {
  const rows = await ctx.tx`select invoice_no, delivery_status, customer_phone, customer_name, created_at from invoices where business_id = ${ctx.biz} and voided_at is null and invoice_no not like 'RTN-%'`;
  const booked = new Set((await ctx.tx`select invoice_no from courier_log where business_id = ${ctx.biz}`).map((r) => str(r.invoice_no)));
  // a parcel the rider collected on: the courier job writes a "COD (Steadfast)" payment, so that counts as delivered too
  const codPaid = new Set();
  try { for (const p of await paymentsTab(ctx)) if (/steadfast|courier/i.test(String(p[PAY.method] || ''))) codPaid.add(str(p[PAY.order_id])); } catch (_) { /* no payments tab */ }
  let delivered = 0, returned = 0, pending = 0, parcels = 0, orders = 0;
  for (const r of rows) {
    if (custKey(r.customer_phone, r.customer_name) !== key) continue;
    orders++;
    const no = str(r.invoice_no), st = str(r.delivery_status).toLowerCase();
    if (!booked.has(no) && !codPaid.has(no) && !/deliver|return|cancel/.test(st)) continue;
    parcels++;
    if (/return|cancel|refus/.test(st)) returned++; else if (/deliver/.test(st) || codPaid.has(no)) delivered++; else pending++;
  }
  let risk = 'new', advice = 'No parcel history with us yet. Confirm the address on WhatsApp before booking; ask an advance on a big cash-on-delivery order.';
  if (parcels) {
    const rate = returned / Math.max(1, delivered + returned);
    if (returned >= 2 && rate >= 0.4) { risk = 'risky'; advice = 'Returned ' + returned + ' of ' + (delivered + returned) + ' parcels. Ask an advance before booking, or deliver by hand.'; }
    else if (returned >= 1) { risk = 'watch'; advice = returned + ' return on record. Confirm the delivery day on WhatsApp first.'; }
    else { risk = 'good'; advice = delivered + ' delivered, none returned.'; }
  }
  return { orders, parcels, delivered, returned, pending, risk, advice };
}
export async function erpDeliveryHistory(ctx, payload) {
  const key = custKey(payload && payload.phone, payload && payload.name);
  if (!key || key === 'n:') return { risk: 'none', advice: 'No phone number - nothing to check.', orders: 0, parcels: 0, delivered: 0, returned: 0, pending: 0 };
  return deliveryFor(ctx, key);
}
export async function erpDeliveryHistoryMany(ctx, payload) {
  const phones = Array.isArray(payload && payload.phones) ? payload.phones.slice(0, 200) : [];
  const out = {};
  for (const ph of phones) { const key = custKey(ph, ''); if (key && key !== 'n:' && !out[ph]) out[ph] = await deliveryFor(ctx, key); }
  return { history: out };
}
/** Once, when points are switched on: every past invoice gets the points it would have earned (idempotent). */
export async function erpLoyaltyBackfill(ctx) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner counts past invoices.');
  const S = await settings(ctx);
  if (!S.on) throw new Error('Switch points on first.');
  const rows = await ctx.tx`select invoice_no from invoices where business_id = ${ctx.biz} and voided_at is null and invoice_no not like 'RTN-%' order by created_at desc limit 20000`;
  let n = 0;
  for (const r of rows) { await pointsSync(ctx, r.invoice_no); n++; }
  const t = (await ctx.tx`select count(distinct customer_key)::int as members, coalesce(sum(points), 0)::int as points from customer_points where business_id = ${ctx.biz}`)[0];
  return { invoices: n, members: num(t.members), pointsOut: num(t.points) };
}
export const HANDLERS = { erpLoyalty, erpLoyaltySave, erpCustomerPoints, erpPointsAdjust, erpConsentSet, erpRefillDue, erpReminderSent, erpDeliveryHistory, erpDeliveryHistoryMany, erpLoyaltyBackfill };
