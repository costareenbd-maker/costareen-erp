// clinic-1 (owner 28 Nov 2026): the Doctor desk (ডাক্তার ডেস্ক). Oliareen's dermatologists see patients on video calls.
// The owner's words: "keep doctor profiles and patient profiles; a WhatsApp bot like Alvi finds a free slot, asks the doctor
// itself whether the time works, books it and keeps the routine; we see it all on a map like the Brand desk - one line
// per doctor, a booked slot is marked, tap the slot = the patient, tap the line = the doctor."
//
// Pieces (tables in supabase/188_clinic.sql):
//   page        erpClinic (the schedule for a day / 7 days / 30 days, what waits for a person), erpClinicPatients,
//               erpClinicPatient, erpClinicDoctorSave, erpClinicHoursSave, erpClinicOffSave, erpClinicOffStrike,
//               erpClinicPatientSave, erpClinicBook (by hand), erpClinicAct (confirm / decline / done / no-show /
//               cancel / paid / move / ask again / note), erpClinicSlots, erpClinicPhoto*, erpClinicSettings(Save)
//   the bot     a WhatsApp number kept for purpose 'clinic' (Inbox > WhatsApp numbers). Its chats are answered by
//               clinicReply (not the sales agent): it finds slots, takes the patient's details one question at a time
//               (consent first), books (the slot is held) and asks the doctor on WhatsApp.
//   the doctor  doctorInbound: a WhatsApp from a doctor's own phone (direct, or in the team group set in the settings)
//               "হ্যাঁ" / "না" / "#C12 হ্যাঁ" answers the newest open ask; the patient is told at once.
//   the timer   clinicTick (jobs.js, every few minutes): a hold that ran out -> expired + the patient gets other times;
//               the doctor is nudged once half-way; reminders the day before and an hour before (with the call link).
// Never deleted: a consult is cancelled / declined / expired with a reason; a day off and a photo are struck out.
// Health details stay out of groups: in a group the bot only talks about times; details go in a direct chat.
import { roleAtLeast, actsAsOwner } from '../allow.js';
import { getConfig, setConfig, saveFile, fileUrl } from '../lib/ext.js';
import { phone11 } from '../lib/phone.js';
import { appIsOff } from './apps.js';
import { platformAdmin } from './platform.js';

const str = (v) => String(v == null ? '' : v).trim();
const PH11 = (v) => { try { return phone11(v); } catch (_) { return ''; } };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const TZ = 6 * 60;                               // Dhaka, UTC+6, no summer time
const LIVE = ['requested', 'confirmed'];
const BUSY = ['requested', 'confirmed', 'done', 'no_show'];
const STATES = ['requested', 'confirmed', 'done', 'no_show', 'cancelled', 'declined', 'expired'];
const COLORS = ['#0E7C86', '#B4467A', '#6B4FD8', '#C26A1B', '#2F7D32', '#1F5FAF'];
export const SETTINGS_DEFAULTS = {
  agent_name: 'নুসরাত',                         // the assistant's name (a person's name; it never says it is an AI)
  min_notice: 60,                                // a slot sooner than this (minutes) is not offered
  days_ahead: 14,                                // how far ahead the bot offers slots
  remind_day: true, remind_soon: 60,             // a reminder the day before, and N minutes before (with the link)
  pay_text: '',                                  // how to pay (bKash / Nagad number), told after the doctor says yes
  pay_first: true,                               // the consult is paid before the call
  consent_text: 'আপনার ত্বকের সমস্যা, ছবি আর তথ্য শুধু ডাক্তার আর আমাদের টিম দেখবে; অন্য কোথাও যাবে না। রাজি থাকলে "রাজি" লিখুন।',
  doctor_group: '',                              // a WhatsApp group (…@g.us) with the doctors: asks go there instead of a direct chat
  team_phones: '',                               // who hears when a doctor does not answer (comma separated)
  extra: '',                                     // anything else the bot must know (the owner's own words)
};
const BN = '০১২৩৪৫৬৭৮৯';
const bn = (s) => String(s).replace(/[0-9]/g, (d) => BN[d]);
const DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

// ------------------------------------------------------------------ Dhaka time
/** A Date -> {day: 'yyyy-mm-dd', min: minutes after midnight, wd: 0..6} in Dhaka. */
export function dhaka(d) {
  const t = new Date(new Date(d).getTime() + TZ * 60e3);
  return { day: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes(), wd: t.getUTCDay() };
}
/** 'yyyy-mm-dd' + minutes in Dhaka -> Date */
export function at(day, min) { return new Date(Date.parse(day + 'T00:00:00Z') + (min - TZ) * 60e3); }
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const okDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(str(v)) && !isNaN(Date.parse(str(v) + 'T00:00:00Z'));
/** "রাত ৮:০০" */
export function clock(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  const part = h < 4 ? 'রাত' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 18 ? 'বিকাল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
  return part + ' ' + bn((h % 12 || 12) + ':' + String(m).padStart(2, '0'));
}
/** "শনিবার, ২৮ নভেম্বর, রাত ৮:০০" */
export function when(d) {
  const x = dhaka(d), [, mo, dd] = x.day.split('-');
  return DAYS[x.wd] + ', ' + bn(int(dd)) + ' ' + MONTHS[int(mo) - 1] + ', ' + clock(x.min);
}
const hhmm = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
const minOf = (v) => { const m = str(v).match(/^(\d{1,2}):(\d{2})$/); return m ? int(m[1]) * 60 + int(m[2]) : -1; };

// ------------------------------------------------------------------ gate + settings
async function bizOn(ctx) {
  if (ctx.memo && ctx.memo.clinicOn !== undefined) return ctx.memo.clinicOn;
  let on = false;
  try { on = !(await appIsOff(ctx.deps, ctx.sql, 'clinic', { biz: ctx.biz, s: { role: 'owner' } })); } catch (_) { on = false; }
  if (ctx.memo) ctx.memo.clinicOn = on;
  return on;
}
async function gate(ctx) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('ডাক্তার ডেস্ক ম্যানেজার বা মালিক খুলতে পারেন।');
  if (!(await platformAdmin(ctx)) && !(await bizOn(ctx))) throw new Error('এই ব্যবসায় ডাক্তার ডেস্ক এখনো চালু হয়নি।');
}
export async function settings(ctx) {
  let o = {};
  try { o = JSON.parse((await getConfig(ctx, 'clinic_settings', '')) || '{}') || {}; } catch (_) { o = {}; }
  return { ...SETTINGS_DEFAULTS, ...o };
}
const byName = (ctx) => str(ctx.s && (ctx.s.name || ctx.s.email)) || 'টিম';
async function event(ctx, consultId, what, by) {
  await ctx.tx`insert into clinic_events (business_id, consult_id, what, by_name) values (${ctx.biz}, ${consultId}, ${str(what).slice(0, 500)}, ${str(by).slice(0, 80)})`;
}

// ------------------------------------------------------------------ reads
async function doctorRow(ctx, id) {
  const d = (await ctx.tx`select * from clinic_doctors where business_id = ${ctx.biz} and id = ${int(id)}`)[0];
  if (!d) throw new Error('এই ডাক্তারকে আর পাওয়া গেল না। পাতাটা নতুন করে আনুন।');
  return d;
}
async function patientRow(ctx, id) {
  const p = (await ctx.tx`select * from clinic_patients where business_id = ${ctx.biz} and id = ${int(id)}`)[0];
  if (!p) throw new Error('এই রোগীকে আর পাওয়া গেল না।');
  return p;
}
const doctorOut = (d, hours) => ({
  id: Number(d.id), name: str(d.name), title: str(d.title), regNo: str(d.reg_no), phone: str(d.phone), about: str(d.about), treats: str(d.treats),
  langs: str(d.langs), fee: num(d.fee), slotMin: int(d.slot_min), gapMin: int(d.gap_min), holdMin: int(d.hold_min), autoOk: !!d.auto_ok,
  color: str(d.color), videoLink: str(d.video_link), active: !!d.active, sort: int(d.sort),
  hours: (hours || []).filter((h) => Number(h.doctor_id) === Number(d.id)).map((h) => ({ weekday: int(h.weekday), from: hhmm(int(h.start_min)), to: hhmm(int(h.end_min)) })),
});
const patientOut = (p) => ({
  id: Number(p.id), name: str(p.name), phone: str(p.phone), age: p.age == null ? null : int(p.age), gender: str(p.gender), area: str(p.area),
  skinType: str(p.skin_type), concern: str(p.concern), since: str(p.since), routine: str(p.routine), allergies: str(p.allergies), notes: str(p.notes),
  consentAt: p.consent_at ? new Date(p.consent_at).toISOString() : null, consentText: str(p.consent_text),
});
const consultOut = (c) => ({
  id: Number(c.id), no: str(c.no), doctorId: Number(c.doctor_id), patientId: Number(c.patient_id), patientName: str(c.patient_name),
  startsAt: new Date(c.starts_at).toISOString(), endsAt: new Date(c.ends_at).toISOString(), state: str(c.state), kind: str(c.kind), concern: str(c.concern),
  fee: num(c.fee), paid: !!c.paid, payNote: str(c.pay_note), videoLink: str(c.video_link), source: str(c.source), holdUntil: c.hold_until ? new Date(c.hold_until).toISOString() : null,
  askedAt: c.asked_at ? new Date(c.asked_at).toISOString() : null, doctorSaid: str(c.doctor_said), reason: str(c.reason), doctorNote: str(c.doctor_note),
  followUp: c.follow_up ? (c.follow_up instanceof Date ? c.follow_up.toISOString().slice(0, 10) : str(c.follow_up).slice(0, 10)) : null,
  remindedDay: !!c.reminded_day, remindedSoon: !!c.reminded_soon, conversationId: c.conversation_id == null ? null : str(c.conversation_id),
});

/** Free slots of one doctor on one Dhaka day (start minutes), after the hours, the days off and the booked consults. */
export async function freeSlots(ctx, d, day, opts) {
  const o = opts || {};
  const wd = new Date(day + 'T00:00:00Z').getUTCDay();
  const hours = await ctx.tx`select start_min, end_min from clinic_hours where doctor_id = ${d.id} and weekday = ${wd} order by start_min`;
  if (!hours.length) return [];
  const offs = await ctx.tx`select start_min, end_min from clinic_offs where doctor_id = ${d.id} and day = ${day} and struck_at is null`;
  if (offs.some((x) => x.start_min == null)) return [];
  const from = at(day, 0), to = at(day, 1440);
  const busy = (await ctx.tx`select starts_at, ends_at from clinic_consults where doctor_id = ${d.id} and state in ${ctx.tx(BUSY)}
                               and starts_at < ${to} and ends_at > ${from}`).map((c) => [dhaka(c.starts_at).min, dhaka(c.starts_at).min + Math.round((new Date(c.ends_at) - new Date(c.starts_at)) / 60e3)]);
  for (const x of offs) busy.push([int(x.start_min), int(x.end_min)]);
  const len = int(d.slot_min), step = len + int(d.gap_min);
  const earliest = o.notMin != null ? o.notMin : -1;
  const out = [];
  for (const h of hours) {
    for (let m = int(h.start_min); m + len <= int(h.end_min); m += step) {
      if (at(day, m).getTime() < earliest) continue;
      if (busy.some(([a, b]) => m < b && m + len > a)) continue;
      out.push(m);
    }
  }
  return out;
}

