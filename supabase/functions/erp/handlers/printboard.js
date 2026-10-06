// Stage N7 (docs/NETWORK-BLUEPRINT.md section 4.1 "Get it printed"): the public board of print jobs.
//
// A stranger drops an STL on erp.3dowala.com/print, his browser works out an estimate (grams, hours, a price range),
// he posts the job with the file (or a sketch, or a link) and a plain consent line. Farms - businesses on the
// platform with the Print jobs kit - see the board inside their ERP and offer a price and days. The buyer sees the
// offers on his job link with each farm's rating and picks one; that farm gets his name, number and file, makes a
// print job in its own ERP, prints, invoices and delivers; when its print job is delivered the board job is done and
// the buyer rates the farm. The platform holds no money: the buyer pays the farm. The provider's own business does
// not print and does not pass jobs - it simply never offers.
//
// Public (passport.js pubRoute, rate limited per address):
//   POST ?pub=printjob {want: 'start', fileName, fileSize}           -> a job id, the buyer's link, a signed upload
//   POST ?pub=printjob {t, action: 'post', ...fields, est, consent}   -> the job goes on the board
//   GET  ?pub=printjob&t=                                             -> the buyer's view: offers, status, rating
//   POST ?pub=printjob {t, action: 'choose'|'close'|'rate', ...}
// Signed in (the farm): erpBoard, erpBoardOffer, erpBoardWithdraw, erpBoardTake; hook boardDone (printkit.js)

import { formatDate, num, round2 } from '../lib/time.js';
import { phone11 } from '../lib/phone.js';
import { pubBase, limit, tokenFor } from './passport.js';
import { sourceOf } from './market.js';

