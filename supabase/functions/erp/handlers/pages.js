// Record pages and search (redesign phase 2). These are new - the sheet ERP
// had only lists with buttons. Everything here reads; nothing writes.
//
//   erpInvoice({invoiceNo})        one invoice: lines, payments, returns, parcel, changes
//   erpCustomerPage({phone,name})  one customer: profile, figures, invoices, payments
//   erpSearch({q})                 invoices, customers and products matching a few letters
//
// Money on these pages comes from the same shared rules as every list
// (money.js: outstanding, erpDues, creditOf) so a page can never disagree
// with the list it was opened from.

import { isCourier } from './catalog.js';
import { formatDate, num, round2 } from '../lib/time.js';
import { custKey, formatBdPhone } from '../lib/phone.js';
import { outstanding, erpDues, creditOf } from './money.js';

const isReturnId = (id) => /^RTN-/.test(String(id || ''));
const str = (v) => String(v == null ? '' : v).trim();
const day = (d) => (d ? formatDate(d, 'd MMM yyyy') : '');
const dayTime = (d) => (d ? formatDate(d, 'd MMM yyyy, h:mm a') : '');
/** A payment note without its bookkeeping tags ([payment], [acct:…], [sf:…]). */
const plainNote = (n) => str(n).replace(/\s*\[[^\]]*\]/g, '').trim();

