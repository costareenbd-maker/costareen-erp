// Group 'stock': products, receiving (the costing engine), adjustments,
// stock history, the To-order plan and purchase orders.
// Spec: docs/spec/02-products-stock.md. Original: ERP.js 1225-1395,
// 1846-1893, 2761-2810, 3135-3370, 6380-6460, 7834-8290; Code.js 90-113,
// 1668-1752. Deliberate changes: docs/fixes/stock.md.
//
// Stock is the product_stock view over stock_movements (the TXN_LOG ledger);
// there is no STOCK_VIEW to refresh, so every refreshStockView() call of the
// original simply disappears.

import { erpCatalog, erpProduct } from './catalog.js';
import { forget, str } from '../lib/tabs.js';
import { formatDate, num, round2, DAY_MS, dhakaDayStart } from '../lib/time.js';
import { assertOpen } from '../lib/period.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast, powerOn, callAllowed, actRole } from '../allow.js';
import { lock, who } from './money.js';
import { billForShipment } from './suppliers.js';
import { ratesMap, landedCost, saveRate } from './currency.js';
import { registerSerials, applyRuleToProduct } from './serials.js';

// CFG.SKU_PREFIX / CFG.BRAND_CODE (Code.js:40-56)
export const SKU_PREFIX = {
  Filaments: 'FIL', Printers: 'PRT', Accessories: 'ACC', Parts: 'PTS', Consumables: 'CON', Tools: 'TLS',
};
export const BRAND_CODE = {
  Sunlu: 'SUN', Bambulab: 'BAM', Creality: 'CRE', eSUN: 'ESN', Polymaker: 'PLY', BIQU: 'BIQ', 'Jamg He': 'JHE',
};
const DEFAULT_REORDER = 5;     // CFG.DEFAULTS.REORDER
const DEFAULT_LEAD = 7;        // CFG.DEFAULTS.LEAD_TIME
const SEP = '\u0001';

// ------------------------------------------------------------------ helpers

/** generateTxnId_ (Code.js:79) */
function txnId(now) {
  return 'TXN-' + formatDate(now, 'yyyyMMdd') + '-' + (Math.floor(Math.random() * 9000) + 1000);
}

/** All of this business's PRODUCT_MASTER rows, in sheet (insertion) order. */
async function pmRows(ctx) {
  return ctx.tx`
    select id, sku, name, category, brand, type, cost_price, reorder_level, status, weight_g, length_mm, width_mm, height_mm
    from products where business_id = ${ctx.biz}
    order by date_added, created_at, sku`;
}

/** One product by SKU (trimmed, case-insensitive), or undefined. */
async function productBySku(ctx, sku) {
  const r = await ctx.tx`
    select id, sku, name, category, brand, type, supplier, cost_price, status
    from products where business_id = ${ctx.biz} and lower(btrim(sku)) = ${str(sku).toLowerCase()}
    limit 1`;
  return r[0];
}

/** erpOnHandMap_ (ERP:3135): on hand per lower-cased SKU, from the ledger. */
export async function onHandMap(ctx) {
  const rows = await ctx.tx`
    select lower(btrim(p.sku)) as k, ps.stock
    from product_stock ps join products p on p.id = ps.product_id
    where ps.business_id = ${ctx.biz}`;
  const map = {};
  for (const r of rows) if (r.k) map[r.k] = (map[r.k] || 0) + (Number(r.stock) || 0);
  return map;
}

/** The COST_PRICES key: category|brand|type, trimmed and lower-cased. */
function bookKeyOf(cat, brand, type) {
  return [str(cat), str(brand), str(type)].join(SEP).toLowerCase();
}

/**
 * erpBookCostMap_ (ERP:3154): lower(category|brand|type) -> landed cost, for
 * every price-book row that lands above 0. Landed is the sheet's G formula:
 *   handling h = row handling, or the default (cost_handling) when blank
 *   landed = buy_rmb > 0 ? round(rmb x cost_rate + h, 2)
 *          : buy_bdt > 0 ? round(bdt + h, 2) : blank
 * Later rows win, as the original's loop over the tab did.
 */
export async function bookCostMap(ctx) {
  if (ctx.memo.bookCost) return ctx.memo.bookCost;
  const rates = await ratesMap(ctx);
  const defH = num(await getConfig(ctx, 'cost_handling', '0'));
  const rows = await ctx.tx`
    select category, brand, type, buy_rmb, buy_bdt, buy_amount, buy_cur, handling
    from cost_book where business_id = ${ctx.biz}
    order by sort_order, id`;
  const map = {};
  for (const r of rows) {
    const landed = landedCost(r, rates, defH) || 0;
    if (landed > 0) map[bookKeyOf(r.category, r.brand, r.type)] = landed;
  }
  ctx.memo.bookCost = map;
  return map;
}

/**
 * The price book's landed cost for a product, or 0. The exact key first; then
 * the key the price book itself writes for blank attributes (erpCostSync_
 * ERP:3028 stores a blank category as 'Uncategorised' and a blank brand/type
 * as '-'), so blank-attribute products find their row (fix, docs/fixes/stock.md).
 */
export function bookCost(book, cat, brand, type) {
  const k = bookKeyOf(cat, brand, type);
  if (Object.prototype.hasOwnProperty.call(book, k)) return book[k];
  const k2 = bookKeyOf(str(cat) || 'Uncategorised', str(brand) || '-', str(type) || '-');
  return Object.prototype.hasOwnProperty.call(book, k2) ? book[k2] : 0;
}

/** One TXN_LOG row. */
async function addMovement(ctx, m) {
  const at = m.at || new Date(), no = txnId(at);
  await ctx.tx`
    insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total,
                                 reference, supplier, note, created_by, created_at, txn_no,
                                 operator, product_name)
    values (${ctx.biz}, ${m.productId}, ${m.kind}, ${m.direction}, ${m.qty}, ${m.unit || 0},
            ${m.total || 0}, ${m.reference || ''}, ${m.supplier || ''}, ${m.note || ''},
            ${ctx.s.userId}, ${at}, ${no}, ${m.operator || who(ctx)}, ${m.name || ''})`;
  return no;
}

/** generateSKU_ (Code.js:90): CAT-BRD-TYPE-CLR-nnn, next free number for that prefix. */
export async function generateSku(ctx, category, brand, type, color) {
  category = String(category || ''); brand = String(brand || '');
  type = String(type || ''); color = String(color || '');
  const catCode = SKU_PREFIX[category] || category.substring(0, 3).toUpperCase();
  const brdCode = BRAND_CODE[brand] || brand.substring(0, 3).toUpperCase();
  const typeCode = type.replace(/[^A-Za-z0-9+]/g, '').substring(0, 5).toUpperCase();
  const clrCode = color.substring(0, 3).toUpperCase();
  const prefix = catCode + '-' + brdCode + '-' + typeCode + '-' + clrCode + '-';
  const rows = await ctx.tx`select sku from products where business_id = ${ctx.biz}`;
  let maxSeq = 0;
  for (const r of rows) {
    const id = String(r.sku || '');
    if (id && id.startsWith(prefix)) {         // case-sensitive, as the original
      const parts = id.split('-');
      const n = parseInt(parts[parts.length - 1]);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    }
  }
  return prefix + String(maxSeq + 1).padStart(3, '0');
}

/**
 * addProductAPI (Code.js:1716): append a PRODUCT_MASTER row (and an OPENING
 * movement when opening_stock > 0). `||` defaults as the original: reorder
 * 0 -> 5, lead 0 -> 7, unit -> Piece, status -> Active.
 * Returns { success, sku, id, product_name } or { success:false, error }.
 */
export async function addProduct(ctx, data) {
  const sku = str(data.sku) || await generateSku(ctx, data.category, data.brand, data.type, data.color);
  const dup = await ctx.tx`select 1 from products where business_id = ${ctx.biz}
                           and lower(btrim(sku)) = ${sku.toLowerCase()} limit 1`;
  if (dup.length) return { success: false, error: 'SKU already exists: ' + sku };

  const now = new Date();
  const cost = num(data.cost_price) || 0;
  const r = await ctx.tx`
    insert into products (business_id, sku, name, category, brand, type, color, unit, supplier,
                          cost_price, sell_price, reorder_level, lead_time_days, location_bin,
                          status, date_added, notes)
    values (${ctx.biz}, ${sku}, ${String(data.product_name || '')}, ${String(data.category || '')},
            ${String(data.brand || '')}, ${String(data.type || '')}, ${String(data.color || '')},
            ${String(data.unit || 'Piece')}, ${String(data.supplier || '')}, ${cost},
            ${num(data.sell_price) || 0}, ${num(data.reorder_level) || DEFAULT_REORDER},
            ${Math.round(num(data.lead_time_days) || DEFAULT_LEAD)}, ${String(data.location_bin || '')},
            ${String(data.status || 'Active')}, ${now}, ${String(data.notes || '')})
    returning id`;
  const id = r[0].id;
  // Stage N0: a new product takes the warranty rule of its category and brand (the caller's own values win)
  try { await applyRuleToProduct(ctx, id, data.category, data.brand, { serialised: data.serialised, warranty_months: data.warranty_months }); } catch (e) { console.error('warranty rule', e); }
  const opening = num(data.opening_stock);
  if (opening > 0) {
    await addMovement(ctx, { productId: id, kind: 'OPENING', direction: 'IN', qty: opening, unit: cost,
      total: round2(opening * cost), reference: 'API - New Product', supplier: String(data.supplier || ''),
      at: now, name: String(data.product_name || '') });
    forget(ctx, 'TXN_LOG');
  }
  delete ctx.memo.catalog;
  return { success: true, sku, id, product_name: data.product_name };
}

