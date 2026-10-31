// FIFO lots and shipments (FilaDash merge P3, decision F1; supabase/107_fifo_lots.sql keeps the lots).
//
//   lotLineCost   what one sale movement cost: the lots it took, oldest first (a lot whose cost is not known -
//                 stock from before lots began - at the product's cost-book price, as before)
//   lotStock      stock value at FIFO: what is left in each lot x that lot's cost
//   erpShipments  every shipment (receiving reference) with what came in, what is left, what sold, its profit
//   erpShipment   one shipment line by line, with its freight / duty / agent costs
//   erpLots       one product's lots

import { str } from '../lib/tabs.js';
import { formatDate, num, round2 } from '../lib/time.js';
import { products } from './dashboard.js';
import { holdingFor, lotMonths } from './holding.js';
import { powerOn, roleAtLeast } from '../allow.js';
import { assertOpen } from '../lib/period.js';

/** The sold part of late costs: { reference: amount } (cost of sales of the month they were entered in). */
export async function lateSold(ctx) {
  const out = {};
  for (const r of await ctx.tx`select reference, sum(sold_part) as s from late_costs where business_id = ${ctx.biz} group by reference`) out[str(r.reference)] = num(r.s);
  return out;
}

const sumM = (o) => Object.values(o || {}).reduce((t, v) => t + num(v), 0);

const R = (v) => Math.round(num(v));

/** The cost of one sale movement from its lot draws; `fallback` for what had no known cost. 0 when nothing is known. */
export async function lotLineCost(ctx, movementId, fallback) {
  const rows = await ctx.tx`select qty, unit_cost from lot_draws where movement_id = ${movementId} and qty > 0`;
  let q = 0, v = 0, known = true;
  for (const r of rows) {
    const c = r.unit_cost === null ? num(fallback) : num(r.unit_cost);
    if (!(c > 0)) known = false;
    q += num(r.qty); v += num(r.qty) * c;
  }
  if (!(q > 0) || !known) return num(fallback) > 0 && q > 0 ? round2(v / q) : 0;
  return round2(v / q);
}

/** Stock at FIFO: { value, units, uncosted, bySku: { sku: { value, units } } } for products that have lots;
 *  products whose stock has not moved since lots began are valued as before (their cost x stock). */
export async function lotStock(ctx) {
  if (ctx.memo.lotStock) return ctx.memo.lotStock;
  const { list } = await products(ctx);
  const byId = {};
  const rows = await ctx.tx`
    select p.sku, sum(l.qty_left) as units, sum(l.qty_left * l.unit_cost) filter (where l.unit_cost is not null) as known,
           sum(l.qty_left) filter (where l.unit_cost is null) as unknown_units
    from stock_lots l join products p on p.id = l.product_id
    where l.business_id = ${ctx.biz} and l.qty_left > 0 group by p.sku`;
  for (const r of rows) byId[str(r.sku).toLowerCase()] = r;
  const out = { value: 0, units: 0, uncosted: 0, bySku: {} };
  for (const p of list) {
    const k = p.sku.toLowerCase(), r = byId[k];
    let value, units;
    if (r) { units = num(r.units); value = num(r.known) + num(r.unknown_units) * (p.cost > 0 ? p.cost : 0); if (num(r.unknown_units) > 0 && !(p.cost > 0)) out.uncosted++; }
    else { units = Math.max(0, p.stock); value = units * (p.cost > 0 ? p.cost : 0); if (units > 0 && !(p.cost > 0)) out.uncosted++; }
    out.bySku[k] = { value, units };
    out.value += value; out.units += units;
  }
  ctx.memo.lotStock = out;
  return out;
}

/** What each sale draw earned: the line's price per unit (after its own discount) x the units drawn; returns put it back. */
async function drawRows(ctx, refFilter) {
  return ctx.tx`
    select l.id as lot, l.reference, d.qty, coalesce(d.unit_cost, 0) as unit_cost, d.unit_cost is null as nocost,
           case when m.kind::text = 'SALE' then (select il.line_total / nullif(il.qty, 0) from invoice_lines il
                      where il.invoice_id = m.invoice_id and il.product_id = d.product_id and il.qty > 0 order by il.line_no limit 1)
                when m.kind::text = 'RETURN' then (select il.line_total / nullif(il.qty, 0) from invoice_lines il
                      join invoices i on i.id = il.invoice_id
                      where i.business_id = ${ctx.biz} and i.invoice_no = btrim(substr(m.reference, 9)) and il.product_id = d.product_id and il.qty > 0
                      order by il.line_no limit 1)
           end as price, m.kind::text as kind, d.at
    from lot_draws d join stock_lots l on l.id = d.lot_id join stock_movements m on m.id = d.movement_id
    where d.business_id = ${ctx.biz} ${refFilter ? ctx.tx`and l.reference = ${refFilter}` : ctx.tx``}`;
}

function sums(lot, draws) {
  const s = { sold: 0, revenue: 0, cost: 0, other: 0 };
  for (const d of draws) {
    if (d.kind === 'SALE' || d.kind === 'RETURN') {
      s.sold += num(d.qty); s.revenue += num(d.qty) * num(d.price); s.cost += num(d.qty) * num(d.unit_cost);
    } else if (num(d.qty) > 0) s.other += num(d.qty);               // counted out, damaged, used in a repair
  }
  return s;
}

