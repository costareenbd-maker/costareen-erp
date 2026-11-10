// invedit-1 (owner 6 Nov 2026): edit a saved invoice - name, phone, address, delivery, products, quantities, prices,
// discounts, delivery charge - even after the courier ("the customer got the goods right; only our invoice had a typing
// mistake"), and "a walk-in sale put on the courier by mistake, no consignment came, it shows as due".
//
//   erpInvoiceEdit({invoiceNo, customer:{name, phone, address, source}, items:[{sku, qty, discEach}], invoiceDiscount,
//                   deliveryCharge, payMode, paidNow, paymentMethod})
//
// The same invoice, the same number, the same day and seller. Checked by the New invoice rules (createInvoice preview,
// with this invoice's own units counted as on the shelf again). Its old stock movements are taken out (the lots follow by
// themselves: 107_fifo_lots.sql lots_unfollow) and the new lines go out again; money already taken stays; what is due
// is worked out again; "Paid now" adds a payment. One line per change is written in invoice_fixes (the invoice page
// shows them). The PDF is drawn again under the same name - one copy, the old one is overwritten (owner's choice).
//
// Not here: a locked month (make a Return), an invoice with a return or with numbered units or joint-stock lines on it
// (its lines; who / where / how can still be fixed), a new total below what is already paid (that is a refund).

import { createInvoice } from './invoice.js';
import { erpFixInvoice, makeInvoicePdf } from './sales.js';
import { lotLineCost } from './lots.js';
import { products } from './dashboard.js';
import { addPayment, syncInvoiceStatus, outstanding, lock, stamp, who } from './money.js';
import { assertOpen } from '../lib/period.js';
import { deliveryType } from '../lib/delivery.js';
import { forget } from '../lib/tabs.js';
import { formatDate, num, round2 } from '../lib/time.js';
import { custKey } from '../lib/phone.js';
import { roleAtLeast } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
const tk = (n) => Math.round(num(n)).toLocaleString('en-IN');
const linesText = (ls) => ls.map((l) => str(l.name) + ' × ' + num(l.qty) + ' @ ' + tk(l.unit)).join(', ');

