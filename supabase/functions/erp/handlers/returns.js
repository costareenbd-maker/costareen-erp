// What investors are due, month by month (plan A6).
//
// A return belongs to the month it was earned in, on the money that was in the
// business during THAT month - not on what is in today. A percentage is worked
// out day by day, so money put in on the 20th earns for the days from the 20th.
// A fixed monthly amount is the amount, for every month the person is in.
// The month still running counts up to today; it falls due when the month ends.

import { formatDate, num, monthStr } from '../lib/time.js';
import { holdingFor, lotMonths } from './holding.js';

const str = (v) => String(v == null ? '' : v).trim();
function nextMonth(m) {
  let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + 1;
  if (mo > 12) { mo = 1; y++; }
  return y + '-' + (mo < 10 ? '0' + mo : '' + mo);
}
/** fix-3 H7/H13: a holder's terms in one month - the latest change made from that month or before (history), else the columns. */
export function termsAt(h, m) {
  const base = { pct: num(h.share_pct ?? h.pct), kind: str(h.return_kind ?? h.returnKind), value: num(h.return_value ?? h.returnValue) };
  const hist = Array.isArray(h.history) ? h.history.slice().sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)) : [];
  if (!hist.length) return base;
  let t = hist[0];
  for (const e of hist) if (e.from <= m) t = e;
  return { pct: e2n(t.pct, base.pct), kind: base.kind, value: e2n(t.value, base.value) };
}
const e2n = (v, d) => (v === undefined || v === null || v === '' ? d : num(v));
const daysIn = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

