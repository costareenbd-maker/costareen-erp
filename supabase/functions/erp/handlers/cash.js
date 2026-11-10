// Money accounts (plan A3): where the money is.
//
//   Accounts are the owner's to make: cash drawer, each bank, a wallet, the
//   courier that holds collected cash. Every row that moves money already
//   exists somewhere - a customer payment, an expense, a capital line, a
//   courier payout - and carries the account it touched (account_id, stamped
//   when the row is written). An account's statement is read from those rows;
//   nothing is entered a second time. money_moves holds only what has no row
//   of its own: a transfer between two accounts and a correction after a count.
//
//   erpCashBook({account, limit})   balances; one account's statement; payouts with no bank yet
//   erpCashSetup()                  first time: the usual accounts and where each payment method lands
//   erpCashAccountSave / erpCashMapSave / erpCashTransfer / erpCashAdjust /
//   erpCashMoveVoid / erpCashReassign
//
// A payment method (bKash, Bank Transfer…) lands in the account the owner
// mapped it to. Changing the map changes where NEW money goes; rows already
// written keep their account, and one row can be moved by hand (logged).

import { formatDate, num, round2, dhakaDayStart, looseDate, money2 } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { assertOpen, lockedThrough } from '../lib/period.js';

const str = (v) => String(v == null ? '' : v).trim();
// crit6-desk (10 Nov 2026): money said to people is ৳ with South-Asian grouping, never a raw 1163265
const tkS = (n) => (num(n) < 0 ? '−' : '') + '৳' + Math.abs(Math.round(num(n))).toLocaleString('en-IN');
const KINDS = { cash: 'Cash', bank: 'Bank', wallet: 'Mobile wallet', courier: 'Courier (holds collected cash)', agent: 'Agent advance (money held by a shipping agent)' };
const isId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const when = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy, h:mm a') : '');
const whoIs = (ctx) => str(ctx.s && ctx.s.name) || 'User';

// ------------------------------------------------------------ the map

/** { map: {method(lower): accountId}, expense: id, payout: id } - readable by every member (ids only). */
export async function cashRules(ctx) {
  if (ctx.memo.cashRules) return ctx.memo.cashRules;
  let v = null;
  try { v = JSON.parse(await getConfig(ctx, 'money_rules', '') || 'null'); } catch (_) { v = null; }
  const out = { map: (v && v.map) || {}, expense: (v && v.expense) || '', payout: (v && v.payout) || '' };
  ctx.memo.cashRules = out;
  return out;
}

/** The account a customer payment by this method lands in; null for what is not money (Adjusted, Returned, Advance…). */
// crit4-pay (10 Nov 2026): the order is the owner's - the business's own method -> account rule (Settings / Money),
// then the account whose name IS the method ("Cash" -> the Cash account, bKash / Bkash / BKASH -> the bKash account),
// then none (the payment stays in "Payments in no account" as before, for the owner to place). What is not money
// (Adjusted, Returned, Advance, Undone...) never lands in an account. Rows already written are never moved here.
const NOT_MONEY = { '': 1, adjusted: 1, returned: 1, advance: 1, undone: 1, 'return / refund': 1 };
const methodKey = (m) => str(m).toLowerCase().replace(/\s+/g, ' ');
export async function accountForMethod(ctx, method) {
  const r = await cashRules(ctx);
  const raw = str(method).toLowerCase(), m = methodKey(method);
  await cashNames(ctx);
  // crit5-books: a rule that points at a retired (archived) or removed account is skipped - "a retired account takes
  // no new money" - so the payment falls to the same-name account or to "no account" where the owner sees it
  if (r.map[raw] && ctx.memo.cashOpen[r.map[raw]]) return r.map[raw];
  if (r.map[m] && ctx.memo.cashOpen[r.map[m]]) return r.map[m];
  if (NOT_MONEY[m]) return null;
  return ctx.memo.cashByName[m] || null;
}
async function cashNames(ctx) {
  if (!ctx.memo.cashByName) {
    // row security hides money_accounts below shareholder: 168_pay_account_by_name.sql hands members the ids + names only
    const byName = {}, open = {};
    const fn = (await ctx.tx`select to_regprocedure('public.money_account_names(uuid)') is not null as ok`)[0].ok;
    const rows = fn ? await ctx.tx`select id, name from public.money_account_names(${ctx.biz})`
      : await ctx.tx`select id, name from money_accounts where business_id = ${ctx.biz} and not coalesce(archived, false) order by sort_order, created_at`;
    for (const a of rows) {
      open[a.id] = str(a.name);
      const k = methodKey(a.name);
      if (k && !byName[k]) byName[k] = a.id;
    }
    ctx.memo.cashByName = byName;
    ctx.memo.cashOpen = open;   // id -> name of every open account
  }
  return ctx.memo.cashOpen;
}
/** The account expenses are paid from unless one is named. */
export async function expenseAccount(ctx, wanted) {
  if (isId(wanted)) return wanted;
  return (await cashRules(ctx)).expense || null;
}