export async function erpInvoiceEdit(ctx, payload) {
  const p = payload || {}, no = str(p.invoiceNo);
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner edits a saved invoice.');
  if (!no) throw new Error('Which invoice?');
  if (/^RTN-/i.test(no)) throw new Error(no + ' is a return note; it is not edited.');
  await lock(ctx, 'sale');
  const inv = (await ctx.tx`select * from invoices where business_id = ${ctx.biz} and invoice_no = ${no}`)[0];
  if (!inv) throw new Error('No invoice called ' + no + '.');
  if (/cancel/i.test(str(inv.delivery_status)) || /cancel/i.test(str(inv.payment_status))) throw new Error(no + ' is cancelled; it is not edited.');
  await assertOpen(ctx, new Date(inv.created_at), 'its invoices are not edited. Make a Return instead');
  const oldLines = await ctx.tx`select * from invoice_lines where invoice_id = ${inv.id} order by line_no`;
  const cu = p.customer || {};

  // 1. who it is for, where it goes (the existing correction: one phone = one customer, the parcel rule, its log lines)
  const fix = await erpFixInvoice(ctx, { invoiceNo: no, name: cu.name, phone: cu.phone, address: cu.address, delivery: cu.source, noPdf: true });
  const head = (await ctx.tx`select * from invoices where id = ${inv.id}`)[0];

  // 2. the lines and the money
  const want = (p.items || []).filter((it) => it && str(it.sku) && num(it.qty) > 0).map((it) => ({ sku: str(it.sku), qty: num(it.qty), discEach: Math.max(0, num(it.discEach)) }));
  if (!want.length) throw new Error('An invoice needs at least one product. To undo the whole sale, cancel it.');
  // jointedit-1 (owner 11 Nov 2026): a joint-stock product added in an edit crashed ("reading 'id'") - its goods are the
  // pool's and its copy in the pool is made only by a new sale. Said plainly; the extra goods go on a new invoice.
  const J = await import('./joint.js');
  const jointNew = want.filter((w) => J.JOINT_MARK.test(w.sku));
  if (jointNew.length) throw new Error('Joint-stock products cannot be added to a saved invoice by editing. Make a new invoice for them, dated today, so today’s sales, cash and the joint stock stay right.');
  const sameLines = want.length === oldLines.length && want.every((w, i) => {
    const o = oldLines[i]; return o && str(o.sku).toLowerCase() === w.sku.toLowerCase() && num(o.qty) === w.qty && Math.abs(num(o.discount) - round2(w.discEach * w.qty)) < 0.5;
  });
  const newDelivery = p.deliveryCharge === undefined ? num(head.delivery_charge) : num(p.deliveryCharge);
  const newInvDisc = p.invoiceDiscount === undefined ? num(head.invoice_discount) : Math.max(0, Math.round(num(p.invoiceDiscount)));
  const moneySame = sameLines && newDelivery === num(head.delivery_charge) && newInvDisc === num(head.invoice_discount);
  const isPickup = (await deliveryType(ctx, str(head.source))) === 'pickup';
  const wasCod = /^cod$/i.test(str(head.payment_method));
  const nowCod = !isPickup && (str(p.payMode) === 'cod' || (wasCod && str(p.payMode) !== 'none' && str(p.payMode) !== 'full' && str(p.payMode) !== 'part'));
  const changes = [];
  let warning = str(fix && fix.warning);

  if (!moneySame) {
    if ((await ctx.tx`select 1 from returns where business_id = ${ctx.biz} and invoice_no = ${no} limit 1`).length) throw new Error(no + ' has a return on it, so its products are not edited. Who / where can still be fixed.');
    if ((await ctx.tx`select 1 from serials where business_id = ${ctx.biz} and invoice_no = ${no} limit 1`).length) throw new Error(no + ' has numbered units (serials) on it, so its products are not edited. Make a Return instead.');
    if (oldLines.some((l) => l.pool_id)) throw new Error(no + ' has joint-stock lines, so its products are not edited. Make a Return instead.');
    // this invoice's own units count as on the shelf again while the new lines are checked
    // a product already on it keeps the price it was sold at (a later price-list change does not re-price the sale)
    const unitBy = {}; for (const l of oldLines) unitBy[str(l.sku).toLowerCase()] = num(l.unit_price);
    const agreed = want.map((w) => unitBy[w.sku.toLowerCase()] || 0);
    const giveBack = {};
    for (const l of oldLines) giveBack[str(l.sku).toLowerCase()] = (giveBack[str(l.sku).toLowerCase()] || 0) + num(l.qty);
    const pv = await createInvoice(ctx, { customer: { name: head.customer_name, phone: '', address: head.customer_address, source: head.source },
      items: want, invoiceDiscount: newInvDisc, deliveryCharge: newDelivery, payMode: nowCod ? 'cod' : 'none' }, { preview: true, giveBack, edit: true, agreed });
    const paidNow = num((await outstanding(ctx, no) || {}).paid);
    if (pv.grand + 0.5 < paidNow) throw new Error('The new total (' + tk(pv.grand) + ') is below what is already paid (' + tk(paidNow) + '). Give the difference back as a refund / Return instead.');
    // out with the old lines and their stock movements (the lots put the units back by themselves)
    const mv = await ctx.tx`select id from stock_movements where business_id = ${ctx.biz} and invoice_id = ${inv.id} and direction = 'OUT'`;
    if (mv.length) await ctx.tx`delete from stock_movements where id = any(${mv.map((r) => r.id)})`;
    await ctx.tx`delete from invoice_lines where invoice_id = ${inv.id}`;
    // in with the new ones, at the sale's own moment
    const at = new Date(inv.created_at);
    const costs = (await products(ctx)).bySku;
    const costNow = (sku) => { const c = costs[str(sku).toLowerCase()]; return c && c.cost > 0 ? c.cost : 0; };
    for (let i = 0; i < pv.lines.length; i++) {
      const l = pv.lines[i];
      const pr = (await ctx.tx`select id from products where business_id = ${ctx.biz} and lower(btrim(sku)) = ${str(l.sku).toLowerCase()} limit 1`)[0];
      if (!pr) throw new Error(str(l.name || l.sku) + ' is not one of this company’s own products, so it cannot be added by editing. Make a new invoice for it.');
      const row = (await ctx.tx`insert into invoice_lines (business_id, invoice_id, product_id, sku, name, qty, unit_price, discount, line_total, line_no, unit_cost)
                               values (${ctx.biz}, ${inv.id}, ${pr.id}, ${l.sku}, ${l.name}, ${l.qty}, ${l.unit}, ${l.disc}, ${l.total}, ${i + 1}, ${costNow(l.sku)}) returning id`)[0];
      const m = (await ctx.tx`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, invoice_id, created_by, created_at, txn_no, operator, product_name)
                             values (${ctx.biz}, ${pr.id}, 'SALE', 'OUT', ${l.qty}, ${l.unit}, ${l.total}, ${'Invoice: ' + no}, ${inv.id}, ${inv.created_by}, ${at},
                                     ${'TXN-' + formatDate(at, 'yyyyMMdd') + '-' + (Math.floor(Math.random() * 9000) + 1000)}, ${who(ctx)}, ${l.name}) returning id`)[0];
      const fifo = await lotLineCost(ctx, m.id, costNow(l.sku));
      if (fifo > 0 && fifo !== costNow(l.sku)) await ctx.tx`update invoice_lines set unit_cost = ${fifo} where id = ${row.id}`;
    }
    await ctx.tx`update invoices set subtotal = ${pv.sub}, discount = ${pv.discount}, delivery_charge = ${pv.delivery}, grand_total = ${pv.grand},
                   item_discount = ${pv.itemDisc}, invoice_discount = ${pv.invDisc} where id = ${inv.id}`;
    if (head.customer_id) await ctx.tx`update customers set total_spent = greatest(0, coalesce(total_spent, 0) - ${num(inv.grand_total)} + ${pv.grand}), updated_at = now() where id = ${head.customer_id}`;
    const oldText = linesText(oldLines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit_price })));
    const newText = linesText(pv.lines);
    if (oldText !== newText || !sameLines) changes.push(['products', oldText, newText]);
    if (newDelivery !== num(inv.delivery_charge)) changes.push(['delivery charge', tk(inv.delivery_charge), tk(newDelivery)]);
    if (newInvDisc !== num(inv.invoice_discount)) changes.push(['discount', tk(inv.invoice_discount), tk(newInvDisc)]);
    if (Math.abs(pv.grand - num(inv.grand_total)) > 0.005) changes.push(['total', tk(inv.grand_total), tk(pv.grand)]);
  }

  // 3. how it is paid: cash on delivery only with a courier / rider; a walk-in is paid at the counter or owed
  const method = nowCod ? 'COD' : (wasCod ? '' : str(head.payment_method));
  if (method !== str(head.payment_method)) {
    await ctx.tx`update invoices set payment_method = ${method} where id = ${inv.id}`;
    changes.push(['payment', str(head.payment_method) || 'due', method || 'due']);
  }
  await syncInvoiceStatus(ctx, no);
  let took = 0;
  const due = num((await outstanding(ctx, no) || {}).owed);
  const mode = str(p.payMode);
  if (!nowCod && due > 0.5 && (mode === 'full' || (mode === 'part' && num(p.paidNow) > 0))) {
    const m = str(p.paymentMethod) || 'Cash';
    if (/^cod\b|cash on delivery/i.test(m)) throw new Error('Choose how it was paid (Cash, bKash, Bank...).');
    took = mode === 'full' ? due : Math.min(due, num(p.paidNow));
    await addPayment(ctx, { id: 'P' + stamp(), order: no, customer: head.customer_name, amount: round2(took), method: m, note: 'paid when the invoice was edited' });
    await syncInvoiceStatus(ctx, no);
    changes.push(['paid', '', tk(took) + ' by ' + m]);
  }
  // a parcel already booked carries the old amount to collect
  if (!moneySame) {
    const cl = (await ctx.tx`select consignment_id from courier_log where business_id = ${ctx.biz} and invoice_no = ${no} order by booked_at desc limit 1`)[0];
    if (cl && str(cl.consignment_id)) warning = [warning, 'Parcel ' + str(cl.consignment_id) + ' at the courier still has the old amount to collect - tell Steadfast the new one.'].filter(Boolean).join(' ');
  }
  const at2 = new Date(), by = who(ctx);
  for (const c of changes) {
    await ctx.tx`insert into invoice_fixes (business_id, fixed_at, invoice_no, field, was, now, fixed_by) values (${ctx.biz}, ${at2}, ${no}, ${c[0]}, ${c[1]}, ${c[2]}, ${by})`;
  }
  await ctx.tx`update invoices set customer_key = ${custKey(str(head.customer_phone), str(head.customer_name))} where id = ${inv.id}`;
  forget(ctx, 'SALES_LOG', 'TXN_LOG', 'CUSTOMERS');
  delete ctx.memo.catalog;
  const changed = (fix ? num(fix.changed) : 0) + changes.length;
  // one PDF: drawn again under the same name (the old one is overwritten)
  let pdf = null;
  if (changed) { try { pdf = await ctx.tx.savepoint(() => makeInvoicePdf(ctx, no, {})); } catch (_) { pdf = null; } }
  const now = (await outstanding(ctx, no)) || {};
  return { ok: true, invoiceNo: no, changed, fields: [].concat((fix && fix.fields) || [], changes.map((c) => c[0])),
           grandTotal: num(now.grand), paid: num(now.paid), due: num(now.owed), took, warning, pdfUrl: (pdf && pdf.url) || '' };
}

export const HANDLERS = { erpInvoiceEdit };