/** 108: a product's shipping size - only the fields that were sent; '' or 0 clears one. */
async function saveSize(ctx, id, d) {
  const f = { weight_g: 'weight_g', length_mm: 'length_mm', width_mm: 'width_mm', height_mm: 'height_mm' };
  const set = {};
  for (const k of Object.keys(f)) {
    if (d[k] === undefined) continue;
    const v = num(d[k]);
    if (v < 0 || v > 1e6) throw new Error('That size or weight looks wrong (' + d[k] + ').');
    set[k] = v > 0 ? v : null;
  }
  if (!Object.keys(set).length) return;
  await ctx.tx`update products set ${ctx.tx(set)}, updated_at = now() where id = ${id} and business_id = ${ctx.biz}`;
}

/** 108: the same size for many products at once (e.g. every 1 kg spool: 1300 g, box 210 x 210 x 80 mm). */
export async function erpProductSizes(ctx, payload) {
  payload = payload || {};
  if (!powerOn(ctx.s, 'products')) throw new Error('Your account cannot change products.');
  const skus = (Array.isArray(payload.skus) ? payload.skus : []).map((x) => str(x).toLowerCase()).filter(Boolean);
  const cat = str(payload.category).toLowerCase();
  if (!skus.length && !cat) throw new Error('Which products? Choose some, or a category.');
  const rows = await ctx.tx`select id from products where business_id = ${ctx.biz}
                            and (lower(btrim(sku)) = any(${skus}) or (${cat} <> '' and lower(btrim(category)) = ${cat}))`;
  if (!rows.length) throw new Error('No products matched.');
  for (const r of rows) await saveSize(ctx, r.id, payload);
  delete ctx.memo.catalog;
  return { ok: true, changed: rows.length };
}

/** erpRefuseDiscontinue_ (ERP:1846) */
async function refuseDiscontinue(ctx, sku, name) {
  let left = 0;
  try { left = (await onHandMap(ctx))[str(sku).toLowerCase()] || 0; } catch (_) { /* as original */ }
  if (left > 0) {
    throw new Error((name || sku) + ' still has ' + left + ' in stock, so it cannot be ' +
                    'discontinued yet. Sell what is left, or remove it with a stock ' +
                    'adjustment if it is damaged or lost, then discontinue it.');
  }
}

// ----------------------------------------------------------------- products

/** erpSaveProduct (ERP:1225) */
/**
 * pf-plus-1 (owner 21 Oct 2026, "Fossil Grey (not on the list any more)"): a new product's category, brand, type, colour,
 * unit and supplier that are not on Settings > Lists yet are added to them (any case counts as already there), so the
 * next product offers them too.
 */
export async function addToLists(ctx, data) {
  const pairs = [['categories', data.category], ['brands', data.brand], ['types', data.type], ['colors', data.color], ['units', data.unit], ['suppliers', data.supplier]];
  for (const [kind, v0] of pairs) {
    const v = str(v0).replace(/\s+/g, ' ').slice(0, 80);
    if (!v) continue;
    const have = await ctx.tx`select 1 from lookups where business_id = ${ctx.biz} and kind = ${kind} and lower(btrim(value)) = ${v.toLowerCase()} limit 1`;
    if (have.length) continue;
    const n = (await ctx.tx`select coalesce(max(sort_order), 0)::int as n from lookups where business_id = ${ctx.biz} and kind = ${kind}`)[0].n;
    await ctx.tx`insert into lookups (business_id, kind, value, sort_order) values (${ctx.biz}, ${kind}, ${v}, ${n + 1})`;
  }
}

export async function erpSaveProduct(ctx, data) {
  if (!data) throw new Error('Nothing to save.');
  const name = str(data.product_name);
  if (!name) throw new Error('Product name is required.');
  if (num(data.sell_price) < 0 || num(data.cost_price) < 0 || num(data.wholesale_price) < 0) throw new Error('Prices cannot be negative.');

  await lock(ctx, 'stock');
  if (data.isNew) {
    const res = await addProduct(ctx, {
      sku: str(data.sku), product_name: name,
      category: data.category, brand: data.brand, type: data.type,
      color: data.color, unit: data.unit || 'Piece', supplier: data.supplier,
      cost_price: num(data.cost_price), sell_price: num(data.sell_price),
      reorder_level: num(data.reorder_level), lead_time_days: num(data.lead_time_days),
      location_bin: data.location_bin, status: data.status || 'Active',
      opening_stock: num(data.opening_stock),
    });
    if (!res || !res.success) throw new Error((res && res.error) || 'Could not add the product.');
    await saveSize(ctx, res.id, data);
    await addToLists(ctx, data);   // pf-plus-1: a colour / brand / type read from a file joins Settings > Lists
    // smart-read-1: the supplier's own code (from a file read on Receive) - the next file matches it directly
    if (str(data.supplier_sku)) await ctx.tx`update products set supplier_sku = ${str(data.supplier_sku).slice(0, 60)} where id = ${res.id}`;
    if (num(data.wholesale_price) > 0) {
      await ctx.tx`update products set wholesale_price = ${num(data.wholesale_price)}
                   where business_id = ${ctx.biz} and lower(btrim(sku)) = ${String(res.sku).toLowerCase()}`;
    }
    return { ok: true, sku: res.sku, created: true };
  }

  const cur = await erpProduct(ctx, data.sku);
  if (!cur) throw new Error('Product not found: ' + data.sku);
  if (String(data.status || '') === 'Discontinued' && cur.status !== 'Discontinued') {
    await refuseDiscontinue(ctx, cur.sku, name);
  }
  // Fix (spec 02 §4.3): below shareholder the cost is scrubbed from the form,
  // so a missing / 0 cost from such an editor means "not shown", not "zero".
  let cost = num(data.cost_price);
  if (!powerOn(ctx.s, 'costs') && !(cost > 0)) cost = cur.cost_price;

  await ctx.tx`
    update products set
      name = ${name}, category = ${String(data.category || '')}, brand = ${String(data.brand || '')},
      type = ${String(data.type || '')}, color = ${String(data.color || '')},
      unit = ${String(data.unit || 'Piece')}, supplier = ${String(data.supplier || '')},
      cost_price = ${cost}, sell_price = ${num(data.sell_price)},
      wholesale_price = ${data.wholesale_price === undefined ? num(cur.wholesale_price) : num(data.wholesale_price)},
      reorder_level = ${num(data.reorder_level)}, lead_time_days = ${Math.round(num(data.lead_time_days))},
      location_bin = ${String(data.location_bin || '')}, status = ${String(data.status || 'Active')},
      updated_at = now()
    where id = ${cur.row}`;
  await saveSize(ctx, cur.row, data);
  if (data.supplier_sku !== undefined) await ctx.tx`update products set supplier_sku = ${str(data.supplier_sku).slice(0, 60) || null} where id = ${cur.row}`;
  delete ctx.memo.catalog;
  return { ok: true, sku: cur.sku, created: false };
}

/** erpSetProductStatus (ERP:1856) */
export async function erpSetProductStatus(ctx, sku, status) {
  const want = str(status);
  if (want !== 'Active' && want !== 'Discontinued') throw new Error('Status must be Active or Discontinued.');
  const key = str(sku).toLowerCase();
  if (!key) throw new Error('Which product?');
  await lock(ctx, 'stock');
  const any = await ctx.tx`select 1 from products where business_id = ${ctx.biz} limit 1`;
  if (!any.length) throw new Error('No products found.');
  const p = await productBySku(ctx, key);
  if (!p) throw new Error('Product not found: ' + sku);
  if (want === 'Discontinued') await refuseDiscontinue(ctx, key, str(p.sku));
  await ctx.tx`update products set status = ${want}, updated_at = now() where id = ${p.id}`;
  delete ctx.memo.catalog;
  return { ok: true, sku: str(p.sku), status: want };
}

/** erpDiscontinued (ERP:1888) */
export async function erpDiscontinued(ctx) {
  return (await erpCatalog(ctx)).filter((p) => String(p.status || '').toLowerCase() === 'discontinued');
}

// ---------------------------------------------------------------- receiving

