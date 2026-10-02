// Product page and stock count (redesign phase 3). New - the sheet ERP had a
// product list and nothing behind a product.
//
//   erpProductPage({sku})          one product: figures, stock ledger, monthly sales,
//                                  recent invoices, supplier orders, price/cost changes
//   erpStockCount({lines, note})   a physical count: what is on the shelf replaces
//                                  what the books say, one ledger line per difference
//
// Cost, margin and stock value are for shareholders and the owner only, and
// are left out here rather than scrubbed afterwards.

import { formatDate, num, round2 } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';
import { forget } from '../lib/tabs.js';
import { erpCatalog } from './catalog.js';
import { lock, who } from './money.js';
import { saveFile, deleteFile, fileUrl } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const day = (d) => (d ? formatDate(d, 'd MMM yyyy') : '');
const dayTime = (d) => (d ? formatDate(d, 'd MMM yyyy, h:mm a') : '');
const KIND_WORDS = { OPENING: 'Opening stock', RECEIVE: 'Received', SALE: 'Sold', RETURN: 'Came back / found',
                     ADJUST: 'Adjusted', ADJUSTMENT: 'Adjusted', DAMAGE: 'Damaged', VOID: 'Sale voided' };
const FIELD_WORDS = { sell_price: 'Selling price', wholesale_price: 'Wholesale price', cost_price: 'Cost', status: 'Status' };

