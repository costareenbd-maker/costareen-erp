// Suppliers and what is owed to them (plan A4).
//
//   A supplier's account: opening balance + bills - payments.
//     bill     the goods of a shipment received from them (written by the
//              receive screen - freight is not theirs), or one typed in
//     payment  money sent to them, out of a money account
//   Above zero: you owe them. Below zero: you have paid ahead.
//
//   erpSuppliers()                        everyone the business buys from, with what is owed
//   erpSupplierPage({name})               one supplier: details, the account line by line
//   erpSupplierSave({name, rename, ...})  details; a rename follows through products, orders and stock
//   erpSupplierBill / erpSupplierPay / erpSupplierVoid
//
// A supplier is known by name (as products, orders and stock movements have
// always written it), so one that was only ever a name in a list appears here
// too, before anyone has typed its details.

import { formatDate, num, round2, dhakaDayStart } from '../lib/time.js';
import { roleAtLeast, actRole } from '../allow.js';
import { assertOpen } from '../lib/period.js';
import { getConfig, setConfig } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const key = (v) => str(v).toLowerCase();
const day = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const isId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const whoIs = (ctx) => str(ctx.s && ctx.s.name) || 'User';

function moneyDate(ctx, typed) {
  const t = str(typed);
  if (!t) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Error('The date should look like 2026-10-05.');
  if (t > formatDate(ctx.now, 'yyyy-MM-dd')) throw new Error('That date has not come yet.');
  return new Date(dhakaDayStart(t).getTime() + 12 * 3600e3);
}

/** Every supplier name the business has used, with its record where one exists. */
async function known(ctx) {
  const by = {};
  const add = (name) => { const k = key(name); if (k && !by[k]) by[k] = { name: str(name), rec: null }; return by[k]; };
  for (const r of await ctx.tx`select * from suppliers where business_id = ${ctx.biz}`) { const e = add(r.name); e.rec = r; e.name = str(r.name); }
  for (const r of await ctx.tx`select value from lookups where business_id = ${ctx.biz} and kind = 'suppliers'`) add(r.value);
  for (const r of await ctx.tx`select distinct supplier from products where business_id = ${ctx.biz} and btrim(coalesce(supplier, '')) <> ''`) add(r.supplier);
  for (const r of await ctx.tx`select distinct supplier from supplier_bills where business_id = ${ctx.biz}`) add(r.supplier);
  for (const r of await ctx.tx`select distinct supplier from supplier_payments where business_id = ${ctx.biz}`) add(r.supplier);
  return by;
}

async function accountOf(ctx, name) {
  const k = key(name);
  const bills = await ctx.tx`select * from supplier_bills where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${k} order by at, created_at`;
  const pays = await ctx.tx`select p.*, a.name as account_name from supplier_payments p left join money_accounts a on a.id = p.account_id
                            where p.business_id = ${ctx.biz} and lower(btrim(p.supplier)) = ${k} order by p.at, p.created_at`;
  return { bills, pays };
}


// ---- what was bought from a supplier, counted from a set day on (owner 17 Oct 2026: "you don't need to care about
// the past, but from now on"). The day is kept per business; the first time anyone looks it is set to that day.
export async function totalsFrom(ctx) {
  const m = ctx.memo || (ctx.memo = {});
  if (m.supTotalsFrom) return m.supTotalsFrom;
  let d = str(await getConfig(ctx, 'supplier_totals_from', ''));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { d = formatDate(ctx.now, 'yyyy-MM-dd'); try { await ctx.tx.savepoint(() => setConfig(ctx, 'supplier_totals_from', d)); } catch (_) { /* read-only caller */ } }
  return (m.supTotalsFrom = d);
}
async function purchasesSince(ctx, name, since) {
  const k = key(name), from = dhakaDayStart(since);
  const bills = await ctx.tx`select id, at, reference, amount, source from supplier_bills where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${k}
                             and coalesce(voided, '') = '' and at >= ${from} order by at`;
  const refs = bills.map((b) => str(b.reference)).filter(Boolean);
  const units = {}, extras = {};
  if (refs.length) {
    for (const r of await ctx.tx`select reference, coalesce(sum(qty), 0) q from stock_movements where business_id = ${ctx.biz} and kind = 'RECEIVE'
                                 and reference = any(${refs}) group by reference`) units[str(r.reference)] = num(r.q);
    for (const r of await ctx.tx`select reference, coalesce(sum(amount), 0) a from shipment_costs where business_id = ${ctx.biz}
                                 and reference = any(${refs}) group by reference`) extras[str(r.reference)] = num(r.a);
  }
  const paid = num((await ctx.tx`select coalesce(sum(amount), 0) s from supplier_payments where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${k}
                                  and coalesce(voided, '') = '' and at >= ${from}`)[0].s);
  const rows = bills.map((b) => ({ when: day(b.at), ref: str(b.reference), units: units[str(b.reference)] || 0, goods: Math.round(num(b.amount)),
                                   extras: Math.round(extras[str(b.reference)] || 0), landed: Math.round(num(b.amount) + (extras[str(b.reference)] || 0)) }));
  const t = rows.reduce((a, r) => ({ shipments: a.shipments + 1, units: a.units + r.units, goods: a.goods + r.goods, extras: a.extras + r.extras, landed: a.landed + r.landed }),
                        { shipments: 0, units: 0, goods: 0, extras: 0, landed: 0 });
  return { since, sinceText: day(from), ...t, paid: Math.round(paid), rows: rows.reverse() };
}

