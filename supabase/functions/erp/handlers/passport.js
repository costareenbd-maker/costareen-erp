// Stage N1 (docs/NETWORK-BLUEPRINT.md section 5): the Printer Passport register and the customer page.
//
// The register lives in the provider's control tables (deps.control), like the market. The seller's ERP writes to it
// by itself: a sale with a serial number (sellSerials), a return (returnSerials), a warranty change
// (erpSerialWarranty), a repair job (repairs.js). Nothing in here can stop a sale: every write is wrapped by its caller.
//
// Public (no sign-in, index.ts ?pub=...):
//   GET ?pub=check&s=<serial>          what the register holds for that serial (never the buyer)
//   GET ?pub=my&t=<token>              a customer's page: his invoices, dues, parcels, warranties, reorder
//   GET ?pub=my&t=<token>&pdf=<no>     a short-lived link to one of his invoice PDFs
// Signed in:
//   erpWarrantyCard({serial, sku})     the printable card: product, serial, warranty, the check QR, the seller
//   erpMyLink({phone, name})           the customer's page link, for WhatsApp
//   erpPassportSync()                  manager: write every sold serial of this business into the register
//   erpPassportShowSeller({on})        owner: show the shop's name on the register, or only "Supplier · city"

import { formatDate, num, dhakaDayStart } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';
import { custKey } from '../lib/phone.js';
import { salesLog, SL, asDate } from '../lib/tabs.js';
import { findFiles } from '../lib/ext.js';
import { sourceOf } from './market.js';
import { qrDataUrl } from '../lib/qr.js';

const str = (v) => String(v == null ? '' : v).trim();
const clean = (v) => str(v).replace(/\s+/g, '').toUpperCase();
const norm = (v) => clean(v).replace(/[^A-Z0-9]/g, '');
const day = (d) => (d ? formatDate(new Date(d), 'yyyy-MM-dd') : '');
const month = (d) => (d ? formatDate(new Date(d), 'MMM yyyy') : '');
const DAY = 86400e3;
const enc = new TextEncoder();

// ---------------------------------------------------------------- where the public pages are
/** The neutral address of the register (check page) and the customer page's address for this business. */
export function pubBase(deps) {
  const env = (deps && deps.installEnv) || {};
  const own = str((deps && deps.google && deps.google.appUrl) || env.appUrl) || 'https://erp.costareen.com/';
  const neutral = str(env.publicUrl) || own;
  const slash = (u) => (u.endsWith('/') ? u : u + '/');
  const bridged = !!(deps && deps.install && deps.install.bridged);
  return { check: slash(neutral) + 'check', my: slash(bridged ? neutral : own) + 'my' };
}
export const checkUrl = (deps, serial) => pubBase(deps).check + '?s=' + encodeURIComponent(clean(serial));

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
/** A customer's token: derived from the provider's secret, so every invoice gets the same link without storing a secret. */
async function tokenFor(deps, source, biz, key) {
  const secret = str(deps && (deps.bridgeKey || deps.pubSecret)) || 'local-test-secret';
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode('my|' + source + '|' + biz + '|' + key)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
}

// ---------------------------------------------------------------- the seller as the register shows it
async function sellerInfo(ctx) {
  let name = str(ctx.s && ctx.s.businessName);
  try { const S = await import('./sales.js'); const p = await S.qProfile(ctx); if (str(p.name)) name = str(p.name); } catch (_) { /* the business name */ }
  const rows = await ctx.tx`select key, value from business_config where business_id = ${ctx.biz} and key in ('market_city', 'passport_show_seller')`;
  const m = Object.fromEntries(rows.map((r) => [r.key, str(r.value)]));
  return { name, city: m.market_city || '', show: m.passport_show_seller !== '0' };
}
const versionOf = (name) => (/\b(chin(a|ese)|cn)\b/i.test(name) ? 'china' : /\b(global|gl)\b/i.test(name) ? 'global' : '');