/** One product, whole. */
export async function erpProductPage(ctx, payload) {
  const sku = str(payload && payload.sku);
  if (!sku) throw new Error('Which product?');
  const p = (await ctx.tx`select * from products where business_id = ${ctx.biz}
                          and lower(btrim(sku)) = ${sku.toLowerCase()} limit 1`)[0];
  if (!p) throw new Error('That product is no longer on the list.');
  const money = roleAtLeast(ctx.s.role, 'shareholder');
  const showSupplier = roleAtLeast(ctx.s.role, 'manager');
  const cat = (await erpCatalog(ctx)).find((c) => c.sku.toLowerCase() === str(p.sku).toLowerCase()) || {};

  // the ledger, oldest first to carry a running balance, shown newest first
  const mv = await ctx.tx`
    select txn_no, created_at, kind, direction, qty, unit_price, reference, supplier, operator, note
    from stock_movements where business_id = ${ctx.biz} and product_id = ${p.id} order by created_at, seq`;
  let bal = 0, totalIn = 0, totalOut = 0;
  const ledger = mv.map((m) => {
    const q = num(m.qty), inn = str(m.direction) === 'IN';
    bal += inn ? q : -q;
    if (inn) totalIn += q; else totalOut += q;
    const kind = str(m.kind);
    const invoice = (/^Invoice:\s*(\S+)/.exec(str(m.reference)) || [])[1] || '';
    return { when: dayTime(m.created_at), what: KIND_WORDS[kind] || kind, dir: inn ? 'IN' : 'OUT', qty: q, after: bal,
             // a receipt's unit price is the cost - not for everyone
             price: kind === 'SALE' ? num(m.unit_price) : (money && num(m.unit_price) > 0 ? num(m.unit_price) : null),
             ref: invoice ? '' : str(m.reference), invoice,
             supplier: showSupplier ? str(m.supplier) : '', by: str(m.operator), note: str(m.note) };
  }).reverse();

  // units sold per month, last 12 months (returns to the shelf count back)
  const sold = await ctx.tx`
    select to_char(date_trunc('month', i.created_at at time zone 'Asia/Dhaka'), 'YYYY-MM') as m,
           sum(l.qty) as units, sum(l.line_total) as value
    from invoice_lines l join invoices i on i.id = l.invoice_id
    where l.business_id = ${ctx.biz} and lower(btrim(l.sku)) = ${str(p.sku).toLowerCase()}
      and i.created_at >= now() - interval '13 months'
    group by 1`;
  const byMonth = {};
  sold.forEach((r) => { byMonth[r.m] = { units: num(r.units), value: num(r.value) }; });
  const months = [];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nowM = formatDate(ctx.now, 'yyyy-MM');
  let y = Number(nowM.slice(0, 4)), mo = Number(nowM.slice(5, 7));
  for (let k = 0; k < 12; k++) {
    const key = y + '-' + String(mo).padStart(2, '0');
    months.unshift({ month: key, label: names[mo - 1] + " '" + String(y).slice(2), units: Math.round((byMonth[key] || {}).units || 0),
                     value: Math.round((byMonth[key] || {}).value || 0) });
    mo--; if (mo < 1) { mo = 12; y--; }
  }

  const recent = await ctx.tx`
    select i.invoice_no, i.created_at, i.customer_name, l.qty, l.unit_price, l.line_total
    from invoice_lines l join invoices i on i.id = l.invoice_id
    where l.business_id = ${ctx.biz} and lower(btrim(l.sku)) = ${str(p.sku).toLowerCase()} and i.invoice_no not like 'RTN-%'
    order by i.created_at desc, i.seq desc limit 25`;

  const po = showSupplier ? await ctx.tx`
    select po_no, ordered_at, qty, received, supplier, ship_by from po_lines
    where business_id = ${ctx.biz} and lower(btrim(sku)) = ${str(p.sku).toLowerCase()} and status = 'open' and qty > received
    order by ordered_at` : [];

  const ch = await ctx.tx`
    select c.changed_at, c.field, c.was, c.now,
           coalesce((select e.name from erp_people e where e.user_id = c.changed_by),
                    (select pr.full_name from profiles pr where pr.id = c.changed_by), '') as by
    from product_changes c where c.business_id = ${ctx.biz} and c.product_id = ${p.id}
    order by c.seq desc limit 60`;
  const changes = ch.filter((c) => money || c.field !== 'cost_price').map((c) => ({
    when: dayTime(c.changed_at), field: FIELD_WORDS[c.field] || c.field,
    was: c.field === 'status' ? str(c.was) : String(Math.round(num(c.was) * 100) / 100),
    now: c.field === 'status' ? str(c.now) : String(Math.round(num(c.now) * 100) / 100), by: str(c.by) }));

  const stock = num(cat.stock), sell = num(p.sell_price), cost = num(p.cost_price);
  const out = {
    sku: str(p.sku), name: str(p.name), category: str(p.category), brand: str(p.brand), type: str(p.type),
    color: str(p.color), unit: str(p.unit) || 'Piece', bin: str(p.location_bin),
    status: str(p.status) || 'Active', notes: str(p.notes), added: day(p.date_added || p.created_at),
    stock, state: cat.state || (stock <= 0 ? 'out' : 'ok'), reorder: num(cat.reorder), suggested: num(cat.suggested),
    lead: num(cat.lead), sell, wholesale: num(p.wholesale_price),
    sold: num(cat.sold), sold30: num(cat.sold30), sold90: num(cat.sold90), perMonth: Math.round(num(cat.rate) * 30),
    cover: cat.cover === undefined ? null : cat.cover, lastSoldDays: cat.lastSoldDays === undefined ? null : cat.lastSoldDays,
    totalIn, totalOut,
    months, ledger: ledger.slice(0, 200), moreLedger: Math.max(0, ledger.length - 200),
    sales: recent.map((r) => ({ invoice: r.invoice_no, date: day(r.created_at), customer: str(r.customer_name),
                                qty: num(r.qty), price: num(r.unit_price), total: num(r.line_total) })),
    onOrder: po.map((o) => ({ po: str(o.po_no), ordered: day(o.ordered_at), left: num(o.qty) - num(o.received),
                              supplier: str(o.supplier), by: str(o.ship_by) })),
    changes, canSeeMoney: money,
  };
  if (showSupplier) out.supplier = str(p.supplier);
  if (money) {
    out.cost = cost;
    out.margin = sell > 0 && cost > 0 ? Math.round((sell - cost) / sell * 1000) / 10 : null;
    out.stockValueCost = Math.round(Math.max(0, stock) * cost);
  }
  out.stockValueRetail = Math.round(Math.max(0, stock) * sell);
  return out;
}

