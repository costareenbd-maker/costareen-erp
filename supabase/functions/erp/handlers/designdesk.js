// Stage N8 (docs/NETWORK-BLUEPRINT.md section 4.1 "Design desk" + repair-part requests): a sketch becomes a file, then a print.
//
// A buyer posts what he needs on erp.3dowala.com/design - a new design, a broken part to copy (repair part), or a
// personalised thing - with a photo or sketch, measurements, a deadline, his city, name, number and a plain consent line.
// Designers on the desk (anyone who joined with name, number, city, portfolio - no ERP needed, a link is their account,
// like the Lite sellers of stage N2) see the open requests without the buyer's name or number, and offer a price and
// days. The buyer sees the offers with each designer's rating and picks one: both get each other's contact; they talk;
// the designer uploads the file on the request; the buyer downloads it, accepts (or asks for changes), rates the
// designer, and can send the file straight to "Get it printed". The platform holds no money: the buyer pays the designer.
//
// Public (passport.js pubRoute, rate limited per address), all under ?pub=design:
//   GET                     the front: public designers with ratings, counts
//   GET  &t=                the buyer's request
//   GET  &d=                the designer's desk: open requests, his offers, his jobs, his profile
//   GET  &p=<slug>          a designer's public profile
//   POST {want:'join', ...} a designer joins -> his link            POST {want:'start', fileName, fileSize} -> request + upload
//   POST {t, action:'post'|'choose'|'close'|'accept'|'changes'|'rate', ...}   the buyer
//   POST {d, action:'offer'|'withdraw'|'deliverStart'|'delivered'|'profile', ...}   the designer
// Signed in (platform admin): erpPlatformDesign, erpPlatformDesignAct. printboard.js asks fromDesign() for a delivered file.

import { formatDate, num, round2 } from '../lib/time.js';
import { phone11 } from '../lib/phone.js';
import { pubBase, limit, tokenFor } from './passport.js';
import { platformAdmin } from './platform.js';

