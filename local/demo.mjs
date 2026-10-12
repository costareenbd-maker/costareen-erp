// Demo data for the local ERP: a made-up 3D-printing shop. Nothing here is real - no real customer, phone,
// supplier, price or cost. Written through the ERP's own functions (the test harness's `owner` caller), so the
// books are consistent: stock received, sold, paid, dues, expenses, capital. Run by local/run.py on the first build.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const { owner, sql, FIX } = await import(pathToFileURL(path.join(here, '..', 'supabase', 'tests', 'harness.mjs')));

let seed = 20261013;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };   // the same demo every build
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const day = (ago) => { const d = new Date(Date.now() - ago * 86400000); return d.toISOString().slice(0, 10); };
const must = async (name, args, what) => { const r = await owner(name, args); if (!r.ok) throw new Error((what || name) + ': ' + r.error); return r.result; };

// ---- the shop's money and people
const B = FIX.B;
await sql`update businesses set name = 'Demo 3D Shop' where id = ${B}`;
for (const [kind, vals] of Object.entries({ categories: ['Filaments', 'Printers', 'Parts', 'Accessories'], brands: ['Nova', 'Polaris', 'MakerPro'], units: ['Roll', 'Piece', 'Set'],
                                              payment_methods: ['Cash', 'bKash', 'Nagad', 'Bank Transfer', 'COD'], types: ['PLA', 'PLA+', 'PETG', 'ABS', 'TPU', 'Printer', 'Nozzle', 'Plate'] })) {
  for (const v of vals) await sql`insert into lookups (business_id, kind, value) values (${B}, ${kind}, ${v}) on conflict do nothing`;
}
await must('erpCashAccountSave', [{ name: 'Cash', kind: 'cash', opening: 25000, openingDate: day(150) }]);
await must('erpCashAccountSave', [{ name: 'bKash', kind: 'wallet', opening: 12000, openingDate: day(150) }]);
await must('erpCashAccountSave', [{ name: 'Demo Bank', kind: 'bank', opening: 180000, openingDate: day(150) }]);
await must('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Demo Owner', pct: 100, since: day(150).slice(0, 7), invested: 500000 }]);
await must('erpSupplierSave', [{ name: 'Dragon Filament Co.', phone: '+86 138 0000 0000', country: 'China', currency: 'usd', openingOwed: 0 }]);
await must('erpSupplierSave', [{ name: 'Dhaka Print Supply', phone: '01700000000', country: 'Bangladesh', currency: 'bdt', openingOwed: 8000 }]);

