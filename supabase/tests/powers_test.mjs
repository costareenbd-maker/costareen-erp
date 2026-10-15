// Abilities per person (058_user_powers.sql): the owner switches single abilities on or off for a
// person on top of their role, and sets their own discount limit. Every ability, switched on for a
// sales account, must really open its calls (no role check left behind inside a handler).
import { owner, mgr, sales, sql, FIX, check, done } from './harness.mjs';
const B = FIX.B, PLA = 'FIL-SUN-PLA-BLA-001';
const SALES = FIX.U.sales, MGR = FIX.U.mgr;
const set = (userId, powers) => owner('erpUserPowers', [{ userId, powers }]);
const hello = (fn) => fn('erpHello', []);

// 1. the list the owner sees
let r = await owner('erpUsers', []);
const rina = r.ok && r.result.users.find((u) => u.id === SALES);
check('users list carries the abilities and each person\'s', r.ok && r.result.abilities.length === 14 && rina && rina.powers.list.dash.on === false && rina.powers.discount === 100, r.ok ? [r.result.abilities.length, rina && rina.powers] : r);

// 2. before: sales cannot open a manager screen
r = await sales('erpStockHistory', []);
check('sales: stock history closed by default', !r.ok, r.ok);

// 3. switch everything on for sales and try one call of each ability
r = await set(SALES, { dash: true, costs: true, lists: true, profit: true, expenses: true, stock: true, suppliers: true,
  weborders: true, campaigns: true, products: true, returns: true, dues: true, discount: 50 });
check('owner switches abilities on', r.ok && r.result.users.find((u) => u.id === SALES).powers.list.stock.on === true, r.error);
const h = await hello(sales);
check('hello tells the page: abilities and the own discount limit', h.ok && h.result.powers.stock === true && !('void' in h.result.powers) && h.result.discountCap === 50, h.result);

const tries = [
  ['dash', 'erpDashboardData', []],
  ['costs', 'erpCostBook', []],
  ['lists', 'erpSettingsFull', []],
  ['profit', 'erpPnl', []],
  ['expenses', 'erpExpenses', [{}]],
  ['stock', 'erpStockHistory', []],
  ['suppliers', 'erpSuppliers', []],
  ['suppliers PO', 'erpPoList', []],
  ['weborders', 'erpWebOrders', []],
  ['campaigns', 'erpCampaignList', []],
  ['dues', 'erpDues', []],
];
for (const [label, name, args] of tries) {
  r = await sales(name, args);
  check('sales with "' + label + '" on: ' + name + ' opens', r.ok, r.error);
}
r = await sales('erpExpenseAdd', [{ amount: 500, description: 'tea', category: 'Miscellaneous' }]);
check('sales with "expenses" on: adds an expense', r.ok, r.error);
r = await sales('erpPoCreate', [{ supplier: 'Sunlu', lines: [{ sku: PLA, qty: 5, price: 900 }] }]);
check('sales with "suppliers" on: places an order (no role check left inside)', r.ok || !/cannot place orders|does not have access/.test(r.error), r.error);
r = await sales('erpDashboardData', []);
check('...and the dashboard has its money figures', r.ok && !r.result.hideProfit, r.ok && Object.keys(r.result).slice(0, 12));
r = await sales('erpProductPage', [{ sku: PLA }]);
check('...and the product page shows money', r.ok && r.result.canSeeMoney === true, r.ok ? r.result.canSeeMoney : r.error);
r = await sales('erpBundle', [['settings', 'costs']]);
check('...and the bundle hands over settings lists and the cost book', r.ok && r.result.settings && r.result.costs, r.result && r.result.errors);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Power Buyer', phone: '01799500001' }, items: [{ sku: PLA, qty: 2 }], invoiceDiscount: 1200, payMode: 'full', paymentMethod: 'Cash' }]);
check('sales with own limit 50%: 44% saved', r.ok, r.error);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Power Buyer', phone: '01799500001' }, items: [{ sku: PLA, qty: 2 }], invoiceDiscount: 1500, payMode: 'full', paymentMethod: 'Cash' }]);
check('...55% refused at 50%', !r.ok && /Your limit is 50%/.test(r.error), r.error);

// 4. take an ability away from a manager
r = await mgr('erpStockHistory', []);
check('manager: stock open by role', r.ok, r.error);
r = await set(MGR, { stock: false, costs: false });
r = await mgr('erpStockHistory', []);
check('manager with stock switched off: refused', !r.ok, r.ok);
r = await mgr('erpProductPage', [{ sku: PLA }]);
check('manager with costs switched off: product page hides money', r.ok && r.result.canSeeMoney === false, r.ok ? r.result.canSeeMoney : r.error);
r = await mgr('erpBundle', [['costs']]);
check('...and no cost book through the bundle', r.ok && !r.result.costs, r.result);

