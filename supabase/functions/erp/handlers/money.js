// The money rules every screen shares - ported line by line from ERP.js
// (4881-5540, 6071, 10759-10809). Kept in ONE place on purpose: the original
// drifted when screens re-derived these on their own.

import { salesLog, paymentsTab, forget, asDate, str, SL, PAY } from '../lib/tabs.js';
import { formatDate, num, round2 } from '../lib/time.js';
import { roleAtLeast, powerOn, callAllowed } from '../allow.js';
import { custKey } from '../lib/phone.js';
import { accountForMethod } from './cash.js';

export const ERP_PAY_REASONS = {
  payment:  { label: 'Payment received', minRole: 'manager', money: true },
  reduce:   { label: 'Reduce the due',   minRole: 'shareholder', money: false },
  increase: { label: 'Increase the due', minRole: 'shareholder', money: false, increases: true },
};
const ERP_PAY_ALIAS = {
  discount: 'reduce', writeoff: 'reduce', correct: 'reduce',
  return: 'reduce', reverse: 'increase',
};

/** erpWhoIsThis_: the signed-in person's name. */
export function who(ctx) { return (ctx.s && ctx.s.name) || 'erp'; }

/** yyMMddHHmmss stamp used in payment / return ids. */
export function stamp(d = new Date()) { return formatDate(d, 'yyMMddHHmmss'); }

/** Serialise writers of one kind per business (LockService.getScriptLock). */
export async function lock(ctx, topic) {
  await ctx.tx`select pg_advisory_xact_lock(hashtext(${ctx.biz + ':' + topic}))`;
}

// ------------------------------------------------------------------ ledger

/** erpPaidByOrder_: everything received, grouped by invoice. */
export async function paidByOrder(ctx) {
  const map = {};
  for (const r of await paymentsTab(ctx)) {
    const oid = str(r[PAY.order_id]);
    if (!oid) continue;
    map[oid] = (map[oid] || 0) + num(r[PAY.amount]);
  }
  return map;
}

/** Append one PAYMENTS row. */
export async function addPayment(ctx, p) {
  // plan A3: the account the money landed in (or left). Decided by the payment
  // method; what is not money (Adjusted, Returned, Advance) touches no account.
  // A payment taken back leaves the account the payment went into.
  let account = p.account || await accountForMethod(ctx, p.method);
  if (!account && String(p.method) === 'Undone' && p.order) {
    const last = await ctx.tx`select account_id from payments where business_id = ${ctx.biz} and invoice_no = ${p.order}
                              and account_id is not null and amount > 0 order by paid_at desc limit 1`;
    account = last[0] ? last[0].account_id : null;
  }
  await ctx.tx`
    insert into payments (business_id, payment_no, invoice_no, customer, customer_key,
                          paid_at, amount, method, note, recorded_by, account_id)
    values (${ctx.biz}, ${p.id}, ${p.order || null}, ${p.customer || null}, ${p.key || null},
            ${p.at || new Date()}, ${round2(p.amount)}, ${p.method || null}, ${p.note || ''},
            ${p.by || who(ctx)}, ${account || null})`;
  forget(ctx, 'PAYMENTS');
}

/**
 * erpSyncInvoiceStatus_: write the invoice's own paid/due/status back so it
 * agrees with the ledger (ledger only, as the original does).
 */
export async function syncInvoiceStatus(ctx, orderId) {
  const paid = await paidByOrder(ctx);
  const rows = await ctx.tx`
    select id, invoice_no, grand_total, paid_outside from invoices
    where business_id = ${ctx.biz} ${orderId ? ctx.tx`and invoice_no = ${String(orderId)}` : ctx.tx``}`;
  for (const r of rows) {
    // the ledger plus what was paid before the ERP (119_paid_outside.sql): a payment or a return recorded later must
    // never wipe the sheet's "paid" and show the whole sale as due again
    const got = round2((paid[r.invoice_no] || 0) + num(r.paid_outside));
    const due = Math.max(0, round2(num(r.grand_total) - got));
    const status = due <= 0.5 ? 'Paid' : (got > 0 ? 'Partial' : 'Pending');
    await ctx.tx`update invoices set advance_paid = ${got}, due_amount = ${due},
                 payment_status = ${status} where id = ${r.id}`;
  }
  forget(ctx, 'SALES_LOG');
  if (orderId) {
    const J = await import('./joint.js');
    if (await J.jointOn(ctx)) await J.syncJoint(ctx, String(orderId));
    // Stage N6: the invoice's points follow what was paid (never stops a payment)
    try { await (await import('./loyalty.js')).pointsSync(ctx, String(orderId)); } catch (e) { console.error('points', e); }
  }
}