export async function erpSuppliers(ctx) {
  const by = await known(ctx);
  const sums = {};
  const slot = (n) => sums[key(n)] || (sums[key(n)] = { billed: 0, paid: 0, last: null });
  for (const b of await ctx.tx`select supplier, amount, at, voided from supplier_bills where business_id = ${ctx.biz}`) {
    if (str(b.voided)) continue;
    const s = slot(b.supplier); s.billed += num(b.amount);
    if (!s.last || new Date(b.at) > s.last) s.last = new Date(b.at);
  }
  for (const p of await ctx.tx`select supplier, amount, voided from supplier_payments where business_id = ${ctx.biz}`) {
    if (!str(p.voided)) slot(p.supplier).paid += num(p.amount);
  }
  const prod = {};
  for (const r of await ctx.tx`select lower(btrim(supplier)) k, count(*)::int n from products where business_id = ${ctx.biz} and btrim(coalesce(supplier, '')) <> '' group by 1`) prod[r.k] = r.n;
  const list = Object.keys(by).map((k) => {
    const e = by[k], r = e.rec || {}, s = sums[k] || { billed: 0, paid: 0, last: null };
    const owed = round2(num(r.opening_owed) + s.billed - s.paid);
    return { name: e.name, phone: str(r.phone), country: str(r.country), currency: str(r.currency), archived: !!r.archived, hasRecord: !!e.rec,
             products: prod[k] || 0, billed: Math.round(s.billed), paid: Math.round(s.paid), owed: Math.round(owed), lastBill: day(s.last) };
  }).sort((a, b) => (a.archived - b.archived) || (b.owed - a.owed) || a.name.localeCompare(b.name));
  const since = await totalsFrom(ctx), sinceAt = dhakaDayStart(since), bought = {};
  for (const r of await ctx.tx`select lower(btrim(supplier)) k, coalesce(sum(amount), 0) a from supplier_bills where business_id = ${ctx.biz}
                               and coalesce(voided, '') = '' and at >= ${sinceAt} group by 1`) bought[r.k] = Math.round(num(r.a));
  list.forEach((x) => { x.boughtSince = bought[key(x.name)] || 0; });
  return { since, sinceText: day(sinceAt), suppliers: list, owedTotal: list.reduce((t, s) => t + Math.max(0, s.owed), 0), aheadTotal: list.reduce((t, s) => t + Math.max(0, -s.owed), 0),
           canPay: roleAtLeast(actRole(ctx.s), 'shareholder'), money: 'BDT' };
}

