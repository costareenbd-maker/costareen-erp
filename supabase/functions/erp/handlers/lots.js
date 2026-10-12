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
           end as price, m.kind::text as kind
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

export async function erpShipments(ctx) {
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
  const t = list.filter((x) => !x.opening);
  return { currency: 'BDT', shipments: list,
           totals: { count: t.length, landed: t.reduce((a, x) => a + x.landed, 0), leftValue: t.reduce((a, x) => a + x.leftValue, 0),
                     profit: t.reduce((a, x) => a + x.profit, 0), revenue: t.reduce((a, x) => a + x.revenue, 0) } };
}

export async function erpShipment(ctx, payload) {
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
  const lines = lots.map((l) => {
    const x = sums(l, draws[l.id] || []);
    const book = bySku[str(l.sku).toLowerCase()];
    return { sku: str(l.sku), name: str(l.name), unitCost: l.unit_cost === null ? null : num(l.unit_cost), bookCost: book ? R(book.cost) : 0,
             unitsIn: num(l.qty_in), unitsLeft: num(l.qty_left), sold: x.sold, other: x.other, revenue: R(x.revenue), cost: R(x.cost), profit: R(x.revenue - x.cost) };
  });
  const extra = opening ? [] : (await ctx.tx`select label, amount, at from shipment_costs where business_id = ${ctx.biz} and reference = ${ref} order by at`)
    .map((c) => ({ label: str(c.label), amount: R(c.amount) }));
  const bill = opening ? null : (await ctx.tx`select supplier, amount, fx_amount, fx_currency, fx_rate from supplier_bills
                                               where business_id = ${ctx.biz} and reference = ${ref} limit 1`)[0] || null;
  return { reference: ref, opening, supplier: str(lots[0].supplier), date: formatDate(lots[0].received_at, 'd MMM yyyy, h:mm a'), currency: 'BDT', lines, extra,
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

export const HANDLERS = { erpShipments, erpShipment, erpLots };
