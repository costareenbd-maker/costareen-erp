// ship-8 (owner 28 Nov 2026): the traveller's own page (web/c/). One permanent personal link per traveller; no app, no
// login. Rules (owner's words, BRIEF.md in .impeccable/mocks/traveller-portal-2026-11-28):
//   - without our bag he sees ONLY his own details (and can edit them) + "I can take luggage" requests;
//   - from the moment staff put him on a shipment (carrier set) until staff mark it received, he also sees that
//     shipment: who receives (photo, name, phone), where to meet and how to exit (the airport guide + the shipment's
//     note), flight, our bags with photos, his keyword QR;
//   - he may confirm "I took the bags" once; that never moves the shipment; only staff mark it received;
//   - a new phone opens with a 6-digit code sent on WhatsApp (never with name + phone alone).
//
// Public (index.ts ?inbox=portal&a=..., GET or POST JSON): portalAct(ctx, a, {k, j, body})
//   a=join-info (j)      the business name / logo for the sign-up form
//   a=join (j, body)     sign up: name, phone, addrBd, addrKr, photo, waOk -> { key }; a phone already known -> { exists }
//   a=code (j, body)     send a 6-digit code to that phone on WhatsApp
//   a=verify (j, body)   phone + code -> { key }
//   a=me (k)             everything his page may show now
//   a=save (k, body)     his own details
//   a=request (k, body)  "I can take luggage"
//   a=took (k, body)     he confirms taking a bag (scan or tap), logged only
// ERP: erpShipJoinLink, erpShipPortalLink, erpShipRequests, erpShipRequestSet, erpShipRequestMake, erpShipGuides,
//      erpShipGuideSave, erpShipMeetNote

import { getConfig, setConfig, saveFile, readFile, fileUrl } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { stepNow, personUpsert, erpShipNew, erpShip } from './shipments.js';
import { teamAt, e164 } from './shipteam.js';

const str = (v) => String(v == null ? '' : v).trim();
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const iso = (d) => (d ? new Date(d).toISOString() : null);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const PORTS = ['DAC', 'ICN'];
const DIRS = ['kr_bd', 'bd_kr', 'both'];
// ship-10: the airports a partner may name (Korea, Bangladesh); the shipment itself still runs ICN <-> DAC
export const AIRPORTS = { ICN: ['kr', 9], GMP: ['kr', 9], PUS: ['kr', 9], TAE: ['kr', 9], CJU: ['kr', 9], CJJ: ['kr', 9], MWX: ['kr', 9], YNY: ['kr', 9], DAC: ['bd', 6], CGP: ['bd', 6], ZYL: ['bd', 6] };
const TICKET_MIME = /^(application\/pdf|image\/(jpeg|png|webp))$/;
async function saveTicket(ctx, reqId, f) {
  if (!f || !f.data) return false;
  const mime = str(f.mime), data = str(f.data).replace(/^data:[^,]*,/, '');
  if (!TICKET_MIME.test(mime)) throw new Error('টিকিট PDF বা ছবি (JPG, PNG) হতে হবে।');
  if (data.length > 7_000_000) throw new Error('ফাইলটা অনেক বড় (৫ MB-এর কম দিন)।');
  let bytes; try { const bin = atob(data); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); } catch (_) { throw new Error('ফাইলটা পড়া গেল না। আবার দিন।'); }
  const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1];
  const name = 'ticket_' + reqId + '_' + Date.now() + '.' + ext;
  await saveFile(ctx, 'tickets', name, bytes, mime);
  await ctx.tx`update ship_requests set ticket_file = ${name}, ticket_name = ${str(f.name).slice(0, 120) || name}, ticket_mime = ${mime}, ticket_data = null, ticket_read_at = null, updated_at = now() where id = ${reqId}`;
  return true;
}

