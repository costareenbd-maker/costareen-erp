// Capital: who owns the business, and whose money is in it.
// Ported from ERP.js build b261002-1321, lines 9921-10237.
//
//   SHAREHOLDER  owns an agreed share (typed in, not worked out from money).
//                All shares together never pass 100%. Each month's net profit
//                is theirs in that proportion, paid out or not.
//   INVESTOR     put money in against a fixed return. No ownership. Their
//                return is a cost of the month it was earned in, worked out on
//                the money they had in during that month (returns.js); paying
//                it only settles what is owed (plan A6).
//
// Nothing is deleted: a wrong line is struck out. A closed month keeps its
// profit and the shares as they stood. A person marked private is listed for
// the owner only; everyone else still sees the totals and is told somebody is
// not listed.

import { formatDate, num, dhakaDayStart, monthStr } from '../lib/time.js';
import { phone11 } from '../lib/phone.js';
import { lock, who } from './money.js';
import { monthNet, pnlFor } from './dashboard.js';
import { expenseAccount, cashRules } from './cash.js';
import { investorReturns } from './returns.js';
import { isPool, notInPool } from '../lib/pool.js';
import { assertOpen, monthLabel } from '../lib/period.js';

const ERP_CAP_TYPES = { invest: 'Money put in', withdraw: 'Capital taken back',
                        profit: 'Profit paid out', ret: 'Return paid' };

const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
function monthShift(m, by) {
  let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + by;
  while (mo < 1) { mo += 12; y--; }
  while (mo > 12) { mo -= 12; y++; }
  return y + '-' + (mo < 10 ? '0' + mo : '' + mo);
}
const r2 = (n) => Math.round(n * 100) / 100;

async function holders(ctx) {
  const rows = await ctx.tx`select * from capital_holders where business_id = ${ctx.biz} order by seq`;
  return rows.map((r) => ({
    id: String(r.holder_no), kind: r.kind === 'investor' ? 'investor' : 'shareholder',
    name: String(r.name || '').trim(), phone: String(r.phone || '').trim(), pct: num(r.share_pct),
    returnKind: String(r.return_kind || ''), returnValue: num(r.return_value),
    since: String(r.since_month || '').trim(), private: !!r.private,
    ended: String(r.ended_month || '').trim(), note: String(r.note || ''), row: r.id,
  }));
}

async function book(ctx) {
  const rows = await ctx.tx`select * from capital_book where business_id = ${ctx.biz} order by seq`;
  return rows.map((r) => {
    const d = r.on_date || r.recorded_at;
    return { id: String(r.entry_no), ts: d ? new Date(d).getTime() : 0, when: d ? formatDate(d, 'd MMM yyyy') : '',
             holder: String(r.holder_no), type: String(r.type), amount: num(r.amount), method: String(r.method || ''),
             note: String(r.note || ''), by: String(r.by || ''), voided: String(r.voided || ''),
             expenseId: String(r.expense_no || ''), month: String(r.month || ''), row: r.id };
  });
}

async function closedMonths(ctx) {
  const map = {};
  for (const r of await ctx.tx`select * from capital_closed where business_id = ${ctx.biz}`) {
    map[r.month] = { month: r.month, net: num(r.net_profit), shares: r.shares || {} };
  }
  return map;
}

/** Was this person part of the business in this month? */
const isIn = (h, month) => (!h.since || month >= h.since) && (!h.ended || month <= h.ended);

/** What a month really made: the one net profit every screen shows (plan A2, dashboard.js pnlFor). */
async function capNet(ctx, month) {
  return (await monthNet(ctx, month)).net;
}

/** What an investor is due for one month, from their terms and the money they have in. */
function returnDue(h, capital) {
  if (h.returnKind === 'monthly') return Math.round(h.returnValue);
  if (h.returnKind === 'percent') return Math.round(capital * h.returnValue / 100);
  return 0;
}