const str = (v) => String(v == null ? '' : v).trim();
const when = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const ago = (d) => { const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); return m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
const NIL = '00000000-0000-0000-0000-000000000000';
const enc = new TextEncoder();
const FILE_RE = /\.(stl|3mf|obj|step|stp|zip|jpg|jpeg|png|pdf)$/i;
const MAX_FILE = 40 * 1024 * 1024;
export const CONSENT = 'The farm I choose gets my name, number and file to print and deliver this job; until then farms see only the city, the file and what I wrote. Offers show the farm, its city and its rating. The platform holds no money: I pay the farm directly.';
async function sha256hex(s) { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
const boardToken = (deps, id) => tokenFor(deps, 'public', NIL, 'board|' + id);
const base = (deps) => pubBase(deps).check.replace(/check$/, '');

function estOf(e) {
  if (!e || typeof e !== 'object') return null;
  const n = (v, hi) => Math.max(0, Math.min(hi, round2(num(v))));
  const out = { grams: n(e.grams, 100000), hours: n(e.hours, 10000), low: Math.round(n(e.low, 1e7)), high: Math.round(n(e.high, 1e7)), infill: n(e.infill, 100), triangles: Math.round(n(e.triangles, 1e8)), box: str(e.box).slice(0, 60), material: str(e.material).slice(0, 30) };
  return out.grams || out.triangles ? out : null;
}
async function fileUrl(deps, row) {
  if (!row.file_path) return '';
  try { return await deps.storage.url('public', 'printjobs/' + row.id, row.file_name); } catch (_) { return ''; }
}
export async function farmRating(ctl, source, biz) {
  const r = (await ctl`select count(*)::int as n, coalesce(avg(stars), 0)::numeric as avg from erp_farm_ratings where source = ${source} and business_id = ${biz}`)[0];
  return { count: num(r.n), stars: num(r.n) ? Math.round(num(r.avg) * 10) / 10 : null };
}
async function offersOf(deps, boardId, buyer) {
  const rows = await deps.control`select * from erp_board_offers where board_id = ${boardId} and status <> 'withdrawn' order by created_at`;
  const out = [];
  for (const o of rows) out.push({ id: o.id, farm: str(o.farm_name), city: str(o.city), price: num(o.price), days: o.days == null ? null : num(o.days), note: str(o.note), status: str(o.status), when: when(o.created_at), rating: await farmRating(deps.control, o.source, o.business_id), ...(buyer ? {} : { source: o.source, businessId: o.business_id }) });
  return out;
}

// ---------------------------------------------------------------- the buyer
export async function start(deps, body, ip) {
  const ctl = deps.control; if (!ctl) throw new Error('The board is not available on this server.');
  await limit(deps, ip, 'board_start', 10);
  const b = body || {};
  let fileName = str(b.fileName).replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 80), fileSize = Math.round(num(b.fileSize));
  if (fileName && !FILE_RE.test(fileName)) throw new Error('Send an STL, 3MF, OBJ, STEP, a ZIP of them, or a photo or PDF of a sketch.');
  if (fileName && (fileSize <= 0 || fileSize > MAX_FILE)) throw new Error('The file should be between 1 byte and 40 MB.');
  const id = (await ctl`insert into erp_print_board (job_no, status, file_name, file_size) values (${'GP-' + formatDate(new Date(), 'yyMMdd') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()}, 'uploading', ${fileName || null}, ${fileName ? fileSize : null}) returning id`)[0].id;
  const token = await boardToken(deps, id);
  await ctl`update erp_print_board set token_hash = ${await sha256hex(token)} where id = ${id}`;
  let upload = null;
  if (fileName) {
    if (!deps.storage || !deps.storage.signUpload) throw new Error('File uploads are not available on this server - give a link instead.');
    const stored = 'file' + fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    upload = await deps.storage.signUpload('public', 'printjobs/' + id, stored);
    await ctl`update erp_print_board set file_name = ${stored}, file_path = ${'public/printjobs/' + id + '/' + stored} where id = ${id}`;
  }
  return { t: token, jobUrl: base(deps) + 'print?t=' + token, upload };
}
async function byToken(deps, token) {
  const t = str(token);
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) throw new Error('This job link is not complete.');
  const r = (await deps.control`select * from erp_print_board where token_hash = ${await sha256hex(t)}`)[0];
  if (!r || r.status === 'removed') throw new Error('This job link is not known.');
  return r;
}
export async function post(deps, body, ip) {
  await limit(deps, ip, 'board_post', 10);
  const b = body || {};
  const r = await byToken(deps, b.t);
  if (r.status !== 'uploading' && r.status !== 'open') throw new Error('This job is already taken or closed.');
  const name = str(b.name).slice(0, 60); if (name.length < 2) throw new Error('Your name.');
  let phone = ''; try { phone = phone11(b.phone); } catch (e) { throw new Error('Your mobile number: ' + e.message); }
  if (!phone) throw new Error('Your mobile number, so the farm you choose can reach you.');
  const city = str(b.city).slice(0, 40); if (city.length < 2) throw new Error('Your city or area, so farms near you can offer.');
  const notes = str(b.notes).slice(0, 1500), link = str(b.link).slice(0, 400);
  if (!r.file_name && !link && notes.length < 10) throw new Error('A file, a link to the file, or a few words about what you want.');
  if (b.consent !== true) throw new Error('Tick the line about what the farm you choose receives.');
  const qty = Math.max(1, Math.min(1000, Math.round(num(b.qty)) || 1));
  await deps.control`update erp_print_board set status = 'open', name = ${name}, phone = ${phone}, city = ${city}, material = ${str(b.material).slice(0, 40) || null}, colour = ${str(b.colour).slice(0, 40) || null}, qty = ${qty},
    notes = ${notes || null}, link = ${link || null}, est = ${deps.control.json(estOf(b.est))}, consent = ${deps.control.json({ at: new Date().toISOString(), text: CONSENT, ip: str(ip) })}, updated_at = now() where id = ${r.id}`;
  return { jobNo: str(r.job_no), jobUrl: base(deps) + 'print?t=' + str(b.t), status: 'open' };
}
export async function view(deps, token, ip) {
  await limit(deps, ip, 'board_view', 60);
  const r = await byToken(deps, token);
  const rating = (await deps.control`select stars, text from erp_farm_ratings where board_id = ${r.id}`)[0];
  return { jobNo: str(r.job_no), status: str(r.status), name: str(r.name), city: str(r.city), material: str(r.material), colour: str(r.colour), qty: num(r.qty), notes: str(r.notes), link: str(r.link), fileName: str(r.file_name),
    fileUrl: await fileUrl(deps, r), est: r.est || null, posted: when(r.created_at), offers: await offersOf(deps, r.id, true), chosen: r.chosen_offer || null, farm: r.farm_contact || null, done: when(r.done_at),
    rating: rating ? { stars: num(rating.stars), text: str(rating.text) } : null, consent: CONSENT };
}
export async function action(deps, R, body, ip) {
  await limit(deps, ip, 'board_action', 30);
  const b = body || {};
  const r = await byToken(deps, b.t), ctl = deps.control;
  if (b.action === 'close') {
    if (r.status !== 'open') throw new Error('Only an open job can be closed here; a taken job is settled with the farm.');
    await ctl`update erp_print_board set status = 'closed', updated_at = now() where id = ${r.id}`;
    return { status: 'closed' };
  }
  if (b.action === 'choose') {
    if (r.status !== 'open') throw new Error('This job is already taken or closed.');
    const o = (await ctl`select * from erp_board_offers where id = ${str(b.offerId)}::uuid and board_id = ${r.id} and status = 'offered'`)[0];
    if (!o) throw new Error('That offer is not open any more.');
    // the chosen farm's contact for the buyer: its shop name and phone
    let contact = { name: str(o.farm_name), phone: '', city: str(o.city) };
    try {
      let d = deps; if (o.source !== 'self') d = await R.tenantDeps(o.source);
      const rows = await R.owners(d.sql, [o.business_id]);
      if (rows.length) { const out = await R.asBusiness(d, { ...rows[0], who: 'Get it printed' }, 'pub:board', async (ctx) => { const S = await import('./sales.js'); const p = await S.qProfile(ctx); return { name: str(p.name) || str(ctx.s.businessName), phone: str(p.phone), address: str(p.address) }; }); if (out && !out.error) contact = { ...contact, ...out }; }
    } catch (e) { console.error('farm contact', e); }
    await ctl`update erp_board_offers set status = case when id = ${o.id} then 'chosen' else 'passed' end where board_id = ${r.id} and status = 'offered'`;
    await ctl`update erp_print_board set status = 'taken', chosen_offer = ${o.id}, taken_by = ${o.source + ':' + o.business_id}, taken_at = now(), farm_contact = ${ctl.json(contact)}, updated_at = now() where id = ${r.id}`;
    return { status: 'taken', farm: contact, price: num(o.price) };
  }
  if (b.action === 'rate') {
    if (r.status !== 'done') throw new Error('Rate the farm once the job is delivered.');
    const stars = Math.round(num(b.stars)); if (!(stars >= 1 && stars <= 5)) throw new Error('Stars from 1 to 5.');
    const m = /^([^:]+):(.+)$/.exec(str(r.taken_by)); if (!m) throw new Error('No farm on this job.');
    await ctl`insert into erp_farm_ratings (board_id, source, business_id, stars, text) values (${r.id}, ${m[1]}, ${m[2]}, ${stars}, ${str(b.text).slice(0, 500) || null}) on conflict (board_id) do update set stars = excluded.stars, text = excluded.text, created_at = now()`;
    return { rated: true, stars };
  }
  throw new Error('Unknown action.');
}
/** passport.js pubRoute hands the board routes here. */
export async function route(deps, R, what, method, params, body, ip) {
  if (what !== 'printjob') return null;
  if (method === 'GET') return view(deps, params.get('t'), ip);
  const b = body || {};
  if (b.want === 'start') return start(deps, b, ip);
  if (b.action === 'post') return post(deps, b, ip);
  return action(deps, R || {}, b, ip);
}

