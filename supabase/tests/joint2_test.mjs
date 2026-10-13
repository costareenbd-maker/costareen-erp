// Joint stock, steps 2 and 3: a mixed invoice (own + joint lines) made by staff, the pool's own copy of the
// joint lines, the money split by share, the floor price, returns, cancelling, and what each side can see.
import { sql, FIX, owner, mgr, sales, check, done, deps, pdfs } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partner@t.test', ${sql.json({ full_name: 'Partner Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Partner Shop') as id`;
}))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
const A = FIX.B, PLA = 'FIL-SUN-PLA-BLA-001', PRT = 'PRT-BAM-A1-001';
await sql`insert into joint_flags (business_id) values (${A}), (${B3}) on conflict do nothing`;
const now = new Date(Date.now() + 6 * 3600e3);
const month = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');

let r = await owner('erpJointStart', [{ action: 'create', name: 'Filament JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner Shop', tier: 'wholesale' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-PLA-BLK', name: 'Polymaker PLA Black', category: 'Filament', brand: 'Polymaker', retail: 2000, wholesale: 1800, floor: 1700, cost: 1400 }]);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 10, unitCost: 1400, paidBy: A }]);
check('set-up: 10 in the pool', r.ok && r.result.stock[0].stock === 10, r);
await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 14000 }]);
await other('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: B3, amount: 14000 }]);

// ---- privacy: the partner sees the joint stock, never Costareen's own shelf; he cannot bring in a third company
check('nobody shows their own stock counts by default', (await sql`select count(*)::int as n from pool_partners where share_stock`)[0].n === 0);
r = await other('erpPartnerStock', [{ partner: A }]);
check('the partner cannot read Costareen own stock counts', !r.ok || r.result.products.length === 0, r);
r = await other('erpJointSettings', [{ pool: POOL, invite: true }]);
check('a joined partner cannot invite a third company', !r.ok && /started this joint stock/.test(r.error), r);
r = await other('erpJoint', [{ pool: POOL }]);
check('...and does not see invite codes', r.ok && r.result.book.invites.length === 0 && r.result.book.canInvite === false, r.ok && r.result.book.invites);
r = await owner('erpJointSettings', [{ pool: POOL, invite: true }]);
check('the starter can', r.ok && r.result.book.canInvite === true && r.result.book.invites.length >= 1, r.ok && r.result.book.invites);
r = await other('erpJointStart', [{ action: 'company', business: 'Spam Co', ownerName: 'X' }]);
check('a partner cannot make companies on the provider server', !r.ok && /provider/.test(r.error), r);

r = await sales('erpJointCatalog', []);
const JS = r.result.products[0].sku;
check('the joint code carries the pool', /^PM-PLA-BLK~J[0-9a-f]{4}$/.test(JS), JS);
const poolStock = async () => Number((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${POOL}`)[0].s);
const ownStock = async (sku) => Number((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${A} and p.sku = ${sku}`)[0].s);
const poolPays = async (no) => (await sql`select amount, method, received_by from payments where business_id = ${POOL} and invoice_no = ${no} order by paid_at, payment_no`).map((p) => ({ a: Number(p.amount), m: p.method, by: p.received_by }));
const poolMoney = async (no) => (await poolPays(no)).filter((p) => p.m === 'Joint').reduce((a, p) => a + p.a, 0);

// ---- 1. sales staff: one invoice, own + joint, paid in full
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }, { sku: JS, qty: 3 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('staff save a mixed invoice', r.ok && r.result.grandTotal === 8700 && r.result.joint.length === 1 && r.result.joint[0].total === 6000 && /^INV-/.test(r.result.invoiceNo), r);
const INV1 = r.result.invoiceNo;
check('own stock down by 2, pool stock down by 3', await ownStock(PLA) === 5 && await poolStock() === 7, [await ownStock(PLA), await poolStock()]);
let L = await sql`select l.sku, l.product_id, l.pool_id, l.unit_cost, l.line_total from invoice_lines l join invoices i on i.id = l.invoice_id where i.business_id = ${A} and i.invoice_no = ${INV1} order by l.line_no`;
check('seller\'s joint line: marked, tied to the pool, no profit of its own', L.length === 2 && L[1].sku === JS && L[1].pool_id === POOL && L[1].product_id === null && Number(L[1].unit_cost) === 2000 && Number(L[0].unit_cost) === 900, L);
check('no stock movement of the joint product in the seller\'s business', (await sql`select count(*)::int as n from stock_movements where business_id = ${A} and reference = ${'Invoice: ' + INV1}`)[0].n === 1);
const JS1 = (await sql`select * from joint_sales where seller_business_id = ${A} and seller_invoice_no = ${INV1}`)[0];
check('linked to the pool\'s copy', !!JS1 && JS1.pool_id === POOL && Number(JS1.joint_total) === 6000 && Number(JS1.below_floor) === 0, JS1);
const M1 = (await sql`select * from invoices where business_id = ${POOL} and invoice_no = ${JS1.pool_invoice_no}`)[0];
check('pool copy: sold by Costareen, no customer named, total 6000, paid', !!M1 && M1.sold_by === A && M1.customer_name === 'Costareen · ' + INV1 && !M1.customer_phone && Number(M1.grand_total) === 6000 && M1.payment_status === 'Paid', M1);
L = await sql`select sku, qty, unit_price, unit_cost, line_total from invoice_lines where invoice_id = ${M1.id}`;
check('pool copy line: plain code, pool cost', L.length === 1 && L[0].sku === 'PM-PLA-BLK' && Number(L[0].qty) === 3 && Number(L[0].unit_price) === 2000 && Number(L[0].unit_cost) === 1400, L);
check('no customer was added to the pool', (await sql`select count(*)::int as n from customers where business_id = ${POOL}`)[0].n === 0);
let pp = await poolPays(JS1.pool_invoice_no);
check('the pool\'s money: 6000, held by Costareen', pp.length === 1 && pp[0].a === 6000 && pp[0].m === 'Joint' && pp[0].by === A, pp);
r = await owner('erpJoint', [{ pool: POOL }]);
let rep = r.result.book.report, pa = rep.partners.find((x) => x.business_id === A);
check('settlement: sold 6000, cost 4200, Costareen collected 6000', rep.this_month.revenue === 6000 && rep.this_month.cogs === 4200 && pa.collected === 6000 && pa.month_sales === 6000, rep);
r = await owner('erpPnlMonth', [{ month }]);
let row = r.ok && r.result.invoices.find((x) => x.id === INV1);
check('seller\'s own profit counts only its own goods (900)', !!row && row.profit === 900, row);
check('the customer\'s paper shows the plain code', pdfs.length > 0 && pdfs[pdfs.length - 1].html.indexOf('~J') < 0 && pdfs[pdfs.length - 1].html.indexOf('Polymaker PLA Black') > 0);

// ---- 2. part payment: split by share
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01812345678' }, items: [{ sku: PRT, qty: 1 }, { sku: JS, qty: 2 }], deliveryCharge: 100, payMode: 'part', paidNow: 28050, paymentMethod: 'bKash' }]);
check('part-paid mixed invoice', r.ok && r.result.grandTotal === 56100 && r.result.thisDue === 28050, r);
const INV2 = r.result.invoiceNo;
const JS2 = (await sql`select * from joint_sales where seller_invoice_no = ${INV2}`)[0];
check('half paid: the pool has half of its 4000', await poolMoney(JS2.pool_invoice_no) === 2000, await poolPays(JS2.pool_invoice_no));
r = await mgr('erpSettleDue', [{ orderId: INV2, amount: 10000, method: 'Cash' }]);
check('10000 more: the pool\'s share follows (713)', r.ok && Math.abs(await poolMoney(JS2.pool_invoice_no) - 2713.01) < 0.02, await poolPays(JS2.pool_invoice_no));
r = await mgr('erpSettleDue', [{ orderId: INV2, amount: 18050, method: 'Cash' }]);
check('paid in full: the pool has all 4000', r.ok && await poolMoney(JS2.pool_invoice_no) === 4000, await poolPays(JS2.pool_invoice_no));
check('...and its copy says Paid', (await sql`select payment_status from invoices where business_id = ${POOL} and invoice_no = ${JS2.pool_invoice_no}`)[0].payment_status === 'Paid');

// ---- 3. the floor price
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: JS, qty: 1, discEach: 400 }], payMode: 'full' }]);
check('staff cannot sell below the floor', !r.ok && /below the floor price of 1700/.test(r.error), r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }, { sku: JS, qty: 1 }], invoiceDiscount: 1000, payMode: 'full' }]);
check('...nor through a discount on the whole invoice', !r.ok && /below the floor/.test(r.error), r);
r = await owner('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: JS, qty: 1, discEach: 400 }], payMode: 'none' }]);
check('the owner can, and it is flagged', r.ok && r.result.grandTotal === 1600 && Number((await sql`select below_floor from joint_sales where seller_invoice_no = ${r.result.invoiceNo}`)[0].below_floor) === 100, r);
const INV3 = r.result.invoiceNo;
check('pool stock now 4', await poolStock() === 4, await poolStock());

// ---- 4. limits
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: JS, qty: 5 }], payMode: 'full' }]);
check('not more than the pool has', !r.ok && /Not enough stock/.test(r.error), r);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'PM-PLA-BLK~Jffff', qty: 1 }], payMode: 'full' }]);
check('a code of a pool that is not ours is refused', !r.ok && /Unknown product/.test(r.error), r);
check('...nothing was written', await poolStock() === 4);