/** The whole picture, for the Capital screen. */
export async function erpCapital(ctx) {
  const owner = ctx.s.role === 'owner';
  const nowMonth = monthStr(ctx.now);
  const hs = await holders(ctx), bk = await book(ctx), closed = await closedMonths(ctx);
  const names = {};
  hs.forEach((h) => { names[h.id] = h.name; });

  // the months that matter: from the first shareholder's first month to now, two years at most
  let first = nowMonth;
  hs.forEach((h) => { if (h.kind === 'shareholder' && h.since && h.since < first) first = h.since; });
  const months = [];
  for (let g = 0, m = nowMonth; g < 24 && m >= first; g++, m = monthShift(m, -1)) months.unshift(m);

  // the open months, worked out together in one pass over the books
  const live = {};
  let liveErr = '';
  const open = months.filter((m) => !closed[m]);
  if (open.length) {
    try { (await ctx.tx.savepoint(() => pnlFor(ctx, open))).forEach((x) => { live[x.month] = x.net; }); }
    catch (e) { liveErr = String((e && e.message) || e); }
  }
  const monthRows = [];
  for (const mo of months) {
    const c = closed[mo];
    const net = c ? c.net : Math.round(live[mo] || 0), err = c ? '' : liveErr;
    monthRows.push({ month: mo, net, closed: !!c, shares: c ? c.shares : null, current: mo === nowMonth, error: err });
  }

  const ret = await investorReturns(ctx);
  const sums = {};
  hs.forEach((h) => { sums[h.id] = { capital: 0, earned: 0, profitPaid: 0, returnPaid: 0, returnDue: 0 }; });
  bk.forEach((b) => {
    const s = sums[b.holder];
    if (!s || b.voided) return;
    if (b.type === 'invest') s.capital += b.amount;
    else if (b.type === 'withdraw') s.capital -= b.amount;
    else if (b.type === 'profit') s.profitPaid += b.amount;
    else if (b.type === 'ret') s.returnPaid += b.amount;
  });
  hs.forEach((h) => {
    const s = sums[h.id];
    monthRows.forEach((mr) => {
      if (h.kind === 'shareholder') {
        const pct = mr.closed ? num(mr.shares[h.id]) : (isIn(h, mr.month) ? h.pct : 0);
        s.earned += mr.net * pct / 100;
      }
    });
    if (h.kind === 'investor') {
      // each month on that month's money; due once the month is over, the running month still building
      const mine = ret.byHolder[h.id] || {};
      for (const mo2 of Object.keys(mine)) { if (mo2 < nowMonth) s.returnDue += mine[mo2]; else s.building = (s.building || 0) + mine[mo2]; }
    }
  });

  let pctOut = 0;
  hs.filter((h) => !h.ended || h.ended >= nowMonth).forEach((h) => { if (h.kind === 'shareholder') pctOut += h.pct; });
  const totals = { allCapital: 0, ownersCapital: 0, outsideCapital: 0, earned: 0, profitPaid: 0, returnDue: 0,
                   returnPaid: 0, returnBuilding: 0, pctGiven: r2(pctOut), pctFree: r2(100 - pctOut) };
  const list = [];
  let hidden = 0;
  hs.forEach((h) => {
    const s = sums[h.id];
    if (h.kind === 'shareholder') { totals.ownersCapital += s.capital; totals.earned += s.earned; totals.profitPaid += s.profitPaid; }
    else { totals.outsideCapital += s.capital; totals.returnDue += s.returnDue; totals.returnPaid += s.returnPaid; totals.returnBuilding += s.building || 0; }
    if (h.private && !owner) { hidden++; return; }                 // counted above, not listed
    list.push({ id: h.id, kind: h.kind, name: h.name, phone: h.phone, pct: h.pct, returnKind: h.returnKind,
                returnValue: h.returnValue, since: h.since, ended: h.ended, private: h.private, note: h.note,
                capital: Math.round(s.capital), earned: Math.round(s.earned), profitPaid: Math.round(s.profitPaid),
                profitLeft: Math.round(s.earned - s.profitPaid), returnDue: Math.round(s.returnDue),
                returnPaid: Math.round(s.returnPaid), returnOwed: Math.round(s.returnDue - s.returnPaid),
                returnBuilding: Math.round(s.building || 0),
                monthlyReturn: h.kind === 'investor' && (!h.ended || h.ended >= nowMonth) ? returnDue(h, Math.max(0, s.capital)) : 0 });
  });
  totals.allCapital = totals.ownersCapital + totals.outsideCapital;
  for (const k of Object.keys(totals)) if (k.indexOf('pct') !== 0) totals[k] = Math.round(totals[k]);
  const privateIds = {};
  hs.forEach((h) => { if (h.private && !owner) privateIds[h.id] = true; });
  const entries = bk.filter((b) => !privateIds[b.holder]).sort((a, b) => b.ts - a.ts).slice(0, 300).map((b) => ({
    id: b.id, when: b.when, holder: b.holder, name: names[b.holder] || '—', type: b.type,
    label: ERP_CAP_TYPES[b.type] || b.type, amount: b.amount, method: b.method, note: b.note, by: b.by, voided: b.voided,
  }));
  let accs = [];
  try { accs = (await ctx.tx.savepoint(() => ctx.tx`select id, name from money_accounts where business_id = ${ctx.biz} and not archived and kind <> 'courier' order by sort_order, created_at`)).map((a) => ({ id: a.id, name: String(a.name) })); } catch (_) { accs = []; }
  const lockM = Object.keys(closed).sort().pop() || '';
  return { isPool: await isPool(ctx), lockedThrough: lockM, canEdit: owner, currency: 'BDT', holders: list, hidden, totals, entries, thisMonth: nowMonth, accounts: accs, accountDefault: (await cashRules(ctx)).expense || '',
           months: monthRows.map((mr) => ({ month: mr.month, net: mr.net, closed: mr.closed, locked: !!lockM && mr.month <= lockM, canReopen: mr.month === lockM, current: mr.current, error: mr.error })).reverse() };
}