// ------------------------------------------------------- legacy split orders

/** erpSameOrder_: ORD-<ms> ids that are really one sale. */
export function sameOrder(rows) {
  const groups = {}, map = {};
  for (const r of rows) {
    const oid = str(r[0]);
    if (!/^ORD-\d+$/.test(oid)) continue;
    const at = Number(oid.slice(4));
    if (!isFinite(at)) continue;
    const key = str(r[2]).toLowerCase() + '|' + str(r[3]) + '|' + num(r[16]);
    (groups[key] || (groups[key] = [])).push({ id: oid, at });
  }
  for (const k of Object.keys(groups)) {
    const list = groups[k].sort((a, b) => a.at - b.at);
    let head = list[0];
    for (const x of list) {
      if (x.at - head.at > 300000) head = x;
      map[x.id] = head.id;
    }
  }
  return map;
}

// ---------------------------------------------------------------- dues

/** erpCreditMap_: money held on account, per customer key. */
export async function creditMap(ctx) {
  const out = {};
  for (const r of await paymentsTab(ctx)) {
    if (str(r[PAY.order_id])) continue;
    const m = /\[acct:([^\]]+)\]/.exec(String(r[PAY.note] || ''));
    if (!m) continue;
    out[m[1]] = (out[m[1]] || 0) + num(r[PAY.amount]);
  }
  for (const k of Object.keys(out)) out[k] = round2(out[k]);
  return out;
}

/** erpCreditOf_ */
export async function creditOf(ctx, key) {
  let total = 0;
  for (const r of await paymentsTab(ctx)) {
    if (str(r[PAY.order_id])) continue;
    const m = /\[acct:([^\]]+)\]/.exec(String(r[PAY.note] || ''));
    if (!m || m[1] !== key) continue;
    total += num(r[PAY.amount]);
  }
  return round2(total);
}

/** erpLastReminded_ */
async function lastReminded(ctx) {
  const rows = await ctx.tx`select reminded_at, customer_key, reminded_by from due_reminders
                            where business_id = ${ctx.biz}`;
  const out = {}, now = ctx.now.getTime();
  for (const r of rows) {
    const d = asDate(r.reminded_at), k = str(r.customer_key);
    if (!d || !k) continue;
    if (!out[k] || out[k].ts < d.getTime()) {
      out[k] = { ts: d.getTime(), at: formatDate(d, 'd MMM'), by: str(r.reminded_by),
                 days: Math.floor((now - d.getTime()) / 86400000) };
    }
  }
  return out;
}