const str = (v) => String(v == null ? '' : v).trim();
const when = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const ago = (d) => { const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); return m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
const NIL = '00000000-0000-0000-0000-000000000000';
const enc = new TextEncoder();
const SKETCH_RE = /\.(jpg|jpeg|png|webp|pdf|stl|3mf|obj|step|stp|zip)$/i;
const OUT_RE = /\.(stl|3mf|obj|step|stp|f3d|scad|zip|pdf)$/i;
const MAX_SKETCH = 15 * 1024 * 1024, MAX_OUT = 40 * 1024 * 1024;
const KINDS = ['design', 'repair', 'personal'];
export const CONSENT_BUYER = 'The designer I choose gets my name and number to make and deliver this file; until then designers see only the city, the pictures and what I wrote. The platform holds no money: I pay the designer directly.';
export const CONSENT_DESIGNER = 'My name, city, skills and portfolio link are shown on the desk and on my offers. My number goes only to buyers who choose me. I can leave the desk by asking.';
async function sha256hex(s) { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
const tokenOf = (deps, kind, id) => tokenFor(deps, 'public', NIL, kind + '|' + id);
const base = (deps) => pubBase(deps).check.replace(/check$/, '');
const slugOf = (name) => (str(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'designer') + '-' + Math.random().toString(36).slice(2, 6);
async function url(deps, path, name) { if (!path) return ''; try { return await deps.storage.url('public', path, name); } catch (_) { return ''; } }
const sketchFolder = (id) => 'design/' + id, outFolder = (id) => 'design/' + id + '/out';

export async function ratingOf(ctl, designerId) {
  const r = (await ctl`select count(*)::int as n, coalesce(avg(stars), 0)::numeric as avg from erp_designer_ratings where designer_id = ${designerId}`)[0];
  const d = (await ctl`select count(*)::int as n from erp_design_requests where designer_id = ${designerId} and status = 'done'`)[0];
  return { count: num(r.n), stars: num(r.n) ? Math.round(num(r.avg) * 10) / 10 : null, done: num(d.n) };
}
function designerRow(d, r, full) {
  return { slug: str(d.slug), name: str(d.name), city: str(d.city), link: str(d.link), skills: str(d.skills), about: str(d.about), since: when(d.created_at), rating: r, ...(full ? { phone: str(d.phone), public: !!d.public } : {}) };
}
async function offersOf(deps, reqId, forBuyer) {
  const rows = await deps.control`select o.*, d.name, d.city, d.slug, d.link, d.skills from erp_design_offers o join erp_designers d on d.id = o.designer_id where o.request_id = ${reqId} and o.status <> 'withdrawn' order by o.created_at`;
  const out = [];
  for (const o of rows) out.push({ id: o.id, designer: str(o.name), city: str(o.city), slug: str(o.slug), link: str(o.link), skills: str(o.skills), price: num(o.price), days: o.days == null ? null : num(o.days), note: str(o.note), status: str(o.status), when: when(o.created_at), rating: await ratingOf(deps.control, o.designer_id), ...(forBuyer ? {} : { designerId: o.designer_id }) });
  return out;
}
function reqPublic(r) {
  return { reqNo: str(r.req_no), kind: str(r.kind), title: str(r.title), what: str(r.what), size: str(r.size), deadline: str(r.deadline), budget: str(r.budget), city: str(r.city), link: str(r.link), fileName: str(r.file_name), status: str(r.status), posted: when(r.created_at), ago: ago(r.created_at) };
}

// ---------------------------------------------------------------- the front and the designers
export async function front(deps, ip) {
  await limit(deps, ip, 'design_front', 120);
  const ctl = deps.control; if (!ctl) throw new Error('The design desk is not available on this server.');
  const rows = await ctl`select * from erp_designers where status = 'active' and public order by created_at desc limit 100`;
  const designers = [];
  for (const d of rows) designers.push(designerRow(d, await ratingOf(ctl, d.id), false));
  designers.sort((a, b) => (b.rating.done - a.rating.done) || ((b.rating.stars || 0) - (a.rating.stars || 0)));
  const c = (await ctl`select count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'done')::int as done from erp_design_requests`)[0];
  return { designers, open: num(c.open), done: num(c.done), consent: CONSENT_BUYER, consentDesigner: CONSENT_DESIGNER };
}
export async function join(deps, body, ip) {
  await limit(deps, ip, 'design_join', 5);
  const ctl = deps.control; if (!ctl) throw new Error('The design desk is not available on this server.');
  const b = body || {};
  const name = str(b.name).slice(0, 60); if (name.length < 2) throw new Error('Your name, as buyers will see it.');
  let phone = ''; try { phone = phone11(b.phone); } catch (e) { throw new Error('Your mobile number: ' + e.message); }
  if (!phone) throw new Error('Your mobile number, for the buyers who choose you.');
  const city = str(b.city).slice(0, 40); if (city.length < 2) throw new Error('Your city.');
  if (b.consent !== true) throw new Error('Tick the line about what is shown.');
  const dup = (await ctl`select 1 from erp_designers where phone = ${phone}`)[0];
  if (dup) throw new Error('This number is already on the desk. Use your designer link; if it is lost, ask the platform for a new one.');
  const id = (await ctl`insert into erp_designers (slug, name, phone, city, link, skills, about, consent) values (${slugOf(name)}, ${name}, ${phone}, ${city}, ${str(b.link).slice(0, 300) || null}, ${str(b.skills).slice(0, 120) || null}, ${str(b.about).slice(0, 600) || null}, ${ctl.json({ at: new Date().toISOString(), text: CONSENT_DESIGNER, ip: str(ip) })}) returning id, slug`)[0];
  const token = await tokenOf(deps, 'designer', id.id);
  await ctl`update erp_designers set token_hash = ${await sha256hex(token)} where id = ${id.id}`;
  return { d: token, deskUrl: base(deps) + 'design?d=' + token, profileUrl: base(deps) + 'design?p=' + id.slug, slug: id.slug };
}
async function designerBy(deps, token) {
  const t = str(token);
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) throw new Error('This designer link is not complete.');
  const d = (await deps.control`select * from erp_designers where token_hash = ${await sha256hex(t)}`)[0];
  if (!d) throw new Error('This designer link is not known.');
  if (d.status === 'blocked') throw new Error('This designer account is closed. Ask the platform.');
  return d;
}
export async function profile(deps, slug, ip) {
  await limit(deps, ip, 'design_front', 120);
  const d = (await deps.control`select * from erp_designers where slug = ${str(slug).slice(0, 40)} and status = 'active'`)[0];
  if (!d) throw new Error('No designer by that name on the desk.');
  const done = await deps.control`select r.req_no, r.kind, r.title, r.done_at, g.stars, g.text from erp_design_requests r left join erp_designer_ratings g on g.request_id = r.id where r.designer_id = ${d.id} and r.status = 'done' order by r.done_at desc limit 20`;
  return { designer: designerRow(d, await ratingOf(deps.control, d.id), false), work: done.map((w) => ({ reqNo: str(w.req_no), kind: str(w.kind), title: str(w.title), when: when(w.done_at), stars: w.stars == null ? null : num(w.stars), text: str(w.text) })) };
}

// ---------------------------------------------------------------- the buyer
export async function start(deps, body, ip) {
  const ctl = deps.control; if (!ctl) throw new Error('The design desk is not available on this server.');
  await limit(deps, ip, 'design_start', 10);
  const b = body || {};
  const fileName = str(b.fileName).replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 80), fileSize = Math.round(num(b.fileSize));
  if (fileName && !SKETCH_RE.test(fileName)) throw new Error('Send a photo (JPG, PNG), a PDF or drawing, or a model file (STL, 3MF, OBJ, STEP, ZIP).');
  if (fileName && (fileSize <= 0 || fileSize > MAX_SKETCH)) throw new Error('The picture or file should be between 1 byte and 15 MB.');
  const id = (await ctl`insert into erp_design_requests (req_no, status, file_name, file_size) values (${'DR-' + formatDate(new Date(), 'yyMMdd') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()}, 'uploading', ${fileName || null}, ${fileName ? fileSize : null}) returning id`)[0].id;
  const token = await tokenOf(deps, 'design', id);
  await ctl`update erp_design_requests set token_hash = ${await sha256hex(token)} where id = ${id}`;
  let upload = null;
  if (fileName) {
    if (!deps.storage || !deps.storage.signUpload) throw new Error('File uploads are not available on this server - give a link instead.');
    const stored = 'sketch' + fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    upload = await deps.storage.signUpload('public', sketchFolder(id), stored);
    await ctl`update erp_design_requests set file_name = ${stored}, file_path = ${'public/' + sketchFolder(id) + '/' + stored} where id = ${id}`;
  }
  return { t: token, requestUrl: base(deps) + 'design?t=' + token, upload };
}
async function byToken(deps, token) {
  const t = str(token);
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) throw new Error('This request link is not complete.');
  const r = (await deps.control`select * from erp_design_requests where token_hash = ${await sha256hex(t)}`)[0];
  if (!r || r.status === 'removed') throw new Error('This request link is not known.');
  return r;
}
export async function post(deps, body, ip) {
  await limit(deps, ip, 'design_post', 10);
  const b = body || {};
  const r = await byToken(deps, b.t);
  if (r.status !== 'uploading' && r.status !== 'open') throw new Error('This request is already with a designer or closed.');
  const kind = KINDS.includes(str(b.kind)) ? str(b.kind) : 'design';
  const title = str(b.title).slice(0, 80); if (title.length < 3) throw new Error('What is it? A short title, for example "Bracket for a shelf" or "Broken washing-machine knob".');
  const what = str(b.what).slice(0, 2000); if (what.length < 15) throw new Error('Describe it in a few sentences: what it is for, how it should look, what matters.');
  const name = str(b.name).slice(0, 60); if (name.length < 2) throw new Error('Your name.');
  let phone = ''; try { phone = phone11(b.phone); } catch (e) { throw new Error('Your mobile number: ' + e.message); }
  if (!phone) throw new Error('Your mobile number, so the designer you choose can reach you.');
  const city = str(b.city).slice(0, 40); if (city.length < 2) throw new Error('Your city or area.');
  if (b.consent !== true) throw new Error('Tick the line about what the designer you choose receives.');
  await deps.control`update erp_design_requests set status = 'open', kind = ${kind}, title = ${title}, what = ${what}, size = ${str(b.size).slice(0, 200) || null}, deadline = ${str(b.deadline).slice(0, 60) || null}, budget = ${str(b.budget).slice(0, 60) || null},
    city = ${city}, name = ${name}, phone = ${phone}, link = ${str(b.link).slice(0, 400) || null}, via = ${str(b.via).slice(0, 80) || null},
    consent = ${deps.control.json({ at: new Date().toISOString(), text: CONSENT_BUYER, ip: str(ip) })}, updated_at = now() where id = ${r.id}`;
  return { reqNo: str(r.req_no), requestUrl: base(deps) + 'design?t=' + str(b.t), status: 'open' };
}
export async function view(deps, token, ip) {
  await limit(deps, ip, 'design_view', 60);
  const r = await byToken(deps, token);
  const g = (await deps.control`select stars, text from erp_designer_ratings where request_id = ${r.id}`)[0];
  let designer = null;
  if (r.designer_id) { const d = (await deps.control`select * from erp_designers where id = ${r.designer_id}`)[0]; if (d) designer = { ...designerRow(d, await ratingOf(deps.control, d.id), false), phone: str(d.phone) }; }
  return { ...reqPublic(r), name: str(r.name), fileUrl: await url(deps, r.file_path ? sketchFolder(r.id) : '', r.file_name), offers: await offersOf(deps, r.id, true), chosen: r.chosen_offer || null, designer,
    out: r.out_name ? { name: str(r.out_name), url: await url(deps, outFolder(r.id), r.out_name), note: str(r.out_note), when: when(r.delivered_at) } : null, changeNote: str(r.change_note), done: when(r.done_at),
    rating: g ? { stars: num(g.stars), text: str(g.text) } : null, printUrl: (r.status === 'done' || r.status === 'delivered') && /\.(stl|3mf|obj|step|stp|zip)$/i.test(str(r.out_name)) ? base(deps) + 'print?from=' + str(token) : '', consent: CONSENT_BUYER };
}
export async function buyerAction(deps, body, ip) {
  await limit(deps, ip, 'design_action', 30);
  const b = body || {}, ctl = deps.control;
  const r = await byToken(deps, b.t);
  if (b.action === 'close') {
    if (!['open', 'taken'].includes(r.status)) throw new Error('Only an open request, or one not yet delivered, can be closed here.');
    await ctl`update erp_design_offers set status = 'passed' where request_id = ${r.id} and status in ('offered', 'chosen')`;
    await ctl`update erp_design_requests set status = 'closed', updated_at = now() where id = ${r.id}`;
    return { status: 'closed' };
  }
  if (b.action === 'choose') {
    if (r.status !== 'open') throw new Error('This request is already with a designer or closed.');
    const o = (await ctl`select o.*, d.name, d.phone, d.city from erp_design_offers o join erp_designers d on d.id = o.designer_id where o.id = ${str(b.offerId)}::uuid and o.request_id = ${r.id} and o.status = 'offered' and d.status = 'active'`)[0];
    if (!o) throw new Error('That offer is not open any more.');
    await ctl`update erp_design_offers set status = case when id = ${o.id} then 'chosen' else 'passed' end where request_id = ${r.id} and status = 'offered'`;
    await ctl`update erp_design_requests set status = 'taken', chosen_offer = ${o.id}, designer_id = ${o.designer_id}, taken_at = now(), updated_at = now() where id = ${r.id}`;
    return { status: 'taken', designer: { name: str(o.name), phone: str(o.phone), city: str(o.city) }, price: num(o.price) };
  }
  if (b.action === 'accept') {
    if (r.status !== 'delivered') throw new Error('Accept once the designer has delivered the file.');
    await ctl`update erp_design_requests set status = 'done', done_at = now(), updated_at = now() where id = ${r.id}`;
    return { status: 'done' };
  }
  if (b.action === 'changes') {
    if (r.status !== 'delivered') throw new Error('Ask for changes once a file has been delivered.');
    const note = str(b.note).slice(0, 1000); if (note.length < 5) throw new Error('Say what should change.');
    await ctl`update erp_design_requests set status = 'taken', change_note = ${note}, updated_at = now() where id = ${r.id}`;
    return { status: 'taken' };
  }
  if (b.action === 'rate') {
    if (r.status !== 'done') throw new Error('Rate the designer once you have accepted the file.');
    const stars = Math.round(num(b.stars)); if (!(stars >= 1 && stars <= 5)) throw new Error('Stars from 1 to 5.');
    await ctl`insert into erp_designer_ratings (request_id, designer_id, stars, text) values (${r.id}, ${r.designer_id}, ${stars}, ${str(b.text).slice(0, 500) || null}) on conflict (request_id) do update set stars = excluded.stars, text = excluded.text, created_at = now()`;
    return { rated: true, stars };
  }
  throw new Error('Unknown action.');
}

