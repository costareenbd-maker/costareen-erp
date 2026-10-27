// The balance sheet (owner 17 Oct 2026: "by the end of the year the balance sheet must match").
//
//   What the business OWNS:   money in each account, stock on the shelf at cost, money paid to suppliers for goods
//                             not received yet, what customers owe.
//   What it OWES:             suppliers (goods received, not paid), customers' advances, investors' returns due,
//                             expenses not paid yet.
//   Net worth = owns - owes.
//
// The books are opened once ("open the books today"): the net worth that day is written down. From then on the net
// worth must equal: the opening net worth + the profit since + money the owners put in - money they took out. What is
// left over is the DIFFERENCE, shown in red with what usually causes it (money with no account, a cost not written down,
// stock with no cost). Buying stock moves money from an account into stock (or into "paid to suppliers" until the goods
// come): the net worth does not change, so a shipment correctly entered never makes a difference.
//
//   erpBalanceSheet()      read
//   erpBalanceOpen({note})  owner: open the books today (again: a new opening replaces the old one, kept in history)

import { formatDate, num, round2, monthStr, dhakaDayStart } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { erpCashBook } from './cash.js';
import { erpSuppliers } from './suppliers.js';
import { erpDues, creditMap } from './money.js';
import { stockAtCost, pnlFor, expenseUnpaid } from './dashboard.js';
import { investorReturns } from './returns.js';
import { roleAtLeast } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
const soft = async (ctx, fn, dflt) => { try { return await ctx.tx.savepoint(fn); } catch (_) { return dflt; } };
function monthsFrom(a, b) { const out = []; let y = +a.slice(0, 4), m = +a.slice(5, 7); while (true) { const k = y + '-' + String(m).padStart(2, '0'); out.push(k); if (k >= b || out.length > 120) break; m++; if (m > 12) { m = 1; y++; } } return out; }

/** Today's figures: what the business owns and owes. */
async function figures(ctx, frozen) {
  const cb = await soft(ctx, () => erpCashBook(ctx, {}), { accounts: [], loose: [], unassigned: [] });
  const cash = (cb.accounts || []).filter((a) => !a.archived).map((a) => ({ name: a.name, kind: a.kindLabel || a.kind, amount: Math.round(num(a.balance)) }));
  const sup = await soft(ctx, () => erpSuppliers(ctx), { owedTotal: 0, aheadTotal: 0 });
  const stock = await soft(ctx, () => stockAtCost(ctx, frozen), { cost: 0, units: 0, uncosted: 0, costs: {} });
  const dues = await soft(ctx, async () => num((await erpDues(ctx)).total), 0);
  const credit = await soft(ctx, async () => { const m = await creditMap(ctx); let c = 0; for (const k of Object.keys(m)) if (m[k] > 0) c += m[k]; return c; }, 0);
  const owns = [
    ...cash.map((c) => ({ key: 'cash', what: c.name, sub: c.kind, amount: c.amount })),
    { key: 'stock', what: 'Stock on the shelf, at cost', sub: stock.units + ' units' + (stock.uncosted ? ', ' + stock.uncosted + ' products with no cost' : ''), amount: stock.cost },
    { key: 'ahead', what: 'Paid to suppliers, goods not received yet', sub: '', amount: Math.round(num(sup.aheadTotal)) },
    { key: 'dues', what: 'Customers owe', sub: '', amount: Math.round(dues) },
  ];
  const owes = [
    { key: 'suppliers', what: 'Owed to suppliers (goods received, not paid)', sub: '', amount: Math.round(num(sup.owedTotal)) },
    { key: 'advances', what: 'Customers paid ahead (their advances)', sub: '', amount: Math.round(credit) },
  ];
  // owner 18 Oct 2026: this company's part of each joint stock (a minus = owed to the joint stock)
  const joint = await soft(ctx, async () => (await import('./joint.js')).jointPosition(ctx), []);
  for (const j of joint) {
    const sub = 'paid in ' + Math.round(j.paidIn) + ' + profit share ' + Math.round(j.profitShare) + ' - joint goods we sold ' + Math.round(j.sold);
    if (j.amount >= 0) owns.push({ key: 'joint', what: 'Our part of the joint stock (' + j.pool + ')', sub, amount: Math.round(j.amount) });
    else owes.push({ key: 'joint', what: 'Owed to the joint stock (' + j.pool + ') - money from its goods we sold', sub, amount: Math.round(-j.amount) });
  }
  return { owns, owes, cb, stock };
}
const total = (rows) => rows.reduce((t, r) => t + num(r.amount), 0);

