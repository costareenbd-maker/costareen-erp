// Stage N2 (docs/NETWORK-BLUEPRINT.md section 5): the buyer whose seller is outside the system.
//
// He registers the printer himself on the check page (level "declared", grey): the model, the month, the warranty he
// was promised, who sold it, his own name and number, and photos of the invoice and the serial sticker. He gets two
// links: his owner link (status, send again, withdraw) and a confirm link he sends to his seller himself (WhatsApp),
// so nobody is spammed. The seller opens it, types the shop's name, number and city (a Lite record kept here) and
// presses Confirm, Correct or Not ours. Confirmed: the passport turns green and the seller gets his own page with the
// units he confirmed and a digital warranty card for each.
//
// Nothing here can make an outside seller honour a promise; the page says so. The platform holds no money.
// Consent (Personal Data Protection Ordinance 2025): the owner ticks a plain-words line; it is stored with the
// record; the owner link removes everything.
//
// Public (index.ts ?pub=..., GET or POST, rate limited per address):
//   POST ?pub=register  {serial, product, brand, boughtMonth, warrantyMonths, sellerName, sellerPhone, sellerCity,
//                        buyerName, buyerPhone, consent: true, proofs: [{kind, mime, data}]}
//   GET  ?pub=owner&t=  the owner's view;   POST ?pub=owner {t, action: 'withdraw'}
//   GET  ?pub=confirm&t= what the seller is asked;   POST ?pub=confirm {t, answer, shop:{name, phone, city, email, showName}, boughtMonth, warrantyMonths}
//   GET  ?pub=lite&t=   the Lite seller's page;   POST ?pub=lite {t, showName, city, email}
// Platform admin (signed in): erpPlatformRegister, erpPlatformRegisterRemove({id}), erpPlatformLiteBlock({id, on})

import { formatDate, num } from '../lib/time.js';
import { phone11 } from '../lib/phone.js';
import { qrDataUrl } from '../lib/qr.js';
import { pubBase, checkUrl, limit, tokenFor, versionOf, warrantyWords } from './passport.js';
import { platformAdmin } from './platform.js';

const str = (v) => String(v == null ? '' : v).trim();
const clean = (v) => str(v).replace(/\s+/g, '').toUpperCase();
const norm = (v) => clean(v).replace(/[^A-Z0-9]/g, '');
const day = (d) => (d ? formatDate(new Date(d), 'yyyy-MM-dd') : '');
const month = (d) => (d ? formatDate(new Date(d), 'MMM yyyy') : '');
const NIL = '00000000-0000-0000-0000-000000000000';
const enc = new TextEncoder();
export const CONSENT = 'I agree that my name and mobile number are kept with this registration so the seller can recognise my purchase and so I can be reached about this printer’s warranty. Nothing else is done with them. I can remove the registration with my owner link at any time.';

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const pad2 = (n) => String(n).padStart(2, '0');
/** The first day of the month `n` months after a yyyy-MM-dd date. */
function addMonths(d, n) {
  const m = /^(\d{4})-(\d{2})/.exec(d);
  const t = (Number(m[1]) * 12 + Number(m[2]) - 1) + n;
  return Math.floor(t / 12) + '-' + pad2((t % 12) + 1) + '-01';
}
function base(deps) { return pubBase(deps).check.replace(/check$/, ''); }
// the links are derived from the provider's secret (like the customer pages), so they can be shown again later
const ownerToken = (deps, id) => tokenFor(deps, 'public', NIL, 'owner|' + id);
const confirmToken = (deps, id) => tokenFor(deps, 'public', NIL, 'confirm|' + id);
const liteToken = (deps, id) => tokenFor(deps, 'public', NIL, 'lite|' + id);
async function links(deps, row) {
  const b = base(deps), c = (row.claim || {});
  const confirmUrl = b + 'confirm?t=' + await confirmToken(deps, row.id), ownerUrl = b + 'check?o=' + await ownerToken(deps, row.id);
  const text = 'Assalamu alaikum. I bought a ' + str(row.product_name) + ' (serial ' + str(row.serial) + ') from you. Please confirm my warranty on the Printer Passport register - two minutes, free: ' + confirmUrl;
  const p = str(c.sellerPhone).replace(/[^0-9]/g, '');
  return { ownerUrl, confirmUrl, message: text, whatsapp: p ? 'https://wa.me/' + (p.startsWith('0') ? '88' + p : p) + '?text=' + encodeURIComponent(text) : '', checkUrl: checkUrl(deps, row.serial) };
}

