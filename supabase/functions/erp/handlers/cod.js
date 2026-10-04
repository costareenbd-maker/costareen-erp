// Cash on delivery collected by hand (tidy-1): for COD sent by Pathao, an
// own rider or any courier the ERP does not follow. (Steadfast parcels with a
// consignment number clear themselves on delivery - courier.js.)
//
//   erpCodCollected({invoiceNo, by: 'shop' | 'courier', method})
//     shop    the rider brought the cash to the shop  -> a payment by `method` (Cash by default)
//     courier the courier holds it until its payout   -> a payment "COD (<delivery>)"
//   The whole remaining due is received; part deliveries go through Receive / adjust due.

import { paidByOrder, addPayment, syncInvoiceStatus, lock, stamp, outstanding } from './money.js';
import { assertOpen } from '../lib/period.js';
import { roleAtLeast } from '../allow.js';
import { forget } from '../lib/tabs.js';

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };

export async function erpCodCollected(ctx, payload) {
  payload = payload || {};
  if (!roleAtLeast(ctx.s.role, 'sales')) throw new Error('Not allowed.');
  const no = str(payload.invoiceNo);
  if (!no) throw new Error('Which invoice?');
  await lock(ctx, 'sale');
  const inv = (await ctx.tx`select invoice_no, customer_name, customer_key, grand_total, payment_method, source, cancelled_at
                            from invoices where business_id = ${ctx.biz} and invoice_no = ${no}`)[0];
  if (!inv) throw new Error('No invoice ' + no + '.');
  if (inv.cancelled_at) throw new Error(no + ' is cancelled.');
  if (!/^(cod|cash on delivery)/i.test(str(inv.payment_method))) throw new Error(no + ' is not a cash-on-delivery sale. Use Receive / adjust due.');
  forget(ctx, 'PAYMENTS');
  // owed the one way the Dues screen works it out (an advance kept on the invoice counts too)
  const o = await outstanding(ctx, no);
  const due = o ? Math.round(o.owed * 100) / 100 : Math.round((num(inv.grand_total) - ((await paidByOrder(ctx))[no] || 0)) * 100) / 100;
  if (due <= 0.5) throw new Error(no + ' is already paid.');
  await assertOpen(ctx, new Date(), 'money cannot be received there');
  const by = str(payload.by) === 'courier' ? 'courier' : 'shop';
  const method = by === 'courier' ? 'COD (' + (str(inv.source) || 'courier') + ')' : (str(payload.method) || 'Cash');
  if (by === 'shop' && /^cod/i.test(method)) throw new Error('How did the cash reach the shop? (Cash, bKash...)');
  await addPayment(ctx, { id: 'P' + stamp(), order: no, customer: str(inv.customer_name), key: str(inv.customer_key) || null,
    amount: due, method, note: 'delivered & collected' + (by === 'courier' ? ' - the courier holds it' : '') });
  await syncInvoiceStatus(ctx, no);
  return { ok: true, invoiceNo: no, amount: due, method };
}

export const HANDLERS = { erpCodCollected };