/** Shipments with their lots and figures; once per read-only call (ctx.memo.__ro). */
export async function erpShipments(ctx, payload) {
  if (str(payload && payload.pool)) {
    const r = await poolShipments(ctx, payload.pool, (pctx) => erpShipmentsRaw(pctx));
    const costs = {};
    for (const c of await ctx.tx`select reference, sum(amount) as amount from shipment_costs where business_id = ${ctx.biz} and voided is null group by reference`) costs[str(c.reference)] = num(c.amount);
    r.shipments.forEach((x) => { x.extraCosts = R(costs[x.reference] || 0); });
    return { ...r, pool: str(payload.pool) };
  }
  if (ctx.memo && ctx.memo.__ro && ctx.memo.__ship) return ctx.memo.__ship;
  const r = await erpShipmentsRaw(ctx);
  if (ctx.memo && ctx.memo.__ro) ctx.memo.__ship = r;
  return r;
}
async function erpShipmentsRaw(ctx) {
  const lots = await ctx.tx`
    select l.id, l.reference, l.supplier, l.source, l.received_at, l.qty_in, l.qty_left, l.unit_cost, p.sku, p.name
    from stock_lots l join products p on p.id = l.product_id
    where l.business_id = ${ctx.biz} and l.qty_in > 0 and l.source in ('receive', 'opening')
    order by l.received_at desc, l.seq desc`;
  const draws = {};
  for (const d of await drawRows(ctx, null)) (draws[d.lot] = draws[d.lot] || []).push(d);
  const costs = {};
  for (const c of await ctx.tx`select reference, sum(amount) as amount from shipment_costs where business_id = ${ctx.biz} group by reference`) costs[str(c.reference)] = num(c.amount);
  const by = {}, order = [];
  for (const l of lots) {
    const key = l.source === 'opening' ? '~opening' : str(l.reference) || '(no reference)';
    let s = by[key];
    if (!s) {
      s = by[key] = { reference: l.source === 'opening' ? 'Stock before lots began' : key, opening: l.source === 'opening', supplier: str(l.supplier),
                      at: l.received_at, products: 0, unitsIn: 0, unitsLeft: 0, landed: 0, leftValue: 0, sold: 0, revenue: 0, cost: 0, other: 0, uncosted: 0 };
      order.push(key);
    }
    if (l.received_at < s.at) s.at = l.received_at;
    const x = sums(l, draws[l.id] || []);
    s.products++; s.unitsIn += num(l.qty_in); s.unitsLeft += num(l.qty_left);
    if (l.unit_cost === null) s.uncosted++;
    s.landed += num(l.qty_in) * num(l.unit_cost); s.leftValue += num(l.qty_left) * num(l.unit_cost);
    s.sold += x.sold; s.revenue += x.revenue; s.cost += x.cost; s.other += x.other;
  }
  const list = order.map((k) => {
    const s = by[k];
    return { reference: s.reference, opening: s.opening, supplier: s.supplier, date: formatDate(s.at, 'd MMM yyyy'), products: s.products,
             unitsIn: R(s.unitsIn), unitsLeft: R(s.unitsLeft), soldPct: s.unitsIn > 0 ? Math.round(s.sold / s.unitsIn * 100) : 0,
             landed: R(s.landed), extraCosts: R(costs[s.reference] || 0), leftValue: R(s.leftValue), sold: R(s.sold), revenue: R(s.revenue),
             cost: R(s.cost), profit: R(s.revenue - s.cost), margin: s.revenue > 0 ? Math.round((s.revenue - s.cost) / s.revenue * 1000) / 10 : 0,
             costKnown: s.uncosted === 0, status: s.unitsLeft <= 0 ? 'Sold out' : s.sold > 0 ? 'Selling' : 'In stock' };
  });
  const hold = await holdingFor(ctx, await lotMonths(ctx));
  const late = await lateSold(ctx);
  list.forEach((x) => {
    // a cost that came after the goods: the part for units already sold is a cost of these sales (111)
    if (late[x.reference]) { x.cost += R(late[x.reference]); x.profit -= R(late[x.reference]); x.margin = x.revenue > 0 ? Math.round(x.profit / x.revenue * 1000) / 10 : 0; }
    x.holding = R(sumM(hold.byRef[x.reference])); x.net = x.profit - x.holding;
  });
  const t = list.filter((x) => !x.opening);
  return { currency: 'BDT', shipments: list, holdingOn: hold.on, holdingCategories: hold.categories, noWeight: hold.noWeight,
           totals: { count: t.length, landed: t.reduce((a, x) => a + x.landed, 0), leftValue: t.reduce((a, x) => a + x.leftValue, 0),
                     profit: t.reduce((a, x) => a + x.profit, 0), revenue: t.reduce((a, x) => a + x.revenue, 0),
                     holding: t.reduce((a, x) => a + x.holding, 0), net: t.reduce((a, x) => a + x.net, 0) } };
}

