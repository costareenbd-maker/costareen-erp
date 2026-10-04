// Serial numbers and warranty (plan D1, 040_serials.sql).
//
//   erpSerialSetup({sku, serialised, warrantyMonths})   the product: has serials? warranty from now on?
//   erpSerialsAdd({sku, serials: [...], ref})           units on the shelf get their numbers
//   erpSerialsFor({sku})                                 what is on the shelf, what was sold
//   erpSerialLookup({q})                                 any serial: who bought it, when, warranty left
//   erpSerialWarranty({serial, sku, months|until})      change ONE sold unit's warranty (shareholder+)
//
// A sale of a serialised product names the unit(s) that went out (createInvoice
// -> sellSerials); the warranty each unit gets is the product's at that moment,
// or what was typed for that line. A return brings the unit back (returnSerials).

import { formatDate, num, dhakaDayStart } from '../lib/time.js';
import { roleAtLeast, powerOn, callAllowed } from '../allow.js';
import { who } from './money.js';

const str = (v) => String(v == null ? '' : v).trim();
const clean = (v) => str(v).replace(/\s+/g, '').toUpperCase();
const day = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const DAY = 86400e3;

async function product(ctx, sku) {
  const k = str(sku);
  if (!k) throw new Error('Which product?');
  const p = (await ctx.tx`select p.id, p.sku, p.name, p.serialised, p.warranty_months, coalesce(ps.stock, 0) as stock
                          from products p left join product_stock ps on ps.product_id = p.id
                          where p.business_id = ${ctx.biz} and lower(btrim(p.sku)) = ${k.toLowerCase()} limit 1`)[0];
  if (!p) throw new Error('That product is no longer on the list.');
  return p;
}

/** Warranty end for a sale on `at` with `months` of warranty (null when none). */
export function warrantyUntil(at, months) {
  months = Math.round(num(months));
  if (!(months > 0)) return null;
  const d = new Date(dhakaDayStart(formatDate(at, 'yyyy-MM-dd')).getTime() + 12 * 3600e3);
  d.setUTCMonth(d.getUTCMonth() + months);
  return formatDate(d, 'yyyy-MM-dd');
}
function left(until, now) {
  if (!until) return null;
  const end = dhakaDayStart(formatDate(new Date(until), 'yyyy-MM-dd')).getTime() + DAY - 1;
  return Math.ceil((end - now.getTime()) / DAY);
}
function row(r, now) {
  const l = left(r.warranty_until, now);
  return { id: r.id, sku: str(r.sku), serial: str(r.serial), status: str(r.status), received: day(r.received_at), ref: str(r.receive_ref),
           sold: day(r.sold_at), invoiceNo: str(r.invoice_no), customer: str(r.customer), customerKey: str(r.customer_key),
           warrantyMonths: r.warranty_months == null ? null : num(r.warranty_months), warrantyUntil: r.warranty_until ? formatDate(new Date(r.warranty_until), 'yyyy-MM-dd') : '',
           warrantyUntilText: day(r.warranty_until), daysLeft: l, inWarranty: l !== null && l > 0, returned: day(r.returned_at), note: str(r.note) };
}

export async function erpSerialSetup(ctx, payload) {
  payload = payload || {};
  const p = await product(ctx, payload.sku);
  const on = !!payload.serialised;
  let months = payload.warrantyMonths === '' || payload.warrantyMonths === null || payload.warrantyMonths === undefined ? null : Math.round(num(payload.warrantyMonths));
  if (months !== null && (months < 0 || months > 120)) throw new Error('Warranty is a number of months, 0 to 120. Empty means no warranty.');
  if (months === 0) months = null;
  await ctx.tx`update products set serialised = ${on}, warranty_months = ${months}, updated_at = now() where id = ${p.id}`;
  delete ctx.memo.catalog;
  return erpSerialsFor(ctx, { sku: p.sku });
}