// ------------------------------------------------------------ reading

async function accounts(ctx) {
  return ctx.tx`select * from money_accounts where business_id = ${ctx.biz} order by archived, sort_order, created_at`;
}

/** Every line that moved money, oldest first: { at, account, amount, what, ref, src, id, by }. */
async function ledger(ctx, accs) {
  const out = [];
  const byKind = {};
  accs.forEach((a) => { byKind[a.id] = a.kind; });
  for (const a of accs) {
    if (num(a.opening)) out.push({ at: a.opening_date ? dhakaDayStart(formatDate(new Date(a.opening_date), 'yyyy-MM-dd')) : new Date(a.created_at),
                                   account: a.id, amount: num(a.opening), what: 'Opening balance', ref: '', src: 'opening', id: a.id, by: '' });
  }
  for (const p of await ctx.tx`select id, payment_no, invoice_no, customer, paid_at, amount, method, note, recorded_by, account_id
                               from payments where business_id = ${ctx.biz} and account_id is not null`) {
    const amt = num(p.amount);
    out.push({ at: new Date(p.paid_at), account: p.account_id, amount: amt, src: 'payment', id: p.id, by: str(p.recorded_by),
               what: amt < 0 ? 'Refund to ' + (str(p.customer) || 'customer') : 'Received from ' + (str(p.customer) || 'customer'),
               ref: str(p.invoice_no) || str(p.method), invoice: str(p.invoice_no), note: str(p.method) });
  }
  // an investor's return is one payment written in two books; it is counted from the capital book
  const viaCapital = {};
  for (const c of await ctx.tx`select id, on_date, recorded_at, holder_no, type, amount, note, by, account_id, expense_no, voided
                               from capital_book where business_id = ${ctx.biz}`) {
    if (str(c.expense_no)) viaCapital[str(c.expense_no)] = true;
    if (!c.account_id || str(c.voided)) continue;
    const inn = str(c.type) === 'invest';
    out.push({ at: new Date(c.on_date || c.recorded_at), account: c.account_id, amount: inn ? num(c.amount) : -num(c.amount), src: 'capital', id: c.id, by: str(c.by),
               what: { invest: 'Capital put in', withdraw: 'Capital taken back', profit: 'Profit paid out', ret: 'Return paid to investor' }[str(c.type)] || str(c.type),
               ref: str(c.note), holder: str(c.holder_no) });
  }
  for (const e of await ctx.tx`select id, expense_no, recorded_at, category, description, amount, recorded_by, account_id, voided
                               from expenses where business_id = ${ctx.biz} and account_id is not null`) {
    if (str(e.voided) || viaCapital[str(e.expense_no)]) continue;
    out.push({ at: new Date(e.recorded_at), account: e.account_id, amount: -num(e.amount), src: 'expense', id: e.id, by: str(e.recorded_by),
               what: 'Expense: ' + (str(e.description) || str(e.category)), ref: str(e.category) });
  }
  // a courier payout: the collected cash leaves the courier; what they paid over arrives in a bank
  const courier = accs.find((a) => a.kind === 'courier' && !a.archived);
  for (const p of await ctx.tx`select id, payout_id, paid_at, created_src, cod_collected, paid_to_bank, account_id
                               from courier_payouts where business_id = ${ctx.biz}`) {
    const d = looseDate(p.paid_at) || looseDate(p.created_src);
    if (!d) continue;
    const kept = round2(num(p.cod_collected) - num(p.paid_to_bank));
    if (courier && num(p.cod_collected)) {
      out.push({ at: d, account: courier.id, amount: -num(p.cod_collected), src: 'payout-out', id: p.id, by: '',
                 what: 'Paid out by the courier', ref: 'Payout ' + str(p.payout_id) + (kept > 0 ? ' · they kept ' + tkS(kept) : '') });
    }
    if (p.account_id && num(p.paid_to_bank)) {
      out.push({ at: d, account: p.account_id, amount: num(p.paid_to_bank), src: 'payout', id: p.id, by: '',
                 what: 'Courier payout received', ref: 'Payout ' + str(p.payout_id) });
    }
  }
  for (const sp of await ctx.tx`select id, supplier, at, amount, account_id, note, by, voided from supplier_payments
                                where business_id = ${ctx.biz} and account_id is not null`) {
    if (str(sp.voided)) continue;
    out.push({ at: new Date(sp.at), account: sp.account_id, amount: -num(sp.amount), src: 'supplier', id: sp.id, by: str(sp.by),
               what: 'Paid to supplier ' + str(sp.supplier), ref: str(sp.note) });
  }
  for (const sc of await ctx.tx`select id, reference, at, label, amount, account_id, by, voided from shipment_costs
                                where business_id = ${ctx.biz} and account_id is not null`) {
    if (str(sc.voided)) continue;
    out.push({ at: new Date(sc.at), account: sc.account_id, amount: -num(sc.amount), src: 'shipcost', id: sc.id, by: str(sc.by),
               what: str(sc.label) + ' on a shipment', ref: str(sc.reference) });
  }
  for (const m of await ctx.tx`select id, account_id, at, amount, kind, pair_id, note, by, voided from money_moves where business_id = ${ctx.biz}`) {
    // final-money (10 Nov 2026): a struck-out transfer or correction stays on the statement, crossed through with its
    // reason (it counts for nothing) - before, it vanished and nobody could see what had been struck out
    out.push({ at: new Date(m.at), account: m.account_id, amount: num(m.amount), src: 'move', id: m.id, by: str(m.by), pair: m.pair_id,
               what: str(m.kind) === 'transfer' ? (num(m.amount) < 0 ? 'Transfer out' : 'Transfer in') : 'Correction after counting', ref: str(m.note),
               struck: str(m.voided) || '' });
  }
  // final-money: the trail of lines moved to another account ("Wrong account"): who, from where, when, why
  try {
    const names = {};
    accs.forEach((a) => { names[a.id] = str(a.name); });
    const trail = {};
    for (const r of await ctx.tx.savepoint(() => ctx.tx`select src, line_id, from_account, to_account, reason, by, at from money_reassigns
                                                      where business_id = ${ctx.biz} order by at`)) {
      const k = str(r.src) + ':' + str(r.line_id);
      trail[k] = 'moved ' + formatDate(new Date(r.at), 'd MMM yy') + (str(r.by) ? ' by ' + str(r.by) : '') +
                 (r.from_account ? ' from ' + (names[r.from_account] || 'another account') : ' from no account') + (str(r.reason) ? ': ' + str(r.reason) : '');
    }
    for (const e of out) { const t = trail[e.src + ':' + e.id]; if (t) e.moved = t; }
  } catch (_) { /* the table is not there yet (migration 163 not applied): no trail shown */ }
  out.sort((a, b) => a.at - b.at);
  return out;
}

