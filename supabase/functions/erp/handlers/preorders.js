// Pre-orders with advances (FilaDash merge; supabase/115_preorders.sql).
//
//   erpPreorders        the list: each pre-order with what is paid, what is still to pay, and whether its goods are on the
//                       shelf (stock goes to the oldest open pre-orders first - "Ready")
//   erpPreorderSave     a new pre-order (customer, lines at agreed prices, the deposit taken now)
//   erpPreorderPay      more deposit
//   erpPreorderLink     give a line that was a free-typed model its product (before it can be handed over)
//   erpPreorderFulfil   hand it over: an invoice at the agreed prices, paid by the deposit (customer credit)
//   erpPreorderCancel   cancel: pay the deposit back, or (owner, with a reason) keep it - then it is income of the month

import { str } from '../lib/tabs.js';
import { num, round2, formatDate } from '../lib/time.js';
import { custKey } from '../lib/phone.js';
import { addPayment, lock, creditOf } from './money.js';
import { roleAtLeast } from '../allow.js';

const R = (v) => Math.round(num(v));
const stamp = () => formatDate(new Date(), 'yyMMddHHmmss') + String(Math.floor(Math.random() * 900) + 100);
const who = (ctx) => str(ctx.s && ctx.s.name) || 'User';

/** The deposit paid towards one pre-order (its payments, refunds and forfeits). */
async function paidOn(ctx, no) {
  const r = await ctx.tx`select coalesce(sum(amount), 0) as s from payments where business_id = ${ctx.biz} and invoice_no is null
                         and note like ${'%[preorder:' + no + ']%'} and method <> 'Advance'`;
  return round2(num(r[0].s));
}

export async function erpPreorders(ctx, payload) {
  const all = !!(payload && payload.all);
  const heads = await ctx.tx`select * from preorders where business_id = ${ctx.biz}
                             ${all ? ctx.tx`` : ctx.tx`and (status = 'open' or closed_at > now() - interval '60 days')`} order by created_at`;
  const lines = await ctx.tx`select l.*, p.name as pname from preorder_lines l left join products p on p.business_id = l.business_id and lower(btrim(p.sku)) = lower(btrim(l.sku))
                             where l.business_id = ${ctx.biz} order by l.line_no`;
  const stock = {};
  for (const r of await ctx.tx`select lower(btrim(p.sku)) as k, ps.stock from products p join product_stock ps on ps.product_id = p.id where p.business_id = ${ctx.biz}`) stock[r.k] = num(r.stock);
  const pays = {};
  for (const r of await ctx.tx`select substring(note from '\\[preorder:([^\\]]+)\\]') as no, sum(amount) as s from payments
                               where business_id = ${ctx.biz} and invoice_no is null and note like '%[preorder:%' and method <> 'Advance' group by 1`) pays[str(r.no)] = num(r.s);
  const left = { ...stock };                       // the oldest open pre-orders take the stock first
  const out = heads.map((h) => {
    const mine = lines.filter((l) => l.preorder_id === h.id);
    const total = round2(mine.reduce((t, l) => t + num(l.qty) * num(l.price), 0));
    let ready = h.status === 'open' && mine.length > 0;
    const items = mine.map((l) => {
      const k = str(l.sku).toLowerCase();
      let have = false;
      if (h.status === 'open' && k) { have = (left[k] || 0) >= num(l.qty); if (have) left[k] -= num(l.qty); }
      if (!have) ready = false;
      return { sku: str(l.sku), name: str(l.pname) || str(l.name), qty: num(l.qty), price: num(l.price), onShelf: have, needsProduct: !k };
    });
    const paid = round2(pays[str(h.no)] || 0);
    return { id: h.id, no: str(h.no), customer: str(h.customer), phone: str(h.phone), status: h.status, ready, eta: h.eta ? formatDate(new Date(h.eta), 'd MMM yyyy') : '',
             created: formatDate(new Date(h.created_at), 'd MMM yyyy'), note: str(h.note), items, total, paid, toPay: round2(Math.max(0, total - paid)),
             invoice: str(h.invoice_no), cancelReason: str(h.cancel_reason), refunded: num(h.refunded), forfeited: num(h.forfeited) };
  });
  const open = out.filter((x) => x.status === 'open');
  return { currency: 'BDT', preorders: out.reverse(),
           totals: { open: open.length, ready: open.filter((x) => x.ready).length, held: R(open.reduce((t, x) => t + x.paid, 0)), value: R(open.reduce((t, x) => t + x.total, 0)) } };
}

