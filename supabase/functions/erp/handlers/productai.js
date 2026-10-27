// What the Inbox AI may say about each product (owner 17 Oct 2026): a description and the details customers ask about.
// Every business keeps its own list of details; a ready-made list per kind of business is offered (3D printing,
// cosmetics, clothing, electronics, general) and can be changed freely. Table product_ai (125).
//
//   erpProductFields()                       the business's detail list (+ the ready-made lists)
//   erpProductFieldsSave({kind, fields})     owner: choose a ready-made list or write your own
//   erpProductAi({sku})                      one product's description and details
//   erpProductAiSave({sku, description, facts})

import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
const keyOf = (label) => str(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const F = (labels) => labels.map((l) => ({ key: keyOf(l), label: l }));

export const FIELD_PRESETS = {
  '3d': { label: '3D printing', fields: F(['Material', 'Colour', 'Diameter', 'Weight per spool', 'Print temperature', 'Bed temperature', 'Works with these printers', 'Warranty']) },
  cosmetics: { label: 'Cosmetics and skin care', fields: F(['Skin type', 'Shade', 'Size / volume', 'Key ingredients', 'Made in', 'Shelf life / expiry', 'How to use', 'Original / imported from']) },
  clothing: { label: 'Clothing and fashion', fields: F(['Size', 'Colour', 'Fabric', 'Fit', 'Size chart', 'For (men / women / kids)', 'Care']) },
  electronics: { label: 'Electronics and gadgets', fields: F(['Model', 'Specifications', 'Warranty', 'Works with', 'In the box', 'Power / battery']) },
  general: { label: 'General shop', fields: F(['Size', 'Colour', 'Material', 'Made in', 'Warranty']) },
};

export async function productFields(ctx) {
  let c = null;
  try { c = JSON.parse(str(await getConfig(ctx, 'product_fields', '')) || 'null'); } catch (_) { c = null; }
  if (!c || !Array.isArray(c.fields)) c = { kind: 'general', fields: FIELD_PRESETS.general.fields };
  return c;
}

/** {sku(lower): {description, facts}} for the AI's catalogue. */
export async function productAiMap(ctx) {
  const out = {};
  try {
    for (const r of await ctx.tx.savepoint(() => ctx.tx`select sku, description, facts from product_ai where business_id = ${ctx.biz}`)) {
      out[str(r.sku).toLowerCase()] = { description: str(r.description), facts: r.facts || {} };
    }
  } catch (_) { /* the table is not there yet */ }
  return out;
}

export async function erpProductFields(ctx) {
  const c = await productFields(ctx);
  return { kind: c.kind, fields: c.fields, presets: Object.keys(FIELD_PRESETS).map((k) => ({ kind: k, label: FIELD_PRESETS[k].label, fields: FIELD_PRESETS[k].fields })),
           canEdit: ctx.s.role === 'owner' };
}

export async function erpProductFieldsSave(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder or a shareholder chooses the product details.');
  payload = payload || {};
  const kind = FIELD_PRESETS[str(payload.kind)] ? str(payload.kind) : 'custom';
  let fields = Array.isArray(payload.fields) ? payload.fields.map((f) => str(f && (f.label || f))).filter(Boolean) : [];
  if (!fields.length && FIELD_PRESETS[kind]) fields = FIELD_PRESETS[kind].fields.map((f) => f.label);
  const seen = {}, out = [];
  for (const l of fields.slice(0, 20)) { const k = keyOf(l); if (k && !seen[k]) { seen[k] = 1; out.push({ key: k, label: l.slice(0, 40) }); } }
  if (!out.length) throw new Error('Keep at least one detail.');
  await setConfig(ctx, 'product_fields', JSON.stringify({ kind, fields: out }));
  return erpProductFields(ctx);
}

export async function erpProductAi(ctx, payload) {
  const sku = str(payload && payload.sku);
  if (!sku) throw new Error('Which product?');
  const c = await productFields(ctx);
  const r = (await ctx.tx`select description, facts, updated_by, updated_at from product_ai where business_id = ${ctx.biz} and lower(sku) = ${sku.toLowerCase()}`)[0];
  return { sku, description: str(r && r.description), facts: (r && r.facts) || {}, fields: c.fields, kind: c.kind,
           updatedBy: str(r && r.updated_by), updatedAt: r && r.updated_at ? new Date(r.updated_at).toISOString().slice(0, 10) : '' };
}

export async function erpProductAiSave(ctx, payload) {
  payload = payload || {};
  const sku = str(payload.sku);
  const p = (await ctx.tx`select sku from products where business_id = ${ctx.biz} and lower(sku) = ${sku.toLowerCase()}`)[0];
  if (!p) throw new Error('That product is not here.');
  const c = await productFields(ctx), known = {};
  c.fields.forEach((f) => { known[f.key] = true; });
  const facts = {};
  for (const [k, v] of Object.entries(payload.facts || {})) { const val = str(v).slice(0, 400); if (known[k] && val) facts[k] = val; }
  const desc = str(payload.description).slice(0, 3000);
  await ctx.tx`insert into product_ai (business_id, sku, description, facts, updated_by, updated_at)
               values (${ctx.biz}, ${p.sku}, ${desc || null}, ${ctx.tx.json(facts)}, ${str(ctx.s.name)}, now())
               on conflict (business_id, sku) do update set description = excluded.description, facts = excluded.facts,
                 updated_by = excluded.updated_by, updated_at = now()`;
  delete ctx.memo.inboxCat;
  return erpProductAi(ctx, { sku: p.sku });
}

export const HANDLERS = { erpProductFields, erpProductFieldsSave, erpProductAi, erpProductAiSave };