/** Add a person, or change what is written about one. All shares together may never pass 100%. */
export async function erpCapitalHolderSave(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can change who holds what.');
  await notInPool(ctx, 'who put in what is');
  payload = payload || {};
  const kind = String(payload.kind) === 'investor' ? 'investor' : 'shareholder';
  const name = String(payload.name || '').trim().slice(0, 80);
  if (!name) throw new Error('Whose is it? Type the name.');
  const pct = kind === 'shareholder' ? r2(num(payload.pct)) : 0;
  if (kind === 'shareholder' && !(pct > 0 && pct <= 100)) throw new Error('The share is a percentage above 0 and up to 100.');
  const rk = kind === 'investor'
    ? (String(payload.returnKind) === 'percent' ? 'percent' : String(payload.returnKind) === 'none' ? 'none' : 'monthly') : '';
  const rv = kind === 'investor' && rk !== 'none' ? num(payload.returnValue) : 0;
  if (kind === 'investor' && rk !== 'none' && !(rv > 0)) {
    throw new Error(rk === 'percent' ? 'What percentage of their money each month?' : 'How much are they paid each month?');
  }
  if (rk === 'percent' && rv > 100) throw new Error('A monthly return above 100% cannot be right.');
  const nowMonth = monthStr(ctx.now);
  const since = isMonth(payload.since) ? payload.since : nowMonth;
  const phone = String(payload.phone || '').trim() ? phone11(payload.phone) : '';

  await lock(ctx, 'capital');
  const id = String(payload.id || '').trim();
  let old = null, used = 0;
  for (const h of await holders(ctx)) {
    if (h.id === id) { old = h; continue; }
    if (h.kind === 'shareholder' && (!h.ended || h.ended >= nowMonth)) used += h.pct;
    if (!h.ended && h.kind === kind && h.name.toLowerCase() === name.toLowerCase()) throw new Error(name + ' is already on the list.');
  }
  if (id && !old) throw new Error('That person is no longer on the list.');
  if (kind === 'shareholder' && used + pct > 100.0001) {
    throw new Error('That would make ' + r2(used + pct) + '% in all. The others already hold ' + r2(used) +
                    '%, so at most ' + r2(100 - used) + '% is free.');
  }
  const note = String(payload.note || '').trim().slice(0, 300);
  let newId = '';
  if (old) {
    await ctx.tx`update capital_holders set kind = ${kind}, name = ${name}, phone = ${phone},
                   share_pct = ${kind === 'shareholder' ? pct : null}, return_kind = ${rk}, return_value = ${rv || null},
                   private = ${!!payload.private}, note = ${note}, set_by = ${who(ctx)}, set_at = now()
                 where id = ${old.row}`;
  } else {
    newId = 'H' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    await ctx.tx`insert into capital_holders (business_id, holder_no, kind, name, phone, share_pct, return_kind,
                   return_value, since_month, private, ended_month, note, set_by)
                 values (${ctx.biz}, ${newId}, ${kind}, ${name}, ${phone}, ${kind === 'shareholder' ? pct : null}, ${rk},
                   ${rv || null}, ${since}, ${!!payload.private}, null, ${note}, ${who(ctx)})`;
  }
  // the money they put in can be typed with the person, and goes into the book as their first line
  if (newId && num(payload.invested) > 0) {
    return erpCapitalEntryAdd(ctx, { holder: newId, type: 'invest', amount: num(payload.invested),
                                     date: payload.investedOn || '', method: payload.method || '', note: 'Opening amount' });
  }
  return erpCapital(ctx);
}