export async function erpPreorderSave(ctx, payload) {
  payload = payload || {};
  const name = str(payload.customer && payload.customer.name), phone = str(payload.customer && payload.customer.phone);
  const key = custKey(phone, name);
  if (!name && !phone) throw new Error('Whose pre-order is it?');
  if (!key || key === 'n:') throw new Error('Whose pre-order is it?');
  const raw = Array.isArray(payload.lines) ? payload.lines : [];
  if (!raw.length) throw new Error('What are they ordering?');
  const lines = [];
  for (const l of raw) {
    const qty = num(l.qty), price = num(l.price), sku = str(l.sku);
    let nm = str(l.name);
    if (!(qty > 0)) throw new Error('Each line needs a quantity.');
    if (price < 0) throw new Error('A price cannot be negative.');
    if (sku) {
      const p = (await ctx.tx`select name, sell_price from products where business_id = ${ctx.biz} and lower(btrim(sku)) = ${sku.toLowerCase()}`)[0];
      if (!p) throw new Error('Product not found: ' + sku);
      nm = nm || str(p.name);
      lines.push({ sku, name: nm, qty, price: price > 0 ? price : num(p.sell_price) });
    } else {
      if (!nm) throw new Error('Name the model they are ordering.');
      if (!(price > 0)) throw new Error('Agree a price for ' + nm + '.');
      lines.push({ sku: null, name: nm.slice(0, 160), qty, price });
    }
  }
  const advance = round2(num(payload.advance));
  if (advance < 0) throw new Error('A deposit cannot be negative.');
  const total = round2(lines.reduce((t, l) => t + l.qty * l.price, 0));
  if (advance > total + 0.5) throw new Error('The deposit is more than the order (' + total + ').');
  const eta = str(payload.eta);
  if (eta && !/^\d{4}-\d{2}-\d{2}$/.test(eta)) throw new Error('The expected date looks wrong.');
  await lock(ctx, 'payments');
  const n = (await ctx.tx`select count(*)::int as n from preorders where business_id = ${ctx.biz}`)[0].n + 1;
  const no = 'PRE-' + formatDate(ctx.now, 'yyMMdd') + '-' + String(n).padStart(3, '0');
  const h = (await ctx.tx`insert into preorders (business_id, no, customer, phone, customer_key, eta, note, created_by)
                          values (${ctx.biz}, ${no}, ${name || phone}, ${phone || null}, ${key}, ${eta || null}, ${str(payload.note).slice(0, 300) || null}, ${who(ctx)}) returning id`)[0];
  let i = 0;
  for (const l of lines) await ctx.tx`insert into preorder_lines (business_id, preorder_id, sku, name, qty, price, line_no)
                                      values (${ctx.biz}, ${h.id}, ${l.sku}, ${l.name}, ${l.qty}, ${l.price}, ${++i})`;
  if (advance > 0) await deposit(ctx, { no, key, customer: name || phone, amount: advance, method: payload.method });
  return { ok: true, no, total, advance, list: await erpPreorders(ctx) };
}

async function deposit(ctx, d) {
  await addPayment(ctx, { id: 'A' + stamp(), order: '', customer: d.customer, key: d.key, amount: d.amount, method: str(d.method) || 'Cash',
                          note: ('deposit for pre-order ' + d.no + ' [advance] [preorder:' + d.no + '] [acct:' + d.key + ']') });
}

async function one(ctx, id) {
  const h = (await ctx.tx`select * from preorders where business_id = ${ctx.biz} and (id::text = ${str(id)} or no = ${str(id)})`)[0];
  if (!h) throw new Error('That pre-order is not there.');
  return h;
}

export async function erpPreorderPay(ctx, payload) {
  const h = await one(ctx, payload && payload.id);
  if (h.status !== 'open') throw new Error('That pre-order is closed.');
  const amount = round2(num(payload.amount));
  if (!(amount > 0)) throw new Error('How much did they pay?');
  await lock(ctx, 'payments');
  await deposit(ctx, { no: h.no, key: h.customer_key, customer: h.customer, amount, method: payload.method });
  return erpPreorders(ctx);
}

