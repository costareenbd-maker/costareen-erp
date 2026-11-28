// ship-1/ship-2 (owner 27 Nov 2026): the vendor shipment business. Goods we move ourselves between Korea and
// Bangladesh. One shipment (TR-0001) = one traveller on one flight, carrying any number of our bags plus loose things
// (in hand, in the traveller's own bag); or one air cargo (AC-0001) through a forwarder. Only a business of kind
// 'cargo' has these screens. Migrations 178 + 179.
// Codes that never change: a bag's code + QR (BG-0007; a replaced physical bag only raises its bag number) and a
// traveller's keyword + QR card (C-0007). Scanning either opens the shipment they are in now.
//
//   erpShips({type?})                    the board: open shipments + recently finished ones
//   erpShip({code} | {id})               one shipment: bags, items by place, traveller, money, what happened
//   erpShipFind({q})                     any code, QR link, nickname, phone or AWB -> {kind: trip|bag|person, code, id, choices?}
//   erpShipNew({type: trip|air, from, to, personId?, forwarder?, awb?, cartons?, weightKg?})
//   erpShipItems({id, add?: {name, qty, for?, place: bag|hand|own|cargo, bagId?}, qty?: {itemId, qty}, strike?: itemId})
//   erpShipBagAdd({id, bagId? | nickname?})  /  erpShipBagRemove({id, bagId})     while packing
//   erpShipStep({id, action})            seal | book | pickup | hand | fly | customs | receive
//   erpShipCarrier({id, personId? | person?, flightNo, departAt, landAt, returnOn})
//   erpShipAir({id, ...}) · erpShipCheck({id, counts, finish?}) · erpShipMoney({id, ...})
//   erpShipReturn({id})                  the way back: a new shipment with the same bags, airports swapped
//   erpShipBags() · erpShipBag({code}) · erpShipBagNew({nickname}) · erpShipBagSave({id, nickname}) · erpShipBagReplace({id, reason, nickname?})
//   erpShipPeople() · erpShipPerson({id}) · erpShipPersonSave({id?, name, phone, email, city, waOk, note, photo?})
import { getConfig } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const iso = (d) => (d ? new Date(d).toISOString() : null);
const num = (v) => (v == null ? null : Number(v));
const PORTS = ['ICN', 'DAC'];
const PLACES = ['bag', 'hand', 'own', 'cargo'];
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
async function nextCode(ctx, table, pre) {
  await ctx.tx`select pg_advisory_xact_lock(hashtext(${table + ':' + ctx.biz}))`;
  const q = table === 'ship_bags'
    ? ctx.tx`select coalesce(max(substring(code from 4)::int), 0) as n from ship_bags where business_id = ${ctx.biz} and code like ${pre + '%'}`
    : table === 'ship_people'
      ? ctx.tx`select coalesce(max(substring(code from 3)::int), 0) as n from ship_people where business_id = ${ctx.biz} and code like ${pre + '%'}`
      : ctx.tx`select coalesce(max(substring(code from 4)::int), 0) as n from ships where business_id = ${ctx.biz} and code like ${pre + '%'}`;
  return pre + String(Number((await q)[0].n) + 1).padStart(4, '0');
}
/** The step as of now: a traveller's shipment flies and lands by the flight times. */
export function stepNow(t, now) {
  let s = Number(t.step) || 0;
  const n = now ? new Date(now).getTime() : Date.now();
  if (t.type === 'trip' && s >= 2 && s <= 3) {
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
  return { id: Number(t.id), code: t.code, type: t.type, nickname: t.nickname, from: t.from_port, to: t.to_port, step: s,
    place: place(t, s), late: !!lateOf(t, s, now), carrierId: t.carrier_id == null ? null : Number(t.carrier_id), flightNo: t.flight_no,
    departAt: iso(t.depart_at), landAt: iso(t.land_at), returnOn: t.return_on ? iso(t.return_on).slice(0, 10) : null,
    forwarder: t.forwarder, awb: t.awb, cartons: t.cartons, weightKg: num(t.weight_kg), trackUrl: t.track_url,
    fee: t.fee_amt == null ? null : { amt: Number(t.fee_amt), cur: t.fee_cur },
    customs: t.customs_amt == null ? null : { amt: Number(t.customs_amt), by: t.customs_by, photo: !!t.customs_photo },
    receivedAt: iso(t.received_at), checkedAt: iso(t.checked_at), updatedAt: iso(t.updated_at), ...(extra || {}) };
}
export function normCode(q) {
  const s = str(q).toUpperCase();
  const m = s.match(/(?:^|[^A-Z])(BG|AC|TR|C)[-\s]?(\d{1,6})\b/);
  if (m) return m[1] + '-' + String(int(m[2])).padStart(4, '0');
  return '';
}

export async function erpShips(ctx, payload) {
  await gate(ctx);
  const type = str(payload && payload.type);
  const rows = await ctx.tx`select s.*,
      (select count(*)::int from ship_items i where i.ship_id = s.id and i.struck_at is null) as kinds,
      (select coalesce(sum(qty), 0)::int from ship_items i where i.ship_id = s.id and i.struck_at is null) as pieces,
      (select count(*)::int from ship_trip_bags tb where tb.ship_id = s.id and tb.removed_at is null) as bags,
      (select string_agg(b.code, ' ' order by b.code) from ship_trip_bags tb join ship_bags b on b.id = tb.bag_id where tb.ship_id = s.id and tb.removed_at is null) as bag_codes,
      p.name as carrier_name, p.code as carrier_code
    from ships s left join ship_people p on p.id = s.carrier_id
    where s.business_id = ${ctx.biz} and (s.checked_at is null or s.checked_at > now() - interval '30 days')
    order by s.updated_at desc limit 300`;
  return { ships: rows.filter((t) => !type || t.type === type).map((t) => tripOut(t, { kinds: t.kinds, pieces: t.pieces, bags: t.bags, bagCodes: t.bag_codes || '',
    carrierName: t.carrier_name || '', carrierCode: t.carrier_code || '' }, ctx.now)) };
}

async function bagsOf(ctx, shipId) {
  return ctx.tx`select b.id, b.code, b.nickname, b.body_no as now_body, b.retired_at, tb.body_no,
                  (select f.thumb from ship_bag_photos f where f.bag_id = b.id and f.body_no = tb.body_no and f.removed_at is null order by f.id limit 1) as thumb
                from ship_trip_bags tb join ship_bags b on b.id = tb.bag_id
                where tb.ship_id = ${shipId} and tb.removed_at is null order by b.code`;
}
export async function erpShip(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  let t;
  if (p.id) t = await trip(ctx, p.id);
  else {
    const code = normCode(p.code);
    t = code ? (await ctx.tx`select * from ships where business_id = ${ctx.biz} and code = ${code}`)[0] : null;
    if (!t) throw new Error('No shipment with that code.');
  }
  const items = await ctx.tx`select id, name, qty, got_qty, for_label, place, bag_id from ship_items where ship_id = ${t.id} and struck_at is null order by id`;
  const events = await ctx.tx`select what, by_name, at from ship_events where ship_id = ${t.id} order by id`;
  const carrier = t.carrier_id ? (await ctx.tx`select id, code, name, phone, email, city, wa_ok from ship_people where id = ${t.carrier_id}`)[0] : null;
  const bags = await bagsOf(ctx, t.id);
  return tripOut(t, {
    bags: bags.map((b) => ({ id: Number(b.id), code: b.code, nickname: b.nickname, bodyNo: b.body_no, nowBody: b.now_body, thumb: b.thumb || '' })),
    items: items.map((i) => ({ id: Number(i.id), name: i.name, qty: i.qty, got: i.got_qty, for: i.for_label, place: i.place, bagId: i.bag_id == null ? null : Number(i.bag_id) })),
    events: events.map((e) => ({ what: e.what, by: e.by_name, at: iso(e.at) })),
    carrier: carrier ? { id: Number(carrier.id), code: carrier.code, name: carrier.name, phone: carrier.phone, email: carrier.email, city: carrier.city, waOk: carrier.wa_ok } : null,
  }, ctx.now);
}

async function openTripsOfBag(ctx, bagId) {
  return ctx.tx`select s.code from ship_trip_bags tb join ships s on s.id = tb.ship_id where tb.bag_id = ${bagId} and tb.removed_at is null and s.checked_at is null order by s.id desc`;
}
export async function erpShipFind(ctx, payload) {
  await gate(ctx);
  const q = str(payload && payload.q);
  if (!q) throw new Error('Type a code, a keyword, a nickname, a phone number or an AWB.');
  const code = normCode(q);
  if (code.startsWith('TR-') || code.startsWith('AC-')) {
    const r = (await ctx.tx`select code from ships where business_id = ${ctx.biz} and code = ${code}`)[0];
    if (r) return { kind: 'trip', code: r.code };
  }
  if (code.startsWith('BG-')) {
    const b = (await ctx.tx`select id, code from ship_bags where business_id = ${ctx.biz} and code = ${code}`)[0];
    if (b) { const o = await openTripsOfBag(ctx, b.id); return o.length ? { kind: 'trip', code: o[0].code, bag: b.code } : { kind: 'bag', code: b.code }; }
  }
  let person = null;
  if (code.startsWith('C-')) person = (await ctx.tx`select id, code, name from ship_people where business_id = ${ctx.biz} and code = ${code} and removed_at is null`)[0];
  const digits = q.replace(/\D/g, '');
  if (!person && !code && digits.length >= 7) person = (await ctx.tx`select id, code, name from ship_people where business_id = ${ctx.biz} and removed_at is null and ${digits.slice(-9)} in (right(regexp_replace(phone, '[^0-9]', '', 'g'), 9), right(regexp_replace(phone_kr, '[^0-9]', '', 'g'), 9), right(regexp_replace(phone_bd, '[^0-9]', '', 'g'), 9)) limit 1`)[0];
  if (person) {
    const open = await ctx.tx`select code, from_port, to_port, flight_no from ships where business_id = ${ctx.biz} and carrier_id = ${person.id} and checked_at is null order by id`;
    if (open.length === 1) return { kind: 'trip', code: open[0].code, person: person.code };
    return { kind: 'person', id: Number(person.id), code: person.code, choices: open.map((o) => ({ code: o.code, from: o.from_port, to: o.to_port, flightNo: o.flight_no })) };
  }
  const low = q.toLowerCase().replace(/\s/g, '');
  const bag = (await ctx.tx`select id, code from ship_bags where business_id = ${ctx.biz} and lower(replace(nickname, ' ', '')) = ${low} limit 1`)[0];
  if (bag) { const o = await openTripsOfBag(ctx, bag.id); return o.length ? { kind: 'trip', code: o[0].code, bag: bag.code } : { kind: 'bag', code: bag.code }; }
  if (digits.length >= 6) {
    const r = (await ctx.tx`select code from ships where business_id = ${ctx.biz} and regexp_replace(awb, '[^0-9]', '', 'g') = ${digits} order by id desc limit 1`)[0];
    if (r) return { kind: 'trip', code: r.code };
  }
  throw new Error('Nothing found for "' + q.slice(0, 40) + '". Check the code on the tag or card.');
}

export async function personUpsert(ctx, pp, id) {
  const name = str(pp.name).slice(0, 80);
  if (!name) throw new Error('Type the traveller’s name.');
  const { e164 } = await import('./shipteam.js');
  const num = (v, what) => { const s = str(v); if (!s) return ''; const e = e164(s); if (!e) throw new Error('Write the ' + what + ' with + and the country code (for example +82 10.., +880 17..).'); return e; };
  // ship-9: two numbers (Korea, Bangladesh); phone = the WhatsApp one. Old callers still send one 'phone'.
  let phone, kr, bd;
  if (pp.phoneKr !== undefined || pp.phoneBd !== undefined) {
    kr = num(pp.phoneKr, 'Korean number'); bd = num(pp.phoneBd, 'Bangladesh number');
    phone = (pp.waOn === 'bd' ? bd || kr : kr || bd);
  } else {
    phone = num(pp.phone, 'phone');
    if (phone && !id) { kr = /^\+82/.test(phone) ? phone : ''; bd = /^\+880/.test(phone) ? phone : ''; }
  }
  const email = str(pp.email).slice(0, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That email does not look right.');
  const photo = pp.photo === undefined ? undefined : str(pp.photo);
  if (photo && (!IMG.test(photo) || photo.length > 150000)) throw new Error('That photo could not be used. Try another one.');
  const f = { name, phone, email, city: str(pp.city).slice(0, 60), wa_ok: !!pp.waOk, note: str(pp.note).slice(0, 1000) };
  if (kr !== undefined) f.phone_kr = kr;
  if (bd !== undefined) f.phone_bd = bd;
  if (pp.emName !== undefined) f.em_name = str(pp.emName).slice(0, 80);
  if (pp.emRelation !== undefined) f.em_relation = str(pp.emRelation).slice(0, 40);
  if (pp.emPhone !== undefined) f.em_phone = num(pp.emPhone, 'emergency number');
  if (pp.addrBd !== undefined) f.addr_bd = str(pp.addrBd).slice(0, 200);
  if (pp.addrKr !== undefined) f.addr_kr = str(pp.addrKr).slice(0, 200);
  if (photo !== undefined) f.photo = photo || null;
  if (id) {
    const r = await ctx.tx`update ship_people set ${ctx.tx(f)} where business_id = ${ctx.biz} and id = ${int(id)} and removed_at is null returning id`;
    if (!r.length) throw new Error('That traveller is not here any more.');
    return Number(r[0].id);
  }
  f.code = await nextCode(ctx, 'ship_people', 'C-');
  return Number((await ctx.tx`insert into ship_people ${ctx.tx({ business_id: ctx.biz, ...f })} returning id`)[0].id);
}
async function personOk(ctx, pid) {
  if (!(await ctx.tx`select 1 from ship_people where business_id = ${ctx.biz} and id = ${pid} and removed_at is null`).length) throw new Error('That traveller is not here any more.');
}

export async function erpShipNew(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const type = p.type === 'air' ? 'air' : 'trip';
  const from = PORTS.includes(p.from) ? p.from : 'ICN', to = PORTS.includes(p.to) ? p.to : (from === 'ICN' ? 'DAC' : 'ICN');
  if (from === to) throw new Error('From and to are the same airport.');
  let pid = null;
  if (type === 'trip' && p.personId) { pid = int(p.personId); await personOk(ctx, pid); }
  const code = await nextCode(ctx, 'ships', type === 'air' ? 'AC-' : 'TR-');
  const row = (await ctx.tx`insert into ships (business_id, code, type, nickname, from_port, to_port, carrier_id, forwarder, awb, cartons, weight_kg, created_by)
    values (${ctx.biz}, ${code}, ${type}, ${str(p.nickname).slice(0, 60)}, ${from}, ${to}, ${pid}, ${str(p.forwarder).slice(0, 80)}, ${str(p.awb).slice(0, 40)},
            ${p.cartons ? int(p.cartons) : null}, ${p.weightKg ? Number(p.weightKg) : null}, ${ctx.s.userId}) returning id`)[0];
  await log(ctx, row.id, type === 'air' ? 'Air cargo made' : 'Shipment made, packing started');
  return erpShip(ctx, { id: row.id });
}

async function bagRow(ctx, id) {
  const b = (await ctx.tx`select * from ship_bags where business_id = ${ctx.biz} and id = ${int(id)}`)[0];
  if (!b) throw new Error('That bag is not here any more.');
  return b;
}
// ship-6: photos of the physical bag (owner: "at least 2"); each body (bag number) has its own
const PHOTO_MAX = 6;
async function photoAdd(ctx, b, ph, who) {
  const photo = str(ph && ph.photo), thumb = str(ph && ph.thumb);
  if (!IMG.test(photo) || photo.length > 700000) throw new Error('That photo could not be used. Take it again or choose another one.');
  if (thumb && (!IMG.test(thumb) || thumb.length > 60000)) throw new Error('That photo could not be used. Take it again or choose another one.');
  const n = (await ctx.tx`select count(*)::int n from ship_bag_photos where bag_id = ${b.id} and body_no = ${b.body_no} and removed_at is null`)[0].n;
  if (n >= PHOTO_MAX) throw new Error('At most ' + PHOTO_MAX + ' photos per bag. Remove one first.');
  await ctx.tx`insert into ship_bag_photos (business_id, bag_id, body_no, photo, thumb, by_name) values (${ctx.biz}, ${b.id}, ${b.body_no}, ${photo}, ${thumb || photo}, ${who})`;
}
async function bagCreate(ctx, nickname, photos) {
  const nk = str(nickname).slice(0, 60);
  if (!nk) throw new Error('Give the bag a nickname you can see (for example: blue big).');
  const list = Array.isArray(photos) ? photos : [];
  if (list.length > PHOTO_MAX) throw new Error('At most ' + PHOTO_MAX + ' photos per bag.');
  const code = await nextCode(ctx, 'ship_bags', 'BG-');
  const b = (await ctx.tx`insert into ship_bags (business_id, code, nickname) values (${ctx.biz}, ${code}, ${nk}) returning *`)[0];
  if (list.length) { const who = await whoName(ctx); for (const ph of list) await photoAdd(ctx, b, ph, who); }
  return b;
}
export async function erpShipBagAdd(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const t = await trip(ctx, p.id);
  if (t.type !== 'trip') throw new Error('Air cargo goes in cartons, not in our bags.');
  if (t.step > 0) throw new Error('This shipment is sealed. Bags cannot change now.');
  const b = p.bagId ? await bagRow(ctx, p.bagId) : await bagCreate(ctx, p.nickname);
  if (b.retired_at) throw new Error('That bag is retired.');
  const busy = (await openTripsOfBag(ctx, b.id)).filter((x) => x.code !== t.code);
  if (busy.length) throw new Error(b.code + ' is already in shipment ' + busy[0].code + '. Finish or remove it there first.');
  await ctx.tx`insert into ship_trip_bags (business_id, ship_id, bag_id, body_no) values (${ctx.biz}, ${t.id}, ${b.id}, ${b.body_no})
               on conflict (ship_id, bag_id) do update set removed_at = null, body_no = excluded.body_no`;
  await touch(ctx, t.id, {});
  await log(ctx, t.id, 'Bag added: ' + b.code);
  return erpShip(ctx, { id: t.id });
}
export async function erpShipBagRemove(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const t = await trip(ctx, p.id);
  if (t.step > 0) throw new Error('This shipment is sealed. Bags cannot change now.');
  const b = await bagRow(ctx, p.bagId);
  const n = (await ctx.tx`select count(*)::int as n from ship_items where ship_id = ${t.id} and bag_id = ${b.id} and struck_at is null`)[0].n;
  if (n) throw new Error('Take the items out of ' + b.code + ' first (or move them).');
  await ctx.tx`update ship_trip_bags set removed_at = now() where ship_id = ${t.id} and bag_id = ${b.id}`;
  await touch(ctx, t.id, {});
  await log(ctx, t.id, 'Bag taken out: ' + b.code);
  return erpShip(ctx, { id: t.id });
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
    let pl = t.type === 'air' ? 'cargo' : (PLACES.includes(p.add.place) ? p.add.place : 'bag');
    if (t.type === 'trip' && pl === 'cargo') pl = 'bag';
    let bagId = null;
    if (pl === 'bag') {
      bagId = int(p.add.bagId);
      if (!bagId || !(await ctx.tx`select 1 from ship_trip_bags where ship_id = ${t.id} and bag_id = ${bagId} and removed_at is null`).length) throw new Error('Which bag? Add the bag to this shipment first.');
    }
    const n = (await ctx.tx`select count(*)::int as n from ship_items where ship_id = ${t.id} and struck_at is null`)[0].n;
    if (n >= 300) throw new Error('At most 300 lines in one shipment.');
    await ctx.tx`insert into ship_items (business_id, ship_id, name, qty, for_label, place, bag_id) values (${ctx.biz}, ${t.id}, ${name}, ${qty}, ${str(p.add.for).slice(0, 40)}, ${pl}, ${bagId})`;
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
  trip: { seal: [0, 1, 'Sealed, ready to hand over'], hand: [1, 2, 'Handed to the traveller'], fly: [2, 3, 'Flight left'], receive: [-1, 5, 'In hand - shipment complete'] },
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
  if (str(p.action) === 'seal' || str(p.action) === 'book') {
    const n = (await ctx.tx`select count(*)::int as n from ship_items where ship_id = ${t.id} and struck_at is null and qty > 0`)[0].n;
    if (!n) throw new Error('Add what is inside before sealing.');
  }
  if (t.type === 'trip' && str(p.action) === 'hand' && !t.carrier_id) throw new Error('Choose who carries it first.');
  const f = { step: to };
  if (to === 5) f.received_at = new Date();
  await touch(ctx, t.id, f);
  await log(ctx, t.id, what + (p.via ? ' (scan ' + str(p.via).slice(0, 12) + ')' : ''));
  return erpShip(ctx, { id: t.id });
}

function when(v, label) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error(label + ': that date and time is not clear.');
  return d;
}
export async function erpShipCarrier(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const t = await trip(ctx, p.id);
  if (t.type !== 'trip') throw new Error('Air cargo has a forwarder, not a traveller.');
  if (t.step >= 5) throw new Error('This shipment is finished.');
  let pid = int(p.personId);
  if (pid) await personOk(ctx, pid);
  else if (p.person) pid = await personUpsert(ctx, p.person, 0);
  else throw new Error('Who carries it?');
  const dep = when(p.departAt, 'Leaves'), land = when(p.landAt, 'Lands');
  if (dep && land && land <= dep) throw new Error('Landing must be after leaving.');
  const ret = p.returnOn ? when(p.returnOn, 'Return flight') : null;
  await touch(ctx, t.id, { carrier_id: pid, flight_no: str(p.flightNo).toUpperCase().slice(0, 20), depart_at: dep, land_at: land, return_on: ret });
  const pr = (await ctx.tx`select name, code from ship_people where id = ${pid}`)[0];
  await log(ctx, t.id, 'Traveller: ' + pr.name + ' (' + pr.code + ')' + (p.flightNo ? ' · ' + str(p.flightNo).toUpperCase() : ''));
  return erpShip(ctx, { id: t.id });
}

export async function erpShipAir(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const t = await trip(ctx, p.id);
  if (t.type !== 'air') throw new Error('This is a traveller’s shipment, not air cargo.');
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
  if (t.type !== 'trip') throw new Error('Only a traveller’s shipment has a way back.');
  if (t.step < 6) throw new Error('Finish counting this shipment first.');
  const code = await nextCode(ctx, 'ships', 'TR-');
  const row = (await ctx.tx`insert into ships (business_id, code, type, from_port, to_port, created_by)
    values (${ctx.biz}, ${code}, 'trip', ${t.to_port}, ${t.from_port}, ${ctx.s.userId}) returning id`)[0];
  const bags = await bagsOf(ctx, t.id);
  for (const b of bags) {
    const busy = await openTripsOfBag(ctx, b.id);
    if (busy.length || b.retired_at) continue;
    await ctx.tx`insert into ship_trip_bags (business_id, ship_id, bag_id, body_no) values (${ctx.biz}, ${row.id}, ${b.id}, ${b.now_body}) on conflict do nothing`;
  }
  await log(ctx, row.id, 'Way back of ' + t.code + ': packing started');
  return erpShip(ctx, { id: row.id });
}

// ---------- bags
export async function erpShipBags(ctx) {
  await gate(ctx);
  const rows = await ctx.tx`select b.*, (select s.code from ship_trip_bags tb join ships s on s.id = tb.ship_id where tb.bag_id = b.id and tb.removed_at is null and s.checked_at is null order by s.id desc limit 1) as open_trip,
      (select count(*)::int from ship_trip_bags tb where tb.bag_id = b.id and tb.removed_at is null) as trips,
      (select f.thumb from ship_bag_photos f where f.bag_id = b.id and f.body_no = b.body_no and f.removed_at is null order by f.id limit 1) as thumb,
      (select count(*)::int from ship_bag_photos f where f.bag_id = b.id and f.body_no = b.body_no and f.removed_at is null) as photos
    from ship_bags b where b.business_id = ${ctx.biz} order by b.retired_at nulls first, b.code`;
  return { bags: rows.map((b) => ({ id: Number(b.id), code: b.code, nickname: b.nickname, bodyNo: b.body_no, retired: !!b.retired_at, openTrip: b.open_trip || null, trips: b.trips, thumb: b.thumb || '', photos: b.photos })) };
}
export async function erpShipBag(ctx, payload) {
  await gate(ctx);
  const code = normCode(payload && payload.code);
  const b = (await ctx.tx`select * from ship_bags where business_id = ${ctx.biz} and code = ${code}`)[0];
  if (!b) throw new Error('No bag with that code.');
  const trips = await ctx.tx`select s.code, s.from_port, s.to_port, s.step, s.checked_at, s.created_at, tb.body_no from ship_trip_bags tb join ships s on s.id = tb.ship_id
                             where tb.bag_id = ${b.id} and tb.removed_at is null order by s.id desc`;
  const changes = await ctx.tx`select old_body, new_body, reason, by_name, at from ship_bag_changes where bag_id = ${b.id} order by id desc`;
  const ph = await ctx.tx`select id, body_no, photo, thumb, by_name, at from ship_bag_photos where bag_id = ${b.id} and removed_at is null order by body_no desc, id`;
  const cur = ph.filter((x) => x.body_no === b.body_no), old = ph.filter((x) => x.body_no !== b.body_no);
  return { photos: cur.map((x) => ({ id: Number(x.id), photo: x.photo, thumb: x.thumb, by: x.by_name, at: iso(x.at) })),
    oldPhotos: old.map((x) => ({ id: Number(x.id), bodyNo: x.body_no, thumb: x.thumb, at: iso(x.at) })), photoMax: PHOTO_MAX,
    id: Number(b.id), code: b.code, nickname: b.nickname, bodyNo: b.body_no, retired: !!b.retired_at, createdAt: iso(b.created_at),
    openTrip: (trips.find((x) => !x.checked_at) || {}).code || null,
    trips: trips.map((x) => ({ code: x.code, from: x.from_port, to: x.to_port, done: !!x.checked_at, at: iso(x.created_at), bodyNo: x.body_no })),
    changes: changes.map((c) => ({ oldBody: c.old_body, newBody: c.new_body, reason: c.reason, by: c.by_name, at: iso(c.at) })) };
}
export async function erpShipBagNew(ctx, payload) {
  await gate(ctx);
  const b = await bagCreate(ctx, payload && payload.nickname, payload && payload.photos);
  return erpShipBag(ctx, { code: b.code });
}
/** A photo of the bag in hand now: add one, or strike one out ({id, add:{photo, thumb}} | {id, remove}). */
export async function erpShipBagPhoto(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const b = await bagRow(ctx, p.id);
  if (p.remove) {
    const r = await ctx.tx`update ship_bag_photos set removed_at = now() where bag_id = ${b.id} and id = ${int(p.remove)} and removed_at is null returning id`;
    if (!r.length) throw new Error('That photo is not here any more.');
  } else await photoAdd(ctx, b, p.add, await whoName(ctx));
  return erpShipBag(ctx, { code: b.code });
}
export async function erpShipBagSave(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const b = await bagRow(ctx, p.id);
  const nk = str(p.nickname).slice(0, 60);
  if (!nk) throw new Error('Give the bag a nickname.');
  await ctx.tx`update ship_bags set nickname = ${nk} where id = ${b.id}`;
  return erpShipBag(ctx, { code: b.code });
}
/** The physical bag is replaced: the code and QR stay, the bag number goes up. Never a new code. */
export async function erpShipBagReplace(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const b = await bagRow(ctx, p.id);
  const reason = str(p.reason).slice(0, 200);
  if (!reason) throw new Error('Why is the bag replaced? (torn, broken wheel, lost...)');
  const nb = Number(b.body_no) + 1;
  await ctx.tx`insert into ship_bag_changes (business_id, bag_id, old_body, new_body, reason, by_name) values (${ctx.biz}, ${b.id}, ${b.body_no}, ${nb}, ${reason}, ${await whoName(ctx)})`;
  const nk = str(p.nickname).slice(0, 60);
  await ctx.tx`update ship_bags set body_no = ${nb}, nickname = ${nk || b.nickname} where id = ${b.id}`;
  // a bag waiting to be packed takes the new body along
  await ctx.tx`update ship_trip_bags tb set body_no = ${nb} from ships s where tb.bag_id = ${b.id} and s.id = tb.ship_id and s.step = 0 and tb.removed_at is null`;
  const list = Array.isArray(p.photos) ? p.photos.slice(0, PHOTO_MAX) : [];
  if (list.length) { const nb2 = { ...b, body_no: nb }, who = await whoName(ctx); for (const ph of list) await photoAdd(ctx, nb2, ph, who); }
  return erpShipBag(ctx, { code: b.code });
}

// ---------- travellers
async function peopleStats(ctx, id) {
  return ctx.tx`select s.id, s.code, s.type, s.from_port, s.to_port, s.step, s.depart_at, s.land_at, s.created_at, s.checked_at,
      s.fee_amt, s.fee_cur, s.customs_amt, s.customs_by, s.carrier_id,
      (select count(*) from ship_trip_bags tb where tb.ship_id = s.id and tb.removed_at is null)::int as bag_n,
      (select coalesce(sum(i.qty), 0) from ship_items i where i.ship_id = s.id and i.struck_at is null)::int as pcs_n
    from ships s where s.business_id = ${ctx.biz} and s.carrier_id ${id ? ctx.tx`= ${id}` : ctx.tx`is not null`} order by coalesce(s.depart_at, s.created_at) desc`;
}
function moneyOf(trips) {
  const tot = {};
  const pays = [];
  for (const s of trips) {
    if (s.fee_amt != null && Number(s.fee_amt) > 0) { tot[s.fee_cur] = (tot[s.fee_cur] || 0) + Number(s.fee_amt); pays.push({ code: s.code, kind: 'fee', amt: Number(s.fee_amt), cur: s.fee_cur, at: iso(s.depart_at || s.created_at) }); }
    if (s.customs_amt != null && Number(s.customs_amt) > 0 && s.customs_by === 'carrier') { tot.BDT = (tot.BDT || 0) + Number(s.customs_amt); pays.push({ code: s.code, kind: 'customs', amt: Number(s.customs_amt), cur: 'BDT', at: iso(s.land_at || s.created_at) }); }
  }
  return { total: tot, pays };
}
export async function erpShipPeople(ctx) {
  await gate(ctx);
  const people = await ctx.tx`select id, code, name, phone, email, city, wa_ok, created_at from ship_people where business_id = ${ctx.biz} and removed_at is null order by name`;
  const trips = await peopleStats(ctx, 0);
  return { people: people.map((p) => {
    const mine = trips.filter((s) => Number(s.carrier_id) === Number(p.id));
    const m = moneyOf(mine);
    return { id: Number(p.id), code: p.code, name: p.name, phone: p.phone, email: p.email, city: p.city, waOk: p.wa_ok, trips: mine.length,
      bags: mine.reduce((a, s) => a + Number(s.bag_n || 0), 0), pcs: mine.reduce((a, s) => a + Number(s.pcs_n || 0), 0),
      lastAt: mine[0] ? iso(mine[0].depart_at || mine[0].created_at) : null, total: m.total, active: mine.some((s) => !s.checked_at) };
  }) };
}
export async function erpShipPerson(ctx, payload) {
  await gate(ctx);
  const id = int(payload && payload.id);
  const p = (await ctx.tx`select * from ship_people where business_id = ${ctx.biz} and id = ${id}`)[0];
  if (!p) throw new Error('That traveller is not here any more.');
  const trips = await peopleStats(ctx, id);
  const m = moneyOf(trips);
  return { id: Number(p.id), code: p.code, name: p.name, phone: p.phone, email: p.email, city: p.city, waOk: p.wa_ok, note: p.note, photo: p.photo || '',
    addrBd: p.addr_bd || '', addrKr: p.addr_kr || '', selfJoined: !!p.self_joined,
    phoneKr: p.phone_kr || '', phoneBd: p.phone_bd || '', waOn: p.phone && p.phone === p.phone_bd && p.phone !== p.phone_kr ? 'bd' : 'kr',
    emName: p.em_name || '', emRelation: p.em_relation || '', emPhone: p.em_phone || '',
    since: iso(p.created_at), removed: !!p.removed_at, total: m.total, pays: m.pays,
    bags: trips.reduce((a, s) => a + Number(s.bag_n || 0), 0), pcs: trips.reduce((a, s) => a + Number(s.pcs_n || 0), 0),
    trips: trips.map((s) => ({ id: Number(s.id), code: s.code, bags: Number(s.bag_n || 0), pcs: Number(s.pcs_n || 0), from: s.from_port, to: s.to_port, step: stepNow(s, ctx.now), at: iso(s.depart_at || s.created_at), done: !!s.checked_at })) };
}
export async function erpShipPersonSave(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const id = await personUpsert(ctx, p, int(p.id));
  return erpShipPerson(ctx, { id });
}

export const HANDLERS = { erpShips, erpShip, erpShipFind, erpShipNew, erpShipItems, erpShipBagAdd, erpShipBagRemove, erpShipStep, erpShipCarrier, erpShipAir, erpShipCheck,
  erpShipMoney, erpShipReturn, erpShipBags, erpShipBag, erpShipBagNew, erpShipBagSave, erpShipBagReplace, erpShipBagPhoto, erpShipPeople, erpShipPerson, erpShipPersonSave };
