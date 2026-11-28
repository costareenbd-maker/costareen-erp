// ship-4 (owner 27 Nov 2026): reminders for the vendor shipment business. "App notifications, and WhatsApp through
// Alvi's number: flight tomorrow, be at the airport at least 2 hours early; X is bringing product Y."
//
// Messages are worked out from each open shipment's flight times; each goes once (ship_notes, unique per shipment +
// kind + phone). WhatsApp goes from the business's own WhatsApp link (Settings -> Connections; Alvi's phone is linked
// there by scanning its QR). Without that link nothing is sent, the bell still shows everything.
//
//   to the traveller (his phone, when "WhatsApp OK" is ticked on his profile; business switch ship_wa_carrier):
//     c_eve   from 24 h to 6 h before take-off   flight tomorrow/today at .., at the airport 2 h early, our bags, keyword
//     c_day   from 5 h to 2 h before take-off    leave now, 2 h early, bags
//     c_land  within 6 h after landing, not yet handed over   hand the bags to our people, say the keyword
//   to the team (ship_team_wa numbers):
//     t_eve   from 24 h before take-off           who brings what, lands when
//     t_land  within 6 h after landing             landed, go and receive
//     t_late  landed > 4 h ago, not received       still not received
//     t_count counted with a difference (1 day)    what is short / extra
//     a_eve   air cargo: 24 h before its arrival   arrives tomorrow, AWB
//     a_land  air cargo: arrival time passed, not received
//
//   erpShipNotify()                       settings + WhatsApp state + last 60 messages (bell screen)
//   erpShipNotifySave({team, carrier})    manager+
//   erpShipNotes({id})                    one shipment: every message, sent or still to come, with its words
//   erpShipNotifySend({id, kind})         send one now by hand (manager+); also re-sends
//   shipBell(ctx)                         bell items for the top bar (alerts.js)
//   shipNotifyTick(ctx)                   timer (jobs.js 'alerts', every 10 minutes)

import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { waNumber, evoCall, erpEvoStatus } from './campaigns.js';
import { stepNow } from './shipments.js';
import { teamAt } from './shipteam.js';
import { portalToken, portalUrl } from './shipportal.js';

const str = (v) => String(v == null ? '' : v).trim();
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const H = 3600e3;
const LATE_MS = 4 * H;
const TZ = { ICN: 9, DAC: 6 };
const CITY = { ICN: 'সিউল', DAC: 'ঢাকা' };
const BND = '০১২৩৪৫৬৭৮৯';
const MON = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];
export const KINDS = {
  c_3d: { to: 'carrier', name: '৩ দিন আগে' },
  c_eve: { to: 'carrier', name: 'আগের দিন মনে করানো' },
  c_day: { to: 'carrier', name: 'ফ্লাইটের দিন' },
  c_land: { to: 'carrier', name: 'নামার পর' },
  t_eve: { to: 'team', name: 'টিম: কাল আসছে' },
  t_land: { to: 'team', name: 'টিম: নেমেছে' },
  t_late: { to: 'team', name: 'টিম: দেরি' },
  t_count: { to: 'team', name: 'টিম: গোনায় গরমিল' },
  a_eve: { to: 'team', name: 'টিম: কার্গো কাল পৌঁছাবে' },
  a_land: { to: 'team', name: 'টিম: কার্গো পৌঁছানোর কথা' },
};

const bn = (v) => String(v).replace(/[0-9]/g, (d) => BND[+d]);
/** "২৮ নভে, সন্ধ্যা ৭:১৫" in that airport's own time. */
export function bnAt(d, port) {
  if (!d) return '';
  const x = new Date(new Date(d).getTime() + (TZ[port] || 6) * H);
  const h = x.getUTCHours(), m = x.getUTCMinutes();
  const part = h < 4 ? 'রাত' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
  return bn(x.getUTCDate()) + ' ' + MON[x.getUTCMonth()] + ', ' + part + ' ' + bn((h % 12) || 12) + ':' + bn(String(m).padStart(2, '0'));
}
function dayKey(d, port) { const x = new Date(new Date(d).getTime() + (TZ[port] || 6) * H); return x.toISOString().slice(0, 10); }
function whenWord(d, port, now) {
  const a = dayKey(d, port), b = dayKey(now, port), c = dayKey(new Date(new Date(now).getTime() + 24 * H), port);
  return a === b ? 'আজ' : a === c ? 'আগামীকাল' : '';
}
const phones = (v) => str(v).split(/[,;\n]+/).map((x) => waNumber(str(x))).filter(Boolean);