export async function erpPreorderLink(ctx, payload) {
  const h = await one(ctx, payload && payload.id);
  if (h.status !== 'open') throw new Error('That pre-order is closed.');
  const sku = str(payload.sku);
  const p = (await ctx.tx`select sku from products where business_id = ${ctx.biz} and lower(btrim(sku)) = ${sku.toLowerCase()}`)[0];
  if (!p) throw new Error('Product not found: ' + sku);
  const r = await ctx.tx`update preorder_lines set sku = ${str(p.sku)} where preorder_id = ${h.id} and line_no = ${Math.round(num(payload.line))} returning id`;
  if (!r.length) throw new Error('That line is not there.');
  return erpPreorders(ctx);
}

export async function erpPreorderFulfil(ctx, payload) {
  const h = await one(ctx, payload && payload.id);
  if (h.status !== 'open') throw new Error('That pre-order is closed.');
  const list = await erpPreorders(ctx);
  const me = list.preorders.find((x) => x.id === h.id);
  if (me.items.some((l) => l.needsProduct)) throw new Error('Give every line its product first (a model typed by name has no stock).');
  if (!me.ready) throw new Error('Not all of it is on the shelf yet (older pre-orders get the stock first).');
  const { createInvoice } = await import('./invoice.js');
  const res = await createInvoice(ctx, {
    customer: { name: h.customer, phone: str(h.phone), address: str(payload.address) },
    items: me.items.map((l) => ({ sku: l.sku, qty: l.qty })),
    payMode: 'none', deliveryCharge: num(payload.deliveryCharge), note: 'pre-order ' + h.no,
  }, { agreed: me.items.map((l) => l.price) });
  await ctx.tx`update preorders set status = 'done', invoice_no = ${res.invoiceNo}, closed_at = now() where id = ${h.id}`;
  return { ok: true, invoiceNo: res.invoiceNo, grandTotal: res.grandTotal, paidByDeposit: res.creditUsed, due: round2(res.grandTotal - res.creditUsed), list: await erpPreorders(ctx) };
}

export async function erpPreorderCancel(ctx, payload) {
  payload = payload || {};
  const h = await one(ctx, payload.id);
  if (h.status !== 'open') throw new Error('That pre-order is closed.');
  const reason = str(payload.reason);
  if (!reason) throw new Error('Say why it is cancelled.');
  const mode = str(payload.mode) === 'forfeit' ? 'forfeit' : 'refund';
  if (mode === 'forfeit' && ctx.s.role !== 'owner') throw new Error('Only the owner can keep a deposit.');
  if (mode === 'refund' && !roleAtLeast(ctx.s.role, 'manager')) throw new Error('Your account cannot pay money back.');
  await lock(ctx, 'payments');
  const paid = await paidOn(ctx, h.no);
  const credit = await creditOf(ctx, h.customer_key);
  const amount = round2(Math.min(paid, credit));      // what is still held for them (never more than their credit)
  if (amount > 0) {
    await addPayment(ctx, { id: 'R' + stamp(), order: '', customer: h.customer, key: h.customer_key, amount: -amount,
                            method: mode === 'forfeit' ? 'Forfeited' : (str(payload.method) || 'Cash'),
                            note: (mode === 'forfeit' ? 'deposit kept: ' : 'deposit paid back: ') + reason + ' [advance] [preorder:' + h.no + '] [acct:' + h.customer_key + ']' });
  }
  await ctx.tx`update preorders set status = 'cancelled', cancel_reason = ${reason.slice(0, 200)}, closed_at = now(),
               refunded = ${mode === 'refund' ? amount : 0}, forfeited = ${mode === 'forfeit' ? amount : 0},
               forfeit_month = ${mode === 'forfeit' && amount > 0 ? formatDate(ctx.now, 'yyyy-MM') : null} where id = ${h.id}`;
  Object.keys(ctx.memo).forEach((k) => { if (k.indexOf('pnl:') === 0) delete ctx.memo[k]; });
  return { ok: true, mode, amount, list: await erpPreorders(ctx) };
}

export const HANDLERS = { erpPreorders, erpPreorderSave, erpPreorderPay, erpPreorderLink, erpPreorderFulfil, erpPreorderCancel };
