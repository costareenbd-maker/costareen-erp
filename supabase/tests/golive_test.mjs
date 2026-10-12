// Go-live: the "start fresh" wipe (deploy/start_fresh.py --keep-lists) run on a copy of the real data,
// then the first day of real work on the emptied business. Run with IMPORT_DIR set.
import { sql, FIX, owner, check, done } from './harness.mjs';
import fs from 'node:fs';
const B = FIX.IMP;
if (!B) { console.log('golive_test needs IMPORT_DIR'); process.exit(1); }

// the same lists the script uses, read from it so the two cannot drift apart
const py = fs.readFileSync(new URL('../../deploy/start_fresh.py', import.meta.url), 'utf8');
const set = (name) => [...new RegExp(name + ' = \\{([^}]*)\\}').exec(py)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const keep = new Set([...set('ALWAYS_KEEP'), ...set('LISTS')]);
const tables = (await sql`select c.table_name t from information_schema.columns c join pg_tables p on p.schemaname = 'public' and p.tablename = c.table_name
                          where c.table_schema = 'public' and c.column_name = 'business_id' order by 1`).map((r) => r.t);
const count = async (t, biz) => (await sql.unsafe(`select count(*)::int n from public."${t}" where business_id = '${biz}'`))[0].n;
const before = {}, other = {};
for (const t of tables) { before[t] = await count(t, B); other[t] = await count(t, FIX.B); }
const go = tables.filter((t) => !keep.has(t) && before[t]);
check('there is trial data to remove', before.invoices > 1000 && before.stock_movements > 2000 && go.includes('invoices') && go.includes('payments'), go);
const counterBefore = (await sql`select next_number from invoice_counters where business_id = ${B}`)[0];

await sql.begin(async (tx) => {
  await tx.unsafe('set local session_replication_role = replica');
  for (const t of go) await tx.unsafe(`delete from public."${t}" where business_id = '${B}'`);
  await tx.unsafe(`update public.customers set total_orders = 0, total_spent = 0, last_order_at = null, last_product = null where business_id = '${B}'`);
});

let left = [];
for (const t of go) if (await count(t, B)) left.push(t);
check('every trial table is empty', left.length === 0, left);
let moved = [];
for (const t of tables) if ((await count(t, FIX.B)) !== other[t]) moved.push(t);
check('another business is untouched', moved.length === 0, moved);
check('products, customers, lists, settings and people stay', (await count('products', B)) === before.products && (await count('customers', B)) === before.customers &&
  (await count('lookups', B)) === before.lookups && (await count('business_config', B)) === before.business_config && (await count('memberships', B)) === before.memberships);
const counterAfter = (await sql`select next_number from invoice_counters where business_id = ${B}`)[0];
check('the invoice number counter carries on', !counterBefore || (counterAfter && counterAfter.next_number === counterBefore.next_number), [counterBefore, counterAfter]);

// ---- the emptied business works
let r = await owner('erpCatalog', []);
const cat = r.result;
check('every product is there with 0 in stock and nothing sold', r.ok && cat.length === before.products && cat.every((p) => p.stock === 0 && (p.sold || 0) === 0), cat && cat.filter((p) => p.stock !== 0).length);
r = await owner('erpBundle', [['dash'], { fresh: true }]);
check('dashboard opens on empty books', r.ok && r.result.dash && r.result.dash.kpi.revenueMTD === 0 && r.result.dash.kpi.todayOrders === 0, r.result && (r.result.errors || r.result.dash.kpi));
r = await owner('erpSales', [{}]);
check('no invoices', r.ok && r.result.matched === 0, r.result && r.result.matched);
r = await owner('erpCustomerList', [{}]);
check('customers kept, none has bought', r.ok && r.result.total === before.customers && r.result.rows.every((c) => c.orders === 0 && c.spent === 0), r.result && r.result.rows[0]);
for (const [name, args] of [['erpDues', []], ['erpPnl', [{ months: 6 }]], ['erpMoney', [{ days: 90 }]], ['erpExpenses', [{}]], ['erpCapital', []], ['erpReorderPlan', []],
                            ['erpPoList', []], ['erpAlerts', []], ['erpSecurity', [{}]], ['erpCostBook', []]]) {
  r = await owner(name, args);
  check(name + ' opens on empty books', r.ok, r);
}

// ---- day one: opening stock, then the first sale
const withPrice = cat.filter((p) => p.sell > 0).slice(0, 3);
r = await owner('erpStockCount', [{ note: 'go-live', lines: withPrice.map((p, i) => ({ sku: p.sku, counted: 10 + i })) }]);
check('opening stock entered by counting', r.ok && r.result.opening === 3 && r.result.changed === 3 && r.result.up === 33, r.result);
r = await owner('erpProductPage', [{ sku: withPrice[0].sku }]);
check('the ledger starts with "Opening stock"', r.ok && r.result.stock === 10 && r.result.ledger.length === 1 && r.result.ledger[0].what === 'Opening stock' &&
  /^Opening stock /.test(r.result.ledger[0].ref), r.result && r.result.ledger);
r = await owner('erpStockCount', [{ lines: [{ sku: withPrice[0].sku, counted: 9 }] }]);
check('a later recount is an adjustment, not a second opening', r.ok && r.result.opening === 0 && r.result.down === 1, r.result);
r = await owner('erpCreateInvoice', [{ customer: { name: 'First Customer', phone: '01700000001' }, items: [{ sku: withPrice[1].sku, qty: 2 }], payMode: 'full' }]);
check('first real invoice saves', r.ok && !!r.result.invoiceNo, r);
if (counterBefore) check('...and its number carries on after the old ones', r.result.invoiceNo.endsWith('-' + counterBefore.next_number), [r.result.invoiceNo, counterBefore]);
r = await owner('erpCatalog', []);
check('stock went down by the sale', r.result.find((p) => p.sku === withPrice[1].sku).stock === 9, r.result.find((p) => p.sku === withPrice[1].sku));
r = await owner('erpBundle', [['dash'], { fresh: true }]);
check('dashboard shows the first sale', r.ok && r.result.dash.kpi.todayOrders === 1 && r.result.dash.kpi.todayRevenue === 2 * withPrice[1].sell, r.result && r.result.dash && r.result.dash.kpi);

await done();
