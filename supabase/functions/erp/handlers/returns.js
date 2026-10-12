// What investors are due, month by month (plan A6).
//
// A return belongs to the month it was earned in, on the money that was in the
// business during THAT month - not on what is in today. A percentage is worked
// out day by day, so money put in on the 20th earns for the days from the 20th.
// A fixed monthly amount is the amount, for every month the person is in.
// The month still running counts up to today; it falls due when the month ends.

import { formatDate, num, monthStr } from '../lib/time.js';

const str = (v) => String(v == null ? '' : v).trim();
function nextMonth(m) {
  let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + 1;
  if (mo > 12) { mo = 1; y++; }
  return y + '-' + (mo < 10 ? '0' + mo : '' + mo);
}
const daysIn = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

/** { byHolder: { H1: { '2026-09': 5000 } }, byMonth: { '2026-09': 6000 } } - the running month up to today. */
export async function investorReturns(ctx) {
  if (ctx.memo.invReturns) return ctx.memo.invReturns;
  const out = { byHolder: {}, byMonth: {} };
  const hs = await ctx.tx`select holder_no, return_kind, return_value, since_month, ended_month from capital_holders
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
    const id = str(h.holder_no), kind = str(h.return_kind), val = num(h.return_value), since = str(h.since_month), ended = str(h.ended_month);
    if (!since || !(val > 0) || (kind !== 'monthly' && kind !== 'percent')) continue;
    const ev = (moves[id] || []).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const last = ended && ended < nowMonth ? ended : nowMonth;
    const mine = out.byHolder[id] = {};
    let at = 0, bal = 0;
    for (let m = since, guard = 0; m <= last && guard++ < 240; m = nextMonth(m)) {
      const D = daysIn(m), upto = m === nowMonth ? Math.min(today, D) : D;
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
  return (ctx.memo.invReturns = out);
}

/** What one month owes investors in all (0 when there are none, or the tables are not there). */
export async function returnsFor(ctx, month) {
  try { return num((await ctx.tx.savepoint(() => investorReturns(ctx))).byMonth[month]); } catch (_) { return 0; }
}

/** An expense row that is an investor's return being PAID: the cost was already counted when it fell due. */
export const isReturnPaid = (category, description) => str(category) === 'Investor returns' && /^Return paid to /.test(str(description));