// ---- products: filament colours per brand, two printers, parts
const colours = ['Black', 'White', 'Grey', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink', 'Silver', 'Transparent'];
const products = [];
let n = 0;
for (const brand of ['Nova', 'Polaris']) for (const type of ['PLA', 'PLA+', 'PETG']) for (const c of colours.slice(0, brand === 'Nova' ? 8 : 6)) {
  n++;
  products.push({ sku: brand.slice(0, 2).toLowerCase() + type.replace('+', 'p').toLowerCase() + String(n).padStart(3, '0'), name: brand + ' ' + type + ' ' + c + ' 1kg', category: 'Filaments', brand, type, color: c, unit: 'Roll',
                  sell: type === 'PETG' ? 1450 : type === 'PLA+' ? 1350 : 1150, stock: between(4, 40) });
}
for (const c of ['Black', 'White', 'Red']) { n++; products.push({ sku: 'mptpu' + n, name: 'MakerPro TPU ' + c + ' 500g', category: 'Filaments', brand: 'MakerPro', type: 'TPU', color: c, unit: 'Roll', sell: 1900, stock: between(2, 10) }); }
products.push({ sku: 'nvx1', name: 'Nova X1 3D Printer', category: 'Printers', brand: 'Nova', type: 'Printer', color: '', unit: 'Piece', sell: 48000, stock: 3 });
products.push({ sku: 'nvx1c', name: 'Nova X1 Combo (with AMS)', category: 'Printers', brand: 'Nova', type: 'Printer', color: '', unit: 'Piece', sell: 68000, stock: 2 });
products.push({ sku: 'plmini', name: 'Polaris Mini Printer', category: 'Printers', brand: 'Polaris', type: 'Printer', color: '', unit: 'Piece', sell: 32000, stock: 4 });
products.push({ sku: 'nz04', name: 'Nova Hardened Nozzle 0.4', category: 'Parts', brand: 'Nova', type: 'Nozzle', color: '', unit: 'Piece', sell: 1800, stock: 15 });
products.push({ sku: 'nz06', name: 'Nova Hardened Nozzle 0.6', category: 'Parts', brand: 'Nova', type: 'Nozzle', color: '', unit: 'Piece', sell: 1800, stock: 9 });
products.push({ sku: 'plpei', name: 'Polaris PEI Plate', category: 'Parts', brand: 'Polaris', type: 'Plate', color: '', unit: 'Piece', sell: 2600, stock: 6 });
products.push({ sku: 'drybox', name: 'MakerPro Filament Dry Box', category: 'Accessories', brand: 'MakerPro', type: 'Plate', color: '', unit: 'Piece', sell: 4200, stock: 5 });
for (const p of products) await must('erpSaveProduct', [{ isNew: true, sku: p.sku, product_name: p.name, category: p.category, brand: p.brand, type: p.type, color: p.color, unit: p.unit, sell_price: p.sell, reorder_level: p.category === 'Filaments' ? 5 : 1, lead_time_days: 30, supplier: p.category === 'Printers' ? 'Dragon Filament Co.' : 'Dhaka Print Supply' }], 'product ' + p.sku);

// ---- the cost book: a buying price per category / brand / type (made up)
const costRows = [];
const seen = new Set();
for (const p of products) { const k = p.category + '|' + p.brand + '|' + p.type; if (seen.has(k)) continue; seen.add(k);
  // buying prices in taka (made up): about 60% of the selling price, plus a little handling
  costRows.push({ category: p.category, brand: p.brand, type: p.type, amount: Math.round(p.sell * 0.6 / 10) * 10, cur: 'BDT', handling: p.category === 'Printers' ? 2500 : 60 }); }
await must('erpCostBook', []);   // opening the cost book makes its rows from the products (category / brand / type)
{ const r = await owner('erpSaveCostRows', [{ rows: costRows }]);
  if (!r.ok) console.log('cost book skipped:', r.error); else if (r.result.notFound && r.result.notFound.length) console.log('cost rows not found:', r.result.notFound.join(', ')); }

// ---- stock in: one shipment from each supplier, dated 120 days ago
await must('erpReceiveStock', [{ reference: 'DEMO-SHIP-1', supplier: 'Dragon Filament Co.', lines: products.filter((p) => p.category !== 'Parts').map((p) => ({ sku: p.sku, qty: p.stock })) }]);
await must('erpReceiveStock', [{ reference: 'DEMO-SHIP-2', supplier: 'Dhaka Print Supply', lines: products.filter((p) => p.category === 'Parts').map((p) => ({ sku: p.sku, qty: p.stock })) }]);
await sql`update stock_movements set created_at = now() - interval '120 days' where business_id = ${B} and kind = 'RECEIVE'`;

// ---- customers: made-up people in made-up places
const first = ['Arif', 'Sumaiya', 'Tanvir', 'Nusrat', 'Rakib', 'Farhana', 'Imran', 'Mitu', 'Sakib', 'Jannat', 'Hasan', 'Priya', 'Shuvo', 'Ruma', 'Nayeem', 'Tasnim', 'Rafi', 'Sadia', 'Mahin', 'Lamia'];
const last = ['Hossain', 'Akter', 'Rahman', 'Islam', 'Chowdhury', 'Khan', 'Ahmed', 'Sultana', 'Mia', 'Begum', 'Karim', 'Das'];
const areas = ['Dhanmondi, Dhaka', 'Mirpur, Dhaka', 'Uttara, Dhaka', 'Banani, Dhaka', 'Agrabad, Chattogram', 'Zindabazar, Sylhet', 'Shaheb Bazar, Rajshahi', 'Sonadanga, Khulna'];
const customers = [];
for (let i = 0; i < 40; i++) {
  const name = pick(first) + ' ' + pick(last), phone = '017' + String(10000000 + Math.floor(rnd() * 89999999));
  if (customers.some((c) => c.phone === phone)) { i--; continue; }
  customers.push({ name, phone, address: 'House ' + between(1, 99) + ', Road ' + between(1, 30) + ', ' + pick(areas) });
}
// a few demo businesses too
customers.push({ name: 'Demo Robotics Club', phone: '01800000001', address: 'Campus Road, Dhaka' }, { name: 'Demo Print Farm', phone: '01800000002', address: 'BSCIC, Gazipur' });

// ---- sales over the last four months: filament mostly, a printer now and then; paid, cash on delivery or due
const methods = ['Cash', 'bKash', 'Nagad', 'Bank Transfer'];
const sold = {};
let invoices = 0, dues = [];
for (let ago = 118; ago >= 0; ago--) {
  const howMany = ago % 7 === 5 ? 0 : between(0, 3);
  for (let k = 0; k < howMany; k++) {
    const c = pick(customers);
    const items = [];
    const lines = between(1, 3);
    for (let j = 0; j < lines; j++) {
      const p = rnd() < 0.06 ? pick(products.filter((x) => x.category === 'Printers')) : rnd() < 0.15 ? pick(products.filter((x) => x.category === 'Parts' || x.category === 'Accessories')) : pick(products.filter((x) => x.category === 'Filaments'));
      const left = p.stock - (sold[p.sku] || 0);
      if (left <= 0 || items.some((i) => i.sku === p.sku)) continue;
      const qty = p.category === 'Printers' ? 1 : Math.min(left, between(1, 3));
      items.push({ sku: p.sku, qty }); sold[p.sku] = (sold[p.sku] || 0) + qty;
    }
    if (!items.length) continue;
    const roll = rnd();
    const payMode = roll < 0.62 ? 'full' : roll < 0.85 ? 'cod' : 'none';
    const body = { customer: { name: c.name, phone: c.phone, address: c.address }, items, date: day(ago), payMode, paymentMethod: payMode === 'full' ? pick(methods) : '' };
    if (payMode === 'cod') body.customer.source = 'Steadfast courier';
    if (rnd() < 0.3) body.discount = pick([50, 100, 150]);
    const r = await owner('erpCreateInvoice', [body]);
    if (!r.ok) { console.log('invoice skipped:', r.error); continue; }
    invoices++;
    if (payMode === 'none') dues.push({ no: r.result.invoiceNo, ago, total: r.result.grandTotal });
  }
}
// most dues get paid later; a few stay open
for (const d of dues) { if (rnd() < 0.7 && d.ago > 3 && d.total > 0) { const r = await owner('erpRecordPayment', [{ orderId: d.no, amount: rnd() < 0.8 ? d.total : Math.round(d.total / 2), method: pick(methods) }]); if (!r.ok) console.log('payment skipped:', r.error); } }

// ---- expenses: a fixed rent, and bits every few days over four months
try { await must('erpExpenseItemSave', [{ kind: 'fixed', name: 'Shop rent', category: 'Rent', amount: 15000, fromMonth: day(120).slice(0, 7) }]); } catch (e) { console.log('rent skipped:', e.message); }
const expenseKinds = [['Transport', 'Courier pickup', 300, 900], ['Utilities', 'Electricity bill', 1800, 3200], ['Marketing', 'Facebook boost', 500, 2500], ['Office', 'Packaging boxes', 400, 1500], ['Miscellaneous', 'Tea and snacks', 100, 400]];
for (let ago = 118; ago >= 0; ago -= between(2, 6)) {
  const [category, what, lo, hi] = pick(expenseKinds);
  const r = await owner('erpExpenseAdd', [{ amount: between(lo, hi), description: what, category, month: day(ago).slice(0, 7) }]);
  if (!r.ok) console.log('expense skipped:', r.error);
}
await sql`update expenses set recorded_at = now() - (random() * 118 || ' days')::interval where business_id = ${B}`.catch(() => {});

console.log('DEMO: ' + products.length + ' products, ' + customers.length + ' customers, ' + invoices + ' invoices, ' + dues.length + ' on credit');
await sql.end({ timeout: 2 }).catch(() => {});
process.exit(0);