async function gate(ctx) {
  if (str(await getConfig(ctx, 'business_kind', '')) !== 'cargo') throw new Error('Shipments are only in the shipment business. Switch to it from the business menu.');
}
async function settings(ctx) {
  return { team: str(await getConfig(ctx, 'ship_team_wa', '')), carrier: str(await getConfig(ctx, 'ship_wa_carrier', 'on')) !== 'off' };
}

/** Everything about one shipment the messages need. */
async function load(ctx, where) {
  const rows = await ctx.tx`select s.*, p.name as c_name, p.code as c_code, p.phone as c_phone, p.wa_ok as c_wa,
      (select string_agg(b.code, ', ' order by b.code) from ship_trip_bags tb join ship_bags b on b.id = tb.bag_id where tb.ship_id = s.id and tb.removed_at is null) as bag_codes,
      (select count(*)::int from ship_trip_bags tb where tb.ship_id = s.id and tb.removed_at is null) as bag_n,
      (select coalesce(sum(qty), 0)::int from ship_items i where i.ship_id = s.id and i.struck_at is null) as pcs,
      (select coalesce(sum(qty), 0)::int from ship_items i where i.ship_id = s.id and i.struck_at is null and i.place = 'hand') as hand_pcs
    from ships s left join ship_people p on p.id = s.carrier_id
    where s.business_id = ${ctx.biz} and ${where}`;
  return rows;
}
async function shortOf(ctx, shipId) {
  return ctx.tx`select name, qty, got_qty from ship_items where ship_id = ${shipId} and struck_at is null and got_qty is not null and got_qty <> qty order by id`;
}

