// Excel in and out (plan D6).
//
//   erpExport({what})                        an .xlsx of a list: products, customers, invoices, suppliers,
//                                            serials, jobs, stock (90 days of movements), costbook
//   erpImport({what, rows, apply})           products, customers or suppliers from a spreadsheet:
//                                            rows = [{column: value}] as the browser read them; without
//                                            `apply` only the preview comes back (what would be added,
//                                            changed, refused) and nothing is written.
//
// Column names are matched loosely ("Sell price", "sell_price", "Price" all
// work), so a file exported from here, or from the old sheet, goes straight back in.

import { formatDate, num, round2 } from '../lib/time.js';
import { phone11, formatBdPhone, normalizePhone, custKey } from '../lib/phone.js';
import { saveFile, deleteFile } from '../lib/ext.js';
import { forget } from '../lib/tabs.js';
import { roleAtLeast, powerOn, callAllowed } from '../allow.js';
import { buildXlsx } from './expenses.js';
import { erpListView } from './listview.js';
import { erpSuppliers, erpSupplierSave } from './suppliers.js';
import { erpSaveProduct } from './stock.js';
import { erpCatalog } from './catalog.js';
import { lock, who } from './money.js';
import { products as costedProducts, erpCostBook } from './dashboard.js';

const str = (v) => String(v == null ? '' : v).trim();
const day = (d) => (d ? formatDate(new Date(d), 'yyyy-MM-dd') : '');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function fileOut(ctx, name, sheets) {
  const bytes = buildXlsx(sheets);
  await deleteFile(ctx, 'exports', name);
  const f = await saveFile(ctx, 'exports', name, bytes, XLSX);
  return { ok: true, name, url: f.url, rows: sheets.reduce((a, s) => a + Math.max(0, s.rows.length - 1), 0) };
}
const bold = (r) => (r === 0 ? 'bold' : '');

/** A list as the list screen has it: the same columns, every row. */
async function listSheet(ctx, model, title) {
  const r = await erpListView(ctx, { model, exportAll: true });
  const cols = [];
  r.spec.columns.forEach((c) => { cols.push([c.key, c.label]); if (c.sub) cols.push([c.sub, c.sub]); });
  const rows = [cols.map((c) => c[1])];
  for (const x of r.rows) rows.push(cols.map((c) => { const v = c[0] === 'state' ? x.stateText : x[c[0]]; return v == null ? '' : (typeof v === 'number' ? v : String(v)); }));
  return { name: title, rows, frozenRows: 1, style: bold };
}

