// Plan A2: one net profit. Profitability, Expenses, Dashboard and Capital must show the same figure.
import { sql, FIX, owner, mgr, shareholder, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();
const PLA = 'FIL-SUN-PLA-BLA-001';
const now = new Date(Date.now() + 6 * 3600e3);
const month = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
await sql`update invoice_lines l set unit_cost = p.cost_price from products p
          where coalesce(l.unit_cost, 0) = 0 and p.cost_price > 0 and p.business_id = l.business_id and lower(btrim(p.sku)) = lower(btrim(l.sku))`;

// a sale with a delivery charge, an expense, what the courier kept, and a courier difference
let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678', address: 'Dhaka' }, items: [{ sku: PLA, qty: 2 }], delivery: 120, payMode: 'full' }]);
check('fixture: sale with delivery', r.ok, r);
r = await shareholder('erpExpenseAdd', [{ amount: 500, description: 'tea', category: 'Miscellaneous' }]);
check('fixture: expense', r.ok, r);
await sql`insert into courier_payouts (business_id, payout_id, created_src, paid_at, delivery_charges, cod_fee) values (${FIX.B}, 'P-1', ${month + '-02'}, ${month + '-02'}, 70, 10)`;
await sql`insert into courier_recon (business_id, consignment_id, action, amount, at) values (${FIX.B}, 'C-1', 'writeoff', 30, now()), (${FIX.B}, 'C-2', 'extra', 5, now())`;
await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Rahman', pct: 100, since: month }]);

const pnl = (await owner('erpPnl', [{ months: 1 }])).result.months[0];
const want = pnl.gross + pnl.delivery + pnl.courierExtra - pnl.courierShort - pnl.courier - pnl.expenses;
check('the statement adds up, with delivery and courier in it', pnl.net === want && pnl.courier === 80 && pnl.courierShort === 30 && pnl.courierExtra === 5 && pnl.expenses === 500, pnl);
const exp = (await owner('erpExpenses', [{ month }])).result;
check('Expenses screen: the same net profit', exp.net === pnl.net && exp.gross === pnl.gross && exp.goodsCost === pnl.cost && exp.revenue === pnl.netSales, [exp.net, pnl.net]);
check('...and it says what lies between gross and net', exp.other === pnl.delivery + pnl.courierExtra - pnl.courierShort - pnl.courier && exp.delivery === pnl.delivery && exp.courier === 80, exp);
const dash = (await owner('erpBundle', [['dash'], { fresh: true }])).result.dash.profit;
check('Dashboard: the same net profit', dash.monthNet === pnl.net && dash.monthGross === pnl.gross, [dash, pnl.net]);
const cap = (await owner('erpCapital', [])).result;
check('Capital: the same net profit, credited to the shareholder', cap.months.find((m) => m.month === month).net === pnl.net && cap.holders[0].earned === pnl.net, [cap.months, cap.holders]);
check('the old figure (gross less expenses) is no longer what anyone is credited with', pnl.gross - pnl.expenses !== pnl.net);

await done();