export async function erpShipment(ctx, payload) {
  if (str(payload && payload.pool)) {
    const ref = str(payload.reference);
    const r = await poolShipments(ctx, payload.pool, (pctx) => erpShipment(pctx, { reference: ref }));
    r.extra = (await ctx.tx`select id, label, amount, at, voided from shipment_costs where business_id = ${ctx.biz} and reference = ${ref} order by at`)
      .map((c) => ({ id: c.id, label: str(c.label), amount: R(c.amount), voided: str(c.voided) }));
    const bill = (await ctx.tx`select supplier, amount, fx_amount, fx_currency, fx_rate from supplier_bills where business_id = ${ctx.biz} and reference = ${ref} limit 1`)[0];
    r.bill = bill ? { supplier: str(bill.supplier), amount: R(bill.amount), fx: num(bill.fx_amount) ? num(bill.fx_amount) + ' ' + str(bill.fx_currency) + ' @ ' + num(bill.fx_rate) : '' } : null;
    return { ...r, pool: str(payload.pool) };
  }
  const ref = str(payload && payload.reference);
  if (!ref) throw new Error('Which shipment?');
  const opening = ref === 'Stock before lots began';
  const lots = opening
    ? await ctx.tx`select l.*, p.sku, p.name from stock_lots l join products p on p.id = l.product_id
                   where l.business_id = ${ctx.biz} and l.source = 'opening' and l.qty_in > 0 order by p.name`
    : await ctx.tx`select l.*, p.sku, p.name from stock_lots l join products p on p.id = l.product_id
                   where l.business_id = ${ctx.biz} and l.reference = ${ref} and l.source = 'receive' order by l.seq`;
  if (!lots.length) throw new Error('No shipment called "' + ref + '".');
  const draws = {};
  for (const d of await drawRows(ctx, opening ? null : ref)) (draws[d.lot] = draws[d.lot] || []).push(d);
  const { bySku } = await products(ctx);
  const hold = await holdingFor(ctx, await lotMonths(ctx));
  const lines = lots.map((l) => {
    const x = sums(l, draws[l.id] || []);
    const book = bySku[str(l.sku).toLowerCase()];
    const holding = R(sumM(hold.byLot[l.id]));
    return { sku: str(l.sku), name: str(l.name), unitCost: l.unit_cost === null ? null : num(l.unit_cost), bookCost: book ? R(book.cost) : 0,
             unitsIn: num(l.qty_in), unitsLeft: num(l.qty_left), sold: x.sold, other: x.other, revenue: R(x.revenue), cost: R(x.cost), profit: R(x.revenue - x.cost),
             holding, net: R(x.revenue - x.cost) - holding };
  });
  const extra = opening ? [] : (await ctx.tx`select id, label, amount, at, voided from shipment_costs where business_id = ${ctx.biz} and reference = ${ref} order by at`)
    .map((c) => ({ id: c.id, label: str(c.label), amount: R(c.amount), voided: str(c.voided) }));
  const bill = opening ? null : (await ctx.tx`select supplier, amount, fx_amount, fx_currency, fx_rate from supplier_bills
                                               where business_id = ${ctx.biz} and reference = ${ref} limit 1`)[0] || null;
  return { reference: ref, opening, supplier: str(lots[0].supplier), date: formatDate(lots[0].received_at, 'd MMM yyyy, h:mm a'), currency: 'BDT', lines, extra,
           holdingOn: hold.on, holdingCategories: hold.categories, lateSold: opening ? 0 : R((await lateSold(ctx))[ref] || 0),
           bill: bill ? { supplier: str(bill.supplier), amount: R(bill.amount), fx: num(bill.fx_amount) ? num(bill.fx_amount) + ' ' + str(bill.fx_currency) + ' @ ' + num(bill.fx_rate) : '' } : null };
}

export async function erpLots(ctx, payload) {
  const sku = str(payload && payload.sku);
  const rows = await ctx.tx`
    select l.reference, l.source, l.received_at, l.qty_in, l.qty_left, l.unit_cost, l.supplier
    from stock_lots l join products p on p.id = l.product_id
    where l.business_id = ${ctx.biz} and lower(p.sku) = ${sku.toLowerCase()} and l.qty_in > 0
    order by l.received_at, l.seq`;
  const book = (await products(ctx)).bySku[sku.toLowerCase()];
  return { sku, bookCost: book ? R(book.cost) : 0,
           lots: rows.map((l) => ({ reference: l.source === 'opening' ? 'Stock before lots began' : str(l.reference), source: l.source, date: formatDate(l.received_at, 'd MMM yyyy'),
                                     unitsIn: num(l.qty_in), unitsLeft: num(l.qty_left), unitCost: l.unit_cost === null ? null : num(l.unit_cost), supplier: str(l.supplier) })) };
}

// ------------------------------------------------------------- investors per shipment (109)

async function fundingRows(ctx, ref) {
  return ctx.tx`
    select f.id, f.holder_no, f.reference, f.pct, f.amount, f.note, f.at, h.name, h.return_value, h.private
    from lot_funding f left join capital_holders h on h.business_id = f.business_id and h.holder_no = f.holder_no
    where f.business_id = ${ctx.biz} and f.voided_at is null ${ref ? ctx.tx`and f.reference = ${ref}` : ctx.tx``}
    order by f.at`;
}