/** The words of one message (null = this kind does not apply to this shipment). */
async function meetLines(ctx, s) {
  const team = await teamAt(ctx, s.to_port);
  let link = '';
  // a read (the shipment page's preview) may not write: the token is made inside a savepoint, a refusal leaves no link
  try { link = portalUrl(ctx, await ctx.tx.savepoint((sp) => portalToken({ ...ctx, tx: sp }, Number(s.carrier_id)))); } catch (_) { link = ''; }
  return (team.length ? '\nআপনার থেকে লাগেজ বুঝে নেবেন:\n' + team.slice(0, 4).map((m) => '• ' + m.name + (m.phone ? ' ' + m.phone : '')).join('\n') : '')
    + (link ? '\nকোথায় দেখা হবে, কে আসবেন, ছবি সহ সব আপনার পাতায় (একবার খুলে রাখলে নেট ছাড়াও দেখা যাবে): ' + link : '');
}
async function words(ctx, s, kind, now) {
  const biz = str(ctx.s.businessName);
  const bags = s.bag_n ? bn(s.bag_n) + 'টা লাগেজ (' + str(s.bag_codes) + ')' : 'কোনো লাগেজ নেই';
  const fl = str(s.flight_no) ? 'ফ্লাইট ' + str(s.flight_no) + ' ' : 'ফ্লাইট ';
  const dep = bnAt(s.depart_at, s.from_port), land = bnAt(s.land_at, s.to_port);
  const route = s.from_port + ' → ' + s.to_port;
  const sign = biz ? '\n— ' + biz : '';
  switch (kind) {
    case 'c_3d':
      return 'আসসালামু আলাইকুম ' + str(s.c_name) + '।\nআপনার ' + fl + '(' + route + ') ' + dep + ' (' + CITY[s.from_port] + ' সময়)। আমাদের ' + bags + ' আপনার সাথে যাবে।' + (await meetLines(ctx, s)) + sign;
    case 'c_eve': {
      const w = whenWord(s.depart_at, s.from_port, now);
      return 'আসসালামু আলাইকুম ' + str(s.c_name) + '।\nমনে করিয়ে দিচ্ছি: ' + (w ? w + ' ' : '') + dep + ' (' + CITY[s.from_port] + ' সময়) আপনার ' + fl + '(' + route + ')।\n'
        + 'দয়া করে ফ্লাইটের কমপক্ষে ২ ঘণ্টা আগে এয়ারপোর্টে পৌঁছাবেন।\n'
        + 'আপনার সাথে আমাদের ' + bags + '।' + (s.hand_pcs ? ' হাতে রাখার জিনিস: ' + bn(s.hand_pcs) + ' পিস।' : '') + '\n'
        + 'আপনার আইডি: ' + str(s.c_code) + (await meetLines(ctx, s)) + sign;
    }
    case 'c_day':
      return str(s.c_name) + ', আজ ' + dep + ' আপনার ' + fl + '(' + route + ')।\nফ্লাইটের ২ ঘণ্টা আগে এয়ারপোর্টে থাকুন। লাগেজ: ' + (s.bag_n ? str(s.bag_codes) : '—') + '।\nআইডি: ' + str(s.c_code) + sign;
    case 'c_land':
      return 'আশা করি নিরাপদে ' + CITY[s.to_port] + ' পৌঁছেছেন, ' + str(s.c_name) + '।\nআমাদের লোক আপনার সাথে যোগাযোগ করবেন। '
        + (s.bag_n ? 'লাগেজ ' + str(s.bag_codes) + ' তাঁদের হাতে দিন।' : 'জিনিসগুলো তাঁদের হাতে দিন।') + ' আইডি ' + str(s.c_code) + ' বললেই হবে।' + (await meetLines(ctx, s)) + sign;
    case 't_eve': {
      const w = whenWord(s.depart_at, s.from_port, now);
      return '✈️ ' + (w || dep) + ' আসছে: ' + str(s.c_name) + ' (' + str(s.c_code) + ')\n' + fl + route + ' · ছাড়বে ' + dep + ' · নামবে ' + (land || 'জানা নেই') + ' (' + CITY[s.to_port] + ' সময়)\n'
        + bags + (s.hand_pcs ? ' + হাতে ' + bn(s.hand_pcs) + ' পিস' : '') + ' · মোট ' + bn(s.pcs) + ' পিস\nচালান ' + s.code;
    }
    case 't_land':
      return '🛬 ' + str(s.c_name) + ' (' + str(s.c_code) + ') ' + CITY[s.to_port] + '-তে নেমেছেন (' + land + ')।\n' + bags + ' · ' + bn(s.pcs) + ' পিস। হাতে নিয়ে লাগেজ বা আইডি স্ক্যান করুন। চালান ' + s.code;
    case 't_late': {
      const h = Math.floor((new Date(now).getTime() - new Date(s.land_at).getTime()) / H);
      return '⚠️ ' + s.code + ': নামার ' + bn(h) + ' ঘণ্টা পরেও কেউ হাতে পায়নি।\n' + (s.carrier_id ? str(s.c_name) + ' (' + str(s.c_code) + ') ' + str(s.c_phone) + '\n' : '') + bags;
    }
    case 't_count': {
      const rows = await shortOf(ctx, s.id);
      if (!rows.length) return null;
      return '⚠️ ' + s.code + ' গোনায় মিলছে না:\n' + rows.slice(0, 12).map((r) => '• ' + str(r.name) + ': যাওয়ার কথা ' + bn(r.qty) + ', পাওয়া গেছে ' + bn(r.got_qty)).join('\n');
    }
    case 'a_eve':
      return '📦 এয়ার কার্গো ' + s.code + (str(s.awb) ? ' (AWB ' + str(s.awb) + ')' : '') + ' ' + (whenWord(s.land_at, s.to_port, now) || '') + ' ' + land + ' পৌঁছানোর কথা।'
        + (str(s.forwarder) ? '\nফরওয়ার্ডার: ' + str(s.forwarder) : '') + (s.cartons ? ' · ' + bn(s.cartons) + ' কার্টন' : '');
    case 'a_land':
      return '📦 এয়ার কার্গো ' + s.code + (str(s.awb) ? ' (AWB ' + str(s.awb) + ')' : '') + ' পৌঁছানোর সময় হয়ে গেছে (' + land + ')। ফরওয়ার্ডারের সাথে কথা বলে বুঝে নিন।';
    default: return null;
  }
}