// ---------------------------------------------------------------- proof photos
const MAGIC = [['image/jpeg', [0xff, 0xd8, 0xff], 'jpg'], ['image/png', [0x89, 0x50, 0x4e, 0x47], 'png'], ['image/webp', [0x52, 0x49, 0x46, 0x46], 'webp']];
function decodeProof(p, i) {
  const kind = p && p.kind === 'sticker' ? 'sticker' : 'invoice';
  let bytes;
  try { const bin = atob(String((p && p.data) || '').replace(/^data:[^,]*,/, '')); bytes = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k); } catch (_) { throw new Error('Photo ' + (i + 1) + ' could not be read. Take it again.'); }
  if (bytes.length < 200) throw new Error('Photo ' + (i + 1) + ' is empty. Take it again.');
  if (bytes.length > 1.5 * 1024 * 1024) throw new Error('Photo ' + (i + 1) + ' is over 1.5 MB. The page should have shrunk it - try again.');
  const m = MAGIC.find((x) => x[1].every((b, k) => bytes[k] === b));
  if (!m) throw new Error('Photo ' + (i + 1) + ' is not a JPEG, PNG or WebP image.');
  return { kind, mime: m[0], ext: m[2], bytes };
}
async function proofUrls(deps, row) {
  const out = [];
  for (const f of Array.isArray(row.proof) ? row.proof : []) {
    let url = ''; try { url = await deps.storage.url('public', 'passports/' + row.id, f.name); } catch (_) { url = ''; }
    out.push({ kind: f.kind, url });
  }
  return out;
}
async function removeProofs(deps, row) {
  for (const f of Array.isArray(row.proof) ? row.proof : []) { try { await deps.storage.remove('public', 'passports/' + row.id, f.name); } catch (_) { /* best effort */ } }
}