/** erpDues: who owes what (ERP:5004). */
export async function erpDues(ctx) {
  const rows = await salesLog(ctx);
  if (!rows.length) return { customers: [], invoices: [], total: 0, count: 0, oldestDays: 0 };
  const paid = await paidByOrder(ctx);
  const same = sameOrder(rows);

  const inv = {}, order = [];
  for (const r of rows) {
    const oid = str(r[SL.order_id]);
    if (!oid) continue;
    const key = same[oid] || oid;
    let o = inv[key];
    if (!o) {
      o = inv[key] = { id: key, ids: [], when: asDate(r[SL.timestamp]),
                       customer: str(r[SL.customer_name]) || 'Walk-in',
                       phone: str(r[SL.customer_contact]),
                       method: str(r[SL.payment_method]),
                       grand: 0, settled: false, onSheet: 0 };
      order.push(key);
    }
    if (o.ids.indexOf(oid) < 0) o.ids.push(oid);
    o.grand = Math.max(o.grand, num(r[SL.grand_total]));
    o.onSheet = Math.max(o.onSheet, num(r[SL.advance_paid]));
    if (str(r[SL.payment_status]).toLowerCase() === 'paid') o.settled = true;
  }

  const today = ctx.now;
  const out = [], byCustomer = {}, custOrder = [];
  let total = 0, oldest = 0;
  for (const k of order) {
    const it = inv[k];
    let got = 0;
    for (const id of it.ids) got += paid[id] || 0;
    got = Math.max(got, it.onSheet);
    const due = it.settled ? 0 : round2(it.grand - got);
    if (due <= 0.5) continue;

    const age = it.when ? Math.round((today.getTime() - it.when.getTime()) / 86400000) : 0;
    if (age > oldest) oldest = age;
    total += due;
    out.push({ id: it.id, customer: it.customer, phone: it.phone, method: it.method,
               grand: it.grand, paid: got, due, days: age,
               when: it.when ? formatDate(it.when, 'd MMM yy') : '' });

    const ck = (it.phone || it.customer).toLowerCase();
    let c = byCustomer[ck];
    if (!c) { c = byCustomer[ck] = { customer: it.customer, phone: it.phone, due: 0, invoices: 0, oldest: 0 }; custOrder.push(ck); }
    c.due += due; c.invoices++;
    if (age > c.oldest) c.oldest = age;
  }

  out.sort((a, b) => b.days - a.days);
  const cust = custOrder.map((k) => byCustomer[k]);
  cust.sort((a, b) => b.due - a.due);

  const credit = await creditMap(ctx);
  let reminded = {};
  try { reminded = await lastReminded(ctx); } catch (_) { /* as original */ }
  const byKey = {};
  for (const c of cust) {
    const bk = custKey(c.phone, c.customer);
    if (!bk || bk === 'n:') continue;
    byKey[bk] = { due: Math.round(c.due), credit: 0, reminded: reminded[bk] || null,
                  invoices: c.invoices, oldest: c.oldest };
  }
  for (const ck of Object.keys(credit)) {
    if (!(credit[ck] > 0.5)) continue;
    if (byKey[ck]) byKey[ck].credit = Math.round(credit[ck]);
    else byKey[ck] = { due: 0, credit: Math.round(credit[ck]), invoices: 0, oldest: 0 };
  }

  return { customers: cust, invoices: out, byKey, total: Math.round(total),
           count: out.length, oldestDays: oldest };
}

/** erpOutstanding_: what one invoice still owes (ERP:6071). */
export async function outstanding(ctx, invoiceNo) {
  const rows = await salesLog(ctx);
  let grand = 0, found = false, customer = '', phone = '', address = '', onSheet = 0, settled = false;
  for (const r of rows) {
    if (str(r[SL.order_id]) !== invoiceNo) continue;
    found = true;
    if (str(r[SL.payment_status]).toLowerCase() === 'paid') settled = true;
    grand = Math.max(grand, num(r[SL.grand_total]));
    onSheet = Math.max(onSheet, num(r[SL.advance_paid]));
    if (!customer) customer = str(r[SL.customer_name]);
    if (!phone) phone = str(r[SL.customer_contact]);
    if (!address) address = str(r[SL.customer_address]);
  }
  if (!found) return null;
  let paid = Math.max((await paidByOrder(ctx))[invoiceNo] || 0, onSheet);
  if (settled) paid = Math.max(paid, grand);
  return { invoiceNo, grand: Math.round(grand), paid: Math.round(paid),
           owed: Math.max(0, round2(grand - paid)), customer, phone, address };
}

// ------------------------------------------------------- customer account

/** erpCustomerAccount (ERP:5165) */
export async function erpCustomerAccount(ctx, payload) {
  const phone = str(payload && payload.phone);
  const name = str(payload && payload.name);
  const want = custKey(phone, name);
  if (!want || want === 'n:') return { customer: name, balance: 0, invoices: [] };

  const dues = await erpDues(ctx);
  const mine = [];
  let balance = 0, whoName = name;
  for (const v of dues.invoices) {
    if (custKey(v.phone, v.customer) !== want) continue;
    mine.push(v);
    balance += v.due;
    if (!whoName) whoName = v.customer;
  }
  mine.sort((a, b) => b.days - a.days);
  let credit = 0;
  try { credit = await creditOf(ctx, want); } catch (_) { /* as original */ }
  return { customer: whoName || name, phone, balance: Math.round(balance), credit,
           invoices: mine, count: mine.length };
}

export async function erpCustomerCredit(ctx, payload) {
  const key = custKey(str(payload && payload.phone), str(payload && payload.name));
  if (!key || key === 'n:') return { credit: 0 };
  return { credit: await creditOf(ctx, key) };
}

/** erpPayReasons: which adjustments this person may make. */
export async function erpPayReasons(ctx) {
  const out = [];
  for (const k of Object.keys(ERP_PAY_REASONS)) {
    const r = ERP_PAY_REASONS[k];
    if (!roleAtLeast(ctx.s.role, r.minRole)) continue;
    out.push({ id: k, label: r.label, money: r.money });
  }
  return out;
}

