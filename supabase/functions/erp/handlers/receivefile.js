// Receive stock from a file: a supplier's packing list, proforma or order sheet (spreadsheet rows or the text of a
// PDF) becomes lines for the Receive stock form, each matched to one of OUR products, for the owner to check.
//
//   erpReceiveMatch({rows, kind, supplier})   rows: a grid (arrays of cells) from a spreadsheet, or lines of text from
//                                             a PDF (kind 'text'); -> {lines: [{row, text, code, qty, price, currency,
//                                             sku, name, stock, confidence, candidates, isNew, newProduct}], ...}
//   erpReceiveRead({image, hint, supplier})   a photo / scan: the provider's AI reader (Gemini, the provider's key) turns it
//                                             into lines, the page's own OCR text as a hint; then matched the same way
//   erpReceiveLearn({pairs: [{alias, sku}]})  the owner confirmed matches: remembered per supplier code / wording
//
// Matching, in order: 1. a remembered alias (the supplier's code or wording seen before) 2. our own SKU in the row
// 3. the words: brand (from the supplier or the row), the filament type (PLA Basic, PLA Matte, PLA+, PETG, ...) and
// the colour, scored against every product's name and colour. Below the bar it is "new product" with a suggested
// name - never a silent wrong guess.

import { num, formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const norm = (v) => str(v).toLowerCase().replace(/[™®]/g, '').replace(/[^\p{L}\p{N}+.]+/gu, ' ').replace(/\s+/g, ' ').trim();

// brands we know by other names (file names, Chinese, shop names)
const BRANDS = [
  ['bambulab', /bambu|拓竹|bbl\b/i], ['sunlu', /sunlu|三绿/i], ['polymaker', /polymaker|panchroma|polylite|polyterra/i],
  ['esun', /\besun\b|易生/i], ['creality', /creality|hyper\b|ender/i], ['elegoo', /elegoo/i], ['anycubic', /anycubic/i],
  ['kingroon', /kingroon/i], ['jayo', /\bjayo\b/i], ['eryone', /eryone/i], ['overture', /overture/i],
];
// filament types, with the words a supplier uses for them; order matters (longer first)
const TYPES = [
  ['pla matte', /pla[\s-]*matte|matte[\s-]*pla|\bmatte\b/i], ['pla basic', /pla[\s-]*basic|\bbasic\b/i],
  ['pla+', /pla\s*\+\s*2\.0|pla\s*\+|pla[\s-]*plus|pla\+/i], ['pla silk', /silk/i], ['pla wood', /\bwood\b/i], ['pla marble', /marble/i],
  ['pla translucent', /translucent|transparent/i], ['pla meta', /\bmeta\b/i], ['pla cf', /pla[\s-]*cf\b/i], ['pla high speed', /high\s*speed|hyper/i],
  ['petg cf', /petg[\s-]*cf\b/i], ['petg', /petg/i], ['abs', /\babs\b/i], ['asa aero', /asa[\s-]*aero/i], ['asa', /\basa\b/i], ['tpu', /tpu/i],
  ['pa6 cf', /pa6[\s-]*cf/i], ['pa6 gf', /pa6[\s-]*gf/i], ['pc', /\bpc\b/i], ['support', /support/i], ['pla', /\bpla\b/i],
];
const COLOUR_SYN = { gray: 'grey', 'light gray': 'light grey', 'dark gray': 'dark grey', 'ash gray': 'ash grey', 'blue gray': 'blue grey', megenta: 'magenta', 'bone white': 'bone white' };
const NOISE = /\b(1\.75\s*mm|2\.85\s*mm|1\.?0?0?\s*kg|1kg|500\s*g|250\s*g|spool[\s-]*less|with\s*spool|refill|filament|roll|pcs|kg|mm|g|panchroma|polylite|polyterra|polymax|hyper|tough|pro|ultra|95a|98a|diskless)\b/gi;
const HEAD_WORDS = { code: /^(sku|code|item\s*(no|code)|part|art\.?\s*no|model)$/i, name: /^(product|name|product\s*name|description|desc|item|goods|type|category|sub-?category|variant|color|colour|颜色|品名|规格)$/i,
                     qty: /^(qty|quantity|order|order\s*list|pcs|units|amount|数量)$/i, price: /^(unit\s*price|price|unit\s*value|unit\s*cost|cost|单价|value\s*\(?(usd|rmb|cny)\)?|unit value \(usd\))$/i,
                     weight: /^(weight|n\.?w|g\.?w|packet|diameter|hs\s*code|minpack|seqnum|seq|#|no\.?|sl)$/i };
const CODE_RE = /^(?=.*\d)[a-z0-9][a-z0-9-]{3,14}$/i;
const CUR_RE = /\b(usd|rmb|cny|bdt|tk|taka|eur)\b|[$¥€৳]/i;

function brandOf(text) { const t = str(text); for (const [b, re] of BRANDS) if (re.test(t)) return b; return ''; }
function typeOf(text) { const t = str(text); for (const [ty, re] of TYPES) if (re.test(t)) return ty; return ''; }
function colourOf(text, brand, type) {
  // the colour is what is left of the words once brand, type and packaging words are gone
  let t = norm(text).replace(NOISE, ' ').replace(/\d+(\.\d+)?\s*(kg|g|mm)/g, ' ').replace(/[\d.]+/g, ' ');
  for (const [, re] of BRANDS) t = t.replace(re, ' ');
  for (const [, re] of TYPES) t = t.replace(re, ' ');
  t = t.replace(/\b(pla|petg|abs|asa|tpu|pc|cf|gf|basic|matte|plus|silk|wood|marble|refill|spool|less|with|filament|diskless|diameter|mm|kg|g)\b/g, ' ')
       .replace(/[\p{Script=Han}\p{Script=Bengali}]+/gu, ' ').replace(/[\d.]+/g, ' ').replace(/\b\w\b/g, ' ').replace(/\s+/g, ' ').trim();
  for (const k of Object.keys(COLOUR_SYN)) t = t.replace(new RegExp('\\b' + k + '\\b', 'g'), COLOUR_SYN[k]);
  return t;
}
function words(s) { return norm(s).split(' ').filter((w) => w && w.length > 1); }

/** Every product, with the words a file could use for it. */
async function catalogue(ctx) {
  const rows = await ctx.tx`select p.id, p.sku, p.name, p.brand, p.type, p.color, p.category, p.cost_price, coalesce(s.stock, 0) as stock
                            from products p left join product_stock s on s.product_id = p.id
                            where p.business_id = ${ctx.biz} and coalesce(p.status, 'Active') <> 'Discontinued'`;
  return rows.map((p) => {
    const text = [p.brand, p.name, p.type, p.color].map(str).join(' ');
    const brand = brandOf(text) || norm(p.brand);
    const type = typeOf(text);
    const colour = colourOf(str(p.color) || str(p.name), brand, type);
    return { id: p.id, sku: str(p.sku), name: str(p.name), brand, type, colour, cw: new Set(words(colour)), stock: num(p.stock), cost: num(p.cost_price) };
  });
}

/** 0..1: how well a row's brand / type / colour fit a product. The colour must agree; the type nearly must. */
function score(row, p) {
  let s = 0;
  if (row.brand && p.brand) { if (row.brand !== p.brand) return 0; s += 0.2; } else if (!row.brand) s += 0.1;
  if (row.type && p.type) { if (row.type === p.type) s += 0.3; else if (row.type.split(' ')[0] === p.type.split(' ')[0]) s += 0.1; else return 0; }
  else if (!row.type && !p.type) s += 0.15;
  const rw = new Set(words(row.colour));
  if (!rw.size || !p.cw.size) return s * 0.5;
  let both = 0; for (const w of rw) if (p.cw.has(w)) both++;
  if (!both) return 0;
  const jac = both / (rw.size + p.cw.size - both);
  return s + 0.5 * jac;
}

// ---- reading the rows of a spreadsheet, or the lines of a PDF, into records {code, text, qty, price, currency}
function isNumCell(v) { return v !== '' && v != null && /^-?\d[\d,]*(\.\d+)?$/.test(str(v).replace(/[৳$¥€,\s]/g, '')) ; }
function numCell(v) { return num(str(v).replace(/[৳$¥€,\s]/g, '')); }

function gridRecords(grid) {
  const rows = grid.map((r) => (Array.isArray(r) ? r : [r]).map((c) => (c == null ? '' : String(c))));
  // the heading line: the first row where at least two cells are known heading words
  let head = -1, cols = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const hit = rows[i].map((c) => { const t = str(c); for (const k of Object.keys(HEAD_WORDS)) if (HEAD_WORDS[k].test(t)) return k; return ''; });
    if (hit.filter(Boolean).length >= 2 && hit.includes('qty') || hit.filter(Boolean).length >= 3) { head = i; cols = hit; break; }
  }
  const out = [];
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i]; if (!r.some((c) => str(c))) continue;
    let code = '', qty = 0, price = 0, currency = '', text = [];
    if (cols) {
      for (let c = 0; c < r.length; c++) {
        const v = str(r[c]), k = cols[c] || '';
        if (!v) continue;
        if (k === 'code') code = v;
        else if (k === 'qty') qty = numCell(v);
        else if (k === 'price') { price = numCell(v); const m = CUR_RE.exec(str(rows[head][c])); if (m) currency = m[0]; }
        else if (k === 'name') text.push(v);
        else if (k === 'weight') { /* not a word of the product */ }
        else if (!isNumCell(v)) text.push(v);
      }
      // a sheet without a qty heading: the first whole number after the words
      if (!qty) for (let c = 0; c < r.length; c++) if (cols[c] !== 'price' && isNumCell(r[c]) && Number.isInteger(numCell(r[c])) && numCell(r[c]) > 0) { qty = numCell(r[c]); break; }
    } else {
      const nums = [];
      for (const c of r) { const v = str(c); if (!v) continue; if (isNumCell(v)) nums.push(numCell(v)); else if (!code && CODE_RE.test(v) && !/^[a-z]+$/i.test(v)) code = v; else text.push(v); }
      const ints = nums.filter((n) => Number.isInteger(n) && n > 0 && n < 100000);
      qty = ints[0] || 0; price = nums.find((n) => !Number.isInteger(n)) || 0;
    }
    if (!text.length && !code) continue;
    if (!qty) continue;
    if (/^(total|合计|subtotal|sum)/i.test(text.join(' '))) continue;
    out.push({ row: i + 1, code, text: text.join(' / '), qty, price, currency: currency.toUpperCase() });
  }
  return out;
}
function textRecords(lines) {
  // a PDF: a record starts at a supplier code; its name may wrap over the following lines; the quantity sits on
  // a numbers line (sometimes on the code's own line). A price is read only when the document talks money.
  const money = /\b(usd|rmb|cny|bdt|eur|price|amount|value|unit\s*cost)\b|[$¥€৳]/i.test(lines.join(' '));
  const out = [];
  let cur = null;
  const flush = () => { if (cur && (cur.text || cur.code) && cur.qty > 0) out.push(cur); cur = null; };
  const isCode = (t) => CODE_RE.test(t) && /\d/.test(t) && !/^\d+$/.test(t) && !/^\d+(\.\d+)?(kg|g|mm)$/i.test(t) && !/^\d{2,4}-\d{3,}$/.test(t);
  const takeNums = (ns) => { if (!ns.length) return; if (!cur.qty) cur.qty = ns.find((n) => Number.isInteger(n) && n > 0 && n < 100000) || 0; if (money && !cur.price) cur.price = ns.find((n) => !Number.isInteger(n) && n > 0) || 0; };
  for (let i = 0; i < lines.length; i++) {
    // table rules and OCR noise ([ | ] { } ~ _ =) are not words
    const l = str(lines[i]).replace(/[|\[\]{}~_=]+/g, ' ').replace(/\s+/g, ' ').trim(); if (!l) continue;
    if (/\b(sku|qty|quantity|product\s*name|hs\s*code|packing\s*list|proforma|total|page\s*:)\b/i.test(l) && !isCode(l.split(/\s+/)[0] || '')) { if (/\b(total|page\s*:)\b/i.test(l)) flush(); continue; }
    const toks = l.split(/\s+/);
    const codeAt = toks.findIndex(isCode);
    const numsOnly = toks.every((t) => isNumCell(t));
    if (numsOnly) { if (cur) { takeNums(toks.map(numCell)); flush(); } continue; }
    if (codeAt >= 0 && codeAt <= 3) {
      flush();
      const rest = toks.slice(codeAt + 1);
      cur = { row: i + 1, code: toks[codeAt], text: rest.filter((t) => !isNumCell(t)).join(' '), qty: 0, price: 0, currency: '' };
      takeNums(rest.filter((t) => isNumCell(t)).map(numCell));
      continue;
    }
    const ws = toks.filter((t) => !isNumCell(t)), ns = toks.filter((t) => isNumCell(t)).map(numCell);
    if (cur) {
      cur.text = (cur.text + ' ' + ws.join(' ')).trim();
      if (ns.length >= 2) { takeNums(ns); flush(); }
      else if (ns.length === 1 && !ws.length) { takeNums(ns); flush(); }
    } else if (ws.length && ns.length && ws.join(' ').replace(/[^a-z]/gi, '').length >= 3) {
      // a table read off a photo: words and numbers on one line, no code - one record per line
      cur = { row: i + 1, code: '', text: ws.join(' '), qty: 0, price: 0, currency: '' };
      takeNums(ns); if (!cur.price && money && ns.length >= 2) cur.price = ns.filter((n) => n !== cur.qty)[0] || 0;
      flush();
    }
  }
  flush();
  return out;
}

