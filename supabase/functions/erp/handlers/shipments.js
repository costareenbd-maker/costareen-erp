// ship-1 (owner 27 Nov 2026): the vendor shipment business. Goods we move ourselves between Korea and Bangladesh in a
// traveller's luggage (bag, BG-0001) or by air cargo through a forwarder (air, AC-0001). Only a business of kind
// 'cargo' has these screens. Migration 178.
//
//   erpShips({type?})                     the board: the newest trip of every bag + every cargo, with its place and lateness
//   erpShip({code} | {id})                one trip: items, carrier, money, what happened, earlier trips of the same bag
//   erpShipFind({q})                      code (BG-7, bg0007, a QR link), nickname or AWB -> {code}
//   erpShipNew({type, nickname, from, to, forwarder?, awb?, cartons?, weightKg?})
//   erpShipItems({id, add?: {name, qty, for?}, qty?: {itemId, qty}, strike?: itemId})   while packing only
//   erpShipStep({id, action})             seal | book | pickup | hand | fly | customs | receive
//   erpShipCarrier({id, personId? , person?: {name, phone, email, city, waOk}, flightNo, departAt, landAt, returnOn})
//   erpShipCheck({id, counts: {itemId: got}, finish?})                  counting on arrival; finish = step 6
//   erpShipMoney({id, feeAmt, feeCur, customs: null | 0 | amount, customsBy})
//   erpShipReturn({id})                   the bag's next trip back (new trip, same code, ports swapped)
//   erpShipAir({id, forwarder, awb, cartons, weightKg, trackUrl, landAt})
//   erpShipPeople()                       carriers with trips and what they got from us
//   erpShipPerson({id})                   one carrier: trips, payments (fee + customs paid back), note
//   erpShipPersonSave({id?, name, phone, email, city, waOk, note, photo?})
import { getConfig } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const iso = (d) => (d ? new Date(d).toISOString() : null);
const num = (v) => (v == null ? null : Number(v));
const PORTS = ['ICN', 'DAC'];
const LATE_MS = 4 * 3600e3;   // landed this long ago and nobody has it in hand
const IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

async function gate(ctx) {
  if (str(await getConfig(ctx, 'business_kind', '')) !== 'cargo') throw new Error('Shipments are only in the shipment business. Switch to it from the business menu.');
}
async function whoName(ctx) {
  const r = (await ctx.tx`select full_name, email from profiles where id = ${ctx.s.userId}`)[0];
  return r ? (str(r.full_name) || str(r.email).split('@')[0]) : str(ctx.s.name);
}
async function log(ctx, shipId, what) {
  await ctx.tx`insert into ship_events (business_id, ship_id, what, by_user, by_name) values (${ctx.biz}, ${shipId}, ${what}, ${ctx.s.userId}, ${await whoName(ctx)})`;
}
async function trip(ctx, id) {
  const n = int(id);
  const t = n ? (await ctx.tx`select * from ships where business_id = ${ctx.biz} and id = ${n}`)[0] : null;
  if (!t) throw new Error('That shipment is not here any more. Open the list again.');
  return t;
}
async function touch(ctx, id, fields) {
  if (!Object.keys(fields).length) { await ctx.tx`update ships set updated_at = now() where business_id = ${ctx.biz} and id = ${id}`; return; }
  await ctx.tx`update ships set ${ctx.tx(fields)}, updated_at = now() where business_id = ${ctx.biz} and id = ${id}`;
}
/** The step as of now: a bag in a traveller's hand flies and lands by the flight times. */
export function stepNow(t, now) {
  let s = Number(t.step) || 0;
  const n = now ? new Date(now).getTime() : Date.now();
  if (t.type === 'bag' && s >= 2 && s <= 3) {
    if (t.depart_at && new Date(t.depart_at).getTime() <= n) s = Math.max(s, 3);
    if (t.land_at && new Date(t.land_at).getTime() <= n) s = 4;
  }
  return s;
}
function place(t, s) {
  if (s >= 6) return 'done';
  if (s >= 4) return t.to_port === 'DAC' ? 'bd' : 'kr';
  if (s === 3) return 'air';
  return t.from_port === 'ICN' ? 'kr' : 'bd';
}
function lateOf(t, s, now) {
  return s === 4 && t.land_at && !t.received_at && (new Date(now || Date.now()).getTime() - new Date(t.land_at).getTime()) > LATE_MS;
}
function tripOut(t, extra, now) {
  const s = stepNow(t, now);
  return { id: Number(t.id), code: t.code, tripNo: t.trip_no, type: t.type, nickname: t.nickname, from: t.from_port, to: t.to_port, step: s,
    place: place(t, s), late: !!lateOf(t, s, now), carrierId: t.carrier_id == null ? null : Number(t.carrier_id), flightNo: t.flight_no,
    departAt: iso(t.depart_at), landAt: iso(t.land_at), returnOn: t.return_on ? iso(t.return_on).slice(0, 10) : null,
    forwarder: t.forwarder, awb: t.awb, cartons: t.cartons, weightKg: num(t.weight_kg), trackUrl: t.track_url,
    fee: t.fee_amt == null ? null : { amt: Number(t.fee_amt), cur: t.fee_cur },
    customs: t.customs_amt == null ? null : { amt: Number(t.customs_amt), by: t.customs_by, photo: !!t.customs_photo },
    receivedAt: iso(t.received_at), checkedAt: iso(t.checked_at), updatedAt: iso(t.updated_at), ...(extra || {}) };
}
function normCode(q) {
  const s = str(q).toUpperCase();
  const m = s.match(/\b(BG|AC)[-\s]?(\d{1,6})\b/) || s.match(/\/T\/(BG|AC)-?(\d{1,6})/);
  if (m) return m[1] + '-' + String(int(m[2])).padStart(4, '0');
  if (/^\d{1,6}$/.test(s)) return 'BG-' + String(int(s)).padStart(4, '0');
  return '';
}

