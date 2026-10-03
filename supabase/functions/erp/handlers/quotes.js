// Quotations, the business profile and the one-logo-per-business door
// (ERP.js:9104-9640, 10842-10868; spec 03 §3, spec 04 A4.1 item 1 + B14).
//
// A quotation is a document: nothing here touches stock or money. Tables:
//   quotations      one row per quotation; the whole document in `doc` (jsonb)
//                   instead of json1..json8 (45 000-char chunks)
//   quote_settings  key -> JSON: profile, settings, letterhead, snippets,
//                   assets (allowed image ids, last 200), seq:<PREFIX>
//   quote_items     saved items that are not in the product list
// Images (logo, signature, QR, trimmed logo) were Drive files in ERP_Assets;
// they are files in the 'assets' folder, and the ids the page gets are the
// storage ids ('assets/<kind>_<ms>.<ext>').

import { roleAtLeast } from '../allow.js';
import { lock, who } from './money.js';
import { getConfig, saveFile, readFile, renderPdf } from '../lib/ext.js';
import { todayStr, num } from '../lib/time.js';

// ------------------------------------------------------------------ helpers

/** erpQRound_: round half away from zero on the binary value. */
function qRound(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

/** erpQuoteTotals_ (ERP:9138): lines, subtotal, discount, VAT, shipping, advance. */
export function quoteTotals(q) {
  const items = q.items || [];
  const subtotal = qRound(items.reduce((s, i) => s + qRound(Number(i.qty) * Number(i.rate)), 0));
  const discount = qRound(Math.min(subtotal, q.discountType === 'Percent'
    ? subtotal * Number(q.discount) / 100 : Number(q.discount)));
  const tax = qRound((subtotal - discount) * Number(q.vat) / 100);
  const total = qRound(subtotal - discount + tax + Number(q.shipping));
  const advance = qRound(total * Number(q.advance) / 100);
  return { subtotal, discount, tax, total, advance, balance: qRound(total - advance) };
}

function qStr(v, max, label) {
  const s = String(v == null ? '' : v);
  if (s.length > max) throw new Error((label || 'A field') + ' is too long (at most ' + max + ' characters).');
  return s;
}
function qNum(v, lo, hi, label) {
  const n = Number(v);
  if (!isFinite(n) || n < lo || n > hi) throw new Error((label || 'A number') + ' must be between ' + lo + ' and ' + hi + '.');
  return n;
}
function qDate(s, label) {
  s = String(s || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error((label || 'A date') + ' is not a date.');
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Error((label || 'A date') + ' is not a real calendar date.');
  return s;
}
function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function uuid() { return globalThis.crypto.randomUUID(); }
function needRole(ctx, need) {                       // erpQRole_ (the door already checked)
  if (!roleAtLeast((ctx.s && ctx.s.role) || 'owner', need)) throw new Error('Your account cannot do that.');
}
const HEX = /^#[0-9a-fA-F]{6}$/;
const FONTS = /^(Arial|Georgia|Times New Roman|Verdana|Trebuchet MS|Tahoma)$/;
const CURRENCIES = /^(BDT|USD|EUR|GBP|INR)$/;

// ----------------------------------------------------- QUOTE_SETTINGS (key -> JSON)

/** erpQsRead_: every key of this business, memoised per call. */
async function qsRead(ctx) {
  if (!ctx.memo.qs) {
    const rows = await ctx.tx`select key, value from quote_settings where business_id = ${ctx.biz}`;
    const out = {};
    for (const r of rows) { const k = String(r.key || '').trim(); if (k) out[k] = r.value; }
    ctx.memo.qs = out;
  }
  return ctx.memo.qs;
}

/** erpQsWrite_: same 49 000-character limit per value as the sheet cell had. */
async function qsWrite(ctx, key, value) {
  const text = JSON.stringify(value);
  if (text.length > 49000) throw new Error('That is too long to save (' + text.length + ' characters).');
  await ctx.tx`insert into quote_settings (business_id, key, value)
               values (${ctx.biz}, ${key}, ${text}::text::jsonb)
               on conflict (business_id, key) do update set value = excluded.value`;
  if (ctx.memo.qs) ctx.memo.qs[key] = JSON.parse(text);
}

/**
 * erpQProfile_ (ERP:9211): the business identity documents are made in.
 * The first time, the name comes from SETTINGS business_name (here: the
 * business's config, else the business's own name - see docs/fixes/quotes.md).
 */
export async function quoteProfile(ctx) {
  const s = await qsRead(ctx);
  const p = { ...((s.profile && typeof s.profile === 'object') ? s.profile : {}) };
  if (!p.name) p.name = String(await getConfig(ctx, 'business_name', '') || '').trim() || String(ctx.s.businessName || '').trim();
  return { name: p.name || '', address: p.address || '', email: p.email || '', phone: p.phone || '',
           website: p.website || '', footer: p.footer || '', signer: p.signer || '', designation: p.designation || '',
           logoId: p.logoId || '', signatureId: p.signatureId || '', qrId: p.qrId || '', banks: p.banks || [],
           logoTrimId: p.logoTrimId || '' };
}

// Defaults ERP:9227-9229
export const QUOTE_DEFAULTS = { version: 0, prefix: 'QUO', currency: 'BDT', validDays: 15, autoNumber: true,
  theme: 'Signature', accent: '#dda51c', dark: '#303030', font: 'Arial', fontSize: 'Comfortable',
  productTerms: '', serviceTerms: '', mixedTerms: '' };

/** erpQSettings_ (ERP:9231): the quotation defaults. The invoice PDF reads accent/dark/font/currency from here. */
export async function quoteLook(ctx) {
  const s = (await qsRead(ctx)).settings || {};
  const out = {};
  for (const k of Object.keys(QUOTE_DEFAULTS)) out[k] = Object.prototype.hasOwnProperty.call(s, k) ? s[k] : QUOTE_DEFAULTS[k];
  return out;
}

const LH_DEFAULTS = { version: 0, style: 'Signature', accent: '#dda51c', dark: '#303030', font: 'Arial', logoSide: 'left' };
async function letterhead(ctx) {
  const s = (await qsRead(ctx)).letterhead || {};
  const out = {};
  for (const k of Object.keys(LH_DEFAULTS)) out[k] = Object.prototype.hasOwnProperty.call(s, k) ? s[k] : LH_DEFAULTS[k];
  return out;
}

// ----------------------------------------------------------------- images

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MIME_OF = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function b64decode(s) {
  const bin = atob(String(s || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A stored image by its id ('assets/<name>') as a data URL, or null if it cannot be read. */
async function readAsset(ctx, id) {
  const m = /^([^/]+)\/(.+)$/.exec(String(id || ''));
  if (!m) return null;
  let bytes = null;
  try { bytes = await readFile(ctx, m[1], m[2]); } catch (_) { bytes = null; }
  if (!bytes) return null;
  const ext = (/\.([A-Za-z0-9]+)$/.exec(m[2]) || [])[1] || '';
  const mime = MIME_OF[ext.toLowerCase()] || 'application/octet-stream';
  return 'data:' + mime + ';base64,' + b64encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/**
 * erpDocImg_ (ERP:11103): an image of THIS business as a data URL, '' when
 * there is none, it is not on the allow-list, or it cannot be read. For the
 * invoice PDF (logoTrimId || logoId, qrId).
 */
export async function assetDataUrl(ctx, id) {
  id = String(id || '');
  if (!id) return '';
  const known = (await qsRead(ctx)).assets || [];
  if (known.indexOf(id) < 0) return '';
  return (await readAsset(ctx, id)) || '';
}

// ------------------------------------------------------------------- boot

/** erpQuoteBoot (ERP:9244): everything the quotation screens need to start. */
async function erpQuoteBoot(ctx) {
  const role = (ctx.s && ctx.s.role) || 'owner';
  const s = await qsRead(ctx);
  const rows = await ctx.tx`select key, name, description, kind, unit, historical_rate, product_sku, requires_review
                            from quote_items where business_id = ${ctx.biz} order by seq`;
  const items = [];
  for (const r of rows) {
    if (!String(r.name || '').trim()) continue;
    items.push({ key: String(r.key ?? ''), name: String(r.name), description: String(r.description || ''),
                 kind: String(r.kind || 'Product'), unit: String(r.unit || 'unit'), historicalRate: num(r.historical_rate),
                 sku: String(r.product_sku || ''), review: String(r.requires_review) === 'yes' });
  }
  return { profile: await quoteProfile(ctx), settings: await quoteLook(ctx), letterhead: await letterhead(ctx),
           snippets: s.snippets || [], savedItems: items, today: todayStr(ctx.now),
           canSettings: roleAtLeast(role, 'shareholder'), canSnippets: roleAtLeast(role, 'manager') };
}

// ------------------------------------------------------------- list / get

function iso(d) { return d instanceof Date ? d.toISOString() : String(d ?? ''); }
function ymd(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? ''); }

/** erpQuoteList (ERP:9278): newest change first, searchable, filterable, 100 a page. */
async function erpQuoteList(ctx, payload) {
  payload = payload || {};
  const q = String(payload.search || '').trim().toLowerCase();
  const status = String(payload.status || 'All');
  const offset = Math.max(0, Math.round(num(payload.offset)));
  const rows = await ctx.tx`select id, reference, version, status, title, customer, kind, total, currency,
                                   issue_date, created_at, updated_at, created_by
                            from quotations where business_id = ${ctx.biz}
                            order by updated_at desc`;
  const all = rows.map((r) => ({
    id: String(r.id), reference: String(r.reference ?? ''), version: num(r.version), status: String(r.status ?? ''),
    title: String(r.title ?? ''), customer: String(r.customer ?? ''), kind: String(r.kind ?? ''), total: num(r.total),
    currency: String(r.currency ?? ''), issueDate: ymd(r.issue_date), createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at), createdBy: String(r.created_by ?? '') }));
  const counts = { total: all.length, draft: 0, ready: 0 };
  all.forEach((x) => { if (x.status === 'Ready') counts.ready++; else counts.draft++; });
  const list = all.filter((x) => {
    if (status !== 'All' && x.status !== status) return false;
    return !q || (x.reference + ' ' + x.title + ' ' + x.customer).toLowerCase().indexOf(q) >= 0;
  });
  return { rows: list.slice(offset, offset + 100), matched: list.length, offset, counts };
}

async function quoteRow(ctx, id) {
  const r = await ctx.tx`select * from quotations where business_id = ${ctx.biz} and id = ${id}`;
  return r[0] || null;
}
function docOf(row) {
  const d = row && row.doc;
  return d && typeof d === 'object' ? JSON.parse(JSON.stringify(d)) : null;
}

/** erpQuoteGet (ERP:9300). */
async function erpQuoteGet(ctx, payload) {
  const id = String((payload && payload.id) || '');
  const row = await quoteRow(ctx, id);
  if (!row) throw new Error('No such quotation.');
  const d = docOf(row);
  if (!d) throw new Error('That quotation could not be read.');
  d.version = num(row.version);
  return d;
}

// ------------------------------------------------------------------- save

/** erpQNormalise_ (ERP:9316): check and tidy; totals are worked out here, never trusted. */
export function normaliseQuote(q) {
  if (!q || typeof q !== 'object') throw new Error('Nothing to save.');
  const kinds = { Products: 1, Services: 1, Mixed: 1 };
  const out = {
    id: qStr(q.id, 64, 'Id'), number: qStr(q.number, 60, 'Reference').trim(),
    kind: kinds[q.kind] ? q.kind : 'Mixed', title: qStr(q.title, 300, 'Title'),
    customer: qStr(q.customer, 300, 'Customer'), contact: qStr(q.contact, 300, 'Contact'),
    email: qStr(q.email, 300, 'Email'), phone: qStr(q.phone, 300, 'Phone'),
    address: qStr(q.address, 1200, 'Address'),
    date: qDate(q.date, 'Issue date'), validUntil: qDate(q.validUntil, 'Valid until'),
    currency: CURRENCIES.test(q.currency) ? q.currency : 'BDT',
    discountType: q.discountType === 'Fixed' ? 'Fixed' : 'Percent',
    discount: qNum(q.discount || 0, 0, 1e9, 'Discount'), vat: qNum(q.vat || 0, 0, 100, 'VAT'),
    shipping: qNum(q.shipping || 0, 0, 1e9, 'Delivery charge'), advance: qNum(q.advance || 0, 0, 100, 'Advance'),
    terms: qStr(q.terms, 12000, 'Terms'), notes: qStr(q.notes, 4000, 'Notes'),
    showBank: q.showBank !== false, showSignature: q.showSignature !== false, useSignature: !!q.useSignature,
    bankIds: Array.isArray(q.bankIds) ? q.bankIds.map(String).slice(0, 20) : [],
    theme: /^(Signature|Executive|Minimal)$/.test(q.theme) ? q.theme : 'Signature',
    accent: HEX.test(q.accent) ? q.accent : '#dda51c',
    dark: HEX.test(q.dark) ? q.dark : '#303030',
    font: FONTS.test(q.font) ? q.font : 'Arial',
    fontSize: q.fontSize === 'Compact' ? 'Compact' : 'Comfortable',
    autoNumber: q.autoNumber !== false, status: q.status === 'Ready' ? 'Ready' : 'Draft',
    company: q.company || null, createdAt: q.createdAt || '',
  };
  if (out.discountType === 'Percent' && out.discount > 100) throw new Error('Discount cannot exceed 100%.');
  if (out.validUntil < out.date) throw new Error('Validity date must be on or after the issue date.');
  const items = Array.isArray(q.items) ? q.items : [];
  if (items.length > 150) throw new Error('A quotation can hold at most 150 items.');
  out.items = items.map((i, n) => {
    i = i || {};
    const it = {
      id: qStr(i.id || ('i' + n), 64, 'Item id'), sku: qStr(i.sku || '', 80, 'Item code'),
      name: qStr(i.name, 300, 'Item name'), description: qStr(i.description, 1200, 'Item description'),
      kind: i.kind === 'Service' ? 'Service' : 'Product',
      qty: qNum(i.qty, 0, 1e9, 'Quantity'), unit: qStr(i.unit || '', 300, 'Unit'),
      rate: qNum(i.rate, 0, 1e9, 'Rate'),
    };
    it.amount = qRound(it.qty * it.rate);
    return it;
  });
  return out;
}

function readiness(q) {
  const e = [];
  if (!String(q.title || '').trim()) e.push('Project title is required.');
  if (!q.items.length) e.push('Add at least one item.');
  if (q.items.some((i) => !String(i.name).trim() || !(i.qty > 0))) e.push('Each item needs a name and a quantity above zero.');
  if (q.validUntil < q.date) e.push('Validity date must not be earlier than the issue date.');
  if (!q.autoNumber && !q.number) e.push('Enter a quotation number.');
  return e;
}

/** erpQCompanySnapshot_ (ERP:9370): who is quoting, as they are now. */
async function companySnapshot(ctx, bankIds) {
  const p = await quoteProfile(ctx);
  if (!String(p.name).trim()) throw new Error('Set the business name in Quotations → Settings before saving a quotation.');
  const banks = (p.banks || []).filter((b) => !bankIds.length || bankIds.indexOf(String(b.id)) >= 0);
  return { name: p.name, address: p.address, email: p.email, phone: p.phone, website: p.website, footer: p.footer,
           signer: p.signer, designation: p.designation, logoId: p.logoId, signatureId: p.signatureId, qrId: p.qrId || '',
           banks: banks.map((b) => ({ id: b.id, bank: b.bank, name: b.name, number: b.number, branch: b.branch, extra: b.extra || '' })),
           takenAt: ctx.now.toISOString() };
}

async function referenceTaken(ctx, number, id) {
  const r = await ctx.tx`select 1 from quotations where business_id = ${ctx.biz}
                         and lower(coalesce(reference, '')) = ${number.toLowerCase()} and id <> ${id} limit 1`;
  return !!r[0];
}

/**
 * erpQuoteSave (ERP:9389): { quote, expectedVersion, saveKey, refreshIdentity }.
 * expectedVersion 0 = new; another version stored = someone saved in between.
 * The same saveKey twice returns what the first press saved.
 */
async function erpQuoteSave(ctx, payload) {
  needRole(ctx, 'sales');
  payload = payload || {};
  const q = normaliseQuote(payload.quote);
  const expected = Math.round(num(payload.expectedVersion));
  const key = String(payload.saveKey || '');
  if (q.status === 'Ready') {
    const errs = readiness(q);
    if (errs.length) throw new Error(errs.join(' '));
  }
  await lock(ctx, 'quotes');
  const at = await quoteRow(ctx, q.id);

  if (at && key && String(at.save_key ?? '') === key) {     // the same press, arriving twice
    const same = docOf(at); same.version = num(at.version);
    return { quote: same, repeated: true };
  }
  const current = at ? num(at.version) : 0;
  if (current !== expected) {
    throw new Error('CONFLICT: this quotation was changed by someone else (' + (at ? String(at.updated_by ?? '') : '') +
                    ') after you opened it. Your copy is kept here - reopen it to see theirs.');
  }
  const old = at ? docOf(at) : null;

  // identity: taken once, kept, and only refreshed when asked
  if (!old || payload.refreshIdentity || !old.company) q.company = await companySnapshot(ctx, q.bankIds);
  else q.company = old.company;

  // the reference: given once, on the first save, and never changed after
  if (old && old.number) q.number = old.number;
  else if (q.autoNumber || !q.number) {
    const s = await quoteLook(ctx);
    let counter = Number((await qsRead(ctx))['seq:' + s.prefix] || 0);
    // Fix (docs/fixes/quotes.md): skip a number someone already typed by hand.
    for (;;) {
      counter += 1;
      q.number = s.prefix + '-' + q.date.slice(0, 4) + '-' + String(counter).padStart(5, '0');
      if (!(await referenceTaken(ctx, q.number, q.id))) break;
    }
    await qsWrite(ctx, 'seq:' + s.prefix, counter);
  }
  // a hand-typed reference must be unique
  if (await referenceTaken(ctx, q.number, q.id)) {
    throw new Error('The reference ' + q.number + ' is already used by another quotation.');
  }

  const now = ctx.now.toISOString(), me = who(ctx);
  q.createdAt = old && old.createdAt ? old.createdAt : now;
  q.updatedAt = now;
  q.totals = quoteTotals(q);
  const version = current + 1;
  const text = JSON.stringify(q);
  if (text.length > 8 * 45000) throw new Error('This quotation is too large to save.');
  if (at) {
    await ctx.tx`update quotations set reference = ${q.number}, version = ${version}, status = ${q.status},
                   title = ${q.title}, customer = ${q.customer}, kind = ${q.kind}, total = ${q.totals.total},
                   currency = ${q.currency}, issue_date = ${q.date}, updated_at = ${ctx.now},
                   updated_by = ${me}, save_key = ${key}, doc = ${text}::text::jsonb
                 where business_id = ${ctx.biz} and id = ${q.id}`;
  } else {
    await ctx.tx`insert into quotations (id, business_id, reference, version, status, title, customer, kind, total,
                   currency, issue_date, created_at, updated_at, created_by, updated_by, save_key, doc)
                 values (${q.id}, ${ctx.biz}, ${q.number}, ${version}, ${q.status}, ${q.title}, ${q.customer},
                   ${q.kind}, ${q.totals.total}, ${q.currency}, ${q.date}, ${ctx.now}, ${ctx.now}, ${me}, ${me},
                   ${key}, ${text}::text::jsonb)`;
  }
  q.version = version;
  return { quote: q };
}

/** erpQuoteDuplicate (ERP:9459): new id, no number, dates from today. */
async function erpQuoteDuplicate(ctx, payload) {
  const q = await erpQuoteGet(ctx, payload);
  const s = await quoteLook(ctx);
  const today = todayStr(ctx.now);
  q.id = uuid(); q.number = ''; q.createdAt = ''; q.updatedAt = ''; q.status = 'Draft'; q.version = 0;
  q.date = today; q.validUntil = addDays(today, s.validDays); q.autoNumber = s.autoNumber;
  q.company = null;                                    // identity is taken fresh when it is saved
  delete q.totals;
  return q;
}

// --------------------------------------------------------------- settings

/** erpQuoteSettingsSave (ERP:9470): a field left out keeps its current value. */
async function erpQuoteSettingsSave(ctx, payload) {
  needRole(ctx, 'shareholder');
  await lock(ctx, 'quote_settings');
  const cur = await quoteLook(ctx);
  const s = Object.assign({}, cur, (payload && payload.settings) || {});
  if (Math.round(num(payload.expectedVersion)) !== cur.version) throw new Error('CONFLICT: settings were changed by someone else. Reload them first.');
  const out = {
    version: cur.version + 1,
    prefix: /^[A-Za-z0-9-]{1,15}$/.test(s.prefix) ? s.prefix : (() => { throw new Error('Prefix: letters, numbers and - only, up to 15.'); })(),
    currency: CURRENCIES.test(s.currency) ? s.currency : 'BDT',
    validDays: qNum(Math.round(Number(s.validDays)), 0, 365, 'Validity days'),
    autoNumber: s.autoNumber !== false,
    theme: /^(Signature|Executive|Minimal)$/.test(s.theme) ? s.theme : 'Signature',
    accent: HEX.test(s.accent) ? s.accent : '#dda51c',
    dark: HEX.test(s.dark) ? s.dark : '#303030',
    font: FONTS.test(s.font) ? s.font : 'Arial',
    fontSize: s.fontSize === 'Compact' ? 'Compact' : 'Comfortable',
    productTerms: qStr(s.productTerms, 12000, 'Product terms'),
    serviceTerms: qStr(s.serviceTerms, 12000, 'Service terms'),
    mixedTerms: qStr(s.mixedTerms, 12000, 'Mixed terms'),
  };
  await qsWrite(ctx, 'settings', out);
  return out;
}

/** erpQuoteProfileSave (ERP:9497): bank accounts keep a stable id. */
async function erpQuoteProfileSave(ctx, payload) {
  needRole(ctx, 'shareholder');
  await lock(ctx, 'quote_settings');
  const p = (payload && payload.profile) || {}, cur = await quoteProfile(ctx);
  const name = qStr(p.name, 300, 'Business name').trim();
  if (!name) throw new Error('The business name is required.');
  const banks = (Array.isArray(p.banks) ? p.banks : []).slice(0, 12).map((b) => {
    b = b || {};
    return { id: String(b.id || uuid()).slice(0, 64), bank: qStr(b.bank, 120, 'Bank name').trim(),
             name: qStr(b.name, 200, 'Account name'), number: qStr(b.number, 80, 'Account number'),
             branch: qStr(b.branch, 200, 'Branch'), extra: qStr(b.extra, 400, 'Bank note') };
  }).filter((b) => b.bank || b.number);
  const out = { name, address: qStr(p.address, 1200, 'Address'), email: qStr(p.email, 300, 'Email'),
                phone: qStr(p.phone, 300, 'Phone'), website: qStr(p.website, 300, 'Website'),
                footer: qStr(p.footer, 400, 'Footer'), signer: qStr(p.signer, 300, 'Signatory'),
                designation: qStr(p.designation, 300, 'Title'), logoId: cur.logoId, signatureId: cur.signatureId, qrId: cur.qrId || '',
                logoTrimId: cur.logoTrimId || '', banks };
  if (p.clearLogo) { out.logoId = ''; out.logoTrimId = ''; }
  if (p.clearSignature) out.signatureId = '';
  if (p.clearQr) out.qrId = '';
  await qsWrite(ctx, 'profile', out);
  return out;
}

/**
 * erpQuoteAssetUpload (ERP:9522): a logo, signature, payment-QR or trimmed
 * logo. Each upload is a new file, so old quotations keep theirs.
 */
async function erpQuoteAssetUpload(ctx, payload) {
  needRole(ctx, 'shareholder');
  payload = payload || {};
  const kind = payload.kind === 'signature' ? 'signature' : payload.kind === 'qr' ? 'qr' : payload.kind === 'logoTrim' ? 'logoTrim' : 'logo';
  const mime = String(payload.mime || '');
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) throw new Error('Use a PNG, JPEG or WebP image.');
  let bytes;
  try { bytes = b64decode(payload.data); } catch (_) { throw new Error('That image could not be read.'); }
  if (bytes.length > 1024 * 1024) throw new Error('The image is over 1 MB. Use a smaller one.');
  await lock(ctx, 'quote_settings');
  const f = await saveFile(ctx, 'assets', kind + '_' + ctx.now.getTime() + '.' + EXT[mime], bytes, mime);
  const p = await quoteProfile(ctx);
  // a new logo makes the old cropped copy wrong; the browser sends a fresh one straight after
  if (kind === 'logo') { p.logoId = f.id; p.logoTrimId = ''; }
  else if (kind === 'logoTrim') p.logoTrimId = f.id;
  else if (kind === 'qr') p.qrId = f.id; else p.signatureId = f.id;
  await qsWrite(ctx, 'profile', p);
  const known = ((await qsRead(ctx)).assets || []).slice();
  known.push(f.id);
  await qsWrite(ctx, 'assets', known.slice(-200));
  return { id: f.id, profile: p };
}

/** erpQuoteAsset (ERP:9548): an image this business uploaded, as a data URL. */
async function erpQuoteAsset(ctx, payload) {
  const id = String((payload && payload.id) || '');
  if (!id) return { data: '' };
  const known = (await qsRead(ctx)).assets || [];
  if (known.indexOf(id) < 0) throw new Error('That image does not belong to this business.');
  const data = await readAsset(ctx, id);
  // a picture that was never uploaded (or was removed) is simply not shown - not an error
  if (!data) return { data: '', missing: true };
  return { data };
}

/** erpLetterheadSave (ERP:9570). */
async function erpLetterheadSave(ctx, payload) {
  needRole(ctx, 'shareholder');
  await lock(ctx, 'quote_settings');
  const d = (payload && payload.letterhead) || {}, cur = await letterhead(ctx);
  if (Math.round(num(payload.expectedVersion)) !== cur.version) throw new Error('CONFLICT: the letterhead was changed by someone else. Reload it first.');
  const out = { version: cur.version + 1,
    style: /^(Signature|Band|Minimal|Centered)$/.test(d.style) ? d.style : 'Signature',
    accent: HEX.test(d.accent) ? d.accent : '#dda51c',
    dark: HEX.test(d.dark) ? d.dark : '#303030',
    font: FONTS.test(d.font) ? d.font : 'Arial',
    logoSide: d.logoSide === 'right' ? 'right' : 'left' };
  await qsWrite(ctx, 'letterhead', out);
  return out;
}

/** erpQuoteSnippetsSave (ERP:9586): the conditions library. */
async function erpQuoteSnippetsSave(ctx, payload) {
  needRole(ctx, 'manager');
  const list = (Array.isArray(payload && payload.snippets) ? payload.snippets : []).slice(0, 200).map((s) => {
    s = s || {};
    const t = qStr(s.title, 300, 'Title').trim();
    if (!t) throw new Error('Every condition needs a title.');
    return { id: String(s.id || uuid()).slice(0, 64), title: t, text: qStr(s.text, 12000, 'Condition text') };
  });
  await lock(ctx, 'quote_settings');
  await qsWrite(ctx, 'snippets', list);
  return list;
}

/**
 * erpQuoteItemsImport (ERP:9605): add reviewed items to the saved-items list;
 * an item already saved (same key or same name) is updated, never added twice.
 */
async function erpQuoteItemsImport(ctx, payload) {
  needRole(ctx, 'shareholder');
  const items = (payload && payload.items) || [];
  await lock(ctx, 'quote_items');
  const rows = await ctx.tx`select id, key, name from quote_items where business_id = ${ctx.biz} order by seq`;
  const have = {};
  for (const r of rows) {
    have['k:' + String(r.key ?? '')] = r.id;
    have['n:' + String(r.name ?? '').trim().toLowerCase()] = r.id;
  }
  let added = 0, updated = 0;
  const me = who(ctx);
  for (const it0 of items) {
    const it = it0 || {};
    const name = qStr(it.name, 300, 'Item name').trim();
    if (!name) continue;
    const key = String(it.catalogKey || it.key || name).slice(0, 80);
    const row = { key, name, description: qStr(it.description || '', 1200, 'Description'),
      kind: it.kind === 'Service' ? 'Service' : 'Product', unit: qStr(it.unit || 'unit', 60, 'Unit'),
      historical_rate: num(it.historicalRate), product_sku: String(it.sku || ''),
      requires_review: it.requiresReview === false ? 'no' : 'yes', source: qStr(it.provenance || 'import', 200, 'Source') };
    const at = have['k:' + key] || have['n:' + name.toLowerCase()];
    if (at) {
      await ctx.tx`update quote_items set key = ${row.key}, name = ${row.name}, description = ${row.description},
                     kind = ${row.kind}, unit = ${row.unit}, historical_rate = ${row.historical_rate},
                     product_sku = ${row.product_sku}, requires_review = ${row.requires_review},
                     source = ${row.source}, added_at = ${ctx.now}, added_by = ${me}
                   where id = ${at} and business_id = ${ctx.biz}`;
      updated++;
    } else {
      const r = await ctx.tx`insert into quote_items (business_id, key, name, description, kind, unit, historical_rate,
                               product_sku, requires_review, source, added_at, added_by)
                             values (${ctx.biz}, ${row.key}, ${row.name}, ${row.description}, ${row.kind}, ${row.unit},
                               ${row.historical_rate}, ${row.product_sku}, ${row.requires_review}, ${row.source},
                               ${ctx.now}, ${me}) returning id`;
      added++;
      have['k:' + key] = r[0].id; have['n:' + name.toLowerCase()] = r[0].id;
    }
  }
  return { added, updated };
}

// ----------------------------------------------------- one logo per business

/** erpBrandLogo (ERP:10842): `have` = the id the browser already holds. */
async function erpBrandLogo(ctx, payload) {
  const prof = await quoteProfile(ctx), id = String(prof.logoId || '');
  if (!id) return { id: '', data: '' };
  if (payload && String(payload.have || '') === id) return { id, data: null, trim: !!prof.logoTrimId };
  const known = (await qsRead(ctx)).assets || [];
  if (known.indexOf(id) < 0) return { id: '', data: '' };
  const data = await readAsset(ctx, id);
  if (!data) return { id: '', data: '' };
  return { id, data, trim: !!prof.logoTrimId };
}

/** erpBrandLogoClear (ERP:10859): saved quotations keep the logo they were made with. */
async function erpBrandLogoClear(ctx) {
  needRole(ctx, 'shareholder');
  await lock(ctx, 'quote_settings');
  const p = await quoteProfile(ctx);
  p.logoId = ''; p.logoTrimId = '';
  await qsWrite(ctx, 'profile', p);
  return { ok: true, profile: p };
}

/**
 * The quotation as a PDF, kept with the business's files (and so copied to Google
 * Drive when it is connected). The page sends the pages exactly as they print.
 */
async function erpQuotePdfSave(ctx, payload) {
  payload = payload || {};
  const row = await quoteRow(ctx, String(payload.id || ''));
  if (!row) throw new Error('That quotation was not found. Save it first.');
  const html = String(payload.html || '');
  if (!html || html.length > 6e6) throw new Error('The quotation could not be turned into a PDF.');
  const bytes = await renderPdf(ctx, html, {});
  const name = 'Quotation_' + String(row.reference || row.id).replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) + '.pdf';
  const f = await saveFile(ctx, 'quotes', name, bytes, 'application/pdf');
  return { ok: true, name, url: f.url };
}

export const HANDLERS = {
  erpQuotePdfSave,
  erpQuoteBoot, erpQuoteList, erpQuoteGet, erpQuoteSave, erpQuoteDuplicate,
  erpQuoteAsset, erpQuoteAssetUpload, erpQuoteProfileSave, erpQuoteSettingsSave,
  erpLetterheadSave, erpQuoteSnippetsSave, erpQuoteItemsImport, erpBrandLogo, erpBrandLogoClear,
};