export async function erpExport(ctx, payload) {
  const what = str(payload && payload.what);
  const biz = str(ctx.s && ctx.s.businessName) || 'ERP';
  const stamp = formatDate(ctx.now, 'yyyy-MM-dd');
  if (what === 'products') {
    const money = powerOn(ctx.s, 'costs');
    const rows = await ctx.tx`select p.*, coalesce(ps.stock, 0) as stock from products p left join product_stock ps on ps.product_id = p.id
                              where p.business_id = ${ctx.biz} order by p.category, p.brand, p.name`;
    const costed = money ? (await costedProducts(ctx)).bySku : {};
    const head = ['SKU', 'Name', 'Category', 'Brand', 'Type', 'Colour', 'Unit', 'Supplier', 'Family', 'Serialised', 'Warranty months'].concat(money ? ['Cost', 'Cost from'] : [])
      .concat(['Sell price', 'Wholesale price', 'Reorder level', 'Lead days', 'Stock', 'Status', 'Barcode', 'Notes']);
    const out = [head];
    for (const p of rows) out.push([str(p.sku), str(p.name), str(p.category), str(p.brand), str(p.type), str(p.color), str(p.unit), str(p.supplier), str(p.family), p.serialised ? 'yes' : '', p.warranty_months == null ? '' : num(p.warranty_months)]
      .concat(money ? (function () { const c = costed[str(p.sku).toLowerCase()], v = c ? num(c.cost) : num(p.cost_price);
        return [v, num(p.cost_price) > 0 ? 'product' : v > 0 ? 'price book (landed)' : 'no cost yet']; })() : []).concat([num(p.sell_price), num(p.wholesale_price), num(p.reorder_level), num(p.lead_time_days), num(p.stock), str(p.status), str(p.barcode), str(p.notes)]));
    return fileOut(ctx, biz + ' products ' + stamp + '.xlsx', [{ name: 'Products', rows: out, frozenRows: 1, style: bold }]);
  }
  if (what === 'customers') {
    const rows = await ctx.tx`select * from customers where business_id = ${ctx.biz} order by name`;
    const out = [['Name', 'Phone', 'Email', 'Address', 'Type', 'Source', 'Status', 'Orders', 'Spent', 'Last order', 'Added', 'Notes']];
    for (const c of rows) out.push([str(c.name), str(c.phone), str(c.email), str(c.address), str(c.type), str(c.source), str(c.status), num(c.total_orders), num(c.total_spent), day(c.last_order_at), day(c.created_at), str(c.note)]);
    return fileOut(ctx, biz + ' customers ' + stamp + '.xlsx', [{ name: 'Customers', rows: out, frozenRows: 1, style: bold }]);
  }
  if (what === 'invoices') return fileOut(ctx, biz + ' invoices ' + stamp + '.xlsx', [await listSheet(ctx, 'invoices', 'Invoices')]);
  if (what === 'suppliers') {
    const r = await erpSuppliers(ctx);
    const out = [['Supplier', 'Country', 'Currency', 'Phone', 'Products', 'Owed']];
    for (const s of r.suppliers) out.push([s.name, s.country || '', s.currency || '', s.phone || '', num(s.products), num(s.owed)]);
    return fileOut(ctx, biz + ' suppliers ' + stamp + '.xlsx', [{ name: 'Suppliers', rows: out, frozenRows: 1, style: bold }]);
  }
  if (what === 'serials') {
    const rows = await ctx.tx`select s.*, p.name from serials s join products p on p.id = s.product_id where s.business_id = ${ctx.biz} order by p.name, s.status, s.serial`;
    const out = [['Product', 'SKU', 'Serial', 'Status', 'Received', 'Shipment', 'Sold', 'Invoice', 'Customer', 'Warranty months', 'Warranty until', 'Note']];
    for (const s of rows) out.push([str(s.name), str(s.sku), str(s.serial), str(s.status), day(s.received_at), str(s.receive_ref), day(s.sold_at), str(s.invoice_no), str(s.customer), s.warranty_months == null ? '' : num(s.warranty_months), day(s.warranty_until), str(s.note)]);
    return fileOut(ctx, biz + ' serial numbers ' + stamp + '.xlsx', [{ name: 'Serials', rows: out, frozenRows: 1, style: bold }]);
  }
  if (what === 'jobs') {
    const rows = await ctx.tx`select * from service_jobs where business_id = ${ctx.biz} order by received_at desc`;
    const out = [['Job', 'Received', 'Customer', 'Phone', 'Machine', 'Serial', 'Under warranty', 'Problem', 'Status', 'Diagnosis', 'Parts', 'Labour', 'Charge', 'Returned']];
    for (const j of rows) out.push([str(j.job_no), day(j.received_at), str(j.customer), str(j.phone), str(j.item), str(j.serial), j.under_warranty ? 'yes' : '', str(j.problem), str(j.status), str(j.diagnosis),
      (Array.isArray(j.parts) ? j.parts : []).map((p) => p.qty + ' x ' + p.name).join('; '), num(j.labour), num(j.charge), day(j.returned_at)]);
    return fileOut(ctx, biz + ' repair jobs ' + stamp + '.xlsx', [{ name: 'Jobs', rows: out, frozenRows: 1, style: bold }]);
  }
  if (what === 'stock') {
    const rows = await ctx.tx`select m.created_at, m.kind, m.direction, m.qty, m.unit_price, m.total, m.reference, m.supplier, m.note, m.operator, p.sku, p.name
                              from stock_movements m join products p on p.id = m.product_id
                              where m.business_id = ${ctx.biz} and m.created_at > now() - interval '90 days' order by m.created_at desc limit 20000`;
    const money = powerOn(ctx.s, 'costs');
    const out = [['When', 'SKU', 'Product', 'Kind', 'In / out', 'Qty'].concat(money ? ['Unit price', 'Total'] : []).concat(['Reference', 'Supplier', 'Note', 'By'])];
    for (const m of rows) out.push([formatDate(new Date(m.created_at), 'yyyy-MM-dd HH:mm'), str(m.sku), str(m.name), str(m.kind), str(m.direction), num(m.qty)]
      .concat(money ? [num(m.unit_price), num(m.total)] : []).concat([str(m.reference), str(m.supplier), str(m.note), str(m.operator)]));
    return fileOut(ctx, biz + ' stock movements ' + stamp + '.xlsx', [{ name: 'Stock', rows: out, frozenRows: 1, style: bold }]);
  }
  if (what === 'costbook') {
    if (!powerOn(ctx.s, 'costs')) throw new Error('Your account does not have access to that.');
    const book = await erpCostBook(ctx);
    const out = [['Category', 'Brand', 'Type', 'Buy price', 'Currency', 'Handling', 'Landed cost', 'Products', 'Typical sell', 'Margin %', 'Note']];
    for (const r of book.rows) out.push([r.category, r.brand, r.type, r.amount == null ? '' : num(r.amount), r.cur, r.handling === '' || r.handling == null ? '' : num(r.handling),
      r.landed > 0 ? r.landed : '', num(r.products), r.sell > 0 ? r.sell : '', r.margin == null ? '' : r.margin, r.note]);
    return fileOut(ctx, biz + ' price book ' + stamp + '.xlsx', [{ name: 'Price book', rows: out, frozenRows: 1, style: bold }]);
  }
  throw new Error('Nothing called "' + what + '" can be exported.');
}