// ---------------------------------------------------------------- the designer's desk
export async function desk(deps, token, ip) {
  await limit(deps, ip, 'design_desk', 120);
  const d = await designerBy(deps, token), ctl = deps.control;
  const open = await ctl`select r.*, (select count(*) from erp_design_offers o where o.request_id = r.id and o.status <> 'withdrawn')::int as offers,
                                (select row_to_json(o) from erp_design_offers o where o.request_id = r.id and o.designer_id = ${d.id}) as mine
                           from erp_design_requests r where r.status = 'open' order by r.created_at desc limit 200`;
  const requests = [];
  for (const r of open) requests.push({ id: r.id, ...reqPublic(r), fileUrl: await url(deps, r.file_path ? sketchFolder(r.id) : '', r.file_name), offers: num(r.offers), mine: r.mine ? { price: num(r.mine.price), days: r.mine.days == null ? null : num(r.mine.days), note: str(r.mine.note), status: str(r.mine.status) } : null });
  const taken = await ctl`select * from erp_design_requests where designer_id = ${d.id} and status in ('taken', 'delivered', 'done') order by taken_at desc limit 100`;
  const jobs = [];
  for (const r of taken) {
    const o = (await ctl`select price, days from erp_design_offers where id = ${r.chosen_offer}`)[0] || {};
    const g = (await ctl`select stars, text from erp_designer_ratings where request_id = ${r.id}`)[0];
    jobs.push({ id: r.id, ...reqPublic(r), name: str(r.name), phone: str(r.phone), fileUrl: await url(deps, r.file_path ? sketchFolder(r.id) : '', r.file_name), price: num(o.price), days: o.days == null ? null : num(o.days), taken: when(r.taken_at),
      out: r.out_name ? { name: str(r.out_name), url: await url(deps, outFolder(r.id), r.out_name), note: str(r.out_note), when: when(r.delivered_at) } : null, changeNote: str(r.change_note), done: when(r.done_at), rating: g ? { stars: num(g.stars), text: str(g.text) } : null });
  }
  return { me: designerRow(d, await ratingOf(ctl, d.id), true), requests, jobs, profileUrl: base(deps) + 'design?p=' + str(d.slug), consent: CONSENT_DESIGNER };
}
export async function designerAction(deps, body, ip) {
  await limit(deps, ip, 'design_daction', 60);
  const b = body || {}, ctl = deps.control;
  const d = await designerBy(deps, b.d);
  if (b.action === 'profile') {
    const name = str(b.name).slice(0, 60); if (name.length < 2) throw new Error('Your name.');
    await ctl`update erp_designers set name = ${name}, city = ${str(b.city).slice(0, 40) || d.city}, link = ${str(b.link).slice(0, 300) || null}, skills = ${str(b.skills).slice(0, 120) || null}, about = ${str(b.about).slice(0, 600) || null}, public = ${b.public !== false}, updated_at = now() where id = ${d.id}`;
    return { saved: true };
  }
  const r = (await ctl`select * from erp_design_requests where id = ${str(b.id)}::uuid`)[0];
  if (!r || r.status === 'removed') throw new Error('No such request.');
  if (b.action === 'offer') {
    if (r.status !== 'open') throw new Error('That request is not open.');
    const price = round2(num(b.price)); if (!(price > 0)) throw new Error('Your price for the whole design.');
    const days = b.days === '' || b.days == null ? null : Math.max(0, Math.min(90, Math.round(num(b.days))));
    await ctl`insert into erp_design_offers (request_id, designer_id, price, days, note, status) values (${r.id}, ${d.id}, ${price}, ${days}, ${str(b.note).slice(0, 400) || null}, 'offered')
              on conflict (request_id, designer_id) do update set price = excluded.price, days = excluded.days, note = excluded.note, status = 'offered', created_at = now()`;
    return { offered: true, price, days };
  }
  if (b.action === 'withdraw') {
    const x = await ctl`update erp_design_offers set status = 'withdrawn' where request_id = ${r.id} and designer_id = ${d.id} and status = 'offered' returning id`;
    if (!x.length) throw new Error('No open offer of yours on that request.');
    return { withdrawn: true };
  }
  if (r.designer_id !== d.id) throw new Error('That request was not given to you.');
  if (b.action === 'deliverStart') {
    if (!['taken', 'delivered'].includes(r.status)) throw new Error('This request is closed.');
    const fileName = str(b.fileName).replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 80), fileSize = Math.round(num(b.fileSize));
    if (!OUT_RE.test(fileName)) throw new Error('Deliver an STL, 3MF, OBJ, STEP, F3D, SCAD, a ZIP of them, or a PDF drawing.');
    if (fileSize <= 0 || fileSize > MAX_OUT) throw new Error('The file should be between 1 byte and 40 MB.');
    if (!deps.storage || !deps.storage.signUpload) throw new Error('File uploads are not available on this server.');
    const stored = 'v' + Date.now().toString(36) + fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    const upload = await deps.storage.signUpload('public', outFolder(r.id), stored);
    return { upload, stored };
  }
  if (b.action === 'delivered') {
    if (!['taken', 'delivered'].includes(r.status)) throw new Error('This request is closed.');
    const stored = str(b.stored); if (!/^v[a-z0-9]+\.[a-z0-9]+$/.test(stored)) throw new Error('Upload the file first.');
    await ctl`update erp_design_requests set status = 'delivered', out_name = ${stored}, out_path = ${'public/' + outFolder(r.id) + '/' + stored}, out_size = ${Math.round(num(b.fileSize)) || null}, out_note = ${str(b.note).slice(0, 1000) || null}, change_note = null, delivered_at = now(), updated_at = now() where id = ${r.id}`;
    return { status: 'delivered' };
  }
  throw new Error('Unknown action.');
}
/** printboard.js: the delivered file of a design request, for "Get it printed" (bytes + a name), by the buyer's token. */
export async function fromDesign(deps, token) {
  const r = await byToken(deps, token);
  if (!r.out_name || !['delivered', 'done'].includes(r.status)) throw new Error('This design has no delivered file yet.');
  const bytes = await deps.storage.read('public', outFolder(r.id), r.out_name);
  if (!bytes) throw new Error('The design file could not be read.');
  return { bytes, name: str(r.out_name), title: str(r.title), reqNo: str(r.req_no), what: str(r.what), city: str(r.city), name_: str(r.name), phone: str(r.phone) };
}
/** passport.js pubRoute hands ?pub=design here. */
export async function route(deps, what, method, params, body, ip) {
  if (what !== 'design') return null;
  if (method === 'GET') {
    if (params.get('t')) return view(deps, params.get('t'), ip);
    if (params.get('d')) return desk(deps, params.get('d'), ip);
    if (params.get('p')) return profile(deps, params.get('p'), ip);
    return front(deps, ip);
  }
  const b = body || {};
  if (b.want === 'join') return join(deps, b, ip);
  if (b.want === 'start') return start(deps, b, ip);
  if (b.d) return designerAction(deps, b, ip);
  if (b.action === 'post') return post(deps, b, ip);
  return buyerAction(deps, b, ip);
}

