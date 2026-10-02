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
check('a wrong line can be taken out', r.ok && r.result.ledger.length === 2 && r.result.report.transfers.length === 1, r.result && r.result.ledger);
r = await owner('erpPoolClose', [{ month }]);
check('a month cannot be closed before it ends', !r.ok && /only be closed after it has ended/.test(r.error), r);
r = await owner('erpPoolTier', [{ partner: A, tier: 'retail' }]);
check('tier can be changed', r.ok && r.result.partners.find((p) => p.id === A).tier === 'retail' && (await owner('erpCatalog', [])).result.find((p) => p.sku === SKU).sell === 150, r.result);
r = await owner('erpPoolInvite', []);
check('a new invite code', r.ok && r.result.invites.length === 1 && /^[0-9A-F]{10}$/.test(r.result.invites[0].code), r.result && r.result.invites);

// back in their own businesses: stock counts and deals
await owner('erpSetBusiness', [A]);
await other('erpSetBusiness', [Bz]);
r = await other('erpPartnerStock', [{ partner: A }]);
check('partner sees stock counts, never cost or price', r.ok && r.result.products.some((p) => p.sku === PLA && p.stock === 5) && !/cost|price|sell/.test(JSON.stringify(r.result)), r.result);
r = await owner('erpPoolShare', [{ share: false }]);
check('sharing switched off', r.ok && r.result.sharesStock === false, r.result);
r = await other('erpPartnerStock', [{ partner: A }]);
check('...and the partner no longer sees the shelf', !r.ok && /does not share/.test(r.error), r);
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
r = await sales('erpPartnership', [{}]);
check('sales staff see none of it', !r.ok, r);

await done();