export async function erpCashBook(ctx, payload) {
  payload = payload || {};
  const accs = await accounts(ctx);
  const owner = roleAtLeast(ctx.s.role, 'shareholder');   // 27 Oct 2026: a shareholder edits as the owner
  const rules = await cashRules(ctx);
  const methods = (await ctx.tx`select value from lookups where business_id = ${ctx.biz} and kind = 'payment_methods' order by sort_order, value`)
    .map((r) => str(r.value)).filter(Boolean);
  if (methods.indexOf('COD (Steadfast)') < 0) methods.push('COD (Steadfast)');
  if (!accs.length) return { setup: true, canEdit: owner, accounts: [], total: 0, entries: [], kinds: KINDS, methods, rules, unassigned: [], loose: [], currency: 'BDT' };

  const all = await ledger(ctx, accs);
  const bal = {}, count = {};
  for (const e of all) { if (e.struck) continue; bal[e.account] = round2((bal[e.account] || 0) + e.amount); count[e.account] = (count[e.account] || 0) + 1; }
  const list = accs.map((a) => ({ id: a.id, name: str(a.name), kind: a.kind, kindLabel: KINDS[a.kind] || a.kind, archived: !!a.archived,
                                  opening: num(a.opening), openingDate: a.opening_date ? formatDate(new Date(a.opening_date), 'yyyy-MM-dd') : '',
                                  balance: Math.round(bal[a.id] || 0), lines: count[a.id] || 0, note: str(a.note),
                                  // final-money: a balance below zero is flagged (the book says the account holds less than nothing:
                                  // a payment is missing, or an expense was paid from the wrong account)
                                  negative: Math.round(bal[a.id] || 0) < 0 }));
  const names = {};
  list.forEach((a) => { names[a.id] = a.name; });

  // one account's statement, newest first, each line with the balance after it
  const pick = isId(payload.account) && names[payload.account] ? payload.account : '';
  let entries = [], more = 0;
  if (pick) {
    let run = 0;
    const mine = all.filter((e) => e.account === pick).map((e) => { if (!e.struck) run = round2(run + e.amount); return { ...e, after: run }; });
    const limit = Math.min(1000, Math.max(20, Math.round(num(payload.limit)) || 200));
    more = Math.max(0, mine.length - limit);
    entries = mine.slice(-limit).reverse().map((e) => ({ when: when(e.at), what: e.what, ref: e.ref, invoice: e.invoice || '', amount: e.amount, after: Math.round(e.after),
                                                         src: e.src, id: e.id, by: e.by, method: e.note || '', struck: e.struck || '', moved: e.moved || '' }));
  }
  // final-money: what the owner should look at on this screen, in plain words
  const warnings = [];
  for (const a of list) if (!a.archived && a.negative) warnings.push({ kind: 'negative', account: a.id, name: a.name, amount: a.balance,
    text: a.name + ' is below zero (' + a.balance + '): the book says it holds less than nothing. A payment into it is missing, or something was paid from the wrong account - check its statement.' });

  // courier payouts nobody has said the bank of
  const un = await ctx.tx`select id, payout_id, paid_at, created_src, paid_to_bank from courier_payouts
                          where business_id = ${ctx.biz} and account_id is null and coalesce(paid_to_bank, 0) > 0 order by seq desc limit 100`;
  // money received by a method that has no account yet: it is in no balance until someone says where it went
  const loose = await ctx.tx`
    select id, payment_no, invoice_no, customer, paid_at, amount, method from payments
    where business_id = ${ctx.biz} and account_id is null and coalesce(amount, 0) <> 0
      and lower(btrim(coalesce(method, ''))) not in ('adjusted', 'returned', 'advance', 'undone', 'return / refund', '')
    order by paid_at desc limit 200`;
  // crit7-trust (10 Nov 2026): the whole sum and count (the list above stops at 200). Money received but not yet in an
  // account is still the business's money: it counts in Money in hand (owner decision) and has its own balance-sheet row.
  const lt = (await ctx.tx`
    select count(*)::int as n, coalesce(sum(amount), 0) as s from payments
    where business_id = ${ctx.biz} and account_id is null and coalesce(amount, 0) <> 0
      and lower(btrim(coalesce(method, ''))) not in ('adjusted', 'returned', 'advance', 'undone', 'return / refund', '')`)[0];
  const inAccounts = list.filter((a) => !a.archived && a.kind !== 'courier' && a.kind !== 'agent').reduce((t, a) => t + a.balance, 0);   // an agent's advance is not in hand
  const looseTotal = Math.round(num(lt.s)), looseN = num(lt.n);
  return {
    setup: false, canEdit: owner, currency: 'BDT', kinds: KINDS, methods, rules,
    loose: loose.map((p) => ({ id: p.id, when: when(p.paid_at), customer: str(p.customer), invoice: str(p.invoice_no), amount: num(p.amount), method: str(p.method) })),
    accounts: list, total: list.filter((a) => !a.archived).reduce((t, a) => t + a.balance, 0),
    inAccounts, looseTotal, looseN,
    inHand: inAccounts + looseTotal,   // crit7-trust: in the accounts + received, not yet placed (placing one moves it, the sum stays)
    account: pick, entries, more, warnings,
    unassigned: un.map((p) => ({ id: p.id, payout: str(p.payout_id), when: when(looseDate(p.paid_at) || looseDate(p.created_src)), amount: Math.round(num(p.paid_to_bank)) })),
    today: formatDate(ctx.now, 'yyyy-MM-dd'),
    lockedThrough: await lockedThrough(ctx),   // distill-money (9 Nov 2026): the month-lock chip on the Money screen
  };
}