// ---------------------------------------------------------------- platform admin
async function needAdmin(ctx) {
  if (!(await platformAdmin(ctx))) throw new Error('Only the platform admin sees the design desk.');
}
export async function erpPlatformDesign(ctx) {
  await needAdmin(ctx);
  const ctl = ctx.deps.control; if (!ctl) throw new Error('This server has no design desk.');
  const ds = await ctl`select * from erp_designers order by created_at desc limit 200`;
  const designers = [];
  for (const d of ds) designers.push({ id: d.id, ...designerRow(d, await ratingOf(ctl, d.id), true), status: str(d.status) });
  const rs = await ctl`select r.*, d.name as designer from erp_design_requests r left join erp_designers d on d.id = r.designer_id where r.status <> 'removed' order by r.created_at desc limit 200`;
  const requests = rs.map((r) => ({ id: r.id, ...reqPublic(r), name: str(r.name), phone: str(r.phone), designer: str(r.designer), via: str(r.via) }));
  const c = (await ctl`select count(*) filter (where status = 'open')::int as open, count(*) filter (where status in ('taken', 'delivered'))::int as busy, count(*) filter (where status = 'done')::int as done from erp_design_requests`)[0];
  return { designers, requests, counts: { open: num(c.open), busy: num(c.busy), done: num(c.done), designers: designers.filter((d) => d.status === 'active').length }, deskUrl: base(ctx.deps) + 'design' };
}
export async function erpPlatformDesignAct(ctx, payload) {
  await needAdmin(ctx);
  const ctl = ctx.deps.control, p = payload || {};
  if (p.designerId) {
    const d = (await ctl`select * from erp_designers where id = ${str(p.designerId)}::uuid`)[0]; if (!d) throw new Error('No such designer.');
    if (p.newLink) { const token = await tokenOf(ctx.deps, 'designer', d.id); await ctl`update erp_designers set token_hash = ${await sha256hex(token)}, updated_at = now() where id = ${d.id}`; return { deskUrl: base(ctx.deps) + 'design?d=' + token }; }
    await ctl`update erp_designers set status = ${p.block ? 'blocked' : 'active'}, updated_at = now() where id = ${d.id}`;
    return { status: p.block ? 'blocked' : 'active' };
  }
  if (p.requestId) {
    const r = (await ctl`select * from erp_design_requests where id = ${str(p.requestId)}::uuid`)[0]; if (!r) throw new Error('No such request.');
    await ctl`update erp_design_requests set status = 'removed', updated_at = now() where id = ${r.id}`;
    return { removed: true };
  }
  throw new Error('Nothing to do.');
}
export const HANDLERS = { erpPlatformDesign, erpPlatformDesignAct };