export async function erpSupplierPage(ctx, payload) {
  const name = str(payload && payload.name);
  if (!name) throw new Error('Which supplier?');
  const e = (await known(ctx))[key(name)];
  if (!e) throw new Error('That supplier is not on the list.');
  const r = e.rec || {};
  const { bills, pays } = await accountOf(ctx, e.name);
  const lines = [];
  if (num(r.opening_owed)) lines.push({ ts: 0, when: '', kind: 'opening', what: 'Owed when the books were started', ref: '', amount: num(r.opening_owed), voided: '' });
  for (const b of bills) {
    lines.push({ ts: new Date(b.at).getTime(), when: day(b.at), kind: 'bill', id: b.id, what: str(b.source) === 'shipment' ? 'Goods received' : 'Bill',
                 ref: str(b.reference), note: str(b.note), amount: num(b.amount), by: str(b.by), voided: str(b.voided),
                 fx: num(b.fx_amount) ? fxText(b.fx_amount, b.fx_currency, b.fx_rate) : '' });
  }
  for (const p of pays) {
    lines.push({ ts: new Date(p.at).getTime(), when: day(p.at), kind: 'payment', id: p.id, what: 'Paid' + (str(p.account_name) ? ' from ' + str(p.account_name) : ''),
                 ref: str(p.note), amount: -num(p.amount), by: str(p.by), voided: str(p.voided),
                 fx: num(p.fx_amount) ? fxText(p.fx_amount, p.fx_currency, 0) : '' });
  }
  lines.sort((a, b) => a.ts - b.ts);
  let run = 0;
  for (const l of lines) { if (!l.voided) run = round2(run + l.amount); l.after = Math.round(run); delete l.ts; }
  const accounts = roleAtLeast(actRole(ctx.s), 'shareholder')
    ? (await ctx.tx`select id, name from money_accounts where business_id = ${ctx.biz} and not archived and kind <> 'courier' order by sort_order, created_at`).map((a) => ({ id: a.id, name: str(a.name) })) : [];
  const products = await ctx.tx`select sku, name from products where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${key(e.name)} order by name limit 300`;
  const open = await ctx.tx`select po_no, sum(qty - received) as left, min(ordered_at) as at from po_lines
                            where business_id = ${ctx.biz} and lower(btrim(coalesce(supplier, ''))) = ${key(e.name)} and status = 'open' and qty > received group by po_no order by 3`;
  return { name: e.name, hasRecord: !!e.rec, phone: str(r.phone), country: str(r.country), currency: str(r.currency), note: str(r.note),
           openingOwed: num(r.opening_owed), archived: !!r.archived, owed: Math.round(run), lines: lines.reverse(), accounts,
           products: products.map((p) => ({ sku: str(p.sku), name: str(p.name) })),
           onOrder: open.map((o) => ({ po: str(o.po_no), left: num(o.left), ordered: day(o.at) })),
           purchases: await purchasesSince(ctx, e.name, await totalsFrom(ctx)),
           canPay: roleAtLeast(actRole(ctx.s), 'shareholder'), today: formatDate(ctx.now, 'yyyy-MM-dd'), money: 'BDT' };
}
function fxText(amount, cur, rate) {
  return (str(cur) || '') + ' ' + num(amount).toLocaleString('en-US') + (num(rate) ? ' @ ' + num(rate) : '');
}

/** Details of a supplier. `rename` changes the name everywhere it is written. */
export async function erpSupplierSave(ctx, payload) {
  payload = payload || {};
  const name = str(payload.name);
  if (!name) throw new Error('The supplier needs a name.');
  if (name.length > 80) throw new Error('That name is too long.');
  const by = await known(ctx);
  const cur = by[key(name)];
  const to = str(payload.rename);
  let final = cur ? cur.name : name;
  if (to && key(to) !== key(final)) {
    if (!cur) throw new Error('That supplier is not on the list.');
    if (by[key(to)]) throw new Error('There is already a supplier called "' + by[key(to)].name + '".');
    if (to.length > 80) throw new Error('That name is too long.');
    const k = key(final);
    await ctx.tx`update products set supplier = ${to} where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${k}`;
    await ctx.tx`update stock_movements set supplier = ${to} where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${k}`;
    await ctx.tx`update po_lines set supplier = ${to} where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${k}`;
    await ctx.tx`update supplier_bills set supplier = ${to} where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${k}`;
    await ctx.tx`update supplier_payments set supplier = ${to} where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${k}`;
    await ctx.tx`update lookups set value = ${to} where business_id = ${ctx.biz} and kind = 'suppliers' and lower(btrim(value)) = ${k}`;
    if (cur.rec) await ctx.tx`update suppliers set name = ${to} where id = ${cur.rec.id}`;
    final = to;
    delete ctx.memo.catalog;
  }
  const fields = { phone: str(payload.phone).slice(0, 40) || null, country: str(payload.country).slice(0, 40) || null,
                   currency: str(payload.currency).toUpperCase().slice(0, 6) || null, note: str(payload.note).slice(0, 300) || null,
                   opening: round2(num(payload.openingOwed)), archived: !!payload.archived };
  if (fields.opening && !roleAtLeast(actRole(ctx.s), 'shareholder')) throw new Error('Only a shareholder or the owner sets what was owed at the start.');
  const rec = (await ctx.tx`select id from suppliers where business_id = ${ctx.biz} and lower(btrim(name)) = ${key(final)}`)[0];
  if (rec) {
    await ctx.tx`update suppliers set phone = ${fields.phone}, country = ${fields.country}, currency = ${fields.currency}, note = ${fields.note},
                 opening_owed = ${fields.opening}, archived = ${fields.archived} where id = ${rec.id}`;
  } else {
    await ctx.tx`insert into suppliers (business_id, name, phone, country, currency, note, opening_owed, archived)
                 values (${ctx.biz}, ${final}, ${fields.phone}, ${fields.country}, ${fields.currency}, ${fields.note}, ${fields.opening}, ${fields.archived})`;
    // the product form offers suppliers from this list
    const had = await ctx.tx`select 1 from lookups where business_id = ${ctx.biz} and kind = 'suppliers' and lower(btrim(value)) = ${key(final)}`;
    if (!had.length) await ctx.tx`insert into lookups (business_id, kind, value, sort_order) values (${ctx.biz}, 'suppliers', ${final}, 999)`;
  }
  return erpSupplierPage(ctx, { name: final });
}

