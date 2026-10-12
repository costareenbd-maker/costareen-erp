// FilaDash merge P4: the four cards on our own screens (erpFdHead, handlers/fddash.js).
// Run: TEST_SCRIPT=p4head_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const head = async (who, view) => { const x = await who('erpFdHead', [{ view }]); return x.ok ? Object.fromEntries(x.result.cards.map((c) => [c.key, c])) : x; };

// a little of everything
await sql`insert into web_orders (business_id, order_no, order_date, status, customer_name, order_total) values
  (${B}, 'W-1', now(), 'processing', 'Web Buyer', 2500), (${B}, 'W-2', now(), 'processing', 'Web Buyer 2', 1500)`;
await sql`insert into service_jobs (business_id, job_no, status, charge, received_at) values
  (${B}, 'J-1', 'received', 0, now()), (${B}, 'J-2', 'repaired', 1200, now()), (${B}, 'J-3', 'returned', 800, now())`.catch((e) => console.log('jobs:', e.message));
await sql`insert into suppliers (business_id, name) values (${B}, 'Head Supplier')`.catch(() => {});
await sql`insert into supplier_bills (business_id, supplier, amount) values (${B}, 'Head Supplier', 5000)`;
await sql`insert into supplier_payments (business_id, supplier, amount) values (${B}, 'Head Supplier', 2000)`;

let h = await head(owner, 'weborders');
check('web orders: 2 waiting worth 4000, this month 2', h.waiting && h.waiting.v === 2 && h.waitingValue.v === 4000 && h.orders.v >= 2, h);
h = await head(owner, 'repairs');
check('repairs: 1 in, 1 to collect, 1 handed back for 800', h.open && h.open.v === 1 && h.ready.v === 1 && h.done.v === 1 && h.income.v === 800, h);
h = await head(owner, 'suppliers');
check('suppliers: we owe 3000', h.owed && h.owed.v === 3000 && h.owed.money, h);
h = await head(owner, 'quotes');
check('quotations: the four cards', h.quotes && h.value && h.ready && h.drafts, h);
h = await head(owner, 'printjobs');
check('print jobs: the four cards', h.open && h.ready && h.value && h.failed, h);
h = await head(owner, 'campaigns');
check('campaigns: the four cards', h.campaigns && h.sent && h.leads && h.optouts, h);
h = await head(owner, 'costs');
check('product cost: with / without cost, margin, rows', h.withCost && h.without && h.margin && h.margin.pct && h.rows, h);
h = await head(owner, 'capital');
check('capital: money in, investors, returns owed, shares', h.all && h.outside && h.due && h.pct, h);

// who sees money
h = await head(sales, 'repairs');
check('sales staff: repair counts, no money', h.open && !h.income, h);
h = await head(sales, 'quotes');
check('sales staff: quotation counts, no value', h.quotes && !h.value, h);
let r = await sales('erpFdHead', [{ view: 'suppliers' }]);
check('sales staff: nothing on suppliers', r.ok && r.result.cards.length === 0, r);
r = await mgr('erpFdHead', [{ view: 'capital' }]);
check('a manager: nothing on capital', r.ok && r.result.cards.length === 0, r);

await done();