/** { byHolder: { H1: { '2026-09': 5000 } }, byMonth: { '2026-09': 6000 } } - the running month up to today. */
export async function investorReturns(ctx) {
  if (ctx.memo.invReturns) return ctx.memo.invReturns;
  const out = { byHolder: {}, byMonth: {}, byFunding: {} };
  const hs = await ctx.tx`select holder_no, return_kind, return_value, since_month, ended_month, history from capital_holders
                          where business_id = ${ctx.biz} and kind = 'investor'`;
  if (!hs.length) return (ctx.memo.invReturns = out);
  const moves = {};
  for (const b of await ctx.tx`select holder_no, type, amount, on_date, recorded_at from capital_book
                               where business_id = ${ctx.biz} and type in ('invest', 'withdraw') and coalesce(btrim(voided), '') = ''`) {
    const d = b.on_date || b.recorded_at;
    if (!d) continue;
    (moves[str(b.holder_no)] = moves[str(b.holder_no)] || []).push({ day: formatDate(new Date(d), 'yyyy-MM-dd'), amt: str(b.type) === 'invest' ? num(b.amount) : -num(b.amount) });
  }
  const nowMonth = monthStr(ctx.now), today = Number(formatDate(ctx.now, 'd'));
  for (const h of hs) {
    const id = str(h.holder_no), kind = str(h.return_kind), since = str(h.since_month), ended = str(h.ended_month);
    if (!since || (kind !== 'monthly' && kind !== 'percent')) continue;
    const ev = (moves[id] || []).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const last = ended && ended < nowMonth ? ended : nowMonth;
    const mine = out.byHolder[id] = {};
    let at = 0, bal = 0;
    for (let m = since, guard = 0; m <= last && guard++ < 240; m = nextMonth(m)) {
      const D = daysIn(m), upto = m === nowMonth ? Math.min(today, D) : D;
      const val = termsAt(h, m).value;   // fix-3: that month's terms
      let due = 0;
      if (kind === 'monthly') due = val * upto / D;
      else {
        for (let d = 1; d <= upto; d++) {
          const day = m + '-' + (d < 10 ? '0' + d : d);
          while (at < ev.length && ev[at].day <= day) bal += ev[at++].amt;
          if (bal > 0) due += bal * val / 100 / D;
        }
      }
      due = Math.round(due);
      mine[m] = due;
      out.byMonth[m] = (out.byMonth[m] || 0) + due;
    }
  }
  // 109: an investor in shipments earns return_value % of the profit on their share (pct) of each shipment they fund,
  // in the month the units sold (returns taken off); price = the sold line's price per unit, cost = the lot's landed cost
  const lotHs = hs.filter((h) => str(h.return_kind) === 'lot' && num(h.return_value) > 0);
  if (lotHs.length) {
    const terms = {};
    lotHs.forEach((h) => { terms[str(h.holder_no)] = { val: num(h.return_value), since: str(h.since_month), ended: str(h.ended_month) }; });
    const rows = await ctx.tx`
      select f.id as fid, to_char(public.dhaka_date(d.at), 'YYYY-MM') as m,
             sum(d.qty * (coalesce(case when mv.kind::text = 'SALE'
                   then (select il.line_total / nullif(il.qty, 0) from invoice_lines il
                         where il.invoice_id = mv.invoice_id and il.product_id = d.product_id and il.qty > 0 order by il.line_no limit 1)
                   else (select il.line_total / nullif(il.qty, 0) from invoice_lines il join invoices i on i.id = il.invoice_id
                         where i.business_id = mv.business_id and i.invoice_no = btrim(substr(mv.reference, 9)) and il.product_id = d.product_id and il.qty > 0
                         order by il.line_no limit 1) end, 0) - d.unit_cost)) as profit
      from lot_funding f
      join stock_lots l on l.business_id = f.business_id and l.reference = f.reference and l.source = 'receive'
      join lot_draws d on (d.lot_id = l.id or d.of_draw in (select o.id from lot_draws o where o.lot_id = l.id)) and d.unit_cost is not null   -- a return into a lot of its own (143) still counts
      join stock_movements mv on mv.id = d.movement_id and mv.kind::text in ('SALE', 'RETURN')
      where f.business_id = ${ctx.biz} and f.voided_at is null and d.at >= f.at and (d.of_draw is null or (select o.at from lot_draws o where o.id = d.of_draw) >= f.at)   -- fix-3 H14: only what sold after the funding
      group by 1, 2`;
    // per funding and month: the shipment's sales profit less what holding its stock cost that month (F3)
    const funds = await ctx.tx`select id, holder_no, reference, pct, amount, to_char(public.dhaka_date(at), 'YYYY-MM') as from_m from lot_funding where business_id = ${ctx.biz} and voided_at is null`;
    const prof = {};
    for (const r of rows) (prof[r.fid] = prof[r.fid] || {})[str(r.m)] = num(r.profit);
    // a late bill's part for units already sold lowers that month's profit on the shipment (111)
    const late = {};
    for (const r of await ctx.tx`select reference, month, sum(sold_part) as s from late_costs where business_id = ${ctx.biz} group by 1, 2`) (late[str(r.reference)] = late[str(r.reference)] || {})[str(r.month)] = num(r.s);
    for (const f of funds) { const lt = late[str(f.reference)] || {}; for (const m of Object.keys(lt)) { if (m < str(f.from_m)) continue; const p = prof[f.id] = prof[f.id] || {}; p[m] = num(p[m]) - lt[m]; } }
    const hold = funds.length ? await holdingFor(ctx, await lotMonths(ctx)) : { byRef: {} };
    for (const f of funds) {
      const id = str(f.holder_no), t = terms[id];
      if (!t) continue;
      const p = prof[f.id] || {}, h = hold.byRef[str(f.reference)] || {};
      // Q1 (owner's rule, fix-3): an investor's loss on a shipment stops at the money they put into it
      const cap = num(f.amount) > 0 ? num(f.amount) : Infinity;
      let run = 0;
      for (const m of Array.from(new Set(Object.keys(p).concat(Object.keys(h)))).sort()) {
        if ((t.ended && m > t.ended) || m > nowMonth || m < str(f.from_m)) continue;
        let due = Math.round((num(p[m]) - num(h[m])) * num(f.pct) / 100 * t.val / 100);
        if (run + due < -cap) due = Math.round(-cap - run);
        run += due;
        if (!due) continue;
        const fm = out.byFunding[f.id] = out.byFunding[f.id] || {};
        fm[m] = (fm[m] || 0) + due;
        const mine = out.byHolder[id] = out.byHolder[id] || {};
        mine[m] = (mine[m] || 0) + due;
        out.byMonth[m] = (out.byMonth[m] || 0) + due;
      }
    }
  }
  // fix-3 H7/H14: a closed month keeps what each investor earned in it when it was closed
  for (const c of await ctx.tx`select month, returns from capital_closed where business_id = ${ctx.biz} and returns is not null`) {
    const m = str(c.month), snap = c.returns || {};
    let tot = 0;
    for (const id of Object.keys(out.byHolder)) if (out.byHolder[id][m] !== undefined && snap[id] === undefined) delete out.byHolder[id][m];
    for (const id of Object.keys(snap)) { (out.byHolder[id] = out.byHolder[id] || {})[m] = num(snap[id]); tot += num(snap[id]); }
    out.byMonth[m] = tot;
  }
  return (ctx.memo.invReturns = out);
}

/** What one month owes investors in all (0 when there are none, or the tables are not there). */
export async function returnsFor(ctx, month) {
  try { return num((await ctx.tx.savepoint(() => investorReturns(ctx))).byMonth[month]); } catch (_) { return 0; }
}

/** An expense row that is an investor's return being PAID: the cost was already counted when it fell due. */
export const isReturnPaid = (category, description) => str(category) === 'Investor returns' && /^Return paid to /.test(str(description));