/** Each funding with what it has earned so far: profit on its share of the units sold, and the cost recovered. */
export async function erpLotFunding(ctx, payload) {
  const ref = str(payload && payload.reference);
  const owner = ctx.s.role === 'owner';
  const rows = await fundingRows(ctx, ref);
  const out = [];
  // fix-3 M18: what a funding earned is the very figure the Capital screen and the investor's page count (returns.js)
  const { investorReturns } = await import('./returns.js');
  const ret = await investorReturns(ctx);
  for (const f of rows) {
    if (f.private && !owner) continue;
    const ds = await drawRows(ctx, str(f.reference));
    let sold = 0, revenue = 0, cost = 0, unitsIn = 0, landed = 0;
    const since = new Date(f.at).getTime();
    for (const d of ds) if ((d.kind === 'SALE' || d.kind === 'RETURN') && !(d.at && new Date(d.at).getTime() < since)) { sold += num(d.qty); revenue += num(d.qty) * num(d.price); cost += num(d.qty) * num(d.unit_cost); }
    for (const l of await ctx.tx`select qty_in, unit_cost from stock_lots where business_id = ${ctx.biz} and reference = ${str(f.reference)} and source = 'receive'`) {
      unitsIn += num(l.qty_in); landed += num(l.qty_in) * num(l.unit_cost);
    }
    const p = num(f.pct) / 100;
    const held = sumM((await holdingFor(ctx, await lotMonths(ctx))).byRef[str(f.reference)]);
    const late = num((await ctx.tx`select coalesce(sum(sold_part), 0) as s from late_costs where business_id = ${ctx.biz} and reference = ${str(f.reference)} and month >= to_char(public.dhaka_date(${f.at}::timestamptz), 'YYYY-MM')`)[0].s);
    const earnedM = ret.byFunding[f.id] || {};
    out.push({ id: f.id, holder: str(f.holder_no), name: str(f.name) || str(f.holder_no), reference: str(f.reference), pct: num(f.pct), profitShare: num(f.return_value),
               funded: R(num(f.amount) > 0 ? num(f.amount) : landed * p), unitsFunded: Math.round(unitsIn * p * 100) / 100, soldUnits: Math.round(sold * p * 100) / 100,
               recovered: R(cost * p), profit: R((revenue - cost - late) * p), holding: R(held * p),
               earned: R(Object.values(earnedM).reduce((t, v) => t + num(v), 0)),
               since: formatDate(f.at, 'd MMM yyyy'), note: str(f.note) });
  }
  return { currency: 'BDT', funding: out };
}

/** The owner says who funded what share of a shipment. All shares of one shipment together stay within 100%. */
export async function erpLotFund(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder or a shareholder says who funded a shipment.');
  payload = payload || {};
  const ref = str(payload.reference), holder = str(payload.holder), pct = Math.round(num(payload.pct) * 1000) / 1000;
  if (!ref) throw new Error('Which shipment?');
  if (!(pct > 0 && pct <= 100)) throw new Error('Their share of the shipment is a percentage above 0 and up to 100.');
  const h = (await ctx.tx`select holder_no, name, kind, return_kind, ended_month from capital_holders where business_id = ${ctx.biz} and holder_no = ${holder}`)[0];
  if (!h) throw new Error('Choose an investor from Capital.');
  if (str(h.kind) !== 'investor' || str(h.return_kind) !== 'lot') throw new Error(str(h.name) + ' is not paid by shipment profit. On Capital, set their return to "Share of profit on shipments they fund".');
  if (h.ended_month) throw new Error(str(h.name) + ' has left.');
  const has = await ctx.tx`select 1 from stock_lots where business_id = ${ctx.biz} and reference = ${ref} and source = 'receive' limit 1`;
  if (!has.length) throw new Error('No shipment called "' + ref + '".');
  await ctx.tx`select pg_advisory_xact_lock(hashtext(${'lotfund:' + ctx.biz}))`;
  const used = num((await ctx.tx`select coalesce(sum(pct), 0) as s from lot_funding where business_id = ${ctx.biz} and reference = ${ref} and voided_at is null`)[0].s);
  if (used + pct > 100.0001) throw new Error('That would fund ' + (used + pct) + '% of ' + ref + '. ' + used + '% is already funded, so at most ' + (100 - used) + '% is free.');
  // Q1 (owner's rule, fix-3): a share of a shipment is money put in - what it cost when received x the share, out of the
  // investor's money in the business that is not already in another shipment still on the shelf
  const cost0 = num((await ctx.tx`select coalesce(sum(l.qty_in * coalesce(nullif(m.unit_price, 0), l.unit_cost, 0)), 0) as v from stock_lots l
                                  left join stock_movements m on m.id = l.movement_id
                                  where l.business_id = ${ctx.biz} and l.reference = ${ref} and l.source = 'receive'`)[0].v);
  const amount = round2(cost0 * pct / 100);
  const capital = num((await ctx.tx`select coalesce(sum(case when type = 'invest' then amount when type = 'withdraw' then -amount else 0 end), 0) as c
                                    from capital_book where business_id = ${ctx.biz} and holder_no = ${holder} and coalesce(btrim(voided), '') = ''`)[0].c);
  const tied = num((await ctx.tx`select coalesce(sum(f.amount * coalesce((select sum(l.qty_left) / nullif(sum(l.qty_in), 0) from stock_lots l
                                   where l.business_id = f.business_id and l.reference = f.reference and l.source = 'receive'), 0)), 0) as t
                                 from lot_funding f where f.business_id = ${ctx.biz} and f.holder_no = ${holder} and f.voided_at is null`)[0].t);
  if (amount > capital - tied + 0.5) {
    throw new Error(pct + '% of ' + ref + ' is ' + Math.round(amount) + ' of money. ' + str(h.name) + ' has ' + Math.round(capital) + ' in the business' +
                    (tied > 0.5 ? ', ' + Math.round(tied) + ' of it in shipments still on the shelf' : '') + ', so ' + Math.max(0, Math.round(capital - tied)) +
                    ' is free. Record more money put in first, or fund a smaller share.');
  }
  await ctx.tx`insert into lot_funding (business_id, holder_no, reference, pct, note, by, amount)
               values (${ctx.biz}, ${holder}, ${ref}, ${pct}, ${str(payload.note).slice(0, 200) || null}, ${str(ctx.s.name) || 'Owner'}, ${amount})`;
  delete ctx.memo.invReturns;
  return erpLotFunding(ctx, { reference: ref });
}