// ------------------------------------------------------------------ import
const ALIASES = {
  sku: ['sku', 'code', 'product code', 'item code'], name: ['name', 'product', 'product name', 'item', 'customer', 'customer name', 'supplier', 'supplier name'],
  category: ['category', 'cat'], brand: ['brand', 'manufacturer'], type: ['type', 'model', 'material'], color: ['colour', 'color'], unit: ['unit', 'uom'],
  supplier: ['supplier', 'vendor', 'bought from'], cost: ['cost', 'cost price', 'buy price', 'purchase price'], sell: ['sell price', 'sell', 'price', 'selling price', 'retail price', 'mrp'],
  wholesale: ['wholesale price', 'wholesale'], reorder: ['reorder level', 'reorder', 'min stock', 'minimum'], lead: ['lead days', 'lead time', 'lead time days'],
  stock: ['stock', 'opening stock', 'quantity', 'qty', 'on hand'], status: ['status'], barcode: ['barcode', 'ean', 'upc'], notes: ['notes', 'note', 'remarks'],
  warranty: ['warranty months', 'warranty'], serialised: ['serialised', 'serialized', 'has serial', 'serial numbers'], family: ['family'],
  phone: ['phone', 'mobile', 'contact', 'phone number'], email: ['email', 'e-mail'], address: ['address'], ctype: ['type', 'customer type'], source: ['source', 'delivery', 'came from'],
  country: ['country'], currency: ['currency'],
};
function fieldOf(header) {
  const h = str(header).toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
  for (const f of Object.keys(ALIASES)) if (ALIASES[f].includes(h)) return f;
  return '';
}
/** { field: value } for one spreadsheet row, whatever the headings were called. */
function mapRow(raw, kind) {
  const out = {};
  for (const k of Object.keys(raw || {})) {
    let f = fieldOf(k);
    if (!f) continue;
    // 'name' and 'type' mean different things on different lists
    if (kind === 'customers' && f === 'type') f = 'ctype';
    if (kind !== 'products' && f === 'supplier' && kind === 'suppliers') f = 'name';
    if (out[f] === undefined || str(out[f]) === '') out[f] = raw[k];
  }
  return out;
}
const yes = (v) => /^(yes|y|true|1|x)$/i.test(str(v));