// ---------------------------------------------------------------- the owner registers
export async function register(deps, body, ip) {
  const ctl = deps.control; if (!ctl || !deps.storage) throw new Error('The register is not available on this server.');
  await limit(deps, ip, 'register', 5);
  const b = body || {};
  const serial = clean(b.serial), sn = norm(serial);
  if (sn.length < 3 || sn.length > 60) throw new Error('Type the serial number as it is on the sticker (3 to 60 letters and digits).');
  const product = str(b.product).slice(0, 80);
  if (product.length < 2) throw new Error('Which printer is it? Type the model, for example Bambu Lab A1.');
  const brand = str(b.brand).slice(0, 40);
  const buyerName = str(b.buyerName).slice(0, 60);
  if (buyerName.length < 2) throw new Error('Your name, so the seller recognises the sale.');
  let buyerPhone = '';
  try { buyerPhone = phone11(b.buyerPhone); } catch (e) { throw new Error('Your mobile number: ' + e.message); }
  if (!buyerPhone) throw new Error('Your mobile number - the one the seller knows.');
  const sellerName = str(b.sellerName).slice(0, 80);
  if (sellerName.length < 2) throw new Error('The shop or person you bought from.');
  let sellerPhone = '';
  try { sellerPhone = phone11(b.sellerPhone); } catch (e) { throw new Error('The seller’s mobile number: ' + e.message); }
  const sellerCity = str(b.sellerCity).slice(0, 40);
  const bm = /^(\d{4})-(\d{2})$/.exec(str(b.boughtMonth));
  if (!bm || Number(bm[2]) < 1 || Number(bm[2]) > 12) throw new Error('When did you buy it? Pick the month.');
  const soldAt = bm[1] + '-' + bm[2] + '-01';
  const today = formatDate(new Date(), 'yyyy-MM-dd');
  if (soldAt > today) throw new Error('The month of purchase cannot be in the future.');
  if (soldAt < '2015-01-01') throw new Error('That month is too long ago for a warranty.');
  const months = Math.max(0, Math.min(120, Math.round(num(b.warrantyMonths))));
  if (b.consent !== true) throw new Error('Tick the consent line: your name and number are kept only for this registration.');
  const proofs = Array.isArray(b.proofs) ? b.proofs.slice(0, 2) : [];
  if (!proofs.length) throw new Error('Add at least one photo: the invoice or receipt, or the serial sticker.');
  const files = proofs.map(decodeProof);
  const have = await ctl`select level, status, source from erp_passports where serial_norm = ${sn}`;
  if (have.some((r) => r.level !== 'declared' && r.status === 'sold')) throw new Error('This serial is already registered by its seller. Ask the seller for your warranty card or your customer page.');
  if (have.some((r) => r.source === 'public')) throw new Error('This serial was already registered by its owner. Use the owner link from that registration, or ask the seller to confirm it.');
  const row = {
    serial_norm: sn, serial, source: 'public', business_id: NIL, seller_name: sellerName, seller_city: sellerCity || null, show_seller: false,
    product_name: product, brand: brand || null, category: 'Printer', version: versionOf(product), sold_at: soldAt,
    warranty_months: months || null, warranty_until: months ? addMonths(soldAt, months) : null, status: 'sold', level: 'declared',
    claim: ctl.json({ buyerName, buyerPhone, sellerName, sellerPhone, sellerCity, boughtMonth: bm[1] + '-' + bm[2], warrantyMonths: months }),
    proof: ctl.json([]), declared_at: new Date(), consent: ctl.json({ at: new Date().toISOString(), text: CONSENT, ip: str(ip) }),
  };
  const cols = Object.keys(row);
  const id = (await ctl`insert into erp_passports ${ctl(row, ...cols)} returning id`)[0].id;
  await ctl`update erp_passports set owner_hash = ${await sha256hex(await ownerToken(deps, id))}, confirm_hash = ${await sha256hex(await confirmToken(deps, id))} where id = ${id}`;
  const saved = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i], name = (i + 1) + '-' + f.kind + '.' + f.ext;
    await deps.storage.save('public', 'passports/' + id, name, f.bytes, f.mime);
    saved.push({ name, mime: f.mime, kind: f.kind });
  }
  await ctl`update erp_passports set proof = ${ctl.json(saved)} where id = ${id}`;
  await ctl`insert into erp_passport_events (passport_id, kind, detail) values (${id}, 'declared', ${ctl.json({ month: month(new Date()) })})`;
  const full = (await ctl`select * from erp_passports where id = ${id}`)[0];
  return { id, serial, product, level: 'declared', ...(await links(deps, full)) };
}

async function byHash(deps, col, token) {
  const t = str(token);
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) throw new Error('This link is not complete.');
  const h = await sha256hex(t);
  const row = col === 'owner' ? (await deps.control`select * from erp_passports where owner_hash = ${h}`)[0] : (await deps.control`select * from erp_passports where confirm_hash = ${h}`)[0];
  if (!row) throw new Error(col === 'owner' ? 'This owner link is not known. It may have been removed.' : 'This confirm link is not known. Ask your customer to send it again.');
  return row;
}
async function liteOf(deps, id) { return id ? (await deps.control`select * from erp_lite_sellers where id = ${id}`)[0] || null : null; }

