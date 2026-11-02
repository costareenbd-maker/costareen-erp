// The website's Easy mode price list (owner, 2 Nov 2026): what is on the shelf right now, straight from the ERP.
//
// GET ?pub=pricelist&b=<source>:<business>   header x-cz-key: the website sync key (Settings > Connections > Website)
//
// Own stock (stockItems: shelf minus website orders not yet entered) and the joint stock pools (erpJointCatalog,
// priced for this company) - only what is in stock (owner: "0 hole dekhabe na"). Each row: code (the SKU the website
// order will carry; joint rows keep their ~J mark so the invoice knows the pool), name, category, brand, type,
// colour, unit, price (the ERP selling price), photo. Never cost, never the count.
import { num } from '../lib/time.js';
import { str } from '../lib/tabs.js';
import { getSecret } from '../lib/ext.js';
import { limit } from './passport.js';
import { tenantOf, runAs } from './printkit.js';
import { stockItems } from './weborders.js';
import { erpJointCatalog } from './joint.js';

function same(a, b) {
  a = str(a); b = str(b);
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * A row with no type (owner 2 Nov: the joint Polymaker rows had none, so their type chips were missing): the name
 * without the brand in front and the colour at the end - "Panchroma PLA Matte Sky Blue" -> "Panchroma PLA Matte".
 * When the colour is not at the end the last word goes; with no colour there is nothing to go by.
 */
export function typeFromName(name, brand, colour) {
  const tidy = (v) => str(v).replace(/\s+/g, ' ').trim();
  let n = tidy(name);
  const b = tidy(brand), c = tidy(colour);
  if (!c) return '';
  if (b && n.toLowerCase().startsWith(b.toLowerCase() + ' ')) n = n.slice(b.length + 1);
  if (n.toLowerCase().endsWith(' ' + c.toLowerCase())) return n.slice(0, n.length - c.length - 1).trim();
  const words = n.split(' ');
  return words.length > 1 ? words.slice(0, -1).join(' ') : '';
}

/** The rows (also used by the tests). */
export async function priceList(ctx) {
  const info = {};
  for (const r of await ctx.tx`select sku, category, brand, type, color, unit, image_url from products where business_id = ${ctx.biz}`) {
    info[str(r.sku).toLowerCase()] = r;
  }
  const out = [];
  for (const it of await stockItems(ctx)) {
    if (it.ours || !it.active || num(it.qty) <= 0 || num(it.price) <= 0) continue;   // aliases are the website's own names
    const p = info[str(it.sku).toLowerCase()] || {};
    out.push({ code: it.sku, name: it.name, category: str(p.category), brand: str(p.brand), type: str(p.type) || typeFromName(it.name, p.brand, p.color), colour: str(p.color),
               unit: str(p.unit) || 'Piece', price: num(it.price), photo: str(p.image_url), joint: false });
  }
  const joint = await erpJointCatalog(ctx);
  for (const p of (joint && joint.products) || []) {
    if (num(p.available) <= 0 || num(p.sell) <= 0) continue;
    out.push({ code: p.sku, name: p.name, category: str(p.cat), brand: str(p.brand), type: str(p.type) || typeFromName(p.name, p.brand, p.color), colour: str(p.color),
               unit: str(p.unit) || 'Piece', price: num(p.sell), photo: '', joint: true });
  }
  out.sort((a, b) => (a.category + '\u0000' + a.brand + '\u0000' + a.type + '\u0000' + a.name).localeCompare(b.category + '\u0000' + b.brand + '\u0000' + b.type + '\u0000' + b.name));
  return out;
}

export async function route(deps, R, params, headers, ip) {
  await limit(deps, ip, 'pricelist', 120);
  const { d, row } = await tenantOf(deps, R, params.get('b'));
  return runAs(d, R, row, 'pub:pricelist', async (ctx) => {
    const key = await getSecret(ctx, 'CZ_SYNC_KEY');
    if (!key || !same(key, headers.get('x-cz-key'))) throw new Error('Not allowed.');
    return { items: await priceList(ctx), at: new Date().toISOString() };
  });
}
