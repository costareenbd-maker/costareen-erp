// fix-5 (24 Oct 2026): the partner's odd-case report, batch 5 - the small checks (L1-L11) and question 6 (M5).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, makeShareholder, check, done, deps, fnDir, web } from './harness.mjs';
await makeShareholder();
const { shopDoor } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'shop.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const W = await import(pathToFileURL(path.join(fnDir, 'handlers', 'weborders.js')));
const B = FIX.B;
async function asOwner(fn) {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${JSON.stringify({ sub: FIX.U.owner, role: 'authenticated' })}, true)`;
    return fn({ tx, sql, s: { userId: FIX.U.owner, name: 'Owner', role: 'owner', businessId: B, businessName: 'Costareen' }, biz: B, now: new Date(), memo: {}, deps });
  });
}
const C = { name: 'Small Case', phone: '01755500055' };
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status, unit) values
  (${B}, 'F5-PLA', 'Small PLA', 'Filaments', 'T', 'PLA', 0, 850, 'Active', 'Piece'),
  (${B}, 'F5-WIRE', 'Small Wire', 'Parts', 'T', 'Wire', 0, 100, 'Active', 'm')`;
for (const sku of ['F5-PLA', 'F5-WIRE']) {
  const id = (await sql`select id from products where business_id = ${B} and sku = ${sku}`)[0].id;
  await sql`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price) values (${B}, ${id}, 'RECEIVE', 'IN', 20, 50)`;
}

// ---- L1: whole pieces
let r = await owner('erpCreateInvoice', [{ customer: C, items: [{ sku: 'F5-PLA', qty: 0.4 }], payMode: 'none' }]);
check('(L1) 0.4 of a piece cannot be sold', !r.ok && /whole pieces/.test(r.error), r);
r = await owner('erpCreateInvoice', [{ customer: C, items: [{ sku: 'F5-WIRE', qty: 1.5 }], payMode: 'none' }]);
check('(L1) 1.5 m of wire can (sold by the metre)', r.ok, r);
r = await owner('erpCreateInvoice', [{ customer: C, items: [{ sku: 'F5-PLA', qty: 2 }], payMode: 'none' }]);
const INV = r.result.invoiceNo;
r = await owner('erpReturnGoods', [{ invoiceNo: INV, lines: [{ sku: 'F5-PLA', qty: 1.6, condition: 'good' }], reason: 'x', money: 'due' }]);
check('(L1) a return of 1.6 pieces is refused (not quietly made 2)', !r.ok && /whole number of pieces/.test(r.error), r);

// ---- L2: plain words instead of a database message
r = await owner('erpLotFundVoid', [{ id: 'not-an-id', reason: 'x' }]);
check('(L2) a broken id gives a plain sentence', !r.ok && !/invalid input syntax/.test(r.error), r);
r = await owner('erpCreateInvoice', [{ customer: C, items: [{ sku: 'F5-PLA', qty: 1e12 }], payMode: 'none' }]);
check('(L2) a quantity of a million million is refused in words', !r.ok && !/numeric field overflow/.test(r.error), r);

// ---- L3 / L5: payments to the paisa, never past what is owed
r = await owner('erpSettleDue', [{ orderId: INV, amount: 1700.4, reason: 'payment', method: 'Cash' }]);
check('(L3) 1700.40 on a 1700 due is refused', !r.ok && /more than is owed/.test(r.error), r);
r = await owner('erpSettleDue', [{ orderId: INV, amount: 0.004, reason: 'payment', method: 'Cash' }]);
check('(L3) a payment of 0.004 is refused (it is not even a paisa)', !r.ok, r);
r = await owner('erpSettleDue', [{ orderId: INV, amount: 1.239, reason: 'payment', method: 'Cash' }]);
check('(L5) 1.239 is refused, not rounded to 1.24', !r.ok && /2 decimals/.test(r.error), r);

// ---- L4: a transfer no bigger than the account holds
await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'Bank', kind: 'bank' }] }]);
const acc = (await owner('erpCashBook', [{}])).result.accounts;
const cash = acc.find((a) => a.name === 'Cash'), bank = acc.find((a) => a.name === 'Bank');
r = await owner('erpCashTransfer', [{ from: bank.id, to: cash.id, amount: 100000 }]);
check('(L4) moving 100,000 out of an empty bank is refused', !r.ok && /holds/.test(r.error), r);