/** Register the numbers of units on the shelf. Called from the product page, and by receiveShipment. */
export async function registerSerials(ctx, sku, list, ref) {
  const p = await product(ctx, sku);
  const want = [];
  const seen = {};
  for (const s of Array.isArray(list) ? list : String(list || '').split(/[\n,;]+/)) {
    const c = clean(s);
    if (!c) continue;
    if (c.length < 3 || c.length > 60) throw new Error('"' + c + '" does not look like a serial number (3 to 60 letters and digits).');
    if (seen[c]) throw new Error('Serial ' + c + ' is typed twice.');
    seen[c] = true; want.push(c);
  }
  if (!want.length) throw new Error('Type the serial numbers, one per line.');
  if (!p.serialised) await ctx.tx`update products set serialised = true, updated_at = now() where id = ${p.id}`;
  const dup = await ctx.tx`select serial, status from serials where business_id = ${ctx.biz} and product_id = ${p.id} and serial = any(${want})`;
  if (dup.length) throw new Error('Already on the list: ' + dup.map((d) => d.serial + ' (' + d.status.replace('_', ' ') + ')').join(', ') + '.');
  const have = (await ctx.tx`select count(*)::int n from serials where business_id = ${ctx.biz} and product_id = ${p.id} and status = 'in_stock'`)[0].n;
  if (have + want.length > num(p.stock)) {
    throw new Error(p.name + ' has ' + num(p.stock) + ' in stock and ' + have + ' already numbered: at most ' + Math.max(0, num(p.stock) - have) + ' more number(s) can be added. Receive the stock first.');
  }
  const rows = want.map((serial) => ({ business_id: ctx.biz, product_id: p.id, sku: str(p.sku), serial, receive_ref: str(ref) || null, created_by: who(ctx) }));
  await ctx.tx`insert into serials ${ctx.tx(rows, 'business_id', 'product_id', 'sku', 'serial', 'receive_ref', 'created_by')}`;
  delete ctx.memo.catalog;
  return want.length;
}

export async function erpSerialsAdd(ctx, payload) {
  payload = payload || {};
  const n = await registerSerials(ctx, payload.sku, payload.serials, payload.ref);
  return { ...(await erpSerialsFor(ctx, { sku: payload.sku })), added: n };
}

export async function erpSerialsFor(ctx, payload) {
  const p = await product(ctx, payload && payload.sku);
  const rows = await ctx.tx`select * from serials where business_id = ${ctx.biz} and product_id = ${p.id}
                            order by (status = 'in_stock') desc, sold_at desc nulls last, received_at desc limit 500`;
  const all = rows.map((r) => row(r, ctx.now));
  const inStock = all.filter((r) => r.status === 'in_stock');
  return { sku: str(p.sku), name: str(p.name), serialised: !!p.serialised, warrantyMonths: p.warranty_months == null ? null : num(p.warranty_months),
           stock: num(p.stock), inStock, sold: all.filter((r) => r.status !== 'in_stock').slice(0, 200),
           unnumbered: Math.max(0, num(p.stock) - inStock.length), canEdit: powerOn(ctx.s, 'stock') };
}

/** Any serial, from a few characters: whose it is, when it was sold, warranty left. */
export async function erpSerialLookup(ctx, payload) {
  const q = clean(payload && payload.q);
  if (q.length < 3) return { q, hits: [] };
  const like = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const rows = await ctx.tx`select s.*, p.name from serials s join products p on p.id = s.product_id
                            where s.business_id = ${ctx.biz} and upper(s.serial) like ${like}
                            order by (upper(s.serial) = ${q}) desc, s.sold_at desc nulls last limit 20`;
  return { q, hits: rows.map((r) => ({ ...row(r, ctx.now), product: str(r.name) })) };
}

/** A sold unit's warranty, changed by hand: a special deal, a correction. */
export async function erpSerialWarranty(ctx, payload) {
  payload = payload || {};
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only a shareholder or the owner changes a warranty already given.');
  const serial = clean(payload.serial), sku = str(payload.sku);
  const r = (await ctx.tx`select s.* from serials s where s.business_id = ${ctx.biz} and upper(s.serial) = ${serial}
                           and (${sku} = '' or lower(btrim(s.sku)) = ${sku.toLowerCase()}) and s.status = 'sold' limit 1`)[0];
  if (!r) throw new Error('No sold unit with serial ' + serial + '.');
  let until = null, months = null;
  if (str(payload.until)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(payload.until))) throw new Error('The date should look like 2027-10-05.');
    until = str(payload.until);
  } else {
    months = Math.round(num(payload.months));
    if (months < 0 || months > 120) throw new Error('Warranty is a number of months, 0 to 120.');
    until = months > 0 ? warrantyUntil(new Date(r.sold_at), months) : null;
    if (months === 0) months = null;
  }
  const why = str(payload.reason).slice(0, 200);
  if (!why) throw new Error('Say why the warranty is changed, so it can be read later.');
  await ctx.tx`update serials set warranty_until = ${until}, warranty_months = ${months},
                 note = ${(str(r.note) ? str(r.note) + ' | ' : '') + 'warranty changed ' + formatDate(ctx.now, 'd MMM yy') + ' by ' + who(ctx) + ': ' + why}
               where id = ${r.id}`;
  return erpSerialsFor(ctx, { sku: r.sku });
}

/**
 * At the sale: every unit of a serialised product that goes out is named.
 * items: [{ sku, qty, serials: [...], warrantyMonths? }], recs: the catalogue by sku.
 * Lenient only when the product has no numbered unit at all (numbers never typed): then the sale goes through unnamed.
 */