/** The whole picture for the page: doctors (with hours), consults in the range, free slots per doctor and day, waits. */
export async function erpClinic(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  const today = dhaka(ctx.now).day;
  const day = okDay(a.day) ? str(a.day) : today;
  const span = [1, 7, 30].includes(int(a.days)) ? int(a.days) : 1;
  const doctors = await ctx.tx`select * from clinic_doctors where business_id = ${ctx.biz} order by active desc, sort, id`;
  const hours = await ctx.tx`select * from clinic_hours where business_id = ${ctx.biz} order by doctor_id, weekday, start_min`;
  const from = at(day, 0), to = at(addDays(day, span), 0);
  const consults = await ctx.tx`select c.*, p.name patient_name from clinic_consults c join clinic_patients p on p.id = c.patient_id
                                where c.business_id = ${ctx.biz} and c.starts_at < ${to} and c.ends_at > ${from} order by c.starts_at`;
  const offs = await ctx.tx`select * from clinic_offs where business_id = ${ctx.biz} and struck_at is null and day >= ${day} and day < ${addDays(day, span)}`;
  const s = await settings(ctx);
  const free = {};
  if (span <= 7) {
    for (const d of doctors.filter((x) => x.active)) {
      free[d.id] = {};
      for (let i = 0; i < span; i++) {
        const dd = addDays(day, i);
        free[d.id][dd] = (await freeSlots(ctx, d, dd, { notMin: ctx.now.getTime() })).map(hhmm);
      }
    }
  }
  const waits = await ctx.tx`select c.*, p.name patient_name from clinic_consults c join clinic_patients p on p.id = c.patient_id
                             where c.business_id = ${ctx.biz} and c.state = 'requested' order by c.hold_until nulls last, c.starts_at limit 30`;
  const unpaid = await ctx.tx`select count(*)::int n from clinic_consults where business_id = ${ctx.biz} and state = 'confirmed' and not paid and starts_at > ${ctx.now}`;
  const bot = await botState(ctx);
  return {
    day, days: span, today, now: ctx.now.toISOString(),
    doctors: await withPhotos(ctx, doctors.map((d) => doctorOut(d, hours))),
    consults: consults.map(consultOut),
    offs: offs.map((o) => ({ id: Number(o.id), doctorId: Number(o.doctor_id), day: o.day instanceof Date ? o.day.toISOString().slice(0, 10) : str(o.day).slice(0, 10),
      from: o.start_min == null ? null : hhmm(int(o.start_min)), to: o.end_min == null ? null : hhmm(int(o.end_min)), reason: str(o.reason) })),
    free, waits: waits.map(consultOut), unpaid: unpaid[0].n, bot, settings: s,
  };
}
async function botState(ctx) {
  const ch = await clinicChannel(ctx);
  const day = new Date(ctx.now.getTime() - 864e5);
  let chats = 0, booked = 0;
  if (ch) {
    chats = (await ctx.tx`select count(distinct conversation_id)::int n from inbox_messages m join inbox_conversations v on v.id = m.conversation_id
                          where v.channel_id = ${ch.id} and m.direction = 'in' and m.created_at > ${day}`)[0].n;
  }
  booked = (await ctx.tx`select count(*)::int n from clinic_consults where business_id = ${ctx.biz} and source = 'bot' and created_at > ${day}`)[0].n;
  return { on: !!ch, live: !!(ch && ch.status === 'live'), name: ch ? str(ch.name) : '', chats, booked };
}
export async function erpClinicSlots(ctx, payload) {
  await gate(ctx);
  const d = await doctorRow(ctx, payload && payload.doctorId);
  const day = okDay(payload && payload.day) ? str(payload.day) : dhaka(ctx.now).day;
  return { day, slots: (await freeSlots(ctx, d, day, { notMin: ctx.now.getTime() })).map(hhmm), slotMin: int(d.slot_min) };
}
export async function erpClinicPatients(ctx, payload) {
  await gate(ctx);
  const q = str(payload && payload.q).toLowerCase();
  const rows = await ctx.tx`select p.*, (select max(starts_at) from clinic_consults c where c.patient_id = p.id and c.state in ('confirmed', 'done')) last_at,
                                    (select min(starts_at) from clinic_consults c where c.patient_id = p.id and c.state in ('requested', 'confirmed') and c.starts_at > ${ctx.now}) next_at,
                                    (select count(*)::int from clinic_consults c where c.patient_id = p.id and c.state = 'done') seen
                            from clinic_patients p where p.business_id = ${ctx.biz}
                            and (${q} = '' or lower(p.name) like ${'%' + q + '%'} or p.phone like ${'%' + q.replace(/[^0-9]/g, '') + '%'} or lower(p.concern) like ${'%' + q + '%'})
                            order by coalesce((select min(starts_at) from clinic_consults c where c.patient_id = p.id and c.state in ('requested', 'confirmed') and c.starts_at > ${ctx.now}), p.updated_at) desc limit 200`;
  return { patients: rows.map((p) => ({ ...patientOut(p), lastAt: p.last_at ? new Date(p.last_at).toISOString() : null, nextAt: p.next_at ? new Date(p.next_at).toISOString() : null, seen: int(p.seen) })) };
}
export async function erpClinicPatient(ctx, payload) {
  await gate(ctx);
  const p = await patientRow(ctx, payload && payload.id);
  const consults = await ctx.tx`select c.*, p.name patient_name, d.name doctor_name from clinic_consults c join clinic_patients p on p.id = c.patient_id
                                join clinic_doctors d on d.id = c.doctor_id where c.patient_id = ${p.id} order by c.starts_at desc limit 50`;
  const photos = await ctx.tx`select * from clinic_photos where patient_id = ${p.id} and struck_at is null order by id desc limit 24`;
  let chat = [];
  if (p.contact_id) {
    chat = (await ctx.tx`select m.direction, m.author, m.kind, m.text, m.created_at from inbox_messages m join inbox_conversations v on v.id = m.conversation_id
                         where v.contact_id = ${p.contact_id} and m.direction <> 'note' order by m.created_at desc, m.id desc limit 12`).reverse()
      .map((m) => ({ dir: str(m.direction), kind: str(m.kind), text: str(m.text).slice(0, 600), at: new Date(m.created_at).toISOString() }));
  }
  const events = consults.length ? await ctx.tx`select consult_id, what, by_name, at from clinic_events where consult_id in ${ctx.tx(consults.map((c) => c.id))} order by id desc limit 40` : [];
  return {
    patient: patientOut(p),
    consults: consults.map((c) => ({ ...consultOut(c), doctorName: str(c.doctor_name) })),
    photos: photos.map((x) => ({ id: Number(x.id), source: str(x.source), at: new Date(x.created_at).toISOString() })),
    chat, events: events.map((e) => ({ consultId: Number(e.consult_id), what: str(e.what), by: str(e.by_name), at: new Date(e.at).toISOString() })),
  };
}

// ------------------------------------------------------------------ doctors
export async function erpClinicDoctorSave(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  const name = str(a.name).slice(0, 120);
  if (!name) throw new Error('ডাক্তারের নাম লিখুন।');
  const phone = str(a.phone) ? PH11(a.phone) : '';
  if (str(a.phone) && !phone) throw new Error('WhatsApp নম্বরটা ঠিক নেই (১১ সংখ্যা, 01 দিয়ে শুরু)।');
  const slot = int(a.slotMin) || 20, gap = a.gapMin == null ? 5 : int(a.gapMin), hold = int(a.holdMin) || 20;
  if (slot < 5 || slot > 180) throw new Error('প্রতি দেখার সময় ৫ থেকে ১৮০ মিনিট।');
  if (gap < 0 || gap > 120) throw new Error('বিরতি ০ থেকে ১২০ মিনিট।');
  if (hold < 5 || hold > 240) throw new Error('ডাক্তারের উত্তরের অপেক্ষা ৫ থেকে ২৪০ মিনিট।');
  const link = str(a.videoLink);
  if (link && !/^https:\/\/\S+$/.test(link)) throw new Error('ভিডিও লিংকটা https:// দিয়ে শুরু হতে হবে।');
  const v = { name, title: str(a.title).slice(0, 200), reg_no: str(a.regNo).slice(0, 40), phone, about: str(a.about).slice(0, 2000), treats: str(a.treats).slice(0, 500),
              langs: str(a.langs).slice(0, 100) || 'বাংলা', fee: Math.max(0, num(a.fee)), slot_min: slot, gap_min: gap, hold_min: hold, auto_ok: !!a.autoOk, video_link: link,
              active: a.active === undefined ? true : !!a.active };
  if (a.id) {
    const d = await doctorRow(ctx, a.id);
    await ctx.tx`update clinic_doctors set ${ctx.tx(v)}, updated_at = now() where id = ${d.id}`;
    return { id: Number(d.id) };
  }
  const n = (await ctx.tx`select count(*)::int n from clinic_doctors where business_id = ${ctx.biz}`)[0].n;
  const r = (await ctx.tx`insert into clinic_doctors ${ctx.tx({ ...v, business_id: ctx.biz, color: COLORS[n % COLORS.length], sort: n })} returning id`)[0];
  return { id: Number(r.id) };
}
/** The doctor's week: [{weekday, from: 'HH:MM', to: 'HH:MM'}] replaces the old week. */
export async function erpClinicHoursSave(ctx, payload) {
  await gate(ctx);
  const d = await doctorRow(ctx, payload && payload.doctorId);
  const rows = Array.isArray(payload && payload.hours) ? payload.hours : [];
  const clean = [];
  for (const h of rows.slice(0, 40)) {
    const wd = int(h.weekday), a = minOf(h.from), b = minOf(h.to === '24:00' ? '24:00' : h.to);
    if (wd < 0 || wd > 6 || a < 0 || b <= a || b > 1440) throw new Error('সময়টা ঠিক নেই: ' + DAYS[wd] + ' ' + str(h.from) + '–' + str(h.to));
    if (clean.some((x) => x.weekday === wd && a < x.end_min && b > x.start_min)) throw new Error(DAYS[wd] + '-এর দুটো সময় একটার উপর আরেকটা পড়েছে।');
    clean.push({ business_id: ctx.biz, doctor_id: d.id, weekday: wd, start_min: a, end_min: b });
  }
  await ctx.tx`delete from clinic_hours where doctor_id = ${d.id}`;
  if (clean.length) await ctx.tx`insert into clinic_hours ${ctx.tx(clean)}`;
  return { ok: true, count: clean.length };
}
export async function erpClinicOffSave(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  const d = await doctorRow(ctx, a.doctorId);
  if (!okDay(a.day)) throw new Error('কোন দিন ছুটি? তারিখ দিন।');
  const from = str(a.from) ? minOf(a.from) : null, to = str(a.to) ? minOf(a.to) : null;
  if ((from == null) !== (to == null) || (from != null && (from < 0 || to <= from))) throw new Error('ছুটির সময়টা ঠিক নেই (পুরো দিন হলে সময় ফাঁকা রাখুন)।');
  const r = (await ctx.tx`insert into clinic_offs (business_id, doctor_id, day, start_min, end_min, reason) values (${ctx.biz}, ${d.id}, ${str(a.day)}, ${from}, ${to}, ${str(a.reason).slice(0, 200)}) returning id`)[0];
  const hit = (await ctx.tx`select count(*)::int n from clinic_consults where doctor_id = ${d.id} and state in ${ctx.tx(LIVE)} and starts_at >= ${at(str(a.day), from == null ? 0 : from)} and starts_at < ${at(str(a.day), to == null ? 1440 : to)}`)[0].n;
  return { id: Number(r.id), clash: hit };
}
export async function erpClinicOffStrike(ctx, payload) {
  await gate(ctx);
  const r = await ctx.tx`update clinic_offs set struck_at = now() where business_id = ${ctx.biz} and id = ${int(payload && payload.id)} and struck_at is null returning id`;
  if (!r.length) throw new Error('এই ছুটি আর নেই।');
  return { ok: true };
}