/** Every record against the catalogue: the lines of the review card. */
async function matchRecords(ctx, records, opts) {
  const supplier = str(opts.supplier), fileBrand = brandOf(supplier) || brandOf(str(opts.fileName));
  const cat = await catalogue(ctx);
  const bySku = Object.fromEntries(cat.map((c) => [c.sku.toLowerCase(), c]));
  const aliases = {};
  for (const a of await ctx.tx`select alias, product_id from product_aliases where business_id = ${ctx.biz}`) aliases[str(a.alias)] = a.product_id;
  const byId = Object.fromEntries(cat.map((c) => [c.id, c]));
  const currency = (records.find((r) => r.currency) || {}).currency || '';
  const lines = records.map((r) => {
    const full = [r.code, r.text].filter(Boolean).join(' ');
    const row = { brand: fileBrand || brandOf(full), type: typeOf(full), colour: colourOf(r.text, fileBrand, '') };
    let best = null, how = '', conf = 0, cands = [];
    const al = aliases[norm(r.code)] || aliases[norm(r.text)];
    if (al && byId[al]) { best = byId[al]; how = 'remembered'; conf = 1; }
    if (!best && r.code && bySku[r.code.toLowerCase()]) { best = bySku[r.code.toLowerCase()]; how = 'sku'; conf = 1; }
    if (!best) {
      const scored = cat.map((c) => ({ c, s: score(row, c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
      cands = scored.slice(0, 4).map((x) => ({ sku: x.c.sku, name: x.c.name, score: Math.round(x.s * 100) / 100 }));
      if (scored.length && scored[0].s >= 0.55 && (scored.length < 2 || scored[0].s - scored[1].s >= 0.08)) { best = scored[0].c; how = 'words'; conf = scored[0].s; }
    }
    const cap = (t) => t.replace(/\b\w/g, (m) => m.toUpperCase());
    const typeName = row.type ? cap(row.type).replace('Pla', 'PLA').replace('Petg', 'PETG').replace('Abs', 'ABS').replace('Asa', 'ASA').replace('Tpu', 'TPU').replace('Pc', 'PC').replace('Cf', 'CF').replace('Gf', 'GF') : '';
    const brandName = row.brand ? cap(row.brand) : '';
    const suggested = [brandName, typeName, cap(row.colour)].filter(Boolean).join(' ');
    return { row: r.row, code: r.code, text: r.text, qty: r.qty, price: r.price, currency: r.currency || currency,
             sku: best ? best.sku : '', name: best ? best.name : '', stock: best ? best.stock : 0,
             how, confidence: best ? (how === 'words' ? Math.min(0.99, Math.round(conf * 100) / 100) : 1) : 0,
             candidates: cands, isNew: !best, newProduct: best ? null : { product_name: suggested || r.text, brand: brandName, color: cap(row.colour), unit: 'Roll' } };
  });
  const matched = lines.filter((l) => l.sku).length;
  return { supplier, brand: fileBrand, currency, lines, matched, unmatched: lines.length - matched,
           totalQty: lines.reduce((s, l) => s + num(l.qty), 0), totalPrice: Math.round(lines.reduce((s, l) => s + num(l.qty) * num(l.price), 0) * 100) / 100 };
}

export async function erpReceiveMatch(ctx, payload) {
  const p = payload || {};
  const kind = p.kind === 'text' ? 'text' : 'grid';
  const rows = Array.isArray(p.rows) ? p.rows.slice(0, 3000) : [];
  if (!rows.length) throw new Error('The file has nothing to read.');
  const records = kind === 'text' ? textRecords(rows.map((r) => (Array.isArray(r) ? r.join(' ') : r))) : gridRecords(rows);
  if (!records.length) throw new Error('No product lines found in the file. A line needs a product name and a quantity.');
  return { kind, reader: p.reader === 'ocr' ? 'ocr' : 'file', ...(await matchRecords(ctx, records, { supplier: p.supplier, fileName: p.fileName })) };
}

// ---------------------------------------------------------------- the provider's AI reader (a photo, a scanned PDF)
const AI_DAILY = 40;        // photos per business per day through the provider's key
const GEMINI_MODEL = 'gemini-2.0-flash';
const AI_PROMPT = 'This is a photo or scan of a supplier document for a 3D-printing shop in Bangladesh: a packing list, proforma invoice, price list or order sheet. ' +
  'Extract every product line as JSON only - an array of objects {"code": supplier item code or "", "name": the product words (brand, material/type, colour, size) as written, ' +
  '"qty": the quantity as a number, "price": the unit price as a number or 0, "currency": "USD"/"RMB"/"BDT"/"" }. Skip headings, totals and addresses. ' +
  'If a column is in Chinese, keep the English words only. Answer with the JSON array and nothing else.';

/** A photo (or a scan) read by the provider's AI, then matched like any file. The page sends the OCR text as a hint. */
export async function erpReceiveRead(ctx, payload) {
  const p = payload || {};
  const key = str(ctx.deps && ctx.deps.geminiKey);
  if (!key) throw new Error('The AI reader is not set up on this server. The photo was read on your device only - correct the lines by hand, or ask the provider to switch the reader on.');
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(str(p.image));
  if (!m) throw new Error('Send a JPEG, PNG or WebP photo.');
  if (m[3].length > 6_000_000) throw new Error('The photo is too big - the page should have shrunk it.');
  // a day's allowance per business, so one shop cannot use up the provider's quota
  const day = formatDate(ctx.now, 'yyyy-MM-dd'), k = 'ai_reads:' + day;
  const used = num(await getConfig(ctx, k, '0'));
  if (used >= AI_DAILY) throw new Error('Today\u2019s allowance of ' + AI_DAILY + ' AI reads is used up. Try tomorrow, or correct the lines by hand.');
  await setConfig(ctx, k, String(used + 1));
  const hint = str(p.hint).slice(0, 4000);
  const body = { contents: [{ parts: [{ text: AI_PROMPT + (hint ? '\n\nA rough machine reading of the same image, for reference (it may have errors):\n' + hint : '') }, { inline_data: { mime_type: m[1], data: m[3] } }] }],
                 generationConfig: { temperature: 0, response_mime_type: 'application/json' } };
  let res;
  try {
    res = await ctx.deps.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(key),
                               { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) { throw new Error('The AI reader could not be reached: ' + str((e && e.message) || e).slice(0, 120)); }
  const txt = await res.text();
  if (!res.ok) {
    if (res.status === 429) throw new Error('The AI reader is busy (its free allowance for the minute is used). Wait a little and press again.');
    throw new Error('The AI reader refused (' + res.status + '). ' + txt.slice(0, 160));
  }
  let out = '';
  try { const j = JSON.parse(txt); out = str(((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join('')); } catch (_) { out = txt; }
  let arr = null;
  try { arr = JSON.parse(out); } catch (_) { const s0 = out.indexOf('['), s1 = out.lastIndexOf(']'); if (s0 >= 0 && s1 > s0) { try { arr = JSON.parse(out.slice(s0, s1 + 1)); } catch (_2) { arr = null; } } }
  if (!Array.isArray(arr) || !arr.length) throw new Error('The AI reader found no product lines in the photo.');
  const records = arr.slice(0, 500).map((r, i) => ({ row: i + 1, code: str(r && r.code).slice(0, 40), text: str(r && r.name).slice(0, 200), qty: num(r && r.qty), price: num(r && r.price), currency: str(r && r.currency).toUpperCase().slice(0, 4) }))
                     .filter((r) => (r.text || r.code) && r.qty > 0);
  if (!records.length) throw new Error('The AI reader found no lines with a quantity.');
  return { kind: 'photo', reader: 'gemini', readsLeft: AI_DAILY - used - 1, ...(await matchRecords(ctx, records, { supplier: p.supplier, fileName: p.fileName })) };
}

/** The owner confirmed: this code / wording is that product. Next time it matches at once. */
export async function erpReceiveLearn(ctx, payload) {
  const pairs = Array.isArray(payload && payload.pairs) ? payload.pairs.slice(0, 500) : [];
  const source = str(payload && payload.supplier).slice(0, 80) || null;
  let saved = 0;
  for (const pr of pairs) {
    const alias = norm(pr && pr.alias).slice(0, 160), sku = str(pr && pr.sku).toLowerCase();
    if (!alias || !sku || alias.length < 3) continue;
    const prod = (await ctx.tx`select id from products where business_id = ${ctx.biz} and lower(btrim(sku)) = ${sku}`)[0];
    if (!prod) continue;
    await ctx.tx`insert into product_aliases (business_id, alias, product_id, source) values (${ctx.biz}, ${alias}, ${prod.id}, ${source})
                 on conflict (business_id, alias) do update set product_id = excluded.product_id, source = excluded.source`;
    saved++;
  }
  return { ok: true, saved };
}

export const HANDLERS = { erpReceiveMatch, erpReceiveRead, erpReceiveLearn };