export async function sellSerials(ctx, invoiceNo, customer, key, at, items, recs, opts = {}) {
  const out = [];
  for (const it of items) {
    const rec = recs[str(it.sku).toLowerCase()];
    if (!rec || !rec.serialised) continue;
    const qty = Math.round(num(it.qty));
    const want = (Array.isArray(it.serials) ? it.serials : []).map(clean).filter(Boolean);
    const onShelf = await ctx.tx`select id, serial from serials where business_id = ${ctx.biz} and lower(btrim(sku)) = ${str(it.sku).toLowerCase()} and status = 'in_stock'`;
    if (!want.length) {
      if (!onShelf.length || opts.partnerDeal) continue;            // nothing numbered yet: let the sale through
      throw new Error(rec.name + ' is sold by serial number: pick which ' + (qty === 1 ? 'unit goes' : qty + ' units go') + ' out (' + onShelf.length + ' on the shelf).');
    }
    if (want.length !== qty) throw new Error(rec.name + ': ' + qty + ' sold but ' + want.length + ' serial number(s) named.');
    const bySerial = {}; onShelf.forEach((s) => { bySerial[clean(s.serial)] = s; });
    const missing = want.filter((w) => !bySerial[w]);
    if (missing.length) throw new Error('Not on the shelf for ' + rec.name + ': ' + missing.join(', ') + '.');
    if (new Set(want).size !== want.length) throw new Error('The same serial is named twice for ' + rec.name + '.');
    const months = it.warrantyMonths === '' || it.warrantyMonths === null || it.warrantyMonths === undefined
      ? (rec.warrantyMonths == null ? null : num(rec.warrantyMonths)) : Math.round(num(it.warrantyMonths));
    const until = warrantyUntil(at, months);
    for (const w of want) {
      await ctx.tx`update serials set status = 'sold', sold_at = ${at}, invoice_no = ${invoiceNo}, customer = ${customer}, customer_key = ${key || null},
                     warranty_months = ${months > 0 ? months : null}, warranty_until = ${until}, returned_at = null where id = ${bySerial[w].id}`;
      out.push({ sku: str(it.sku), serial: w, warrantyUntil: until });
    }
  }
  return out;
}

/** Goods back: the named units (or, when none are named and all units come back, every unit of that line). */
export async function returnSerials(ctx, invoiceNo, take, asked) {
  for (let i = 0; i < take.length; i++) {
    const t = take[i], a = asked && asked[i] ? asked[i] : {};
    const sold = await ctx.tx`select id, serial from serials where business_id = ${ctx.biz} and invoice_no = ${invoiceNo}
                              and lower(btrim(sku)) = ${str(t.sku).toLowerCase()} and status = 'sold'`;
    if (!sold.length) continue;
    let ids = [];
    const want = (Array.isArray(a.serials) ? a.serials : []).map(clean).filter(Boolean);
    if (want.length) {
      const by = {}; sold.forEach((s) => { by[clean(s.serial)] = s.id; });
      const missing = want.filter((w) => !by[w]);
      if (missing.length) throw new Error('Not sold on ' + invoiceNo + ': ' + missing.join(', ') + '.');
      ids = want.map((w) => by[w]);
    } else if (num(t.qty) >= sold.length) ids = sold.map((s) => s.id);
    else throw new Error(t.product + ' is sold by serial number: say which ' + num(t.qty) + ' of the ' + sold.length + ' came back.');
    if (ids.length !== num(t.qty)) throw new Error(t.product + ': ' + num(t.qty) + ' back but ' + ids.length + ' serial number(s) named.');
    await ctx.tx`update serials set status = ${t.good ? 'in_stock' : 'damaged'}, returned_at = ${new Date()},
                   note = ${'back from ' + invoiceNo} where id = any(${ids})`;
  }
}

/** The serials sold on an invoice, by sku - for the invoice page and the PDF. */
export async function serialsOnInvoice(ctx, invoiceNo) {
  const out = {};
  try {
    const rows = await ctx.tx.savepoint(() => ctx.tx`select sku, serial, warranty_until, status from serials where business_id = ${ctx.biz} and invoice_no = ${invoiceNo} order by serial`);
    for (const r of rows) (out[str(r.sku).toLowerCase()] = out[str(r.sku).toLowerCase()] || []).push({ serial: str(r.serial), warrantyUntil: day(r.warranty_until), back: r.status !== 'sold' });
  } catch (_) { /* before the table exists */ }
  return out;
}

export const HANDLERS = { erpSerialSetup, erpSerialsAdd, erpSerialsFor, erpSerialLookup, erpSerialWarranty };
