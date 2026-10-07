// The master catalogue (docs/CHANGES.md "Master catalogue"): one record per physical thing, made and kept by the
// server by itself, so no shop has to learn an SKU. Every product a shop lists on the market is linked to an item:
//   1. the words (brand, line, colour, size, variant - the same matcher that reads supplier files) when they are all
//      there -> the key; the item exists or is created;
//   2. the AI reader (the provider's Gemini key) for names the words cannot settle, in batches, once per name;
//   3. a name with no brand stays unlinked (shown under the shop's own name) until the shop improves it.
// Find stock and the Market group by item. The provider sees what was decided (Platform > Catalogue) and can unlink
// or rename; an admin decision is never overwritten by the job.
//
//   catalogSync(deps, {ai})      the job: nightly with AI; after every market refresh without
//   erpCatalogue()               Platform: counts, the last run, the last decisions
//   erpCatalogueAct({action})    Platform: run | unlink {source, productId} | rename {item, name}

import { num, formatDate } from '../lib/time.js';
import { brandOf, typeOf, colourOf, isRefill, norm, providerAiKey, GEMINI_MODELS } from './receivefile.js';
import { platformAdmin } from './platform.js';

const str = (v) => String(v == null ? '' : v).trim();
const cap = (t) => str(t).replace(/\b\w/g, (m) => m.toUpperCase());
const BRAND_SHOW = { bambulab: 'Bambu Lab', sunlu: 'Sunlu', polymaker: 'Polymaker', esun: 'eSUN', creality: 'Creality', elegoo: 'Elegoo', anycubic: 'Anycubic', kingroon: 'Kingroon', jayo: 'Jayo', eryone: 'Eryone', overture: 'Overture' };
const LINE_SHOW = (t) => t ? cap(t).replace('Pla', 'PLA').replace('Petg', 'PETG').replace('Abs', 'ABS').replace('Asa', 'ASA').replace('Tpu', 'TPU').replace('Pc', 'PC').replace('Cf', 'CF').replace('Gf', 'GF') : '';

/** The size words a name carries: 1kg, 500g, 250g, 2kg; nothing when it says none. */
export function sizeOf(text) {
  const m = /(\d+(?:\.\d+)?)\s*(kg|g)\b/i.exec(str(text));
  if (!m) return '';
  const n = Number(m[1]), u = m[2].toLowerCase();
  if (u === 'g' && n >= 1000) return (n / 1000) + 'kg';
  return (u === 'kg' ? n : n) + u;
}
/** The fields of a listing, from its words. brand and colour must both be there for a key. */
export function fieldsOf(l) {
  const text = [l.brand, l.name, l.category, l.color].map(str).join(' ');
  const brand = brandOf(text) || norm(l.brand);
  const line = typeOf(text);
  const colour = colourOf(str(l.color) || str(l.name), brand, line);
  // a filament with no size written is the standard 1 kg spool - that is what every shop means by "PLA Basic Black"
  const size = sizeOf(text) || (/^(pla|petg|abs|asa|tpu|pa6|pc)\b/.test(line) ? '1kg' : '');
  return { brand, line, colour, size, variant: isRefill(text) ? 'refill' : '' };
}
export function keyOf(f) { return [f.brand, f.line, f.colour, f.size, f.variant].map((x) => norm(x)).join('|'); }
export function nameOf(f) {
  return [BRAND_SHOW[f.brand] || cap(f.brand), LINE_SHOW(f.line), cap(f.colour), f.size ? f.size.replace('kg', ' kg').replace(/(\d)g$/, '$1 g') : '', f.variant ? '(' + f.variant + ')' : ''].filter(Boolean).join(' ');
}

