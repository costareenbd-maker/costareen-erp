// System Check and Analytics (FilaDash merge P3).
//
//   erpSystemCheck  checks that the books agree with themselves (FilaDash's invariant checks, on our data): stock lots
//                   = stock, every lot's draws add up, invoices add up, nobody paid more than they owed, capital and
//                   shipment shares within 100%, the dashboard's net profit = the P&L's, plus warnings (stock without
//                   cost, money in no account, products without weight while holding cost is on)
//   erpAnalytics    shipment ROI (after holding), dead stock (on the shelf 90+ days, nothing sold for 60), colours,
//                   12 months of revenue / gross / net

import { str } from '../lib/tabs.js';
import { num, formatDate } from '../lib/time.js';
import { pnlFor, products } from './dashboard.js';
import { erpShipments } from './lots.js';
import { holdingConfig } from './holding.js';

const R = (v) => Math.round(num(v));
function shift(m, n) { let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + n; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + (mo < 10 ? '0' : '') + mo; }

export async function erpSystemCheck(ctx) {
  const out = [];
  const add = (id, area, title, bad, detail, warnOnly, go) => out.push({ id, area, title, status: bad ? (warnOnly ? 'warn' : 'fail') : 'pass', count: num(bad), detail: bad ? detail : '', go: go || '' });

  // ---- stock and lots
  const lotVsStock = await ctx.tx`
    select p.sku, p.name, ps.stock, coalesce(sum(l.qty_left), 0) as lots
    from products p join product_stock ps on ps.product_id = p.id join stock_lots l on l.product_id = p.id
    where p.business_id = ${ctx.biz} group by p.sku, p.name, ps.stock
    having abs(coalesce(sum(l.qty_left), 0) - greatest(ps.stock, 0)) > 0.001`;
  add('S1', 'Stock', 'Stock lots hold exactly the stock of each product', lotVsStock.length,
    lotVsStock.slice(0, 5).map((r) => str(r.name) + ': stock ' + num(r.stock) + ', lots ' + num(r.lots)).join('; '), false, 'products');
  const lotMath = await ctx.tx`
    select l.id, l.reference, l.qty_in, l.qty_left, coalesce(sum(d.qty), 0) as drawn
    from stock_lots l left join lot_draws d on d.lot_id = l.id
    where l.business_id = ${ctx.biz} group by l.id
    having abs(l.qty_in - coalesce(sum(d.qty), 0) - l.qty_left) > 0.001 or l.qty_left < 0 or l.qty_left > l.qty_in`;
  add('S2', 'Stock', 'Every lot: what came in − what was taken = what is left', lotMath.length,
    lotMath.slice(0, 5).map((r) => str(r.reference) + ' (in ' + num(r.qty_in) + ', taken ' + num(r.drawn) + ', left ' + num(r.qty_left) + ')').join('; '), false, 'shipments');
  const neg = await ctx.tx`select p.name from product_stock ps join products p on p.id = ps.product_id where p.business_id = ${ctx.biz} and ps.stock < 0`;
  add('S3', 'Stock', 'No product below zero', neg.length, neg.slice(0, 5).map((r) => str(r.name)).join(', '), false, 'products');
  const noCost = (await products(ctx)).list.filter((p) => p.stock > 0 && !(p.cost > 0) && !/discontinued/i.test(p.status));
  add('S4', 'Stock', 'Everything in stock has a cost', noCost.length, noCost.slice(0, 5).map((p) => p.name).join(', ') + (noCost.length > 5 ? '…' : ''), true, 'costs');
  const hc = await holdingConfig(ctx);
  if (hc.on) {
    const noW = await ctx.tx`select p.name from products p join product_stock ps on ps.product_id = p.id where p.business_id = ${ctx.biz} and ps.stock > 0
                             and coalesce(p.weight_g, 0) = 0 and not (coalesce(p.length_mm, 0) > 0 and coalesce(p.width_mm, 0) > 0 and coalesce(p.height_mm, 0) > 0)`;
    add('S5', 'Stock', 'Products in stock have a weight (holding cost shares by kg)', noW.length, noW.slice(0, 5).map((r) => str(r.name)).join(', '), true, 'shipments');
  }

  // ---- invoices and money
  const sums = await ctx.tx`
    select i.invoice_no, i.grand_total, i.subtotal, i.discount, i.delivery_charge,
           coalesce((select sum(l.line_total) from invoice_lines l where l.invoice_id = i.id), 0) as lines
    from invoices i where i.business_id = ${ctx.biz} and i.voided_at is null and i.invoice_no not like 'RTN-%'
      and abs(i.subtotal - i.discount + i.delivery_charge - i.grand_total) > 1`;
  add('M1', 'Sales', 'Every invoice: products − discount + delivery = total', sums.length, sums.slice(0, 5).map((r) => str(r.invoice_no)).join(', '), false, 'sales');
  const over = await ctx.tx`
    select i.invoice_no, i.grand_total, sum(p.amount) as paid from invoices i join payments p on p.business_id = i.business_id and p.invoice_no = i.invoice_no
    where i.business_id = ${ctx.biz} and i.voided_at is null and i.invoice_no not like 'RTN-%'
    group by i.invoice_no, i.grand_total having sum(p.amount) > i.grand_total + 1`;
  add('M2', 'Sales', 'Nobody paid more than their invoice', over.length, over.slice(0, 5).map((r) => str(r.invoice_no) + ' (' + R(r.paid) + ' of ' + R(r.grand_total) + ')').join('; '), true, 'sales');
  const loose = (await ctx.tx`select count(*)::int as n from payments where business_id = ${ctx.biz} and account_id is null and coalesce(amount, 0) <> 0
                              and lower(btrim(coalesce(method, ''))) not in ('adjusted', 'returned', 'advance', 'undone', 'return / refund', '')`)[0].n;
  const hasAcc = (await ctx.tx`select count(*)::int as n from money_accounts where business_id = ${ctx.biz}`)[0].n;
  add('M3', 'Money', 'Every payment is in a money account', hasAcc ? loose : 0, loose + ' payment(s) in no account', true, 'cash');
  const now = formatDate(ctx.now, 'yyyy-MM');
  const uncosted = (await ctx.tx`select count(*)::int as n from invoice_lines l join invoices i on i.id = l.invoice_id
                                 where l.business_id = ${ctx.biz} and i.voided_at is null and l.qty > 0 and coalesce(l.unit_cost, 0) = 0 and l.pool_id is null
                                 and to_char(public.dhaka_date(i.created_at), 'YYYY-MM') = ${now}`)[0].n;
  add('M4', 'Profit', 'This month’s sold lines all carry a cost', uncosted, uncosted + ' line(s) were sold with no cost written on them; the P&L uses today’s cost book for them - fill in Product cost so it is right', true, 'costs');

  // ---- capital and shares
  const shares = num((await ctx.tx`select coalesce(sum(share_pct), 0) as s from capital_holders where business_id = ${ctx.biz} and kind = 'shareholder' and ended_month is null`)[0].s);
  add('C1', 'Capital', 'Shareholders hold 100% or less', shares > 100.0001 ? 1 : 0, shares + '% given out', false, 'capital');
  const fund = await ctx.tx`select reference, sum(pct) as p from lot_funding where business_id = ${ctx.biz} and voided_at is null group by reference having sum(pct) > 100.0001`;
  add('C2', 'Capital', 'No shipment funded more than 100%', fund.length, fund.map((r) => str(r.reference) + ' ' + num(r.p) + '%').join('; '), false, 'shipments');

  // ---- one net profit
  const p = (await pnlFor(ctx, [now]))[0];
  const { erpFdDash } = await import('./fddash.js');
  const d = await erpFdDash(ctx, { months: 1 });
  const same = !d.kpi.net || d.kpi.net.v === p.net;
  add('P1', 'Profit', 'The dashboard’s net profit is the P&L’s', same ? 0 : 1, 'dashboard ' + (d.kpi.net && d.kpi.net.v) + ', P&L ' + p.net, false, 'profit');

  const counts = { pass: 0, warn: 0, fail: 0 };
  out.forEach((c) => { counts[c.status]++; });
  return { checks: out, counts, at: formatDate(ctx.now, 'd MMM yyyy, h:mm a') };
}

