// fd-20 (FilaDash merge, owner 13 Oct 2026: "his design is the top priority"): the figures his Inventory screen
// shows that the page did not have yet. One call, READ ONLY - it writes nothing and changes no formula:
//
//   erpFdInventory({ lots?, sku? })
//     items   per product: open lots, units in them, value at cost (FIFO: what is left in each lot x that lot's
//             landed cost; stock from before lots began at the cost book, exactly lotStock's figure), average
//             unit cost, holding cost carried so far (the holding-cost setting's own split, holding.js), the last
//             sale, the days it has sat still, and his status: In stock / Low / Out / Dead (120+ days idle)
//     kpi     units on hand, stock value at cost, items low or out, dead stock (value, items, holding carried)
//     moves   the last receipts, returns and adjustments (sales are on the invoices)
//     lots    (lots: true) every lot, newest first, with what is left and its landed cost
//     queue   (sku) one product's open lots oldest first: the FIFO queue, the first one sells next
//
// Money (value, unit cost, holding) only for the people with the "costs" ability; everyone who can open
// Products gets the units, lots, days and statuses. Holding cost never raises stock value (as in lots.js).

import { str } from '../lib/tabs.js';
import { formatDate, num } from '../lib/time.js';
import { powerOn, roleAtLeast } from '../allow.js';
import { products } from './dashboard.js';
import { lotStock } from './lots.js';
import { holdingFor, lotMonths } from './holding.js';

export const DEAD_DAYS = 120;
const DAY = 86400000;
const R = (v) => Math.round(num(v));
const R2 = (v) => Math.round(num(v) * 100) / 100;
const sumM = (o) => Object.values(o || {}).reduce((t, v) => t + num(v), 0);
const lotNo = (seq) => 'LOT-' + String(seq).padStart(5, '0');
const KIND = { RECEIVE: 'Received', RETURN: 'Return in', ADJUST: 'Adjustment', ADJUSTMENT: 'Adjustment', DAMAGE: 'Write-off', OPENING: 'Opening stock', MOVE: 'Moved', VOID: 'Cancelled sale' };

