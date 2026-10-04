// Currencies (plan A5): the money the business buys in, each with a rate in
// taka, and every rate it ever had by date.
//
//   erpCurrencies()                        the list, with today's rate and the last few rates of each
//   erpCurrencySave({code, name, rate, archived})
//
// Before this the only foreign money was RMB, its rate kept as the setting
// `cost_rate`. RMB still reads that setting until it is saved here, and saving
// RMB keeps the setting in step, so nothing that reads the old place goes wrong.

import { formatDate, num, round2 } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast, powerOn, callAllowed } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
const isCode = (c) => /^[A-Z]{3,5}$/.test(c);
const NAMES = { RMB: 'Chinese yuan', USD: 'US dollar', EUR: 'Euro', INR: 'Indian rupee', AED: 'UAE dirham', GBP: 'Pound sterling', JPY: 'Japanese yen', HKD: 'Hong Kong dollar' };

/** { RMB: 17.5, USD: 121, BDT: 1 } - taka for one unit. */
export async function ratesMap(ctx) {
  if (ctx.memo.fxRates) return ctx.memo.fxRates;
  const map = { BDT: 1 };
  for (const r of await ctx.tx`select code, rate from currencies where business_id = ${ctx.biz}`) map[str(r.code).toUpperCase()] = num(r.rate);
  if (!(map.RMB > 0)) { const old = num(await getConfig(ctx, 'cost_rate', '')); if (old > 0) map.RMB = old; }
  ctx.memo.fxRates = map;
  return map;
}

/**
 * What one unit of a price-book row lands at, in taka: its price in its own
 * currency at today's rate, plus handling. null when it cannot be known.
 */
export function landedCost(row, rates, defHandling) {
  const h = row.handling === null || row.handling === undefined ? num(defHandling) : num(row.handling);
  let amount = num(row.buy_amount), cur = str(row.buy_cur).toUpperCase();
  if (!(amount > 0)) {                                   // rows written before currencies existed
    if (num(row.buy_rmb) > 0) { amount = num(row.buy_rmb); cur = 'RMB'; }
    else if (num(row.buy_bdt) > 0) { amount = num(row.buy_bdt); cur = 'BDT'; }
  }
  if (!(amount > 0)) return null;
  const rate = !cur || cur === 'BDT' ? 1 : num(rates[cur]);
  if (!(rate > 0)) return null;
  return round2(amount * rate + h);
}

export async function erpCurrencies(ctx) {
  const rows = await ctx.tx`select code, name, rate, archived, updated_at from currencies where business_id = ${ctx.biz} order by archived, code`;
  const list = rows.map((r) => ({ code: str(r.code), name: str(r.name), rate: num(r.rate), archived: !!r.archived, updated: formatDate(new Date(r.updated_at), 'd MMM yyyy'), saved: true }));
  if (!list.some((c) => c.code === 'RMB')) {
    const old = num(await getConfig(ctx, 'cost_rate', ''));
    list.unshift({ code: 'RMB', name: NAMES.RMB, rate: old, archived: false, updated: '', saved: false });
  }
  if (!list.some((c) => c.code === 'USD')) list.push({ code: 'USD', name: NAMES.USD, rate: 0, archived: false, updated: '', saved: false });
  const hist = await ctx.tx`select code, on_date, rate, by from currency_rates where business_id = ${ctx.biz} order by on_date desc, id desc limit 200`;
  const by = {};
  for (const h of hist) { const k = str(h.code); (by[k] = by[k] || []).length < 6 && by[k].push({ date: formatDate(new Date(h.on_date), 'd MMM yyyy'), rate: num(h.rate), by: str(h.by) }); }
  list.forEach((c) => { c.history = by[c.code] || []; });
  const out = { currencies: list, canEdit: callAllowed(ctx.s, 'erpCurrencySave'), names: NAMES };
  // the receive screen offers these to say what paid for a shipment (ids and names only, to those who may see money)
  if (roleAtLeast(ctx.s.role, 'shareholder')) {
    try {
      out.accounts = (await ctx.tx.savepoint(() => ctx.tx`select id, name from money_accounts where business_id = ${ctx.biz} and not archived and kind <> 'courier' order by sort_order, created_at`))
        .map((a) => ({ id: a.id, name: str(a.name) }));
    } catch (_) { out.accounts = []; }
  }
  return out;
}

/** Set a rate (kept in the history under today's date), add a currency, or retire one. */
export async function saveRate(ctx, code, rate, name, archived) {
  code = str(code).toUpperCase();
  if (!isCode(code) || code === 'BDT') throw new Error('A currency is three letters, like USD or RMB.');
  rate = num(rate);
  if (!(rate > 0)) throw new Error('What is 1 ' + code + ' in taka? Type a rate above 0.');
  if (rate > 100000) throw new Error('That rate looks wrong (' + rate + ' taka for 1 ' + code + ').');
  const cur = (await ctx.tx`select rate from currencies where business_id = ${ctx.biz} and code = ${code}`)[0];
  await ctx.tx`insert into currencies (business_id, code, name, rate, archived, updated_at)
               values (${ctx.biz}, ${code}, ${str(name) || NAMES[code] || code}, ${rate}, ${!!archived}, now())
               on conflict (business_id, code) do update set rate = excluded.rate, archived = excluded.archived, updated_at = now(),
                 name = case when ${str(name)} <> '' then excluded.name else currencies.name end`;
  if (!cur || num(cur.rate) !== rate) {
    await ctx.tx`insert into currency_rates (business_id, code, rate, by) values (${ctx.biz}, ${code}, ${rate}, ${str(ctx.s && ctx.s.name) || 'User'})`;
  }
  if (code === 'RMB') await setConfig(ctx, 'cost_rate', rate);       // the old place, kept in step
  delete ctx.memo.fxRates; delete ctx.memo.bookCost; delete ctx.memo.dashProducts;
}

export async function erpCurrencySave(ctx, payload) {
  payload = payload || {};
  await saveRate(ctx, payload.code, payload.rate, payload.name, payload.archived);
  return erpCurrencies(ctx);
}

export const HANDLERS = { erpCurrencies, erpCurrencySave };