// 5. back to the role default; a switch equal to the role is not stored
r = await set(MGR, { stock: null, costs: true });
const row = (await sql`select powers from memberships where business_id = ${B} and user_id = ${MGR}`)[0];
check('switches equal to the role are not stored', row && Object.keys(row.powers).length === 0, row);
r = await mgr('erpStockHistory', []);
check('manager: stock open again', r.ok, r.error);

// 6. refusals
r = await mgr('erpUserPowers', [{ userId: SALES, powers: { dash: true } }]);
check('only the owner sets abilities', !r.ok, r.ok);
r = await set(FIX.U.owner, { dash: false });
check('an owner cannot be limited', !r.ok && /always has every ability/.test(r.error), r.error);
r = await set(SALES, { flying: true });
check('unknown ability refused', !r.ok && /Unknown ability/.test(r.error), r.error);
r = await set(SALES, { discount: 150 });
check('discount above 100 refused', !r.ok, r.ok);
r = await set(SALES, { discount: null });
const h2 = await hello(sales);
check('discount back to the role\'s default: no limit', h2.ok && h2.result.discountCap === 100, h2.result);
// 7. 'act': the manager does every action the owner does, but never sees the figures or touches people
r = await mgr('erpExpenses', [{}]);
check('act off: manager has no expenses', !r.ok, r.ok);
r = await mgr('erpPoSettle', [{ supplier: 'Nobody Ltd', note: 'x' }]);
check('act off: manager cannot settle a supplier', !r.ok, r.ok);
r = await set(MGR, { act: true });
check('owner switches every action on for the manager', r.ok && r.result.users.find((u) => u.id === MGR).powers.list.act.on === true, r.error);
const ha = await hello(mgr);
check('hello: act on, dashboard and profit still off', ha.ok && ha.result.powers.act === true && ha.result.powers.dash === false && ha.result.powers.profit === false && ha.result.powers.expenses === true, ha.result);
for (const [name, args] of [['erpExpenses', [{}]], ['erpSupplierPage', [{ name: 'Nobody Ltd' }]], ['erpCommission', [{}]], ['erpSettingsFull', []]]) {
  r = await mgr(name, args);
  check('act on: ' + name + ' opens', r.ok || !/does not have access/.test(r.error), r.error);
}
r = await mgr('erpSettingsFull', []);
check('act on: business settings come with the lists', r.ok && r.result.config.length > 0, r.ok ? r.result.config.length : r.error);
r = await mgr('erpPoSettle', [{ supplier: 'Nobody Ltd', note: 'x' }]);
check('act on: the settle check inside lets the manager through', !r.ok ? !/Only the owner or a shareholder/.test(r.error) && !/does not have access/.test(r.error) : true, r.error);
r = await mgr('erpSerialWarranty', [{ serial: 'NOPE-1', sku: PLA, months: 3, reason: 'x' }]);
check('act on: warranty change not refused for the role', r.ok || !/Only a shareholder/.test(r.error), r.error);
for (const name of ['erpDashboardData', 'erpFdDash', 'erpPnl', 'erpPnlMonth', 'erpMoney', 'erpCashBook', 'erpCapital', 'erpAnalytics',
  'erpUsers', 'erpUserPowers', 'erpSecurity', 'erpAccessKeys', 'erpAppSet', 'erpRestore', 'erpOwnerChange']) {
  r = await mgr(name, name === 'erpPnlMonth' ? [{ month: '2026-10' }] : [{}]);
  check('act on: ' + name + ' still closed', !r.ok && /does not have access/.test(r.error), r.ok || r.error);
}
r = await mgr('erpUserPowers', [{ userId: MGR, powers: { dash: true } }]);
check('act on: cannot give himself the dashboard', !r.ok, r.ok);
r = await mgr('erpRecentInvoices', [{}]);
check('act on: invoice money still scrubbed of profit', r.ok && !JSON.stringify(r.result).match(/"(profit|margin|cogs)":\s*[1-9]/), r.ok ? '' : r.error);
r = await set(MGR, { act: false });
r = await mgr('erpExpenses', [{}]);
check('act off again: expenses closed', !r.ok, r.ok);

// 8. the Inbox per person: on for everyone by default, the owner switches it off for one
r = await sales('erpInbox', [{}]);
check('inbox: sales reads chats by default', r.ok || !/does not have access/.test(r.error), r.error);
r = await set(SALES, { inbox: false });
r = await sales('erpInbox', [{}]);
check('inbox: switched off for one person, closed', !r.ok && /does not have access/.test(r.error), r.ok || r.error);
r = await sales('erpInboxSend', [{ id: '00000000-0000-0000-0000-000000000000', text: 'x' }]);
check('inbox: and cannot reply', !r.ok && /does not have access/.test(r.error), r.ok || r.error);
r = await set(SALES, { inbox: null });
r = await sales('erpInbox', [{}]);
check('inbox: back to the role, open again', r.ok || !/does not have access/.test(r.error), r.error);

await done();