// ---------------------------------------------------------------- the owner's view
export async function ownerView(deps, token, ip) {
  await limit(deps, ip, 'owner', 40);
  const r = await byHash(deps, 'owner', token), c = r.claim || {}, lite = await liteOf(deps, r.lite_id);
  const w = warrantyWords(r.warranty_until, new Date());
  const ev = await deps.control`select kind, at, detail from erp_passport_events where passport_id = ${r.id} order by at asc limit 50`;
  return {
    serial: str(r.serial), product: str(r.product_name), brand: str(r.brand), level: str(r.level), answer: str(r.answer),
    boughtMonth: str(c.boughtMonth), warrantyMonths: r.warranty_months == null ? null : num(r.warranty_months), warrantyUntil: day(r.warranty_until), warrantyState: w.state, daysLeft: w.days,
    seller: { name: str(c.sellerName), phone: str(c.sellerPhone), city: str(c.sellerCity) },
    confirmedBy: lite ? { name: str(lite.name), city: str(lite.city) } : null,
    proofs: await proofUrls(deps, r), declared: month(r.declared_at), answered: month(r.answered_at),
    events: ev.map((e) => ({ kind: e.kind, month: month(e.at) })),
    ...(await links(deps, r)),
  };
}
export async function ownerAction(deps, body, ip) {
  await limit(deps, ip, 'owner', 40);
  const b = body || {};
  const r = await byHash(deps, 'owner', b.t);
  if (b.action !== 'withdraw') throw new Error('Unknown action.');
  await removeProofs(deps, r);
  if (r.lite_id && r.level === 'confirmed') await deps.control`update erp_lite_sellers set confirms = greatest(0, confirms - 1) where id = ${r.lite_id}`;
  await deps.control`delete from erp_passports where id = ${r.id}`;
  return { removed: true, serial: str(r.serial) };
}

// ---------------------------------------------------------------- the seller confirms
export async function confirmView(deps, token, ip) {
  await limit(deps, ip, 'confirm', 30);
  const r = await byHash(deps, 'confirm', token), c = r.claim || {}, lite = await liteOf(deps, r.lite_id);
  const tail = str(c.buyerPhone).slice(-4);
  return {
    serial: str(r.serial), product: str(r.product_name), brand: str(r.brand), boughtMonth: str(c.boughtMonth), warrantyMonths: r.warranty_months == null ? 0 : num(r.warranty_months),
    buyer: { name: str(c.buyerName), phoneTail: tail ? '…' + tail : '' },
    sellerClaim: { name: str(c.sellerName), city: str(c.sellerCity) },
    answer: str(r.answer), answered: month(r.answered_at), lite: lite ? { name: str(lite.name), city: str(lite.city) } : null,
    proofs: await proofUrls(deps, r), declared: month(r.declared_at), checkUrl: checkUrl(deps, r.serial),
  };
}
async function liteUpsert(deps, shop) {
  const name = str(shop && shop.name).slice(0, 80);
  if (name.length < 2) throw new Error('Your shop’s name.');
  let phone = '';
  try { phone = phone11(shop && shop.phone); } catch (e) { throw new Error('Your shop’s mobile number: ' + e.message); }
  if (!phone) throw new Error('Your shop’s mobile number.');
  const city = str(shop && shop.city).slice(0, 40), email = str(shop && shop.email).slice(0, 80).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That e-mail address does not look right.');
  const show = !(shop && shop.showName === false);
  const have = (await deps.control`select * from erp_lite_sellers where phone = ${phone}`)[0];
  let row;
  if (have) {
    // the first name given for a number stays (a stranger cannot rename a shop); city, e-mail and the name switch follow
    row = (await deps.control`update erp_lite_sellers set city = ${city || have.city}, email = ${email || have.email}, show_name = ${show}, last_seen = now() where id = ${have.id} returning *`)[0];
  } else {
    row = (await deps.control`insert into erp_lite_sellers (name, phone, city, email, show_name, last_seen) values (${name}, ${phone}, ${city || null}, ${email || null}, ${show}, now()) returning *`)[0];
    await deps.control`update erp_lite_sellers set access_hash = ${await sha256hex(await liteToken(deps, row.id))} where id = ${row.id}`;
  }
  if (row.status === 'blocked') throw new Error('This seller cannot confirm registrations. Write to the platform.');
  return row;
}
export async function confirmAnswer(deps, body, ip) {
  await limit(deps, ip, 'confirm_post', 10);
  const b = body || {};
  const r = await byHash(deps, 'confirm', b.t);
  const answer = ['confirm', 'correct', 'reject'].includes(b.answer) ? b.answer : '';
  if (!answer) throw new Error('Press Confirm, Correct or Not ours.');
  const lite = await liteUpsert(deps, b.shop);
  const ctl = deps.control;
  if (answer === 'reject') {
    await ctl`update erp_passports set answer = 'rejected', level = 'declared', lite_id = ${lite.id}, answered_at = now(), updated_at = now() where id = ${r.id}`;
    await ctl`insert into erp_passport_events (passport_id, kind, detail) values (${r.id}, 'rejected', ${ctl.json({ month: month(new Date()) })})`;
    return { answer: 'rejected', shop: { name: str(lite.name) }, liteUrl: base(deps) + 'lite?t=' + await liteToken(deps, lite.id) };
  }
  let soldAt = day(r.sold_at), months = r.warranty_months == null ? 0 : num(r.warranty_months);
  if (answer === 'correct') {
    const bm = /^(\d{4})-(\d{2})$/.exec(str(b.boughtMonth));
    if (bm && Number(bm[2]) >= 1 && Number(bm[2]) <= 12) soldAt = bm[1] + '-' + bm[2] + '-01';
    if (b.warrantyMonths !== undefined && b.warrantyMonths !== '') months = Math.max(0, Math.min(120, Math.round(num(b.warrantyMonths))));
  }
  const until = months ? addMonths(soldAt, months) : null;
  const wasConfirmed = r.level === 'confirmed';
  await ctl`update erp_passports set level = 'confirmed', answer = ${answer === 'correct' ? 'corrected' : 'confirmed'}, lite_id = ${lite.id}, seller_name = ${lite.name}, seller_city = ${lite.city || null},
            show_seller = ${lite.show_name}, sold_at = ${soldAt}, warranty_months = ${months || null}, warranty_until = ${until}, answered_at = now(), updated_at = now() where id = ${r.id}`;
  await ctl`insert into erp_passport_events (passport_id, kind, detail) values (${r.id}, 'confirmed', ${ctl.json({ month: month(new Date()), corrected: answer === 'correct' })})`;
  if (!wasConfirmed) await ctl`update erp_lite_sellers set confirms = confirms + 1 where id = ${lite.id}`;
  return { answer: answer === 'correct' ? 'corrected' : 'confirmed', shop: { name: str(lite.name), city: str(lite.city) }, warrantyUntil: until || '', liteUrl: base(deps) + 'lite?t=' + await liteToken(deps, lite.id) };
}

