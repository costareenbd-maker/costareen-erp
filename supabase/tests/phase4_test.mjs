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
check('pool is in the business menu, marked', r.ok && r.result.businesses.some((b) => b.id === POOL && b.pool === true), r.result);

r = await other('erpPoolJoin', [{ code: 'WRONG' }]);
check('join: bad code refused', !r.ok && /invalid, used or expired/.test(r.error), r);
r = await other('erpPoolJoin', [{ code: CODE.toLowerCase(), displayName: 'Partner', tier: 'retail' }]);
check('partner joins with the code', r.ok && r.result.id === POOL && r.result.name === 'ProtoReen JV', r);
r = await other('erpPoolJoin', [{ code: CODE }]);
check('code works once', !r.ok, r);
r = await other('erpPartnership', [{}]);
check('partner sees the pool and the other partner', r.ok && r.result.pools.length === 1 && r.result.partners.length === 1 && r.result.partners[0].name === 'Costareen', r.result);
const A = FIX.B, Bz = B3;

// inside the pool
r = await owner('erpPoolEntryAdd', [{ kind: 'capital_in', partner: A, amount: 100 }]);
check('book entries are written inside the pool', !r.ok && /Switch to the joint pool first/.test(r.error), r);
await owner('erpSetBusiness', [POOL]);
await other('erpSetBusiness', [POOL]);
r = await owner('erpPartnership', [{}]);
check('pool view: two partners, empty book, me', r.ok && r.result.isPool && r.result.partners.length === 2 && r.result.ledger.length === 0 && r.result.me === A &&
  r.result.report.partners.length === 2 && r.result.month === month, r.result);
r = await owner('erpPoolEntryAdd', [{ kind: 'capital_in', partner: A, amount: 0 }]);
check('entry: amount required', !r.ok && r.error === 'How much? Type an amount above 0.', r);
r = await owner('erpPoolEntryAdd', [{ kind: 'transfer', partner: A, to: A, amount: 5 }]);
check('transfer: to the other partner', !r.ok && r.error === 'The cash has to go to the other partner.', r);
r = await owner('erpPoolEntryAdd', [{ kind: 'capital_in', partner: A, amount: 60000 }]);
r = await other('erpPoolEntryAdd', [{ kind: 'capital_in', partner: Bz, amount: 40000 }]);
check('both put capital in', r.ok && r.result.ledger.length === 2 && r.result.report.to_date.capital === 100000, r.result && r.result.report);
const P = (rep, name) => rep.partners.find((p) => p.name === name);
check('ratio follows capital: 60 / 40', P(r.result.report, 'Costareen').ratio === 0.6 && P(r.result.report, 'Partner').ratio === 0.4, r.result.report.partners);

// a pool product, sold by each side at their own tier
r = await owner('erpSaveProduct', [{ isNew: true, product_name: 'JV Filament', category: 'Filaments', brand: 'Sunlu', unit: 'Roll', cost_price: 100, sell_price: 150, opening_stock: 0, status: 'Active' }]);
check('pool product created', r.ok, r);
const SKU = r.result.sku;
await sql`update products set wholesale_price = 125 where business_id = ${POOL} and sku = ${SKU}`;
r = await owner('erpReceiveShipment', [{ reference: 'JV-1', mode: 'bdt', totalBdt: 100000, lines: [{ sku: SKU, qty: 1000 }] }]);
check('pool stock received (paid by Costareen)', r.ok, r);
r = await owner('erpCatalog', []);
check('wholesale partner sees the wholesale price', r.ok && r.result.find((p) => p.sku === SKU).sell === 125, r.result);
r = await other('erpCatalog', []);
check('retail partner sees the retail price', r.ok && r.result.find((p) => p.sku === SKU).sell === 150, r.result);
r = await owner('erpCreateInvoice', [{ customer: { name: 'Shop', phone: '01811111111' }, items: [{ sku: SKU, qty: 100 }], payMode: 'full' }]);
check('Costareen sells 100 at wholesale', r.ok && r.result.grandTotal === 12500, r.result);
r = await other('erpCreateInvoice', [{ customer: { name: 'Buyer', phone: '01822222222' }, items: [{ sku: SKU, qty: 100 }], payMode: 'full' }]);
check('Partner sells 100 at retail', r.ok && r.result.grandTotal === 15000, r.result);
r = await owner('erpPartnership', [{}]);
const rep = r.result.report;
check('settlement: revenue, cost, profit', rep.this_month.revenue === 27500 && rep.this_month.cogs === 20000 && rep.this_month.profit === 7500, rep.this_month);
check('settlement: sales by partner', P(rep, 'Costareen').month_sales === 12500 && P(rep, 'Partner').month_sales === 15000, rep.partners);
check('settlement: balances sum to zero, transfers named', rep.balance_check === 0 && rep.transfers.length === 1 && rep.transfers[0].amount > 0, [rep.balance_check, rep.transfers, rep.partners]);
const T = rep.transfers[0];
r = await owner('erpPoolEntryAdd', [{ kind: 'transfer', partner: T.from, to: T.to, amount: T.amount }]);
check('after the transfer nobody owes', r.ok && r.result.report.transfers.length === 0 && r.result.report.partners.every((p) => Math.abs(p.balance) < 0.01), r.result && r.result.report.partners);
const L = r.result.ledger.find((l) => l.kind === 'transfer');
r = await owner('erpPoolEntryRemove', [{ id: L.id }]);
check('a line is not struck out without a reason', !r.ok && /Say why the line is being struck out/.test(r.error), r);
r = await owner('erpPoolEntryRemove', [{ id: L.id, reason: 'not handed over yet' }]);
check('a wrong line is struck out, not removed, and no longer counts', r.ok && r.result.ledger.length === 3 && r.result.report.transfers.length === 1 &&
  /^struck out .* by .*: not handed over yet$/.test(r.result.ledger.find((l) => l.id === L.id).voided), r.result && r.result.ledger);