/** A person leaves: their share is free again from this month, and their history stays. */
export async function erpCapitalHolderEnd(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can change who holds what.');
  const id = String((payload && payload.id) || '');
  const hit = (await holders(ctx)).find((h) => h.id === id);
  if (!hit) throw new Error('That person is no longer on the list.');
  const nowMonth = monthStr(ctx.now);
  const undo = !!(payload && payload.undo);
  await ctx.tx`update capital_holders set ended_month = ${undo ? null : monthShift(nowMonth, -1)} where id = ${hit.row}`;
  if (undo) {
    // coming back must not push the shares past the whole
    let sum = 0;
    for (const h of await holders(ctx)) if (h.kind === 'shareholder' && (!h.ended || h.ended >= nowMonth)) sum += h.pct;
    if (sum > 100.0001) throw new Error('Bringing them back would make ' + r2(sum) + '% in all. Lower a share first.');
  }
  return erpCapital(ctx);
}

/** A line in the book: money put in, capital taken back, profit handed over, or an investor's return paid. */
export async function erpCapitalEntryAdd(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can write in the capital book.');
  await notInPool(ctx, 'capital is');
  payload = payload || {};
  const type = String(payload.type || '');
  if (!ERP_CAP_TYPES[type]) throw new Error('What kind of entry is it?');
  const amount = r2(num(payload.amount));
  if (!(amount > 0)) throw new Error('How much?');
  const h = (await holders(ctx)).find((x) => x.id === String(payload.holder || ''));
  if (!h) throw new Error('Whose money is it? Choose the person.');
  if (type === 'profit' && h.kind !== 'shareholder') throw new Error('Profit is paid to a shareholder. An investor is paid a return.');
  if (type === 'ret' && h.kind !== 'investor') throw new Error('A return is paid to an investor. A shareholder is paid profit.');
  const now = new Date();
  let on = now;
  const typed = String(payload.date || '').trim();
  if (typed) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(typed)) throw new Error('The date should look like 2026-10-05.');
    on = new Date(dhakaDayStart(typed).getTime() + 12 * 3600 * 1000);      // noon that day, in Dhaka
    if (on.getTime() > now.getTime() + 86400000) throw new Error('That date has not come yet.');
  }
  await assertOpen(ctx, on, 'a capital line cannot be dated there');
  await lock(ctx, 'capital');
  if (type === 'withdraw') {
    let has = 0;
    for (const b of await book(ctx)) {
      if (b.holder === h.id && !b.voided) has += b.type === 'invest' ? b.amount : b.type === 'withdraw' ? -b.amount : 0;
    }
    if (amount > has + 0.5) throw new Error(h.name + ' has ' + Math.round(has) + ' in the business. More than that cannot be taken back.');
  }
  const month = monthStr(on);
  // plan A3: the account the money went into or came out of
  const account = await expenseAccount(ctx, payload.account);
  // plan A6: a return paid is no longer an expense of the day - the month it fell due in already carries it
  const expenseId = '';
  await ctx.tx`insert into capital_book (business_id, entry_no, recorded_at, on_date, holder_no, type, amount, method,
                                         note, by, voided, expense_no, month, account_id)
               values (${ctx.biz}, ${'C' + formatDate(now, 'yyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100)},
                       ${now}, ${on}, ${h.id}, ${type}, ${amount}, ${String(payload.method || '').trim().slice(0, 40)},
                       ${String(payload.note || '').trim().slice(0, 300)}, ${who(ctx)}, null, ${expenseId || null}, ${month}, ${account})`;
  return erpCapital(ctx);
}