export async function erpShips(ctx, payload) {
  await gate(ctx);
  const type = str(payload && payload.type);
  const rows = await ctx.tx`select distinct on (s.code) s.*,
      (select count(*)::int from ship_items i where i.ship_id = s.id and i.struck_at is null) as kinds,
      (select coalesce(sum(qty), 0)::int from ship_items i where i.ship_id = s.id and i.struck_at is null) as pieces,
      (select name from ship_people p where p.id = s.carrier_id) as carrier_name
    from ships s where s.business_id = ${ctx.biz} order by s.code, s.trip_no desc`;
  const out = rows.filter((t) => !type || t.type === type)
    .map((t) => tripOut(t, { kinds: t.kinds, pieces: t.pieces, carrierName: t.carrier_name || '' }, ctx.now))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return { ships: out, people: (await ctx.tx`select count(*)::int as n from ship_people where business_id = ${ctx.biz} and removed_at is null`)[0].n };
}

export async function erpShip(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  let t;
  if (p.id) t = await trip(ctx, p.id);
  else {
    const code = normCode(p.code);
    t = code ? (await ctx.tx`select * from ships where business_id = ${ctx.biz} and code = ${code} order by trip_no desc limit 1`)[0] : null;
    if (!t) throw new Error('No shipment with that code.');
  }
  const items = await ctx.tx`select id, name, qty, got_qty, for_label from ship_items where ship_id = ${t.id} and struck_at is null order by id`;
  const events = await ctx.tx`select what, by_name, at from ship_events where ship_id = ${t.id} order by id`;
  const carrier = t.carrier_id ? (await ctx.tx`select id, name, phone, email, city, wa_ok, (photo is not null) as has_photo from ship_people where id = ${t.carrier_id}`)[0] : null;
  const trips = await ctx.tx`select id, trip_no, from_port, to_port, step, checked_at from ships where business_id = ${ctx.biz} and code = ${t.code} order by trip_no desc`;
  return tripOut(t, {
    items: items.map((i) => ({ id: Number(i.id), name: i.name, qty: i.qty, got: i.got_qty, for: i.for_label })),
    events: events.map((e) => ({ what: e.what, by: e.by_name, at: iso(e.at) })),
    carrier: carrier ? { id: Number(carrier.id), name: carrier.name, phone: carrier.phone, email: carrier.email, city: carrier.city, waOk: carrier.wa_ok, photo: carrier.has_photo } : null,
    trips: trips.map((x) => ({ id: Number(x.id), tripNo: x.trip_no, from: x.from_port, to: x.to_port, step: x.step, done: !!x.checked_at })),
  }, ctx.now);
}