/** Which kinds apply to this shipment, and the time window in which each is due. */
function plan(s, now) {
  const n = new Date(now).getTime(), out = [];
  const t = (d) => (d ? new Date(d).getTime() : null);
  const dep = t(s.depart_at), land = t(s.land_at), st = stepNow(s, now);
  if (s.checked_at) {
    if (n - t(s.checked_at) < 24 * H) out.push({ kind: 't_count', from: t(s.checked_at), to: t(s.checked_at) + 24 * H });
    return out;
  }
  if (s.type === 'air') {
    if (land) {
      out.push({ kind: 'a_eve', from: land - 24 * H, to: land - 2 * H });
      if (!s.received_at) out.push({ kind: 'a_land', from: land, to: land + 24 * H });
    }
    return out;
  }
  if (!s.carrier_id) return out;
  if (dep) {
    out.push({ kind: 'c_3d', from: dep - 72 * H, to: dep - 30 * H });
    out.push({ kind: 'c_eve', from: dep - 24 * H, to: dep - 6 * H });
    out.push({ kind: 'c_day', from: dep - 5 * H, to: dep - 2 * H });
    out.push({ kind: 't_eve', from: dep - 24 * H, to: dep });
  }
  if (land && !s.received_at) {
    out.push({ kind: 'c_land', from: land, to: land + 6 * H });
    out.push({ kind: 't_land', from: land, to: land + 6 * H });
    if (st === 4) out.push({ kind: 't_late', from: land + LATE_MS, to: land + 48 * H });
  }
  return out;
}

/** Who a kind goes to: [{phone, why}] (why = reason it cannot go). */
function targets(s, kind, set) {
  if (KINDS[kind].to === 'team') {
    const list = phones(set.team);
    return list.length ? list.map((p) => ({ phone: p })) : [{ phone: '', why: 'টিমের কোনো হোয়াটসঅ্যাপ নম্বর দেওয়া নেই' }];
  }
  if (!set.carrier) return [{ phone: '', why: 'ট্রাভেল পার্টনারদের বার্তা বন্ধ রাখা আছে' }];
  if (!s.c_wa) return [{ phone: '', why: 'উনার প্রোফাইলে "হোয়াটসঅ্যাপে বার্তা" টিক দেওয়া নেই' }];
  const p = waNumber(str(s.c_phone));
  return p ? [{ phone: p }] : [{ phone: '', why: 'ফোন নম্বরটা হোয়াটসঅ্যাপে চলবে না (দেশের কোড সহ লিখুন, যেমন +82 10…)' }];
}

async function whoName(ctx) {
  const r = (await ctx.tx`select full_name, email from profiles where id = ${ctx.s.userId}`)[0];
  return r ? (str(r.full_name) || str(r.email).split('@')[0]) : str(ctx.s.name);
}
async function sendOne(ctx, s, kind, phone, body, by) {
  let state = 'sent', error = '';
  try {
    const r = await evoCall(ctx, 'POST', '/message/sendText', { number: phone, text: body });
    if (r.code !== 200 && r.code !== 201) { state = 'failed'; error = 'WhatsApp answered ' + r.code; }
  } catch (e) { state = 'failed'; error = str(e && e.message ? e.message : e).slice(0, 200); }
  await ctx.tx`insert into ship_notes (business_id, ship_id, kind, target, phone, body, state, error, by_name)
    values (${ctx.biz}, ${s.id}, ${kind}, ${KINDS[kind].to}, ${phone}, ${body}, ${state}, ${error}, ${by || ''})
    on conflict (ship_id, kind, phone) do update set body = excluded.body, state = excluded.state, error = excluded.error,
      tries = ship_notes.tries + 1, by_name = excluded.by_name, at = now()`;
  return { state, error };
}
async function waReady(ctx) {
  try { return !!(await erpEvoStatus(ctx)).connected; } catch (_) { return false; }
}

/** Timer: send what is due, once. Failed ones are tried again (3 times) while still due. */
export async function shipNotifyTick(ctx) {
  if (str(await getConfig(ctx, 'business_kind', '')) !== 'cargo') return { skipped: 'not cargo' };
  if (!(await waReady(ctx))) return { skipped: 'whatsapp not linked' };
  const set = await settings(ctx), now = ctx.now;
  const ships = await load(ctx, ctx.tx`(s.checked_at is null or s.checked_at > now() - interval '1 day') and s.updated_at > now() - interval '60 days'`);
  const had = {};
  for (const r of await ctx.tx`select ship_id, kind, phone, state, tries from ship_notes where business_id = ${ctx.biz} and at > now() - interval '70 days'`) had[r.ship_id + '|' + r.kind + '|' + r.phone] = r;
  let sent = 0, failed = 0;
  for (const s of ships) {
    for (const p of plan(s, now)) {
      const n = new Date(now).getTime();
      if (n < p.from || n >= p.to) continue;
      for (const tg of targets(s, p.kind, set)) {
        if (!tg.phone) continue;
        const h = had[s.id + '|' + p.kind + '|' + tg.phone];
        if (h && (h.state !== 'failed' || h.tries >= 3)) continue;
        const body = await words(ctx, s, p.kind, now);
        if (!body) continue;
        const r = await sendOne(ctx, s, p.kind, tg.phone, body, '');
        if (r.state === 'sent') sent++; else failed++;
      }
    }
  }
  return { sent, failed };
}