/** A funding written by mistake is struck out with a reason (its returns stop counting). */
export async function erpLotFundVoid(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder or a shareholder changes who funded a shipment.');
  const id = str(payload && payload.id), why = str(payload && payload.reason);
  if (!why) throw new Error('Say why it is struck out.');
  const f0 = (await ctx.tx`select at from lot_funding where business_id = ${ctx.biz} and id = ${id} and voided_at is null`)[0];
  if (f0) await assertOpen(ctx, new Date(f0.at), 'a funding from there cannot be struck out (its returns are in the closed books)');   // fix-3 H14
  const r = await ctx.tx`update lot_funding set voided_at = now(), voided_why = ${why.slice(0, 200)}
                         where business_id = ${ctx.biz} and id = ${id} and voided_at is null returning reference`;
  if (!r.length) throw new Error('That funding is not there.');
  delete ctx.memo.invReturns;
  return erpLotFunding(ctx, { reference: str(r[0].reference) });
}

/**
 * A bill for a shipment that came after the goods (111): the money leaves the account named (a shipment cost, as
 * freight does); shared over the shipment's lots by value, weight or units; per lot the units already gone take
 * their part as cost of sales of this month, the units still on the shelf get the rest added to their cost.
 */
/** cost-fix-1 (27 Oct 2026, owner: "how can a 1,600 TK product cost 6,000?" - the goods total had been typed as the
 *  shipping too): strike a shipment cost out. Its share comes off every lot of the shipment in proportion to the
 *  lot's value (exact when the costs were shared by value, which is the usual way), off the draws already made from
 *  those lots and off the cost fixed on the sale lines they fed - the sale was costed from a slip of the finger,
 *  not from a real cost. Nothing is deleted: the cost row stays, struck out with the reason. */
export async function erpShipmentCostVoid(ctx, payload) {
  payload = payload || {};
  if (!powerOn(ctx.s, 'costs')) throw new Error('Your account cannot change what goods cost.');
  const ref = str(payload.reference), id = str(payload.id), reason = str(payload.reason).slice(0, 200);
  if (!ref || !id) throw new Error('Which cost of which shipment?');
  if (!reason) throw new Error('Say why it is struck out.');
  await ctx.tx`select pg_advisory_xact_lock(hashtext(${'stock:' + ctx.biz}))`;
  const c = (await ctx.tx`select * from shipment_costs where business_id = ${ctx.biz} and reference = ${ref} and id::text = ${id} for update`)[0];
  if (!c) throw new Error('No such cost on "' + ref + '".');
  if (str(c.voided)) throw new Error('That cost is already struck out.');
  const amount = num(c.amount);
  const lots = await ctx.tx`select id, qty_in, qty_left, coalesce(unit_cost, 0) as unit_cost from stock_lots
                            where business_id = ${ctx.biz} and reference = ${ref} and source = 'receive' and qty_in > 0 for update`;
  if (!lots.length) throw new Error('No shipment called "' + ref + '".');
  const value = lots.reduce((t, l) => t + num(l.unit_cost) * num(l.qty_in), 0);
  if (!(value > 0)) throw new Error('The lots of this shipment carry no cost to take it off.');
  const keep = Math.max(0, 1 - amount / value);   // every unit of the shipment keeps this much of its cost
  const who = str(ctx.s.name) || 'Someone';
  const changed = [];
  let offShelf = 0, offSold = 0;
  for (const l of lots) {
    const before = num(l.unit_cost), after = round2(before * keep);
    await ctx.tx`update stock_lots set unit_cost = ${after} where id = ${l.id}`;
    offShelf += (before - after) * num(l.qty_left);
    const draws = await ctx.tx`select d.id, d.qty, d.reversed, coalesce(d.unit_cost, 0) as unit_cost, d.movement_id, d.product_id, m.invoice_id
                               from lot_draws d join stock_movements m on m.id = d.movement_id where d.lot_id = ${l.id}`;
    for (const d of draws) {
      const dBefore = num(d.unit_cost), dAfter = round2(dBefore * keep);
      const nd = await ctx.tx`update lot_draws set unit_cost = ${dAfter} where id = ${d.id}`;
      if (!nd.count) throw new Error('The draw could not be re-costed.');
      offSold += (dBefore - dAfter) * Math.max(0, num(d.qty) - num(d.reversed));
      if (d.invoice_id) {
        // the sale line's fixed cost = the average of what its draws now say
        const avg = (await ctx.tx`select sum(d2.qty * coalesce(d2.unit_cost, 0)) / nullif(sum(d2.qty), 0) as c from lot_draws d2 where d2.movement_id = ${d.movement_id}`)[0];
        if (avg && avg.c !== null) {
          const n = await ctx.tx`update invoice_lines set unit_cost = ${round2(num(avg.c))} where invoice_id = ${d.invoice_id}
                                 and (product_id = ${d.product_id} or lower(btrim(sku)) = (select lower(btrim(sku)) from products where id = ${d.product_id}))`;
          if (!n.count) throw new Error('The sale line could not be re-costed (invoice ' + d.invoice_id + ').');
          changed.push(d.invoice_id);
        }
      }
    }
  }
  await ctx.tx`update shipment_costs set voided = ${'struck out ' + formatDate(ctx.now, 'd MMM yy') + ' by ' + who + ': ' + reason} where id = ${c.id}`;
  const invoices = (await ctx.tx`select invoice_no from invoices where id = any(${[...new Set(changed)]})`).map((r) => str(r.invoice_no));
  return { ok: true, reference: ref, label: str(c.label), amount: R(amount), offShelf: R(offShelf), offSold: R(offSold), lots: lots.length, invoices,
           keptShare: Math.round(keep * 1000) / 10 };
}