/**
 * A physical count. Each line says what was counted on the shelf; where that
 * differs from the books, one ledger line brings the books to the count.
 * Lines that agree change nothing. All of it happens, or none of it.
 */
export async function erpStockCount(ctx, payload) {
  const lines = ((payload && payload.lines) || []).filter((l) => l && str(l.sku) && l.counted !== '' && l.counted !== null && l.counted !== undefined);
  if (!lines.length) throw new Error('Type what you counted for at least one product.');
  if (lines.length > 2000) throw new Error('That is too many lines for one count. Save it in parts.');
  const note = str(payload && payload.note).slice(0, 200);
  const seen = {};
  for (const l of lines) {
    const k = str(l.sku).toLowerCase(), c = Number(l.counted);
    if (seen[k]) throw new Error(str(l.sku) + ' is in the count twice.');
    seen[k] = true;
    if (!isFinite(c) || c < 0 || Math.round(c) !== c) throw new Error(str(l.sku) + ': the count must be a whole number, 0 or more.');
  }

  // nothing may be sold or received while the count is being written
  await lock(ctx, 'stock');
  await lock(ctx, 'sale');
  // a product that has never moved is being counted for the first time: that is its opening stock
  const rows = await ctx.tx`
    select p.id, p.sku, p.name, p.cost_price, coalesce(ps.stock, 0) as stock,
           not exists (select 1 from stock_movements m where m.product_id = p.id) as fresh
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${ctx.biz}`;
  const bySku = {};
  rows.forEach((r) => { bySku[str(r.sku).toLowerCase()] = r; });

  const now = new Date(), stamp = formatDate(now, 'd MMM yyyy');
  const changed = [];
  let same = 0, up = 0, down = 0, opening = 0;
  for (const l of lines) {
    const p = bySku[str(l.sku).toLowerCase()];
    if (!p) throw new Error('Product not found: ' + str(l.sku));
    const counted = Number(l.counted), had = num(p.stock), diff = round2(counted - had);
    if (diff === 0) { same++; continue; }
    const no = 'TXN-' + formatDate(now, 'yyyyMMdd') + '-' + (Math.floor(Math.random() * 9000) + 1000);
    if (p.fresh && diff > 0) {
      const cost = num(p.cost_price);
      await ctx.tx`
        insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference,
                                     supplier, note, created_by, created_at, txn_no, operator, product_name)
        values (${ctx.biz}, ${p.id}, 'OPENING', 'IN', ${diff}, ${cost}, ${round2(cost * diff)},
                ${'Opening stock ' + stamp}, '', ${note || 'counted on the shelf'},
                ${ctx.s.userId}, ${now}, ${no}, ${who(ctx)}, ${str(p.name)})`;
      up += diff; opening++;
      changed.push({ sku: str(p.sku), name: str(p.name), was: had, now: counted, diff });
      continue;
    }
    await ctx.tx`
      insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference,
                                   supplier, note, created_by, created_at, txn_no, operator, product_name)
      values (${ctx.biz}, ${p.id}, 'ADJUST', ${diff > 0 ? 'IN' : 'OUT'}, ${Math.abs(diff)}, 0, 0,
              ${'Stock count ' + stamp}, '', ${'counted ' + counted + ', books said ' + had + (note ? ' · ' + note : '')},
              ${ctx.s.userId}, ${now}, ${no}, ${who(ctx)}, ${str(p.name)})`;
    if (diff > 0) up += diff; else down += -diff;
    changed.push({ sku: str(p.sku), name: str(p.name), was: had, now: counted, diff });
  }
  forget(ctx, 'TXN_LOG');
  delete ctx.memo.catalog;
  return { ok: true, checked: lines.length, same, changed: changed.length, up, down, opening, lines: changed.slice(0, 200) };
}