// ------------------------------------------------------------------ patients
export async function savePatient(ctx, a, by) {
  const v = {};
  const put = (k, col, max) => { if (a[k] !== undefined) v[col] = str(a[k]).slice(0, max); };
  put('name', 'name', 120); put('area', 'area', 120); put('skinType', 'skin_type', 120); put('concern', 'concern', 600); put('since', 'since', 120);
  put('routine', 'routine', 600); put('allergies', 'allergies', 400); put('notes', 'notes', 2000);
  if (a.gender !== undefined) v.gender = ['f', 'm'].includes(str(a.gender)) ? str(a.gender) : '';
  if (a.age !== undefined) { const n = int(a.age); v.age = n > 0 && n < 120 ? n : null; }
  if (a.phone !== undefined) { const ph = str(a.phone) ? PH11(a.phone) : ''; if (str(a.phone) && !ph) throw new Error('ফোন নম্বরটা ঠিক নেই (১১ সংখ্যা, 01 দিয়ে শুরু)।'); v.phone = ph; }
  if (a.consent === true) { v.consent_at = ctx.now; v.consent_text = str(a.consentText).slice(0, 600) || SETTINGS_DEFAULTS.consent_text; }
  if (a.contactId) v.contact_id = str(a.contactId);
  if (a.id) {
    const p = await patientRow(ctx, a.id);
    if (Object.keys(v).length) await ctx.tx`update clinic_patients set ${ctx.tx(v)}, updated_at = now() where id = ${p.id}`;
    return Number(p.id);
  }
  if (v.phone) {
    const old = (await ctx.tx`select id from clinic_patients where business_id = ${ctx.biz} and phone = ${v.phone}`)[0];
    if (old) { if (Object.keys(v).length) await ctx.tx`update clinic_patients set ${ctx.tx(v)}, updated_at = now() where id = ${old.id}`; return Number(old.id); }
  }
  if (!v.name && !v.phone) throw new Error('রোগীর নাম বা ফোন নম্বর দিন।');
  const r = (await ctx.tx`insert into clinic_patients ${ctx.tx({ ...v, business_id: ctx.biz })} returning id`)[0];
  return Number(r.id);
}
export async function erpClinicPatientSave(ctx, payload) {
  await gate(ctx);
  return { id: await savePatient(ctx, payload || {}, byName(ctx)) };
}
// oli-look-1: a doctor's own photo. The file name sits in business_config (no new column).
async function withPhotos(ctx, list) {
  for (const d of list) {
    const name = str(await getConfig(ctx, 'clinic_dphoto_' + d.id, ''));
    d.photoUrl = '';
    if (name) { try { d.photoUrl = str(await fileUrl(ctx, 'clinic', name)); } catch (_) { d.photoUrl = ''; } }
  }
  return list;
}
export async function erpClinicDoctorPhoto(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  const d = await doctorRow(ctx, a.doctorId);
  const mime = str(a.mime) || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error('শুধু ছবি (JPG, PNG, WEBP)।');
  const b64 = str(a.data).replace(/^data:[^,]*,/, '');
  if (!b64) throw new Error('ছবিটা আসেনি। আবার দিন।');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.length > 6e6) throw new Error('ছবিটা ৬ MB-এর বেশি বড়।');
  const name = 'd' + d.id + '-' + Date.now().toString(36) + (mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg');
  await saveFile(ctx, 'clinic', name, bytes, mime);
  await setConfig(ctx, 'clinic_dphoto_' + d.id, name);
  return { ok: true };
}
export async function erpClinicPhotoAdd(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  const p = await patientRow(ctx, a.patientId);
  const mime = str(a.mime) || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new Error('শুধু ছবি (JPG, PNG, WEBP)।');
  const b64 = str(a.data).replace(/^data:[^,]*,/, '');
  if (!b64) throw new Error('ছবিটা আসেনি। আবার দিন।');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (bytes.length > 6e6) throw new Error('ছবিটা ৬ MB-এর বেশি বড়।');
  const name = 'p' + p.id + '-' + Date.now().toString(36) + (mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg');
  await saveFile(ctx, 'clinic', name, bytes, mime);
  const r = (await ctx.tx`insert into clinic_photos (business_id, patient_id, path, mime, source) values (${ctx.biz}, ${p.id}, ${'clinic:' + name}, ${mime}, 'page') returning id`)[0];
  return { id: Number(r.id) };
}
export async function erpClinicPhotoUrl(ctx, payload) {
  await gate(ctx);
  const r = (await ctx.tx`select path from clinic_photos where business_id = ${ctx.biz} and id = ${int(payload && payload.id)} and struck_at is null`)[0];
  if (!r) throw new Error('ছবিটা আর নেই।');
  const [folder, ...rest] = str(r.path).split(':');
  return { url: await fileUrl(ctx, folder, rest.join(':')) };
}
export async function erpClinicPhotoStrike(ctx, payload) {
  await gate(ctx);
  const r = await ctx.tx`update clinic_photos set struck_at = now() where business_id = ${ctx.biz} and id = ${int(payload && payload.id)} and struck_at is null returning id`;
  if (!r.length) throw new Error('ছবিটা আর নেই।');
  return { ok: true };
}

// ------------------------------------------------------------------ booking
/** Book one consult. The doctor's row is locked, so two bookings for the same time never both pass. */
export async function book(ctx, a, by) {
  const d = await doctorRow(ctx, a.doctorId);
  if (!d.active) throw new Error('ডা. ' + d.name + ' এখন রোগী দেখছেন না।');
  await ctx.tx`select id from clinic_doctors where id = ${d.id} for update`;
  const p = await patientRow(ctx, a.patientId);
  const start = new Date(a.startsAt);
  if (isNaN(start.getTime())) throw new Error('কোন সময়? সময়টা দিন।');
  if (start.getTime() < ctx.now.getTime() - 5 * 60e3) throw new Error('এই সময়টা পার হয়ে গেছে।');
  const len = int(a.minutes) || int(d.slot_min);
  const end = new Date(start.getTime() + len * 60e3);
  const clash = (await ctx.tx`select no, state from clinic_consults where doctor_id = ${d.id} and state in ${ctx.tx(BUSY)} and starts_at < ${end} and ends_at > ${start} limit 1`)[0];
  if (clash) throw new Error('এই সময়ে ডা. ' + d.name + '-এর আরেকটা রোগী আছে (' + clash.no + ')। অন্য সময় বাছুন।');
  if (!a.anyTime) {
    const x = dhaka(start);
    const free = await freeSlots(ctx, d, x.day, {});
    if (!free.includes(x.min)) throw new Error('ডা. ' + d.name + ' এই সময়ে বসেন না বা সময়টা ফাঁকা নেই। ফাঁকা সময় থেকে বাছুন।');
  }
  const n = (await ctx.tx`select coalesce(max(substring(no from 3)::int), 0) + 1 n from clinic_consults where business_id = ${ctx.biz} and no ~ '^C-[0-9]+$'`)[0].n;
  const direct = !!a.confirm || !!d.auto_ok;
  const before = (await ctx.tx`select 1 from clinic_consults where patient_id = ${p.id} and state = 'done' limit 1`).length;
  const row = (await ctx.tx`insert into clinic_consults ${ctx.tx({
    business_id: ctx.biz, no: 'C-' + n, doctor_id: d.id, patient_id: p.id, starts_at: start, ends_at: end,
    state: direct ? 'confirmed' : 'requested', kind: a.kind === 'followup' || before ? 'followup' : 'new', concern: str(a.concern || p.concern).slice(0, 600),
    fee: a.fee != null ? Math.max(0, num(a.fee)) : num(d.fee), video_link: str(d.video_link), source: a.source === 'bot' ? 'bot' : 'manual',
    conversation_id: a.conversationId ? str(a.conversationId) : null, hold_until: direct ? null : new Date(ctx.now.getTime() + int(d.hold_min) * 60e3),
    created_by: str(by).slice(0, 80) })} returning *`)[0];
  await event(ctx, row.id, direct ? (a.confirm ? 'হাতে বুকিং, পাকা' : 'ডাক্তারের সময়ে নিজে পাকা হলো') : 'সময় ধরে রাখা হলো, ডাক্তারকে জিজ্ঞেস', by);
  let asked = null;
  if (!direct && a.ask !== false) asked = await askDoctor(ctx, row, d, p);
  return { consult: row, asked, doctor: d, patient: p };
}
export async function erpClinicBook(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  let patientId = int(a.patientId);
  if (!patientId && a.patient) patientId = await savePatient(ctx, a.patient, byName(ctx));
  if (!patientId) throw new Error('কোন রোগী? রোগী বাছুন বা নাম আর ফোন লিখুন।');
  let startsAt = a.startsAt;
  if (!startsAt && okDay(a.day) && minOf(a.time) >= 0) startsAt = at(str(a.day), minOf(a.time)).toISOString();
  const r = await book(ctx, { doctorId: a.doctorId, patientId, startsAt, concern: a.concern, confirm: a.confirm !== false && !a.askDoctor, anyTime: !!a.anyTime, fee: a.fee }, byName(ctx));
  return { id: Number(r.consult.id), no: r.consult.no, state: r.consult.state, asked: r.asked };
}

// ------------------------------------------------------------------ WhatsApp: the bot's number, the doctor, the patient
export async function clinicChannel(ctx) {
  const rows = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind in ('wa_evo', 'wa_cloud', 'wa_sender') and status in ('live', 'practice') order by (status = 'live') desc, created_at desc`;
  return rows.find((c) => str((c.settings || {}).purpose) === 'clinic') || null;
}
const wa = (ph) => { const d = str(ph).replace(/[^0-9]/g, ''); return d.length === 11 && d[0] === '0' ? '88' + d : d; };
async function sendWa(ctx, to, text) {
  const ch = await clinicChannel(ctx);
  if (!ch) return { ok: false, error: 'বুকিং বটের WhatsApp নম্বর নেই' };
  const { sendOut } = await import('./inboxch.js');
  try { const r = await sendOut(ctx, ch, { external_id: to }, { kind: 'text', text }); return r && r.ok ? { ok: true } : { ok: false, error: str(r && r.error) || 'পাঠানো যায়নি' }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 200) }; }
}
export function askText(s, c, d, p) {
  const age = p.age ? ', ' + bn(p.age) + ' বছর' : '';
  return ['🩺 ' + s.agent_name + ' → ডা. ' + d.name + ', একজন রোগী আপনার সময় চাইছেন (নং ' + c.no + ')',
    'রোগী: ' + (str(p.name) || 'নাম জানা নেই') + age + (str(c.concern) ? ' · ' + str(c.concern) : ''),
    'সময়: ' + when(c.starts_at) + ' (' + bn(Math.round((new Date(c.ends_at) - new Date(c.starts_at)) / 60e3)) + ' মিনিট)',
    '', 'নিতে পারলে "হ্যাঁ" লিখুন, না পারলে "না"। অন্য সময় হলে সময়টা লিখুন।' + (s.doctor_group ? ' (শুরুতে #' + c.no + ' লিখলে ভালো)' : '')].join('\n');
}
export async function askDoctor(ctx, c, d, p) {
  const s = await settings(ctx);
  d = d || await doctorRow(ctx, c.doctor_id);
  p = p || await patientRow(ctx, c.patient_id);
  const to = str(s.doctor_group) || (d.phone ? wa(d.phone) : '');
  if (!to) { await event(ctx, c.id, 'ডাক্তারের WhatsApp নম্বর নেই — হাতে জিজ্ঞেস করুন', 'বট'); return { sent: false, error: 'ডাক্তারের নম্বর নেই' }; }
  const r = await sendWa(ctx, to, askText(s, c, d, p));
  await ctx.tx`update clinic_consults set asked_at = ${ctx.now}, updated_at = now() where id = ${c.id}`;
  await event(ctx, c.id, r.ok ? 'ডাক্তারকে WhatsApp-এ জিজ্ঞেস করা হলো' : 'ডাক্তারকে পাঠানো যায়নি: ' + r.error, 'বট');
  return { sent: r.ok, error: r.error || null };
}
/** Tell the patient in the bot's chat (or on WhatsApp by phone when the consult was booked by hand). */
export async function tellPatient(ctx, c, text) {
  const inbox = await import('./inbox.js');
  if (c.conversation_id) {
    const conv = (await ctx.tx`select * from inbox_conversations where business_id = ${ctx.biz} and id = ${c.conversation_id}`)[0];
    if (conv) {
      const ch = await inbox.chOf(ctx, conv.channel_id), contact = await inbox.contactOf(ctx, conv.contact_id);
      const r = await inbox.deliver(ctx, ch, conv, contact, { kind: 'text', text }, { author: 'ai' });
      if (r && r.ok) { await ctx.tx`update clinic_consults set told_patient = ${ctx.now} where id = ${c.id}`; return { ok: true }; }
    }
  }
  const p = await patientRow(ctx, c.patient_id);
  if (!p.phone) return { ok: false, error: 'রোগীর ফোন নেই' };
  const r = await sendWa(ctx, wa(p.phone), text);
  if (r.ok) await ctx.tx`update clinic_consults set told_patient = ${ctx.now} where id = ${c.id}`;
  return r;
}
async function nextTimes(ctx, d, fromDate, n) {
  const s = await settings(ctx);
  const out = [];
  let day = dhaka(fromDate).day;
  for (let i = 0; i < int(s.days_ahead) && out.length < n; i++, day = addDays(day, 1)) {
    for (const m of await freeSlots(ctx, d, day, { notMin: ctx.now.getTime() + int(s.min_notice) * 60e3 })) { out.push(at(day, m)); if (out.length >= n) break; }
  }
  return out;
}
export function yesNo(text) {
  const t = str(text).toLowerCase().replace(/#?\s*c-?\s*\d+/i, '').trim();
  // a word ends at the end or at any letter that is neither Bangla nor a-z (\b does not work for Bangla)
  const YES = /^(হ্যাঁ|হ্যা|হাঁ|হা|জি|জ্বি|ঠিক আছে|ওকে|পারব|পারবো|নিতে পারব|নেব|নিব|yes|yeah|yep|ok|okay|ji|hae|ha|haa|haan|hya|thik ache|parbo|done|confirm|confirmed)(?=$|[^\u0980-\u09FFa-z])/i;
  const NO = /^(না|নাহ|পারব না|পারবো না|হবে না|no|nope|na|nah|parbo na|cannot|can't)(?=$|[^\u0980-\u09FFa-z])/i;
  if (YES.test(t) || /^(👍|✅)/u.test(t)) return /(পারব না|পারবো না|হবে না|parbo na)/i.test(t) ? 'no' : 'yes';
  if (NO.test(t) || /^❌/u.test(t)) return 'no';
  return '';
}
async function applyDoctor(ctx, c, d, ans, said) {
  const s = await settings(ctx);
  const p = await patientRow(ctx, c.patient_id);
  if (ans === 'yes') {
    await ctx.tx`update clinic_consults set state = 'confirmed', hold_until = null, doctor_said = ${str(said).slice(0, 300)}, updated_at = now() where id = ${c.id}`;
    await event(ctx, c.id, 'ডাক্তার রাজি: "' + str(said).slice(0, 120) + '"', 'ডা. ' + d.name);
    const pay = s.pay_first && num(c.fee) > 0 && !c.paid ? '\nফি ৳' + Math.round(num(c.fee)) + (str(s.pay_text) ? ' — ' + str(s.pay_text) : '') + '। পাঠিয়ে শেষের ৪টা সংখ্যা বা স্ক্রিনশট দিন।' : '';
    await tellPatient(ctx, c, 'সুখবর ' + (p.gender === 'm' ? 'ভাইয়া' : 'আপু') + ' 🌸 ডা. ' + d.name + ' ' + when(c.starts_at) + '-এ আপনাকে দেখবেন (ভিডিও কলে)।' + pay + '\nকলের লিংক সময়ের আগে এখানে পাঠাব।');
    return 'ধন্যবাদ ডা. আপা। ' + c.no + ' পাকা হলো, রোগীকে জানিয়ে দিয়েছি।';
  }
  await ctx.tx`update clinic_consults set state = 'declined', hold_until = null, doctor_said = ${str(said).slice(0, 300)}, reason = ${'ডাক্তার: ' + str(said).slice(0, 200)}, updated_at = now() where id = ${c.id}`;
  await event(ctx, c.id, 'ডাক্তার পারবেন না: "' + str(said).slice(0, 120) + '"', 'ডা. ' + d.name);
  const alt = await nextTimes(ctx, d, ctx.now, 3);
  await tellPatient(ctx, c, 'দুঃখিত ' + (p.gender === 'm' ? 'ভাইয়া' : 'আপু') + ', ডা. ' + d.name + ' ওই সময়টায় পারছেন না।' +
    (alt.length ? ' এই সময়গুলোর কোনটা হলে ভালো হয়?\n' + alt.map((x, i) => bn(i + 1) + '. ' + when(x)).join('\n') : ' নতুন সময় পেলেই জানাব।'));
  return 'ঠিক আছে ডা. আপা, ' + c.no + ' বাতিল। রোগীকে অন্য সময় দিচ্ছি।';
}
/** A WhatsApp from a doctor's own phone (direct or in the team group): answers the open ask. true = handled here. */
export async function doctorInbound(ctx, ch, ev) {
  if (!/^wa_/.test(str(ch && ch.kind)) || ev.echo) return false;
  if (str((ch.settings || {}).purpose) !== 'clinic') return false;
  const s = await settings(ctx);
  const sender = str(ev.group ? (ev.participant || ev.author || '') : ev.from).replace(/@.*$/, '').replace(/[^0-9]/g, '');
  if (ev.group && !(str(s.doctor_group) && str(ev.from).replace(/@.*$/, '') === str(s.doctor_group).replace(/@.*$/, ''))) return false;
  if (!sender) return false;
  const docs = await ctx.tx`select * from clinic_doctors where business_id = ${ctx.biz} and active and phone <> ''`;
  const d = docs.find((x) => wa(x.phone) === sender || wa(x.phone).slice(-10) === sender.slice(-10));
  // clinic-2: a phone on the team list gives the bot orders (never a patient chat)
  if (!d && teamPhones(s).some((p) => p === sender || p.slice(-10) === sender.slice(-10))) return teamOrder(ctx, ch, ev, sender, s);
  if (!d) return !!ev.group;                    // the team group: only doctors' answers matter; nobody else is answered
  const text = str(ev.text);
  const reply = async (t) => { const to = ev.group ? str(s.doctor_group) : wa(d.phone); await sendWa(ctx, to, t); };
  if (!text) return true;
  const m = text.match(/#?\s*C-?\s*(\d+)/i);
  const open = m ? (await ctx.tx`select * from clinic_consults where business_id = ${ctx.biz} and doctor_id = ${d.id} and no = ${'C-' + m[1]}`)[0]
    : (await ctx.tx`select * from clinic_consults where business_id = ${ctx.biz} and doctor_id = ${d.id} and state = 'requested' order by asked_at desc nulls last, id desc limit 1`)[0];
  const ans = yesNo(text);
  if (open && open.state === 'requested' && ans) { await reply(await applyDoctor(ctx, open, d, ans, text)); return true; }
  if (open && open.state === 'requested') {
    // another time, or a question: kept for the team; the hold stays
    await ctx.tx`update clinic_consults set doctor_said = ${text.slice(0, 300)}, updated_at = now() where id = ${open.id}`;
    await event(ctx, open.id, 'ডাক্তার লিখেছেন: "' + text.slice(0, 160) + '" — টিম দেখবে', 'ডা. ' + d.name);
    await reply('পেয়েছি ডা. আপা। টিম এখনই দেখে রোগীর সাথে কথা বলবে। শুধু "হ্যাঁ" বা "না" লিখলে আমি নিজেই জানিয়ে দিই।');
    return true;
  }
  // nothing open: the day's list
  const day = dhaka(ctx.now).day;
  const list = await ctx.tx`select c.*, p.name patient_name from clinic_consults c join clinic_patients p on p.id = c.patient_id
                            where c.doctor_id = ${d.id} and c.state = 'confirmed' and c.starts_at >= ${ctx.now} and c.starts_at < ${at(addDays(day, 1), 0)} order by c.starts_at`;
  await reply(list.length ? 'আজ আপনার আর ' + bn(list.length) + ' জন:\n' + list.map((c) => clock(dhaka(c.starts_at).min) + ' — ' + str(c.patient_name) + (str(c.concern) ? ' (' + str(c.concern).slice(0, 60) + ')' : '')).join('\n')
    : 'এখন আপনার কাছে কোনো প্রশ্ন খোলা নেই, আজ আর কোনো রোগীও নেই।');
  return true;
}

// ------------------------------------------------------------------ the page's actions on one consult
export async function erpClinicAct(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  const c = (await ctx.tx`select * from clinic_consults where business_id = ${ctx.biz} and id = ${int(a.id)} for update`)[0];
  if (!c) throw new Error('এই বুকিং আর পাওয়া গেল না।');
  const by = byName(ctx), act = str(a.action), reason = str(a.reason).slice(0, 300);
  const d = await doctorRow(ctx, c.doctor_id);
  const need = (states, msg) => { if (!states.includes(c.state)) throw new Error(msg || 'এই বুকিং এখন ' + c.state + ' — এটা করা যায় না।'); };
  if (act === 'confirm') {
    need(['requested'], 'শুধু অপেক্ষার বুকিং পাকা করা যায়।');
    const msg = await applyDoctor(ctx, c, d, 'yes', 'হাতে পাকা করলেন ' + by);
    await event(ctx, c.id, 'পাকা করলেন (ডাক্তারের হয়ে)', by);
    return { ok: true, told: msg };
  }
  if (act === 'decline') { need(['requested']); await applyDoctor(ctx, c, d, 'no', reason || 'ডাক্তার পারবেন না'); return { ok: true }; }
  if (act === 'ask') { need(['requested']); await ctx.tx`update clinic_consults set hold_until = ${new Date(ctx.now.getTime() + int(d.hold_min) * 60e3)}, nudged_at = null where id = ${c.id}`; return { ok: true, asked: await askDoctor(ctx, c, d) }; }
  if (act === 'cancel') {
    need(LIVE);
    if (!reason) throw new Error('বাতিলের কারণ লিখুন।');
    await ctx.tx`update clinic_consults set state = 'cancelled', reason = ${reason}, hold_until = null, updated_at = now() where id = ${c.id}`;
    await event(ctx, c.id, 'বাতিল: ' + reason, by);
    if (a.tell) await tellPatient(ctx, c, 'আপনার ' + when(c.starts_at) + '-এর ডাক্তার দেখানো বাতিল হয়েছে। নতুন সময় লাগলে এখানে লিখুন।');
    return { ok: true };
  }
  if (act === 'done' || act === 'no_show') {
    need(['confirmed'], 'শুধু পাকা বুকিং-এ দেখা হয়েছে / আসেননি দেওয়া যায়।');
    if (new Date(c.starts_at).getTime() > ctx.now.getTime() + 10 * 60e3) throw new Error('সময় আসার আগে এটা দেওয়া যায় না।');
    await ctx.tx`update clinic_consults set state = ${act}, updated_at = now(), doctor_note = coalesce(nullif(${str(a.note).slice(0, 2000)}, ''), doctor_note),
                 follow_up = coalesce(${okDay(a.followUp) ? str(a.followUp) : null}, follow_up) where id = ${c.id}`;
    await event(ctx, c.id, act === 'done' ? 'দেখা হয়েছে' : 'রোগী আসেননি', by);
    if (act === 'no_show' && a.tell) await tellPatient(ctx, c, 'আপু, আজ ' + clock(dhaka(c.starts_at).min) + '-এ আপনাকে কলে পাইনি। নতুন সময় চাইলে এখানে লিখুন, ঠিক করে দিচ্ছি।');
    return { ok: true };
  }
  if (act === 'paid') {
    need(['requested', 'confirmed', 'done']);
    await ctx.tx`update clinic_consults set paid = ${a.paid !== false}, pay_note = ${str(a.note).slice(0, 200)}, updated_at = now() where id = ${c.id}`;
    await event(ctx, c.id, a.paid !== false ? 'ফি পাওয়া গেছে' + (str(a.note) ? ' (' + str(a.note) + ')' : '') : 'ফি-র দাগ তুলে নেওয়া হলো', by);
    return { ok: true };
  }
  if (act === 'note') {
    await ctx.tx`update clinic_consults set doctor_note = ${str(a.note).slice(0, 2000)}, follow_up = ${okDay(a.followUp) ? str(a.followUp) : null}, updated_at = now() where id = ${c.id}`;
    await event(ctx, c.id, 'ডাক্তারের নোট লেখা হলো', by);
    return { ok: true };
  }
  if (act === 'link') {
    const link = str(a.link);
    if (link && !/^https:\/\/\S+$/.test(link)) throw new Error('লিংকটা https:// দিয়ে শুরু হতে হবে।');
    await ctx.tx`update clinic_consults set video_link = ${link}, updated_at = now() where id = ${c.id}`;
    await event(ctx, c.id, link ? 'কলের লিংক বসানো হলো' : 'কলের লিংক তুলে নেওয়া হলো', by);
    if (link && a.tell) await tellPatient(ctx, c, 'আপনার ডাক্তার দেখানোর লিংক (' + when(c.starts_at) + '): ' + link);
    return { ok: true };
  }
  if (act === 'move') {
    need(LIVE, 'শুধু চলতি বুকিং-এর সময় বদলানো যায়।');
    let startsAt = a.startsAt;
    if (!startsAt && okDay(a.day) && minOf(a.time) >= 0) startsAt = at(str(a.day), minOf(a.time)).toISOString();
    await ctx.tx`update clinic_consults set state = 'cancelled', reason = ${'সময় বদল → নতুন বুকিং'}, hold_until = null, updated_at = now() where id = ${c.id}`;
    const r = await book(ctx, { doctorId: a.doctorId || c.doctor_id, patientId: c.patient_id, startsAt, concern: c.concern, confirm: a.askDoctor ? false : true, anyTime: !!a.anyTime, fee: c.fee, source: c.source, conversationId: c.conversation_id }, by);
    await ctx.tx`update clinic_consults set paid = ${c.paid}, pay_note = ${c.pay_note} where id = ${r.consult.id}`;
    await event(ctx, c.id, 'সময় বদল → ' + r.consult.no, by);
    await event(ctx, r.consult.id, 'আগের ' + c.no + ' থেকে সময় বদল', by);
    if (a.tell && r.consult.state === 'confirmed') await tellPatient(ctx, r.consult, 'আপনার ডাক্তার দেখানোর সময় বদলেছে: ' + when(r.consult.starts_at) + ' (ডা. ' + r.doctor.name + ')।');
    return { ok: true, id: Number(r.consult.id), no: r.consult.no };
  }
  throw new Error('এই কাজটা চেনা নেই।');
}
export async function erpClinicSettingsSave(ctx, payload) {
  await gate(ctx);
  if (!roleAtLeast(ctx.s.role, 'owner') && !(await platformAdmin(ctx))) throw new Error('বটের নিয়ম শুধু মালিক বদলাতে পারেন।');
  const a = payload || {};
  const cur = await settings(ctx);
  const next = { ...cur };
  for (const k of ['agent_name', 'pay_text', 'consent_text', 'extra', 'team_phones']) if (a[k] !== undefined) next[k] = str(a[k]).slice(0, k === 'extra' ? 3000 : 600);
  if (a.doctor_group !== undefined) { const g = str(a.doctor_group); if (g && !/^[0-9-]+@g\.us$/.test(g)) throw new Error('গ্রুপের ঠিকানা এমন হয়: 1203…@g.us'); next.doctor_group = g; }
  for (const k of ['min_notice', 'days_ahead', 'remind_soon']) if (a[k] !== undefined) next[k] = Math.max(0, Math.min(k === 'days_ahead' ? 60 : 1440, int(a[k])));
  for (const k of ['remind_day', 'pay_first']) if (a[k] !== undefined) next[k] = !!a[k];
  if (!str(next.agent_name)) throw new Error('বটের একটা নাম দিন।');
  await setConfig(ctx, 'clinic_settings', JSON.stringify(next));
  return { settings: next };
}

// ------------------------------------------------------------------ the timer
export async function clinicTick(ctx) {
  const out = { expired: 0, nudged: 0, remindedDay: 0, remindedSoon: 0 };
  const s = await settings(ctx);
  // holds that ran out
  for (const c of await ctx.tx`select * from clinic_consults where business_id = ${ctx.biz} and state = 'requested' and hold_until is not null and hold_until <= ${ctx.now} for update skip locked`) {
    await ctx.tx`update clinic_consults set state = 'expired', reason = 'ডাক্তারের উত্তর আসেনি', hold_until = null, updated_at = now() where id = ${c.id}`;
    await event(ctx, c.id, 'সময় শেষ: ডাক্তারের উত্তর আসেনি', 'বট');
    const d = await doctorRow(ctx, c.doctor_id), p = await patientRow(ctx, c.patient_id);
    const alt = (await nextTimes(ctx, d, ctx.now, 4)).filter((x) => x.getTime() !== new Date(c.starts_at).getTime()).slice(0, 3);
    await tellPatient(ctx, c, (p.gender === 'm' ? 'ভাইয়া' : 'আপু') + ', ডা. ' + d.name + '-এর কাছ থেকে ওই সময়টার নিশ্চিত উত্তর এখনো পাইনি, তাই সময়টা ধরে রাখতে পারলাম না।' +
      (alt.length ? ' এগুলোর কোনটা হলে হবে?\n' + alt.map((x, i) => bn(i + 1) + '. ' + when(x)).join('\n') : ' নতুন সময় পেলেই জানাব।'));
    for (const ph of str(s.team_phones).split(/[,;\s]+/).map(wa).filter((x) => x.length >= 11)) await sendWa(ctx, ph, '⚠️ ' + c.no + ': ডা. ' + d.name + ' উত্তর দেননি, সময়টা ছেড়ে দেওয়া হলো (' + str(p.name) + ', ' + when(c.starts_at) + ')।');
    out.expired++;
  }
  // half-way: the doctor is nudged once
  for (const c of await ctx.tx`select c.*, d.hold_min from clinic_consults c join clinic_doctors d on d.id = c.doctor_id where c.business_id = ${ctx.biz} and c.state = 'requested'
                              and c.asked_at is not null and c.nudged_at is null and c.hold_until > ${ctx.now} and c.asked_at < ${new Date(ctx.now.getTime())} - (d.hold_min * interval '30 seconds')`) {
    const d = await doctorRow(ctx, c.doctor_id);
    const to = str(s.doctor_group) || (d.phone ? wa(d.phone) : '');
    if (to) await sendWa(ctx, to, '⏰ ডা. ' + d.name + ', ' + c.no + ' (' + when(c.starts_at) + ') — একটু দেখবেন? "হ্যাঁ" বা "না" লিখলেই হবে।');
    await ctx.tx`update clinic_consults set nudged_at = ${ctx.now} where id = ${c.id}`;
    out.nudged++;
  }
  // the day before (between 24 h and 3 h before), and shortly before with the link
  if (s.remind_day) {
    for (const c of await ctx.tx`select * from clinic_consults where business_id = ${ctx.biz} and state = 'confirmed' and not reminded_day
                                 and starts_at > ${new Date(ctx.now.getTime() + 3 * 3600e3)} and starts_at <= ${new Date(ctx.now.getTime() + 24 * 3600e3)}`) {
      const d = await doctorRow(ctx, c.doctor_id);
      await tellPatient(ctx, c, 'মনে করিয়ে দিচ্ছি 🌸 ' + when(c.starts_at) + '-এ ডা. ' + d.name + '-এর সাথে আপনার ভিডিও কল। ভালো আলোয়, মেকআপ ছাড়া থাকলে ডাক্তার ত্বক ভালো দেখতে পারবেন।' +
        (s.pay_first && num(c.fee) > 0 && !c.paid ? '\nফি ৳' + Math.round(num(c.fee)) + ' এখনো পাইনি' + (str(s.pay_text) ? ' — ' + str(s.pay_text) : '') + '।' : ''));
      await ctx.tx`update clinic_consults set reminded_day = true where id = ${c.id}`;
      await event(ctx, c.id, 'আগের দিনের রিমাইন্ডার গেছে', 'বট');
      out.remindedDay++;
    }
  }
  const soon = int(s.remind_soon);
  if (soon > 0) {
    for (const c of await ctx.tx`select * from clinic_consults where business_id = ${ctx.biz} and state = 'confirmed' and not reminded_soon
                                 and starts_at > ${ctx.now} and starts_at <= ${new Date(ctx.now.getTime() + soon * 60e3)}`) {
      const d = await doctorRow(ctx, c.doctor_id);
      const link = str(c.video_link) || str(d.video_link);
      await tellPatient(ctx, c, 'আর কিছুক্ষণ পরেই, ' + clock(dhaka(c.starts_at).min) + '-এ ডা. ' + d.name + '-এর সাথে আপনার কল।' + (link ? '\nলিংক: ' + link : '\nআমরা এই নম্বরে WhatsApp ভিডিও কল দেব, ফোনটা কাছে রাখুন।'));
      if (d.phone) await sendWa(ctx, wa(d.phone), '🩺 ' + clock(dhaka(c.starts_at).min) + '-এ ' + c.no + ': ' + (await patientRow(ctx, c.patient_id)).name + (str(c.concern) ? ' (' + str(c.concern).slice(0, 80) + ')' : '') + (link ? '\n' + link : ''));
      await ctx.tx`update clinic_consults set reminded_soon = true where id = ${c.id}`;
      await event(ctx, c.id, 'কলের আগের রিমাইন্ডার গেছে', 'বট');
      out.remindedSoon++;
    }
  }
  return out;
}

// ------------------------------------------------------------------ the booking bot (AI) on the clinic number
const TOOLS = [
  { name: 'doctors', description: 'Our doctors: id, name, degrees, what they treat, languages, fee (BDT), consult length, and their next free times. Call it before suggesting a doctor or a time.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'free_times', description: 'Free times of one doctor on one day (Dhaka). day = yyyy-mm-dd. Returns times like "20:00". Offer at most 3.',
    parameters: { type: 'OBJECT', properties: { doctor_id: { type: 'NUMBER' }, day: { type: 'STRING' } }, required: ['doctor_id', 'day'] } },
  { name: 'save_patient', description: 'Save what the patient told you (only what they said). consent=true only after they agreed to the consent line in their own words. gender f/m.',
    parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, age: { type: 'NUMBER' }, gender: { type: 'STRING' }, area: { type: 'STRING' }, concern: { type: 'STRING' }, since: { type: 'STRING' },
      skin_type: { type: 'STRING' }, routine: { type: 'STRING' }, allergies: { type: 'STRING' }, consent: { type: 'BOOLEAN' } } } },
  { name: 'book', description: 'Hold a free time for the patient and ask the doctor. Only after: the patient chose this exact time, gave name + concern, and agreed to the consent line. The doctor answers on WhatsApp; tell the patient you are confirming with the doctor and will let them know shortly.',
    parameters: { type: 'OBJECT', properties: { doctor_id: { type: 'NUMBER' }, day: { type: 'STRING' }, time: { type: 'STRING' }, concern: { type: 'STRING' } }, required: ['doctor_id', 'day', 'time'] } },
  { name: 'my_bookings', description: 'This patient\'s bookings (upcoming and recent) with their state.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'cancel_booking', description: 'Cancel one of this patient\'s upcoming bookings by its number (C-12), only when they clearly asked.', parameters: { type: 'OBJECT', properties: { no: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['no'] } },
  { name: 'handover', description: 'Hand the chat to a person from the team: a complaint, refund, an emergency, a medicine question, or anything you cannot do.', parameters: { type: 'OBJECT', properties: { note: { type: 'STRING' } }, required: ['note'] } },
];
export function clinicPrompt(s, biz, inGroup) {
  return [
    'You are ' + s.agent_name + ', who books doctor consultations for ' + biz + ' (a skincare shop in Bangladesh). Our dermatologists see patients on a video call.',
    'You are a person on the team. Never say or hint that you are an AI, a bot or automated; if asked, say you look after the doctors\' appointments.',
    'YOUR JOB: find a time that suits the patient, take the few details the doctor needs, hold the time and confirm it with the doctor, then keep them informed.',
    'HOW YOU TALK: warm, short WhatsApp messages in the patient\'s language and script (Bangla script -> Bangla script; Banglish -> Banglish; English -> English). Women: আপু, men: ভাইয়া. ONE question per message.',
    'ORDER: 1) what the problem is and how long (concern, since); 2) the consent line, asked once, in these words: "' + s.consent_text + '" - save consent=true only when they agree; 3) name, age; 4) offer up to 3 free times (call doctors / free_times), never a time that is not returned; 5) when they pick one, book it.',
    'Ask them to send 2-3 clear photos of the problem area here in this chat (daylight, no makeup) - the doctor sees them.',
    'NEVER: diagnose, name a medicine, tell them what to apply, or promise a result - say the doctor will advise on the call. Never share another patient\'s details. Never invent a doctor, a time or a fee.',
    'Emergencies (swelling of face or lips, trouble breathing, a spreading painful rash, fever with rash): tell them to go to a hospital now and hand over.',
    s.pay_first ? 'PAYMENT: the fee is paid after the doctor confirms, before the call' + (str(s.pay_text) ? ': ' + str(s.pay_text) : '') + '. Do not ask for money before the doctor says yes.' : 'PAYMENT: the fee is paid after the call.',
    inGroup ? 'THIS IS A WHATSAPP GROUP: talk only about times and bookings here. For the skin details and photos ask them to message you directly.' : '',
    str(s.extra) ? 'THE OWNER\'S OWN RULES (follow them): ' + str(s.extra) : '',
  ].filter(Boolean).join('\n');
}
/** inbox.js agentReply hands a clinic-number chat here. */
export async function clinicReply(ctx, conv, ch, contact, opts) {
  const o = opts || {};
  const test = !!o.test;
  const s = await settings(ctx);
  const inbox = await import('./inbox.js');
  const { geminiTools } = await import('../lib/gemini.js');
  const biz = str((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0]?.name) || 'our shop';
  const hist = test ? (o.history || []) : (await ctx.tx`select * from inbox_messages where conversation_id = ${conv.id} and direction <> 'note' order by created_at desc, id desc limit 40`).reverse();
  const inGroup = /@g\.us$/.test(str(contact && contact.external_id));
  // the patient this chat belongs to (by the Inbox contact, else by phone)
  let pat = null;
  if (!test && contact) {
    pat = (await ctx.tx`select * from clinic_patients where business_id = ${ctx.biz} and contact_id = ${contact.id}`)[0] || null;
    const ph = PH11(contact.phone || '');
    if (!pat && ph) pat = (await ctx.tx`select * from clinic_patients where business_id = ${ctx.biz} and phone = ${ph}`)[0] || null;
  }
  const ensurePatient = async () => {
    if (pat) return pat;
    const id = await savePatient(ctx, { name: str(contact && contact.name), phone: PH11((contact && contact.phone) || '') || '', contactId: contact && contact.id }, 'বট');
    pat = await patientRow(ctx, id);
    return pat;
  };
  const effects = { handover: null };
  const run = async (name, a) => {
    a = a || {};
    if (name === 'doctors') {
      const ds = await ctx.tx`select * from clinic_doctors where business_id = ${ctx.biz} and active order by sort, id`;
      const out = [];
      for (const d of ds) out.push({ id: Number(d.id), name: 'ডা. ' + d.name, degrees: str(d.title), treats: str(d.treats), languages: str(d.langs), fee: num(d.fee), minutes: int(d.slot_min),
        next_free: (await nextTimes(ctx, d, ctx.now, 3)).map((x) => ({ day: dhaka(x).day, time: hhmm(dhaka(x).min), said: when(x) })) });
      return { doctors: out, note: out.length ? '' : 'no doctor is taking patients now - say so and hand over' };
    }
    if (name === 'free_times') {
      const d = (await ctx.tx`select * from clinic_doctors where business_id = ${ctx.biz} and id = ${int(a.doctor_id)} and active`)[0];
      if (!d) return { error: 'no such doctor' };
      if (!okDay(a.day)) return { error: 'day must be yyyy-mm-dd' };
      const mins = await freeSlots(ctx, d, str(a.day), { notMin: ctx.now.getTime() + int(s.min_notice) * 60e3 });
      return { day: str(a.day), times: mins.map((m) => ({ time: hhmm(m), said: when(at(str(a.day), m)) })), note: mins.length ? '' : 'nothing free that day - offer the doctor\'s next free times' };
    }
    if (name === 'save_patient') {
      if (test) return { ok: true };
      const p = await ensurePatient();
      await savePatient(ctx, { id: p.id, name: a.name, age: a.age, gender: a.gender, area: a.area, concern: a.concern, since: a.since, skinType: a.skin_type, routine: a.routine, allergies: a.allergies,
        consent: a.consent === true, consentText: s.consent_text }, 'বট');
      pat = await patientRow(ctx, p.id);
      return { ok: true, consent: !!pat.consent_at };
    }
    if (name === 'book') {
      if (test) return { booked: true, note: 'tell them you are confirming with the doctor now' };
      const p = await ensurePatient();
      if (!p.consent_at) return { error: 'the patient has not agreed to the consent line yet - ask it first' };
      if (!str(p.name)) return { error: 'ask their name first' };
      const m = minOf(a.time);
      if (!okDay(a.day) || m < 0) return { error: 'day yyyy-mm-dd and time HH:MM' };
      const start = at(str(a.day), m);
      if (start.getTime() < ctx.now.getTime() + int(s.min_notice) * 60e3) return { error: 'too soon - offer a later time' };
      try {
        const r = await ctx.tx.savepoint(async () => book(ctx, { doctorId: a.doctor_id, patientId: p.id, startsAt: start.toISOString(), concern: str(a.concern) || p.concern, source: 'bot', conversationId: conv.id }, 'বট'));
        // the photos the patient sent in this chat go to their profile
        await ctx.tx`insert into clinic_photos (business_id, patient_id, path, mime, source)
                     select ${ctx.biz}, ${p.id}, 'inbox:' || m.media, 'image/jpeg', 'whatsapp' from inbox_messages m
                     where m.conversation_id = ${conv.id} and m.direction = 'in' and m.kind = 'image' and coalesce(m.media, '') <> '' and m.media not like '%:%'
                     and not exists (select 1 from clinic_photos x where x.patient_id = ${p.id} and x.path = 'inbox:' || m.media)`;
        return { booked: true, no: r.consult.no, state: r.consult.state, when: when(r.consult.starts_at),
                 note: r.consult.state === 'confirmed' ? 'it is confirmed - tell them' + (s.pay_first && num(r.consult.fee) > 0 ? ' and how to pay the fee ৳' + Math.round(num(r.consult.fee)) + (str(s.pay_text) ? ': ' + s.pay_text : '') : '')
                   : 'held for them; tell them you are confirming with the doctor right now and will let them know in a few minutes. Do not ask for payment yet.' };
      } catch (e) { return { error: String((e && e.message) || e) }; }
    }
    if (name === 'my_bookings') {
      if (!pat) return { bookings: [] };
      const rows = await ctx.tx`select c.no, c.state, c.starts_at, d.name from clinic_consults c join clinic_doctors d on d.id = c.doctor_id where c.patient_id = ${pat.id} order by c.starts_at desc limit 6`;
      return { bookings: rows.map((r) => ({ no: r.no, state: r.state, when: when(r.starts_at), doctor: 'ডা. ' + r.name })) };
    }
    if (name === 'cancel_booking') {
      if (test) return { ok: true };
      if (!pat) return { error: 'no booking for this patient' };
      const c = (await ctx.tx`select * from clinic_consults where patient_id = ${pat.id} and no = ${str(a.no).toUpperCase().replace(/^C(\d)/, 'C-$1')} and state in ${ctx.tx(LIVE)}`)[0];
      if (!c) return { error: 'no upcoming booking with that number' };
      await ctx.tx`update clinic_consults set state = 'cancelled', reason = ${'রোগী বাতিল করলেন: ' + str(a.reason).slice(0, 200)}, hold_until = null, updated_at = now() where id = ${c.id}`;
      await event(ctx, c.id, 'রোগী বাতিল করলেন (চ্যাটে)', 'বট');
      const d = await doctorRow(ctx, c.doctor_id);
      if (c.state === 'confirmed' && d.phone) await sendWa(ctx, wa(d.phone), 'ℹ️ ' + c.no + ' (' + when(c.starts_at) + ') রোগী বাতিল করেছেন।');
      return { ok: true };
    }
    if (name === 'handover') { effects.handover = str(a.note).slice(0, 300) || 'person'; return { ok: true, note: 'tell them a person from the team will reply here shortly' }; }
    return { error: 'unknown tool' };
  };
  const contents = [];
  for (const m of hist) {
    let t = str(m.text);
    if (m.kind === 'image') t = '[sent a photo]' + (t ? ' ' + t : '');
    if (m.kind === 'audio') t = '[voice note] ' + (str(m.transcript) || '(could not be heard)');
    if (!t) continue;
    const role = m.direction === 'in' ? 'user' : 'model';
    if (contents.length && contents[contents.length - 1].role === role) contents[contents.length - 1].parts[0].text += '\n' + t;
    else contents.push({ role, parts: [{ text: t }] });
  }
  if (!contents.length || contents[contents.length - 1].role !== 'user') return { sent: 0, skipped: 'nothing to answer' };
  const known = pat ? 'WHAT WE KNOW ABOUT THIS PATIENT: ' + JSON.stringify({ name: pat.name, age: pat.age, gender: pat.gender, concern: pat.concern, since: pat.since, consent: !!pat.consent_at }) : 'A new patient.';
  const nowLine = 'Now: ' + when(ctx.now) + ' (Dhaka), today = ' + dhaka(ctx.now).day + '.';
  const res = await geminiTools(ctx, { system: clinicPrompt(s, biz, inGroup) + '\n' + known + '\n' + nowLine, contents, tools: TOOLS, run, purpose: test ? 'test' : 'clinic', conversationId: test ? null : conv.id });
  const text = str(res.text).replace(/\n\s*\n+/g, '\n');
  if (test) return { replies: text ? [text] : [], calls: (res.calls || []).map((c) => c.name), handover: effects.handover };
  let sent = 0;
  if (text) { const r = await inbox.deliver(ctx, ch, conv, contact, { kind: 'text', text }, { author: 'ai' }); if (r && r.ok) sent++; }
  if (effects.handover) await inbox.handOver(ctx, conv, 'person', effects.handover);
  await ctx.tx`update inbox_conversations set unread = 0 where id = ${conv.id}`;
  return { sent, handover: effects.handover };
}

// ------------------------------------------------------------------ clinic-2: link the bot's WhatsApp with a code
// Owner 29 Nov 2026: "give me the keyword to scan and switch the bot on". The Doctor desk's Bot tab links the bot's own
// number: the server makes the number on THIS business's WhatsApp server (Oliareen: its own separate Evolution, /evoc) and
// gives an 8-letter pairing code; on the bot's phone WhatsApp > Linked devices > Link with phone number takes it. A QR
// is given too. The number is always kept for the job 'clinic' - it never becomes a sales / Alvi number.
const fetchOf = (ctx) => (ctx.deps && ctx.deps.fetch) || fetch;
async function wcall(ctx, url, opts) {
  try {
    const res = await fetchOf(ctx)(url, { method: opts.method || 'POST', headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text(); let json = {}; try { json = JSON.parse(text) || {}; } catch (_) { json = {}; }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json };
  } catch (e) { return { ok: false, status: 0, json: {}, error: String((e && e.message) || e) }; }
}
async function ownerOnly(ctx) {
  // clinic-2b (owner 29 Nov): Raj (manager with the 'act' switch) links the bot's phone himself
  if (!roleAtLeast(ctx.s.role, 'shareholder') && !actsAsOwner(ctx.s) && !(await platformAdmin(ctx))) throw new Error('বটের WhatsApp মালিক বা মালিকের ক্ষমতা পাওয়া কেউ জুড়তে পারেন।');
}
export async function erpClinicConnect(ctx, payload) {
  await gate(ctx); await ownerOnly(ctx);
  const a = payload || {};
  const ph = PH11(a.phone);
  if (!ph) throw new Error('বটের সিমের নম্বর দিন (১১ সংখ্যা, 01 দিয়ে শুরু)।');
  const url = str(await (await import('../lib/ext.js')).getSecret(ctx, 'WA_SERVER_URL')).replace(/\/+$/, ''), key = str(await (await import('../lib/ext.js')).getSecret(ctx, 'WA_SERVER_KEY'));
  if (!url || !key) throw new Error('এই ব্যবসার আলাদা WhatsApp সার্ভার এখনো বসানো হয়নি।');
  const { chSecret, chSecretSet, evoSetHook } = await import('./inboxch.js');
  let ch = (await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind = 'wa_evo' and status <> 'removed' and settings->>'purpose' = 'clinic' order by created_at desc limit 1`)[0];
  if (!ch) {
    const inst = 'clinic-' + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const r = await wcall(ctx, url + '/instance/create', { headers: { apikey: key }, body: { instanceName: inst, integration: 'WHATSAPP-BAILEYS', qrcode: true, number: wa(ph) } });   // Evolution gives a pairing code only when the number comes at create
    if (!r.ok) throw new Error('WhatsApp সার্ভার নম্বরটা বানাতে পারল না (' + (r.status || 'উত্তর নেই') + ')। এক মিনিট পরে আবার চেষ্টা করুন।');
    const token = str(typeof r.json.hash === 'string' ? r.json.hash : r.json.hash && (r.json.hash.apikey || r.json.hash.token)) || str(r.json.token);
    const settings = { wait_s: 8, revert_min: 60, purpose: 'clinic', erp_made: true, number_wanted: ph };
    ch = (await ctx.tx`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings, created_by)
                       values (${ctx.biz}, 'wa_evo', ${'ডাক্তার বুকিং'}, ${inst}, 'live', true, ${ctx.tx.json(settings)}, ${byName(ctx)}) returning *`)[0];
    await chSecretSet(ctx, ch, 'URL', url);
    await chSecretSet(ctx, ch, 'KEY', token || key);
    const base = str(ctx.deps && ctx.deps.hookBase);
    if (base) await evoSetHook(ctx, ch, base + (base.includes('?') ? '&' : '?') + 'inbox=hook&ch=' + ch.id + '&k=' + ch.hook_key);
  } else if (str((ch.settings || {}).number_wanted) !== ph) {
    await ctx.tx`update inbox_channels set settings = coalesce(settings, '{}'::jsonb) || ${ctx.tx.json({ number_wanted: ph })} where id = ${ch.id}`;
  }
  const base2 = str(await chSecret(ctx, ch, 'URL')).replace(/\/+$/, ''), key2 = str(await chSecret(ctx, ch, 'KEY'));
  const st = await wcall(ctx, base2 + '/instance/connectionState/' + encodeURIComponent(ch.external_id), { method: 'GET', headers: { apikey: key2 } });
  const state = str((st.json.instance && st.json.instance.state) || st.json.state);
  if (state === 'open') return { state, linked: true, channelId: ch.id };
  const c = await wcall(ctx, base2 + '/instance/connect/' + encodeURIComponent(ch.external_id) + '?number=' + wa(ph), { method: 'GET', headers: { apikey: key2 } });
  if (!c.ok) throw new Error('কোড আনা গেল না (' + (c.status || 'উত্তর নেই') + ')। আবার চাপুন।');
  let qr = str(c.json.base64); if (qr && qr.indexOf('data:image') !== 0) qr = 'data:image/png;base64,' + qr;
  const code = str(c.json.pairingCode).toUpperCase();
  return { state: state || 'connecting', linked: false, channelId: ch.id, code: code ? code.slice(0, 4) + '-' + code.slice(4) : '', qr };
}
export async function erpClinicConnectState(ctx) {
  await gate(ctx);
  const ch = (await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind = 'wa_evo' and status <> 'removed' and settings->>'purpose' = 'clinic' order by created_at desc limit 1`)[0];
  if (!ch) return { state: 'none', linked: false };
  const { evoState } = await import('./inboxch.js');
  const st = await evoState(ctx, ch);
  return { state: str(st.state), linked: str(st.state) === 'open', name: str(ch.name) };
}

// ------------------------------------------------------------------ clinic-2: the team gives the bot orders on WhatsApp
// Owner 29 Nov 2026: "the bot does everything, but on our command; only booking runs by itself". A WhatsApp to the bot's
// number from a phone in the settings' team list (or the owner's) is an ORDER, never a patient chat: the AI reads it
// and uses the desk's own actions (schedule, waits, a patient, book, confirm / cancel / done / no-show / paid / move,
// a doctor's week, a day off, ask the doctor again, a message to a patient). It answers the sender with what it did.
const TEAM_TOOLS = [
  { name: 'schedule', description: 'Bookings and free times for a day (yyyy-mm-dd, Dhaka), every doctor.', parameters: { type: 'OBJECT', properties: { day: { type: 'STRING' } }, required: ['day'] } },
  { name: 'waiting', description: 'Bookings waiting for a doctor\'s yes.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'doctors', description: 'Doctors: id, name, fee, minutes, weekly hours.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'find_patient', description: 'Find patients by name, phone or problem.', parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' } }, required: ['q'] } },
  { name: 'book', description: 'Book a consult. patient_id, or name + phone for a new patient. confirm=true books it at once; false asks the doctor first.',
    parameters: { type: 'OBJECT', properties: { doctor_id: { type: 'NUMBER' }, patient_id: { type: 'NUMBER' }, name: { type: 'STRING' }, phone: { type: 'STRING' }, day: { type: 'STRING' }, time: { type: 'STRING' }, concern: { type: 'STRING' }, confirm: { type: 'BOOLEAN' } }, required: ['doctor_id', 'day', 'time'] } },
  { name: 'change', description: 'Change one booking by its number (C-12): action confirm | cancel | done | no_show | paid | move | ask_doctor. cancel needs reason; move needs day + time; tell=true tells the patient.',
    parameters: { type: 'OBJECT', properties: { no: { type: 'STRING' }, action: { type: 'STRING' }, reason: { type: 'STRING' }, day: { type: 'STRING' }, time: { type: 'STRING' }, note: { type: 'STRING' }, tell: { type: 'BOOLEAN' } }, required: ['no', 'action'] } },
  { name: 'set_hours', description: 'Replace a doctor\'s weekly hours. hours = [{weekday 0=Sun..6=Sat, from "HH:MM", to "HH:MM"}].',
    parameters: { type: 'OBJECT', properties: { doctor_id: { type: 'NUMBER' }, hours: { type: 'ARRAY', items: { type: 'OBJECT', properties: { weekday: { type: 'NUMBER' }, from: { type: 'STRING' }, to: { type: 'STRING' } } } } }, required: ['doctor_id', 'hours'] } },
  { name: 'day_off', description: 'A doctor\'s day off (whole day, or from-to).', parameters: { type: 'OBJECT', properties: { doctor_id: { type: 'NUMBER' }, day: { type: 'STRING' }, from: { type: 'STRING' }, to: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['doctor_id', 'day'] } },
  { name: 'message_patient', description: 'Send a WhatsApp from the bot to a patient (by booking number or patient phone). Use the exact words the team asked for, politely.',
    parameters: { type: 'OBJECT', properties: { no: { type: 'STRING' }, phone: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['text'] } },
];
export function teamPhones(s) { return str(s.team_phones).split(/[,;\s]+/).map(wa).filter((x) => x.length >= 11); }
async function teamOrder(ctx, ch, ev, sender, s) {
  const text = str(ev.text);
  const say = async (t) => sendWa(ctx, ev.group ? str(s.doctor_group) : sender, t);
  if (!text) return true;
  const { geminiTools } = await import('../lib/gemini.js');
  const memKey = 'clinic_team_chat_' + sender.slice(-10);
  let mem = [];
  try { mem = JSON.parse((await getConfig(ctx, memKey, '')) || '[]') || []; } catch (_) { mem = []; }
  const by = 'WhatsApp ' + sender;
  const asTeam = { ...ctx, s: { ...ctx.s, name: by, role: roleAtLeast(ctx.s.role, 'owner') ? ctx.s.role : 'owner' } };
  const noOf = (v) => str(v).toUpperCase().replace(/^#?\s*C-?\s*/, 'C-');
  const run = async (name, a) => {
    a = a || {};
    try {
      if (name === 'schedule') {
        if (!okDay(a.day)) return { error: 'day yyyy-mm-dd' };
        const r = await erpClinic(asTeam, { day: a.day, days: 1 });
        return { day: a.day, doctors: r.doctors.map((d) => ({ id: d.id, name: d.name, free: (r.free[d.id] || {})[a.day] || [] })),
                 bookings: r.consults.map((c) => ({ no: c.no, doctor_id: c.doctorId, patient: c.patientName, time: hhmm(dhaka(c.startsAt).min), state: c.state, paid: c.paid })) };
      }
      if (name === 'waiting') return { waiting: (await erpClinic(asTeam, {})).waits.map((c) => ({ no: c.no, patient: c.patientName, when: when(c.startsAt), doctor_said: c.doctorSaid })) };
      if (name === 'doctors') return { doctors: (await erpClinic(asTeam, {})).doctors.map((d) => ({ id: d.id, name: d.name, fee: d.fee, minutes: d.slotMin, phone: d.phone, hours: d.hours, active: d.active })) };
      if (name === 'find_patient') return { patients: (await erpClinicPatients(asTeam, { q: a.q })).patients.slice(0, 8).map((p) => ({ id: p.id, name: p.name, phone: p.phone, concern: p.concern, next: p.nextAt ? when(p.nextAt) : null })) };
      if (name === 'book') {
        const args = { doctorId: a.doctor_id, day: a.day, time: a.time, concern: a.concern, askDoctor: a.confirm === false };
        if (a.patient_id) args.patientId = a.patient_id; else args.patient = { name: a.name, phone: a.phone, concern: a.concern };
        return await ctx.tx.savepoint(async () => erpClinicBook(asTeam, args));
      }
      if (name === 'change') {
        const c = (await ctx.tx`select id from clinic_consults where business_id = ${ctx.biz} and no = ${noOf(a.no)}`)[0];
        if (!c) return { error: 'no booking ' + a.no };
        const action = str(a.action) === 'ask_doctor' ? 'ask' : str(a.action);
        return await ctx.tx.savepoint(async () => erpClinicAct(asTeam, { id: c.id, action, reason: a.reason, day: a.day, time: a.time, note: a.note, tell: !!a.tell }));
      }
      if (name === 'set_hours') return await ctx.tx.savepoint(async () => erpClinicHoursSave(asTeam, { doctorId: a.doctor_id, hours: a.hours || [] }));
      if (name === 'day_off') return await ctx.tx.savepoint(async () => erpClinicOffSave(asTeam, { doctorId: a.doctor_id, day: a.day, from: a.from, to: a.to, reason: a.reason }));
      if (name === 'message_patient') {
        const t = str(a.text).slice(0, 1000);
        if (!t) return { error: 'what should I write?' };
        if (a.no) {
          const c = (await ctx.tx`select * from clinic_consults where business_id = ${ctx.biz} and no = ${noOf(a.no)}`)[0];
          if (!c) return { error: 'no booking ' + a.no };
          return await tellPatient(ctx, c, t);
        }
        const ph = PH11(a.phone);
        if (!ph) return { error: 'give a booking number or the patient\'s phone' };
        return await sendWa(ctx, wa(ph), t);
      }
      return { error: 'unknown tool' };
    } catch (e) { return { error: String((e && e.message) || e) }; }
  };
  const system = ['You are the booking desk of ' + (str((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0]?.name) || 'the shop') + ' (doctor video consultations). A person from OUR TEAM writes to you on WhatsApp.',
    'Do exactly what they ask, with the tools; ask one short question only when something needed is missing (which doctor, which day). Never invent a booking number, a time or a patient.',
    'Answer in their language and script, short, plain, like a colleague: what you did, or what you found. Dates and times in Dhaka. Today = ' + dhaka(ctx.now).day + ', now ' + when(ctx.now) + '.',
    'Weekdays: 0 Sunday, 1 Monday, 2 Tuesday, 3 Wednesday, 4 Thursday, 5 Friday, 6 Saturday. Times as HH:MM 24-hour.'].join('\n');
  const contents = mem.slice(-8).map((m) => ({ role: m.r, parts: [{ text: m.t }] })).concat([{ role: 'user', parts: [{ text }] }]);
  let out = '';
  try {
    const res = await geminiTools(ctx, { system, contents, tools: TEAM_TOOLS, run, purpose: 'clinic-team', conversationId: null });
    out = str(res.text);
  } catch (e) { out = 'এই মুহূর্তে করতে পারলাম না: ' + String((e && e.message) || e).slice(0, 160); }
  if (!out) out = 'হয়ে গেছে।';
  mem = mem.concat([{ r: 'user', t: text.slice(0, 600) }, { r: 'model', t: out.slice(0, 600) }]).slice(-12);
  try { await setConfig(ctx, memKey, JSON.stringify(mem)); } catch (_) { /* memory is a help, not a must */ }
  await say(out);
  return true;
}

export const HANDLERS = {
  erpClinic, erpClinicSlots, erpClinicPatients, erpClinicPatient, erpClinicDoctorSave, erpClinicHoursSave, erpClinicOffSave, erpClinicOffStrike,
  erpClinicPatientSave, erpClinicPhotoAdd, erpClinicDoctorPhoto, erpClinicPhotoUrl, erpClinicPhotoStrike, erpClinicBook, erpClinicAct, erpClinicSettingsSave, erpClinicConnect, erpClinicConnectState,
};
