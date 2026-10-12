// The list view engine (look 2 step 2): search, filters, group by, sort, pages, totals, roles.
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';
const PLA = 'FIL-SUN-PLA-BLA-001', A1 = 'PRT-BAM-A1-001';
const lv = (who, p) => who('erpListView', [p]);

// a few invoices to list
const made = [];
for (const [name, phone, sku, qty, pay] of [['Karim', '01712345678', PLA, 1, 'full'], ['Rahim', '01811111111', PLA, 2, 'none'], ['Karim', '01712345678', A1, 1, 'full']]) {
  const r = await mgr('erpCreateInvoice', [{ customer: { name, phone }, items: [{ sku, qty }], payMode: pay }]);
  check('fixture invoice ' + name, r.ok, r);
  made.push(r.result.invoiceNo);
}

// ---------------------------------------------------------------- invoices
let r = await lv(sales, { model: 'nope' });
check('unknown list refused', !r.ok && r.error === 'Unknown list.', r);
r = await lv(sales, { model: 'invoices' });
const all = r.result;
check('invoices: newest first, with a spec', r.ok && all.rows[0].id === made[2] && all.spec.columns.some((c) => c.key === 'total') && all.spec.filters.some((f) => f.name === 'due'), all.rows.slice(0, 3));
check('invoices: totals over everything matched', all.sums.total === all.rows.reduce((t, x) => t + x.total, 0) || all.total > all.rows.length, all.sums);
check('a row carries only what the columns need', !('goods' in all.rows[0]) && all.rows[0].open.invoice === made[2], all.rows[0]);
r = await lv(sales, { model: 'invoices', search: [{ field: 'customer', values: ['karim'] }] });
check('search a customer', r.ok && r.result.total === r.result.rows.filter((x) => /Karim/.test(x.customer)).length && r.result.rows.every((x) => /Karim/.test(x.customer)) && r.result.total >= 2, r.result.rows.map((x) => x.customer));
check('"Anything" is the first search choice (Enter uses it)', all.spec.search[0].field === 'any', all.spec.search);
r = await lv(sales, { model: 'invoices', search: [{ field: 'any', values: ['karim'] }] });
check('Anything: a customer name finds their invoices', r.ok && r.result.total >= 2 && r.result.rows.every((x) => /Karim/.test(x.customer)), r.result.rows.map((x) => x.customer));
r = await lv(sales, { model: 'invoices', search: [{ field: 'any', values: [made[1].toLowerCase()] }] });
check('Anything: an invoice number', r.ok && r.result.total === 1 && r.result.rows[0].id === made[1], r.result.rows.map((x) => x.id));
r = await lv(sales, { model: 'invoices', search: [{ field: 'any', values: ['01811111111'] }] });
check('Anything: a phone number', r.ok && r.result.rows.length && r.result.rows.every((x) => x.customer === 'Rahim'), r.result.rows.map((x) => x.customer));
r = await lv(sales, { model: 'invoices', search: [{ field: 'customer', values: ['karim', 'rahim'] }] });
check('two values for one field: either', r.ok && r.result.rows.some((x) => x.customer === 'Rahim') && r.result.rows.some((x) => x.customer === 'Karim'), r.result.total);
r = await lv(sales, { model: 'invoices', search: [{ field: 'customer', values: ['karim'] }, { field: 'product', values: ['PRT-BAM'] }] });
check('two fields: both', r.ok && r.result.total === 1 && r.result.rows[0].id === made[2], r.result.rows);
r = await lv(sales, { model: 'invoices', filters: ['due'] });
check('filter: with a due', r.ok && r.result.rows.length && r.result.rows.every((x) => x.due > 0) && r.result.rows.some((x) => x.id === made[1]), r.result.rows.map((x) => [x.id, x.due]));
r = await lv(sales, { model: 'invoices', filters: ['due', 'paid'] });
check('two filters of one set: either', r.ok && r.result.total === all.total - all.rows.filter((x) => x.status === 'Cancelled' || x.status === 'Returned').length || r.result.total >= 3, r.result.total);
r = await lv(sales, { model: 'invoices', filters: ['due', 'today'] });
check('filters of two sets: both', r.ok && r.result.rows.every((x) => x.due > 0) && r.result.rows.some((x) => x.id === made[1]) && !r.result.rows.some((x) => x.id === 'INV-2'), r.result.rows.map((x) => x.id));
r = await lv(sales, { model: 'invoices', groupBy: 'customer' });
const kg = r.result.groups.find((g) => g.label === 'Karim');
check('group by customer: counts and sums', r.ok && kg && kg.count >= 2 && kg.sums.total > 0 && r.result.total === all.total, r.result.groups);
r = await lv(sales, { model: 'invoices', groupBy: 'customer', group: kg.key });
check('open a group: its rows', r.ok && r.result.total === kg.count && r.result.rows.every((x) => x.customer === 'Karim'), r.result.rows);
r = await lv(sales, { model: 'invoices', groupBy: 'month' });
check('group by month: newest first, readable label', r.ok && /^[A-Z][a-z]{2} \d{4}$/.test(r.result.groups[0].label) && r.result.groups[0].key >= r.result.groups[r.result.groups.length - 1].key, r.result.groups);
r = await lv(sales, { model: 'invoices', order: { field: 'total', dir: 'asc' } });
check('sort by a column', r.ok && r.result.rows.every((x, i, a) => i === 0 || a[i - 1].total <= x.total), r.result.rows.map((x) => x.total));
r = await lv(sales, { model: 'invoices', limit: 1, offset: 1 });
check('pages', r.ok && r.result.rows.length === 1 && r.result.rows[0].id === all.rows[1].id && r.result.total === all.total, r.result);