// ---------------------------------------------------------------- writes from the seller's ERP
/** units: [{serial, sku, name, brand, category, warrantyMonths, warrantyUntil}] sold on one invoice. */
export async function passportSold(ctx, { invoiceNo, customerKey, at, units }) {
  const src = sourceOf(ctx.deps); if (!src || !units.length) return 0;
  const ctl = ctx.deps.control, who = await sellerInfo(ctx);
  const soldAt = formatDate(at || ctx.now, 'yyyy-MM-dd');
  const transferable = {};
  for (const r of await ctx.tx`select sku, warranty_transferable from products where business_id = ${ctx.biz} and lower(btrim(sku)) = any(${units.map((u) => str(u.sku).toLowerCase())})`) transferable[str(r.sku).toLowerCase()] = r.warranty_transferable !== false;
  let n = 0;
  for (const u of units) {
    const sn = norm(u.serial); if (!sn) continue;
    const row = {
      serial_norm: sn, serial: clean(u.serial), source: src, business_id: ctx.biz, seller_name: who.name, seller_city: who.city || null, show_seller: who.show,
      product_name: str(u.name) || str(u.sku), brand: str(u.brand) || null, category: str(u.category) || null, sku: str(u.sku), version: versionOf(str(u.name)),
      sold_at: soldAt, invoice_no: str(invoiceNo) || null, customer_key: str(customerKey) || null,
      warranty_months: u.warrantyMonths > 0 ? Math.round(num(u.warrantyMonths)) : null, warranty_until: u.warrantyUntil || null,
      transferable: transferable[str(u.sku).toLowerCase()] !== false, status: 'sold', level: 'verified',
    };
    const cols = Object.keys(row);
    const got = await ctl`insert into erp_passports ${ctl(row, ...cols)}
                          on conflict (source, business_id, serial_norm) do update set ${ctl({ ...row, updated_at: new Date() }, ...cols, 'updated_at')} returning id`;
    await ctl`insert into erp_passport_events (passport_id, kind, detail) values (${got[0].id}, 'sold', ${ctl.json({ month: month(soldAt), warranty_until: row.warranty_until })})`;
    n++;
  }
  return n;
}
async function mine(ctx, serial) {
  const src = sourceOf(ctx.deps); if (!src) return null;
  const sn = norm(serial); if (!sn) return null;
  return (await ctx.deps.control`select id, status from erp_passports where source = ${src} and business_id = ${ctx.biz} and serial_norm = ${sn}`)[0] || null;
}
export async function passportReturned(ctx, serials, invoiceNo) {
  for (const s of serials) {
    const p = await mine(ctx, s); if (!p) continue;
    await ctx.deps.control`update erp_passports set status = 'returned', updated_at = now() where id = ${p.id}`;
    await ctx.deps.control`insert into erp_passport_events (passport_id, kind, detail) values (${p.id}, 'returned', ${ctx.deps.control.json({ month: month(ctx.now), invoice_no: str(invoiceNo) })})`;
  }
}
export async function passportWarranty(ctx, serial, until, months) {
  const p = await mine(ctx, serial); if (!p) return;
  await ctx.deps.control`update erp_passports set warranty_until = ${until || null}, warranty_months = ${months > 0 ? months : null}, updated_at = now() where id = ${p.id}`;
  await ctx.deps.control`insert into erp_passport_events (passport_id, kind, detail) values (${p.id}, 'warranty', ${ctx.deps.control.json({ month: month(ctx.now), until: until || '' })})`;
}
/** A repair job on a serial: 'received' when it comes in, 'returned' when it goes back. The job number stays private. */
export async function passportRepair(ctx, serial, jobNo, status) {
  const p = await mine(ctx, serial); if (!p) return;
  await ctx.deps.control`insert into erp_passport_events (passport_id, kind, detail) values (${p.id}, 'repair', ${ctx.deps.control.json({ month: month(ctx.now), job: str(jobNo), status: str(status) })})`;
}

