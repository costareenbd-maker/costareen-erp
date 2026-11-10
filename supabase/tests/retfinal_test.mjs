// crit8-ret (10 Nov 2026): after a return the Sales list and the invoice agree.
//   Paid in the list = money actually received; the goods that came back are a "Returned" figure of their own;
//   Due is the same in the list, the invoice and the customer's account. Plus refund / advance cases.
import { sql, FIX, owner, mgr, sales, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';   // sells at 1350
const C = { name: 'Return Final', phone: '01822222333' };

const listRow = async (who, no) => {
  const r = await who('erpListView', [{ model: 'invoices', search: [{ field: 'id', values: [no] }] }]);
  return { r, row: r.ok ? r.result.rows.find((x) => x.id === no) : null };
};

// ---- a part payment, then one of two pieces comes back --------------------------------------------
let r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 2 }], payMode: 'part', paidNow: 1000, paymentMethod: 'Cash' }]);
check('sale of 2 with 1000 paid', r.ok && r.result.grandTotal === 2700 && r.result.thisDue === 1700, r);
const INV = r.ok ? r.result.invoiceNo : '';

let L = await listRow(mgr, INV);
check('before the return: list paid 1000, returned 0, due 1700', L.row && L.row.paid === 1000 && L.row.returned === 0 && L.row.due === 1700, L.row);
check('the spec has Paid and Returned columns, summed', L.r.ok && ['paid', 'returned'].every((k) => L.r.result.spec.columns.some((c) => c.key === k && c.sum)), L.r.ok && L.r.result.spec.columns);

r = await mgr('erpReturnGoods', [{ invoiceNo: INV, lines: [{ sku: PLA, qty: 1, condition: 'good' }], money: 'due', reason: 'wrong colour' }]);
check('return of 1 recorded, 1350 off the due', r.ok && r.result.value === 1350 && r.result.dueReduced === 1350, r);

L = await listRow(mgr, INV);
check('after: list Paid stays the money received (1000), not 2350', L.row && L.row.paid === 1000, L.row);
check('after: list Returned = the return value', L.row && L.row.returned === 1350, L.row);
check('after: list Due 350', L.row && L.row.due === 350, L.row);
check('Total = Paid + Returned + Due', L.row && L.row.total === L.row.paid + L.row.returned + L.row.due, L.row);
check('footer sums carry paid and returned', L.r.ok && L.r.result.sums.paid === 1000 && L.r.result.sums.returned === 1350 && L.r.result.sums.due === 350, L.r.ok && L.r.result.sums);

const s = await mgr('erpSales', [{ q: INV }]);
const srow = s.ok ? s.result.rows.find((x) => x.id === INV) : null;
check('erpSales row: paid 1000, returned 1350, due 350', srow && srow.paid === 1000 && srow.returned === 1350 && srow.due === 350, srow);

const inv = await mgr('erpInvoice', [{ invoiceNo: INV }]);
const d = inv.ok ? inv.result : null;
const received = d ? Math.max(0, Number(d.paid) - Number(d.returnedValue || 0)) : -1;
check('the invoice (drawer) says the same: received 1000, returned 1350, owed 350',
  d && Math.round(received) === 1000 && Math.round(d.returnedValue) === 1350 && Math.round(d.owed) === 350, d && { paid: d.paid, ret: d.returnedValue, owed: d.owed });

const acc = await mgr('erpCustomerAccount', [{ phone: C.phone, name: C.name }]);
const ai = acc.ok ? acc.result.invoices.find((v) => v.id === INV || v.invoiceNo === INV || v.order === INV) : null;
check('the customer account owes the same 350 on it', acc.ok && acc.result.balance === 350 && (!ai || Math.round(ai.due) === 350), acc.result);

// ---- a sale paid in full, a piece back and refunded: paid = what stayed with the business ---------
r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 2 }], payMode: 'full', paymentMethod: 'Cash' }]);
const INV2 = r.ok ? r.result.invoiceNo : '';
r = await owner('erpReturnGoods', [{ invoiceNo: INV2, lines: [{ sku: PLA, qty: 1, condition: 'good' }], money: 'refund', method: 'Cash', reason: 'changed mind' }]);
check('refund return recorded', r.ok && r.result.refund === 1350, r);
L = await listRow(mgr, INV2);
check('refund: paid 1350 (2700 in, 1350 handed back), returned 1350, due 0', L.row && L.row.paid === 1350 && L.row.returned === 1350 && L.row.due === 0, L.row);
check('refund: status still Paid', L.row && L.row.status === 'Paid', L.row);