/** Strike a line out, saying why. If it was an investor's return, its expense is struck out with it. */
export async function erpCapitalEntryVoid(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can strike a line out.');
  const id = String((payload && payload.id) || ''), why = String((payload && payload.reason) || '').trim();
  if (!why) throw new Error('Say why it is being struck out, so the book can be read later.');
  const hit = (await book(ctx)).find((b) => b.id === id);
  if (!hit) throw new Error('That line was not found.');
  if (hit.voided) throw new Error('That line is already struck out.');
  if (hit.ts) await assertOpen(ctx, new Date(hit.ts), 'its capital lines cannot be struck out');
  const mark = 'struck out ' + formatDate(new Date(), 'd MMM yy') + ' by ' + who(ctx) + ': ' + why;
  await ctx.tx`update capital_book set voided = ${mark} where id = ${hit.row}`;
  if (hit.expenseId) {
    await ctx.tx`update expenses set voided = ${mark} where business_id = ${ctx.biz} and expense_no = ${hit.expenseId}`;
  }
  return erpCapital(ctx);
}

/** Close a month that is over: its profit and the shares as they stand are kept as they are. */
export async function erpCapitalClose(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can close a month.');
  if (await isPool(ctx)) throw new Error('This is a joint pool: its months are closed under Partnership, where the settlement is.');
  const month = String((payload && payload.month) || '');
  if (!isMonth(month)) throw new Error('Which month?');
  if (month >= monthStr(ctx.now)) throw new Error('A month can be closed once it is over.');
  await lock(ctx, 'capital');
  if ((await closedMonths(ctx))[month]) throw new Error('That month is already closed.');
  const shares = {};
  let given = 0;
  for (const h of await holders(ctx)) if (h.kind === 'shareholder' && isIn(h, month)) { shares[h.id] = h.pct; given += h.pct; }
  // every taka of profit belongs to somebody: a month cannot be closed with part of it owned by no one
  if (Math.abs(given - 100) > 0.01) {
    throw new Error('The shares for ' + monthLabel(month) + ' add up to ' + r2(given) + '%, not 100%. ' +
                    'All of the profit belongs to the owners: bring the shares to 100% first, then close.');
  }
  await ctx.tx`insert into capital_closed (business_id, month, net_profit, shares, by)
               values (${ctx.biz}, ${month}, ${Math.round(await capNet(ctx, month))}, ${ctx.tx.json(shares)}, ${who(ctx)})`;
  delete ctx.memo.lockedThrough;
  return erpCapital(ctx);
}

/** Open the latest closed month again, saying why. Its profit follows the books again until it is closed anew. */
export async function erpCapitalReopen(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can reopen a month.');
  const month = String((payload && payload.month) || ''), why = String((payload && payload.reason) || '').trim();
  if (!isMonth(month)) throw new Error('Which month?');
  if (!why) throw new Error('Say why the month is being reopened, so the books can be read later.');
  await lock(ctx, 'capital');
  const last = Object.keys(await closedMonths(ctx)).sort().pop() || '';
  if (!last) throw new Error('No month is closed.');
  if (month !== last) throw new Error('Only the latest closed month (' + monthLabel(last) + ') can be reopened. Reopen that one first.');
  await ctx.tx`delete from capital_closed where business_id = ${ctx.biz} and month = ${month}`;
  delete ctx.memo.lockedThrough;
  return erpCapital(ctx);
}

export const HANDLERS = {
  erpCapital, erpCapitalHolderSave, erpCapitalHolderEnd, erpCapitalEntryAdd, erpCapitalEntryVoid, erpCapitalClose, erpCapitalReopen,
};