export async function erpShipmentLateCost(ctx, payload) {
  payload = payload || {};
  if (!powerOn(ctx.s, 'costs')) throw new Error('Your account cannot change what goods cost.');
  const ref = str(payload.reference), label = str(payload.label).slice(0, 60), amount = round2(num(payload.amount));
  const basis = str(payload.basis) || 'value';
  if (!ref) throw new Error('Which shipment?');
  if (!label) throw new Error('Say what the bill is for (duty, freight, agent...).');
  if (!(amount > 0)) throw new Error('How much is the bill?');
  if (!{ value: 1, weight: 1, units: 1 }[basis]) throw new Error('Share it by value, by weight or by units.');
  await assertOpen(ctx, ctx.now, 'a cost cannot be added to it');
  await ctx.tx`select pg_advisory_xact_lock(hashtext(${'stock:' + ctx.biz}))`;
  const lots = await ctx.tx`
    select l.id, l.qty_in, l.qty_left, coalesce(l.unit_cost, 0) as unit_cost,
           greatest(coalesce(p.weight_g, 0), case when p.length_mm > 0 and p.width_mm > 0 and p.height_mm > 0 then p.length_mm * p.width_mm * p.height_mm / 6000 else 0 end) as g,
           p.name
    from stock_lots l join products p on p.id = l.product_id
    where l.business_id = ${ctx.biz} and l.reference = ${ref} and l.source = 'receive' and l.qty_in > 0 for update of l`;
  if (!lots.length) throw new Error('No shipment called "' + ref + '".');
  const measure = (l) => basis === 'weight' ? num(l.g) * num(l.qty_in) : basis === 'units' ? num(l.qty_in) : num(l.unit_cost) * num(l.qty_in);
  if (basis === 'weight') { const miss = lots.filter((l) => !(num(l.g) > 0)); if (miss.length) throw new Error('Give the weight of ' + miss.map((l) => str(l.name)).slice(0, 3).join(', ') + ' to share it by weight.'); }
  let of = lots.reduce((t, l) => t + measure(l), 0);
  const byUnits = !(of > 0);
  if (byUnits) of = lots.reduce((t, l) => t + num(l.qty_in), 0);
  let sold = 0, shelf = 0;
  const split = [];
  for (const l of lots) {
    const share = amount * (byUnits ? num(l.qty_in) : measure(l)) / of;
    const left = num(l.qty_left), inq = num(l.qty_in);
    const onShelf = left > 0 ? share * left / inq : 0;
    const gone = share - onShelf;
    const before = num(l.unit_cost), after = left > 0 ? round2(before + onShelf / left) : before;
    if (left > 0) await ctx.tx`update stock_lots set unit_cost = ${after} where id = ${l.id}`;
    sold += gone; shelf += onShelf;
    split.push({ lot: l.id, product: str(l.name), share: round2(share), sold: round2(gone), shelf: round2(onShelf), before, after });
  }
  sold = round2(sold); shelf = round2(amount - sold);
  let acc = null;
  if (str(payload.account)) {
    const a = await ctx.tx`select id from money_accounts where business_id = ${ctx.biz} and id::text = ${str(payload.account)} and not archived`;
    acc = a[0] ? a[0].id : null;
  }
  const who = str(ctx.s.name) || 'Someone';
  const c = await ctx.tx`insert into shipment_costs (business_id, reference, at, label, amount, account_id, by)
                         values (${ctx.biz}, ${ref}, ${ctx.now}, ${label + ' (after the goods)'}, ${amount}, ${acc}, ${who}) returning id`;
  await ctx.tx`insert into late_costs (business_id, reference, month, label, amount, basis, sold_part, shelf_part, split, cost_id, by)
               values (${ctx.biz}, ${ref}, ${formatDate(ctx.now, 'yyyy-MM')}, ${label}, ${amount}, ${basis}, ${sold}, ${shelf}, ${JSON.stringify(split)}::jsonb, ${c[0].id}, ${who})`;
  Object.keys(ctx.memo).forEach((k) => { if (k.indexOf('pnl:') === 0 || k === 'lotStock' || k === 'invReturns') delete ctx.memo[k]; });
  return { ok: true, reference: ref, amount, soldPart: sold, shelfPart: shelf, split };
}

export const HANDLERS = { erpShipments, erpShipment, erpLots, erpLotFunding, erpLotFund, erpLotFundVoid, erpShipmentLateCost, erpShipmentCostVoid, erpShipmentReprice, erpShipmentRepriceCheck };

/**
 * price-each-2 (owner 1 Nov 2026, joint shipment 2000043072: the invoice had each colour's dollar price but two colours took
 * the whole goods total and 53 got only their freight, 205-314 TK). A shipment already received, priced again from its
 * invoice: the goods total is shared by each line's price x quantity, the freight and costs (what this company paid,
 * shipment_costs) by weight / units / value, and every place that cost lives follows - the lots, the receive movements,
 * what each sale already drew, the sale lines' fixed cost (and so profit) and the products' average cost.
 * Own stock and joint stock (payload.pool) alike; the supplier bill stays what it was (it is what is owed).
 * Refused: a month closed (the shipment's or a sale's), a line without a price, a cost added after the goods (strike it
 * out, correct, add it again). The prices' total must match the goods' (else CONFIRM: use the prices' total).
 */