export async function erpImport(ctx, payload) {
  payload = payload || {};
  const kind = str(payload.what), apply = !!payload.apply;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!['products', 'customers', 'suppliers'].includes(kind)) throw new Error('Products, customers or suppliers can be imported.');
  if (!callAllowed(ctx.s, 'erpImport')) throw new Error('Importing is a manager matter.');
  if (!rows.length) throw new Error('The file has no rows under its heading line.');
  if (rows.length > 5000) throw new Error('At most 5,000 rows at a time.');
  const headers = Object.keys(rows[0] || {});
  const seen = headers.map((h) => ({ column: h, as: fieldOf(h) || '' }));
  const out = { what: kind, apply, columns: seen, add: [], change: [], skip: [], errors: [], added: 0, changed: 0 };
  const push = (list, i, text, extra) => list.push({ row: i + 2, text, ...(extra || {}) });

  if (kind === 'products') {
    const cat = await erpCatalog(ctx);
    const bySku = {}, byName = {};
    cat.forEach((p) => { bySku[p.sku.toLowerCase()] = p; byName[p.name.toLowerCase()] = p; });
    const money = powerOn(ctx.s, 'costs');
    const ownCost = {}, costed2 = money ? (await costedProducts(ctx)).bySku : {};
    if (money) for (const r of await ctx.tx`select sku, cost_price from products where business_id = ${ctx.biz}`) ownCost[String(r.sku).toLowerCase()] = r.cost_price;
    const plan = [];
    rows.forEach((raw, i) => {
      const r = mapRow(raw, kind), name = str(r.name), sku = str(r.sku);
      if (!name && !sku) { push(out.skip, i, 'empty row'); return; }
      const cur = (sku && bySku[sku.toLowerCase()]) || (!sku && byName[name.toLowerCase()]) || null;
      if (!cur && !name) { push(out.errors, i, 'a new product needs a name (' + sku + ')'); return; }
      for (const f of ['sell', 'cost', 'wholesale', 'reorder', 'lead', 'stock', 'warranty']) {
        if (r[f] !== undefined && str(r[f]) !== '' && (isNaN(Number(String(r[f]).replace(/,/g, ''))) || Number(String(r[f]).replace(/,/g, '')) < 0)) { push(out.errors, i, (name || sku) + ': ' + f + ' is not a number: ' + r[f]); return; }
      }
      const d = { isNew: !cur, sku: cur ? cur.sku : sku, product_name: name || cur.name };
      const take = (field, key, fn) => { if (r[field] !== undefined && str(r[field]) !== '') d[key] = fn ? fn(r[field]) : str(r[field]); };
      take('category', 'category'); take('brand', 'brand'); take('type', 'type'); take('color', 'color'); take('unit', 'unit'); take('supplier', 'supplier');
      take('sell', 'sell_price', num); take('wholesale', 'wholesale_price', num); take('reorder', 'reorder_level', num); take('lead', 'lead_time_days', num);
      take('status', 'status'); take('barcode', 'barcode'); take('notes', 'notes'); take('family', 'family');
      if (money) {
        take('cost', 'cost_price', num);
        // the export shows the price book's landed cost where a product has none of its own: reading it back changes nothing
        const own = cur ? num(ownCost[cur.sku.toLowerCase()]) : 0, eff = cur && costed2[cur.sku.toLowerCase()] ? num(costed2[cur.sku.toLowerCase()].cost) : 0;
        if (cur && d.cost_price !== undefined && !(own > 0) && Math.abs(d.cost_price - eff) < 0.01) delete d.cost_price;
        if (cur && d.cost_price !== undefined && own > 0 && Math.abs(d.cost_price - own) < 0.01) delete d.cost_price;
      }
      if (r.warranty !== undefined && str(r.warranty) !== '') d.warranty_months = Math.round(num(r.warranty));
      if (r.serialised !== undefined && str(r.serialised) !== '') d.serialised = yes(r.serialised);
      if (!cur && r.stock !== undefined) d.opening_stock = num(r.stock);
      if (cur && r.stock !== undefined && str(r.stock) !== '' && num(r.stock) !== num(cur.stock)) push(out.skip, i, cur.name + ': stock is not changed by an import (file says ' + num(r.stock) + ', shelf has ' + num(cur.stock) + ') - use Stock count');
      const changes = [];
      if (cur) {
        const cmp = { product_name: 'name', category: 'cat', brand: 'brand', color: 'color', unit: 'unit', supplier: 'supplier', sell_price: 'sell', reorder_level: 'reorder', family: 'family' };
        for (const k of Object.keys(cmp)) if (d[k] !== undefined && String(d[k]) !== String(cur[cmp[k]] == null ? '' : cur[cmp[k]])) changes.push(k.replace('_', ' ') + ': ' + (cur[cmp[k]] == null ? '' : cur[cmp[k]]) + ' → ' + d[k]);
        if (d.cost_price !== undefined) changes.push('cost → ' + d.cost_price);
        if (d.warranty_months !== undefined && d.warranty_months !== (cur.warrantyMonths == null ? null : cur.warrantyMonths)) changes.push('warranty → ' + d.warranty_months);
        if (d.serialised !== undefined && d.serialised !== !!cur.serialised) changes.push('serialised → ' + (d.serialised ? 'yes' : 'no'));
        if (!changes.length) { push(out.skip, i, cur.name + ': nothing new'); return; }
        push(out.change, i, cur.name + ' (' + cur.sku + '): ' + changes.join(', '));
      } else {
        push(out.add, i, name + (sku ? ' (' + sku + ')' : '') + (d.opening_stock > 0 ? ' · opening stock ' + d.opening_stock : ''));
      }
      plan.push({ i, d, cur });
    });
    if (!apply) return out;
    await lock(ctx, 'import');
    for (const { i, d, cur } of plan) {
      try {
        let base = {};
        if (cur) {
          const p = (await ctx.tx`select * from products where business_id = ${ctx.biz} and lower(btrim(sku)) = ${cur.sku.toLowerCase()} limit 1`)[0];
          base = { sku: str(p.sku), product_name: str(p.name), category: str(p.category), brand: str(p.brand), type: str(p.type), color: str(p.color), unit: str(p.unit) || 'Piece',
                   supplier: str(p.supplier), cost_price: num(p.cost_price), sell_price: num(p.sell_price), wholesale_price: num(p.wholesale_price), reorder_level: num(p.reorder_level),
                   lead_time_days: num(p.lead_time_days), location_bin: str(p.location_bin), status: str(p.status) || 'Active' };
        }
        const full = { ...base, ...d };
        const res = await ctx.tx.savepoint(() => erpSaveProduct(ctx, full));
        const extra = [];
        if (d.barcode !== undefined) extra.push(ctx.tx`update products set barcode = ${d.barcode} where business_id = ${ctx.biz} and lower(btrim(sku)) = ${res.sku.toLowerCase()}`);
        if (d.notes !== undefined) extra.push(ctx.tx`update products set notes = ${d.notes} where business_id = ${ctx.biz} and lower(btrim(sku)) = ${res.sku.toLowerCase()}`);
        if (d.family !== undefined) extra.push(ctx.tx`update products set family = ${d.family || null} where business_id = ${ctx.biz} and lower(btrim(sku)) = ${res.sku.toLowerCase()}`);
        if (d.warranty_months !== undefined) extra.push(ctx.tx`update products set warranty_months = ${d.warranty_months > 0 ? d.warranty_months : null} where business_id = ${ctx.biz} and lower(btrim(sku)) = ${res.sku.toLowerCase()}`);
        if (d.serialised !== undefined) extra.push(ctx.tx`update products set serialised = ${d.serialised} where business_id = ${ctx.biz} and lower(btrim(sku)) = ${res.sku.toLowerCase()}`);
        for (const q of extra) await q;
        if (cur) out.changed++; else out.added++;
      } catch (e) { push(out.errors, i, (d.product_name || d.sku) + ': ' + String((e && e.message) || e)); }
    }
    delete ctx.memo.catalog; forget(ctx, 'TXN_LOG');
    return out;
  }

  if (kind === 'customers') {
    const have = await ctx.tx`select id, name, phone, address, email, type, source from customers where business_id = ${ctx.biz}`;
    const byKey = {};
    have.forEach((c) => { const k = normalizePhone(str(c.phone)) || ('n:' + str(c.name).toLowerCase()); byKey[k] = c; });
    const plan = [];
    rows.forEach((raw, i) => {
      const r = mapRow(raw, kind), name = str(r.name);
      let phone = str(r.phone).replace(/[^0-9+]/g, '');
      if (!name && !phone) { push(out.skip, i, 'empty row'); return; }
      if (!name) { push(out.errors, i, 'no name for ' + phone); return; }
      if (phone) { try { phone = phone11(phone); } catch (e) { push(out.errors, i, name + ': ' + String(e.message || e)); return; } }
      const k = normalizePhone(phone) || ('n:' + name.toLowerCase());
      const cur = byKey[k] || null;
      const earlier = plan.find((p) => p.k === k);
      if (earlier) {
        for (const f of ['name', 'address', 'email', 'type', 'source']) if (r[f === 'type' ? 'ctype' : f] !== undefined && str(r[f === 'type' ? 'ctype' : f]) !== '') earlier.d[f] = str(r[f === 'type' ? 'ctype' : f]);
        push(out.skip, i, name + ': same phone as row ' + (earlier.i + 2) + ' - the later row wins');
        return;
      }
      const d = { name, phone, address: r.address !== undefined ? str(r.address) : undefined, email: r.email !== undefined ? str(r.email) : undefined,
                  type: r.ctype !== undefined ? str(r.ctype) : undefined, source: r.source !== undefined ? str(r.source) : undefined };
      if (cur) {
        const ch = [];
        if (d.name !== str(cur.name)) ch.push('name: ' + cur.name + ' → ' + d.name);
        if (d.address !== undefined && d.address !== str(cur.address)) ch.push('address');
        if (d.email !== undefined && d.email !== str(cur.email)) ch.push('email');
        if (d.type !== undefined && d.type && d.type !== str(cur.type)) ch.push('type');
        if (!ch.length) { push(out.skip, i, name + ': nothing new'); return; }
        push(out.change, i, name + ' (' + (phone || 'no phone') + '): ' + ch.join(', '));
      } else push(out.add, i, name + (phone ? ' · ' + formatBdPhone(phone) : ''));
      plan.push({ i, d, cur, k });
    });
    if (!apply) return out;
    await lock(ctx, 'import');
    for (const { i, d, cur } of plan) {
      try {
        if (cur) {
          await ctx.tx`update customers set name = ${d.name}, address = ${d.address === undefined ? cur.address : d.address}, email = ${d.email === undefined ? cur.email : d.email},
                         type = ${d.type || cur.type || 'Retail'}, source = ${d.source || cur.source || 'Walk-in'}, customer_key = ${custKey(d.phone, d.name)}, updated_at = now() where id = ${cur.id}`;
          out.changed++;
        } else {
          await ctx.tx`insert into customers (business_id, customer_no, name, phone, email, address, type, source, status, customer_key, note)
                       values (${ctx.biz}, ${'CUS-' + Date.now() + '-' + i}, ${d.name}, ${d.phone}, ${d.email || ''}, ${d.address || ''}, ${d.type || 'Retail'}, ${d.source || 'Walk-in'}, 'New', ${custKey(d.phone, d.name)}, '')`;
          out.added++;
        }
      } catch (e) { push(out.errors, i, d.name + ': ' + String((e && e.message) || e)); }
    }
    forget(ctx, 'CUSTOMERS');
    return out;
  }

  // suppliers
  const have = (await erpSuppliers(ctx)).suppliers;
  const byName = {}; have.forEach((s) => { byName[s.name.toLowerCase()] = s; });
  const plan = [];
  rows.forEach((raw, i) => {
    const r = mapRow(raw, kind), name = str(r.name);
    if (!name) { push(out.skip, i, 'empty row'); return; }
    const cur = byName[name.toLowerCase()] || null;
    const d = { name, country: r.country !== undefined ? str(r.country) : undefined, currency: r.currency !== undefined ? str(r.currency).toUpperCase() : undefined, phone: r.phone !== undefined ? str(r.phone) : undefined };
    if (cur) {
      const ch = [];
      if (d.country !== undefined && d.country !== str(cur.country)) ch.push('country');
      if (d.currency !== undefined && d.currency !== str(cur.currency)) ch.push('currency');
      if (d.phone !== undefined && d.phone !== str(cur.phone)) ch.push('phone');
      if (!ch.length) { push(out.skip, i, name + ': nothing new'); return; }
      push(out.change, i, name + ': ' + ch.join(', '));
    } else push(out.add, i, name + (d.country ? ' · ' + d.country : ''));
    plan.push({ i, d, cur });
  });
  if (!apply) return out;
  await lock(ctx, 'import');
  for (const { i, d, cur } of plan) {
    try {
      await ctx.tx.savepoint(() => erpSupplierSave(ctx, { name: d.name, country: d.country === undefined ? (cur ? cur.country : '') : d.country,
                                                            currency: d.currency === undefined ? (cur ? cur.currency : '') : d.currency, phone: d.phone === undefined ? (cur ? cur.phone : '') : d.phone }));
      if (cur) out.changed++; else out.added++;
    } catch (e) { push(out.errors, i, d.name + ': ' + String((e && e.message) || e)); }
  }
  return out;
}

export const HANDLERS = { erpExport, erpImport };