/** erpReceiveShipment (ERP:3174): the costing engine. */
export async function receiveShipment(ctx, payload) {
  payload = payload || {};
  const lines = (payload.lines || []).filter((l) => l && num(l.qty) > 0 && (str(l.sku) || l.isNew));
  if (!lines.length) throw new Error('Add at least one product with a quantity.');

  // a reference is only needed for a shipment; a local buy or a campaign exchange gets one made for it
  const FROM = { shipment: 'Shipment', local: 'Bought locally', campaign: 'Campaign exchange', other: 'Received' };
  const from = FROM[str(payload.from)] ? str(payload.from) : 'shipment';
  let reference = str(payload.reference);
  if (!reference) reference = FROM[from === 'shipment' ? 'other' : from] + ' ' + formatDate(new Date(), 'yyyy-MM-dd HH:mm');

  // plan A5: 'rmb' was the only foreign money; it is now any currency ('fx', with payload.currency)
  let mode = String(payload.mode || 'none').toLowerCase();
  const fxCur = (mode === 'rmb' ? 'RMB' : str(payload.currency).toUpperCase()) || 'RMB';
  if (mode === 'fx') mode = 'rmb';
  let freight = round2(num(payload.shippingBdt));
  if (freight < 0) throw new Error('Shipping cannot be negative.');
  // 108: how each cost is shared out - 'value' (as always), 'weight' (chargeable weight) or 'units'
  const BASES = { value: 1, weight: 1, units: 1 };
  const basisOf = (b) => { const v = str(b).toLowerCase(); if (v && !BASES[v]) throw new Error('Share a cost by weight, by value or by units.'); return v; };
  const defBasis = basisOf(payload.basis) || 'value';
  const freightBasis = basisOf(payload.freightBasis) || defBasis;
  const perKg = round2(num(payload.freightPerKg));
  if (perKg < 0) throw new Error('The freight rate per kg cannot be negative.');
  const divisor = num(payload.divisor) > 0 ? num(payload.divisor) : 6000;
  if (divisor < 1000 || divisor > 10000) throw new Error('The box-size divisor is usually 6000 (between 1000 and 10000).');
  // the other costs of bringing it in: duty, VAT at the port, the C&F agent...
  const extras = [];
  for (const c of Array.isArray(payload.costs) ? payload.costs : []) {
    const amt = round2(num(c && c.amount));
    if (!amt) continue;
    if (amt < 0) throw new Error('A cost cannot be negative.');
    if (!str(c.label)) throw new Error('Say what each extra cost was (duty, agent, ...).');
    extras.push({ label: str(c.label).slice(0, 60), amount: amt, account: str(c.account), basis: basisOf(c.basis) || defBasis });
  }
  const rate = num(payload.rate);
  const totalRmb = num(payload.totalFx !== undefined ? payload.totalFx : payload.totalRmb);
  let totalBdt = num(payload.totalBdt);
  if (mode === 'rmb') {
    if (!/^[A-Z]{3,5}$/.test(fxCur) || fxCur === 'BDT') throw new Error('Choose the currency of the supplier invoice.');
    if (totalRmb <= 0) throw new Error('Enter the shipment total in ' + fxCur + ', or switch to local.');
    if (rate <= 0) throw new Error('Enter the rate you paid for this shipment (TK per ' + fxCur + ').');
    // a slip of the finger: far from the rate on record for that currency (or, for RMB with none yet, over 1,000)
    const usual = num((await ratesMap(ctx))[fxCur]);
    if ((usual > 0 && (rate > usual * 5 || rate < usual / 5)) || (!(usual > 0) && fxCur === 'RMB' && rate > 1000) || rate > 100000) {
      throw new Error('That rate looks wrong (' + rate + ' TK per ' + fxCur + (usual > 0 ? '; the usual rate is ' + usual : '') + ').');
    }
    totalBdt = totalRmb * rate;
  } else if (mode === 'bdt') {
    if (totalBdt <= 0) throw new Error('Enter what this shipment cost in taka, or switch to imported.');
  } else {
    totalBdt = 0;
  }

  await lock(ctx, 'stock');

  // owner 18 Oct 2026: the same page receives into a joint stock - same sums; the goods go to the pool (joint.js),
  // the money (supplier bill, payment, shipment costs) stays in this company's books
  const PJ = str(payload.pool) ? await (await import('./joint.js')).poolReceiveTarget(ctx, payload.pool, payload.receivedAt) : null;
  if (PJ && payload.poId) throw new Error('A supplier order is received into your own stock; receive joint stock without the order.');
  if (PJ && lines.some((l) => Array.isArray(l.serials) && l.serials.some((x) => str(x)))) throw new Error('Serial numbers are kept for your own stock only; receive these without them.');

  // ---- 1. resolve every line to a real product
  const existing = {};
  for (const p of PJ ? await PJ.rows() : await pmRows(ctx)) {
    const s = str(p.sku);
    if (s) existing[s.toLowerCase()] = { id: p.id, sku: s, name: String(p.name || ''), cat: str(p.category),
                                         brand: str(p.brand), type: str(p.type), cost: num(p.cost_price),
                                         weightG: num(p.weight_g), lengthMm: num(p.length_mm), widthMm: num(p.width_mm), heightMm: num(p.height_mm) };
  }
  for (const l of lines) {
    if (!l.isNew) {
      if (!existing[str(l.sku).toLowerCase()]) throw new Error('Product not found: ' + l.sku);
      continue;
    }
    const np = l.product || {};
    if (!str(np.product_name)) throw new Error('A new product needs a name.');
    const wanted = str(np.sku).toLowerCase();
    if (wanted && existing[wanted]) throw new Error('SKU already exists: ' + np.sku);
  }

  const created = [];
  for (const l of lines) {
    if (!l.isNew) continue;
    const d = { ...(l.product || {}) };
    d.status = d.status || 'Active';
    d.lead_time_days = num(d.lead_time_days) > 0 ? num(d.lead_time_days) : 60;
    // fix: the line's qty is what arrives - the draft's "opening stock" must
    // not be booked a second time as an OPENING movement
    d.opening_stock = 0;
    const res = PJ ? await PJ.create(d) : await addProduct(ctx, d);
    if (!res || !res.success) {
      throw new Error('Could not create "' + (d.product_name || '?') + '": ' +
                      ((res && res.error) || 'unknown error') +
                      (created.length ? ' (already created: ' + created.join(', ') + ')' : ''));
    }
    l.sku = res.sku;
    created.push(res.sku);
    if (!PJ) await saveSize(ctx, res.id, d);
    existing[String(res.sku).toLowerCase()] = {
      id: res.id, sku: res.sku, name: d.product_name, cat: str(d.category), brand: str(d.brand),
      type: str(d.type), cost: num(d.cost_price), fresh: true,
    };
  }

  // ---- 2. what each unit cost
  // 108: the chargeable weight of one unit (grams): the larger of its real weight and its box-size weight
  const sizes = lines.map((l) => {
    const info = existing[str(l.sku).toLowerCase()] || {}, np = l.product || {};
    const pick = (a, b, c) => num(a) > 0 ? num(a) : num(b) > 0 ? num(b) : num(c);
    const g = pick(l.weightG, info.weightG, np.weight_g);
    const L = pick(l.lengthMm, info.lengthMm, np.length_mm), W = pick(l.widthMm, info.widthMm, np.width_mm), H = pick(l.heightMm, info.heightMm, np.height_mm);
    const vol = L > 0 && W > 0 && H > 0 ? Math.round(L * W * H / divisor) : 0;
    return { weightG: g, volG: vol, chargeG: Math.max(g, vol), name: info.name || np.product_name || str(l.sku) };
  });
  const needWeight = (why) => {
    const miss = sizes.filter((z) => !(z.chargeG > 0)).map((z) => z.name);
    if (miss.length) throw new Error('Give the weight (or box size) of ' + miss.slice(0, 3).join(', ') + (miss.length > 3 ? ' and ' + (miss.length - 3) + ' more' : '') + ' to ' + why + '.');
  };
  const chargeKg = round2(sizes.reduce((t, z, i) => t + z.chargeG * num(lines[i].qty), 0) / 1000);
  // freight by the kilo: chargeable kg x this shipment's rate (when the amount itself is not typed)
  let freightNote = '';
  if (!(freight > 0) && perKg > 0) {
    needWeight('charge freight per kg');
    freight = round2(chargeKg * perKg);
    freightNote = chargeKg + ' kg \u00d7 ' + perKg + ' TK/kg';
  }
  const shipping = round2(freight + extras.reduce((t, c) => t + c.amount, 0));
  const book = PJ ? {} : await bookCostMap(ctx);       // a joint stock has no price book: its own cost
  const onHand = PJ ? await PJ.onHand() : await onHandMap(ctx);
  const weights = [];
  let sumW = 0, sumQty = 0;
  for (const l of lines) {
    const info = existing[str(l.sku).toLowerCase()] || {};
    const basis = num(l.unitBdt) || bookCost(book, info.cat, info.brand, info.type) || info.cost ||
                  num((l.product || {}).cost_price) || 0;
    const q = num(l.qty);
    weights.push(basis * q);
    sumW += basis * q;
    sumQty += q;
  }
  // every cost line shared out by its own basis (108); value falls back to units where nothing has a value
  const costLines = (freight > 0 ? [{ label: 'Freight', amount: freight, basis: freightBasis }] : []).concat(extras);
  if (costLines.some((c) => c.basis === 'weight')) needWeight('share costs by weight');
  const measure = (basis, x) => basis === 'weight' ? sizes[x].chargeG * num(lines[x].qty) : basis === 'units' ? num(lines[x].qty) : (sumW > 0 ? weights[x] : num(lines[x].qty));
  const shares = lines.map(() => 0);
  for (const c of costLines) {
    let of = 0;
    for (let x = 0; x < lines.length; x++) of += measure(c.basis, x);
    for (let x = 0; x < lines.length; x++) shares[x] += of > 0 ? c.amount * measure(c.basis, x) / of : 0;
  }
  const costs = [];
  for (let x = 0; x < lines.length; x++) {
    const q = num(lines[x].qty);
    let unit;
    const shipShare = shipping > 0 ? shares[x] / q : 0;
    if (totalBdt > 0) {
      const share = sumW > 0 ? (totalBdt * weights[x] / sumW) : (totalBdt * q / sumQty);
      unit = share / q;
    } else {
      const inf = existing[str(lines[x].sku).toLowerCase()] || {};
      unit = num(lines[x].unitBdt) || bookCost(book, inf.cat, inf.brand, inf.type) || inf.cost || 0;
    }
    costs.push(round2(unit + (unit > 0 || shipShare > 0 ? shipShare : 0)));
  }

  // ---- 3. the movements
  let stampNote = str(payload.notes);
  if (mode === 'rmb') stampNote = (stampNote ? stampNote + ' | ' : '') + fxCur + ' ' + totalRmb + ' @ ' + rate + ' TK/' + fxCur;
  if (extras.length) stampNote = (stampNote ? stampNote + ' | ' : '') + extras.map((c) => c.label + ' TK ' + c.amount).join(', ');
  else if (mode === 'bdt') stampNote = (stampNote ? stampNote + ' | ' : '') + 'local, TK ' + totalBdt;
  if (shipping > 0) {
    stampNote = (stampNote ? stampNote + ' | ' : '') + 'shipping TK ' + shipping +
                (payload.shipNote || freightNote ? ' (' + [String(payload.shipNote || ''), freightNote].filter(Boolean).join(', ') + ')' : '');
  }
  if (payload.poId) stampNote = (stampNote ? stampNote + ' | ' : '') + 'order ' + String(payload.poId);

  const now = new Date();
  let jointDone = null;
  if (PJ) {
    jointDone = await PJ.receive(lines.map((l, r) => ({ id: existing[str(l.sku).toLowerCase()].id, sku: str(l.sku), qty: num(l.qty), unit: costs[r] })),
                                 { reference, supplier: payload.supplier, note: stampNote, at: now });
  }
  for (let r = 0; r < lines.length && !PJ; r++) {
    const info = existing[str(lines[r].sku).toLowerCase()];
    const q = num(lines[r].qty);
    await addMovement(ctx, { productId: info.id, kind: 'RECEIVE', direction: 'IN', qty: q, unit: costs[r],
      total: round2(costs[r] * q), reference, supplier: String(payload.supplier || ''),
      note: stampNote, at: now, name: info.name || lines[r].sku });
  }
  forget(ctx, 'TXN_LOG');

  // plan D1: the serial numbers that came with the shipment
  let numbered = 0;
  for (const l of lines) {
    const list = Array.isArray(l.serials) ? l.serials.filter((x) => str(x)) : [];
    if (!list.length) continue;
    if (list.length > num(l.qty)) throw new Error(str(l.sku) + ': ' + list.length + ' serial numbers for ' + num(l.qty) + ' unit(s).');
    numbered += await registerSerials(ctx, l.sku, list, reference);
  }

  // ---- 4. the weighted average (a joint stock's was set as it was received)
  const updated = jointDone ? jointDone.slice() : [];
  for (let y = 0; y < lines.length && !PJ; y++) {
    if (!(costs[y] > 0)) continue;
    const sku2 = str(lines[y].sku);
    const info = existing[sku2.toLowerCase()];
    if (!info) continue;
    let had = onHand[sku2.toLowerCase()] || 0;
    if (had < 0) had = 0;
    const q = num(lines[y].qty);
    const old = info.cost || 0;
    const avg = round2((old > 0 && had > 0) ? ((had * old) + (q * costs[y])) / (had + q) : costs[y]);
    await ctx.tx`update products set cost_price = ${avg}, updated_at = now() where id = ${info.id}`;
    updated.push({ sku: sku2, product: info.name, qty: q, unitCost: costs[y], wasCost: old, nowCost: avg, hadStock: had });
  }
  delete ctx.memo.catalog;

  // ---- 5. the usual rate
  let rateSaved = false;
  if (mode === 'rmb' && rate > 0 && payload.saveRate) {
    await saveRate(ctx, fxCur, rate);
    rateSaved = true;
  }

  // plan A5: what was paid besides the goods, each line with the account that paid it
  const accOk = {};
  if ((freight > 0 && str(payload.shippingAccount)) || extras.some((c) => c.account) || str(payload.paidFrom) || str(payload.advanceFrom)) {
    try { (await ctx.tx.savepoint(() => ctx.tx`select id from money_accounts where business_id = ${ctx.biz} and not archived`)).forEach((a) => { accOk[a.id] = true; }); }
    catch (_) { /* someone who cannot see the accounts cannot name one */ }
  }
  const fNote = [String(payload.shipNote || ''), freightNote].filter(Boolean).join(', ');
  const costRows = (freight > 0 ? [{ label: 'Freight' + (fNote ? ' (' + fNote + ')' : ''), amount: freight, account: str(payload.shippingAccount) }] : []).concat(extras);
  for (const c of costRows) {
    await ctx.tx`insert into shipment_costs (business_id, reference, at, label, amount, account_id, by)
                 values (${ctx.biz}, ${reference}, ${now}, ${c.label}, ${c.amount}, ${accOk[c.account] ? c.account : null}, ${who(ctx)})`;
  }

  const poId = str(payload.poId);
  if (poId) {
    try { await ctx.tx.savepoint(() => poReceived(ctx, poId, lines)); } catch (_) { /* best effort, as original */ }
  }

  // plan A4: the goods of this shipment are owed to the supplier named on it (freight is not theirs)
  let billId = null;
  // a shipment costed by its total, or (an order ticked off on arrival) line by line at the order's prices
  const goods = totalBdt > 0 ? totalBdt : round2(lines.reduce((t, l) => t + num(l.unitBdt) * num(l.qty), 0));
  if (str(payload.supplier) && goods > 0) {
    billId = await billForShipment(ctx, { supplier: payload.supplier, reference, amount: goods,
      fxAmount: mode === 'rmb' ? totalRmb : 0, fxCurrency: mode === 'rmb' ? fxCur : '', fxRate: mode === 'rmb' ? rate : 0,
      note: lines.length + ' product(s), ' + lines.reduce((n, l) => n + num(l.qty), 0) + ' unit(s)' });
  }

  // how the goods were paid (owner 17 Oct 2026: "mostly paid in advance; sometimes after receiving"):
  //   now      paid there and then from an account (a local purchase for cash)
  //   advance  paid to the supplier before the goods came: the money already left the business and sat as
  //            "paid to suppliers, goods not received" (the supplier's advance); this bill uses it up. An advance
  //            nobody wrote down yet is written now, dated the day it was paid, from the account it left.
  //   later    owed to the supplier until it is paid
  let paidNow = 0, advanceUsed = 0, advanceWritten = 0;
  const payment = ['now', 'advance', 'later'].includes(str(payload.payment)) ? str(payload.payment) : (accOk[str(payload.paidFrom)] ? 'now' : 'later');
  if (payment === 'advance' && !billId && goods > 0) throw new Error('Paid in advance to whom? Choose the supplier of this shipment.');
  if (billId && payment === 'now' && accOk[str(payload.paidFrom)]) {
    await ctx.tx`insert into supplier_payments (business_id, supplier, at, amount, account_id, fx_amount, fx_currency, note, by)
                 values (${ctx.biz}, ${str(payload.supplier)}, ${now}, ${round2(goods)}, ${str(payload.paidFrom)}, ${mode === 'rmb' ? totalRmb : null},
                         ${mode === 'rmb' ? fxCur : null}, ${'paid on receiving ' + reference}, ${who(ctx)})`;
    paidNow = round2(goods);
  } else if (billId && payment === 'advance') {
    const sk = str(payload.supplier).toLowerCase();
    const op = num(((await ctx.tx`select opening_owed from suppliers where business_id = ${ctx.biz} and lower(btrim(name)) = ${sk}`)[0] || {}).opening_owed);
    const billed = num((await ctx.tx`select coalesce(sum(amount), 0) s from supplier_bills where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${sk}
                                      and coalesce(voided, '') = '' and id <> ${billId}`)[0].s);
    const paid = num((await ctx.tx`select coalesce(sum(amount), 0) s from supplier_payments where business_id = ${ctx.biz} and lower(btrim(supplier)) = ${sk}
                                    and coalesce(voided, '') = ''`)[0].s);
    const ahead = round2(paid - billed - op);               // what was paid ahead before this shipment
    const short = round2(goods - Math.max(0, ahead));
    if (short > 0.5) {
      const from = str(payload.advanceFrom), on = str(payload.advanceDate);
      if (!accOk[from]) {
        throw new Error('Only ' + Math.round(Math.max(0, ahead)) + ' TK was paid ahead to ' + str(payload.supplier) + ', the goods are ' + Math.round(goods) +
          ' TK. Say which account the advance was paid from and on which day, or choose "Not paid yet".');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on > formatDate(ctx.now, 'yyyy-MM-dd')) throw new Error('On which day was the advance paid? (a date like 2026-10-05, not in the future)');
      const at = new Date(dhakaDayStart(on).getTime() + 12 * 3600e3);
      await assertOpen(ctx, at, 'an advance cannot be dated there');
      await ctx.tx`insert into supplier_payments (business_id, supplier, at, amount, account_id, fx_amount, fx_currency, note, by)
                   values (${ctx.biz}, ${str(payload.supplier)}, ${at}, ${short}, ${from}, ${null}, ${null}, ${'advance for ' + reference}, ${who(ctx)})`;
      advanceWritten = short;
    }
    advanceUsed = round2(goods);
  }

  return {
    ok: true, numbered, reference, billed: !!billId, joint: PJ ? PJ.pool.name : '', paidNow, advanceUsed, advanceWritten, payment, costs: costRows.length, currency: mode === 'rmb' ? fxCur : '', received: updated.length || lines.length,
    units: lines.reduce((n, l) => n + num(l.qty), 0),
    shipping, createdProducts: created, lines: updated, totalCost: round2(totalBdt),
    freight, chargeKg, freightPerKg: perKg, divisor,
    calc: lines.map((l, x) => ({ sku: str(l.sku), qty: num(l.qty), chargeG: sizes[x].chargeG, weightG: sizes[x].weightG, volG: sizes[x].volG,
                                 costsPerUnit: round2(shares[x] / num(l.qty)), unitCost: costs[x] })),
    bases: costLines.map((c) => ({ label: c.label, amount: c.amount, basis: c.basis })),
    rate: mode === 'rmb' ? rate : 0, rateSaved,
    costed: totalBdt > 0 ? 'shipment total' : 'price book',
  };
}