// ---------------------------------------------------------------- public: the check
async function limit(deps, ip, kind, max) {
  const ctl = deps.control; if (!ctl || !ip) return;
  await ctl`delete from erp_pub_hits where at < now() - interval '2 hours'`;
  const n = (await ctl`select count(*)::int as n from erp_pub_hits where ip = ${ip} and kind = ${kind} and at > now() - interval '1 hour'`)[0].n;
  if (n >= max) throw new Error('Too many requests from this connection. Try again in an hour.');
  await ctl`insert into erp_pub_hits (ip, kind) values (${ip}, ${kind})`;
}
function warrantyWords(until, now) {
  if (!until) return { state: 'none', days: null };
  const end = dhakaDayStart(day(until)).getTime() + DAY - 1;
  const left = Math.ceil((end - now.getTime()) / DAY);
  return { state: left > 0 ? 'active' : 'ended', days: left };
}
export async function checkSerial(deps, serial, ip) {
  const sn = norm(serial);
  if (sn.length < 3) throw new Error('Type the serial number (at least 3 letters or digits).');
  await limit(deps, ip, 'check', 60);
  const ctl = deps.control;
  const rows = await ctl`select p.*, (select count(distinct e.detail->>'job')::int from erp_passport_events e where e.passport_id = p.id and e.kind = 'repair') as repairs,
                                (select max(e.at) from erp_passport_events e where e.passport_id = p.id and e.kind = 'repair') as last_repair
                           from erp_passports p where p.serial_norm = ${sn} order by p.sold_at desc nulls last limit 5`;
  if (!rows.length) return { serial: sn, found: false, records: [] };
  const now = new Date();
  const sellers = new Set(rows.filter((r) => r.status === 'sold').map((r) => r.source + '/' + r.business_id));
  const disputed = sellers.size > 1;
  const records = [];
  for (const r of rows) {
    const w = warrantyWords(r.warranty_until, now);
    const ev = await ctl`select kind, at, detail from erp_passport_events where passport_id = ${r.id} order by at asc limit 50`;
    records.push({
      product: str(r.product_name), brand: str(r.brand), category: str(r.category), version: str(r.version),
      seller: r.show_seller && str(r.seller_name) ? str(r.seller_name) : 'Supplier' + (str(r.seller_city) ? ' · ' + str(r.seller_city) : ''),
      city: str(r.seller_city), named: !!(r.show_seller && str(r.seller_name)),
      soldMonth: month(r.sold_at), warrantyUntil: day(r.warranty_until), warrantyMonths: r.warranty_months == null ? null : num(r.warranty_months),
      warrantyState: w.state, daysLeft: w.days, transferable: r.transferable !== false,
      status: str(r.status), level: str(r.level), disputed,
      repairs: num(r.repairs), lastRepair: month(r.last_repair),
      events: ev.map((e) => ({ kind: e.kind, month: month(e.at), status: e.detail && e.detail.status ? str(e.detail.status) : '' })),
    });
  }
  return { serial: sn, found: true, records };
}

// ---------------------------------------------------------------- the customer page
export async function ensureLink(ctx, key) {
  const src = sourceOf(ctx.deps); if (!src || !str(key) || str(key) === 'n:') return null;
  const token = await tokenFor(ctx.deps, src, ctx.biz, str(key));
  await ctx.deps.control`insert into erp_customer_links (token_hash, source, business_id, customer_key) values (${await sha256hex(token)}, ${src}, ${ctx.biz}, ${str(key)}) on conflict (token_hash) do nothing`;
  return { token, url: pubBase(ctx.deps).my + '?t=' + token };
}
/** The QR for an invoice PDF: the customer's page (empty for a walk-in with no name and no phone). */
export async function myQrFor(ctx, phone, name) {
  try {
    const key = custKey(phone, name);
    if (!key || key === 'n:') return '';
    const l = await ensureLink(ctx, key);
    return l ? qrDataUrl(l.url) : '';
  } catch (_) { return ''; }
}
const COURIER_WORDS = { pending: 'With the courier', delivered_approval_pending: 'Delivered', partial_delivered_approval_pending: 'Partly delivered', cancelled_approval_pending: 'Cancelled',
  unknown_approval_pending: 'Being checked', delivered: 'Delivered', partial_delivered: 'Partly delivered', cancelled: 'Cancelled', hold: 'On hold', in_review: 'In review', unknown: 'Being checked' };