/**
 * Plan A1, once: sales made before the cost was kept on each line get today's
 * cost written on them (the product's own, or the price book's). After this
 * they no longer follow later price changes. Lines whose product still has no
 * cost anywhere are left alone and are filled the next time this runs.
 */
export async function erpFreezeSaleCosts(ctx) {
  const { products } = await import('./dashboard.js');
  const { bySku } = await products(ctx);
  const skus = [], costs = [];
  for (const k of Object.keys(bySku)) if (bySku[k].cost > 0) { skus.push(k); costs.push(bySku[k].cost); }
  const before = (await ctx.tx`select count(*)::int n from invoice_lines where business_id = ${ctx.biz} and coalesce(unit_cost, 0) = 0`)[0].n;
  if (skus.length) {
    await ctx.tx`
      update invoice_lines l set unit_cost = v.c
      from unnest(${skus}::text[], ${costs}::numeric[]) as v(s, c)
      where l.business_id = ${ctx.biz} and coalesce(l.unit_cost, 0) = 0 and lower(btrim(l.sku)) = v.s`;
  }
  const after = (await ctx.tx`select count(*)::int n from invoice_lines where business_id = ${ctx.biz} and coalesce(unit_cost, 0) = 0`)[0].n;
  forget(ctx, 'SALES_LOG');
  return { ok: true, fixed: before - after, stillWithoutCost: after };
}

// ------------------------------------------------------------------ photos (plan D3)
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const THUMB_OK = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

async function productRow(ctx, sku) {
  const k = str(sku);
  if (!k) throw new Error('Which product?');
  const p = (await ctx.tx`select id, sku, name, photo from products where business_id = ${ctx.biz} and lower(btrim(sku)) = ${k.toLowerCase()} limit 1`)[0];
  if (!p) throw new Error('That product is no longer on the list.');
  return p;
}

/**
 * Keep (or remove) a product's photo.
 *   { sku, file: { data (base64), mime }, thumb (data: URL, made by the browser) }   or   { sku, remove: true }
 */
export async function erpProductPhoto(ctx, payload) {
  payload = payload || {};
  const p = await productRow(ctx, payload.sku);
  if (payload.remove) {
    if (str(p.photo)) await deleteFile(ctx, 'products', str(p.photo));
    await ctx.tx`update products set photo = null, thumb = null where id = ${p.id}`;
    return { ok: true, sku: str(p.sku), thumb: '', photo: false };
  }
  const f = payload.file || {};
  const ext = PHOTO_TYPES[str(f.mime)];
  if (!ext) throw new Error('A product photo is a JPG, PNG or WebP picture.');
  const thumb = str(payload.thumb);
  if (!THUMB_OK.test(thumb) || thumb.length > 24000) throw new Error('The small picture for the lists could not be made. Try another photo.');
  let bytes;
  try {
    const bin = atob(String(f.data || ''));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (_) { throw new Error('That picture could not be read. Try again.'); }
  if (!bytes.length) throw new Error('That picture is empty.');
  if (bytes.length > 2 * 1024 * 1024) throw new Error('That picture is over 2 MB. Use a smaller one.');
  const name = str(p.sku).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) + '-' + Date.now() + '.' + ext;
  if (str(p.photo)) await deleteFile(ctx, 'products', str(p.photo));
  await saveFile(ctx, 'products', name, bytes, str(f.mime));
  await ctx.tx`update products set photo = ${name}, thumb = ${thumb} where id = ${p.id}`;
  return { ok: true, sku: str(p.sku), thumb, photo: true };
}

/** A link to the full picture (links expire, so one is made each time). */
export async function erpProductPhotoUrl(ctx, payload) {
  const p = await productRow(ctx, payload && payload.sku);
  if (!str(p.photo)) throw new Error('No photo is kept for that product.');
  return { url: await fileUrl(ctx, 'products', str(p.photo)) };
}

/** Every product's small picture, by product code - fetched once and kept by the browser. */
export async function erpProductThumbs(ctx) {
  const out = {};
  for (const r of await ctx.tx`select sku, thumb from products where business_id = ${ctx.biz} and thumb is not null`) {
    out[str(r.sku).toLowerCase()] = str(r.thumb);
  }
  return { thumbs: out };
}