// ---------------------------------------------------------------- the farm (signed in)
function me(ctx) { const src = sourceOf(ctx.deps); if (!src) throw new Error('The jobs board works only for ERPs run by the provider.'); return { src, biz: ctx.biz, key: src + ':' + ctx.biz }; }
async function farmName(ctx, src) {
  const s = (await ctx.deps.control`select name, city, public from erp_market_shops where source = ${src} and business_id = ${ctx.biz}`)[0];
  if (s && s.public) return { name: str(s.name), city: str(s.city) };
  let city = ''; try { city = str((await ctx.tx`select value from business_config where business_id = ${ctx.biz} and key = 'market_city'`)[0]?.value); } catch (_) { city = ''; }
  return { name: 'Farm' + (city ? ' · ' + city : ''), city };
}
export async function erpBoard(ctx) {
  const m = me(ctx), ctl = ctx.deps.control;
  const open = await ctl`select b.*, (select count(*) from erp_board_offers o where o.board_id = b.id and o.status <> 'withdrawn')::int as offers,
                                (select row_to_json(o) from erp_board_offers o where o.board_id = b.id and o.source = ${m.src} and o.business_id = ${ctx.biz}) as mine
                           from erp_print_board b where b.status = 'open' order by b.created_at desc limit 200`;
  const jobs = [];
  for (const r of open) jobs.push({ id: r.id, jobNo: str(r.job_no), posted: ago(r.created_at), city: str(r.city), material: str(r.material), colour: str(r.colour), qty: num(r.qty), notes: str(r.notes), link: str(r.link), fileName: str(r.file_name), fileUrl: await fileUrl(ctx.deps, r), est: r.est || null, offers: num(r.offers),
    mine: r.mine ? { id: r.mine.id, price: num(r.mine.price), days: r.mine.days == null ? null : num(r.mine.days), note: str(r.mine.note), status: str(r.mine.status) } : null });
  const taken = await ctl`select * from erp_print_board where taken_by = ${m.key} and status in ('taken', 'done') order by taken_at desc limit 100`;
  const mine = [];
  for (const r of taken) {
    const o = (await ctl`select price, days from erp_board_offers where id = ${r.chosen_offer}`)[0] || {};
    const rt = (await ctl`select stars, text from erp_farm_ratings where board_id = ${r.id}`)[0];
    mine.push({ id: r.id, jobNo: str(r.job_no), status: str(r.status), name: str(r.name), phone: str(r.phone), city: str(r.city), material: str(r.material), colour: str(r.colour), qty: num(r.qty), notes: str(r.notes), link: str(r.link), fileName: str(r.file_name), fileUrl: await fileUrl(ctx.deps, r), est: r.est || null,
      price: num(o.price), days: o.days == null ? null : num(o.days), taken: when(r.taken_at), done: when(r.done_at), farmJobNo: str(r.farm_job_no), rating: rt ? { stars: num(rt.stars), text: str(rt.text) } : null });
  }
  return { jobs, mine, rating: await farmRating(ctl, m.src, ctx.biz), boardUrl: base(ctx.deps) + 'print', farm: await farmName(ctx, m.src) };
}
export async function erpBoardOffer(ctx, payload) {
  const m = me(ctx), p = payload || {}, ctl = ctx.deps.control;
  const r = (await ctl`select * from erp_print_board where id = ${str(p.id)}::uuid`)[0];
  if (!r || r.status !== 'open') throw new Error('That job is not open.');
  const price = round2(num(p.price)); if (!(price > 0)) throw new Error('Your price for the whole job.');
  const days = p.days === '' || p.days == null ? null : Math.max(0, Math.min(90, Math.round(num(p.days))));
  const f = await farmName(ctx, m.src);
  await ctl`insert into erp_board_offers (board_id, source, business_id, farm_name, city, price, days, note, status) values (${r.id}, ${m.src}, ${ctx.biz}, ${f.name}, ${f.city || null}, ${price}, ${days}, ${str(p.note).slice(0, 300) || null}, 'offered')
            on conflict (board_id, source, business_id) do update set price = excluded.price, days = excluded.days, note = excluded.note, farm_name = excluded.farm_name, city = excluded.city, status = 'offered', created_at = now()`;
  return { offered: true, price, days };
}
export async function erpBoardWithdraw(ctx, payload) {
  const m = me(ctx);
  const r = await ctx.deps.control`update erp_board_offers set status = 'withdrawn' where board_id = ${str(payload && payload.id)}::uuid and source = ${m.src} and business_id = ${ctx.biz} and status = 'offered' returning id`;
  if (!r.length) throw new Error('No open offer of yours on that job.');
  return { withdrawn: true };
}
export async function erpBoardTake(ctx, payload) {
  const m = me(ctx), p = payload || {}, ctl = ctx.deps.control;
  const r = (await ctl`select * from erp_print_board where id = ${str(p.id)}::uuid and taken_by = ${m.key}`)[0];
  if (!r) throw new Error('That job was not given to you.');
  if (r.farm_job_no) throw new Error('This job is already print job ' + str(r.farm_job_no) + '.');
  const o = (await ctl`select price from erp_board_offers where id = ${r.chosen_offer}`)[0] || {};
  const K = await import('./printkit.js');
  const url = await fileUrl(ctx.deps, r);
  const out = await K.erpPrintJobSave(ctx, { title: str(p.title) || (num(r.qty) + ' × ' + (str(r.material) || 'print') + ' for ' + str(r.name) + ' (' + str(r.job_no) + ')'), customer: r.name, phone: r.phone, printerId: str(p.printerId), spoolId: str(p.spoolId), sku: str(p.sku),
    material: [str(r.material), str(r.colour)].filter(Boolean).join(' '), plannedG: p.plannedG !== undefined ? p.plannedG : (r.est && r.est.grams ? num(r.est.grams) * num(r.qty) : 0), plannedH: p.plannedH !== undefined ? p.plannedH : (r.est && r.est.hours ? num(r.est.hours) * num(r.qty) : 0),
    price: num(o.price), notes: ['Get it printed ' + str(r.job_no), str(r.notes), url ? 'File: ' + url : '', str(r.link) ? 'Link: ' + str(r.link) : ''].filter(Boolean).join('\n'), requestId: r.id, fileName: str(r.file_name) });
  await ctl`update erp_print_board set farm_job_no = ${out.job.jobNo}, updated_at = now() where id = ${r.id}`;
  return out;
}
/** printkit.js calls this when a print job is delivered: the board job it came from is done. */
export async function boardDone(ctx, boardId, jobNo) {
  const src = sourceOf(ctx.deps); if (!src || !boardId) return;
  await ctx.deps.control`update erp_print_board set status = 'done', done_at = now(), farm_job_no = coalesce(farm_job_no, ${str(jobNo)}), updated_at = now() where id = ${String(boardId)}::uuid and taken_by = ${src + ':' + ctx.biz} and status = 'taken'`;
}
export const HANDLERS = { erpBoard, erpBoardOffer, erpBoardWithdraw, erpBoardTake };
