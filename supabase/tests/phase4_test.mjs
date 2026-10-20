// Phase 4: the month behind the P&L, own expense categories, receipts, partnership.
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done, files, deps } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
// the partner: a second company with its own owner
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partner@t.test', ${sql.json({ full_name: 'Partner Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Partner Shop') as id`;
}))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
// joint stock is switched on per company by the provider (068)
await sql`insert into joint_flags (business_id) values (${FIX.B}), (${B3}) on conflict do nothing`;

await makeShareholder();
const PLA = 'FIL-SUN-PLA-BLA-001';
const now = new Date(Date.now() + 6 * 3600e3);
const month = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
const shift = (m, by) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + String(mo).padStart(2, '0'); };

// ---------------------------------------------------------------- P&L
let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full' }]);
const INV = r.result.invoiceNo;
r = await mgr('erpPnlMonth', [{ month }]);
check('manager cannot open the month behind the P&L', !r.ok, r);
r = await shareholder('erpPnlMonth', [{ month: 'x' }]);
check('pnl month: which month', !r.ok && r.error === 'Which month?', r);
r = await shareholder('erpPnlMonth', [{ month }]);
const row = r.ok && r.result.invoices.find((x) => x.id === INV);
check('pnl month: the invoice with its net, cost and profit', !!row && row.net === 2700 && row.cost === 1800 && row.profit === 900 && r.result.totals.sales === 2700, r.result);
const pn = await shareholder('erpPnl', [{ months: 6 }]);
const cur = pn.result.months[pn.result.months.length - 1];
check('pnl month agrees with the statement', cur.month === month && cur.netSales === r.result.totals.sales - r.result.totals.returns && cur.cost === r.result.totals.cost, [cur, r.result.totals]);
r = await shareholder('erpPnl', [{ months: 3, to: shift(month, -2) }]);
check('pnl: window can end on an earlier month', r.ok && r.result.months.length === 3 && r.result.months[2].month === shift(month, -2) && !r.result.months[2].current && r.result.thisMonth === month, r.result);
r = await shareholder('erpPnl', [{ months: 3, to: shift(month, 2) }]);
check('pnl: a future month falls back to this month', r.ok && r.result.months[2].month === month, r.result);
r = await owner('erpDashboardData', []);
check('dashboard: top products carry the sku', r.ok && r.result.topProducts.some((t) => t.sku === PLA), r.result ? r.result.topProducts : r);

// ---------------------------------------------------------------- expenses
r = await shareholder('erpExpenseCategory', [{ kind: 'oneoff', add: 'Gifts' }]);
check('only the owner changes the category lists', !r.ok, r);
r = await owner('erpExpenseCategory', [{ kind: 'nope', add: 'Gifts' }]);
check('category: which list', !r.ok && r.error === 'Which list?', r);
r = await owner('erpExpenseCategory', [{ kind: 'oneoff', add: 'Gifts' }]);
check('category added to one list only', r.ok && r.result.categories.oneoff.includes('Gifts') && !r.result.categories.fixed.includes('Gifts') && r.result.categories.oneoff.includes('Miscellaneous'), r.result && r.result.categories);
r = await owner('erpExpenseCategory', [{ kind: 'oneoff', add: 'gifts' }]);
check('category: no doubles', !r.ok && r.error === '"gifts" is already in that list.', r);
r = await owner('erpExpenseCategory', [{ kind: 'oneoff', remove: 'Equipment' }]);
check('category removed', r.ok && !r.result.categories.oneoff.includes('Equipment'), r.result && r.result.categories);
r = await shareholder('erpExpenseAdd', [{ amount: 500, description: 'Eid gift', category: 'Gifts' }]);
const EXP = r.result.oneoff[0];
check('expense in the new category, no receipt yet', r.ok && EXP.category === 'Gifts' && EXP.receipt === false, EXP);
const png = Buffer.from('fake image bytes').toString('base64');
r = await shareholder('erpExpenseReceipt', [{ id: EXP.id, file: { data: png, mime: 'text/html' } }]);
check('receipt: only photos and PDFs', !r.ok && r.error === 'A receipt is a photo (JPG, PNG) or a PDF.', r);
r = await shareholder('erpExpenseReceipt', [{ id: 'nope', file: { data: png, mime: 'image/png' } }]);
check('receipt: unknown entry', !r.ok && r.error === 'That entry was not found.', r);
r = await shareholder('erpExpenseReceipt', [{ id: EXP.id, file: { data: png, mime: 'image/png' } }]);
check('receipt kept', r.ok && r.result.oneoff[0].receipt === true && files.list().some((k) => k.startsWith(FIX.B + '/receipts/' + EXP.id)), files.list());
r = await shareholder('erpExpenseReceipt', [{ id: EXP.id, file: { data: png, mime: 'application/pdf' } }]);
check('a new receipt replaces the old one', r.ok && files.list().filter((k) => k.includes('/receipts/')).length === 1 && files.list().some((k) => /\.pdf$/.test(k)), files.list());
r = await shareholder('erpExpenseReceiptUrl', [{ id: EXP.id }]);
check('receipt link', r.ok && /^https:\/\/files\.test\/.+receipts/.test(r.result.url), r);
r = await mgr('erpExpenseReceiptUrl', [{ id: EXP.id }]);
check('manager cannot open receipts', !r.ok, r);