/** Bell items for the top bar (everyone in the shipment business who sees the bell). */
export async function shipBell(ctx) {
  if (str(await getConfig(ctx, 'business_kind', '')) !== 'cargo') return [];
  const now = ctx.now, n = new Date(now).getTime(), out = [];
  const nreq = (await ctx.tx`select count(*)::int n from ship_requests where business_id = ${ctx.biz} and state = 'new'`)[0].n;
  if (nreq) out.push({ key: 'ship:req:' + nreq, level: 'warn', title: bn(nreq) + 'টা নতুন যাত্রা জানানো হয়েছে', detail: 'ট্রাভেল পার্টনাররা যাত্রার তারিখ জানিয়েছেন', go: 'ship:req' });
  const ships = await load(ctx, ctx.tx`(s.checked_at is null or s.checked_at > now() - interval '1 day')`);
  for (const s of ships) {
    const st = stepNow(s, now), dep = s.depart_at ? new Date(s.depart_at).getTime() : null, land = s.land_at ? new Date(s.land_at).getTime() : null;
    const who = s.type === 'air' ? 'এয়ার কার্গো' + (str(s.awb) ? ' ' + str(s.awb) : '') : (str(s.c_name) || 'ট্রাভেল পার্টনার ঠিক হয়নি');
    const go = 'ship:' + s.code;
    if (s.checked_at) {
      const rows = await shortOf(ctx, s.id);
      if (rows.length) out.push({ key: 'ship:count:' + s.code, level: 'warn', title: s.code + ': গোনায় মিলছে না', detail: bn(rows.length) + ' রকম প্রোডাক্টে গরমিল', go });
      continue;
    }
    if (st === 4 && land && !s.received_at && n - land > LATE_MS) out.push({ key: 'ship:late:' + s.code, level: 'bad', title: s.code + ': নামার পরেও কেউ হাতে পায়নি', detail: who + ' · নেমেছে ' + bnAt(s.land_at, s.to_port), go });
    else if (land && !s.received_at && n >= land && (s.type === 'air' || st === 4)) out.push({ key: 'ship:land:' + s.code, level: 'warn', title: s.code + ': ' + (s.type === 'air' ? 'পৌঁছানোর কথা' : 'নেমেছে') + ', বুঝে নিন', detail: who + ' · ' + bnAt(s.land_at, s.to_port), go });
    else if (st === 3) out.push({ key: 'ship:air:' + s.code, level: 'info', title: s.code + ': এখন আকাশে', detail: who + ' · নামবে ' + (bnAt(s.land_at, s.to_port) || 'জানা নেই'), go });
    else if (dep && dep > n && dep - n < 24 * H) out.push({ key: 'ship:dep:' + s.code, level: 'info', title: s.code + ': ' + (whenWord(s.depart_at, s.from_port, now) || '') + ' ফ্লাইট', detail: who + ' · ' + bnAt(s.depart_at, s.from_port) + ' · ' + bn(s.bag_n || 0) + 'টা লাগেজ', go });
    else if (s.type === 'air' && land && land > n && land - n < 24 * H) out.push({ key: 'ship:eta:' + s.code, level: 'info', title: s.code + ': কাল পৌঁছাবে', detail: who + ' · ' + bnAt(s.land_at, s.to_port), go });
    else if (s.type === 'trip' && st >= 2 && st < 4 && !dep) out.push({ key: 'ship:noflight:' + s.code, level: 'warn', title: s.code + ': ফ্লাইটের সময় দেওয়া নেই', detail: who + ' · সময় না দিলে মনে করানো যাবে না', go });
  }
  return out;
}

