// The daily cash-up and asking prices (FilaDash merge; supabase/114_cash_up.sql).
//
//   erpCashUp       count an account (by notes or a total): book vs counted; a difference is booked at once as a correction
//   erpCashUps      the cash-up history (with the differences)
//   erpAskingPrices a shipment's suggested selling prices: landed cost x (1 + markup) by brand, rounded up to 10
//   erpAskingSave   the markups (a default and per brand)
//   erpAskingApply  set the selling prices the owner ticked

import { str } from '../lib/tabs.js';
import { num, round2, formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { erpCashBook } from './cash.js';
import { powerOn, actRole } from '../allow.js';

const NOTES = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
const R = (v) => Math.round(num(v));
const whoIs = (ctx) => str(ctx.s && ctx.s.name) || 'User';

export async function erpCashUp(ctx, payload) {
  payload = payload || {};
  // fix-2 M8: one cash-up at a time - a second one made at the same moment reads the book after the first one's correction
  await (await import('./money.js')).lock(ctx, 'cashup');
  const book = await erpCashBook(ctx, {});
  const acc = (book.accounts || []).find((a) => a.id === str(payload.account) && !a.archived);
  if (!acc) throw new Error('Choose the account you counted.');
  let counted = null;
  const notes = {};
  if (payload.notes && typeof payload.notes === 'object') {
    let t = 0, any = false;
    for (const n of NOTES) {
      const c = Math.round(num(payload.notes[n]));
      if (c < 0) throw new Error('A count cannot be negative.');
      if (c) { notes[n] = c; t += c * n; any = true; }
    }
    if (any) counted = t;
  }
  if (counted === null) {
    if (payload.counted === '' || payload.counted === null || payload.counted === undefined || !isFinite(Number(payload.counted))) throw new Error('Type what you counted, or count the notes.');
    counted = round2(num(payload.counted));
  }
  if (counted < 0) throw new Error('What you counted cannot be below zero.');
  const variance = round2(counted - num(acc.balance));
  const note = str(payload.note).slice(0, 200);
  if (Math.abs(variance) >= 0.5 && !note) throw new Error('The count is ' + (variance > 0 ? 'more' : 'less') + ' than the book by ' + Math.abs(R(variance)) + '. Say why, so it can be read later.');
  let moveId = null;
  if (Math.abs(variance) >= 0.5) {
    const m = await ctx.tx`insert into money_moves (business_id, account_id, at, amount, kind, note, by)
                           values (${ctx.biz}, ${acc.id}, ${ctx.now}, ${variance}, 'adjust',
                                   ${'cash-up: counted ' + counted + ', book said ' + acc.balance + ' · ' + note}, ${whoIs(ctx)}) returning id`;
    moveId = m[0].id;
  }
  await ctx.tx`insert into cash_ups (business_id, account_id, at, book, counted, variance, notes, note, move_id, by)
               values (${ctx.biz}, ${acc.id}, ${ctx.now}, ${num(acc.balance)}, ${counted}, ${variance}, ${JSON.stringify(notes)}::jsonb, ${note || null}, ${moveId}, ${whoIs(ctx)})`;
  return { ok: true, account: acc.name, book: R(acc.balance), counted: R(counted), variance: R(variance), corrected: !!moveId, history: (await erpCashUps(ctx, {})).history };
}

export async function erpCashUps(ctx, payload) {
  const list = await ctx.tx`
    select c.at, c.book, c.counted, c.variance, c.notes, c.note, c.by, a.name, coalesce(btrim(m.voided), '') <> '' as struck
    from cash_ups c join money_accounts a on a.id = c.account_id left join money_moves m on m.id = c.move_id
    where c.business_id = ${ctx.biz} ${payload && payload.account ? ctx.tx`and c.account_id = ${str(payload.account)}` : ctx.tx``}
    order by c.at desc limit 120`;
  return { notes: NOTES, history: list.map((r) => ({ when: formatDate(new Date(r.at), 'd MMM yyyy, h:mm a'), account: str(r.name), book: R(r.book), counted: R(r.counted),
    variance: R(r.variance), byNotes: r.notes && Object.keys(r.notes).length ? r.notes : null, note: str(r.note), by: str(r.by), struck: !!r.struck })) };
}

// ---------------------------------------------------------------- asking prices

async function markups(ctx) {
  let c = null;
  try { c = JSON.parse(str(await getConfig(ctx, 'asking_markup', '')) || 'null'); } catch (_) { c = null; }
  return { def: num(c && c.def) > 0 ? num(c.def) : 40, brands: (c && c.brands && typeof c.brands === 'object') ? c.brands : {} };
}
const roundUp10 = (v) => Math.ceil(v / 10) * 10;

export async function erpAskingPrices(ctx, payload) {
  if (!powerOn(ctx.s, 'costs')) throw new Error('Your account cannot see what goods cost.');
  const ref = str(payload && payload.reference);
  const mk = await markups(ctx);
  const lots = ref ? await ctx.tx`
    select p.sku, p.name, p.brand, p.sell_price, l.unit_cost from stock_lots l join products p on p.id = l.product_id
    where l.business_id = ${ctx.biz} and l.reference = ${ref} and l.source = 'receive' and l.unit_cost is not null order by p.name` : [];
  const brandPct = (b) => { const k = Object.keys(mk.brands).find((x) => x.toLowerCase() === str(b).toLowerCase()); return k ? num(mk.brands[k]) : mk.def; };
  return { markup: mk.def, brands: mk.brands, reference: ref, currency: 'BDT',
           lines: lots.map((l) => { const pct = brandPct(l.brand), ask = roundUp10(num(l.unit_cost) * (1 + pct / 100));
             return { sku: str(l.sku), name: str(l.name), brand: str(l.brand), landed: round2(l.unit_cost), markup: pct, asking: ask, now: R(l.sell_price),
                      change: R(l.sell_price) ? Math.round((ask - num(l.sell_price)) / num(l.sell_price) * 100) : null }; }) };
}

export async function erpAskingSave(ctx, payload) {
  if (actRole(ctx.s) !== 'owner') throw new Error('Only the owner sets the markups.');
  payload = payload || {};
  const def = num(payload.def);
  if (!(def > 0 && def <= 500)) throw new Error('The usual markup is a percentage above 0 (up to 500).');
  const brands = {};
  for (const [b, v] of Object.entries(payload.brands || {})) {
    const n = num(v);
    if (!str(b)) continue;
    if (!(n > 0 && n <= 500)) throw new Error('The markup for ' + b + ' looks wrong.');
    brands[str(b).slice(0, 60)] = n;
  }
  await setConfig(ctx, 'asking_markup', JSON.stringify({ def, brands }));
  return erpAskingPrices(ctx, { reference: payload.reference });
}

export async function erpAskingApply(ctx, payload) {
  if (!powerOn(ctx.s, 'products')) throw new Error('Your account cannot change prices.');
  const items = (payload && Array.isArray(payload.items) ? payload.items : []).filter((x) => str(x.sku) && num(x.price) > 0);
  if (!items.length) throw new Error('Tick at least one price to use.');
  let n = 0;
  for (const it of items) {
    const r = await ctx.tx`update products set sell_price = ${round2(num(it.price))}, updated_at = now()
                           where business_id = ${ctx.biz} and lower(btrim(sku)) = ${str(it.sku).toLowerCase()} returning id`;
    n += r.length;
  }
  delete ctx.memo.catalog; delete ctx.memo.dashProducts;
  return { ok: true, changed: n };
}

export const HANDLERS = { erpCashUp, erpCashUps, erpAskingPrices, erpAskingSave, erpAskingApply };