// ------------------------------------------------------------ writing

function needOwner(ctx) { if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder can change the money accounts.'); }

/**
 * First time: the usual accounts and where each payment method lands. Rows
 * already in the books (payments, expenses, capital lines) are given their
 * account by the same rules, once.
 */
export async function erpCashSetup(ctx, payload) {
  needOwner(ctx);
  if ((await accounts(ctx)).length) throw new Error('The accounts are already set up.');
  const wanted = Array.isArray(payload && payload.accounts) && payload.accounts.length ? payload.accounts
    : [{ name: 'Cash', kind: 'cash' }, { name: 'Bank', kind: 'bank' }, { name: 'bKash', kind: 'wallet' }, { name: 'Steadfast', kind: 'courier' }];
  const ids = {};
  let i = 0;
  for (const a of wanted) {
    const name = str(a.name).slice(0, 60), kind = KINDS[str(a.kind)] ? str(a.kind) : 'bank';
    if (!name || ids[name.toLowerCase()]) continue;
    ids[name.toLowerCase()] = { id: (await ctx.tx`insert into money_accounts (business_id, name, kind, sort_order) values (${ctx.biz}, ${name}, ${kind}, ${++i}) returning id`)[0].id, kind };
  }
  const first = (kind) => { for (const k of Object.keys(ids)) if (ids[k].kind === kind) return ids[k].id; return ''; };
  const cash = first('cash') || first('bank'), bank = first('bank') || cash, wallet = first('wallet') || bank, courier = first('courier') || '';
  const map = {};
  const known = (await ctx.tx`select value from lookups where business_id = ${ctx.biz} and kind = 'payment_methods'`).map((r) => str(r.value));
  for (const m of known.concat(['Cash', 'bKash', 'Bank Transfer', 'Bangla QR', 'COD'])) {
    const l = m.toLowerCase();
    map[l] = /cash/.test(l) && !/cod|delivery/.test(l) ? cash : /bkash|nagad|rocket|upay/.test(l) ? wallet : /cod|courier|steadfast/.test(l) ? (courier || cash) : bank;
  }
  if (courier) { map['cod (steadfast)'] = courier; map.cod = courier; }
  await setConfig(ctx, 'money_rules', JSON.stringify({ map, expense: cash, payout: bank }));
  delete ctx.memo.cashRules; delete ctx.memo.cashByName;
  await stampOld(ctx);
  return erpCashBook(ctx, {});
}

/** Rows written before the accounts existed take the account the rules give them. */
async function stampOld(ctx) {
  const r = await cashRules(ctx);
  for (const m of Object.keys(r.map)) {
    if (!isId(r.map[m])) continue;
    await ctx.tx`update payments set account_id = ${r.map[m]} where business_id = ${ctx.biz} and account_id is null and lower(btrim(method)) = ${m}`;
    await ctx.tx`update capital_book set account_id = ${r.map[m]} where business_id = ${ctx.biz} and account_id is null and lower(btrim(method)) = ${m}`;
  }
  if (isId(r.expense)) {
    await ctx.tx`update expenses set account_id = ${r.expense} where business_id = ${ctx.biz} and account_id is null`;
    await ctx.tx`update capital_book set account_id = ${r.expense} where business_id = ${ctx.biz} and account_id is null`;
  }
  if (isId(r.payout)) await ctx.tx`update courier_payouts set account_id = ${r.payout} where business_id = ${ctx.biz} and account_id is null`;
}

export async function erpCashAccountSave(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const name = str(payload.name).slice(0, 60);
  if (!name) throw new Error('Give the account a name.');
  const kind = KINDS[str(payload.kind)] ? str(payload.kind) : 'bank';
  const opening = round2(num(payload.opening));
  const od = /^\d{4}-\d{2}-\d{2}$/.test(str(payload.openingDate)) ? str(payload.openingDate) : null;
  const all = await accounts(ctx);
  if (all.some((a) => str(a.name).toLowerCase() === name.toLowerCase() && a.id !== payload.id)) throw new Error('There is already an account called "' + name + '".');
  if (kind === 'courier' && all.some((a) => a.kind === 'courier' && !a.archived && a.id !== payload.id) && !payload.archived) {
    throw new Error('There is already a courier account. One is enough: it stands for cash the courier has collected and not paid over yet.');
  }
  // fix-2 M11: an opening balance dated in (or before) a closed month would change balances already closed
  const lockM = await lockedThrough(ctx);
  const inClosed = (o, d) => !!lockM && Math.abs(num(o)) >= 0.005 && (!d || String(d).slice(0, 7) <= lockM);
  const closedSay = 'The books are closed up to ' + lockM + ': an opening balance there would change balances already closed. Date it in an open month (or correct the balance with "Correct a balance").';
  if (isId(payload.id)) {
    const cur = all.find((a) => a.id === payload.id);
    if (!cur) throw new Error('That account was not found.');
    const was = (await ctx.tx`select opening, to_char(opening_date, 'YYYY-MM-DD') as od from money_accounts where id = ${cur.id}`)[0] || {};
    if ((round2(num(was.opening)) !== opening || (was.od || null) !== od) && (inClosed(was.opening, was.od) || inClosed(opening, od))) throw new Error(closedSay);
    if (payload.archived && !cur.archived) {
      const b = (await erpCashBook(ctx, {})).accounts.find((a) => a.id === cur.id);
      if (b && Math.abs(b.balance) > 0.5) throw new Error(cur.name + ' still holds ' + b.balance + '. Transfer it out before retiring the account.');
    }
    await ctx.tx`update money_accounts set name = ${name}, kind = ${kind}, opening = ${opening}, opening_date = ${od}::date,
                 archived = ${!!payload.archived}, note = ${str(payload.note).slice(0, 200) || null} where id = ${cur.id} and business_id = ${ctx.biz}`;
  } else {
    if (inClosed(opening, od)) throw new Error(closedSay);
    await ctx.tx`insert into money_accounts (business_id, name, kind, opening, opening_date, sort_order, note)
                 values (${ctx.biz}, ${name}, ${kind}, ${opening}, ${od}::date, ${all.length + 1}, ${str(payload.note).slice(0, 200) || null})`;
  }
  return erpCashBook(ctx, { account: payload.id });
}

/** Where each payment method lands, what expenses are paid from, where courier payouts arrive. New rows only. */
export async function erpCashMapSave(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const ok = {};
  (await accounts(ctx)).forEach((a) => { if (!a.archived) ok[a.id] = true; });
  const map = {};
  for (const k of Object.keys(payload.map || {})) {
    const id = payload.map[k];
    if (id && !ok[id]) throw new Error('One of the chosen accounts is not in use.');
    if (id) map[str(k).toLowerCase()] = id;
  }
  for (const k of ['expense', 'payout']) if (payload[k] && !ok[payload[k]]) throw new Error('One of the chosen accounts is not in use.');
  await setConfig(ctx, 'money_rules', JSON.stringify({ map, expense: payload.expense || '', payout: payload.payout || '' }));
  delete ctx.memo.cashRules; delete ctx.memo.cashByName;
  return erpCashBook(ctx, {});
}

async function liveAccount(ctx, id, label) {
  const a = (await ctx.tx`select id, name, kind, archived from money_accounts where id = ${isId(id) ? id : null} and business_id = ${ctx.biz}`)[0];
  if (!a) throw new Error('Choose the account' + (label ? ' ' + label : '') + '.');
  if (a.archived) throw new Error(a.name + ' is retired. Choose an account that is in use.');
  return a;
}
function moveDate(ctx, typed) {
  const t = str(typed);
  if (!t) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new Error('The date should look like 2026-10-05.');
  if (t > formatDate(ctx.now, 'yyyy-MM-dd')) throw new Error('That date has not come yet.');
  return new Date(dhakaDayStart(t).getTime() + 12 * 3600e3);
}

/** Money carried from one account to another: bank to drawer, drawer to bank, wallet to bank.
 *  final-money (10 Nov 2026): one source, MANY destinations in one go - `splits: [{ to, amount }]` (the day's cash
 *  deposited into two banks, say). Every leg is its own pair of lines; the whole batch is one transaction, and the
 *  source must hold the total. Without `splits` it is the old one-to-one transfer. A double tap of the same transfer
 *  within a minute is refused plainly. */
export async function erpCashTransfer(ctx, payload) {
  payload = payload || {};
  const from = await liveAccount(ctx, payload.from, 'the money leaves');
  const legsIn = Array.isArray(payload.splits) && payload.splits.length ? payload.splits.slice(0, 20) : [{ to: payload.to, amount: payload.amount }];
  const legs = [];
  for (const l of legsIn) {
    const to = await liveAccount(ctx, l && l.to, 'it goes to');
    if (from.id === to.id) throw new Error('Choose two different accounts.');
    const amount = money2(l && l.amount);
    if (!(amount > 0)) throw new Error('How much? Type an amount above 0' + (legsIn.length > 1 ? ' on every line' : '') + '.');
    if (legs.some((x) => x.to.id === to.id)) throw new Error(to.name + ' is on two lines. Put the whole amount on one.');
    legs.push({ to, amount });
  }
  const total = round2(legs.reduce((t, l) => t + l.amount, 0));
  const at = moveDate(ctx, payload.date), note = str(payload.note).slice(0, 200);
  await assertOpen(ctx, at, 'a transfer cannot be dated there');
  // fix-5 L4: no more than the account holds (a courier account may run ahead of its payout)
  if (from.kind !== 'courier') {
    const bal = num(((await erpCashBook(ctx, {})).accounts || []).find((a) => a.id === from.id)?.balance);
    if (total > bal + 0.005) throw new Error(from.name + ' holds ' + tkS(bal) + '. More than that cannot be moved out (correct its balance first if the book is wrong).');
  }
  // a double tap: the very same transfer written a moment ago
  const dup = await ctx.tx`select 1 from money_moves where business_id = ${ctx.biz} and account_id = ${from.id} and kind = 'transfer' and amount = ${-legs[0].amount}
                           and note = ${'to ' + legs[0].to.name + (note ? ' · ' + note : '')} and coalesce(btrim(voided), '') = '' and created_at > now() - interval '60 seconds' limit 1`;
  if (dup.length) throw new Error('This same transfer was written a moment ago (a double tap?). It is already on the statement; if it really is a second one, wait a minute and move it again.');
  for (const l of legs) {
    const pair = (await ctx.tx`select gen_random_uuid() as id`)[0].id;
    await ctx.tx`insert into money_moves (business_id, account_id, at, amount, kind, pair_id, note, by) values
      (${ctx.biz}, ${from.id}, ${at}, ${-l.amount}, 'transfer', ${pair}, ${'to ' + l.to.name + (note ? ' · ' + note : '')}, ${whoIs(ctx)}),
      (${ctx.biz}, ${l.to.id}, ${at}, ${l.amount}, 'transfer', ${pair}, ${'from ' + from.name + (note ? ' · ' + note : '')}, ${whoIs(ctx)})`;
  }
  const book = await erpCashBook(ctx, { account: payload.show || from.id });
  book.moved = { total, legs: legs.length };
  return book;
}

/** The account was counted (or the bank statement read) and holds something else: bring the book to it, saying why. */
export async function erpCashAdjust(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const a = await liveAccount(ctx, payload.account);
  if (payload.counted === '' || payload.counted === null || payload.counted === undefined || !isFinite(Number(payload.counted))) throw new Error('Type what the account really holds.');
  const note = str(payload.note).slice(0, 200);
  if (!note) throw new Error('Say why the book was wrong, so it can be read later.');
  await assertOpen(ctx, ctx.now, 'a correction cannot be written today');   // final-money: every money write checks the lock
  const book = (await erpCashBook(ctx, {})).accounts.find((x) => x.id === a.id).balance;
  const diff = round2(num(payload.counted) - book);
  if (Math.abs(diff) < 0.5) throw new Error('The book already says ' + tkS(book) + '. Nothing to correct.');
  await ctx.tx`insert into money_moves (business_id, account_id, at, amount, kind, note, by)
               values (${ctx.biz}, ${a.id}, ${ctx.now}, ${diff}, 'adjust', ${'counted ' + tkS(payload.counted) + ', book said ' + tkS(book) + ' · ' + note}, ${whoIs(ctx)})`;
  return erpCashBook(ctx, { account: a.id });
}

/** Strike out a transfer (both sides) or a correction. */
export async function erpCashMoveVoid(ctx, payload) {
  needOwner(ctx);
  const id = str(payload && payload.id), why = str(payload && payload.reason);
  if (!why) throw new Error('Say why it is being struck out.');
  const m = (await ctx.tx`select id, pair_id, account_id, voided, at from money_moves where id = ${isId(id) ? id : null} and business_id = ${ctx.biz}`)[0];
  if (!m) throw new Error('That line was not found.');
  await assertOpen(ctx, new Date(m.at), 'its lines cannot be struck out');
  if (str(m.voided)) throw new Error('That line is already struck out.');
  const mark = 'struck out ' + formatDate(new Date(), 'd MMM yy') + ' by ' + whoIs(ctx) + ': ' + why;
  if (m.pair_id) await ctx.tx`update money_moves set voided = ${mark} where business_id = ${ctx.biz} and pair_id = ${m.pair_id}`;
  else await ctx.tx`update money_moves set voided = ${mark} where id = ${m.id}`;
  return erpCashBook(ctx, { account: m.account_id });
}

/** One line of money moved to another account (shared by erpCashReassign and erpCashPlaceMany). The move leaves a
 *  trail (money_reassigns: from, to, who, when, why) that the statement prints under the line - final-money. */
async function moveLine(ctx, src, id, to, reason) {
  let n = [];
  if (!isId(id)) throw new Error('That line was not found.');
  const T = { payment: ['payments', 'paid_at'], expense: ['expenses', 'recorded_at'], capital: ['capital_book', 'on_date'],
              payout: ['courier_payouts', 'synced_at'], shipcost: ['shipment_costs', 'at'], supplier: ['supplier_payments', 'at'] };
  if (!T[src]) throw new Error('That line cannot be moved.');
  const [table, atCol] = T[src];
  n = await ctx.tx`update ${ctx.tx(table)} set account_id = ${to.id} where id = ${id} and business_id = ${ctx.biz} returning id, ${ctx.tx(atCol)} as at`;
  if (!n.length) throw new Error('That line was not found.');
  if (n[0].at) await assertOpen(ctx, new Date(n[0].at), 'its lines cannot be moved to another account');   // fix-2 M11 (the move is undone)
  const before = ctx.memo['__was:' + src + ':' + id];   // read by accountOfLine before the update
  try {
    await ctx.tx.savepoint(() => ctx.tx`insert into money_reassigns (business_id, src, line_id, from_account, to_account, reason, by)
                                        values (${ctx.biz}, ${src}, ${id}, ${isId(before) && before !== to.id ? before : null}, ${to.id}, ${str(reason).slice(0, 200) || null}, ${whoIs(ctx)})`);
  } catch (_) { /* migration 163 not applied yet: the move still happens, without its trail */ }
}
/** The account a line sits in now (read BEFORE moveLine, so the trail can say where it came from). */
async function accountOfLine(ctx, src, id) {
  const T = { payment: 'payments', expense: 'expenses', capital: 'capital_book', payout: 'courier_payouts', shipcost: 'shipment_costs', supplier: 'supplier_payments' };
  if (!T[src] || !isId(id)) return null;
  const r = await ctx.tx`select account_id from ${ctx.tx(T[src])} where id = ${id} and business_id = ${ctx.biz}`;
  const was = r[0] ? r[0].account_id : null;
  ctx.memo['__was:' + src + ':' + id] = was;
  return was;
}

/** A line was put on the wrong account (the payment went to the other bank): move that one line. */
export async function erpCashReassign(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const to = await liveAccount(ctx, payload.account);
  const src = str(payload.src);
  const was = await accountOfLine(ctx, src, payload.id);
  if (was === to.id) throw new Error('That line is already in ' + to.name + '.');
  await moveLine(ctx, src, payload.id, to, payload.reason);
  return erpCashBook(ctx, { account: payload.show || to.id });
}

/** distill-money (9 Nov 2026): many payments / courier payouts in no account placed into one account in one go
 *  ({ account, items: [{src, id}] }, up to 500). The whole batch is one transaction: a line in a closed month
 *  refuses the batch, nothing half-done. Returns the book plus how many lines were placed. */
export async function erpCashPlaceMany(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const to = await liveAccount(ctx, payload.account);
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 500) : [];
  if (!items.length) throw new Error('Nothing to place: pick the payments first.');
  let placed = 0;
  for (const it of items) {
    const src = str(it && it.src);
    if (src !== 'payment' && src !== 'payout') throw new Error('Only payments and courier payouts are placed this way.');
    await accountOfLine(ctx, src, it && it.id);
    await moveLine(ctx, src, it && it.id, to, payload.reason || 'placed from "no account"');
    placed++;
  }
  const book = await erpCashBook(ctx, { account: payload.show || to.id });
  book.placed = placed;
  return book;
}