export async function erpReceiveShipment(ctx, payload) { return receiveShipment(ctx, payload); }

/** erpReceiveStock (ERP:1299): legacy per-line receive at zero cost (not used by the page). */
export async function erpReceiveStock(ctx, payload) {
  const lines = ((payload && payload.lines) || []).filter((l) => l && str(l.sku) && num(l.qty) > 0);
  if (!lines.length) throw new Error('Add at least one product with a quantity.');
  await lock(ctx, 'stock');
  const ok = [], bad = [];
  for (const l of lines) {
    const sku = String(l.sku).trim();
    const p = await productBySku(ctx, sku);
    if (!p) { bad.push({ sku: l.sku, error: 'Product not found: ' + sku }); continue; }
    await addMovement(ctx, { productId: p.id, kind: 'RECEIVE', direction: 'IN', qty: num(l.qty), unit: 0, total: 0,
      reference: String((payload && payload.reference) || 'ERP receive'),
      supplier: String((payload && payload.supplier) || ''), note: String((payload && payload.notes) || ''),
      name: p.name });
    ok.push({ sku, product: p.name, qty: num(l.qty) });
  }
  forget(ctx, 'TXN_LOG');
  if (!ok.length) throw new Error(bad.map((b) => b.sku + ': ' + b.error).join('; '));
  return { ok: true, received: ok, failed: bad };
}