/** Written by the receive screen: the goods of one shipment are owed to the supplier named on it. */
export async function billForShipment(ctx, { supplier, reference, amount, fxAmount, fxCurrency, fxRate, note }) {
  if (!str(supplier) || !(num(amount) > 0)) return null;
  const r = await ctx.tx`
    insert into supplier_bills (business_id, supplier, at, reference, amount, fx_amount, fx_currency, fx_rate, source, note, by)
    values (${ctx.biz}, ${str(supplier)}, ${new Date()}, ${str(reference) || null}, ${round2(num(amount))}, ${num(fxAmount) || null},
            ${str(fxCurrency) || null}, ${num(fxRate) || null}, 'shipment', ${str(note).slice(0, 300) || null}, ${whoIs(ctx)}) returning id`;
  return r[0].id;
}

/** A bill typed in: something owed that did not come through the receive screen. */
export async function erpSupplierBill(ctx, payload) {
  payload = payload || {};
  const e = (await known(ctx))[key(payload.name)];
  if (!e) throw new Error('That supplier is not on the list.');
  const amount = round2(num(payload.amount));
  if (!(amount > 0)) throw new Error('How much is the bill? Type an amount above 0.');
  await assertOpen(ctx, moneyDate(ctx, payload.date), 'a bill cannot be dated there');
  await ctx.tx`insert into supplier_bills (business_id, supplier, at, reference, amount, fx_amount, fx_currency, source, note, by)
               values (${ctx.biz}, ${e.name}, ${moneyDate(ctx, payload.date)}, ${str(payload.reference).slice(0, 80) || null}, ${amount},
                       ${num(payload.fxAmount) || null}, ${str(payload.fxCurrency).toUpperCase().slice(0, 6) || null}, 'manual',
                       ${str(payload.note).slice(0, 300) || null}, ${whoIs(ctx)})`;
  return erpSupplierPage(ctx, { name: e.name });
}

/** Money sent to a supplier, out of a money account. More than is owed is allowed: it is an advance. */
export async function erpSupplierPay(ctx, payload) {
  payload = payload || {};
  const e = (await known(ctx))[key(payload.name)];
  if (!e) throw new Error('That supplier is not on the list.');
  const amount = round2(num(payload.amount));
  if (!(amount > 0)) throw new Error('How much was paid? Type an amount above 0.');
  await assertOpen(ctx, moneyDate(ctx, payload.date), 'a payment cannot be dated there');
  let account = null;
  const have = await ctx.tx`select id, archived, kind from money_accounts where business_id = ${ctx.biz}`;
  if (have.length) {
    const a = have.find((x) => x.id === (isId(payload.account) ? payload.account : ''));
    if (!a) throw new Error('Choose the account the money left.');
    if (a.archived) throw new Error('That account is retired. Choose one that is in use.');
    account = a.id;
  }
  await ctx.tx`insert into supplier_payments (business_id, supplier, at, amount, account_id, fx_amount, fx_currency, note, by)
               values (${ctx.biz}, ${e.name}, ${moneyDate(ctx, payload.date)}, ${amount}, ${account}, ${num(payload.fxAmount) || null},
                       ${str(payload.fxCurrency).toUpperCase().slice(0, 6) || null}, ${str(payload.note).slice(0, 300) || null}, ${whoIs(ctx)})`;
  return erpSupplierPage(ctx, { name: e.name });
}

/** Strike out a bill or a payment, saying why. */
export async function erpSupplierVoid(ctx, payload) {
  payload = payload || {};
  const why = str(payload.reason), id = isId(payload.id) ? payload.id : null;
  if (!why) throw new Error('Say why it is being struck out.');
  const mark = 'struck out ' + formatDate(new Date(), 'd MMM yy') + ' by ' + whoIs(ctx) + ': ' + why;
  const was = payload.kind === 'payment'
    ? await ctx.tx`select at from supplier_payments where id = ${id} and business_id = ${ctx.biz}`
    : await ctx.tx`select at from supplier_bills where id = ${id} and business_id = ${ctx.biz}`;
  if (was[0]) await assertOpen(ctx, new Date(was[0].at), 'its lines cannot be struck out');
  const r = payload.kind === 'payment'
    ? await ctx.tx`update supplier_payments set voided = ${mark} where id = ${id} and business_id = ${ctx.biz} and voided is null returning supplier`
    : await ctx.tx`update supplier_bills set voided = ${mark} where id = ${id} and business_id = ${ctx.biz} and voided is null returning supplier`;
  if (!r.length) throw new Error('That line was not found, or is already struck out.');
  return erpSupplierPage(ctx, { name: r[0].supplier });
}

export const HANDLERS = { erpSuppliers, erpSupplierPage, erpSupplierSave, erpSupplierBill, erpSupplierPay, erpSupplierVoid };