r = await owner('erpPoolEntryRemove', [{ id: L.id, reason: 'again' }]);
check('...once only', !r.ok && r.error === 'That line is already struck out.', r);
r = await other('erpPartnership', [{}]);
check('the other partner sees the struck-out line and the reason', r.ok && /not handed over yet/.test(r.result.ledger.find((l) => l.id === L.id).voided), r.result && r.result.ledger);
r = await owner('erpPoolClose', [{ month }]);
check('a month cannot be closed before it ends', !r.ok && /only be closed after it has ended/.test(r.error), r);
r = await owner('erpPoolTier', [{ partner: A, tier: 'retail' }]);
check('tier can be changed', r.ok && r.result.partners.find((p) => p.id === A).tier === 'retail' && (await owner('erpCatalog', [])).result.find((p) => p.sku === SKU).sell === 150, r.result);
r = await owner('erpPoolInvite', []);
check('a new invite code', r.ok && r.result.invites.length === 1 && /^[0-9A-F]{10}$/.test(r.result.invites[0].code), r.result && r.result.invites);

// ---- plan A7: the settlement counts money received, not invoices raised
const before7 = (await owner('erpPartnership', [{}])).result.report;
r = await other('erpCreateInvoice', [{ customer: { name: 'Credit Buyer', phone: '01833333333' }, items: [{ sku: SKU, qty: 10 }], paymentMethod: 'Cash', paid: 0 }]);
check('Partner sells 10 on credit', r.ok && r.result.grandTotal === 1500 && r.result.thisDue === 1500, r.result);
const CR = r.result.invoiceNo;
r = await owner('erpPartnership', [{}]);
let rep7 = r.result.report;
check('a credit sale is profit, but not cash in the seller\'s hands', rep7.to_date.basis === 'cash' && rep7.to_date.receivables === 1500 &&
  P(rep7, 'Partner').collected === P(before7, 'Partner').collected && P(rep7, 'Partner').invoiced === P(before7, 'Partner').invoiced + 1500 &&
  P(rep7, 'Partner').held === P(before7, 'Partner').held && rep7.this_month.revenue === before7.this_month.revenue + 1500, [rep7.to_date, P(rep7, 'Partner')]);
check('what customers owe is shared like the stock: still balanced', rep7.balance_check === 0, rep7.balance_check);
r = await other('erpRecordPayment', [{ orderId: CR, amount: 500, method: 'Cash' }]);
check('Partner takes 500 of it', r.ok, r);
rep7 = (await owner('erpPartnership', [{}])).result.report;
check('...and now holds 500 more', P(rep7, 'Partner').collected === P(before7, 'Partner').collected + 500 && rep7.to_date.receivables === 1000 && rep7.balance_check === 0, [P(rep7, 'Partner'), rep7.to_date]);
r = await owner('erpRecordPayment', [{ orderId: CR, amount: 1000, method: 'Cash' }]);
rep7 = (await owner('erpPartnership', [{}])).result.report;
check('the rest is paid to Costareen: whoever takes the money holds it', r.ok && P(rep7, 'Costareen').collected === P(before7, 'Costareen').collected + 1000 &&
  P(rep7, 'Partner').collected === P(before7, 'Partner').collected + 500 && rep7.to_date.receivables === 0 && rep7.balance_check === 0, rep7.partners);