/** erpAdjustStock (ERP:1333) */
export async function adjustStock(ctx, payload) {
  const sku = str(payload && payload.sku);
  const qty = num(payload && payload.qty);
  const dir = String((payload && payload.direction) || 'IN').toUpperCase();
  const reason = str(payload && payload.reason);
  if (!sku) throw new Error('Choose a product.');
  if (qty <= 0) throw new Error('Quantity must be at least 1.');
  if (!reason) throw new Error('A reason is required for a stock adjustment.');
  const notes = String((payload && payload.notes) || '');

  await lock(ctx, 'stock');
  if (dir === 'IN') {
    const p = await productBySku(ctx, sku);
    if (!p) throw new Error('Product not found: ' + sku);
    const no = await addMovement(ctx, { productId: p.id, kind: 'RETURN', direction: 'IN', qty, unit: 0, total: 0,
      reference: reason, supplier: '', note: notes, name: p.name });
    forget(ctx, 'TXN_LOG');
    return { ok: true, txnId: no, product: p.name, direction: 'IN', qty };
  }

  // OUT: never below what is on the shelf. A sale in the same moment takes
  // the 'sale' lock, so take it too (the original had one lock for both).
  await lock(ctx, 'sale');
  const r = await ctx.tx`
    select p.id, p.sku, p.name, coalesce(ps.stock, 0) as stock
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${ctx.biz} and lower(btrim(p.sku)) = ${sku.toLowerCase()} limit 1`;
  const info = r[0];
  if (!info) throw new Error('Product not found: ' + sku);
  const current = Number(info.stock) || 0;
  if (qty > current) throw new Error('Only ' + current + ' in stock for ' + info.name + '.');
  const no = await addMovement(ctx, { productId: info.id, kind: 'ADJUST', direction: 'OUT', qty, unit: 0, total: 0,
    reference: reason, supplier: '', note: notes, name: info.name });
  forget(ctx, 'TXN_LOG');
  return { ok: true, txnId: no, product: info.name, direction: 'OUT', qty };
}

export async function erpAdjustStock(ctx, payload) { return adjustStock(ctx, payload); }

/** erpStockHistory (ERP:1377): the last N ledger rows, newest first. */
export async function erpStockHistory(ctx, limit) {
  const n = Math.max(1, Math.floor(num(limit) || 60));
  const rows = await ctx.tx`
    select m.txn_no, m.created_at, p.sku, coalesce(m.product_name, p.name) as product,
           m.kind, m.direction, m.qty, m.reference, m.supplier, m.operator
    from stock_movements m join products p on p.id = m.product_id
    where m.business_id = ${ctx.biz}
    order by m.seq desc
    limit ${n}`;
  return rows.map((r) => ({
    id: String(r.txn_no || ''),
    date: r.created_at ? formatDate(r.created_at, 'd MMM yyyy, h:mm a') : '',
    sku: String(r.sku || ''),
    product: String(r.product || ''),
    type: String(r.kind || ''),
    dir: String(r.direction || ''),
    qty: num(r.qty),
    ref: String(r.reference || ''),
    supplier: String(r.supplier || ''),
    by: String(r.operator || ''),
  }));
}

// ----------------------------------------------------------- reorder levels

/** erpApplyReorderLevels (ERP:2761): set every reorder level to the catalogue's "should be". */
export async function applyReorderLevels(ctx, apply) {
  const pm = await pmRows(ctx);
  if (!pm.length) return { ok: true, changed: 0, applied: false };
  if (apply) await lock(ctx, 'stock');
  const bySku = {};
  for (const p of await erpCatalog(ctx)) bySku[p.sku.toLowerCase()] = p;
  let changed = 0, raised = 0, lowered = 0;
  const preview = [], writes = [];
  for (const r of pm) {
    const sku = str(r.sku);
    if (!sku) continue;
    const p = bySku[sku.toLowerCase()];
    if (!p) continue;
    const now = num(r.reorder_level);
    const want = num(p.suggested);
    if (want === now) continue;
    changed++;
    if (want > now) raised++; else lowered++;
    if (preview.length < 20) preview.push({ sku, name: p.name, from: now, to: want, rate: p.rate, stock: p.stock });
    writes.push([r.id, want]);
  }
  if (apply && changed) {
    for (const [id, want] of writes) {
      await ctx.tx`update products set reorder_level = ${want}, updated_at = now() where id = ${id}`;
    }
    delete ctx.memo.catalog;
  }
  return { ok: true, applied: !!apply, changed, raised, lowered, preview };
}

export async function erpApplyReorderLevels(ctx, apply) { return applyReorderLevels(ctx, apply); }

// ------------------------------------------------------------- To-order plan

/** erpReorderPlan (ERP:6380) */
export async function erpReorderPlan(ctx, payload) {
  payload = payload || {};
  const cycle = num(payload.cycleDays) > 0 ? Math.round(num(payload.cycleDays)) : 30;
  const defaultLead = num(payload.leadDays) > 0 ? Math.round(num(payload.leadDays)) : 60;

  const cat = await erpCatalog(ctx);
  let book = {};
  try { book = await ctx.tx.savepoint(() => bookCostMap(ctx)); } catch (_) { /* as original */ }
  const typeOf = {};
  for (const p of await pmRows(ctx)) {
    const sk = str(p.sku).toLowerCase();
    if (sk) typeOf[sk] = str(p.type);
  }
  let onOrder = {};
  try { onOrder = (await ctx.tx.savepoint(() => poOpen(ctx))).bySku; } catch (_) { /* as original */ }

  const rows = [];
  let totalCost = 0, urgent = 0;
  for (const p of cat) {
    if (String(p.status || 'Active').toLowerCase() === 'discontinued') continue;
    const rate = num(p.rate);
    if (!(rate > 0)) continue;
    const lead = num(p.lead) > 0 ? num(p.lead) : defaultLead;
    const buffer = lead * 0.5;
    const target = rate * (lead + cycle + buffer);
    const coming = onOrder[String(p.sku).toLowerCase()] || 0;
    const need = Math.ceil(target - num(p.stock) - coming);
    if (need <= 0) continue;
    const unit = bookCost(book, p.cat, p.brand, typeOf[String(p.sku).toLowerCase()] || '');
    const cover = rate > 0 ? Math.round(num(p.stock) / rate) : null;
    const dry = cover !== null && cover < lead;
    if (dry) urgent++;
    totalCost += unit * need;
    rows.push({
      sku: p.sku, name: p.name, brand: p.brand, cat: p.cat,
      stock: Math.round(num(p.stock)),
      rate: Math.round(rate * 100) / 100,
      perMonth: Math.round(rate * 30),
      cover, lead, need, coming,
      unitCost: Math.round(unit),
      cost: Math.round(unit * need),
      why: dry ? 'runs out in ' + cover + ' days, ' + lead + ' days before a shipment could land'
               : 'covers the ' + lead + '-day wait plus ' + cycle + ' days of selling',
      urgent: dry,
      sold90: Math.round(num(p.sold90)),
      lastSoldDays: p.lastSoldDays,
    });
  }
  rows.sort((a, b) => {
    if (b.need !== a.need) return b.need - a.need;
    const ac = a.cover === null ? 99999 : a.cover, bc = b.cover === null ? 99999 : b.cover;
    return ac - bc;
  });
  return {
    cycleDays: cycle, leadDays: defaultLead,
    rows: rows.slice(0, 120), count: rows.length, urgent,
    totalCost: Math.round(totalCost),
    generatedAt: formatDate(new Date(), 'd MMM yy, h:mm a'),
  };
}

// ----------------------------------------------------------- purchase orders

/** erpPoOpen_ (ERP:7893): every order with something still to come, and the total due per SKU. */
export async function poOpen(ctx) {
  const v = await ctx.tx`
    select id, po_no, ordered_at, sku, product, qty, received, ship_by, note, status,
           ordered_by, rmb_unit, rmb_rate, supplier
    from po_lines where business_id = ${ctx.biz}
    order by seq`;
  const orders = {}, order = [], bySku = {};
  const nowMs = Date.now();
  for (const r of v) {
    const id = str(r.po_no);
    if (!id || str(r.status) !== 'open') continue;
    const qty = num(r.qty), got = num(r.received);
    const left = Math.max(0, qty - got);
    let o = orders[id];
    if (!o) {
      const at = r.ordered_at instanceof Date ? r.ordered_at : null;
      o = orders[id] = { id, shipBy: String(r.ship_by || ''), note: String(r.note || ''),
                         by: String(r.ordered_by || ''), lines: [], left: 0, rate: num(r.rmb_rate), rmb: 0,
                         supplier: str(r.supplier),
                         when: at ? formatDate(at, 'd MMM yyyy') : '',
                         days: at ? Math.floor((nowMs - at.getTime()) / DAY_MS) : null };
      order.push(o);
    }
    const sku = str(r.sku);
    o.lines.push({ sku, product: String(r.product || ''), qty, received: got, left, row: r.id,
                   rmbUnit: num(r.rmb_unit) });
    o.left += left;
    o.rmb += qty * num(r.rmb_unit);
    if (left > 0) bySku[sku.toLowerCase()] = (bySku[sku.toLowerCase()] || 0) + left;
  }
  return { orders: order.filter((x) => x.left > 0), bySku };
}

/** erpPoReceived_ (ERP:8262): count what arrived against the order; close it when complete. */
async function poReceived(ctx, poId, lines) {
  if (!poId) return;
  const v = await ctx.tx`select id, sku, qty, received, status from po_lines
                         where business_id = ${ctx.biz} and btrim(po_no) = ${poId} order by seq`;
  const arrived = {};
  for (const l of lines) {
    const k = str(l.sku).toLowerCase();
    arrived[k] = (arrived[k] || 0) + num(l.qty);
  }
  let open = 0;
  const mine = [];
  for (const r of v) {
    if (str(r.status) !== 'open') continue;
    const k2 = str(r.sku).toLowerCase();
    let got = num(r.received);
    const qty = num(r.qty);
    const add = Math.min(arrived[k2] || 0, Math.max(0, qty - got));
    if (add > 0) {
      got += add; arrived[k2] -= add;
      await ctx.tx`update po_lines set received = ${got} where id = ${r.id}`;
    }
    mine.push(r.id);
    if (got < qty) open++;
  }
  if (mine.length && !open) {
    await ctx.tx`update po_lines set status = 'arrived', closed_at = now() where id = any(${mine})`;
  }
}

