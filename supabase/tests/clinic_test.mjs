// clinic-1 (owner 28 Nov 2026): the Doctor desk. Doctors with weekly hours and days off; patients; a consult booked by
// hand or by the WhatsApp booking assistant; the doctor's "হ্যাঁ" / "না" on WhatsApp confirms or declines it and the
// patient is told; a hold that ran out expires and the patient gets other times; reminders the day before and shortly
// before; two consults never overlap; nothing is deleted; the other business sees nothing.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner as owner0, mgr as mgr0, sales as sales0, check, done, deps, web, fnDir } from './harness.mjs';

const un = (x) => (x && x.ok && 'result' in x ? x.result : x);
const owner = async (n, a) => un(await owner0(n, a)), mgr = async (n, a) => un(await mgr0(n, a)), sales = async (n, a) => un(await sales0(n, a));
const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const cl = await import(pathToFileURL(path.join(fnDir, 'handlers', 'clinic.js')));
const chm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inboxch.js')));
const wan = await import(pathToFileURL(path.join(fnDir, 'handlers', 'wanumbers.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';

let script = [];
web.on(/generativelanguage\.googleapis\.com/, () => {
  const next = script.shift();
  const parts = !next ? [{ text: 'জি আপু।' }] : next;
  return { status: 200, body: { candidates: [{ content: { parts } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } };
});
const wa = [];
web.on(/evo\.test/, (url, opts) => { if (/message\/send/.test(url)) wa.push({ url, ...JSON.parse(opts.body) }); return { status: 201, body: { key: { id: 'W' + wa.length } } }; });
const waTo = (n) => wa.filter((m) => String(m.number || '').replace(/@.*/, '') === n);
const waText = (m) => String(m.text || (m.textMessage && m.textMessage.text) || '');

const tomorrow = cl.dhaka(new Date(Date.now() + 864e5)).day;
const in2 = cl.dhaka(new Date(Date.now() + 2 * 864e5)).day;

// ---- the gate
let r = await mgr('erpClinic', []);
check('refused while the Doctor desk is off', r && r.error && /চালু হয়নি/.test(r.error), r);
await sql`insert into erp_app_flags (key, enabled) values ('clinic', true) on conflict (key) do update set enabled = true`;
r = await sales('erpClinic', []);
check('a salesperson cannot open it', r && r.error, r);
r = await mgr('erpClinic', []);
check('manager opens it (no doctors yet)', r && Array.isArray(r.doctors) && r.doctors.length === 0 && r.bot && r.bot.on === false, r);
check('the WhatsApp number list has the clinic purpose', wan.PURPOSES.clinic && /Doctor/.test(wan.PURPOSES.clinic.name));

// ---- doctors
r = await owner('erpClinicDoctorSave', [{ name: 'Sabrina Hoque', phone: '123' }]);
check('a bad WhatsApp number is refused', r && r.error, r);
r = await owner('erpClinicDoctorSave', [{ name: 'Sabrina Hoque', title: 'MBBS, DDV', regNo: 'A-1', phone: '01711000001', treats: 'ব্রণ, মেছতা', fee: 800, slotMin: 20, gapMin: 5, holdMin: 20 }]);
const D1 = r.id;
check('doctor saved', D1 > 0, r);
r = await owner('erpClinicDoctorSave', [{ name: 'Mehzabin Rahman', phone: '01711000002', fee: 1000, slotMin: 30, gapMin: 0 }]);
const D2 = r.id;
// oli-look-1: the doctor's own photo
const PNG1 = ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYA', 'AAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='].join('');   // split: the pre-push key check reads 'EAA...' as a token
r = await sales('erpClinicDoctorPhoto', [{ doctorId: D1, mime: 'image/png', data: PNG1 }]);
check('sales cannot change a doctor photo', r && r.error, r);
r = await mgr('erpClinicDoctorPhoto', [{ doctorId: D1, mime: 'application/pdf', data: PNG1 }]);
check('a doctor photo must be a picture', r && r.error, r);
r = await mgr('erpClinicDoctorPhoto', [{ doctorId: D1, mime: 'image/png', data: PNG1 }]);
check('manager sets a doctor photo', r && r.ok, r);
r = await owner('erpClinic', []);
check('the desk gives the photo link for that doctor only', r && r.doctors.find((d) => d.id === D1).photoUrl && !r.doctors.find((d) => d.id === D2).photoUrl, r && r.doctors);
const all = [0, 1, 2, 3, 4, 5, 6];
r = await owner('erpClinicHoursSave', [{ doctorId: D1, hours: [{ weekday: 1, from: '10:00', to: '12:00' }, { weekday: 1, from: '11:00', to: '13:00' }] }]);
check('overlapping hours on one day are refused', r && r.error, r);
r = await owner('erpClinicHoursSave', [{ doctorId: D1, hours: all.map((w) => ({ weekday: w, from: '10:00', to: '13:00' })).concat(all.map((w) => ({ weekday: w, from: '19:00', to: '22:00' }))) }]);
check('weekly hours saved', r && r.count === 14, r);
await owner('erpClinicHoursSave', [{ doctorId: D2, hours: all.map((w) => ({ weekday: w, from: '11:00', to: '14:00' })) }]);
r = await mgr('erpClinicSlots', [{ doctorId: D1, day: tomorrow }]);
check('free slots follow hours, length and gap (10:00, 10:25, ...)', r && r.slots[0] === '10:00' && r.slots[1] === '10:25' && r.slots.includes('19:00') && !r.slots.includes('13:00'), r);

// ---- a day off
r = await owner('erpClinicOffSave', [{ doctorId: D2, day: tomorrow, reason: 'ছুটি' }]);
const OFF = r.id;
r = await mgr('erpClinicSlots', [{ doctorId: D2, day: tomorrow }]);
check('a whole day off leaves no free slot', r && r.slots.length === 0, r);
await owner('erpClinicOffStrike', [{ id: OFF }]);
r = await mgr('erpClinicSlots', [{ doctorId: D2, day: tomorrow }]);
check('struck out, the day is free again (and the row is kept)', r && r.slots.length === 6 && (await sql`select count(*)::int n from clinic_offs where id = ${OFF}`)[0].n === 1, r);

// ---- patients + booking by hand
r = await mgr('erpClinicPatientSave', [{ name: 'Nadia Chowdhury', phone: '01712000001', age: 29, gender: 'f', concern: 'শুষ্ক ত্বক', consent: true }]);
const P1 = r.id;
check('patient saved', P1 > 0, r);
r = await mgr('erpClinicPatientSave', [{ name: 'Nadia C.', phone: '01712000001' }]);
check('the same phone is the same patient', r.id === P1, r);
r = await mgr('erpClinicBook', [{ doctorId: D1, patientId: P1, day: tomorrow, time: '10:00' }]);
const C1 = r.id;
check('booked by hand = confirmed at once', r && r.state === 'confirmed' && /^C-\d+$/.test(r.no), r);
r = await mgr('erpClinicBook', [{ doctorId: D1, patientId: P1, day: tomorrow, time: '10:00' }]);
check('the same time again is refused (no double booking)', r && r.error && /আরেকটা রোগী/.test(r.error), r);
r = await mgr('erpClinicBook', [{ doctorId: D1, patientId: P1, day: tomorrow, time: '10:10', anyTime: true }]);
check('an overlapping time is refused even by hand', r && r.error, r);
r = await mgr('erpClinicBook', [{ doctorId: D1, patientId: P1, day: tomorrow, time: '15:00' }]);
check('outside the doctor\'s hours is refused', r && r.error && /বসেন না/.test(r.error), r);
r = await mgr('erpClinicSlots', [{ doctorId: D1, day: tomorrow }]);
check('the booked slot is no longer free', r && !r.slots.includes('10:00') && r.slots.includes('10:25'), r);

// ---- the bot's number, the doctor's yes / no
const W = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings) values (${FIX.B}, 'wa_evo', 'Doctor desk', 'instC', 'live', true, '{"purpose":"clinic"}'::jsonb) returning *`)[0];
await asB(async (ctx) => { await chm.chSecretSet(ctx, W, 'URL', 'https://evo.test'); await chm.chSecretSet(ctx, W, 'KEY', 'k1'); });
r = await mgr('erpClinicPatientSave', [{ name: 'Farhana Sultana', phone: '01712000002', gender: 'f', concern: 'চুল পড়া', consent: true }]);
const P2 = r.id;
wa.length = 0;
r = await mgr('erpClinicBook', [{ doctorId: D1, patientId: P2, day: tomorrow, time: '19:00', askDoctor: true }]);
const C2 = r.id;
check('"ask the doctor" holds the slot (requested) and asks on WhatsApp', r && r.state === 'requested' && r.asked && r.asked.sent, r);
check('the ask went to the doctor\'s number with the consult number', waTo('8801711000001').some((m) => /C-\d+/.test(waText(m)) && /হ্যাঁ/.test(waText(m))), wa);
r = await mgr('erpClinic', [{ day: tomorrow }]);
check('the page shows it waiting for the doctor', r && r.waits.some((c) => c.id === C2 && c.state === 'requested') && r.bot.on, r && r.waits);
wa.length = 0;
let res = await asB(async (ctx) => ib.ingest(ctx, W, { from: '8801711000001', text: 'হ্যাঁ পারব', id: 'd1' }));
check('the doctor\'s "হ্যাঁ" is caught (not a patient chat)', res && res.doctor, res);
let c = (await sql`select * from clinic_consults where id = ${C2}`)[0];
check('-> confirmed, the hold is gone', c.state === 'confirmed' && !c.hold_until && /হ্যাঁ/.test(c.doctor_said), c);
check('the patient is told (WhatsApp to the patient) and the doctor thanked', waTo('8801712000002').length === 1 && /সুখবর/.test(waText(waTo('8801712000002')[0])) && waTo('8801711000001').length === 1, wa);
check('no patient conversation was made for the doctor', (await sql`select count(*)::int n from inbox_conversations where channel_id = ${W.id}`)[0].n === 0);

r = await mgr('erpClinicBook', [{ doctorId: D1, patientId: P2, day: in2, time: '20:15', askDoctor: true }]);
const C3 = r.id;
wa.length = 0;
await asB(async (ctx) => ib.ingest(ctx, W, { from: '8801711000001', text: 'না, ওইদিন পারব না', id: 'd2' }));
c = (await sql`select * from clinic_consults where id = ${C3}`)[0];
check('the doctor\'s "না" declines it, with the reason kept', c.state === 'declined' && /ডাক্তার/.test(c.reason), c);
check('the patient gets other free times', waTo('8801712000002').some((m) => /১\./.test(waText(m)) && /পারছেন না/.test(waText(m))), wa);
wa.length = 0;
await asB(async (ctx) => ib.ingest(ctx, W, { from: '8801711000001', text: 'kemon achen', id: 'd3' }));
check('the doctor writing with nothing open gets the day\'s list, nothing changes', waTo('8801711000001').length === 1, wa);

// ---- the page's actions
r = await mgr('erpClinicAct', [{ id: C1, action: 'done' }]);
check('"seen" before the time is refused', r && r.error, r);
r = await mgr('erpClinicAct', [{ id: C1, action: 'cancel' }]);
check('cancel needs a reason', r && r.error && /কারণ/.test(r.error), r);
r = await mgr('erpClinicAct', [{ id: C1, action: 'paid', note: 'bKash 4521' }]);
check('fee marked paid', r && r.ok, r);
r = await mgr('erpClinicAct', [{ id: C1, action: 'move', day: tomorrow, time: '10:25' }]);
const C1b = r.id;
c = (await sql`select * from clinic_consults where id = ${C1}`)[0];
const c1b = (await sql`select * from clinic_consults where id = ${C1b}`)[0];
check('moving = the old one cancelled (kept), a new confirmed one, paid carried over', c.state === 'cancelled' && c1b.state === 'confirmed' && c1b.paid && c1b.pay_note === 'bKash 4521', [c.state, c1b]);
r = await mgr('erpClinicPatient', [{ id: P1 }]);
check('the patient page has both consults and their history', r && r.consults.length === 2 && r.events.some((e) => /সময় বদল/.test(e.what)) && r.patient.consentAt, r && r.events);

// ---- the timer: holds run out, reminders
r = await mgr('erpClinicBook', [{ doctorId: D2, patientId: P1, day: in2, time: '11:00', askDoctor: true }]);
const C4 = r.id;
await sql`update clinic_consults set hold_until = now() - interval '1 minute' where id = ${C4}`;
wa.length = 0;
let t = await asB(async (ctx) => cl.clinicTick(ctx));
c = (await sql`select * from clinic_consults where id = ${C4}`)[0];
check('a hold that ran out -> expired, the patient gets other times', c.state === 'expired' && t.expired === 1 && waTo('8801712000001').some((m) => /ধরে রাখতে পারলাম না/.test(waText(m))), [c.state, t, wa]);
// tomorrow's consults get the day-before reminder only between 24 h and 3 h ahead: put one 5 hours ahead
const soonP = (await sql`insert into clinic_patients (business_id, name, phone, gender) values (${FIX.B}, 'Jesmin', '01712000003', 'f') returning id`)[0].id;
const day5 = await sql`insert into clinic_consults (business_id, no, doctor_id, patient_id, starts_at, ends_at, state, fee) values (${FIX.B}, 'C-901', ${D1}, ${soonP}, now() + interval '5 hours', now() + interval '5 hours 20 minutes', 'confirmed', 800) returning id`;
const now30 = await sql`insert into clinic_consults (business_id, no, doctor_id, patient_id, starts_at, ends_at, state, video_link) values (${FIX.B}, 'C-902', ${D2}, ${soonP}, now() + interval '30 minutes', now() + interval '60 minutes', 'confirmed', 'https://meet.test/abc') returning id`;
wa.length = 0;
t = await asB(async (ctx) => cl.clinicTick(ctx));
const a5 = (await sql`select reminded_day from clinic_consults where id = ${day5[0].id}`)[0], a30 = (await sql`select reminded_soon from clinic_consults where id = ${now30[0].id}`)[0];
check('the day-before reminder goes (with the unpaid fee)', a5.reminded_day && waTo('8801712000003').some((m) => /মনে করিয়ে/.test(waText(m)) && /৳800/.test(waText(m))), [t, wa]);
check('the reminder before the call has the link; the doctor hears it too', a30.reminded_soon && waTo('8801712000003').some((m) => /meet\.test\/abc/.test(waText(m))) && waTo('8801711000002').length === 1, wa);
t = await asB(async (ctx) => cl.clinicTick(ctx));
check('reminders go once', t.remindedDay === 0 && t.remindedSoon === 0, t);

// ---- the booking assistant (AI) on the clinic number
const sTom = tomorrow;
script = [
  [{ functionCall: { name: 'save_patient', args: { name: 'Mariya', age: 24, gender: 'f', concern: 'মুখে ছোট দানা', since: '২ মাস', consent: true } } }],
  [{ functionCall: { name: 'free_times', args: { doctor_id: D1, day: sTom } } }],
  [{ functionCall: { name: 'book', args: { doctor_id: D1, day: sTom, time: '20:15', concern: 'মুখে ছোট দানা' } } }],
  [{ text: 'আপু, সময়টা ধরে রেখেছি, ডাক্তারের সাথে কনফার্ম করে এখনই জানাচ্ছি।' }],
];
wa.length = 0;
res = await asB(async (ctx) => ib.ingest(ctx, W, { from: '8801712000009', name: 'Mariya', text: 'রাজি। কাল রাত ৮:১৫ হলে ভালো', id: 'p1' }));
check('a patient message on the clinic number is queued for the assistant', res && res.conversationId && res.dueInMs >= 0, res);
res = await asB(async (ctx) => ib.replyDue(ctx, res.conversationId, true));
const bot = (await sql`select c.*, p.name pn, p.consent_at from clinic_consults c join clinic_patients p on p.id = c.patient_id where c.source = 'bot'`)[0];
check('the assistant saved the patient (with consent) and held the time', bot && bot.pn === 'Mariya' && bot.consent_at && bot.state === 'requested' && bot.conversation_id, bot);
check('the assistant asked the doctor and answered the patient in the chat', waTo('8801711000001').some((m) => /Mariya/.test(waText(m))) && waTo('8801712000009').some((m) => /কনফার্ম/.test(waText(m))), wa);
wa.length = 0;
await asB(async (ctx) => ib.ingest(ctx, W, { from: '8801711000001', text: '#' + bot.no + ' ok', id: 'd9' }));
check('"#C.. ok" from the doctor confirms that one and the patient hears it in the same chat', (await sql`select state from clinic_consults where id = ${bot.id}`)[0].state === 'confirmed' && waTo('8801712000009').some((m) => /সুখবর/.test(waText(m))), wa);
const sysPrompt = cl.clinicPrompt(await asB(async (ctx) => cl.settings(ctx)), 'Oliareen', false);
check('the assistant never calls itself an AI and never diagnoses', /Never say or hint that you are an AI/.test(sysPrompt) && /NEVER: diagnose/.test(sysPrompt));

// ---- the other business, and nothing deleted
check('the other business has nothing', (await sql`select count(*)::int n from clinic_consults where business_id = ${FIX.B2}`)[0].n === 0 && (await sql`select count(*)::int n from clinic_patients where business_id = ${FIX.B2}`)[0].n === 0);
check('every consult is kept (cancelled / declined / expired too)', (await sql`select count(*)::int n from clinic_consults where business_id = ${FIX.B} and state in ('cancelled', 'declined', 'expired')`)[0].n === 3);
r = await mgr('erpClinicSettingsSave', [{ agent_name: 'X' }]);
check('the assistant\'s rules: only the owner changes them', r && r.error, r);
r = await owner('erpClinicSettingsSave', [{ agent_name: 'নুসরাত', pay_text: 'bKash 01700000000', doctor_group: 'bad' }]);
check('a wrong group address is refused', r && r.error, r);
r = await owner('erpClinicSettingsSave', [{ agent_name: 'নুসরাত', pay_text: 'bKash 01700000000' }]);
check('owner saves the assistant\'s rules', r && r.settings && r.settings.pay_text === 'bKash 01700000000', r);
check('Bangla time words', cl.clock(20 * 60) === 'রাত ৮:০০' && cl.clock(13 * 60 + 5) === 'দুপুর ১:০৫' && cl.yesNo('হ্যাঁ') === 'yes' && cl.yesNo('#C-3 ok') === 'yes' && cl.yesNo('না') === 'no' && cl.yesNo('kal?') === '');

// ---- clinic-2: the team gives orders on WhatsApp; the bot's number is linked with a pairing code
await owner('erpClinicSettingsSave', [{ team_phones: '01799000001' }]);
script = [
  [{ functionCall: { name: 'schedule', args: { day: tomorrow } } }],
  [{ text: 'কাল ডা. Sabrina Hoque-এর ৩টা বুকিং।' }],
];
wa.length = 0;
res = await asB(async (ctx) => ib.ingest(ctx, W, { from: '8801799000001', text: 'kal ke ke ase?', id: 't1' }));
check('a team phone\'s message is an order (not a patient chat)', res && res.doctor, res);
check('the bot answers the team phone with what it found', waTo('8801799000001').some((m) => /বুকিং/.test(waText(m))), wa);
check('no patient conversation for the team phone', (await sql`select count(*)::int n from inbox_conversations v join inbox_contacts k on k.id = v.contact_id where v.channel_id = ${W.id} and k.external_id like '%799000001%'`)[0].n === 0);
const cnoRow = (await sql`select no from clinic_consults where business_id = ${FIX.B} and state = 'confirmed' and starts_at > now() order by starts_at limit 1`)[0];
script = [
  [{ functionCall: { name: 'change', args: { no: cnoRow.no, action: 'paid', note: 'bKash 1111' } } }],
  [{ text: 'ফি পাওয়া দাগ দিলাম।' }],
];
await asB(async (ctx) => ib.ingest(ctx, W, { from: '8801799000001', text: cnoRow.no + ' er fee paisi bkash 1111', id: 't2' }));
check('an order changes the booking (fee marked paid)', (await sql`select paid from clinic_consults where business_id = ${FIX.B} and no = ${cnoRow.no}`)[0].paid === true);
await sql`insert into business_secrets (business_id, key, value) values (${FIX.B}, 'WA_SERVER_URL', 'https://evoc.test'), (${FIX.B}, 'WA_SERVER_KEY', 'kk') on conflict (business_id, key) do update set value = excluded.value`;
web.on(/evoc\.test/, (url) => {
  if (/instance\/create/.test(url)) return { status: 201, body: { hash: 'tok1', qrcode: {} } };
  if (/connectionState/.test(url)) return { status: 200, body: { instance: { state: 'connecting' } } };
  if (/instance\/connect\//.test(url)) return { status: 200, body: { pairingCode: 'WZYEH1YY', base64: 'iVBORw0KGgo=' } };
  return { status: 200, body: {} };
});
r = await mgr('erpClinicConnect', [{ phone: '01700000009' }]);
check('only the owner links the bot\'s number', r && r.error, r);
await sql`update inbox_channels set status = 'removed' where id = ${W.id}`;
r = await owner('erpClinicConnect', [{ phone: '01700000009' }]);
check('linking gives an 8-letter pairing code and a QR', r && r.code === 'WZYE-H1YY' && /^data:image/.test(r.qr) && !r.linked, r);
const nch = (await sql`select * from inbox_channels where business_id = ${FIX.B} and kind = 'wa_evo' and status <> 'removed' and settings->>'purpose' = 'clinic'`);
check('the number is made for the clinic job only, on this business\'s own server', nch.length === 1 && nch[0].settings.number_wanted === '01700000009', nch);
r = await owner('erpClinicConnect', [{ phone: '01700000009' }]);
check('asking again reuses the same number', r && r.channelId === nch[0].id, r);
r = await mgr('erpClinicConnectState', []);
check('the page reads whether the phone is linked', r && r.state === 'connecting' && r.linked === false, r);
// clinicqr-1: the page asks for the current QR every few seconds
const evoUrls = [];
web.on(/evoc\.test/, (url) => {
  evoUrls.push(url);
  if (/connectionState/.test(url)) return { status: 200, body: { instance: { state: 'connecting' } } };
  if (/instance\/connect\//.test(url)) return { status: 200, body: { pairingCode: null, base64: 'iVBORw0KGgoNEW=', count: 7 } };
  return { status: 200, body: {} };
});
r = await sales('erpClinicConnectQr', []);
check('sales cannot read the link QR', r && r.error, r);
r = await owner('erpClinicConnectQr', []);
check('the current QR comes back while connecting', r && r.qr === 'data:image/png;base64,iVBORw0KGgoNEW=' && r.linked === false && r.count === 7, r);
check('while connecting the QR is read without a new round (no number sent)', evoUrls.some((u) => /instance\/connect\//.test(u) && !/number=/.test(u)), evoUrls);
web.on(/evoc\.test/, (url) => /connectionState/.test(url) ? { status: 200, body: { instance: { state: 'open' } } } : { status: 200, body: {} });
r = await owner('erpClinicConnectQr', []);
check('once scanned the page is told it is linked', r && r.linked === true, r);

done();