// ---------------------------------------------------------------- partnership
r = await mgr('erpPartnership', [{}]);
check('manager cannot open Partnership', !r.ok, r);
r = await owner('erpPartnership', [{}]);
check('no pool yet', r.ok && r.result.isPool === false && r.result.pools.length === 0 && r.result.canEdit === true, r.result);
r = await shareholder('erpPoolCreate', [{ name: 'ProtoReen JV' }]);
check('only the owner starts a pool', !r.ok, r);
r = await owner('erpPoolCreate', [{ name: '' }]);
check('pool: name required', !r.ok && r.error === 'Give the joint pool a name.', r);
r = await owner('erpPoolCreate', [{ name: 'ProtoReen JV', displayName: 'Costareen', tier: 'wholesale' }]);
check('pool created with an invite code', r.ok && /^[0-9A-F]{10}$/.test(r.result.code) && !!r.result.id, r);
const POOL = r.result.id, CODE = r.result.code;
r = await owner('erpPartnership', [{}]);
check('own business lists the pool', r.ok && r.result.pools.length === 1 && r.result.pools[0].name === 'ProtoReen JV' && r.result.pools[0].tier === 'wholesale', r.result);
r = await owner('erpBusinesses', []);
check('the pool is not in the business menu (joint-fix-1: it opens from Joint stock)', r.ok && !r.result.businesses.some((b) => b.id === POOL), r.result);

r = await other('erpPoolJoin', [{ code: 'WRONG' }]);
check('join: bad code refused', !r.ok && /invalid, used or expired/.test(r.error), r);
r = await other('erpPoolJoin', [{ code: CODE.toLowerCase(), displayName: 'Partner', tier: 'retail' }]);
check('partner joins with the code', r.ok && r.result.id === POOL && r.result.name === 'ProtoReen JV', r);
r = await other('erpPoolJoin', [{ code: CODE }]);
check('code works once', !r.ok, r);
r = await other('erpPartnership', [{}]);
check('partner sees the pool and the other partner', r.ok && r.result.pools.length === 1 && r.result.partners.length === 1 && r.result.partners[0].name === 'Costareen', r.result);
const A = FIX.B, Bz = B3;