export async function erpFdInventory(ctx, payload) {
  payload = payload || {};
  const canCost = powerOn(ctx.s, 'costs');
  const { list, bySku } = await products(ctx);
  const LS = await lotStock(ctx);
  const nowMs = ctx.now.getTime();

  const lots = await ctx.tx`
    select l.id, l.seq, l.reference, l.source, l.supplier, l.received_at, l.qty_in, l.qty_left, l.unit_cost, p.sku, p.name
    from stock_lots l join products p on p.id = l.product_id
    where l.business_id = ${ctx.biz} and l.qty_in > 0
    order by l.received_at, l.seq`;
  const lastSale = {};
  for (const r of await ctx.tx`
      select p.sku, max(m.created_at) as at from stock_movements m join products p on p.id = m.product_id
      where m.business_id = ${ctx.biz} and m.kind::text = 'SALE' group by p.sku`) lastSale[str(r.sku).toLowerCase()] = new Date(r.at).getTime();
  const hold = canCost ? await holdingFor(ctx, await lotMonths(ctx)) : { on: false, byLot: {} };

  // ---- per product
  const items = {};
  const it = (sku) => items[sku] || (items[sku] = { lots: 0, lotUnits: 0, holding: 0, newestOpen: 0 });
  for (const l of lots) {
    const k = str(l.sku).toLowerCase(), x = it(k);
    if (canCost) x.holding += sumM(hold.byLot[l.id]);
    if (num(l.qty_left) > 0) { x.lots++; x.lotUnits += num(l.qty_left); x.newestOpen = Math.max(x.newestOpen, new Date(l.received_at).getTime()); }
  }
  const kpi = { units: 0, value: 0, lowOrOut: 0, dead: { value: 0, items: 0, holding: 0 }, deadDays: DEAD_DAYS };
  const out = {};
  for (const p of list) {
    const k = p.sku.toLowerCase(), x = items[k] || { lots: 0, lotUnits: 0, holding: 0, newestOpen: 0 };
    const active = !/discontinued|inactive/i.test(p.status);
    const stock = Math.max(0, num(p.stock));
    const ls = LS.bySku[k] || { value: 0, units: 0 };
    const ref = Math.max(lastSale[k] || 0, x.newestOpen || 0);
    const idle = ref ? Math.floor((nowMs - ref) / DAY) : null;
    const status = stock <= 0 ? 'out' : (idle === null || idle >= DEAD_DAYS) ? 'dead' : stock <= p.reorder ? 'low' : 'in_stock';
    const o = { lots: x.lots, status, idle, lastSale: lastSale[k] ? formatDate(new Date(lastSale[k]), 'd MMM yyyy') : null };
    if (canCost) {
      o.value = R(ls.value);
      o.avgUnit = ls.units > 0 && ls.value > 0 ? R2(ls.value / ls.units) : null;
      o.holding = R(x.holding);
    }
    out[p.sku] = o;
    if (!active) continue;
    kpi.units += stock;
    if (canCost) kpi.value += num(ls.value);
    if (status === 'low' || status === 'out') kpi.lowOrOut++;
    if (status === 'dead') { kpi.dead.items++; if (canCost) { kpi.dead.value += num(ls.value); kpi.dead.holding += x.holding; } }
  }
  kpi.value = canCost ? R(kpi.value) : null;
  if (canCost) { kpi.dead.value = R(kpi.dead.value); kpi.dead.holding = R(kpi.dead.holding); } else { kpi.dead.value = null; kpi.dead.holding = null; }

  // ---- the last receipts, returns and adjustments
  const moves = (await ctx.tx`
      select m.created_at, m.kind::text as kind, m.direction, m.qty, m.reference, m.note, p.sku, p.name
      from stock_movements m join products p on p.id = m.product_id
      where m.business_id = ${ctx.biz} and m.kind::text <> 'SALE'
      order by m.created_at desc limit 8`).map((m) => ({
    when: formatDate(new Date(m.created_at), 'd MMM yyyy'), kind: KIND[m.kind] || m.kind, dir: str(m.direction),
    qty: num(m.qty), ref: str(m.reference), note: str(m.note), sku: str(m.sku), name: str(m.name) }));

  const lotRow = (l) => {
    const book = bySku[str(l.sku).toLowerCase()], left = num(l.qty_left);
    const r = { lot: lotNo(l.seq), shipment: l.source === 'opening' ? 'Stock before lots began' : str(l.reference) || (l.source === 'return' ? 'Return' : l.source === 'adjust' ? 'Adjustment' : '—'),
                source: str(l.source), supplier: (roleAtLeast(ctx.s.role, 'manager') || powerOn(ctx.s, 'suppliers')) ? str(l.supplier) : '', sku: str(l.sku), name: str(l.name), date: formatDate(new Date(l.received_at), 'd MMM yyyy'),
                qtyIn: num(l.qty_in), qtyLeft: left, status: left > 0 ? 'open' : 'exhausted', costKnown: l.unit_cost !== null };
    if (canCost) {
      const unit = l.unit_cost === null ? (book && book.cost > 0 ? num(book.cost) : null) : num(l.unit_cost);
      r.unitCost = unit === null ? null : R2(unit);
      r.valueLeft = unit === null ? 0 : R(left * unit);
      r.holding = R(sumM(hold.byLot[l.id]));
    }
    return r;
  };
  const res = { currency: 'BDT', canCost, holdingOn: !!hold.on, asOf: formatDate(ctx.now, 'd MMM yyyy, h:mm a'), items: out, kpi, moves };
  if (payload.lots) res.lots = lots.slice().reverse().slice(0, 600).map(lotRow);
  if (payload.sku) {
    const k = str(payload.sku).toLowerCase();
    res.queue = lots.filter((l) => str(l.sku).toLowerCase() === k && num(l.qty_left) > 0).map(lotRow);
    res.exhausted = lots.filter((l) => str(l.sku).toLowerCase() === k && !(num(l.qty_left) > 0)).length;
  }
  return res;
}

export const HANDLERS = { erpFdInventory };
