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
export async function accountForMethod(ctx, method) {
  const r = await cashRules(ctx);
  return r.map[str(method).toLowerCase()] || null;
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
                 what: 'Paid out by the courier', ref: 'Payout ' + str(p.payout_id) + (kept > 0 ? ' · they kept ' + Math.round(kept) : '') });
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
    if (str(m.voided)) continue;
    out.push({ at: new Date(m.at), account: m.account_id, amount: num(m.amount), src: 'move', id: m.id, by: str(m.by), pair: m.pair_id,
               what: str(m.kind) === 'transfer' ? (num(m.amount) < 0 ? 'Transfer out' : 'Transfer in') : 'Correction after counting', ref: str(m.note) });
  }
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
  for (const e of all) { bal[e.account] = round2((bal[e.account] || 0) + e.amount); count[e.account] = (count[e.account] || 0) + 1; }
  const list = accs.map((a) => ({ id: a.id, name: str(a.name), kind: a.kind, kindLabel: KINDS[a.kind] || a.kind, archived: !!a.archived,
                                  opening: num(a.opening), openingDate: a.opening_date ? formatDate(new Date(a.opening_date), 'yyyy-MM-dd') : '',
                                  balance: Math.round(bal[a.id] || 0), lines: count[a.id] || 0, note: str(a.note) }));
  const names = {};
  list.forEach((a) => { names[a.id] = a.name; });

  // one account's statement, newest first, each line with the balance after it
  const pick = isId(payload.account) && names[payload.account] ? payload.account : '';
  let entries = [], more = 0;
  if (pick) {
    let run = 0;
    const mine = all.filter((e) => e.account === pick).map((e) => { run = round2(run + e.amount); return { ...e, after: run }; });
    const limit = Math.min(1000, Math.max(20, Math.round(num(payload.limit)) || 200));
    more = Math.max(0, mine.length - limit);
    entries = mine.slice(-limit).reverse().map((e) => ({ when: when(e.at), what: e.what, ref: e.ref, invoice: e.invoice || '', amount: e.amount, after: Math.round(e.after),
                                                         src: e.src, id: e.id, by: e.by, method: e.note || '' }));
  }

  // courier payouts nobody has said the bank of
  const un = await ctx.tx`select id, payout_id, paid_at, created_src, paid_to_bank from courier_payouts
                          where business_id = ${ctx.biz} and account_id is null and coalesce(paid_to_bank, 0) > 0 order by seq desc limit 100`;
  // money received by a method that has no account yet: it is in no balance until someone says where it went
  const loose = await ctx.tx`
    select id, payment_no, invoice_no, customer, paid_at, amount, method from payments
    where business_id = ${ctx.biz} and account_id is null and coalesce(amount, 0) <> 0
      and lower(btrim(coalesce(method, ''))) not in ('adjusted', 'returned', 'advance', 'undone', 'return / refund', '')
    order by paid_at desc limit 200`;
  return {
    setup: false, canEdit: owner, currency: 'BDT', kinds: KINDS, methods, rules,
    loose: loose.map((p) => ({ id: p.id, when: when(p.paid_at), customer: str(p.customer), invoice: str(p.invoice_no), amount: num(p.amount), method: str(p.method) })),
    accounts: list, total: list.filter((a) => !a.archived).reduce((t, a) => t + a.balance, 0),
    inHand: list.filter((a) => !a.archived && a.kind !== 'courier' && a.kind !== 'agent').reduce((t, a) => t + a.balance, 0),   // an agent's advance is not in hand
    account: pick, entries, more,
    unassigned: un.map((p) => ({ id: p.id, payout: str(p.payout_id), when: when(looseDate(p.paid_at) || looseDate(p.created_src)), amount: Math.round(num(p.paid_to_bank)) })),
    today: formatDate(ctx.now, 'yyyy-MM-dd'),
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
  delete ctx.memo.cashRules;
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
  delete ctx.memo.cashRules;
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

/** Money carried from one account to another: bank to drawer, drawer to bank, wallet to bank. */
export async function erpCashTransfer(ctx, payload) {
  payload = payload || {};
  const from = await liveAccount(ctx, payload.from, 'the money leaves'), to = await liveAccount(ctx, payload.to, 'it goes to');
  if (from.id === to.id) throw new Error('Choose two different accounts.');
  const amount = money2(payload.amount);
  if (!(amount > 0)) throw new Error('How much? Type an amount above 0.');
  const at = moveDate(ctx, payload.date), note = str(payload.note).slice(0, 200);
  await assertOpen(ctx, at, 'a transfer cannot be dated there');
  // fix-5 L4: no more than the account holds (a courier account may run ahead of its payout)
  if (from.kind !== 'courier') {
    const bal = num(((await erpCashBook(ctx, {})).accounts || []).find((a) => a.id === from.id)?.balance);
    if (amount > bal + 0.005) throw new Error(from.name + ' holds ' + Math.round(bal) + '. More than that cannot be moved out (correct its balance first if the book is wrong).');
  }
  const pair = (await ctx.tx`select gen_random_uuid() as id`)[0].id;
  await ctx.tx`insert into money_moves (business_id, account_id, at, amount, kind, pair_id, note, by) values
    (${ctx.biz}, ${from.id}, ${at}, ${-amount}, 'transfer', ${pair}, ${'to ' + to.name + (note ? ' · ' + note : '')}, ${whoIs(ctx)}),
    (${ctx.biz}, ${to.id}, ${at}, ${amount}, 'transfer', ${pair}, ${'from ' + from.name + (note ? ' · ' + note : '')}, ${whoIs(ctx)})`;
  return erpCashBook(ctx, { account: payload.show || from.id });
}

/** The account was counted (or the bank statement read) and holds something else: bring the book to it, saying why. */
export async function erpCashAdjust(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const a = await liveAccount(ctx, payload.account);
  if (payload.counted === '' || payload.counted === null || payload.counted === undefined || !isFinite(Number(payload.counted))) throw new Error('Type what the account really holds.');
  const note = str(payload.note).slice(0, 200);
  if (!note) throw new Error('Say why the book was wrong, so it can be read later.');
  const book = (await erpCashBook(ctx, {})).accounts.find((x) => x.id === a.id).balance;
  const diff = round2(num(payload.counted) - book);
  if (Math.abs(diff) < 0.5) throw new Error('The book already says ' + book + '. Nothing to correct.');
  await ctx.tx`insert into money_moves (business_id, account_id, at, amount, kind, note, by)
               values (${ctx.biz}, ${a.id}, ${new Date()}, ${diff}, 'adjust', ${'counted ' + num(payload.counted) + ', book said ' + book + ' · ' + note}, ${whoIs(ctx)})`;
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

/** A line was put on the wrong account (the payment went to the other bank): move that one line. */
export async function erpCashReassign(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const to = await liveAccount(ctx, payload.account), id = isId(payload.id) ? payload.id : null, src = str(payload.src);
  let n = [];
  if (src === 'payment') n = await ctx.tx`update payments set account_id = ${to.id} where id = ${id} and business_id = ${ctx.biz} returning id, paid_at as at`;
  else if (src === 'expense') n = await ctx.tx`update expenses set account_id = ${to.id} where id = ${id} and business_id = ${ctx.biz} returning id, recorded_at as at`;
  else if (src === 'capital') n = await ctx.tx`update capital_book set account_id = ${to.id} where id = ${id} and business_id = ${ctx.biz} returning id, on_date as at`;
  else if (src === 'payout') n = await ctx.tx`update courier_payouts set account_id = ${to.id} where id = ${id} and business_id = ${ctx.biz} returning id, synced_at as at`;
  else if (src === 'shipcost') n = await ctx.tx`update shipment_costs set account_id = ${to.id} where id = ${id} and business_id = ${ctx.biz} returning id, at`;
  else if (src === 'supplier') n = await ctx.tx`update supplier_payments set account_id = ${to.id} where id = ${id} and business_id = ${ctx.biz} returning id, at`;
  else throw new Error('That line cannot be moved.');
  if (!n.length) throw new Error('That line was not found.');
  if (n[0].at) await assertOpen(ctx, new Date(n[0].at), 'its lines cannot be moved to another account');   // fix-2 M11 (the move is undone)
  return erpCashBook(ctx, { account: payload.show || to.id });
}

export const HANDLERS = { erpCashBook, erpCashSetup, erpCashAccountSave, erpCashMapSave, erpCashTransfer, erpCashAdjust, erpCashMoveVoid, erpCashReassign };