export async function erpShipFind(ctx, payload) {
  await gate(ctx);
  const q = str(payload && payload.q);
  if (!q) throw new Error('Type a code, a nickname or an AWB number.');
  const code = normCode(q);
  if (code) {
    const r = (await ctx.tx`select code from ships where business_id = ${ctx.biz} and code = ${code} limit 1`)[0];
    if (r) return { code: r.code };
  }
  const digits = q.replace(/\D/g, '');
  const r = (await ctx.tx`select code from ships where business_id = ${ctx.biz}
      and (lower(replace(nickname, ' ', '')) = ${q.toLowerCase().replace(/\s/g, '')}
           or (${digits.length >= 6} and regexp_replace(awb, '[^0-9]', '', 'g') = ${digits}))
      order by updated_at desc limit 1`)[0];
  if (!r) throw new Error('Nothing found for "' + q.slice(0, 40) + '". Check the code on the tag.');
  return { code: r.code };
}

export async function erpShipNew(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const type = p.type === 'air' ? 'air' : 'bag';
  const from = PORTS.includes(p.from) ? p.from : 'ICN', to = PORTS.includes(p.to) ? p.to : (from === 'ICN' ? 'DAC' : 'ICN');
  if (from === to) throw new Error('From and to are the same airport.');
  const nickname = str(p.nickname).slice(0, 60);
  if (type === 'bag' && !nickname) throw new Error('Give the bag a nickname you can see (for example: blue big).');
  const pre = type === 'air' ? 'AC-' : 'BG-';
  await ctx.tx`select pg_advisory_xact_lock(hashtext(${'ships:' + ctx.biz}))`;
  const last = (await ctx.tx`select coalesce(max(substring(code from 4)::int), 0) as n from ships where business_id = ${ctx.biz} and code like ${pre + '%'}`)[0].n;
  const code = pre + String(Number(last) + 1).padStart(4, '0');
  const row = (await ctx.tx`insert into ships (business_id, code, type, nickname, from_port, to_port, forwarder, awb, cartons, weight_kg, created_by)
    values (${ctx.biz}, ${code}, ${type}, ${nickname}, ${from}, ${to}, ${str(p.forwarder).slice(0, 80)}, ${str(p.awb).slice(0, 40)},
            ${p.cartons ? int(p.cartons) : null}, ${p.weightKg ? Number(p.weightKg) : null}, ${ctx.s.userId}) returning id`)[0];
  await log(ctx, row.id, type === 'air' ? 'Air cargo made' : 'Bag made, packing started');
  return erpShip(ctx, { id: row.id });
}

export async function erpShipItems(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const t = await trip(ctx, p.id);
  if (t.step > 0) throw new Error('This shipment is sealed. Items cannot change now.');
  if (p.add) {
    const name = str(p.add.name).slice(0, 160), qty = int(p.add.qty) || 1;
    if (!name) throw new Error('Type the product name.');
    if (qty < 1 || qty > 100000) throw new Error('How many? A number from 1.');
    const n = (await ctx.tx`select count(*)::int as n from ship_items where ship_id = ${t.id} and struck_at is null`)[0].n;
    if (n >= 200) throw new Error('At most 200 lines in one shipment.');
    await ctx.tx`insert into ship_items (business_id, ship_id, name, qty, for_label) values (${ctx.biz}, ${t.id}, ${name}, ${qty}, ${str(p.add.for).slice(0, 40)})`;
  }
  if (p.qty) {
    const q = int(p.qty.qty);
    if (q < 0 || q > 100000) throw new Error('How many? A number from 0.');
    await ctx.tx`update ship_items set qty = ${q} where ship_id = ${t.id} and id = ${int(p.qty.itemId)} and struck_at is null`;
  }
  if (p.strike) await ctx.tx`update ship_items set struck_at = now() where ship_id = ${t.id} and id = ${int(p.strike)}`;
  await touch(ctx, t.id, {});
  return erpShip(ctx, { id: t.id });
}

