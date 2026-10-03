// Which product here is the website's item? (any website, any SKUs)
//
//   1. a link a person made once ("website item X is product Y")   - always wins
//   2. the same SKU, capitals and spaces ignored
//   3. the same barcode
//   otherwise: not matched. Close names are only SUGGESTED, never used on
//   their own - a wrong guess would sell and deduct the wrong product.

const str = (v) => String(v == null ? '' : v).trim();

/** The website's words, made comparable: lower case, letters and digits only. */
export function normName(v) {
  return str(v).toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** What a website item is known by: its SKU, or its name when it has no SKU. */
export function extKey(sku, name) {
  const s = str(sku);
  if (s && s !== '(no sku)') return s.toLowerCase().replace(/\s+/g, '');
  const n = normName(name);
  return n ? 'name:' + n : '';
}

/** How alike two product names are, 0..1 (shared words; numbers like 1kg / 1.75 count double). */
export function likeness(a, b) {
  const ta = normName(a).split(' ').filter(Boolean), tb = normName(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const w = (t) => (/\d/.test(t) ? 2 : 1);
  const sb = new Set(tb);
  let both = 0, all = 0;
  for (const t of new Set(ta)) { all += w(t); if (sb.has(t)) both += w(t); }
  for (const t of sb) all += w(t);
  const words = (2 * both) / all;
  // the same letters run together ("Bambu Lab" / "Bambulab"), and a short name inside a long
  // website title ("Bambu Lab A1 (Global Version) Price in BD | ...") count too
  const grams = (t) => { const c = t.join(''), g = new Set(); for (let i = 0; i + 3 <= c.length; i++) g.add(c.slice(i, i + 3)); return g; };
  const ga = grams(ta), gb = grams(tb);
  let gboth = 0;
  for (const g of ga) if (gb.has(g)) gboth++;
  const small = Math.min(ga.size, gb.size) || 1;
  const letters = ga.size && gb.size ? 0.5 * (2 * gboth / (ga.size + gb.size)) + 0.5 * (gboth / small) : 0;
  const dice = Math.max(words, letters * 0.95);
  // a number on one side that the other lacks is a different size/colour code: hold it back
  const na = ta.filter((t) => /\d/.test(t)), nb = new Set(tb.filter((t) => /\d/.test(t)));
  const clash = na.length && nb.size && !na.some((t) => nb.has(t));
  return Math.round((clash ? dice * 0.6 : dice) * 100) / 100;
}

/**
 * Everything needed to match, read once per call.
 * Returns { find(sku, name, barcode) -> {product, how} | null, suggest(sku, name, n), products, links }.
 */
export async function matcher(ctx) {
  const k = 'shop:matcher';
  if (ctx.memo[k]) return ctx.memo[k];
  const products = await ctx.tx`select id, sku, name, barcode, sell_price, status from products where business_id = ${ctx.biz}`;
  const links = await ctx.tx`select l.ext_key, l.ext_sku, l.ext_name, l.product_id, l.made_by, l.made_at, p.sku, p.name
                             from web_product_links l join products p on p.id = l.product_id where l.business_id = ${ctx.biz}`;
  const byId = new Map(products.map((p) => [p.id, p]));
  const bySku = new Map(), byBarcode = new Map(), byLink = new Map();
  for (const p of products) {
    bySku.set(str(p.sku).toLowerCase().replace(/\s+/g, ''), p);
    const bc = str(p.barcode).replace(/\s+/g, '');
    if (bc) byBarcode.set(bc, p);
  }
  for (const l of links) byLink.set(l.ext_key, byId.get(l.product_id));

  const find = (sku, name, barcode) => {
    const key = extKey(sku, name);
    if (key && byLink.get(key)) return { product: byLink.get(key), how: 'link' };
    // a name-keyed link still matches when the website later adds a SKU
    const nk = extKey('', name);
    if (nk && byLink.get(nk)) return { product: byLink.get(nk), how: 'link' };
    const s = str(sku);
    if (s && s !== '(no sku)' && bySku.get(s.toLowerCase().replace(/\s+/g, ''))) return { product: bySku.get(s.toLowerCase().replace(/\s+/g, '')), how: 'sku' };
    const bc = str(barcode).replace(/\s+/g, '');
    if (bc && byBarcode.get(bc)) return { product: byBarcode.get(bc), how: 'barcode' };
    // some websites put the barcode in the SKU field
    if (s && byBarcode.get(s.replace(/\s+/g, ''))) return { product: byBarcode.get(s.replace(/\s+/g, '')), how: 'barcode' };
    return null;
  };
  const suggest = (sku, name, n = 3) => products
    .filter((p) => str(p.status).toLowerCase() !== 'discontinued')
    .map((p) => ({ sku: p.sku, name: p.name, score: Math.max(likeness(name, p.name), sku ? likeness(sku, p.sku) * 0.9 : 0) }))
    .filter((x) => x.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
  ctx.memo[k] = { find, suggest, products, links };
  return ctx.memo[k];
}

export function forgetMatcher(ctx) { delete ctx.memo['shop:matcher']; }