// ---------------------------------------------------------------- the Lite seller's page
async function liteByToken(deps, token) {
  const t = str(token);
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) throw new Error('This link is not complete.');
  const row = (await deps.control`select * from erp_lite_sellers where access_hash = ${await sha256hex(t)}`)[0];
  if (!row) throw new Error('This page link is not known.');
  if (row.status === 'blocked') throw new Error('This page is closed. Write to the platform.');
  return row;
}
export async function liteView(deps, token, ip) {
  await limit(deps, ip, 'lite', 40);
  const s = await liteByToken(deps, token);
  await deps.control`update erp_lite_sellers set last_seen = now() where id = ${s.id}`;
  const rows = await deps.control`select * from erp_passports where lite_id = ${s.id} order by answered_at desc limit 200`;
  const now = new Date();
  const units = rows.map((r) => {
    const w = warrantyWords(r.warranty_until, now), c = r.claim || {}, url = checkUrl(deps, r.serial);
    return { serial: str(r.serial), product: str(r.product_name), brand: str(r.brand), soldMonth: month(r.sold_at), soldAt: day(r.sold_at), warrantyMonths: r.warranty_months == null ? 0 : num(r.warranty_months),
      warrantyUntil: day(r.warranty_until), warrantyState: w.state, daysLeft: w.days, buyerName: str(c.buyerName), answer: str(r.answer), level: str(r.level), checkUrl: url, qr: r.level === 'confirmed' ? qrDataUrl(url) : '' };
  });
  return { shop: { name: str(s.name), phone: str(s.phone), city: str(s.city), email: str(s.email), showName: !!s.show_name, confirms: num(s.confirms), since: month(s.created_at) }, units };
}
export async function liteSave(deps, body, ip) {
  await limit(deps, ip, 'lite', 40);
  const b = body || {};
  const s = await liteByToken(deps, b.t);
  const city = str(b.city).slice(0, 40), email = str(b.email).slice(0, 80).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That e-mail address does not look right.');
  const show = b.showName !== false;
  await deps.control`update erp_lite_sellers set city = ${city || null}, email = ${email || null}, show_name = ${show} where id = ${s.id}`;
  await deps.control`update erp_passports set seller_city = ${city || null}, show_seller = ${show}, updated_at = now() where lite_id = ${s.id} and level = 'confirmed'`;
  return { saved: true };
}