function hex(n) { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
async function sha(s) { const h = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join(''); }
async function gate(ctx) {
  if (str(await getConfig(ctx, 'business_kind', '')) !== 'cargo') throw new Error('Shipments are only in the shipment business. Switch to it from the business menu.');
}
function base(ctx) { const app = str(ctx.deps && ctx.deps.google && ctx.deps.google.appUrl); return app ? app.replace(/[#?].*$/, '').replace(/[^/]*$/, '') : ''; }
export function portalUrl(ctx, tok) { const b = base(ctx); return b && tok ? b + 'c/?k=' + tok : ''; }
function joinUrl(ctx, tok) { const b = base(ctx); return b && tok ? b + 'c/?j=' + tok : ''; }
export async function portalToken(ctx, personId) {
  const p = (await ctx.tx`select portal_token from ship_people where business_id = ${ctx.biz} and id = ${personId} and removed_at is null`)[0];
  if (!p) throw new Error('That traveller is not here any more.');
  if (p.portal_token) return p.portal_token;
  const tok = hex(16);
  await ctx.tx`update ship_people set portal_token = ${tok} where id = ${personId} and portal_token is null`;
  return (await ctx.tx`select portal_token from ship_people where id = ${personId}`)[0].portal_token;
}
async function joinToken(ctx) {
  let t = str(await getConfig(ctx, 'ship_join_token', ''));
  if (!t) { t = hex(16); await setConfig(ctx, 'ship_join_token', t); }
  return t;
}
async function logoOf(ctx) {
  try { const q = await import('./quotes.js'); const p = await q.quoteProfile(ctx); return (await q.assetDataUrl(ctx, p.logoTrimId || p.logoId)) || ''; } catch (_) { return ''; }
}
async function sendWa(ctx, phone, text) {
  try {
    const { evoCall, erpEvoStatus } = await import('./campaigns.js');
    if (!(await erpEvoStatus(ctx)).connected) return false;
    const r = await evoCall(ctx, 'POST', '/message/sendText', { number: str(phone).replace(/\D/g, ''), text });
    return r.code === 200 || r.code === 201;
  } catch (_) { return false; }
}
function meOut(p) {
  return { name: p.name, phone: p.phone || '', phoneKr: p.phone_kr || '', phoneBd: p.phone_bd || '',
    waOn: p.phone && p.phone === p.phone_bd && p.phone !== p.phone_kr ? 'bd' : 'kr',
    emName: p.em_name || '', emRelation: p.em_relation || '', emPhone: p.em_phone || '',
    addrBd: p.addr_bd || '', addrKr: p.addr_kr || '', photo: p.photo || '', code: p.code, waOk: !!p.wa_ok };
}
const CONTACT = ['phoneKr', 'phoneBd', 'waOn', 'emName', 'emRelation', 'emPhone'];
function contactOf(b) { const o = {}; for (const k of CONTACT) if (b[k] !== undefined) o[k] = b[k]; return o; }
async function byPhone(ctx, phone) {
  return (await ctx.tx`select * from ship_people where business_id = ${ctx.biz} and removed_at is null and ${phone} in (phone, phone_kr, phone_bd) order by id limit 1`)[0];
}
/** The one shipment he holds now: carrier set by staff, not yet received by staff. */
async function activeTrip(ctx, personId) {
  return (await ctx.tx`select * from ships where business_id = ${ctx.biz} and carrier_id = ${personId} and type = 'trip'
    and received_at is null and checked_at is null order by coalesce(depart_at, created_at) limit 1`)[0] || null;
}
async function guideOf(ctx, port) {
  const g = (await ctx.tx`select * from ship_guides where business_id = ${ctx.biz} and port = ${port}`)[0];
  if (!g) return null;
  return { terminal: g.terminal, meet: g.meet, steps: str(g.steps).split(/\r?\n/).map(str).filter(Boolean), photos: Array.isArray(g.photos) ? g.photos : [] };
}
function reqOut(r) {
  return { id: Number(r.id), direction: r.direction, leaveOn: day(r.leave_on), returnOn: day(r.return_on), flight: r.flight, bags: r.bags, devices: r.devices,
    ownGoods: !!r.own_goods, note: r.note, state: r.state, at: iso(r.created_at), fromAirport: r.from_airport || '', toAirport: r.to_airport || '',
    bagKg: r.bag_kg == null ? null : Number(r.bag_kg), ticket: r.ticket_file ? (r.ticket_name || 'ticket') : '', returnOf: r.return_of == null ? null : Number(r.return_of) };
}
/** What he received from us on one shipment (fee paid to him; customs he paid that we give back). */
function moneyOfShip(s) {
  const out = [];
  if (s.fee_amt != null && Number(s.fee_amt) > 0) out.push({ kind: 'fee', amt: Number(s.fee_amt), cur: s.fee_cur });
  if (s.customs_amt != null && Number(s.customs_amt) > 0 && s.customs_by === 'carrier') out.push({ kind: 'customs', amt: Number(s.customs_amt), cur: 'BDT' });
  return out;
}

async function mePayload(ctx, p) {
  const reqs = await ctx.tx`select * from ship_requests where business_id = ${ctx.biz} and person_id = ${p.id} order by coalesce(leave_on, created_at::date) desc, id desc limit 30`;
  const ships = await ctx.tx`select s.*, (select count(*)::int from ship_trip_bags tb where tb.ship_id = s.id and tb.removed_at is null) as bag_n
    from ships s where s.business_id = ${ctx.biz} and s.carrier_id = ${p.id} and s.type = 'trip' order by coalesce(s.depart_at, s.created_at) desc limit 30`;
  const byId = {}; for (const s of ships) byId[s.id] = s;
  const tripOf = (s) => s ? { code: s.code, from: s.from_port, to: s.to_port, departAt: iso(s.depart_at), landAt: iso(s.land_at), receivedAt: iso(s.received_at), bags: s.bag_n, flightNo: s.flight_no || '', money: moneyOfShip(s) } : null;
  // ship-10: one history - his requests (with the shipment made from them) and shipments staff made for him directly
  const used = {};
  const history = reqs.map((r) => { const s = r.ship_id ? byId[r.ship_id] : null; if (s) used[s.id] = 1;
    return { ...reqOut(r), status: s && s.received_at ? 'done' : r.state, trip: tripOf(s) }; });
  for (const s of ships) if (!used[s.id]) history.push({ id: 0, direction: s.from_port === 'DAC' ? 'bd_kr' : 'kr_bd', leaveOn: day(s.depart_at || s.created_at), fromAirport: s.from_port, toAirport: s.to_port,
    bags: s.bag_n, status: s.received_at ? 'done' : 'made', trip: tripOf(s) });
  history.sort((x, y) => String(y.leaveOn || '').localeCompare(String(x.leaveOn || '')));
  // the way back he only noted: one tap books it (never booked on its own)
  const today = day(ctx.now);
  const back = reqs.find((r) => r.return_on && day(r.return_on) >= today && r.state !== 'no' && !reqs.some((x) => Number(x.return_of) === Number(r.id)));
  const out = { ok: true, biz: { name: str(ctx.s.businessName), logo: await logoOf(ctx), hotline: e164(await getConfig(ctx, 'ship_hotline', '')) },
    me: meOut(p), requests: reqs.map(reqOut), history, returnOffer: back ? { fromId: Number(back.id), on: day(back.return_on), from: back.to_airport || (back.direction === 'bd_kr' ? 'ICN' : 'DAC'), to: back.from_airport || (back.direction === 'bd_kr' ? 'DAC' : 'ICN'), bags: back.bags } : null,
    active: null, thanks: false, at: new Date().toISOString() };
  const s = await activeTrip(ctx, p.id);
  if (s) {
    const bags = await ctx.tx`select b.code, b.nickname, tb.body_no,
        (select f.photo from ship_bag_photos f where f.bag_id = b.id and f.body_no = tb.body_no and f.removed_at is null order by f.id limit 1) as photo
      from ship_trip_bags tb join ship_bags b on b.id = tb.bag_id where tb.ship_id = ${s.id} and tb.removed_at is null order by b.code`;
    const items = await ctx.tx`select place, sum(qty)::int n from ship_items where ship_id = ${s.id} and struck_at is null group by place`;
    const took = (await ctx.tx`select 1 from ship_events where ship_id = ${s.id} and what like 'Traveller confirmed taking%' limit 1`).length > 0;
    out.active = { code: s.code, from: s.from_port, to: s.to_port, flightNo: s.flight_no || '', departAt: iso(s.depart_at), landAt: iso(s.land_at),
      step: stepNow(s, ctx.now), handed: Number(s.step) >= 2, took, meetNote: s.meet_note || '',
      team: (await teamAt(ctx, s.to_port)).map((m) => ({ name: m.name, role: m.role, phone: m.phone, photo: m.photo })),
      guide: await guideOf(ctx, s.to_port),
      bags: bags.map((b) => ({ code: b.code, nickname: b.nickname, bodyNo: b.body_no, photo: b.photo || '' })),
      hand: (items.find((x) => x.place === 'hand') || {}).n || 0, own: (items.find((x) => x.place === 'own') || {}).n || 0 };
  } else {
    out.thanks = (await ctx.tx`select 1 from ships where business_id = ${ctx.biz} and carrier_id = ${p.id} and received_at > now() - interval '2 days' limit 1`).length > 0;
  }
  return out;
}

function bad(status, error, extra) { return { status, body: { ok: false, error, ...(extra || {}) } }; }

/** One public action. The caller (index.ts) already found the business from k or j. */
export async function portalAct(ctx, a, { k, j, body }) {
  const b = body || {};
  if (str(await getConfig(ctx, 'business_kind', '')) !== 'cargo') return bad(404, 'এই লিংকটা খোলা নেই।');
  // ---- with the personal key
  if (k) {
    const p = (await ctx.tx`select * from ship_people where business_id = ${ctx.biz} and portal_token = ${k} and removed_at is null`)[0];
    if (!p) return bad(404, 'এই লিংকটা আর খোলা নেই। আমাদের সাথে যোগাযোগ করুন।');
    if (a === 'me') return { status: 200, body: await mePayload(ctx, p) };
    if (a === 'save') {
      const ph = b.phone === undefined ? p.phone : b.phone;
      const photo = b.photo === undefined ? undefined : str(b.photo);
      if (photo && (!IMG.test(photo) || photo.length > 300000)) return bad(400, 'ছবিটা নেওয়া গেল না। আরেকটা দিন।');
      const two = b.phoneKr !== undefined || b.phoneBd !== undefined;
      if (two && !e164(b.phoneKr) && !e164(b.phoneBd)) return bad(400, 'অন্তত একটা ফোন নম্বর দিন।');
      try { await personUpsert(ctx, { name: b.name === undefined ? p.name : b.name, ...(two ? contactOf(b) : { phone: ph }), email: p.email, city: p.city, waOk: b.waOk === undefined ? p.wa_ok : !!b.waOk, note: p.note, photo, addrBd: b.addrBd, addrKr: b.addrKr, emName: b.emName, emRelation: b.emRelation, emPhone: b.emPhone }, p.id); }
      catch (e) { return bad(400, msgBn(e)); }
      const p2 = (await ctx.tx`select * from ship_people where id = ${p.id}`)[0];
      return { status: 200, body: await mePayload(ctx, p2) };
    }
    if (a === 'request') {
      const dir = DIRS.indexOf(str(b.direction)) >= 0 ? str(b.direction) : 'kr_bd';
      const leave = /^\d{4}-\d\d-\d\d$/.test(str(b.leaveOn)) ? str(b.leaveOn) : null;
      if (!leave) return bad(400, 'যাওয়ার তারিখ দিন।');
      const ret = /^\d{4}-\d\d-\d\d$/.test(str(b.returnOn)) ? str(b.returnOn) : null;
      if (ret && ret < leave) return bad(400, 'ফেরার তারিখ যাওয়ার পরে হবে।');
      if (!b.agree) return bad(400, 'নিয়মে রাজি থাকলে টিক দিন।');
      const open = (await ctx.tx`select count(*)::int n from ship_requests where person_id = ${p.id} and state in ('new', 'talked')`)[0].n;
      if (open >= 3) return bad(400, 'আপনার ৩টা যাত্রা এখনো পর্যালোচনায়। আমরা যোগাযোগ করব।');
      const side = dir === 'bd_kr' ? ['bd', 'kr'] : ['kr', 'bd'];
      const fa = AIRPORTS[str(b.fromAirport)] && AIRPORTS[str(b.fromAirport)][0] === side[0] ? str(b.fromAirport) : (side[0] === 'kr' ? 'ICN' : 'DAC');
      const ta = AIRPORTS[str(b.toAirport)] && AIRPORTS[str(b.toAirport)][0] === side[1] ? str(b.toAirport) : (side[1] === 'kr' ? 'ICN' : 'DAC');
      const kg = b.bagKg === undefined || b.bagKg === '' || b.bagKg === null ? null : Number(b.bagKg);
      if (kg != null && !(kg > 0 && kg <= 50)) return bad(400, 'লাগেজের ওজন ১ থেকে ৫০ কেজির মধ্যে দিন।');
      const id = (await ctx.tx`insert into ship_requests (business_id, person_id, direction, leave_on, return_on, flight, bags, devices, own_goods, note, from_airport, to_airport, bag_kg)
        values (${ctx.biz}, ${p.id}, ${dir}, ${leave}, ${ret}, ${str(b.flight).slice(0, 60)}, ${Math.max(0, Math.min(6, int(b.bags)))}, ${Math.max(0, Math.min(10, int(b.devices)))}, ${!!b.ownGoods}, ${str(b.note).slice(0, 500)}, ${fa}, ${ta}, ${kg})
        returning id`)[0].id;
      try { await saveTicket(ctx, id, b.ticket); } catch (e) { return bad(400, str(e.message)); }
      return { status: 200, body: await mePayload(ctx, p) };
    }
    if (a === 'return') {
      // one tap: the way back of a trip he told us about, with the return date he gave then
      const r0 = (await ctx.tx`select * from ship_requests where business_id = ${ctx.biz} and person_id = ${p.id} and id = ${int(b.fromId)}`)[0];
      if (!r0 || !r0.return_on) return bad(400, 'এই যাত্রায় ফেরার তারিখ দেওয়া নেই।');
      if ((await ctx.tx`select 1 from ship_requests where return_of = ${r0.id}`).length) return bad(400, 'ফেরার যাত্রা আগেই জানানো হয়েছে।');
      const dir2 = r0.direction === 'bd_kr' ? 'kr_bd' : 'bd_kr';
      await ctx.tx`insert into ship_requests (business_id, person_id, direction, leave_on, bags, devices, own_goods, from_airport, to_airport, bag_kg, return_of)
        values (${ctx.biz}, ${p.id}, ${dir2}, ${r0.return_on}, ${r0.bags}, ${r0.devices}, ${r0.own_goods}, ${r0.to_airport || (dir2 === 'bd_kr' ? 'DAC' : 'ICN')}, ${r0.from_airport || (dir2 === 'bd_kr' ? 'ICN' : 'DAC')}, ${r0.bag_kg}, ${r0.id})`;
      return { status: 200, body: await mePayload(ctx, p) };
    }
    if (a === 'ticket') {
      // the e-ticket added later to one of his own trips
      const r0 = (await ctx.tx`select id from ship_requests where business_id = ${ctx.biz} and person_id = ${p.id} and id = ${int(b.requestId)}`)[0];
      if (!r0) return bad(404, 'এই যাত্রা পাওয়া গেল না।');
      try { if (!(await saveTicket(ctx, r0.id, b.ticket))) return bad(400, 'ফাইল দিন।'); } catch (e) { return bad(400, str(e.message)); }
      return { status: 200, body: await mePayload(ctx, p) };
    }
    if (a === 'took') {
      const s = await activeTrip(ctx, p.id);
      if (!s) return bad(400, 'এখন আপনার কাছে আমাদের কোনো লাগেজ নেই।');
      const code = str(b.code).toUpperCase().match(/BG-?\d{1,6}/);
      let what = 'Traveller confirmed taking the bags';
      if (code) {
        const c = 'BG-' + String(int(code[0].replace(/\D/g, ''))).padStart(4, '0');
        const hit = (await ctx.tx`select 1 from ship_trip_bags tb join ship_bags g on g.id = tb.bag_id where tb.ship_id = ${s.id} and tb.removed_at is null and g.code = ${c}`).length;
        if (!hit) return bad(400, 'এই লাগেজটা আপনার চালানে নেই। আমাদের লোককে দেখান।');
        what = 'Traveller confirmed taking ' + c;
      }
      // only a note in the shipment's history: the step, the carrier and "received" never change from here
      await ctx.tx`insert into ship_events (business_id, ship_id, what, by_name) values (${ctx.biz}, ${s.id}, ${what}, ${p.name + ' (' + p.code + ')'})`;
      return { status: 200, body: await mePayload(ctx, p) };
    }
    return bad(400, 'Unknown action.');
  }
  // ---- with the join link
  if (!j || j !== str(await getConfig(ctx, 'ship_join_token', ''))) return bad(404, 'এই লিংকটা খোলা নেই।');
  if (a === 'join-info') return { status: 200, body: { ok: true, biz: { name: str(ctx.s.businessName), logo: await logoOf(ctx) } } };
  if (a === 'join') {
    if (!str(b.name)) return bad(400, 'আপনার নাম লিখুন।');
    const nums = [b.phoneKr, b.phoneBd, b.phone].map(e164).filter(Boolean);
    if ((b.phoneKr || b.phoneBd || b.phone) && !nums.length) return bad(400, 'ফোন নম্বর দেশের কোড সহ লিখুন (যেমন +82 10…, +880 17…)।');
    if (!nums.length) return bad(400, 'অন্তত একটা ফোন নম্বর দিন।');
    const phone = nums[0];
    let had = null; for (const n of nums) { had = had || await byPhone(ctx, n); }
    if (had) return bad(409, 'এই নম্বরে আগেই একজন আছেন। কোড দিয়ে খুলুন।', { exists: true });
    const photo = str(b.photo);
    if (photo && (!IMG.test(photo) || photo.length > 300000)) return bad(400, 'ছবিটা নেওয়া গেল না। আরেকটা দিন।');
    let id;
    try { id = await personUpsert(ctx, { name: b.name, ...(b.phoneKr !== undefined || b.phoneBd !== undefined ? contactOf(b) : { phone }), waOk: !!b.waOk, photo: photo || undefined, addrBd: b.addrBd, addrKr: b.addrKr, emName: b.emName, emRelation: b.emRelation, emPhone: b.emPhone }, 0); }
    catch (e) { return bad(400, msgBn(e)); }
    await ctx.tx`update ship_people set self_joined = true where id = ${id}`;
    const tok = await portalToken(ctx, id);
    const url = portalUrl(ctx, tok);
    const wa = (await ctx.tx`select phone from ship_people where id = ${id}`)[0].phone;
    if (url && b.waOk && wa) await sendWa(ctx, wa, 'আসসালামু আলাইকুম ' + str(b.name) + '। Benndar Express-এ আপনার ট্রাভেল পার্টনার প্রোফাইলের লিংক, রেখে দিন: ' + url);
    return { status: 200, body: { ok: true, key: tok } };
  }
  if (a === 'code') {
    const phone = e164(b.phone);
    const p = phone ? await byPhone(ctx, phone) : null;
    // the same answer whether or not the number is known (no list of our travellers for strangers)
    const okBody = { status: 200, body: { ok: true, sent: true } };
    if (!p) return okBody;
    const recent = (await ctx.tx`select count(*)::int n from ship_portal_codes where person_id = ${p.id} and created_at > now() - interval '1 hour'`)[0].n;
    if (recent >= 3) return bad(429, 'অনেকবার কোড চাওয়া হয়েছে। এক ঘণ্টা পরে আবার চেষ্টা করুন।');
    const code = String(100000 + (parseInt(hex(4), 16) % 900000));
    await ctx.tx`insert into ship_portal_codes (business_id, person_id, code_hash, expires_at) values (${ctx.biz}, ${p.id}, ${await sha(code + ':' + p.id)}, now() + interval '10 minutes')`;
    await sendWa(ctx, p.phone || phone, 'আপনার কোড: ' + code + '\nকাউকে বলবেন না। ১০ মিনিট চলবে।');
    return okBody;
  }
  if (a === 'verify') {
    const phone = e164(b.phone), code = str(b.code).replace(/\D/g, '');
    const p = phone ? await byPhone(ctx, phone) : null;
    const fail = bad(400, 'কোড মেলেনি। আবার দেখুন বা নতুন কোড চান।');
    if (!p || code.length !== 6) return fail;
    const c = (await ctx.tx`select * from ship_portal_codes where person_id = ${p.id} and used_at is null and expires_at > now() order by id desc limit 1`)[0];
    if (!c || c.tries >= 5) return fail;
    if (c.code_hash !== await sha(code + ':' + p.id)) { await ctx.tx`update ship_portal_codes set tries = tries + 1 where id = ${c.id}`; return fail; }
    await ctx.tx`update ship_portal_codes set used_at = now() where id = ${c.id}`;
    return { status: 200, body: { ok: true, key: await portalToken(ctx, p.id) } };
  }
  return bad(400, 'Unknown action.');
}
function msgBn(e) {
  const m = str(e && e.message ? e.message : e);
  if (/phone/i.test(m)) return 'ফোন নম্বর দেশের কোড সহ লিখুন (যেমন +82 10…, +880 17…)।';
  if (/name/i.test(m)) return 'আপনার নাম লিখুন।';
  if (/photo/i.test(m)) return 'ছবিটা নেওয়া গেল না। আরেকটা দিন।';
  return 'সেভ হলো না। একটু পরে আবার চেষ্টা করুন।';
}

// ---------------------------------------------------------------- ERP side
export async function erpShipJoinLink(ctx) {
  await gate(ctx);
  return { url: joinUrl(ctx, await joinToken(ctx)) };
}
export async function erpShipPortalLink(ctx, payload) {
  await gate(ctx);
  const id = int(payload && payload.personId);
  return { url: portalUrl(ctx, await portalToken(ctx, id)) };
}
export async function erpShipRequests(ctx, payload) {
  await gate(ctx);
  const st = str(payload && payload.state);
  const rows = await ctx.tx`select r.*, p.name, p.code, p.phone, p.photo, s.code as ship_code from ship_requests r join ship_people p on p.id = r.person_id
    left join ships s on s.id = r.ship_id where r.business_id = ${ctx.biz} order by (r.state in ('new', 'talked')) desc, r.leave_on nulls last, r.id desc limit 200`;
  return { requests: rows.filter((r) => !st || r.state === st).map((r) => ({ ...reqOut(r), person: { id: Number(r.person_id), name: r.name, code: r.code, phone: r.phone, photo: r.photo || '' }, shipCode: r.ship_code || '',
    ticketData: r.ticket_data || null, ticketReadAt: iso(r.ticket_read_at), ticketAppliedAt: iso(r.ticket_applied_at), ticketAppliedBy: r.ticket_applied_by || '', compare: compareTicket(r) })) };
}
/** What the partner typed next to what his ticket says (staff call him before copying anything). */
function compareTicket(r) {
  const t = r.ticket_data; if (!t) return null;
  const rows = [
    ['যাত্রার তারিখ', day(r.leave_on) || '', str(t.depart_date)],
    ['কোথা থেকে', r.from_airport || '', str(t.from_airport).toUpperCase()],
    ['কোথায়', r.to_airport || '', str(t.to_airport).toUpperCase()],
    ['ফ্লাইট', str(r.flight), [str(t.airline), str(t.flight)].filter(Boolean).join(' ')],
    ['ফেরার তারিখ', day(r.return_on) || '', str(t.return_date)],
    ['লাগেজের ওজন (কেজি)', r.bag_kg == null ? '' : String(Number(r.bag_kg)), t.baggage_kg ? String(Number(t.baggage_kg)) : ''],
  ];
  const norm = (v) => str(v).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return { passenger: str(t.passenger), bookingRef: str(t.booking_ref), departTime: str(t.depart_time), arriveDate: str(t.arrive_date), arriveTime: str(t.arrive_time),
    rows: rows.map(([f, a, b]) => ({ field: f, partner: a, ticket: b, same: !b || norm(a) === norm(b) || (!!a && norm(b).indexOf(norm(a)) >= 0) })) };
}
const TICKET_PROMPT = 'This is a flight e-ticket or itinerary receipt of a passenger flying between South Korea and Bangladesh. Read it and answer JSON only: '
  + '{"passenger": name as printed, "airline": airline name, "flight": flight number of the first leg (e.g. "KE 657"), "from_airport": IATA code of the first departure, '
  + '"to_airport": IATA code of the final arrival of the outbound journey, "depart_date": "YYYY-MM-DD", "depart_time": "HH:MM" local, "arrive_date": "YYYY-MM-DD", "arrive_time": "HH:MM" local, '
  + '"return_date": "YYYY-MM-DD" of the return flight if the ticket has one else "", "booking_ref": booking reference / PNR, "baggage_kg": checked baggage allowance in kg as a number or 0}. '
  + 'Use "" or 0 for anything not printed - never guess.';
/** Staff: read the uploaded ticket with the business's AI (stored; the partner's own answers are not touched). */
export async function erpShipTicketRead(ctx, payload) {
  await gate(ctx);
  const r = (await ctx.tx`select * from ship_requests where business_id = ${ctx.biz} and id = ${int(payload && payload.id)}`)[0];
  if (!r || !r.ticket_file) throw new Error('No ticket on this trip.');
  const bytes = await readFile(ctx, 'tickets', r.ticket_file);
  if (!bytes) throw new Error('The ticket file could not be opened.');
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const data = btoa(bin);
  const { ai } = await import('../lib/ai.js');
  const part = r.ticket_mime === 'application/pdf' ? { type: 'file', mime: 'application/pdf', data, name: r.ticket_name || 'ticket.pdf' } : { type: 'image', mime: r.ticket_mime, data };
  let out;
  try { out = await ai(ctx, { purpose: 'receive', task: 'read', json: true, temperature: 0, maxTokens: 2000, messages: [{ role: 'user', content: [{ type: 'text', text: TICKET_PROMPT }, part] }] }); }
  catch (e) { throw new Error('The AI could not read the ticket. ' + str(e && e.message).slice(0, 160)); }
  const j = out && out.json && typeof out.json === 'object' ? out.json : null;
  if (!j) throw new Error('The AI could not read the ticket. Open it and compare by eye.');
  const clean = {}; for (const k of ['passenger', 'airline', 'flight', 'from_airport', 'to_airport', 'depart_date', 'depart_time', 'arrive_date', 'arrive_time', 'return_date', 'booking_ref']) clean[k] = str(j[k]).slice(0, 80);
  clean.baggage_kg = Number(j.baggage_kg) > 0 && Number(j.baggage_kg) < 100 ? Number(j.baggage_kg) : 0;
  await ctx.tx`update ship_requests set ticket_data = ${ctx.tx.json(clean)}, ticket_read_at = now(), updated_at = now() where id = ${r.id}`;
  return erpShipRequests(ctx, {});
}
/** Staff: a link to open the ticket file. */
export async function erpShipTicketFile(ctx, payload) {
  await gate(ctx);
  const r = (await ctx.tx`select ticket_file from ship_requests where business_id = ${ctx.biz} and id = ${int(payload && payload.id)}`)[0];
  if (!r || !r.ticket_file) throw new Error('No ticket on this trip.');
  return { url: await fileUrl(ctx, 'tickets', r.ticket_file) };
}
function utcOf(dateStr, timeStr, ap) {
  if (!/^\d{4}-\d\d-\d\d$/.test(str(dateStr))) return null;
  const m = /^(\d{1,2}):(\d\d)/.exec(str(timeStr)); if (!m) return null;
  const off = (AIRPORTS[ap] || [0, 6])[1];
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, Number(m[1]) - off, Number(m[2])));
}
/** Staff, after a call with the partner: copy the ticket's details into his trip (and its shipment) in one click. */
export async function erpShipTicketApply(ctx, payload) {
  await gate(ctx);
  const r = (await ctx.tx`select * from ship_requests where business_id = ${ctx.biz} and id = ${int(payload && payload.id)}`)[0];
  if (!r || !r.ticket_data) throw new Error('Read the ticket first.');
  const t = r.ticket_data;
  const f = {};
  if (/^\d{4}-\d\d-\d\d$/.test(str(t.depart_date))) f.leave_on = t.depart_date;
  if (/^\d{4}-\d\d-\d\d$/.test(str(t.return_date))) f.return_on = t.return_date;
  if (AIRPORTS[str(t.from_airport).toUpperCase()]) f.from_airport = str(t.from_airport).toUpperCase();
  if (AIRPORTS[str(t.to_airport).toUpperCase()]) f.to_airport = str(t.to_airport).toUpperCase();
  const fl = [str(t.airline), str(t.flight)].filter(Boolean).join(' ').slice(0, 60); if (fl) f.flight = fl;
  if (t.baggage_kg) f.bag_kg = Number(t.baggage_kg);
  const who = (await ctx.tx`select coalesce(full_name, email) n from profiles where id = ${ctx.s.userId}`)[0];
  await ctx.tx`update ship_requests set ${ctx.tx(f)}, ticket_applied_at = now(), ticket_applied_by = ${str(who && who.n) || str(ctx.s.name)}, updated_at = now() where id = ${r.id}`;
  if (r.ship_id) {
    const dep = utcOf(t.depart_date, t.depart_time, f.from_airport || r.from_airport), land = utcOf(t.arrive_date, t.arrive_time, f.to_airport || r.to_airport);
    const sf = {}; if (str(t.flight)) sf.flight_no = str(t.flight).toUpperCase().slice(0, 20); if (dep) sf.depart_at = dep; if (land && (!dep || land > dep)) sf.land_at = land;
    if (Object.keys(sf).length) { await ctx.tx`update ships set ${ctx.tx(sf)}, updated_at = now() where id = ${r.ship_id} and step < 5`;
      await ctx.tx`insert into ship_events (business_id, ship_id, what, by_name) values (${ctx.biz}, ${r.ship_id}, 'Flight details copied from the ticket', ${str(who && who.n)})`; }
  }
  return erpShipRequests(ctx, {});
}
export async function erpShipRequestSet(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  if (['new', 'talked', 'no'].indexOf(str(p.state)) < 0) throw new Error('Which state?');
  const r = await ctx.tx`update ship_requests set state = ${str(p.state)}, updated_at = now() where business_id = ${ctx.biz} and id = ${int(p.id)} and state <> 'made' returning id`;
  if (!r.length) throw new Error('That request is not open any more.');
  return erpShipRequests(ctx, {});
}
/** "Make shipment": a new shipment with him as the traveller (his page opens the shipment at once). */
export async function erpShipRequestMake(ctx, payload) {
  await gate(ctx);
  const r = (await ctx.tx`select * from ship_requests where business_id = ${ctx.biz} and id = ${int(payload && payload.id)}`)[0];
  if (!r) throw new Error('That request is not here any more.');
  if (r.state === 'made') throw new Error('A shipment was already made from this request.');
  const from = r.direction === 'bd_kr' ? 'DAC' : 'ICN';
  const t = await erpShipNew(ctx, { type: 'trip', from, to: from === 'ICN' ? 'DAC' : 'ICN', personId: Number(r.person_id) });
  if (r.return_on) await ctx.tx`update ships set return_on = ${r.return_on} where id = ${t.id}`;
  await ctx.tx`update ship_requests set state = 'made', ship_id = ${t.id}, updated_at = now() where id = ${r.id}`;
  return erpShip(ctx, { id: t.id });
}
export async function erpShipGuides(ctx) {
  await gate(ctx);
  const out = {};
  for (const port of PORTS) out[port] = (await guideOf(ctx, port)) || { terminal: '', meet: '', steps: [], photos: [] };
  return { guides: out, canEdit: roleAtLeast(ctx.s.role, 'manager'), hotline: str(await getConfig(ctx, 'ship_hotline', '')) };
}
export async function erpShipGuideSave(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  if (p.hotline !== undefined) {
    const h = str(p.hotline) ? e164(p.hotline) : '';
    if (str(p.hotline) && !h) throw new Error('Write the office number with + and the country code.');
    await setConfig(ctx, 'ship_hotline', h);
  }
  if (p.port !== undefined) {
    const port = PORTS.indexOf(str(p.port)) >= 0 ? str(p.port) : '';
    if (!port) throw new Error('Which airport?');
    const photos = (Array.isArray(p.photos) ? p.photos : []).map(str).filter((x) => IMG.test(x) && x.length <= 400000).slice(0, 3);
    const steps = str(p.steps).split(/\r?\n/).map(str).filter(Boolean).slice(0, 12).join('\n');
    await ctx.tx`insert into ship_guides (business_id, port, terminal, meet, steps, photos) values (${ctx.biz}, ${port}, ${str(p.terminal).slice(0, 80)}, ${str(p.meet).slice(0, 300)}, ${steps}, ${ctx.tx.json(photos)})
      on conflict (business_id, port) do update set terminal = excluded.terminal, meet = excluded.meet, steps = excluded.steps, photos = excluded.photos, updated_at = now()`;
  }
  return erpShipGuides(ctx);
}
export async function erpShipMeetNote(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const r = await ctx.tx`update ships set meet_note = ${str(p.note).slice(0, 300)}, updated_at = now() where business_id = ${ctx.biz} and id = ${int(p.id)} returning id`;
  if (!r.length) throw new Error('That shipment is not here any more.');
  return erpShip(ctx, { id: int(p.id) });
}

export const HANDLERS = { erpShipJoinLink, erpShipPortalLink, erpShipRequests, erpShipRequestSet, erpShipRequestMake, erpShipGuides, erpShipGuideSave, erpShipMeetNote, erpShipTicketRead, erpShipTicketFile, erpShipTicketApply };