// ---- 5. the partner sells too, at his price, under his name
r = await other('erpJointCatalog', []);
check('partner sees the wholesale price', r.ok && r.result.products[0].sell === 1800 && r.result.products[0].stock === 4, r);
r = await other('erpCreateInvoice', [{ customer: { name: 'Their Customer', phone: '01912345678' }, items: [{ sku: r.result.products[0].sku, qty: 1 }], payMode: 'full' }]);
check('partner\'s own invoice', r.ok && r.result.grandTotal === 1800, r);
const INV4 = r.result.invoiceNo;
const M4 = (await sql`select i.sold_by, i.customer_name from joint_sales j join invoices i on i.business_id = j.pool_id and i.invoice_no = j.pool_invoice_no where j.seller_business_id = ${B3}`)[0];
check('pool copy sold by the partner', !!M4 && M4.sold_by === B3 && M4.customer_name === 'Partner Shop · ' + INV4, M4);
check('Costareen has no trace of the partner\'s customer', (await sql`select count(*)::int as n from customers where business_id = ${A} and name = 'Their Customer'`)[0].n === 0 &&
  (await sql`select count(*)::int as n from invoices where business_id in (${A}, ${POOL}) and customer_name = 'Their Customer'`)[0].n === 0);
r = await owner('erpJoint', [{ pool: POOL }]);
rep = r.result.book.report;
check('settlement: each side\'s sales and money', rep.partners.find((x) => x.business_id === A).collected === 10000 && rep.partners.find((x) => x.business_id === B3).collected === 1800 &&
  rep.to_date.receivables === 1600, rep);