// joint-fix-1 (20 Oct 2026): the pool is never opened as a business; its book is kept from Joint stock
r = await owner('erpPoolEntryAdd', [{ kind: 'capital_in', partner: A, amount: 100 }]);
check('book entries are not written from the own business directly', !r.ok && /Switch to the joint pool first/.test(r.error), r);
r = await owner('erpSetBusiness', [POOL]);
check('the pool cannot be opened as a business', !r.ok && /not opened as a business/.test(r.error), r);
await sql`insert into erp_prefs (user_id, active_business) values (${FIX.U.owner}, ${POOL}) on conflict (user_id) do update set active_business = ${POOL}`;
r = await owner('erpBusinesses', []);
check('...a device that still asks for it gets the own company', r.ok && r.result.active === A && !r.result.businesses.some((b) => b.id === POOL), r.result);
r = await other('erpCreateInvoice', [{ from: POOL, customer: { name: 'Walk In', phone: '01844444444' }, items: [{ sku: 'ANY', qty: 1 }], payMode: 'full' }]);
check('the old "sell from the pool" route is closed', !r.ok && /your own invoice/.test(r.error), r);
r = await other('erpPoolCatalog', [{ pool: POOL }]);
check('...and its catalogue', !r.ok && /normal product search/.test(r.error), r);

r = await owner('erpJoint', [{ pool: POOL }]);
check('Joint stock: two partners, empty book, me', r.ok && r.result.book.isPool && r.result.book.partners.length === 2 && r.result.book.ledger.length === 0 && r.result.book.me === A &&
  r.result.book.report.partners.length === 2 && r.result.book.month === month, r.result && r.result.book);
r = await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 0 }]);
check('entry: amount required', !r.ok && r.error === 'How much? Type an amount above 0.', r);
r = await owner('erpJointBook', [{ pool: POOL, kind: 'transfer', partner: A, to: A, amount: 5 }]);
check('transfer: to the other partner', !r.ok && r.error === 'The cash has to go to the other partner.', r);
r = await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 60000 }]);
r = await other('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: Bz, amount: 40000 }]);
check('both put capital in', r.ok && r.result.book.ledger.length === 2 && r.result.book.report.to_date.capital === 100000, r.result && r.result.book.report);
const P = (rep, name) => rep.partners.find((p) => p.name === name);
check('ratio follows capital: 60 / 40', P(r.result.book.report, 'Costareen').ratio === 0.6 && P(r.result.book.report, 'Partner').ratio === 0.4, r.result.book.report.partners);

// a joint product, sold by each side at their own tier on their own invoice
r = await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'JV-FIL', name: 'JV Filament', category: 'Filaments', brand: 'Sunlu', retail: 150, wholesale: 125, floor: 100, cost: 100 }]);
check('joint product created', r.ok, r);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'JV-FIL', qty: 1000, unitCost: 100, paidBy: A }]);
check('joint stock received (paid by Costareen)', r.ok, r);
const jcat = async (who) => ((await who('erpJointCatalog', [])).result.products || []).find((p) => p.code === 'JV-FIL');
const jo = await jcat(owner), jt = await jcat(other);
check('wholesale partner sees the wholesale price', jo && jo.sell === 125, jo);
check('retail partner sees the retail price', jt && jt.sell === 150, jt);
const SKU = jo.sku;
r = await owner('erpCreateInvoice', [{ customer: { name: 'Shop', phone: '01811111111' }, items: [{ sku: SKU, qty: 100 }], payMode: 'full' }]);
check('Costareen sells 100 at wholesale', r.ok && r.result.grandTotal === 12500, r.result || r);
r = await other('erpCreateInvoice', [{ customer: { name: 'Buyer', phone: '01822222222' }, items: [{ sku: SKU, qty: 100 }], payMode: 'full' }]);
check('Partner sells 100 at retail', r.ok && r.result.grandTotal === 15000, r.result || r);
const book = async (who) => (await (who || owner)('erpJoint', [{ pool: POOL }])).result.book;
let bk = await book();
const rep = bk.report;
check('settlement: revenue, cost, profit', rep.this_month.revenue === 27500 && rep.this_month.cogs === 20000 && rep.this_month.profit === 7500, rep.this_month);
check('settlement: sales by partner', P(rep, 'Costareen').month_sales === 12500 && P(rep, 'Partner').month_sales === 15000, rep.partners);
check('settlement: balances sum to zero, transfers named', rep.balance_check === 0 && rep.transfers.length === 1 && rep.transfers[0].amount > 0, [rep.balance_check, rep.transfers, rep.partners]);
const T = rep.transfers[0];
r = await owner('erpJointBook', [{ pool: POOL, kind: 'transfer', partner: T.from, to: T.to, amount: T.amount }]);
check('after the transfer nobody owes', r.ok && r.result.book.report.transfers.length === 0 && r.result.book.report.partners.every((p) => Math.abs(p.balance) < 0.01), r.result && r.result.book.report.partners);
const L = r.result.book.ledger.find((l) => l.kind === 'transfer');
r = await owner('erpJointBook', [{ pool: POOL, strike: L.id }]);
check('a line is not struck out without a reason', !r.ok && /Say why the line is being struck out/.test(r.error), r);
r = await owner('erpJointBook', [{ pool: POOL, strike: L.id, reason: 'not handed over yet' }]);
check('a wrong line is struck out, not removed, and no longer counts', r.ok && r.result.book.ledger.length === 3 && r.result.book.report.transfers.length === 1 &&
  /^struck out .* by .*: not handed over yet$/.test(r.result.book.ledger.find((l) => l.id === L.id).voided), r.result && r.result.book.ledger);