// ---------------------------------------------------------------- products
r = await lv(sales, { model: 'products' });
check('products: active by default in the spec', r.ok && r.result.spec.defaultFilters[0] === 'active' && r.result.rows.some((x) => x.key === PLA), r.result.spec);
check('sales never see supplier or cost', !JSON.stringify(r.result).match(/supplier|cost_price|"cost"/) && !r.result.spec.groups.some((g) => g.field === 'supplier'), r.result.spec.groups);
r = await lv(mgr, { model: 'products', groupBy: 'supplier' });
check('a manager may group by supplier', r.ok && r.result.groups.length > 0, r);
r = await lv(sales, { model: 'products', groupBy: 'supplier' });
check('...sales may not (the list is not grouped)', r.ok && !r.result.groups, r.result);
r = await lv(sales, { model: 'products', search: [{ field: 'category', values: ['print'] }] });
check('search a category', r.ok && r.result.total === 1 && r.result.rows[0].key === A1, r.result.rows);
r = await lv(sales, { model: 'products', filters: ['out'] });
check('filter: out of stock', r.ok && r.result.rows.every((x) => x.state === 'out'), r.result.rows);
r = await lv(sales, { model: 'products', groupBy: 'category' });
check('group by category, stock summed', r.ok && r.result.groups.every((g) => typeof g.sums.stock === 'number'), r.result.groups);

// ---------------------------------------------------------------- customers
r = await lv(mgr, { model: 'customers', filters: ['owes'] });
check('customers: who owes money', r.ok && r.result.rows.some((x) => x.name === 'Rahim' && x.owes > 0) && r.result.rows.every((x) => x.owes > 0), r.result.rows);
r = await lv(sales, { model: 'customers' });
check('sales: no money column, no money filter', r.ok && !r.result.spec.columns.some((c) => c.key === 'owes') && !r.result.spec.filters.some((f) => f.set === 'money') && !('owes' in r.result.rows[0]), r.result.spec.columns);
r = await lv(sales, { model: 'customers', filters: ['owes'] });
check('...and the filter is ignored for them', r.ok && r.result.total >= 2, r.result.total);
r = await lv(sales, { model: 'customers', filters: ['repeat'] });
check('repeat buyers', r.ok && r.result.rows.some((x) => x.name === 'Karim') && r.result.rows.every((x) => x.orders >= 2), r.result.rows);
r = await lv(sales, { model: 'customers', groupBy: 'lastMonth' });
check('group by last purchase month', r.ok && r.result.groups.length >= 1, r.result.groups);

// ---------------------------------------------------------------- another business
r = await lv(owner, { model: 'products' });
check('another business’s products never appear', r.ok && !r.result.rows.some((x) => x.key === 'X-OTHER'), r.result.total);

await done();
