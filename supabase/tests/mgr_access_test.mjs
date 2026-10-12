// Manager access (2026-10-05): no discount limit for manager/owner, sales up to 20%; a manager opens
// Settings -> Lists and the product cost book, but not the business's own values or the dashboard figures.
import { owner, mgr, sales, check, done } from './harness.mjs';
const PLA = 'FIL-SUN-PLA-BLA-001';
const sale = (fn, disc) => fn('erpCreateInvoice', [{ customer: { name: 'Disc Buyer', phone: '01799400001' }, items: [{ sku: PLA, qty: 2 }], invoiceDiscount: disc, payMode: 'full', paymentMethod: 'Cash' }]);

let r = await sale(mgr, 2000);
check('manager: a 74% discount is saved', r.ok, r.error);
r = await sale(sales, 500);
check('sales: 18.5% is saved', r.ok, r.error);
r = await sale(sales, 600);
check('sales: 22.2% is saved too (no default limit since 14 Oct 2026)', r.ok, r.error);

r = await mgr('erpBundle', [['settings', 'costs']]);
check('manager: settings part gives the lists, no business values', r.ok && r.result.settings && r.result.settings.lists && r.result.settings.config.length === 0, r.result && r.result.errors);
check('manager: the cost book opens', r.ok && Array.isArray(r.result.costs) || (r.result.costs && typeof r.result.costs === 'object'), r.result && r.result.errors);
r = await mgr('erpLookupAdd', ['categories', 'Mgr Added Cat']);
check('manager: can add to a drop-down list', r.ok, r.error);
r = await mgr('erpConfigSet', ['business_name', 'Hacked']);
check('manager: cannot change the business values', !r.ok, r);
r = await mgr('erpDashboardData', []);
check('manager: no dashboard figures', !r.ok, r.ok);

r = await sales('erpBundle', [['settings', 'costs']]);
check('sales: settings and costs parts refused', r.ok && !r.result.settings && !r.result.costs && r.result.errors.settings && r.result.errors.costs, r.result);
r = await owner('erpBundle', [['settings']]);
check('owner: still sees the business values', r.ok && r.result.settings.config.length > 0, r.result && r.result.errors);
r = await mgr('erpCurrencySave', [{ code: 'USD', rate: 121 }]);
check('manager: can set a currency rate on the cost page', r.ok, r.error);
await done();