// ------------------------------------------------------------------ colour families (plan D3)
/**
 * The families there are, and the ones that could be made: products of the
 * same category, brand and type that differ only by colour.
 */
export async function erpFamilies(ctx) {
  const rows = await ctx.tx`
    select p.sku, p.name, p.category, p.brand, p.type, p.color, p.family, coalesce(ps.stock, 0) as stock
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${ctx.biz} and coalesce(p.status, 'Active') <> 'Discontinued'
    order by p.category, p.brand, p.type, p.color, p.name`;
  const fams = {}, props = {}, taken = {};
  for (const r of rows) {
    const one = { sku: str(r.sku), name: str(r.name), color: str(r.color), stock: num(r.stock) };
    const f = str(r.family);
    if (f) { (fams[f] = fams[f] || { name: f, products: [], stock: 0 }).products.push(one); fams[f].stock += one.stock; taken[f.toLowerCase()] = true; continue; }
    const type = str(r.type), brand = str(r.brand);
    if (!type) continue;                                  // nothing to tell which ones belong together
    const key = [str(r.category), brand, type].join('|').toLowerCase();
    (props[key] = props[key] || { key, name: (brand ? brand + ' ' : '') + type, category: str(r.category), products: [], stock: 0 }).products.push(one);
    props[key].stock += one.stock;
  }
  const proposals = Object.values(props).filter((g) => g.products.length >= 2);
  // two categories can hold the same brand and type: tell the names apart
  const seen = {};
  for (const g of proposals) {
    const k = g.name.toLowerCase();
    if (seen[k] || taken[k]) g.name = g.name + ' (' + (g.category || 'other') + ')';
    seen[g.name.toLowerCase()] = true;
  }
  return { families: Object.values(fams).sort((a, b) => a.name.localeCompare(b.name)), proposals,
           ungrouped: rows.filter((r) => !str(r.family)).length, total: rows.length };
}

/** Make (or add to) families: { groups: [{ name, skus: [...] }] }. Only the label is written. */
export async function erpFamilyApply(ctx, payload) {
  const groups = (payload && payload.groups) || [];
  if (!Array.isArray(groups) || !groups.length) throw new Error('Tick at least one group.');
  if (groups.length > 500) throw new Error('That is too many at once.');
  let n = 0;
  for (const g of groups) {
    const name = str(g && g.name).slice(0, 80);
    const skus = Array.isArray(g && g.skus) ? g.skus.map((x) => str(x).toLowerCase()).filter(Boolean).slice(0, 500) : [];
    if (!name) throw new Error('Every family needs a name.');
    if (!skus.length) continue;
    const done = await ctx.tx`update products set family = ${name}, updated_at = now()
                              where business_id = ${ctx.biz} and lower(btrim(sku)) = any(${skus}) returning id`;
    n += done.length;
  }
  delete ctx.memo.catalog;
  return { ...(await erpFamilies(ctx)), changed: n };
}

/** Take the label off: a whole family ({ name }) or one product ({ sku }). Nothing else changes. */
export async function erpFamilyClear(ctx, payload) {
  const name = str(payload && payload.name), sku = str(payload && payload.sku).toLowerCase();
  if (!name && !sku) throw new Error('Which family?');
  const done = name
    ? await ctx.tx`update products set family = null, updated_at = now() where business_id = ${ctx.biz} and family = ${name} returning id`
    : await ctx.tx`update products set family = null, updated_at = now() where business_id = ${ctx.biz} and lower(btrim(sku)) = ${sku} returning id`;
  delete ctx.memo.catalog;
  return { ...(await erpFamilies(ctx)), changed: done.length };
}

export const HANDLERS = { erpProductPage, erpStockCount, erpFreezeSaleCosts, erpProductPhoto, erpProductPhotoUrl, erpProductThumbs,
                          erpFamilies, erpFamilyApply, erpFamilyClear };