/** erpPoMatters_ (ERP:8193): open differences, and the balance with each supplier. */
async function poMatters(ctx) {
  const rows = await ctx.tx`select * from po_diffs where business_id = ${ctx.biz} order by seq`;
  const open = [], bal = {}, keys = [];
  for (const r of rows) {
    const st = String(r.status || '');
    if (st === 'open') {
      open.push({ id: String(r.diff_no), poId: String(r.po_no || ''), supplier: String(r.supplier || ''),
                  sku: String(r.sku || ''), product: String(r.product || ''), kind: String(r.kind || ''),
                  qty: num(r.qty), rmbUnit: num(r.rmb_unit), rmb: num(r.rmb_value) });
    } else if ((st === 'supplier_owes' || st === 'i_owe') && !r.settled_at) {
      const key = str(r.supplier) || '(no supplier named)';
      let b = bal[key];
      if (!b) { b = bal[key] = { supplier: key, owesYou: 0, youOwe: 0, items: [] }; keys.push(key); }
      if (st === 'supplier_owes') b.owesYou += num(r.rmb_value); else b.youOwe += num(r.rmb_value);
      b.items.push({ poId: String(r.po_no || ''), product: String(r.product || ''), qty: num(r.qty),
                     rmb: num(r.rmb_value), what: st === 'supplier_owes' ? 'did not come' : 'extra kept' });
    }
  }
  const list = keys.map((k) => {
    const b = bal[k];
    b.owesYou = round2(b.owesYou); b.youOwe = round2(b.youOwe);
    b.net = round2(b.owesYou - b.youOwe);
    return b;
  });
  return { open, balances: list };
}

/** erpPoList (ERP:8217) */
export async function erpPoList(ctx) {
  const m = await poMatters(ctx);
  const boxes = {};
  const ships = await ctx.tx`select * from po_shipments where business_id = ${ctx.biz} order by seq`;
  for (const r of ships) {
    (boxes[String(r.po_no)] = boxes[String(r.po_no)] || []).push({
      no: String(r.shipment_no || ''), agent: String(r.agent || ''), by: String(r.ship_by || ''),
      kg: num(r.weight_kg), shipping: num(r.shipping_bdt),
      on: r.arrived_on instanceof Date ? formatDate(r.arrived_on, 'yyyy-MM-dd') : String(r.arrived_on || '').slice(0, 10),
      units: num(r.units) });
  }
  const orders = (await poOpen(ctx)).orders;
  const stages = {};
  for (const r of await ctx.tx`select * from po_stages where business_id = ${ctx.biz}`) stages[str(r.po_no)] = r;
  const paid = roleAtLeast(actRole(ctx.s), 'shareholder') ? await poPaidMap(ctx) : {};
  orders.forEach((o) => { o.boxes = boxes[o.id] || []; o.stage = stageOut(stages[o.id], o); o.paid = paid[o.id] || 0; });
  const accounts = roleAtLeast(actRole(ctx.s), 'shareholder')
    ? (await ctx.tx`select id, name from money_accounts where business_id = ${ctx.biz} and not archived and kind <> 'courier' order by sort_order, created_at`).map((a) => ({ id: a.id, name: str(a.name) })) : [];
  return { orders, differences: m.open, balances: m.balances, accounts, canPay: accounts.length > 0 || roleAtLeast(actRole(ctx.s), 'shareholder') };
}

// ------------------------------------------------------------------ stages (108)
const STAGES = { planned: 'Planned', ordered: 'Ordered', in_transit: 'In transit', received: 'Received' };
function stageOut(r, o) {
  const key = r ? str(r.stage) : 'ordered';
  return { key, label: STAGES[key] || 'Ordered', shipmentNo: str(r && r.shipment_no), agent: str(r && r.agent), shipBy: str(r && r.ship_by) || (o && o.shipBy) || '',
           kg: num(r && r.weight_kg), freightPerKg: num(r && r.freight_per_kg), divisor: num(r && r.divisor) || 6000,
           eta: r && r.eta ? formatDate(new Date(r.eta), 'yyyy-MM-dd') : '', note: str(r && r.note),
           freightEstimate: r && num(r.weight_kg) > 0 && num(r.freight_per_kg) > 0 ? round2(num(r.weight_kg) * num(r.freight_per_kg)) : 0 };
}
async function stageSet(ctx, poId, f) {
  await ctx.tx`
    insert into po_stages (business_id, po_no, stage, shipment_no, agent, ship_by, weight_kg, freight_per_kg, divisor, eta, note, updated_by, updated_at)
    values (${ctx.biz}, ${poId}, ${f.stage}, ${f.shipmentNo || null}, ${f.agent || null}, ${f.shipBy || null}, ${f.kg || null}, ${f.freightPerKg || null},
            ${f.divisor || null}, ${f.eta || null}, ${f.note || null}, ${who(ctx)}, now())
    on conflict (business_id, po_no) do update set stage = excluded.stage,
      shipment_no = coalesce(excluded.shipment_no, po_stages.shipment_no), agent = coalesce(excluded.agent, po_stages.agent),
      ship_by = coalesce(excluded.ship_by, po_stages.ship_by), weight_kg = coalesce(excluded.weight_kg, po_stages.weight_kg),
      freight_per_kg = coalesce(excluded.freight_per_kg, po_stages.freight_per_kg), divisor = coalesce(excluded.divisor, po_stages.divisor),
      eta = coalesce(excluded.eta, po_stages.eta), note = coalesce(excluded.note, po_stages.note), updated_by = excluded.updated_by, updated_at = now()`;
}

/** Move an order along: Planned -> Ordered -> In transit (with what is known of the shipment). Received comes from erpPoArrive. */
export async function erpPoStage(ctx, payload) {
  payload = payload || {};
  if (!powerOn(ctx.s, 'suppliers')) throw new Error('Your account cannot change orders.');
  const id = str(payload.poId);
  const order = (await poOpen(ctx)).orders.find((o) => o.id === id);
  if (!order) throw new Error('No open order called ' + id + '.');
  const stage = str(payload.stage);
  if (!STAGES[stage] || stage === 'received') throw new Error('An order is Planned, Ordered or In transit; it becomes Received when you receive it.');
  const kg = num(payload.kg), perKg = num(payload.freightPerKg), div = num(payload.divisor);
  if (kg < 0 || perKg < 0) throw new Error('Weight and freight rate cannot be negative.');
  if (div && (div < 1000 || div > 10000)) throw new Error('The box-size divisor is usually 6000 (between 1000 and 10000).');
  const eta = str(payload.eta);
  if (eta && !/^\d{4}-\d{2}-\d{2}$/.test(eta)) throw new Error('The expected date looks wrong.');
  const shipBy = str(payload.shipBy);
  if (shipBy && shipBy !== 'Sea' && shipBy !== 'Air') throw new Error('By sea or by air?');
  await stageSet(ctx, id, { stage, shipmentNo: str(payload.shipmentNo), agent: str(payload.agent), shipBy, kg, freightPerKg: perKg, divisor: div, eta, note: str(payload.note) });
  const r = (await ctx.tx`select * from po_stages where business_id = ${ctx.biz} and po_no = ${id}`)[0];
  return { ok: true, poId: id, stage: stageOut(r, order) };
}

/** A PO / difference id not used yet in this business (fix: the original's could collide). */
async function freePoNo(ctx, base) {
  for (let k = 1; k < 1000; k++) {
    const id = k === 1 ? base : base + '-' + k;
    const used = await ctx.tx`select 1 from po_lines where business_id = ${ctx.biz} and po_no = ${id} limit 1`;
    if (!used.length) return id;
  }
  throw new Error('Could not find a free order number.');
}
async function freeDiffNo(ctx, base, taken) {
  for (let k = 1; k < 1000; k++) {
    const id = k === 1 ? base : base + '-' + k;
    if (taken[id]) continue;
    const used = await ctx.tx`select 1 from po_diffs where business_id = ${ctx.biz} and diff_no = ${id} limit 1`;
    if (!used.length) { taken[id] = true; return id; }
  }
  throw new Error('Could not find a free difference number.');
}

async function insertDiff(ctx, d) {
  await ctx.tx`
    insert into po_diffs (business_id, diff_no, po_no, supplier, sku, product, kind, qty, rmb_unit,
                          rmb_value, unit_bdt, status, created_at, decided_at, decided_by, settled_at, note)
    values (${ctx.biz}, ${d.id}, ${d.poId}, ${d.supplier || ''}, ${d.sku}, ${d.product || ''}, ${d.kind},
            ${d.qty}, ${d.rmbUnit}, ${d.rmb}, ${d.unitBdt || 0}, ${d.status}, ${d.at},
            ${d.decidedAt || null}, ${d.decidedBy || null}, null, ${d.note || ''})`;
}

/** erpPoCreate (ERP:7930) */