export async function erpShipNotify(ctx) {
  await gate(ctx);
  const set = await settings(ctx);
  let wa = { configured: false, connected: false };
  try { const st = await erpEvoStatus(ctx); wa = { configured: !!st.configured, connected: !!st.connected }; } catch (_) { /* keep false */ }
  const log = await ctx.tx`select n.id, n.kind, n.target, n.phone, n.body, n.state, n.error, n.by_name, n.at, s.code
    from ship_notes n join ships s on s.id = n.ship_id where n.business_id = ${ctx.biz} order by n.at desc limit 60`;
  return { bell: await shipBell(ctx), team: set.team, carrier: set.carrier, wa, canEdit: roleAtLeast(ctx.s.role, 'manager'), kinds: KINDS,
    log: log.map((r) => ({ id: Number(r.id), code: r.code, kind: r.kind, name: (KINDS[r.kind] || {}).name || r.kind, target: r.target, phone: r.phone,
      body: r.body, state: r.state, error: r.error, by: r.by_name, at: new Date(r.at).toISOString() })) };
}

export async function erpShipNotifySave(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  if (p.team !== undefined) {
    const list = str(p.team).split(/[,;\n]+/).map(str).filter(Boolean);
    if (list.length > 6) throw new Error('At most six team numbers.');
    for (const x of list) if (!waNumber(x)) throw new Error('"' + x + '" is not a WhatsApp number. Type 11 digits (01…), or + and the country code.');
    await setConfig(ctx, 'ship_team_wa', list.join(', '));
  }
  if (p.carrier !== undefined) await setConfig(ctx, 'ship_wa_carrier', p.carrier ? 'on' : 'off');
  return erpShipNotify(ctx);
}

export async function erpShipNotes(ctx, payload) {
  await gate(ctx);
  const id = int(payload && payload.id);
  const s = (await load(ctx, ctx.tx`s.id = ${id}`))[0];
  if (!s) throw new Error('That shipment is not here any more.');
  const set = await settings(ctx), now = ctx.now, n = new Date(now).getTime();
  const done = await ctx.tx`select kind, phone, body, state, error, by_name, at from ship_notes where ship_id = ${s.id} order by at`;
  const out = [];
  const seen = {};
  for (const d of done) {
    seen[d.kind + '|' + d.phone] = true;
    out.push({ kind: d.kind, name: (KINDS[d.kind] || {}).name || d.kind, target: KINDS[d.kind] ? KINDS[d.kind].to : 'team', phone: d.phone, body: d.body,
      state: d.state, error: d.error, by: d.by_name, at: new Date(d.at).toISOString() });
  }
  for (const p of plan(s, now)) {
    for (const tg of targets(s, p.kind, set)) {
      if (seen[p.kind + '|' + tg.phone]) continue;
      const body = await words(ctx, s, p.kind, now);
      if (!body) continue;
      out.push({ kind: p.kind, name: KINDS[p.kind].name, target: KINDS[p.kind].to, phone: tg.phone, body, why: tg.why || '',
        state: n >= p.to ? 'missed' : n >= p.from ? 'due' : 'waiting', at: new Date(p.from).toISOString() });
    }
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { notes: out, wa: await waReady(ctx), canSend: roleAtLeast(ctx.s.role, 'manager') };
}

export async function erpShipNotifySend(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  if (!KINDS[p.kind]) throw new Error('Which message?');
  const s = (await load(ctx, ctx.tx`s.id = ${int(p.id)}`))[0];
  if (!s) throw new Error('That shipment is not here any more.');
  if (!plan(s, ctx.now).some((x) => x.kind === p.kind)) throw new Error('This message does not fit this shipment now (it needs a traveller and flight times, or it is already past that step).');
  if (!(await waReady(ctx))) throw new Error('WhatsApp is not linked for this business yet. Link the number under Settings → Connections.');
  const list = targets(s, p.kind, await settings(ctx));
  const go = list.filter((x) => x.phone);
  if (!go.length) throw new Error(list[0] && list[0].why ? list[0].why : 'Nobody to send it to.');
  const body = await words(ctx, s, p.kind, ctx.now);
  if (!body) throw new Error('This message does not fit this shipment.');
  const by = await whoName(ctx);
  let ok = 0, last = '';
  for (const tg of go) { const r = await sendOne(ctx, s, p.kind, tg.phone, body, by); if (r.state === 'sent') ok++; else last = r.error; }
  if (!ok) throw new Error('WhatsApp did not take it: ' + last);
  return erpShipNotes(ctx, { id: s.id });
}

export const HANDLERS = { erpShipNotify, erpShipNotifySave, erpShipNotes, erpShipNotifySend };