async function itemFor(c, f, madeBy, category) {
  const key = keyOf(f);
  const had = (await c`select id from erp_catalog_items where key = ${key}`)[0];
  if (had) return { id: Number(had.id), created: false };
  const r = (await c`insert into erp_catalog_items (key, name, brand, line, colour, size, variant, category, made_by)
                     values (${key}, ${nameOf(f)}, ${f.brand || null}, ${f.line || null}, ${f.colour || null}, ${f.size || null}, ${f.variant || null}, ${str(category) || null}, ${madeBy})
                     on conflict (key) do update set updated_at = now() returning id`)[0];
  return { id: Number(r.id), created: true };
}
async function link(c, l, itemId, how, conf) {
  await c`insert into erp_catalog_links (source, business_id, product_id, item_id, how, confidence, name_seen, updated_at)
          values (${l.source}, ${l.business_id}, ${l.product_id}, ${itemId}, ${how}, ${conf}, ${str(l.name)}, now())
          on conflict (source, product_id) do update set item_id = excluded.item_id, how = excluded.how, confidence = excluded.confidence, name_seen = excluded.name_seen, updated_at = now()
          where erp_catalog_links.how <> 'admin'`;
}
const log = (c, what, detail) => c`insert into erp_catalog_log (what, detail) values (${what}, ${str(detail).slice(0, 300)})`;

/** Names the words could not settle, asked of the AI reader in one batch. Returns {index: fields} for those it knew. */
async function aiFields(deps, key, batch) {
  const prompt = 'These are product names from 3D-printing shops in Bangladesh (filament, printers, parts). For each, give the brand, the product line (e.g. "PLA Basic", "PLA Matte", "PLA+", "PETG", "ABS", "TPU"), the colour, the size (e.g. "1kg", "500g") and the variant ("refill" when it is a spool-less refill, else ""). ' +
    'Answer with JSON only: an array of {"i": index, "brand": "", "line": "", "colour": "", "size": "", "variant": ""}; leave a field "" when the name does not say. Names:\n' +
    batch.map((b, i) => i + '. ' + b).join('\n');
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, response_mime_type: 'application/json' } };
  for (const model of GEMINI_MODELS) {
    let res, txt;
    const ac = typeof AbortController === 'function' ? new AbortController() : null, timer = ac ? setTimeout(() => ac.abort(), 40000) : null;
    try {
      res = await deps.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key),
                             { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac ? ac.signal : undefined });
      txt = await res.text();
    } catch (_) { continue; } finally { if (timer) clearTimeout(timer); }
    if (!res.ok) { if ([404, 429, 503].includes(res.status)) continue; throw new Error('AI reader refused: ' + res.status); }
    let out = '';
    try { const j = JSON.parse(txt); out = str(((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join('')); } catch (_) { out = txt; }
    let arr = null; try { arr = JSON.parse(out); } catch (_) { const a = out.indexOf('['), b = out.lastIndexOf(']'); if (a >= 0 && b > a) { try { arr = JSON.parse(out.slice(a, b + 1)); } catch (_2) { arr = null; } } }
    const got = {};
    for (const r of Array.isArray(arr) ? arr : []) {
      const i = Math.round(num(r && r.i)); if (!(i >= 0 && i < batch.length)) continue;
      const f = { brand: norm(r.brand), line: norm(r.line), colour: norm(r.colour), size: sizeOf(str(r.size)) || norm(r.size), variant: /refill/i.test(str(r.variant)) ? 'refill' : '' };
      if (f.brand && f.colour) got[i] = f;
    }
    return got;
  }
  return {};
}

/** The job. Every listed product without a link, or whose name changed since, is looked at. */
export async function catalogSync(deps, opts) {
  const c = deps.control; if (!c) return { skipped: true };
  const useAi = !(opts && opts.ai === false);
  const rows = await c`
    select l.source, l.business_id, l.product_id, l.name, l.brand, l.color, l.category
      from erp_catalog_products l
      left join erp_catalog_links k on k.source = l.source and k.product_id = l.product_id
     where k.product_id is null or (k.how <> 'admin' and k.name_seen is distinct from l.name)
     limit 2000`;
  const out = { looked: rows.length, linked: 0, created: 0, ai: 0, left: 0 };
  const unsure = [];
  for (const l of rows) {
    const f = fieldsOf(l);
    if (f.brand && f.colour) {
      const it = await itemFor(c, f, 'auto', l.category);
      await link(c, l, it.id, 'key', 1);
      out.linked++; if (it.created) { out.created++; await log(c, 'created', nameOf(f) + ' ← ' + str(l.name)); }
    } else if (norm(l.name).split(' ').length >= 2) unsure.push(l);
    else out.left++;
  }
  if (unsure.length && useAi) {
    const key = await providerAiKey(deps);
    if (key) {
      for (let i = 0; i < unsure.length && i < 400; i += 40) {
        const batch = unsure.slice(i, i + 40);
        let got = {};
        try { got = await aiFields(deps, key, batch.map((l) => [l.brand, l.name, l.color].filter(Boolean).join(' '))); } catch (e) { await log(c, 'run', 'AI reader: ' + str(e.message)); break; }
        for (let j = 0; j < batch.length; j++) {
          const f = got[j];
          if (!f) { out.left++; continue; }
          const it = await itemFor(c, f, 'ai', batch[j].category);
          await link(c, batch[j], it.id, 'ai', 0.9);
          out.ai++; out.linked++; if (it.created) out.created++;
          await log(c, 'ai', nameOf(f) + ' ← ' + str(batch[j].name));
        }
      }
    } else out.left += unsure.length;
  } else out.left += unsure.length;
  if (rows.length) await log(c, 'run', JSON.stringify(out));
  return out;
}