const NEXT = {
  bag: { seal: [0, 1, 'Sealed'], hand: [1, 2, 'Handed to the carrier (scan)'], fly: [2, 3, 'Flight left'], receive: [-1, 5, 'In hand (scan) - shipment complete'] },
  air: { book: [0, 1, 'Booked with the forwarder'], pickup: [1, 2, 'Picked up'], fly: [2, 3, 'Flight left'], customs: [3, 4, 'Landed, at customs'], receive: [-1, 5, 'In hand - shipment complete'] },
};
export async function erpShipStep(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const t = await trip(ctx, p.id);
  const rule = (NEXT[t.type] || {})[str(p.action)];
  if (!rule) throw new Error('That step does not fit this shipment.');
  const s = stepNow(t, ctx.now);
  const [need, to, what] = rule;
  if (need === -1) { if (s < 2 || s >= 5) throw new Error(s >= 5 ? 'Already in hand.' : 'It has not left yet.'); }
  else if (s !== need) throw new Error('Do the steps in order: this shipment is at step ' + (s + 1) + '.');
  if (t.type === 'bag' && str(p.action) === 'seal') {
    const n = (await ctx.tx`select count(*)::int as n from ship_items where ship_id = ${t.id} and struck_at is null and qty > 0`)[0].n;
    if (!n) throw new Error('Add what is inside before sealing.');
  }
  if (t.type === 'bag' && str(p.action) === 'hand' && !t.carrier_id) throw new Error('Choose who carries it first.');
  const f = { step: to };
  if (to === 5) f.received_at = new Date();
  await touch(ctx, t.id, f);
  await log(ctx, t.id, what);
  return erpShip(ctx, { id: t.id });
}