/** What a PAYMENTS row is, in words (same wording as the customer statement). */
function paymentLabel(p) {
  const m = str(p.method), amt = num(p.amount), note = str(p.note);
  if (m === 'Returned') return 'Goods returned';
  if (m === 'Adjusted') return /\[sfadj:/.test(note) ? 'Courier shortfall written off' : /cancel/.test(note) ? 'Delivery charge cancelled' : 'Adjustment';
  if (m === 'Advance') return amt >= 0 ? 'Paid from advance' : 'Moved to advance';
  if (m === 'Undone') return 'Payment taken back';
  return amt >= 0 ? 'Payment · ' + (m || 'Cash') : 'Refund · ' + (m || 'Cash');
}

/** One invoice, whole. */
export async function erpInvoice(ctx, payload) {
  const no = str(payload && payload.invoiceNo);
  if (!no) throw new Error('Which invoice?');
  if (isReturnId(no)) throw new Error('That is a return note, not a sale.');
  const inv = (await ctx.tx`select * from invoices where business_id = ${ctx.biz} and invoice_no = ${no} limit 1`)[0];
  if (!inv) throw new Error('No invoice called ' + no + '.');

  const lines = await ctx.tx`select sku, name, qty, unit_price, discount, line_total from invoice_lines
                             where business_id = ${ctx.biz} and invoice_id = ${inv.id} order by line_no, id`;
  const pays = await ctx.tx`select payment_no, paid_at, amount, method, note, recorded_by from payments
                            where business_id = ${ctx.biz} and invoice_no = ${no} order by seq`;
  const rets = await ctx.tx`select return_no, returned_at, sku, product, qty, condition, value, money, reason, recorded_by
                            from returns where business_id = ${ctx.biz} and invoice_no = ${no} order by seq`;
  const parcel = (await ctx.tx`select booked_at, consignment_id, cod_amount, booked_by, note from courier_log
                               where business_id = ${ctx.biz} and invoice_no = ${no} order by seq desc limit 1`)[0];
  const fixes = await ctx.tx`select fixed_at, field, was, now, fixed_by from invoice_fixes
                             where business_id = ${ctx.biz} and invoice_no = ${no} order by fixed_at`;

  const backBySku = {};
  let backQty = 0, backValue = 0, cancelled = false;
  for (const r of rets) {
    const k = str(r.sku).toLowerCase();
    backBySku[k] = (backBySku[k] || 0) + num(r.qty);
    backQty += num(r.qty); backValue += num(r.value);
    if (/^Invoice cancelled/.test(str(r.reason))) cancelled = true;
  }
  let units = 0, gross = 0;
  const outLines = lines.map((l) => {
    units += num(l.qty); gross += num(l.qty) * num(l.unit_price);
    return { sku: str(l.sku), product: str(l.name), qty: num(l.qty), price: num(l.unit_price),
             discount: num(l.discount), total: num(l.line_total),
             returned: backBySku[str(l.sku).toLowerCase()] || 0 };
  });
  const owe = await outstanding(ctx, no);
  const grand = num(inv.grand_total) || outLines.reduce((a, l) => a + l.total, 0);
  const byHand = !!(parcel && /\[by hand\]/.test(str(parcel.note)));

  return {
    id: no, date: day(inv.created_at), when: dayTime(inv.created_at),
    customer: str(inv.customer_name), phone: str(inv.customer_phone), address: str(inv.customer_address),
    delivery: str(inv.source), method: str(inv.payment_method), status: str(inv.payment_status),
    note: plainNote(inv.note), webOrder: str(inv.web_order_no),
    lines: outLines, units,
    subtotal: Math.round(gross), discount: Math.round(num(inv.discount)),
    deliveryCharge: Math.round(num(inv.delivery_charge)), grand: Math.round(grand),
    paid: owe ? owe.paid : 0, owed: owe ? Math.round(owe.owed) : 0,
    returnedQty: backQty, returnedValue: Math.round(backValue),
    allBack: units > 0 && backQty >= units, cancelled,
    payments: pays.map((p) => ({ id: str(p.payment_no), when: dayTime(p.paid_at), amount: num(p.amount),
                                 label: paymentLabel(p), note: plainNote(p.note), by: str(p.recorded_by) })),
    returns: rets.map((r) => ({ id: str(r.return_no), when: dayTime(r.returned_at), product: str(r.product),
                                qty: num(r.qty), condition: str(r.condition), value: Math.round(num(r.value)),
                                money: str(r.money), reason: str(r.reason), by: str(r.recorded_by) })),
    parcel: parcel ? { consignment: str(parcel.consignment_id), when: dayTime(parcel.booked_at),
                       cod: Math.round(num(parcel.cod_amount)), by: str(parcel.booked_by), byHand,
                       note: plainNote(parcel.note) } : null,
    courier: isCourier(str(inv.source)),
    changes: fixes.map((f) => ({ when: dayTime(f.fixed_at), field: str(f.field), was: str(f.was), now: str(f.now), by: str(f.fixed_by) })),
  };
}

/** One customer, whole. Found by phone (last 10 digits), else by name. */
export async function erpCustomerPage(ctx, payload) {
  const phone = str(payload && payload.phone), name = str(payload && payload.name);
  const key = str(payload && payload.key) || custKey(phone, name);
  if (!key || key === 'n:') throw new Error('Whose page?');
  const byPhone = !key.startsWith('n:');

  const cust = (byPhone
    ? await ctx.tx`select * from customers where business_id = ${ctx.biz}
                   and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${key} order by seq limit 1`
    : await ctx.tx`select * from customers where business_id = ${ctx.biz}
                   and lower(btrim(name)) = ${key.slice(2)}
                   and length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) < 10 order by seq limit 1`)[0];

  const invs = byPhone
    ? await ctx.tx`select i.invoice_no, i.created_at, i.grand_total, i.source, i.customer_name, i.customer_phone,
                          (select coalesce(sum(l.qty), 0) from invoice_lines l where l.invoice_id = i.id) as units
                   from invoices i where i.business_id = ${ctx.biz} and i.invoice_no not like 'RTN-%'
                     and right(regexp_replace(coalesce(i.customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${key}
                   order by i.created_at desc, i.seq desc`
    : await ctx.tx`select i.invoice_no, i.created_at, i.grand_total, i.source, i.customer_name, i.customer_phone,
                          (select coalesce(sum(l.qty), 0) from invoice_lines l where l.invoice_id = i.id) as units
                   from invoices i where i.business_id = ${ctx.biz} and i.invoice_no not like 'RTN-%'
                     and lower(btrim(i.customer_name)) = ${key.slice(2)}
                     and length(regexp_replace(coalesce(i.customer_phone, ''), '[^0-9]', '', 'g')) < 10
                   order by i.created_at desc, i.seq desc`;
  if (!cust && !invs.length) throw new Error('That customer was not found.');

  const dues = await erpDues(ctx);
  const dueOf = {};
  let balance = 0;
  for (const d of dues.invoices) {
    if (custKey(d.phone, d.customer) !== key) continue;
    dueOf[d.id] = d.due; balance += d.due;
  }
  const nos = invs.map((i) => i.invoice_no);
  const rets = nos.length ? await ctx.tx`select invoice_no, sum(value) as value from returns
                                         where business_id = ${ctx.biz} and invoice_no = any(${nos}) group by invoice_no` : [];
  const backOf = {};
  rets.forEach((r) => { backOf[r.invoice_no] = num(r.value); });
  const pays = await ctx.tx`select payment_no, invoice_no, paid_at, amount, method, note, recorded_by from payments
                            where business_id = ${ctx.biz}
                              and (invoice_no = any(${nos.length ? nos : ['']}) or (invoice_no is null and note like ${'%[acct:' + key + ']%'}))
                            order by paid_at desc, seq desc limit 200`;

  let spent = 0, units = 0;
  const invoices = invs.map((i) => {
    const total = num(i.grand_total), back = backOf[i.invoice_no] || 0;
    spent += total - back; units += num(i.units);
    return { id: i.invoice_no, date: day(i.created_at), total: Math.round(total), returned: Math.round(back),
             due: Math.round(dueOf[i.invoice_no] || 0), units: num(i.units), delivery: str(i.source) };
  });
  const last = invs[0] ? invs[0].created_at : null;
  const first = invs.length ? invs[invs.length - 1].created_at : null;
  const shownName = (cust && str(cust.name)) || (invs[0] && str(invs[0].customer_name)) || name;
  const shownPhone = formatBdPhone((cust && str(cust.phone)) || (invs[0] && str(invs[0].customer_phone)) || phone);

  return {
    key, row: cust ? Number(cust.seq) : 0,
    name: shownName, phone: shownPhone, email: cust ? str(cust.email) : '', address: cust ? str(cust.address) : '',
    type: cust ? str(cust.type) : '', status: cust ? str(cust.status) : '', source: cust ? str(cust.source) : '',
    note: cust ? str(cust.note) : '', since: day(cust ? cust.created_at : first),
    onList: !!cust,
    orders: invoices.length, units, spent: Math.round(spent),
    average: invoices.length ? Math.round(spent / invoices.length) : 0,
    lastOrder: day(last), daysSince: last ? Math.max(0, Math.floor((ctx.now.getTime() - new Date(last).getTime()) / 86400000)) : null,
    balance: Math.round(balance), credit: await creditOf(ctx, key),
    invoices: invoices.slice(0, 200), moreInvoices: Math.max(0, invoices.length - 200),
    payments: pays.map((p) => ({ when: day(p.paid_at), invoice: str(p.invoice_no), amount: round2(num(p.amount)),
                                 label: paymentLabel(p), note: plainNote(p.note), by: str(p.recorded_by) })),
  };
}

/** Find invoices, customers and products from a few letters or digits. */
export async function erpSearch(ctx, payload) {
  const q = str(payload && payload.q).slice(0, 60);
  if (q.length < 2) return { q, invoices: [], customers: [], products: [] };
  const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const digits = q.replace(/\D/g, '');
  const phoneLike = digits.length >= 3 ? '%' + digits.replace(/^0+/, '') + '%' : null;

  const invoices = await ctx.tx`
    select invoice_no, created_at, customer_name, customer_phone, grand_total from invoices
    where business_id = ${ctx.biz} and invoice_no not like 'RTN-%'
      and (invoice_no ilike ${like} or customer_name ilike ${like}
           or (${phoneLike}::text is not null and regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') like ${phoneLike}))
    order by created_at desc limit 8`;
  const customers = await ctx.tx`
    select name, phone, address, total_orders from customers
    where business_id = ${ctx.biz}
      and (name ilike ${like} or address ilike ${like}
           or (${phoneLike}::text is not null and regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') like ${phoneLike}))
    order by total_spent desc nulls last limit 8`;
  const products = await ctx.tx`
    select p.sku, p.name, p.brand, p.sell_price, p.status, coalesce(ps.stock, 0) as stock
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${ctx.biz}
      and (p.sku ilike ${like} or p.name ilike ${like} or p.brand ilike ${like} or p.color ilike ${like})
    order by (lower(p.sku) = lower(${q})) desc, p.name limit 8`;

  return {
    q,
    invoices: invoices.map((i) => ({ id: i.invoice_no, date: day(i.created_at), customer: str(i.customer_name),
                                     phone: str(i.customer_phone), total: Math.round(num(i.grand_total)) })),
    customers: customers.map((c) => ({ name: str(c.name), phone: formatBdPhone(str(c.phone)), address: str(c.address),
                                       orders: num(c.total_orders) })),
    products: products.map((p) => ({ sku: str(p.sku), name: str(p.name), brand: str(p.brand),
                                     sell: num(p.sell_price), stock: num(p.stock), status: str(p.status) })),
  };
}

export const HANDLERS = { erpInvoice, erpCustomerPage, erpSearch };
