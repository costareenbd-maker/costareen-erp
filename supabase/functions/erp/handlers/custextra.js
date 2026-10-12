// Customer extras (FilaDash merge, Customers; supabase/116_customer_extras.sql).
//
//   erpFollowups / erpFollowupSave / erpFollowupDone   follow-ups: call a customer on a day about something; done with what came of it
//   erpCustomerInsight   one customer at a glance: favourite colour, brand and product, first and last purchase, days since,
//                        orders, spent, average order, how they first came (source)
//   erpCustomerErase     owner: remove a customer's personal data on their request (name, phone, address, e-mail everywhere),
//                        amounts kept; refused while they owe money, hold credit or have an open pre-order

import { str } from '../lib/tabs.js';
import { num, formatDate } from '../lib/time.js';
import { custKey } from '../lib/phone.js';
import { creditOf } from './money.js';

const R = (v) => Math.round(num(v));
const who = (ctx) => str(ctx.s && ctx.s.name) || 'User';
const digits = (p) => String(p == null ? '' : p).replace(/\D/g, '').slice(-10);

async function findCustomer(ctx, payload) {
  const phone = str(payload && payload.phone), key0 = str(payload && payload.key), name = str(payload && payload.name);
  const key = key0 || custKey(phone, name);
  if (!key || key === 'n:') throw new Error('Which customer?');
  const c = (await ctx.tx`select name, phone, customer_key from customers where business_id = ${ctx.biz}
                          and (customer_key = ${key} or (${digits(phone)} <> '' and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${digits(phone)}))
                          order by created_at limit 1`)[0];
  return { key: c ? str(c.customer_key) || key : key, name: c ? str(c.name) : (name || phone), phone: c ? str(c.phone) : phone };
}

// ------------------------------------------------------------------ follow-ups

export async function erpFollowups(ctx, payload) {
  const all = !!(payload && payload.all);
  const rows = await ctx.tx`select * from customer_followups where business_id = ${ctx.biz} ${all ? ctx.tx`` : ctx.tx`and (status = 'open' or done_at > now() - interval '30 days')`}
                            ${payload && payload.key ? ctx.tx`and customer_key = ${str(payload.key)}` : ctx.tx``} order by status, due_on, at`;
  const today = formatDate(ctx.now, 'yyyy-MM-dd');
  const list = rows.map((r) => {
    const due = formatDate(new Date(r.due_on), 'yyyy-MM-dd');
    return { id: r.id, key: str(r.customer_key), customer: str(r.customer), phone: str(r.phone), due, dueLabel: formatDate(new Date(r.due_on), 'd MMM yyyy'),
             overdue: r.status === 'open' && due < today, today: r.status === 'open' && due === today, note: str(r.note), status: r.status,
             outcome: str(r.outcome), by: str(r.by), doneBy: str(r.done_by), doneAt: r.done_at ? formatDate(new Date(r.done_at), 'd MMM yyyy') : '' };
  });
  const open = list.filter((x) => x.status === 'open');
  return { followups: list, totals: { open: open.length, overdue: open.filter((x) => x.overdue).length, today: open.filter((x) => x.today).length } };
}

export async function erpFollowupSave(ctx, payload) {
  payload = payload || {};
  const c = await findCustomer(ctx, payload);
  const due = str(payload.due);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('When should someone follow up?');
  const note = str(payload.note).slice(0, 300);
  if (!note) throw new Error('What is it about?');
  await ctx.tx`insert into customer_followups (business_id, customer_key, customer, phone, due_on, note, by)
               values (${ctx.biz}, ${c.key}, ${c.name || c.phone || 'Customer'}, ${c.phone || null}, ${due}, ${note}, ${who(ctx)})`;
  return erpFollowups(ctx, {});
}

export async function erpFollowupDone(ctx, payload) {
  const r = await ctx.tx`update customer_followups set status = 'done', outcome = ${str(payload && payload.outcome).slice(0, 300) || null}, done_by = ${who(ctx)}, done_at = now()
                         where business_id = ${ctx.biz} and id::text = ${str(payload && payload.id)} and status = 'open' returning id`;
  if (!r.length) throw new Error('That follow-up is not open.');
  return erpFollowups(ctx, {});
}

// ------------------------------------------------------------------ one customer at a glance