// ---- plan A7: one set of books for the pool's costs
r = await owner('erpExpenseAdd', [{ amount: 300, description: 'courier bags' }]);
check('the normal Expenses screen is closed inside a pool', !r.ok && /joint pool: its expenses are written in the pool/.test(r.error), r);
r = await owner('erpPoolEntryAdd', [{ kind: 'expense', partner: A, amount: 300, category: 'Packaging', note: 'courier bags' }]);
check('the expense goes in the pool\'s book', r.ok && r.result.report.this_month.expenses === 300, r.result && r.result.report.this_month);
r = await owner('erpPnl', [{ months: 1 }]);
check('the pool\'s profit screen reads the same book', r.ok && r.result.months[0].byCat.Packaging === 300 && r.result.months[0].expenses === 300, r.result && r.result.months[0]);
r = await owner('erpExpenses', [{}]);
check('the Expenses screen says so, with the same total', r.ok && r.result.poolBook === true && r.result.poolExpenses === 300 && r.result.total === 300, r.result && [r.result.poolBook, r.result.total]);
r = await owner('erpCapital', []);
check('Capital inside a pool points to Partnership', r.ok && r.result.isPool === true, r.result && r.result.isPool);
r = await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Someone', pct: 50 }]);
check('...and takes no shareholders of its own', !r.ok && /joint pool/.test(r.error), r);

// back in their own businesses: stock counts and deals
await owner('erpSetBusiness', [A]);
await other('erpSetBusiness', [Bz]);
// ---- plan B3: sell from the pool without switching business
r = await other('erpPoolCatalog', [{ pool: POOL }]);
check('the pool catalogue from my own business, at my tier', r.ok && r.result.name === 'ProtoReen JV' && r.result.products.find((p) => p.sku === SKU).sell === 150, r.result && r.result.name);
r = await mgr('erpPoolCatalog', [{ pool: POOL }]);
check('staff who are not in the pool cannot', !r.ok && /not one you are in/.test(r.error), r);
r = await other('erpPoolCatalog', [{ pool: A }]);
check('...and a normal business is not a pool to sell from', !r.ok && /not one you are in/.test(r.error), r);
const poolBefore = (await sql`select count(*)::int n from invoices where business_id = ${POOL}`)[0].n;
const ownBefore = (await sql`select count(*)::int n from invoices where business_id = ${Bz}`)[0].n;
r = await other('erpCreateInvoice', [{ from: POOL, customer: { name: 'Walk In', phone: '01844444444' }, items: [{ sku: SKU, qty: 2 }], payMode: 'full' }]);
check('a sale "from the pool" made inside my own business', r.ok && r.result.soldFrom === 'ProtoReen JV' && r.result.grandTotal === 300, r.result);
const poolInv = await sql`select sold_by from invoices where business_id = ${POOL} and invoice_no = ${r.ok ? r.result.invoiceNo : ''}`;
check('...is the pool\'s invoice, sold by me, and nothing lands in my own books', poolInv.length === 1 && poolInv[0].sold_by === Bz &&
  (await sql`select count(*)::int n from invoices where business_id = ${POOL}`)[0].n === poolBefore + 1 &&
  (await sql`select count(*)::int n from invoices where business_id = ${Bz}`)[0].n === ownBefore, poolInv);
r = await mgr('erpCreateInvoice', [{ from: POOL, customer: { name: 'X', phone: '01855555555' }, items: [{ sku: SKU, qty: 1 }], payMode: 'full' }]);
check('staff outside the pool cannot sell from it', !r.ok && /not one you are in/.test(r.error), r);

// ---- plan B2: one inventory, side by side
await owner('erpPoolShare', [{ share: true }]);   // off by default since 082: the owner chooses to show counts
r = await other('erpSharedStock', []);
const colOf = (res, kind) => res.columns.find((c) => c.kind === kind);
check('one screen: mine, the pool, the partner', r.ok && r.result.shared && r.result.columns.length === 3 && colOf(r.result, 'mine') && colOf(r.result, 'pool').name === 'ProtoReen JV' && colOf(r.result, 'partner').name === 'Costareen', r.result && r.result.columns);
const jv = r.result.rows.find((x) => x.sku === SKU), pla = r.result.rows.find((x) => x.sku === PLA);
check('pool stock counted (1000 received, 212 sold)', jv && jv.qty[colOf(r.result, 'pool').key] === 788 && jv.qty.mine === undefined, jv);
check('the partner\'s shelf beside it, counts only', pla && pla.qty[colOf(r.result, 'partner').key] === 5 && !/cost|price|sell/.test(JSON.stringify(r.result)), pla);
r = await mgr('erpSharedStock', []);
check('staff who are not in the pool see their own stock, and are told why the pool is empty', r.ok && r.result.rows.some((x) => x.sku === PLA && x.qty.mine === 5) &&
  !r.result.rows.some((x) => x.sku === SKU) && /only people who are in the pool/.test(colOf(r.result, 'pool').note), r.result && r.result.columns);
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