async function repriceRun(ctx, payload, preview) {
  payload = payload || {};
  if (!powerOn(ctx.s, 'costs')) throw new Error('Your account cannot change what goods cost.');
  const ref = str(payload.reference);
  if (!ref) throw new Error('Which shipment?');
  const pool = str(payload.pool);
  if (!preview) await ctx.tx`select pg_advisory_xact_lock(hashtext(${'stock:' + ctx.biz}))`;
  // this company's side: what it paid besides the goods, and the supplier's bill for the goods
  const costRows = await ctx.tx`select id, amount, voided from shipment_costs where business_id = ${ctx.biz} and reference = ${ref}`;
  const lateIds = new Set((await ctx.tx`select cost_id from late_costs where business_id = ${ctx.biz} and reference = ${ref}`).map((r) => String(r.cost_id)));
  const bill = (await ctx.tx`select amount, fx_amount, fx_currency, fx_rate from supplier_bills
                             where business_id = ${ctx.biz} and reference = ${ref} and voided is null order by at limit 1`)[0] || null;
  const work = async (c, openOn) => {
    if (!preview && pool) await c.tx`select pg_advisory_xact_lock(hashtext(${'stock:' + c.biz}))`;
    const lots = preview
      ? await c.tx`select l.id, l.movement_id, l.product_id, l.qty_in, l.qty_left, l.unit_cost, l.received_at, p.sku, p.name, p.cost_price,
                         greatest(coalesce(p.weight_g, 0), case when p.length_mm > 0 and p.width_mm > 0 and p.height_mm > 0 then p.length_mm * p.width_mm * p.height_mm / 6000 else 0 end) as g
                  from stock_lots l join products p on p.id = l.product_id
                  where l.business_id = ${c.biz} and l.reference = ${ref} and l.source = 'receive' and l.qty_in > 0 order by l.seq`
      : await c.tx`select l.id, l.movement_id, l.product_id, l.qty_in, l.qty_left, l.unit_cost, l.received_at, p.sku, p.name, p.cost_price,
                         greatest(coalesce(p.weight_g, 0), case when p.length_mm > 0 and p.width_mm > 0 and p.height_mm > 0 then p.length_mm * p.width_mm * p.height_mm / 6000 else 0 end) as g
                  from stock_lots l join products p on p.id = l.product_id
                  where l.business_id = ${c.biz} and l.reference = ${ref} and l.source = 'receive' and l.qty_in > 0 order by l.seq for update of l`;
    if (!lots.length) throw new Error('No shipment called "' + ref + '"' + (pool ? ' in this joint stock.' : '.'));
    const first = lots.reduce((a, l) => (l.received_at < a ? l.received_at : a), lots[0].received_at);
    await openOn(first, 'the cost of its goods cannot be corrected');
    const live = costRows.filter((r) => !str(r.voided));
    if (live.some((r) => lateIds.has(String(r.id)))) {
      throw new Error('A cost was added to "' + ref + '" after the goods came. Strike it out first (Shipments), correct the prices, then add it again.');
    }
    const shipping = round2(live.reduce((t, r) => t + num(r.amount), 0));
    const landedNow = round2(lots.reduce((t, l) => t + num(l.qty_in) * num(l.unit_cost), 0));
    // the prices: in the bill's money unless another is named; one price per product code
    const cur = (str(payload.currency) || (bill && str(bill.fx_currency)) || 'BDT').toUpperCase();
    const fx = !/^(BDT|TK|TAKA)$/.test(cur);
    const rate = fx ? (num(payload.rate) || (bill && str(bill.fx_currency).toUpperCase() === cur ? num(bill.fx_rate) : 0)) : 1;
    if (fx && !(rate > 0)) throw new Error('Type the rate: how many taka one ' + cur + ' was.');
    const price = {};
    for (const x of Array.isArray(payload.prices) ? payload.prices : []) {
      const k = str(x && x.sku).toLowerCase(), v = num(x && x.price);
      if (v < 0) throw new Error('A price cannot be below zero.');
      if (k && v > 0) price[k] = v;
    }
    const miss = [...new Set(lots.filter((l) => !(price[str(l.sku).toLowerCase()] > 0)).map((l) => str(l.name) || str(l.sku)))];
    if (miss.length) throw new Error('No price for ' + miss.slice(0, 4).join(', ') + (miss.length > 4 ? ' and ' + (miss.length - 4) + ' more' : '') + '. Type every line’s price, as on the supplier invoice.');
    const w = lots.map((l) => price[str(l.sku).toLowerCase()] * rate * num(l.qty_in));
    const priced = round2(w.reduce((t, v) => t + v, 0));
    // the goods total: the supplier bill's, else what the goods carry now (the shipment's total less what was paid besides)
    let goods = bill ? round2(num(bill.amount)) : round2(landedNow - shipping);
    if (!(goods > 0)) goods = priced;
    const gap = Math.abs(priced - goods);
    let mismatch = null;
    if (gap > Math.max(1, goods * 0.01)) {
      mismatch = { goods: R(goods), priced: R(priced) };
      if (!payload.usePrices && !preview) {
        throw new Error('CONFIRM: The prices come to ' + Math.round(priced) + ' TK' + (fx ? ' (' + cur + ' × ' + rate + ')' : '') + ', but the shipment’s goods were ' + Math.round(goods) +
                        ' TK. Use the prices’ total? (The supplier bill stays ' + Math.round(goods) + ' TK.)');
      }
      if (payload.usePrices) goods = priced;
    }
    const basis = ['weight', 'units', 'value'].includes(str(payload.basis)) ? str(payload.basis) : (lots.every((l) => num(l.g) > 0) ? 'weight' : 'units');
    if (basis === 'weight') { const nw = lots.filter((l) => !(num(l.g) > 0)); if (nw.length) throw new Error('Give the weight of ' + nw.map((l) => str(l.name)).slice(0, 3).join(', ') + ' to share the freight by weight.'); }
    const m = lots.map((l, x) => basis === 'weight' ? num(l.g) * num(l.qty_in) : basis === 'units' ? num(l.qty_in) : w[x]);
    const sumW = w.reduce((t, v) => t + v, 0), sumM = m.reduce((t, v) => t + v, 0);
    const lines = lots.map((l, x) => {
      const q = num(l.qty_in), g = goods * w[x] / sumW / q, s = sumM > 0 ? shipping * m[x] / sumM / q : 0;
      return { lot: l, sku: str(l.sku), name: str(l.name), qty: q, left: num(l.qty_left), price: price[str(l.sku).toLowerCase()], goods: round2(g), shipping: round2(s),
               was: num(l.unit_cost), now: round2(g + s) };
    });
    const out = { reference: ref, currency: cur, rate: fx ? rate : 0, basis, goods: R(goods), shipping: R(shipping), landedWas: R(landedNow), mismatch, usePrices: !!payload.usePrices,
                  landedNow: R(lines.reduce((t, l) => t + l.now * l.qty, 0)),
                  lines: lines.map((l) => ({ sku: l.sku, name: l.name, qty: l.qty, left: l.left, price: l.price, goods: l.goods, shipping: l.shipping, was: l.was, now: l.now })) };
    // what was already sold from these lots, and its months
    const draws = await c.tx`select d.id, d.lot_id, d.qty, d.reversed, d.unit_cost, d.movement_id, d.product_id, m.invoice_id, m.created_at
                             from lot_draws d join stock_movements m on m.id = d.movement_id where d.lot_id = any(${lots.map((l) => l.id)})`;
    const byLot = {};
    for (const l of lines) byLot[l.lot.id] = l;
    out.soldChange = R(draws.reduce((t, d) => t + (byLot[d.lot_id].now - num(d.unit_cost)) * Math.max(0, num(d.qty) - num(d.reversed)) * (num(d.qty) > 0 ? 1 : 0), 0));
    out.shelfChange = R(lines.reduce((t, l) => t + (l.now - l.was) * l.left, 0));
    for (const d of draws) if (d.invoice_id && num(d.qty) > 0) await openOn(d.created_at, 'a sale made from this shipment cannot be re-costed');
    if (preview) return { preview: true, ...out };

    const who = str(ctx.s.name) || 'Someone';
    const stamp = ' | prices corrected ' + formatDate(ctx.now, 'd MMM yy') + ' by ' + who;
    for (const l of lines) {
      await c.tx`update stock_lots set unit_cost = ${l.now} where id = ${l.lot.id}`;
      if (l.lot.movement_id) {
        await c.tx`update stock_movements set unit_price = ${l.now}, total = ${round2(l.now * l.qty)},
                   note = left(coalesce(note, '') || ${stamp}, 600) where id = ${l.lot.movement_id}`;
      }
    }
    const touched = new Set();
    for (const d of draws) {
      await c.tx`update lot_draws set unit_cost = ${byLot[d.lot_id].now} where id = ${d.id}`;
      if (d.invoice_id && num(d.qty) > 0) touched.add(d.movement_id + '|' + d.invoice_id + '|' + d.product_id);
    }
    const invoices = new Set();
    for (const k of touched) {
      const [mid, inv, pid] = k.split('|');
      const avg = (await c.tx`select sum(qty * coalesce(unit_cost, 0)) / nullif(sum(qty), 0) as c from lot_draws where movement_id = ${mid} and qty > 0`)[0];
      if (!avg || avg.c === null) continue;
      const n = await c.tx`update invoice_lines set unit_cost = ${round2(num(avg.c))} where invoice_id = ${inv}
                           and (product_id = ${pid} or lower(btrim(sku)) = (select lower(btrim(sku)) from products where id = ${pid}))`;
      if (!n.count) throw new Error('The sale line could not be re-costed (invoice ' + inv + ').');
      invoices.add(inv);
    }
    // the products' average cost: what is left on the shelf, at what it now cost
    for (const pid of [...new Set(lines.map((l) => l.lot.product_id))]) {
      const a = (await c.tx`select sum(qty_left * unit_cost) / nullif(sum(qty_left), 0) as c from stock_lots
                            where product_id = ${pid} and qty_left > 0 and unit_cost is not null`)[0];
      const mine = lines.filter((l) => l.lot.product_id === pid);
      const v = a && a.c !== null ? round2(num(a.c)) : (Math.abs(num(mine[0].lot.cost_price) - mine[0].was) < 1 ? mine[mine.length - 1].now : null);
      if (v !== null) await c.tx`update products set cost_price = ${v}, updated_at = now() where id = ${pid}`;
    }
    out.invoices = invoices.size ? (await c.tx`select invoice_no from invoices where id = any(${[...invoices]})`).map((r) => str(r.invoice_no)) : [];
    return { ok: true, ...out };
  };
  if (pool) return (await import('./joint.js')).poolWork(ctx, pool, (pctx, _p, openOn) => work(pctx, openOn));
  return work(ctx, (d, what) => assertOpen(ctx, d, what));
}
export async function erpShipmentReprice(ctx, payload) { return repriceRun(ctx, payload, false); }
export async function erpShipmentRepriceCheck(ctx, payload) { return repriceRun(ctx, payload, true); }

/** price-each-2: a joint stock's shipments (the lots live in the pool; what was paid besides the goods, and the bill, here). */
async function poolShipments(ctx, poolId, fn) {
  return (await import('./joint.js')).poolWork(ctx, poolId, (pctx) => fn(pctx));
}