r = await owner('erpJointBook', [{ pool: POOL, strike: L.id, reason: 'again' }]);
check('...once only', !r.ok && r.error === 'That line is already struck out.', r);
bk = await book(other);
check('the other partner sees the struck-out line and the reason', /not handed over yet/.test(bk.ledger.find((l) => l.id === L.id).voided), bk.ledger);
r = await owner('erpJointAgree', [{ pool: POOL, month }]);
check('a month cannot be closed before it ends', !r.ok && /only be closed after it has ended/.test(r.error), r);
r = await owner('erpJointSettings', [{ pool: POOL, tier: { partner: A, tier: 'retail' } }]);
check('tier can be changed', r.ok && r.result.book.partners.find((p) => p.id === A).tier === 'retail' && (await jcat(owner)).sell === 150, r.result && r.result.book.partners);
r = await owner('erpJointSettings', [{ pool: POOL, invite: true }]);
check('a new invite code', r.ok && r.result.book.invites.length >= 1 && /^[0-9A-F]{10}$/.test(r.result.book.invites[r.result.book.invites.length - 1].code), r.result && r.result.book.invites);

// ---- plan A7: the settlement counts money received, not invoices raised
const before7 = (await book()).report;
r = await other('erpCreateInvoice', [{ customer: { name: 'Credit Buyer', phone: '01833333333' }, items: [{ sku: SKU, qty: 10 }], paymentMethod: 'Cash', paid: 0 }]);
check('Partner sells 10 on credit', r.ok && r.result.grandTotal === 1500 && r.result.thisDue === 1500, r.result || r);
const CR = r.result.invoiceNo;
let rep7 = (await book()).report;
check('a credit sale is profit, but not cash in the seller\'s hands', rep7.to_date.basis === 'cash' && rep7.to_date.receivables === 1500 &&
  P(rep7, 'Partner').collected === P(before7, 'Partner').collected && P(rep7, 'Partner').invoiced === P(before7, 'Partner').invoiced + 1500 &&
  P(rep7, 'Partner').held === P(before7, 'Partner').held && rep7.this_month.revenue === before7.this_month.revenue + 1500, [rep7.to_date, P(rep7, 'Partner')]);
check('what customers owe is shared like the stock: still balanced', rep7.balance_check === 0, rep7.balance_check);
r = await other('erpRecordPayment', [{ orderId: CR, amount: 500, method: 'Cash' }]);
check('Partner takes 500 of it', r.ok, r);
rep7 = (await book()).report;
check('...and now holds 500 more', P(rep7, 'Partner').collected === P(before7, 'Partner').collected + 500 && rep7.to_date.receivables === 1000 && rep7.balance_check === 0, [P(rep7, 'Partner'), rep7.to_date]);
r = await other('erpRecordPayment', [{ orderId: CR, amount: 1000, method: 'Cash' }]);
rep7 = (await book()).report;
check('the rest paid: the seller holds it all, nothing owed', r.ok && P(rep7, 'Partner').collected === P(before7, 'Partner').collected + 1500 &&
  rep7.to_date.receivables === 0 && rep7.balance_check === 0, rep7.partners);