function when(v, label) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error(label + ': that date and time is not clear.');
  return d;
}
async function personUpsert(ctx, pp, id) {
  const name = str(pp.name).slice(0, 80);
  if (!name) throw new Error('Type the carrier’s name.');
  const phone = str(pp.phone).replace(/[^\d+ -]/g, '').slice(0, 24), email = str(pp.email).slice(0, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That email does not look right.');
  const photo = pp.photo === undefined ? undefined : str(pp.photo);
  if (photo && (!IMG.test(photo) || photo.length > 150000)) throw new Error('That photo could not be used. Try another one.');
  const f = { name, phone, email, city: str(pp.city).slice(0, 60), wa_ok: !!pp.waOk, note: str(pp.note).slice(0, 1000) };
  if (photo !== undefined) f.photo = photo || null;
  if (id) {
    const r = await ctx.tx`update ship_people set ${ctx.tx(f)} where business_id = ${ctx.biz} and id = ${int(id)} and removed_at is null returning id`;
    if (!r.length) throw new Error('That carrier is not here any more.');
    return Number(r[0].id);
  }
  return Number((await ctx.tx`insert into ship_people ${ctx.tx({ business_id: ctx.biz, ...f })} returning id`)[0].id);
}
export async function erpShipCarrier(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const t = await trip(ctx, p.id);
  if (t.type !== 'bag') throw new Error('Air cargo has a forwarder, not a carrier.');
  if (t.step >= 5) throw new Error('This trip is finished.');
  let pid = int(p.personId);
  if (pid) { if (!(await ctx.tx`select 1 from ship_people where business_id = ${ctx.biz} and id = ${pid} and removed_at is null`).length) throw new Error('That carrier is not here any more.'); }
  else if (p.person) pid = await personUpsert(ctx, p.person, 0);
  else throw new Error('Who carries it?');
  const dep = when(p.departAt, 'Leaves'), land = when(p.landAt, 'Lands');
  if (dep && land && land <= dep) throw new Error('Landing must be after leaving.');
  const ret = p.returnOn ? when(p.returnOn, 'Return flight') : null;
  await touch(ctx, t.id, { carrier_id: pid, flight_no: str(p.flightNo).toUpperCase().slice(0, 20), depart_at: dep, land_at: land, return_on: ret });
  const nm = (await ctx.tx`select name from ship_people where id = ${pid}`)[0].name;
  await log(ctx, t.id, 'Carrier: ' + nm + (p.flightNo ? ' · ' + str(p.flightNo).toUpperCase() : ''));
  return erpShip(ctx, { id: t.id });
}

export async function erpShipAir(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const t = await trip(ctx, p.id);
  if (t.type !== 'air') throw new Error('This is a bag, not air cargo.');
  const url = str(p.trackUrl);
  if (url && !/^https:\/\/[^\s]+$/.test(url)) throw new Error('The tracking link must start with https://');
  await touch(ctx, t.id, { forwarder: str(p.forwarder).slice(0, 80), awb: str(p.awb).slice(0, 40), cartons: p.cartons ? int(p.cartons) : null,
    weight_kg: p.weightKg ? Number(p.weightKg) : null, track_url: url.slice(0, 300), land_at: when(p.landAt, 'Lands') });
  await log(ctx, t.id, 'Cargo details saved');
  return erpShip(ctx, { id: t.id });
}

export async function erpShipCheck(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const t = await trip(ctx, p.id);
  if (t.step < 5) throw new Error('Mark it "in hand" first, then count.');
  if (t.step >= 6) throw new Error('Counting is already finished.');
  const counts = p.counts && typeof p.counts === 'object' ? p.counts : {};
  for (const [k, v] of Object.entries(counts)) {
    const g = v === null || v === '' ? null : int(v);
    if (g != null && (g < 0 || g > 100000)) throw new Error('A count from 0.');
    await ctx.tx`update ship_items set got_qty = ${g} where ship_id = ${t.id} and id = ${int(k)} and struck_at is null`;
  }
  if (p.finish) {
    const items = await ctx.tx`select name, qty, got_qty from ship_items where ship_id = ${t.id} and struck_at is null`;
    if (items.some((i) => i.got_qty == null)) throw new Error('Count every line first (or press "all match").');
    const off = items.filter((i) => i.got_qty !== i.qty);
    await touch(ctx, t.id, { step: 6, checked_at: new Date() });
    await log(ctx, t.id, off.length ? 'Counted: ' + off.length + ' line(s) do not match - ' + off.map((i) => i.name + ' ' + i.got_qty + '/' + i.qty).join(', ').slice(0, 300) : 'Counted: everything matches');
  } else await touch(ctx, t.id, {});
  return erpShip(ctx, { id: t.id });
}

export async function erpShipMoney(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const t = await trip(ctx, p.id);
  const f = {};
  if (p.feeAmt !== undefined) {
    const a = p.feeAmt === null || p.feeAmt === '' ? null : Number(p.feeAmt);
    if (a != null && (!Number.isFinite(a) || a < 0 || a > 1e10)) throw new Error('The fee must be a number from 0.');
    f.fee_amt = a;
    if (p.feeCur) { if (!['KRW', 'BDT', 'USD'].includes(p.feeCur)) throw new Error('Won, taka or dollar?'); f.fee_cur = p.feeCur; }
  }
  if (p.customs !== undefined) {
    const c = p.customs === null || p.customs === '' ? null : Number(p.customs);
    if (c != null && (!Number.isFinite(c) || c < 0 || c > 1e9)) throw new Error('Customs duty must be a number from 0 (0 = nothing to pay).');
    f.customs_amt = c;
    if (p.customsBy) { if (!['carrier', 'us'].includes(p.customsBy)) throw new Error('Who paid the customs?'); f.customs_by = p.customsBy; }
  }
  if (p.customsPhoto !== undefined) {
    const ph = str(p.customsPhoto);
    if (ph && (!IMG.test(ph) || ph.length > 400000)) throw new Error('That receipt photo could not be used.');
    f.customs_photo = ph || null;
  }
  if (!Object.keys(f).length) throw new Error('Nothing to save.');
  await touch(ctx, t.id, f);
  const bits = [];
  if ('fee_amt' in f) bits.push((t.type === 'air' ? 'Freight ' : 'Fee ') + (f.fee_amt == null ? 'cleared' : (f.fee_cur || t.fee_cur) + ' ' + f.fee_amt));
  if ('customs_amt' in f) bits.push('Customs ' + (f.customs_amt == null ? 'cleared' : f.customs_amt === 0 ? 'BDT 0 (nothing to pay)' : 'BDT ' + f.customs_amt));
  if (bits.length) await log(ctx, t.id, bits.join(' · '));
  return erpShip(ctx, { id: t.id });
}

export async function erpShipReturn(ctx, payload) {
  await gate(ctx);
  const t = await trip(ctx, (payload || {}).id);
  if (t.type !== 'bag') throw new Error('Only a bag makes a return trip.');
  if (t.step < 6) throw new Error('Finish counting this trip first.');
  const newer = (await ctx.tx`select 1 from ships where business_id = ${ctx.biz} and code = ${t.code} and trip_no > ${t.trip_no}`).length;
  if (newer) throw new Error('The next trip of this bag is already open.');
  const row = (await ctx.tx`insert into ships (business_id, code, trip_no, type, nickname, from_port, to_port, created_by)
    values (${ctx.biz}, ${t.code}, ${t.trip_no + 1}, 'bag', ${t.nickname}, ${t.to_port}, ${t.from_port}, ${ctx.s.userId}) returning id`)[0];
  await log(ctx, row.id, 'Return trip: packing started');
  return erpShip(ctx, { id: row.id });
}

async function peopleStats(ctx, id) {
  return ctx.tx`select s.id, s.code, s.trip_no, s.type, s.from_port, s.to_port, s.step, s.depart_at, s.land_at, s.created_at, s.checked_at,
      s.fee_amt, s.fee_cur, s.customs_amt, s.customs_by, s.carrier_id
    from ships s where s.business_id = ${ctx.biz} and s.carrier_id ${id ? ctx.tx`= ${id}` : ctx.tx`is not null`} order by coalesce(s.depart_at, s.created_at) desc`;
}
function moneyOf(trips) {
  const tot = {};
  const pays = [];
  for (const s of trips) {
    if (s.fee_amt != null && Number(s.fee_amt) > 0) { tot[s.fee_cur] = (tot[s.fee_cur] || 0) + Number(s.fee_amt); pays.push({ code: s.code, tripNo: s.trip_no, kind: 'fee', amt: Number(s.fee_amt), cur: s.fee_cur, at: iso(s.depart_at || s.created_at) }); }
    if (s.customs_amt != null && Number(s.customs_amt) > 0 && s.customs_by === 'carrier') { tot.BDT = (tot.BDT || 0) + Number(s.customs_amt); pays.push({ code: s.code, tripNo: s.trip_no, kind: 'customs', amt: Number(s.customs_amt), cur: 'BDT', at: iso(s.land_at || s.created_at) }); }
  }
  return { total: tot, pays };
}
export async function erpShipPeople(ctx) {
  await gate(ctx);
  const people = await ctx.tx`select id, name, phone, email, city, wa_ok, created_at from ship_people where business_id = ${ctx.biz} and removed_at is null order by name`;
  const trips = await peopleStats(ctx, 0);
  return { people: people.map((p) => {
    const mine = trips.filter((s) => Number(s.carrier_id) === Number(p.id));
    const m = moneyOf(mine);
    return { id: Number(p.id), name: p.name, phone: p.phone, email: p.email, city: p.city, waOk: p.wa_ok, trips: mine.length,
      lastAt: mine[0] ? iso(mine[0].depart_at || mine[0].created_at) : null, total: m.total, active: mine.some((s) => !s.checked_at) };
  }) };
}
export async function erpShipPerson(ctx, payload) {
  await gate(ctx);
  const id = int(payload && payload.id);
  const p = (await ctx.tx`select * from ship_people where business_id = ${ctx.biz} and id = ${id}`)[0];
  if (!p) throw new Error('That carrier is not here any more.');
  const trips = await peopleStats(ctx, id);
  const m = moneyOf(trips);
  return { id: Number(p.id), name: p.name, phone: p.phone, email: p.email, city: p.city, waOk: p.wa_ok, note: p.note, photo: p.photo || '',
    since: iso(p.created_at), removed: !!p.removed_at, total: m.total, pays: m.pays,
    trips: trips.map((s) => ({ id: Number(s.id), code: s.code, tripNo: s.trip_no, from: s.from_port, to: s.to_port, step: stepNow(s, ctx.now), at: iso(s.depart_at || s.created_at), done: !!s.checked_at })) };
}
export async function erpShipPersonSave(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const id = await personUpsert(ctx, p, int(p.id));
  return erpShipPerson(ctx, { id });
}

export const HANDLERS = { erpShips, erpShip, erpShipFind, erpShipNew, erpShipItems, erpShipStep, erpShipCarrier, erpShipAir, erpShipCheck, erpShipMoney, erpShipReturn, erpShipPeople, erpShipPerson, erpShipPersonSave };