// ---- kept as advance: the money moved off this invoice to the customer's advance --------------------
r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
const INV3 = r.ok ? r.result.invoiceNo : '';
r = await mgr('erpReturnGoods', [{ invoiceNo: INV3, lines: [{ sku: PLA, qty: 1, condition: 'good' }], money: 'advance', reason: 'kept for next order' }]);
check('advance return recorded', r.ok && r.result.advance === 1350, r);
L = await listRow(mgr, INV3);
check('advance: paid 0 on this invoice, returned 1350, due 0, status Returned', L.row && L.row.paid === 0 && L.row.returned === 1350 && L.row.due === 0 && L.row.status === 'Returned', L.row);

// ---- sales role: same list, same figures (no money column is taken away from the invoice list) -------
L = await listRow(sales, INV);
check('sales role sees the same paid / returned / due', L.row && L.row.paid === 1000 && L.row.returned === 1350 && L.row.due === 350, L.row || L.r);

// ---- quotations: the top cards count the same states as the list ------------------------------------------
const qbase = (id, title) => ({ id, number: '', kind: 'Products', title, customer: 'Return Final', contact: '', email: '', phone: C.phone,
  address: '', date: '2026-10-02', validUntil: '2026-10-12', currency: 'BDT', items: [{ id: 'a', name: 'PLA', kind: 'Product', qty: 1, unit: 'unit', rate: 1350 }],
  discountType: 'Fixed', discount: 0, vat: 0, shipping: 0, advance: 0, terms: '', notes: '', showBank: false, showSignature: false, useSignature: false,
  bankIds: [], theme: 'Signature', accent: '#123456', dark: '#000000', font: 'Georgia', fontSize: 'Compact', autoNumber: true, status: 'Draft', company: null });
r = await sales('erpQuoteSave', [{ quote: qbase('q-ret-1', 'Draft one'), expectedVersion: 0, saveKey: 'kr1' }]);
check('quote 1 saved (draft)', r.ok, r);
r = await sales('erpQuoteSave', [{ quote: { ...qbase('q-ret-2', 'Ready one'), status: 'Ready' }, expectedVersion: 0, saveKey: 'kr2' }]);
check('quote 2 saved (ready)', r.ok && r.result.quote.status === 'Ready', r.ok ? r.result.quote.status : r);
r = await sales('erpQuoteSave', [{ quote: { ...qbase('q-ret-3', 'Invoiced one'), status: 'Ready' }, expectedVersion: 0, saveKey: 'kr3' }]);
const Q3 = r.ok ? r.result.quote.number : '';
r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 1 }], payMode: 'none', note: 'From quotation ' + Q3, quoteRef: Q3 }]);
check('quote 3 made into an invoice', r.ok, r);
const ql = await mgr('erpQuoteList', [{}]);
const head = await mgr('erpFdHead', [{ view: 'quotes' }]);
const cardOf = (k) => head.ok ? (head.result.cards || head.result).find ? (head.result.cards || head.result).find((c) => c.key === k) : null : null;
check('the list counts 1 draft, 1 ready, 1 invoiced', ql.ok && ql.result.counts.draft === 1 && ql.result.counts.ready === 1 && ql.result.counts.invoiced === 1, ql.ok ? ql.result.counts : ql);
check('top card Drafts = the list\'s Draft', cardOf('drafts') && cardOf('drafts').v === ql.result.counts.draft, head.ok ? head.result : head);
check('top card Ready = the list\'s Ready, and it says how many became invoices', cardOf('ready') && cardOf('ready').v === ql.result.counts.ready && /1 turned into invoices/.test(cardOf('ready').note || ''), cardOf('ready'));
check('the quotation list keeps exact times (ISO, the page shows them in the shop\'s time)', ql.ok && ql.result.rows.every((x) => /T\d\d:\d\d/.test(x.createdAt)), ql.ok && ql.result.rows[0]);

// ---- the other business is untouched -------------------------------------------------------------------
const other = await sql`select count(*)::int n from returns where business_id = ${FIX.B2} and reason in ('wrong colour', 'changed mind', 'kept for next order')`;
check('nothing written in the other business', other[0].n === 0, other);

done();