/** passport.js pubRoute hands the new routes here. */
export async function route(deps, what, method, params, body, ip) {
  if (what === 'register' && method === 'POST') return register(deps, body, ip);
  if (what === 'owner') return method === 'POST' ? ownerAction(deps, body, ip) : ownerView(deps, params.get('t'), ip);
  if (what === 'confirm') return method === 'POST' ? confirmAnswer(deps, body, ip) : confirmView(deps, params.get('t'), ip);
  if (what === 'lite') return method === 'POST' ? liteSave(deps, body, ip) : liteView(deps, params.get('t'), ip);
  return null;
}

// ---------------------------------------------------------------- platform admin: moderation
async function needAdmin(ctx) {
  if (!(await platformAdmin(ctx))) throw new Error('Only the platform admin sees the public register.');
}
export async function erpPlatformRegister(ctx) {
  await needAdmin(ctx);
  const ctl = ctx.deps.control; if (!ctl) throw new Error('This server has no register.');
  const rows = await ctl`select p.*, l.name as lite_name, l.phone as lite_phone from erp_passports p left join erp_lite_sellers l on l.id = p.lite_id where p.source = 'public' order by p.declared_at desc nulls last limit 200`;
  const regs = [];
  for (const r of rows) {
    const c = r.claim || {};
    regs.push({ id: r.id, serial: str(r.serial), product: str(r.product_name), level: str(r.level), answer: str(r.answer), declared: r.declared_at ? formatDate(new Date(r.declared_at), 'd MMM yyyy') : '',
      answered: r.answered_at ? formatDate(new Date(r.answered_at), 'd MMM yyyy') : '', buyer: str(c.buyerName), buyerPhone: str(c.buyerPhone), sellerClaim: str(c.sellerName) + (c.sellerCity ? ' · ' + str(c.sellerCity) : ''),
      lite: r.lite_name ? str(r.lite_name) + ' · ' + str(r.lite_phone) : '', proofs: await proofUrls(ctx.deps, r) });
  }
  const lites = (await ctl`select * from erp_lite_sellers order by created_at desc limit 200`).map((s) => ({ id: s.id, name: str(s.name), phone: str(s.phone), city: str(s.city), email: str(s.email), status: str(s.status), confirms: num(s.confirms), since: s.created_at ? formatDate(new Date(s.created_at), 'd MMM yyyy') : '' }));
  const total = (await ctl`select count(*)::int as n, count(*) filter (where level = 'declared')::int as declared, count(*) filter (where level = 'confirmed')::int as confirmed from erp_passports where source = 'public'`)[0];
  return { registrations: regs, sellers: lites, counts: { all: total.n, declared: total.declared, confirmed: total.confirmed }, checkUrl: pubBase(ctx.deps).check };
}
export async function erpPlatformRegisterRemove(ctx, payload) {
  await needAdmin(ctx);
  const id = str(payload && payload.id);
  const r = (await ctx.deps.control`select * from erp_passports where id = ${id}::uuid and source = 'public'`)[0];
  if (!r) throw new Error('No such registration.');
  await removeProofs(ctx.deps, r);
  if (r.lite_id && r.level === 'confirmed') await ctx.deps.control`update erp_lite_sellers set confirms = greatest(0, confirms - 1) where id = ${r.lite_id}`;
  await ctx.deps.control`delete from erp_passports where id = ${r.id}`;
  return { removed: true };
}
export async function erpPlatformLiteBlock(ctx, payload) {
  await needAdmin(ctx);
  const id = str(payload && payload.id), on = !!(payload && payload.on);
  const r = await ctx.deps.control`update erp_lite_sellers set status = ${on ? 'blocked' : 'active'} where id = ${id}::uuid returning id`;
  if (!r.length) throw new Error('No such seller.');
  return { blocked: on };
}
export const HANDLERS = { erpPlatformRegister, erpPlatformRegisterRemove, erpPlatformLiteBlock };