// ---- L5 / L6 / L7: capital
await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Rahman', pct: 100 }]);
await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Nadia', returnKind: 'monthly', returnValue: 1000 }]);
const cap = (await owner('erpCapital', [])).result;
const RAH = cap.holders.find((h) => h.name === 'Rahman').id, NAD = cap.holders.find((h) => h.name === 'Nadia').id;
r = await owner('erpCapitalEntryAdd', [{ holder: NAD, type: 'invest', amount: 1.239 }]);
check('(L5) capital of 1.239 is refused', !r.ok && /2 decimals/.test(r.error), r);
const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
const back3 = new Date(Date.now() + 6 * 3600e3 - 3 * 86400e3).toISOString().slice(0, 10);
await owner('erpCapitalEntryAdd', [{ holder: NAD, type: 'invest', amount: 5000, date: today }]);
r = await owner('erpCapitalEntryAdd', [{ holder: NAD, type: 'withdraw', amount: 1000, date: back3 }]);
check('(L6) money cannot be taken back on a day before it came in', !r.ok && /before it came in/.test(r.error), r);
r = await owner('erpInvestorLink', [{ holder: RAH }]);
check('(L7) no investor page for a shareholder', !r.ok && /shareholder/.test(r.error), r);

// ---- L9: the website's door takes only real orders
await owner('erpShopKey', [{ make: true }]);
const key = (await owner('erpShopKey', [{ make: true }])).result.key;
const door = (body) => shopDoor(deps, asBusiness, owners, new Request('https://fn.test/erp?shop=order', { method: 'POST', headers: { 'x-shop-key': key, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
let d = await door({ number: 'D1', items: [{ sku: 'F5-PLA', qty: 1.5, price: 850 }] });
check('(L9) 1.5 pieces at the door is refused', d.body.ok === false && /whole number/.test(d.body.error), d.body);
d = await door({ number: 'D2', items: [{ sku: 'F5-PLA', qty: 1, line_total: -850 }] });
check('(L9) a line below zero is refused', d.body.ok === false && /below 0/.test(d.body.error), d.body);
d = await door({ number: 'D3', items: [{ sku: 'F5-PLA', qty: 1000000000 }] });
check('(L9) a billion pieces is refused', d.body.ok === false, d.body);
d = await door({ number: 'D4', created: '2099-01-01 10:00:00', items: [{ sku: 'F5-PLA', qty: 1, line_total: 850 }] });
const d4 = (await sql`select order_date from web_orders where business_id = ${B} and order_no = 'D4'`)[0];
check('(L9) an order dated 2099 is taken as dated now', d.body.ok && d4 && new Date(d4.order_date).getTime() < Date.now() + 86400e3, [d.body, d4]);

// ---- L10: a broken plugin answer makes no order
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'CZ_SYNC_KEY', 'sekrit') on conflict do nothing`;
web.on(/\/orders\?/, () => ({ body: { items: 'oops' } }));
const before = (await sql`select count(*)::int as n from web_orders where business_id = ${B}`)[0].n;
r = await asOwner((ctx) => W.pullWebOrders(ctx));
const after = (await sql`select count(*)::int as n from web_orders where business_id = ${B}`)[0].n;
check('(L10) {items: "oops"} makes no web order', r.ok && after === before, [r, before, after]);

// ---- L11: products and expenses are checked
r = await owner('erpSaveProduct', [{ isNew: true, sku: 'F5-NEW', product_name: 'New thing', sell_price: 'abc' }]);
check('(L11) a price "abc" is refused (not saved as 0)', !r.ok && /not a number/.test(r.error), r);
r = await owner('erpSaveProduct', [{ isNew: true, sku: 'F5-NEW', product_name: 'New thing', sell_price: 100, opening_stock: -5 }]);
check('(L11) an opening stock of -5 is refused', !r.ok && /below 0/.test(r.error), r);
r = await owner('erpSaveProduct', [{ isNew: true, sku: 'F5-NEW', product_name: 'x'.repeat(3000), sell_price: 100 }]);
check('(L11) a 3,000-letter name is refused', !r.ok && /too long/.test(r.error), r);
r = await owner('erpExpenseAdd', [{ amount: 0.001, description: 'thing', category: 'Miscellaneous' }]);
check('(L11) an expense of 0.001 is refused', !r.ok, r);

// ---- Q6 / M5: counting while orders are still packing
r = await owner('erpCreateInvoice', [{ customer: { ...C, source: 'Steadfast courier' }, items: [{ sku: 'F5-PLA', qty: 2 }], payMode: 'none' }]);
check('a courier order, still packing', r.ok, r);
r = await mgr('erpStockCount', [{ lines: [{ sku: 'F5-PLA', counted: 18 }] }]);
check('(Q6) a count while 2 are packed for an order asks first, naming them', !r.ok && /^CONFIRM: Sold but not sent yet/.test(r.error) && /Small PLA \(2\)/.test(r.error), r);
r = await mgr('erpStockCount', [{ lines: [{ sku: 'F5-PLA', counted: 16 }], again: true }]);
check('(Q6) ...and saves when the person says yes', r.ok, r);

const other = await sql`select count(*)::int as n from web_orders where business_id = ${FIX.B2}`;
check('the other business is untouched', other[0].n === 0, other);
await done();