// ---- money paid for an order before its goods come: the supplier's advance, marked with the order (and the PI)
async function poPayWrite(ctx, { po, supplier, amount, accountId, at, pi, fx }) {
  await ctx.tx`insert into supplier_payments (business_id, supplier, at, amount, account_id, fx_amount, fx_currency, note, by)
               values (${ctx.biz}, ${supplier}, ${at}, ${amount}, ${accountId || null}, ${fx > 0 ? fx : null}, ${fx > 0 ? 'RMB' : null},
                       ${'advance for ' + po + (pi ? ' (PI ' + pi + ')' : '')}, ${who(ctx)})`;
}
/** What has been paid for each open order (from the payments marked "advance for PO-..."). */
export async function poPaidMap(ctx) {
  const out = {};
  for (const r of await ctx.tx`select substring(note from 'advance for (PO-[0-9A-Za-z-]+)') po, coalesce(sum(amount), 0) a from supplier_payments
                               where business_id = ${ctx.biz} and coalesce(voided, '') = '' and note like 'advance for PO-%' group by 1`) if (r.po) out[r.po] = Math.round(num(r.a));
  return out;
}
/** Pay for an order later (still before its goods come): {po, amount, account, date, pi}. */
export async function erpPoPay(ctx, payload) {
  payload = payload || {};
  const po = str(payload.po);
  const row = (await ctx.tx`select supplier from po_lines where business_id = ${ctx.biz} and po_no = ${po} limit 1`)[0];
  if (!row) throw new Error('That order is not here.');
  if (!str(row.supplier)) throw new Error('This order has no supplier - edit it first.');
  const amount = round2(num(payload.amount));
  if (!(amount > 0)) throw new Error('How much was paid? Type an amount above 0.');
  const accs = await ctx.tx`select id, archived from money_accounts where business_id = ${ctx.biz} and kind <> 'courier'`;
  const acc = accs.find((x) => x.id === str(payload.account));
  if (accs.length && (!acc || acc.archived)) throw new Error('Choose the account the money was paid from.');
  const day = str(payload.date) || formatDate(ctx.now, 'yyyy-MM-dd');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > formatDate(ctx.now, 'yyyy-MM-dd')) throw new Error('On which day was it paid? (not in the future)');
  const at = new Date(dhakaDayStart(day).getTime() + 12 * 3600e3);
  await assertOpen(ctx, at, 'a payment cannot be dated there');
  await poPayWrite(ctx, { po, supplier: str(row.supplier), amount, accountId: acc ? acc.id : null, at, pi: str(payload.pi).slice(0, 60), fx: num(payload.fx) });
  return { ok: true, po, paid: (await poPaidMap(ctx))[po] || 0 };
}

export async function erpPoCreate(ctx, payload) {
  payload = payload || {};
  if (!powerOn(ctx.s, 'suppliers')) throw new Error('Your account cannot place orders.');
  const shipBy = String(payload.shipBy || 'Sea');
  if (shipBy !== 'Sea' && shipBy !== 'Air') throw new Error('By sea or by air?');
  const rate = num(payload.rate);
  if (rate < 0 || rate > 1000) throw new Error('That rate looks wrong (' + rate + ' TK per RMB).');

  const cat = {};
  (await erpCatalog(ctx)).forEach((p) => { cat[String(p.sku).toLowerCase()] = p; });
  const lines = [], seen = {};
  let priced = false;
  for (const l of (payload.lines || [])) {
    const q = Math.round(num(l && l.qty));
    if (!(q > 0)) continue;
    const rmb = Math.round(num(l.rmbUnit) * 10000) / 10000;
    if (rmb < 0) throw new Error('A price cannot be negative.');
    if (rmb > 0) priced = true;
    if (l.isNew) {
      const d = l.product || {};
      const nm = str(d.product_name);
      if (!nm) throw new Error('A new product needs a name.');
      const want = str(d.sku).toLowerCase();
      if (want && (cat[want] || seen[want])) throw new Error('SKU already exists: ' + d.sku);
      if (want) seen[want] = true;
      lines.push({ isNew: true, product: d, name: nm, qty: q, rmb });
      continue;
    }
    const p = cat[str(l.sku).toLowerCase()];
    if (!p) throw new Error('Product not found: ' + l.sku);
    if (seen[p.sku.toLowerCase()]) throw new Error(p.name + ' is on the order twice.');
    seen[p.sku.toLowerCase()] = true;
    lines.push({ sku: p.sku, name: p.name, qty: q, rmb });
  }
  if (!lines.length) throw new Error('Choose at least one product with a quantity.');
  if (priced && !(rate > 0)) throw new Error('Enter the rate you paid (TK per RMB), so the prices can be turned into cost.');

  await lock(ctx, 'stock');
  const created = [];
  for (const l of lines) {
    if (!l.isNew) continue;
    const d = { ...l.product };
    d.opening_stock = 0;
    d.status = d.status || 'Active';
    d.lead_time_days = num(d.lead_time_days) > 0 ? num(d.lead_time_days) : 60;
    const res = await addProduct(ctx, d);
    if (!res || !res.success) {
      throw new Error('Could not create "' + l.name + '": ' + ((res && res.error) || 'unknown error') +
                      (created.length ? ' (already created: ' + created.join(', ') + ')' : ''));
    }
    l.sku = res.sku;
    created.push(res.sku);
  }
  // owner 17 Oct 2026: a shipment is created on the day it is PAID (with the supplier's PI) - the goods come later
  const paid = payload.paid || {};
  const paidAmt = round2(num(paid.amount)), pi = str(paid.pi || payload.pi).slice(0, 60);
  let paidAt = null;
  if (paidAmt > 0) {
    if (!str(payload.supplier)) throw new Error('Paid to whom? Choose the supplier of this order.');
    if (!roleAtLeast(actRole(ctx.s), 'shareholder')) throw new Error('Only the owner or a shareholder records money paid to a supplier.');
    const accs = await ctx.tx`select id, archived from money_accounts where business_id = ${ctx.biz} and kind <> 'courier'`;
    const acc = accs.find((x) => x.id === str(paid.account));
    if (accs.length && (!acc || acc.archived)) throw new Error('Choose the account the money was paid from.');
    const day = str(paid.date) || formatDate(ctx.now, 'yyyy-MM-dd');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > formatDate(ctx.now, 'yyyy-MM-dd')) throw new Error('On which day was it paid? (not in the future)');
    paidAt = new Date(dhakaDayStart(day).getTime() + 12 * 3600e3);
    await assertOpen(ctx, paidAt, 'a payment cannot be dated there');
    paid.accountId = acc ? acc.id : null;
  }
  const now = new Date();
  const orderedAt = paidAt || now;
  const id = await freePoNo(ctx, 'PO-' + formatDate(now, 'yyMMdd-HHmm'));
  const by = who(ctx), note = [str(payload.note), pi ? 'PI ' + pi : ''].filter(Boolean).join(' · '), supplier = str(payload.supplier);
  for (const l of lines) {
    await ctx.tx`
      insert into po_lines (business_id, po_no, ordered_at, sku, product, qty, received, ship_by, note,
                            status, ordered_by, closed_at, rmb_unit, rmb_rate, supplier)
      values (${ctx.biz}, ${id}, ${orderedAt}, ${l.sku}, ${l.name}, ${l.qty}, 0, ${shipBy}, ${note},
              'open', ${by}, null, ${l.rmb || null}, ${rate || null}, ${supplier})`;
  }
  await stageSet(ctx, id, { stage: payload.planned ? 'planned' : 'ordered', shipBy });
  if (paidAmt > 0) await poPayWrite(ctx, { po: id, supplier, amount: paidAmt, accountId: paid.accountId, at: paidAt, pi, fx: num(paid.fx) });
  return { ok: true, poId: id, lines: lines.length, created, stage: payload.planned ? 'planned' : 'ordered', paid: paidAmt,
           units: lines.reduce((t, l) => t + l.qty, 0),
           rmb: round2(lines.reduce((t, l) => t + l.qty * l.rmb, 0)) };
}

/** erpPoArrive (ERP:8010) */
export async function erpPoArrive(ctx, payload) {
  payload = payload || {};
  if (!powerOn(ctx.s, 'suppliers')) throw new Error('Your account cannot receive orders.');
  const id = str(payload.poId);
  const order = (await poOpen(ctx)).orders.find((o) => o.id === id);
  if (!order) throw new Error('No open order called ' + id + '.');
  const sp = payload.shipment || {};
  const shipping = round2(num(sp.shippingBdt !== undefined ? sp.shippingBdt : payload.shippingBdt));
  if (shipping < 0) throw new Error('Shipping cannot be negative.');

  const bySku = {};
  order.lines.forEach((l) => { bySku[String(l.sku).toLowerCase()] = l; });
  const lines = [], seen = {}, over = [];
  for (const l of (payload.lines || [])) {
    const q = Math.round(num(l && l.qty));
    if (!(q > 0)) continue;
    const k = str(l.sku).toLowerCase(), on = bySku[k];
    if (!on) throw new Error(l.sku + ' is not on order ' + id + '.');
    if (seen[k]) throw new Error(on.product + ' is listed twice.');
    seen[k] = true;
    lines.push({ sku: on.sku, qty: q, unitBdt: round2(on.rmbUnit * order.rate) });
    if (q > on.left) over.push({ sku: on.sku, product: on.product, qty: q - on.left, rmb: on.rmbUnit });
  }
  for (const x of (payload.extras || [])) {
    const q = Math.round(num(x && x.qty));
    if (!(q > 0)) continue;
    const rmb = Math.round(num(x.rmbUnit) * 10000) / 10000;
    if (x.isNew) {
      const d = { ...(x.product || {}) };
      if (!str(d.product_name)) throw new Error('A new product needs a name.');
      d.opening_stock = 0;
      lines.push({ isNew: true, product: d, qty: q, unitBdt: round2(rmb * order.rate),
                   _wrong: { rmb, name: str(d.product_name) } });
      continue;
    }
    const k2 = str(x.sku).toLowerCase();
    if (bySku[k2]) throw new Error(bySku[k2].product + ' is on the order: type what came on its own line.');
    if (seen[k2]) throw new Error(x.sku + ' is listed twice.');
    seen[k2] = true;
    lines.push({ sku: str(x.sku), qty: q, unitBdt: round2(rmb * order.rate),
                 _wrong: { rmb, name: String(x.name || x.sku) } });
  }
  if (!lines.length) throw new Error('Type what arrived on at least one line.');

  const now = new Date();
  const st = (await ctx.tx`select * from po_stages where business_id = ${ctx.biz} and po_no = ${id}`)[0];
  const shipNo = str(sp.no) || str(st && st.shipment_no);
  const perKg = num(sp.freightPerKg) || (shipping > 0 ? 0 : num(st && st.freight_per_kg));
  const res = await receiveShipment(ctx, {
    mode: 'none', reference: shipNo || (id + ' / ' + formatDate(now, 'd MMM yyyy')), poId: id, lines,
    shippingBdt: shipping, supplier: order.supplier, freightPerKg: perKg, divisor: num(sp.divisor) || num(st && st.divisor) || 0,
    basis: str(sp.basis) || '', freightBasis: str(sp.freightBasis) || (perKg > 0 ? 'weight' : ''), costs: Array.isArray(sp.costs) ? sp.costs : [],
    shipNote: [sp.agent ? 'agent ' + sp.agent : '', num(sp.kg) > 0 ? num(sp.kg) + ' kg' : ''].filter((x) => x).join(', '),
    notes: order.rate > 0 ? 'priced on the order @ ' + order.rate + ' TK/RMB' : '',
  });

  const by = who(ctx);
  let units = 0;
  const costOf = {};
  lines.forEach((l) => { units += l.qty; });
  (res.lines || []).forEach((l) => { costOf[String(l.sku).toLowerCase()] = l.unitCost; });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.date)) ? str(sp.date) : formatDate(now, 'yyyy-MM-dd');
  await ctx.tx`
    insert into po_shipments (business_id, po_no, shipment_no, agent, ship_by, weight_kg, shipping_bdt,
                              arrived_on, lines, units, received_by, recorded_at)
    values (${ctx.biz}, ${id}, ${shipNo}, ${str(sp.agent)}, ${String(sp.by || order.shipBy)},
            ${num(sp.kg) || null}, ${shipping}, ${day}, ${lines.length}, ${units}, ${by}, ${now})`;

  const base = 'D' + formatDate(now, 'yyMMddHHmmss') + '-';
  const taken = {};
  let n = 0;
  const diffs = [];
  for (const o of over) {
    diffs.push({ id: await freeDiffNo(ctx, base + n++, taken), poId: id, supplier: order.supplier, sku: o.sku,
                 product: o.product, kind: 'extra', qty: o.qty, rmbUnit: o.rmb, rmb: round2(o.qty * o.rmb),
                 unitBdt: costOf[String(o.sku).toLowerCase()] || 0, status: 'open', at: now });
  }
  for (const l of lines) {
    if (!l._wrong) continue;
    diffs.push({ id: await freeDiffNo(ctx, base + n++, taken), poId: id, supplier: order.supplier, sku: l.sku,
                 product: l._wrong.name, kind: 'wrong', qty: l.qty, rmbUnit: l._wrong.rmb,
                 rmb: round2(l.qty * l._wrong.rmb), unitBdt: costOf[String(l.sku).toLowerCase()] || 0,
                 status: 'open', at: now });
  }
  for (const d of diffs) await insertDiff(ctx, d);

  let left = 0, short = 0;
  (await poOpen(ctx)).orders.forEach((o) => {
    if (o.id !== id) return;
    left = o.left;
    o.lines.forEach((l) => { if (l.left > 0 && l.received > 0) short++; });
  });
  // the order is Received when nothing is left to come; otherwise the rest is still Ordered
  await ctx.tx`update po_stages set stage = ${left > 0 ? 'ordered' : 'received'}, updated_by = ${by}, updated_at = now()
               where business_id = ${ctx.biz} and po_no = ${id}`;
  return { ok: true, poId: id, received: res.received, units: res.units, shipping: res.shipping,
           lines: res.lines, stillToCome: left, shortLines: short, differences: diffs.length,
           created: res.createdProducts || [] };
}