export async function erpBalanceSheet(ctx) {
  ctx.memo.__ro = true;
  let opening = null;
  try { opening = JSON.parse(str(await getConfig(ctx, 'balance_opening', '')) || 'null'); } catch (_) { opening = null; }
  const f = await figures(ctx, opening && opening.costs);
  const today = formatDate(ctx.now, 'yyyy-MM-dd'), nowMonth = monthStr(ctx.now);

  // what is owed now that is not in the rows above: investors' returns due, expenses not paid (from the opening on)
  if (opening && opening.date) {
    const months = monthsFrom(opening.month, nowMonth);
    const ir = await soft(ctx, () => investorReturns(ctx), { byMonth: {} });
    let due = 0;
    for (const m of months) due += num(ir.byMonth[m]);
    const retPaid = num((await ctx.tx`select coalesce(sum(amount), 0) s from capital_book where business_id = ${ctx.biz} and type = 'ret'
                                      and coalesce(btrim(voided), '') = '' and coalesce(on_date, recorded_at::date) >= ${opening.date}::date`)[0].s);
    f.owes.push({ key: 'returns', what: 'Investors’ returns due, not paid yet', sub: '', amount: Math.max(0, Math.round(due - num(opening.returnsDueAtOpening) - retPaid)) });
    let unpaid = 0;
    for (const m of months) unpaid += num(await soft(ctx, () => expenseUnpaid(ctx, m), 0));
    f.owes.push({ key: 'expenses', what: 'Expenses not paid yet', sub: '', amount: Math.round(unpaid) });
  }
  const owns = Math.round(total(f.owns)), owes = Math.round(total(f.owes)), net = owns - owes;
  const out = { today, owns: f.owns, owes: f.owes, ownsTotal: owns, owesTotal: owes, net, opened: !!(opening && opening.date), canOpen: ctx.s.role === 'owner' };
  if (!out.opened) return out;

  // what explains the change since the books were opened
  const months = monthsFrom(opening.month, nowMonth);
  const pl = await pnlFor(ctx, months);
  const profit = Math.round(pl.reduce((t, r) => t + num(r && r.net), 0) - num(opening.mtdNet));
  const cap = { invest: 0, withdraw: 0, profit: 0 };
  for (const r of await ctx.tx`select type, coalesce(sum(amount), 0) s from capital_book where business_id = ${ctx.biz} and coalesce(btrim(voided), '') = ''
                               and coalesce(on_date, recorded_at::date) >= ${opening.date}::date group by type`) if (r.type in cap) cap[r.type] = num(r.s);
  const should = Math.round(num(opening.net) + profit + cap.invest - cap.withdraw - cap.profit);
  const diff = net - should;

  // what usually makes a difference
  const why = [];
  const loose = (f.cb.loose || []).filter((p) => p.when && new Date(p.when) >= dhakaDayStart(opening.date));
  if ((f.cb.loose || []).length) why.push({ what: 'Money received with no account', n: (f.cb.loose || []).length, amount: Math.round((f.cb.loose || []).reduce((t, p) => t + num(p.amount), 0)), go: 'cash' });
  if ((f.cb.unassigned || []).length) why.push({ what: 'Courier payouts not given a bank', n: f.cb.unassigned.length, amount: Math.round(f.cb.unassigned.reduce((t, p) => t + num(p.amount), 0)), go: 'cash' });
  const sc = (await ctx.tx`select count(*)::int n, coalesce(sum(amount), 0) a from shipment_costs where business_id = ${ctx.biz} and account_id is null and at >= ${dhakaDayStart(opening.date)}`)[0];
  if (sc.n) why.push({ what: 'Freight or other shipment costs with no account (who paid them?)', n: sc.n, amount: Math.round(num(sc.a)), go: 'shipments' });
  if (f.stock.uncosted) why.push({ what: 'Products in stock with no cost', n: f.stock.uncosted, amount: 0, go: 'costs' });
  void loose;
  return { ...out, opening: { date: opening.date, net: Math.round(num(opening.net)), by: str(opening.by), at: str(opening.at) },
           explain: { opening: Math.round(num(opening.net)), profit, invest: Math.round(cap.invest), withdraw: Math.round(cap.withdraw), profitPaid: Math.round(cap.profit), should },
           difference: diff, why };
}

/** Owner: open the books today - write down today's net worth as the start. */
export async function erpBalanceOpen(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder opens the books.');
  // sales still costed at "whatever the product costs now" get that cost fixed first (plan A1, the same as Maintenance >
  // Fix sale costs): it changes no figure today, it stops a later shipment from re-pricing past sales and so the profit
  try { const { erpFreezeSaleCosts } = await import('./goods.js'); await ctx.tx.savepoint(() => erpFreezeSaleCosts(ctx)); } catch (_) { /* best effort */ }
  ctx.memo = {};
  ctx.memo.__ro = true;
  const f = await figures(ctx);
  const today = formatDate(ctx.now, 'yyyy-MM-dd'), month = monthStr(ctx.now);
  const net = Math.round(total(f.owns) - total(f.owes));
  const mtd = num(((await pnlFor(ctx, [month]))[0] || {}).net);
  const ir = await soft(ctx, () => investorReturns(ctx), { byMonth: {} });
  let old = null; try { old = JSON.parse(str(await getConfig(ctx, 'balance_opening', '')) || 'null'); } catch (_) { old = null; }
  const rec = { date: today, month, net, mtdNet: Math.round(mtd), costs: f.stock.costs || {}, returnsDueAtOpening: Math.round(num(ir.byMonth[month])),
                owns: f.owns, owes: f.owes, by: str(ctx.s.name), at: new Date().toISOString(), note: str(payload && payload.note).slice(0, 200),
                before: old && old.date ? { date: old.date, net: old.net, by: old.by } : null };
  await setConfig(ctx, 'balance_opening', JSON.stringify(rec));
  ctx.memo = {};
  return erpBalanceSheet(ctx);
}

export const HANDLERS = { erpBalanceSheet, erpBalanceOpen };