async function pageData(ctx, key, deps0) {
  const S = await import('./sales.js'), M = await import('./money.js');
  const p = await S.qProfile(ctx);
  const seller = { name: str(p.name) || str(ctx.s.businessName), phone: str(p.phone), address: str(p.address), website: str(p.website), email: str(p.email), logo: '' };
  try { seller.logo = (await S.docImg(ctx, p.logoTrimId)) || (await S.docImg(ctx, p.logoId)) || ''; } catch (_) { seller.logo = ''; }
  // his invoices, read the way the statement reads them
  const sl = await salesLog(ctx), same = M.sameOrder(sl), inv = {};
  let name = '', phone = '';
  for (const row of sl) {
    const rawId = str(row[SL.order_id]);
    if (!rawId || /^RTN-/.test(rawId)) continue;
    if (custKey(String(row[SL.customer_contact] || ''), String(row[SL.customer_name] || '')) !== key) continue;
    const id = same[rawId] || rawId;
    const o = inv[id] || (inv[id] = { no: id, when: asDate(row[SL.timestamp]), grand: 0, items: [], delivery: str(row[SL.customer_source]) });
    o.grand = Math.max(o.grand, num(row[SL.grand_total]));
    o.items.push({ name: str(row[SL.product_name]), qty: num(row[SL.quantity]) });
    name = str(row[SL.customer_name]) || name; phone = str(row[SL.customer_contact]) || phone;
  }
  const list = Object.values(inv).sort((a, b) => (b.when ? b.when.getTime() : 0) - (a.when ? a.when.getTime() : 0)).slice(0, 30);
  const parcels = {};
  for (const r of await ctx.tx`select distinct on (invoice_no) invoice_no, consignment_id, booked_at from courier_log where business_id = ${ctx.biz} and invoice_no = any(${list.map((x) => x.no)}) order by invoice_no, booked_at desc`) parcels[r.invoice_no] = { cid: str(r.consignment_id), when: r.booked_at };
  let calls = 0, sfCall = null;
  try { sfCall = (await import('./courier.js')).sfCall; } catch (_) { sfCall = null; }
  const invoices = [];
  let totalDue = 0;
  for (const o of list) {
    const owe = await M.outstanding(ctx, o.no);
    const paid = owe ? num(owe.paid) : 0, due = owe ? Math.max(0, Math.round(num(owe.owed))) : 0;
    totalDue += due;
    let parcel = null;
    const pc = parcels[o.no];
    if (pc && pc.cid) {
      parcel = { consignment: pc.cid, status: '', label: 'Booked with the courier' };
      // the courier is asked only for the newest few parcels (keeps a public page from hammering it)
      if (sfCall && calls < 3 && pc.when && Date.now() - new Date(pc.when).getTime() < 45 * DAY) {
        calls++;
        try { const s = await sfCall(ctx, 'GET', '/status_by_cid/' + encodeURIComponent(pc.cid), null); parcel.status = str(s && s.delivery_status); } catch (_) { parcel.status = ''; }
        if (parcel.status) parcel.label = COURIER_WORDS[parcel.status] || parcel.status.replace(/_/g, ' ');
      }
    }
    invoices.push({ no: o.no, date: o.when ? formatDate(o.when, 'd MMM yyyy') : '', total: Math.round(o.grand), paid: Math.round(paid), due,
      status: due > 0 ? 'Due' : 'Paid', delivery: o.delivery, items: o.items.slice(0, 12), parcel });
  }
  const warr = await ctx.tx`select s.serial, s.sku, s.sold_at, s.warranty_until, s.invoice_no, p.name from serials s join products p on p.id = s.product_id
                            where s.business_id = ${ctx.biz} and s.status = 'sold' and s.customer_key = ${key} order by s.sold_at desc limit 50`;
  const now = ctx.now;
  const warranties = warr.map((w) => { const x = warrantyWords(w.warranty_until, now); return { serial: str(w.serial), product: str(w.name), sold: day(w.sold_at), invoiceNo: str(w.invoice_no), until: day(w.warranty_until), state: x.state, daysLeft: x.days, check: checkUrl(ctx.deps, w.serial) }; });
  const last = list[0];
  const reorder = last ? last.items.map((i) => i.qty + ' x ' + i.name).join(', ') : '';
  const wa = seller.phone.replace(/[^0-9]/g, '');
  return { seller, customer: { name, phone }, invoices, totalDue: Math.round(totalDue), warranties,
    reorder: { text: reorder, whatsapp: wa ? 'https://wa.me/' + (wa.startsWith('0') ? '88' + wa : wa) : '' }, deps0 };
}
async function runAs(deps, R, biz, label, fn) {
  const rows = await R.owners(deps.sql, [biz]);
  if (!rows.length) throw new Error('This page is not available right now.');
  const out = await R.asBusiness(deps, rows[0], label, fn);
  if (out && out.error) throw new Error(out.error);
  return out;
}
export async function myPage(deps, R, token, pdfNo, ip) {
  const t = str(token);
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) throw new Error('This link is not complete.');
  await limit(deps, ip, 'my', 40);
  const link = (await deps.control`select source, business_id, customer_key from erp_customer_links where token_hash = ${await sha256hex(t)}`)[0];
  if (!link) throw new Error('This link is not known. Ask the shop for a new one.');
  await deps.control`update erp_customer_links set last_seen = now() where token_hash = ${await sha256hex(t)}`;
  let d = deps;
  if (link.source !== 'self') {
    if (!R.tenantDeps) throw new Error('This page is not available right now.');
    d = await R.tenantDeps(link.source);
  }
  if (str(pdfNo)) {
    const no = str(pdfNo);
    return runAs(d, R, link.business_id, 'pub:pdf', async (ctx) => {
      const data = await pageData(ctx, link.customer_key);
      if (!data.invoices.some((i) => i.no === no)) throw new Error('That invoice is not on this page.');
      const f = (await findFiles(ctx, 'invoices', 'Invoice_' + no))[0] || null;
      if (f && f.url) return { pdf: f.url, name: f.name };
      const S = await import('./sales.js');
      const made = await S.makeInvoicePdf(ctx, no, {});
      if (!made) throw new Error('No PDF for that invoice yet.');
      return { pdf: made.url, name: made.name };
    });
  }
  return runAs(d, R, link.business_id, 'pub:my', (ctx) => pageData(ctx, link.customer_key));
}