/** erpPoLineClose (ERP:8103) */
export async function erpPoLineClose(ctx, payload) {
  if (!powerOn(ctx.s, 'suppliers')) throw new Error('Your account cannot close orders.');
  const id = str(payload && payload.poId), sku = str(payload && payload.sku).toLowerCase();
  const why = str(payload && payload.reason) || 'supplier did not send it';
  await lock(ctx, 'stock');
  const order = (await poOpen(ctx)).orders.find((o) => o.id === id);
  if (!order) throw new Error('No open order called ' + id + '.');
  const line = order.lines.find((l) => String(l.sku).toLowerCase() === sku);
  if (!line || !(line.left > 0)) throw new Error('Nothing is still to come on that line.');
  const now = new Date();
  await ctx.tx`update po_lines set status = ${'closed: ' + why}, closed_at = ${now} where id = ${line.row}`;
  const dno = await freeDiffNo(ctx, 'D' + formatDate(now, 'yyMMddHHmmss') + '-s0', {});
  await insertDiff(ctx, shortDiff(dno, id, order.supplier, line, why, now, who(ctx)));
  return { ok: true, poId: id, sku: line.sku, owed: round2(line.left * line.rmbUnit) };
}

/** erpPoShortDiff_ (ERP:8094) */
function shortDiff(dno, id, supplier, line, why, now, by) {
  return { id: dno, poId: id, supplier, sku: line.sku, product: line.product, kind: 'short', qty: line.left,
           rmbUnit: line.rmbUnit, rmb: round2(line.left * line.rmbUnit), unitBdt: 0, status: 'supplier_owes',
           at: now, decidedAt: now, decidedBy: by, note: why };
}

/** erpPoClose (ERP:8230): the rest of an order is not coming. */
export async function erpPoClose(ctx, payload) {
  if (!powerOn(ctx.s, 'suppliers')) throw new Error('Your account cannot close orders.');
  const id = str(payload && payload.poId);
  const why = str(payload && payload.reason);
  if (!why) throw new Error('Say why the rest is not coming.');
  await lock(ctx, 'stock');
  const v = await ctx.tx`select * from po_lines where business_id = ${ctx.biz} order by seq`;
  if (!v.length) throw new Error('No order called ' + id + '.');
  const now = new Date(), by = who(ctx), owed = [];
  const base = 'D' + formatDate(now, 'yyMMddHHmmss') + '-s', taken = {};
  let n = 0;
  for (const r of v) {
    if (str(r.po_no) !== id || str(r.status) !== 'open') continue;
    await ctx.tx`update po_lines set status = ${'closed: ' + why}, closed_at = ${now} where id = ${r.id}`;
    const left = Math.max(0, num(r.qty) - num(r.received));
    if (left > 0) {
      const dno = await freeDiffNo(ctx, base + owed.length, taken);
      owed.push(shortDiff(dno, id, str(r.supplier), { sku: str(r.sku), product: String(r.product || ''),
        left, rmbUnit: num(r.rmb_unit) }, why, now, by));
    }
    n++;
  }
  if (!n) throw new Error('No open order called ' + id + '.');
  for (const d of owed) await insertDiff(ctx, d);
  return { ok: true, poId: id };
}

/** erpPoDiffDecide (ERP:8130): pay / free bonus / hand back. */
export async function erpPoDiffDecide(ctx, payload) {
  if (!powerOn(ctx.s, 'suppliers')) throw new Error('Your account cannot decide this.');
  const did = String((payload && payload.diffId) || ''), what = String((payload && payload.decision) || '');
  if (what !== 'pay' && what !== 'free' && what !== 'return') throw new Error('Pay for it, keep it free, or hand it back?');
  await lock(ctx, 'stock');
  const rows = await ctx.tx`select * from po_diffs where business_id = ${ctx.biz} and diff_no = ${did}
                            order by seq limit 1`;
  const r = rows[0];
  if (!r) throw new Error('That difference was not found.');
  if (String(r.status) !== 'open') throw new Error('That one has already been decided.');
  const sku = String(r.sku || ''), qty = num(r.qty), unit = num(r.unit_bdt), now = new Date(), by = who(ctx);
  let note = '';

  if (what === 'return') {
    await adjustStock(ctx, { sku, qty, direction: 'OUT', reason: 'not ordered - handed back to the supplier (' + String(r.po_no || '') + ')' });
    note = 'taken out of stock';
  } else if (what === 'free' && unit > 0) {
    const have = (await onHandMap(ctx))[sku.toLowerCase()] || 0;
    const p = have > 0 ? await productBySku(ctx, sku) : null;
    if (p) {
      const was = num(p.cost_price);
      const nowCost = Math.max(0, round2((was * have - qty * unit) / have));
      await ctx.tx`update products set cost_price = ${nowCost}, updated_at = now() where id = ${p.id}`;
      delete ctx.memo.catalog;
      note = 'average cost ' + was + ' -> ' + nowCost;
    }
  }
  const status = what === 'pay' ? 'i_owe' : what === 'free' ? 'free' : 'returned';
  await ctx.tx`update po_diffs set status = ${status}, decided_at = ${now}, decided_by = ${by}, note = ${note}
               where id = ${r.id}`;
  return { ok: true, diffId: did, status, note };
}

/** erpPoSettle (ERP:8172) */
export async function erpPoSettle(ctx, payload) {
  if (!roleAtLeast(actRole(ctx.s), 'shareholder')) throw new Error('Only the owner or a shareholder can settle a supplier.');
  let sup = str(payload && payload.supplier).toLowerCase();
  // fix: the balance for diffs with no supplier is shown under this label
  if (sup === '(no supplier named)') sup = '';
  const how = str(payload && payload.note);
  if (!how) throw new Error('Say how it was settled.');
  await lock(ctx, 'stock');
  const rows = await ctx.tx`select id, supplier, status, settled_at, note from po_diffs
                            where business_id = ${ctx.biz} order by seq`;
  const now = new Date();
  let n = 0;
  for (const r of rows) {
    const st = String(r.status);
    if (str(r.supplier).toLowerCase() !== sup || r.settled_at || (st !== 'supplier_owes' && st !== 'i_owe')) continue;
    const note = (String(r.note || '') ? String(r.note) + ' | ' : '') + 'settled: ' + how;
    await ctx.tx`update po_diffs set settled_at = ${now}, note = ${note} where id = ${r.id}`;
    n++;
  }
  if (!n) throw new Error('Nothing is outstanding with that supplier.');
  return { ok: true, settled: n };
}

export const HANDLERS = {
  erpPoStage, erpProductSizes,
  erpSaveProduct, erpSetProductStatus, erpDiscontinued,
  erpReceiveShipment, erpReceiveStock, erpAdjustStock, erpStockHistory,
  erpReorderPlan, erpApplyReorderLevels,
  erpPoList, erpPoCreate, erpPoPay, erpPoArrive, erpPoLineClose, erpPoClose, erpPoDiffDecide, erpPoSettle,
};