// crit5-books (10 Nov 2026): where each payment method lands, readable by every member, so the sale and payment forms
// can say "Nagad · no account yet" BEFORE the money is taken (the server's own rule above decides; nothing new is
// invented here). Ids and names only - no balance, no statement (those stay shareholder-only in erpCashBook).
//   erpPayMethods({methods?: [names]}) -> { methods: [{method, account, accountName, courier, notMoney}], canAdd }
const COURIER_RE = /^cod\b|cash on delivery|courier|steadfast|pathao|redx/i;
export async function erpPayMethods(ctx, payload) {
  payload = payload || {};
  const listed = (await ctx.tx`select value from lookups where business_id = ${ctx.biz} and kind = 'payment_methods' order by sort_order, value`)
    .map((r) => str(r.value)).filter(Boolean);
  const extra = Array.isArray(payload.methods) ? payload.methods.slice(0, 50).map((m) => str(m).slice(0, 60)).filter(Boolean) : [];
  const seen = {}, all = [];
  for (const m of listed.concat(extra)) { const k = methodKey(m); if (k && !seen[k]) { seen[k] = 1; all.push(m); } }
  if (!all.length) all.push('Cash');
  const names = await cashNames(ctx);   // the security-definer list: members see open account ids + names only
  const out = [];
  for (const m of all) {
    const notMoney = !!NOT_MONEY[methodKey(m)];
    let id = notMoney ? null : await accountForMethod(ctx, m);
    if (id && !names[id]) id = null;            // a rule that points at an archived / removed account: the money would be lost
    out.push({ method: m, account: id || '', accountName: id ? names[id] : '', courier: COURIER_RE.test(m), notMoney });
  }
  return { methods: out, canAdd: roleAtLeast(ctx.s.role, 'shareholder'), accounts: Object.keys(names).length };
}

export const HANDLERS = { erpPayMethods, erpCashBook, erpCashSetup, erpCashAccountSave, erpCashMapSave, erpCashTransfer, erpCashAdjust, erpCashMoveVoid, erpCashReassign, erpCashPlaceMany };