/** erpSettleDue (ERP:5201) */
export async function erpSettleDue(ctx, payload) {
  payload = payload || {};
  let reason = String(payload.reason || 'payment').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ERP_PAY_ALIAS, reason)) reason = ERP_PAY_ALIAS[reason];
  const rule = ERP_PAY_REASONS[reason];
  if (!rule) throw new Error('What kind of adjustment is this?');
  if (!roleAtLeast(ctx.s.role, rule.minRole)) {
    throw new Error(rule.label + ' is not something your account can do. Ask the owner.');
  }
  const amount = num(payload.amount);
  if (!(amount > 0)) throw new Error('How much?');
  const note = str(payload.note);
  if (!rule.money && !note) {
    throw new Error(rule.label + ' needs a note saying why, so the books can be explained later.');
  }
  if (rule.increases) return undoPayment(ctx, payload, amount, note);

  let targets = [];
  if (payload.orderId) {
    const dues = await erpDues(ctx);
    const hit = dues.invoices.find((d) => d.id === String(payload.orderId).trim());
    if (!hit) throw new Error('That invoice has nothing outstanding.');
    targets = [hit];
  } else {
    const acct = await erpCustomerAccount(ctx, payload);
    targets = acct.invoices;
    if (!targets.length) throw new Error('That customer owes nothing.');
  }
  let owed = 0;
  for (const t of targets) owed += t.due;
  owed = round2(owed);
  if (amount > owed + 0.5) {
    throw new Error('That is more than is owed. The balance is ' + owed.toFixed(0) + '.');
  }

  await lock(ctx, 'payments');
  let left = amount;
  const touched = [], now = new Date();
  for (let k = 0; k < targets.length && left > 0.004; k++) {
    const bite = Math.min(left, targets[k].due);
    await addPayment(ctx, {
      id: 'P' + stamp(now) + '-' + k, order: targets[k].id, customer: targets[k].customer, at: now,
      amount: round2(bite), method: rule.money ? String(payload.method || 'Cash') : 'Adjusted',
      note: (note ? note + ' ' : '') + '[' + reason + ']',
    });
    touched.push({ id: targets[k].id, applied: round2(bite) });
    left = round2(left - bite);
  }
  for (const t of touched) await syncInvoiceStatus(ctx, t.id);

  const after = payload.orderId ? null : await erpCustomerAccount(ctx, payload);
  return { ok: true, reason, label: rule.label, amount, applied: touched,
           balance: after ? after.balance : null, dues: await erpDues(ctx) };
}

/** erpUndoPayment_ (ERP:5418) */
async function undoPayment(ctx, payload, amount, note) {
  const rows = await salesLog(ctx);
  if (!rows.length) throw new Error('This sheet has no SALES_LOG.');
  const paid = await paidByOrder(ctx);
  const want = payload.orderId ? String(payload.orderId).trim() : '';
  const key = custKey(String(payload.phone || ''), String(payload.name || ''));
  const seen = {}, mine = [];
  for (const r of rows) {
    const oid = str(r[SL.order_id]);
    if (!oid || seen[oid]) continue;
    seen[oid] = true;
    if (want) { if (oid !== want) continue; }
    else if (custKey(String(r[SL.customer_contact] || ''), String(r[SL.customer_name] || '')) !== key) continue;
    const got = paid[oid] || 0;
    if (got <= 0) continue;
    mine.push({ id: oid, customer: str(r[SL.customer_name]), when: asDate(r[SL.timestamp]), paid: got });
  }
  if (!mine.length) {
    throw new Error(want ? 'No payment has been recorded against ' + want + '.'
      : 'No payment has been recorded for that customer, so there is nothing to undo.');
  }
  mine.sort((a, b) => (b.when ? b.when.getTime() : 0) - (a.when ? a.when.getTime() : 0));
  let available = 0;
  for (const m of mine) available += m.paid;
  available = round2(available);
  if (amount > available + 0.5) {
    throw new Error('Only ' + available.toFixed(0) + ' has been recorded as paid' +
      (want ? ' on ' + want : '') + ', so no more than that can be taken back.');
  }

  await lock(ctx, 'payments');
  let left = amount;
  const touched = [], now = new Date();
  for (let k = 0; k < mine.length && left > 0.004; k++) {
    const bite = Math.min(left, mine[k].paid);
    await addPayment(ctx, {
      id: 'U' + stamp(now) + '-' + k, order: mine[k].id, customer: mine[k].customer, at: now,
      amount: -round2(bite), method: 'Undone', note: note + ' [increase]',
    });
    touched.push({ id: mine[k].id, applied: round2(bite) });
    left = round2(left - bite);
  }
  for (const t of touched) await syncInvoiceStatus(ctx, t.id);
  const after = payload.orderId ? null : await erpCustomerAccount(ctx, { phone: payload.phone, name: payload.name });
  return { ok: true, reason: 'increase', label: 'Increase the due', amount, applied: touched,
           balance: after ? after.balance : null, dues: await erpDues(ctx) };
}