/** index.ts: the public routes. Returns {status, body}. */
export async function pubRoute(deps, req, R) {
  const u = new URL(req.url), what = u.searchParams.get('pub');
  const ip = str(req.headers.get('cf-connecting-ip') || str(req.headers.get('x-forwarded-for')).split(',')[0]) || 'local';
  try {
    if (req.method !== 'GET') return { status: 405, body: { ok: false } };
    if (what === 'check') return { status: 200, body: { ok: true, ...(await checkSerial(deps, u.searchParams.get('s'), ip)) } };
    if (what === 'my') { const r = await myPage(deps, R || {}, u.searchParams.get('t'), u.searchParams.get('pdf'), ip); delete r.deps0; return { status: 200, body: { ok: true, ...r } }; }
    return { status: 404, body: { ok: false, error: 'Unknown.' } };
  } catch (e) { return { status: 200, body: { ok: false, error: str((e && e.message) || e) } }; }
}

// ---------------------------------------------------------------- signed-in helpers
export async function erpWarrantyCard(ctx, payload) {
  const serial = clean(payload && payload.serial), sku = str(payload && payload.sku);
  if (!serial) throw new Error('Which serial number?');
  const r = (await ctx.tx`select s.*, p.name, p.brand from serials s join products p on p.id = s.product_id where s.business_id = ${ctx.biz} and upper(s.serial) = ${serial}
                          and (${sku} = '' or lower(btrim(s.sku)) = ${sku.toLowerCase()}) order by s.sold_at desc nulls last limit 1`)[0];
  if (!r) throw new Error('No unit with serial ' + serial + '.');
  const S = await import('./sales.js'), p = await S.qProfile(ctx);
  const url = checkUrl(ctx.deps, r.serial);
  const w = warrantyWords(r.warranty_until, ctx.now);
  return { serial: str(r.serial), product: str(r.name), brand: str(r.brand), sku: str(r.sku), sold: r.sold_at ? formatDate(new Date(r.sold_at), 'd MMM yyyy') : '',
    invoiceNo: str(r.invoice_no), customer: str(r.customer), warrantyMonths: r.warranty_months == null ? null : num(r.warranty_months), warrantyUntil: r.warranty_until ? formatDate(new Date(r.warranty_until), 'd MMM yyyy') : '',
    state: w.state, checkUrl: url, qr: qrDataUrl(url), brandName: str((await brandName(ctx))),
    seller: { name: str(p.name) || str(ctx.s.businessName), phone: str(p.phone), address: str(p.address), website: str(p.website) } };
}
async function brandName(ctx) {
  try { const I = await import('./installer.js'); const b = await I.brandOf(ctx.sql); return b && b.name ? b.name : ''; } catch (_) { return ''; }
}
export async function erpMyLink(ctx, payload) {
  const key = custKey(payload && payload.phone, payload && payload.name);
  if (!key || key === 'n:') throw new Error('A customer needs a phone number or a name for a page link.');
  const l = await ensureLink(ctx, key);
  if (!l) throw new Error('Customer pages work only for ERPs run by the provider.');
  const S = await import('./sales.js'), p = await S.qProfile(ctx);
  const text = 'Your orders, dues and warranty at ' + (str(p.name) || str(ctx.s.businessName)) + ': ' + l.url;
  const wa = str(payload && payload.phone).replace(/[^0-9]/g, '');
  return { url: l.url, text, whatsapp: wa ? 'https://wa.me/' + (wa.startsWith('0') ? '88' + wa : wa) + '?text=' + encodeURIComponent(text) : '' };
}
export async function erpPassportSync(ctx) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner publishes to the register.');
  if (!sourceOf(ctx.deps)) throw new Error('The register works only for ERPs run by the provider.');
  const rows = await ctx.tx`select s.serial, s.sku, s.sold_at, s.invoice_no, s.customer_key, s.warranty_months, s.warranty_until, p.name, p.brand, p.category
                            from serials s join products p on p.id = s.product_id where s.business_id = ${ctx.biz} and s.status = 'sold' order by s.sold_at`;
  const byInv = {};
  for (const r of rows) (byInv[str(r.invoice_no) + '|' + str(r.customer_key) + '|' + day(r.sold_at)] = byInv[str(r.invoice_no) + '|' + str(r.customer_key) + '|' + day(r.sold_at)] || []).push(r);
  let n = 0;
  for (const k of Object.keys(byInv)) {
    const g = byInv[k];
    n += await passportSold(ctx, { invoiceNo: g[0].invoice_no, customerKey: g[0].customer_key, at: g[0].sold_at ? new Date(g[0].sold_at) : ctx.now,
      units: g.map((r) => ({ serial: r.serial, sku: r.sku, name: r.name, brand: r.brand, category: r.category, warrantyMonths: r.warranty_months, warrantyUntil: day(r.warranty_until) })) });
  }
  return { published: n };
}
export async function erpPassportShowSeller(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner changes this.');
  const on = !(payload && payload.on === false);
  await ctx.tx`insert into business_config (business_id, key, value) values (${ctx.biz}, 'passport_show_seller', ${on ? '1' : '0'})
               on conflict (business_id, key) do update set value = excluded.value, updated_at = now()`;
  await refreshSeller(ctx);
  return { showSeller: on };
}
/** The register's copy of the seller (name, city, named or not) follows the settings: called after they change. */
export async function refreshSeller(ctx) {
  const src = sourceOf(ctx.deps); if (!src) return;
  const who = await sellerInfo(ctx);
  await ctx.deps.control`update erp_passports set seller_name = ${who.name}, seller_city = ${who.city || null}, show_seller = ${who.show}, updated_at = now()
                          where source = ${src} and business_id = ${ctx.biz}`;
}

export const HANDLERS = { erpWarrantyCard, erpMyLink, erpPassportSync, erpPassportShowSeller };