// ---- plan A7: one set of books for the pool's costs
r = await owner('erpJointBook', [{ pool: POOL, kind: 'expense', partner: A, amount: 300, category: 'Packaging', note: 'courier bags' }]);
check('the expense goes in the pool\'s book', r.ok && r.result.book.report.this_month.expenses === 300, r.result && r.result.book.report.this_month);
r = await owner('erpExpenses', [{}]);
check('...and not in Costareen\'s own Expenses', r.ok && !r.result.poolBook, r.result && r.result.poolBook);

// ---- plan B2: one inventory, side by side
await owner('erpPoolShare', [{ share: true }]);   // off by default since 082: the owner chooses to show counts
r = await other('erpSharedStock', []);
const colOf = (res, kind) => res.columns.find((c) => c.kind === kind);
check('one screen: mine, the pool, the partner', r.ok && r.result.shared && r.result.columns.length === 3 && colOf(r.result, 'mine') && colOf(r.result, 'pool').name === 'ProtoReen JV' && colOf(r.result, 'partner').name === 'Costareen', r.result && r.result.columns);
const jv = r.result.rows.find((x) => x.sku === 'JV-FIL'), pla = r.result.rows.find((x) => x.sku === PLA);
check('pool stock counted (1000 received, 210 sold)', jv && jv.qty[colOf(r.result, 'pool').key] === 790 && jv.qty.mine === undefined, jv);
check('the partner\'s shelf beside it, counts only', pla && pla.qty[colOf(r.result, 'partner').key] === 5 && !/cost|price|sell/.test(JSON.stringify(r.result)), pla);
r = await mgr('erpSharedStock', []);
check('staff who are not in the pool see their own stock, and are told why the pool is empty', r.ok && r.result.rows.some((x) => x.sku === PLA && x.qty.mine === 5) &&
  !r.result.rows.some((x) => x.sku === 'JV-FIL') && /only people who are in the pool/.test(colOf(r.result, 'pool').note), r.result && r.result.columns);