export async function erpCustomerInsight(ctx, payload) {
  const c = await findCustomer(ctx, payload);
  const d = digits(c.phone);
  const lines = await ctx.tx`
    select i.invoice_no, i.created_at, i.grand_total, i.source, l.qty, l.line_total, p.color, p.brand, coalesce(p.name, l.name) as pname
    from invoices i join invoice_lines l on l.invoice_id = i.id left join products p on p.id = l.product_id
    where i.business_id = ${ctx.biz} and i.voided_at is null and i.invoice_no not like 'RTN-%' and l.qty > 0
      and (i.customer_key = ${c.key} or (${d} <> '' and right(regexp_replace(coalesce(i.customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${d}))
    order by i.created_at`;
  const tally = (f) => { const m = {}; for (const l of lines) { const k = str(l[f]); if (k) m[k] = (m[k] || 0) + num(l.qty); } const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0]; return top ? { name: top[0], units: R(top[1]) } : null; };
  const inv = {};
  for (const l of lines) inv[l.invoice_no] = { at: l.created_at, total: num(l.grand_total), source: str(l.source) };
  const list = Object.values(inv).sort((a, b) => new Date(a.at) - new Date(b.at));
  const spent = list.reduce((t, x) => t + x.total, 0);
  const last = list.length ? new Date(list[list.length - 1].at) : null;
  return { key: c.key, name: c.name, phone: c.phone, orders: list.length, spent: R(spent), avgOrder: list.length ? R(spent / list.length) : 0,
           first: list.length ? formatDate(new Date(list[0].at), 'd MMM yyyy') : '', last: last ? formatDate(last, 'd MMM yyyy') : '',
           daysSince: last ? Math.floor((ctx.now.getTime() - last.getTime()) / 864e5) : null, firstSource: list.length ? list[0].source || 'Walk-in' : '',
           favouriteColour: tally('color'), favouriteBrand: tally('brand'), favouriteProduct: tally('pname'),
           followups: (await erpFollowups(ctx, { key: c.key, all: true })).followups };
}

// ------------------------------------------------------------------ removing a customer's personal data

export async function erpCustomerErase(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner removes a customer’s personal data.');
  payload = payload || {};
  const reason = str(payload.reason).slice(0, 200);
  if (!reason) throw new Error('Say why (for example: the customer asked on 13 Oct by phone).');
  const c = await findCustomer(ctx, payload);
  const d = digits(c.phone);
  if (str(payload.confirm) !== (c.name || c.phone)) throw new Error('Type the customer’s name exactly to confirm: ' + (c.name || c.phone));
  // nothing may be left open with them: money owed either way, an open pre-order
  const { erpCustomerAccount } = await import('./money.js');
  const acc = await erpCustomerAccount(ctx, { phone: c.phone, name: c.name });
  if (Math.abs(num(acc.balance)) >= 1) throw new Error(c.name + ' still owes ' + R(acc.balance) + '. Settle it first.');
  if (Math.abs(await creditOf(ctx, c.key)) >= 1) throw new Error(c.name + ' holds credit. Pay it back or use it first.');
  const open = await ctx.tx`select no from preorders where business_id = ${ctx.biz} and customer_key = ${c.key} and status = 'open'`;
  if (open.length) throw new Error(c.name + ' has an open pre-order (' + open.map((x) => x.no).join(', ') + '). Close it first.');

  await ctx.tx`select pg_advisory_xact_lock(hashtext(${'erase:' + ctx.biz}))`;
  const n = (await ctx.tx`select count(*)::int as n from customer_erasures where business_id = ${ctx.biz}`)[0].n + 1;
  const label = 'Removed customer ' + n;
  const newKey = 'x:' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  // one protected function does every table (payments and others cannot be changed by people directly)
  const r = await ctx.tx`select public.erase_customer(${ctx.biz}, ${c.key}, ${d}, ${label}, ${newKey}) as out`;
  const changed = r[0].out || {};
  const total = Object.values(changed).reduce((t, v) => t + num(v), 0);
  await ctx.tx`insert into customer_erasures (business_id, label, reason, rows_changed, tables, by) values (${ctx.biz}, ${label}, ${reason}, ${total}, ${JSON.stringify(changed)}::jsonb, ${who(ctx)})`;
  Object.keys(ctx.memo).forEach((k) => { if (k.indexOf('tab:') === 0) delete ctx.memo[k]; });
  return { ok: true, label, rows: total, tables: changed };
}

export const HANDLERS = { erpFollowups, erpFollowupSave, erpFollowupDone, erpCustomerInsight, erpCustomerErase };