export async function erpAnalytics(ctx) {
  const now = formatDate(ctx.now, 'yyyy-MM');
  // shipment ROI: profit after holding on what the shipment cost
  const sh = await erpShipments(ctx);
  const roi = sh.shipments.filter((s) => !s.opening && s.landed > 0).map((s) => ({
    reference: s.reference, date: s.date, supplier: s.supplier, landed: s.landed, revenue: s.revenue, net: s.net, soldPct: s.soldPct,
    roi: Math.round(s.net / s.landed * 1000) / 10, status: s.status })).sort((a, b) => b.roi - a.roi);
  // dead stock: lots on the shelf 90+ days with nothing taken from them for 60 days
  const dead = (await ctx.tx`
    select p.sku, p.name, l.reference, l.received_at, l.qty_left, coalesce(l.unit_cost, p.cost_price, 0) as cost,
           (select max(d.at) from lot_draws d where d.lot_id = l.id and d.qty > 0) as last
    from stock_lots l join products p on p.id = l.product_id
    where l.business_id = ${ctx.biz} and l.qty_left > 0 and l.received_at < now() - interval '90 days'`)
    .filter((r) => !r.last || new Date(r.last).getTime() < ctx.now.getTime() - 60 * 864e5)
    .map((r) => ({ sku: str(r.sku), name: str(r.name), reference: str(r.reference), days: Math.floor((ctx.now.getTime() - new Date(r.received_at).getTime()) / 864e5),
                   units: num(r.qty_left), value: R(num(r.qty_left) * num(r.cost)), lastSale: r.last ? formatDate(new Date(r.last), 'd MMM yyyy') : 'never' }))
    .sort((a, b) => b.value - a.value);
  // colours: the last 90 days
  const colours = (await ctx.tx`
    select coalesce(nullif(btrim(p.color), ''), 'No colour') as c, sum(l.qty) as units, sum(l.line_total) as revenue
    from invoice_lines l join invoices i on i.id = l.invoice_id left join products p on p.id = l.product_id
    where l.business_id = ${ctx.biz} and i.voided_at is null and i.created_at > now() - interval '90 days' and l.pool_id is null
    group by 1 order by 3 desc limit 20`).map((r) => ({ colour: str(r.c), units: R(r.units), revenue: R(r.revenue) }));
  // 12 months
  const months = [];
  for (let i = 11; i >= 0; i--) months.push(shift(now, -i));
  const growth = (await pnlFor(ctx, months)).map((x) => ({ month: x.month, revenue: x.netSales, gross: x.gross, net: x.net }));
  return { currency: 'BDT', roi, dead, deadValue: dead.reduce((t, x) => t + x.value, 0), colours, growth };
}

export const HANDLERS = { erpSystemCheck, erpAnalytics };