r = await other('erpPartnerStock', [{ partner: A }]);
check('partner sees stock counts, never cost or price', r.ok && r.result.products.some((p) => p.sku === PLA && p.stock === 5) && !/cost|price|sell/.test(JSON.stringify(r.result)), r.result);
r = await owner('erpCapital', []);
check('a normal business is not a pool', r.ok && r.result.isPool === false, r.result && r.result.isPool);
r = await owner('erpPoolShare', [{ share: false }]);
check('sharing switched off', r.ok && r.result.sharesStock === false, r.result);
r = await other('erpPartnerStock', [{ partner: A }]);
check('...and the partner no longer sees the shelf', !r.ok && /does not share/.test(r.error), r);
r = await other('erpSharedStock', []);
check('...and the one screen says so instead of showing it', r.ok && /does not share/.test(colOf(r.result, 'partner').note) && !r.result.rows.some((x) => x.sku === PLA), r.result && r.result.columns);
r = await other('erpPartnerDeal', [{ action: 'record', partner: A, side: 'theirs', description: '', amount: 500 }]);
check('deal: what was sold', !r.ok && r.error === 'What was sold? A few words is enough.', r);
r = await other('erpPartnerDeal', [{ action: 'record', partner: A, side: 'theirs', description: '2 rolls PLA black', amount: 2500, qty: 2 }]);
check('partner records a sale of Costareen stock', r.ok && r.result.deals.length === 1 && r.result.deals[0].owedToMe === false && r.result.deals[0].confirmed === false, r.result && r.result.deals);
r = await owner('erpPartnership', [{}]);
const D = r.result.deals[0];
check('Costareen sees it, owed to them, waiting for their yes', D.owedToMe === true && D.mineToConfirm === true && D.amount === 2500 && D.other === 'Partner', D);
r = await owner('erpPartnerDeal', [{ action: 'confirm', id: D.id }]);
check('confirmed', r.ok && r.result.deals[0].confirmed === true && r.result.deals[0].settled === false, r.result && r.result.deals);
r = await owner('erpPartnerDeal', [{ action: 'paid', id: D.id }]);
check('marked paid by the side that is owed', r.ok && r.result.deals[0].settled === true, r.result && r.result.deals);
// ---- plan B3: a partner item with its product code moves the stock, through a real invoice
const stockA = async () => Number((await sql`select ps.stock from products p join product_stock ps on ps.product_id = p.id where p.business_id = ${A} and p.sku = ${PLA}`)[0].stock);
const s0 = await stockA();
r = await other('erpPartnerDeal', [{ action: 'record', partner: A, side: 'theirs', sku: PLA, description: '2 rolls PLA black', amount: 2400, qty: 2 }]);
const mineD = r.ok && r.result.deals.find((d) => d.sku === PLA);
check('a request names the product; nothing moves yet', mineD && !mineD.stockMoved && mineD.invoiceNo === '' && (await stockA()) === s0, mineD);
r = await owner('erpPartnerDeal', [{ action: 'confirm', id: mineD.id }]);
const conf = r.ok && r.result.deals.find((d) => d.id === mineD.id);
check('the stock owner confirms: an invoice to the partner at the agreed price, stock down', conf && conf.confirmed && /^INV-/.test(conf.invoiceNo) && (await stockA()) === s0 - 2, conf || r);
const di = (await sql`select grand_total, due_amount, customer_name from invoices where business_id = ${A} and invoice_no = ${conf.invoiceNo}`)[0];
check('...2400 owed by "Partner (partner)"', di && Number(di.grand_total) === 2400 && di.customer_name === 'Partner (partner)', di);
r = await other('erpPartnership', [{}]);
check('the other side sees that the stock moved, not the invoice number', r.result.deals.find((d) => d.id === mineD.id).stockMoved === true && r.result.deals.find((d) => d.id === mineD.id).invoiceNo === '', r.result.deals[0]);
r = await owner('erpPartnerDeal', [{ action: 'paid', id: mineD.id, method: 'Cash' }]);
const paidRow = await sql`select coalesce(sum(amount), 0)::float as s from payments where business_id = ${A} and invoice_no = ${conf.invoiceNo}`;
check('"paid" receives the money on that invoice', r.ok && r.result.deals.find((d) => d.id === mineD.id).settled && paidRow[0].s === 2400, paidRow);
r = await owner('erpPartnerDeal', [{ action: 'record', partner: Bz, side: 'mine', sku: 'NOPE-1', description: 'x', amount: 100 }]);
check('my own stock: the code must exist', !r.ok && /no product with the code NOPE-1/.test(r.error), r);
r = await owner('erpPartnerDeal', [{ action: 'record', partner: Bz, side: 'mine', sku: PLA, description: '1 roll PLA black', amount: 1000, qty: 1 }]);
const own = r.ok && r.result.deals.find((d) => d.sku === PLA && !d.confirmed);
check('recorded by the stock owner: the stock leaves at once', own && /^INV-/.test(own.invoiceNo) && (await stockA()) === s0 - 3, own || r);
r = await owner('erpPartnerDeal', [{ action: 'cancel', id: own.id }]);
check('...so it cannot simply be withdrawn', !r.ok && /already left on invoice INV-/.test(r.error), r);
r = await owner('erpPartnerDeal', [{ action: 'record', partner: Bz, side: 'mine', sku: PLA, description: 'too many', amount: 100, qty: 999 }]);
check('not enough stock: refused, and no deal is left behind', !r.ok && /Not enough stock/.test(r.error) && (await owner('erpPartnership', [{}])).result.deals.every((d) => d.what !== 'too many'), r);
r = await sales('erpPartnership', [{}]);
check('sales staff see none of it', !r.ok, r);

await done();