// ---- 6. a joint piece comes back
r = await mgr('erpReturnGoods', [{ invoiceNo: INV1, lines: [{ sku: JS, qty: 1, condition: 'good' }], money: 'advance', reason: 'wrong colour' }]);
check('return of a joint line', r.ok && r.result.value === 2000 && r.result.advance === 2000, r);
check('back on the pool\'s shelf, not the seller\'s', await poolStock() === 4 && (await sql`select count(*)::int as n from stock_movements where business_id = ${A} and kind = 'RETURN'`)[0].n === 0, await poolStock());
pp = await poolPays(JS1.pool_invoice_no);
check('the pool gives its 2000 back', pp.filter((p) => p.m === 'Returned').reduce((a, p) => a + p.a, 0) === 2000 && pp.filter((p) => p.m === 'Joint').reduce((a, p) => a + p.a, 0) === 4000, pp);
const RT = await sql`select l.qty, l.line_total, l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id where i.business_id = ${POOL} and i.invoice_no like 'RTN-%'`;
check('pool return note: -1 at the pool\'s cost', RT.length === 1 && Number(RT[0].qty) === -1 && Number(RT[0].line_total) === -2000 && Number(RT[0].unit_cost) === 1400, RT);
r = await mgr('erpReturnGoods', [{ invoiceNo: INV1, lines: [{ sku: JS, qty: 3, condition: 'good' }], money: 'advance', reason: 'x' }]);
check('not more than is left on the invoice', !r.ok, r);
r = await mgr('erpReturnGoods', [{ invoiceNo: INV1, lines: [{ sku: PLA, qty: 1, condition: 'good' }], money: 'advance', reason: 'own goods back' }]);
check('an own line returned: the pool is not touched', r.ok && await ownStock(PLA) === 6 && await poolMoney(JS1.pool_invoice_no) === 4000, await poolPays(JS1.pool_invoice_no));