async function needAdmin(ctx) { if (!(await platformAdmin(ctx))) throw new Error('Only the provider keeps the catalogue.'); }
export async function erpCatalogue(ctx) {
  await needAdmin(ctx);
  const c = ctx.deps.control; if (!c) throw new Error('This server has no catalogue.');
  const n = (await c`select (select count(*)::int from erp_catalog_items) as items,
                            (select count(*)::int from erp_catalog_links where item_id is not null) as linked,
                            (select count(*)::int from erp_catalog_products l left join erp_catalog_links k on k.source = l.source and k.product_id = l.product_id where k.item_id is null) as unlinked,
                            (select count(*)::int from erp_catalog_links where how = 'ai') as byAi`)[0];
  const last = await c`select at, what, detail from erp_catalog_log order by id desc limit 60`;
  const items = await c`select i.id, i.name, i.made_by, (select count(*)::int from erp_catalog_links k where k.item_id = i.id) as shops
                        from erp_catalog_items i order by shops desc, i.name limit 200`;
  const loose = await c`select l.source, l.product_id, l.name, l.brand, l.color, coalesce(s.name, b.name, '?') as shop
                        from erp_catalog_products l
                        left join erp_market_shops s on s.source = l.source and s.business_id = l.business_id
                        left join businesses b on l.source = 'self' and b.id = l.business_id
                        left join erp_catalog_links k on k.source = l.source and k.product_id = l.product_id
                        where k.item_id is null order by l.name limit 100`;
  return { items: Number(n.items), linked: Number(n.linked), unlinked: Number(n.unlinked), byAi: Number(n.byai),
           log: last.map((r) => ({ when: formatDate(new Date(r.at), 'd MMM, h:mm a'), what: str(r.what), detail: str(r.detail) })),
           list: items.map((r) => ({ id: Number(r.id), name: str(r.name), madeBy: str(r.made_by), shops: Number(r.shops) })),
           loose: loose.map((r) => ({ source: str(r.source), productId: str(r.product_id), name: str(r.name), brand: str(r.brand), colour: str(r.color), shop: str(r.shop) })) };
}
export async function erpCatalogueAct(ctx, payload) {
  await needAdmin(ctx);
  const c = ctx.deps.control; if (!c) throw new Error('This server has no catalogue.');
  const p = payload || {}, a = str(p.action);
  if (a === 'run') { const r = await catalogSync(ctx.deps, { ai: p.ai !== false }); return { ...(await erpCatalogue(ctx)), ran: r }; }
  if (a === 'unlink') {
    await c`insert into erp_catalog_links (source, business_id, product_id, item_id, how, confidence, name_seen)
            select source, business_id, product_id, null, 'admin', 1, name from erp_catalog_products where source = ${str(p.source)} and product_id = ${str(p.productId)}::uuid
            on conflict (source, product_id) do update set item_id = null, how = 'admin', updated_at = now()`;
    await log(c, 'unlinked', str(p.source) + ' ' + str(p.productId)); return erpCatalogue(ctx);
  }
  if (a === 'rename') {
    const name = str(p.name).slice(0, 120); if (!name) throw new Error('Give the item a name.');
    await c`update erp_catalog_items set name = ${name}, made_by = 'admin', updated_at = now() where id = ${Math.round(num(p.item))}`;
    await log(c, 'renamed', name); return erpCatalogue(ctx);
  }
  throw new Error('What should be done?');
}
export const HANDLERS = { erpCatalogue, erpCatalogueAct };