/** erpTakeAdvance (ERP:5342): money for goods that do not exist yet. */
export async function erpTakeAdvance(ctx, payload) {
  payload = payload || {};
  if (!callAllowed(ctx.s, 'erpTakeAdvance')) throw new Error('Your account cannot take payments.');
  const amount = num(payload.amount);
  if (!(amount > 0)) throw new Error('How much was received?');
  const phone = str(payload.phone), name = str(payload.name);
  const key = custKey(phone, name);
  if (!key || key === 'n:') throw new Error('Whose advance is this?');
  await lock(ctx, 'payments');
  await addPayment(ctx, {
    id: 'A' + stamp(), order: '', customer: name || phone, key, amount,
    method: String(payload.method || 'Cash'),
    note: (str(payload.note) + ' [advance] [acct:' + key + ']').trim(),
  });
  return { ok: true, amount, credit: await creditOf(ctx, key),
           account: await erpCustomerAccount(ctx, { phone, name }) };
}

/** erpApplyCredit_: spend a customer's credit on one invoice. */
export async function applyCredit(ctx, key, customer, orderId, upTo) {
  const have = await creditOf(ctx, key);
  const use = Math.min(have, upTo);
  if (!(use > 0)) return 0;
  const now = new Date(), st = stamp(now);
  await addPayment(ctx, { id: 'C' + st, order: orderId, customer, at: now, amount: use,
                          method: 'Advance', note: 'advance used [applied]' });
  await addPayment(ctx, { id: 'C' + st + '-r', order: '', customer, key, at: now, amount: -use,
                          method: 'Advance', note: 'applied to ' + orderId + ' [acct:' + key + ']' });
  return use;
}

// ------------------------------------------------------------- discounts

/** erpDiscLeft_: the part of an invoice discount not already inside the line totals. */
export function discLeft(discount, gross, sum) {
  if (!(discount > 0)) return 0;
  const inside = Math.max(0, num(gross) - num(sum));
  return Math.max(0, discount - inside);
}

/** erpInvoiceDiscounts_ (ERP:10775): each line's discount in whole taka. */
export function invoiceDiscounts(items, bySku, invoiceDiscount) {
  const line = [], base = [];
  let sub = 0, itemDisc = 0, netSum = 0;
  for (const it of items) {
    const rec = bySku[String(it.sku).trim().toLowerCase()];
    const q = num(it.qty), gross = q * (rec ? num(rec.sell) : 0);
    const each = num(it.discEach);
    let own = each > 0 ? each * q : num(it.discount);
    if (own < 0) own = 0;
    if (own > gross + 0.001) {
      throw new Error((rec ? rec.name : it.sku) + ': the discount is larger than the price.');
    }
    own = round2(own);
    line.push(own); base.push(Math.max(0, gross - own));
    sub += gross; itemDisc += own; netSum += Math.max(0, gross - own);
  }
  const inv = Math.round(Math.max(0, num(invoiceDiscount)));
  if (inv > netSum + 0.001) throw new Error('The invoice discount is larger than the goods.');
  if (inv > 0 && netSum > 0) {
    let given = 0;
    const share = base.map((b) => Math.min(Math.floor(b), Math.floor(inv * b / netSum)));
    share.forEach((x) => { given += x; });
    const order = base.map((b, ix) => ix).sort((a, b) => base[b] - base[a]);
    for (let guard = 0; given < inv && guard < 100000; guard++) {
      let moved = false;
      for (let o = 0; o < order.length && given < inv; o++) {
        if (share[order[o]] + 1 <= base[order[o]]) { share[order[o]]++; given++; moved = true; }
      }
      if (!moved) break;
    }
    for (let s = 0; s < line.length; s++) line[s] = round2(line[s] + share[s]);
  }
  return { line, sub, itemDisc, invDisc: inv };
}