// ---- 7. cancelling a mixed invoice
r = await owner('erpVoidInvoice', [INV3]);
check('an invoice with joint stock is never removed', !r.ok && /joint stock/.test(r.error), r);
r = await owner('erpCancelInvoice', [{ invoiceNo: INV2, reason: 'customer changed mind', money: 'refund', method: 'Cash' }]);
check('cancelled, money refunded', r.ok && r.result.refund === 56100, r);
check('pool stock back (+2), own printer back', await poolStock() === 6 && await ownStock(PRT) === 3, [await poolStock(), await ownStock(PRT)]);
check('the pool keeps none of that money', await poolMoney(JS2.pool_invoice_no) === 0, await poolPays(JS2.pool_invoice_no));

// ---- 8. what the partner can see of it
r = await other('erpSales', [{}]);
{ const js = JSON.stringify(r.result || r), k = js.indexOf('Karim'), i1 = js.indexOf(INV1);
  // (his first invoice has the same number as Costareen's first: each company has its own series)
  check('partner\'s own sales list: only his invoice', r.ok && k < 0 && r.result.rows.length === 1 && r.result.rows[0].customer === 'Their Customer', [r.ok, r.error, i1, k >= 0 ? js.slice(Math.max(0, k - 300), k + 100) : '']); }
r = await mgr('erpJoint', [{ pool: POOL }]);
check('manager sees stock, not the book', r.ok && r.result.stock[0].stock === 6 && !r.result.book, r.result);

// ---- 8b. the invoice's low-profit warning knows joint lines too (pool cost 1400; this company sells at its 2000 price)
r = await owner('erpLineMargins', [{ items: [{ sku: JS, qty: 1 }] }]);
check('a joint line at its price: 30% profit, not low', r.ok && r.result.lines[0].joint && r.result.lines[0].low === false && r.result.lines[0].margin === 30, r.result);
r = await sales('erpLineMargins', [{ items: [{ sku: JS, qty: 1, discEach: 500 }] }]);
check('...sold at 1500: under 10%, flagged; staff see no %', r.ok && r.result.lines[0].low === true && r.result.lines[0].margin === undefined, r.result);

// ---- 9. switched off: no joint selling
await sql`update joint_flags set enabled = false where business_id = ${A}`;
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: JS, qty: 1 }], payMode: 'full' }]);
check('switched off: joint lines refused', !r.ok && /not switched on/.test(r.error), r);
await done();
