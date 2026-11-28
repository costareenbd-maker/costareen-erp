// clinic-rx (owner 29 Nov 2026): prescriptions, made like a sales invoice. Raj sent two prescriptions the doctor wrote on
// Oliareen's pad (28 Nov); the pad here follows them: the business logo, the doctor's name, title and degrees, the BMDC
// number, the patient line (name, Rx number, age, sex, date), presenting concerns / relevant history / examination
// findings / diagnosis, a table of recommended products (product, how to apply, how often, how long), medicines, advice,
// follow-up, the doctor's signature line and the website.
//   erpClinicRx({consultId} | {id})   the prescription of a consult (or a new one filled from it), presets, the doctor
//   erpClinicRxHtml({consultId, data}) the pad as HTML for the live preview (nothing saved)
//   erpClinicRxSave({consultId, data}) keep the draft
//   erpClinicRxFinal({id})            lock it and keep its PDF (it can no longer change)
//   erpClinicRxPdf({id})              a link to the PDF
//   erpClinicRxSend({id})             the PDF to the patient on the booking bot's WhatsApp
//   erpClinicRxAmend({id, reason})    strike a finished one out and start the next version (nothing is deleted)
//   erpClinicRxList({q})              every prescription, newest first
//   erpClinicRxProducts({q})          this business's products for the product lines
import { roleAtLeast, actsAsOwner } from '../allow.js';
import { saveFile, fileUrl, readFile, renderPdf } from '../lib/ext.js';
import { appIsOff } from './apps.js';
import { platformAdmin } from './platform.js';

const str = (v) => String(v == null ? '' : v).trim();
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const h = (v) => str(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (v) => h(v).replace(/\n/g, '<br>');
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayOf = (d) => new Date(new Date(d).getTime() + 6 * 3600e3).toISOString().slice(0, 10);
const longDate = (day) => { const [y, m, dd] = str(day).slice(0, 10).split('-'); return y ? MON[int(m) - 1] + ' ' + int(dd) + ', ' + y : ''; };
const ADVICE_DEFAULT = [
  'Drink at least 2 litres of water daily, subject to the doctor’s advice and any individual fluid restrictions.',
  'Wash towels, bed sheets, and pillow covers regularly with detergent, rinse thoroughly, and dry completely before reuse.',
  'Use sunscreen every morning and reapply when outdoors.',
  'Do not pick or squeeze spots.',
];
const MAX = { text: 2000, rows: 20 };

async function gate(ctx) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('প্রেসক্রিপশন ম্যানেজার বা মালিক লিখতে পারেন।');
  let on = false;
  try { on = !(await appIsOff(ctx.deps, ctx.sql, 'clinic', { biz: ctx.biz, s: { role: 'owner' } })); } catch (_) { on = false; }
  if (!on && !(await platformAdmin(ctx))) throw new Error('এই ব্যবসায় ডাক্তার ডেস্ক এখনো চালু হয়নি।');
}
const byName = (ctx) => str(ctx.s && (ctx.s.name || ctx.s.email)) || 'টিম';

/** What a prescription holds - every field cleaned and cut to size. */
export function cleanData(d) {
  d = d || {};
  const t = (v) => str(v).slice(0, MAX.text);
  const rows = (a, keys) => (Array.isArray(a) ? a : []).slice(0, MAX.rows).map((r) => Object.fromEntries(keys.map((k) => [k, str(r && r[k]).slice(0, 300)]))).filter((r) => keys.some((k) => r[k]));
  return {
    concerns: t(d.concerns), history: t(d.history), findings: t(d.findings), diagnosis: t(d.diagnosis),
    products: rows(d.products, ['name', 'sku', 'how', 'freq', 'duration']),
    medicines: rows(d.medicines, ['name', 'dose', 'duration', 'note']),
    advice: (Array.isArray(d.advice) ? d.advice : []).map((x) => str(x).slice(0, 400)).filter(Boolean).slice(0, MAX.rows),
    followUp: t(d.followUp).slice(0, 200), followDate: /^\d{4}-\d{2}-\d{2}$/.test(str(d.followDate)) ? str(d.followDate) : '',
    review: t(d.review).slice(0, 300),
  };
}

async function consultOf(ctx, id) {
  const c = (await ctx.tx`select * from clinic_consults where business_id = ${ctx.biz} and id = ${int(id)}`)[0];
  if (!c) throw new Error('এই বুকিং আর পাওয়া গেল না।');
  return c;
}
async function rxOf(ctx, id) {
  const r = (await ctx.tx`select * from clinic_prescriptions where business_id = ${ctx.biz} and id = ${int(id)}`)[0];
  if (!r) throw new Error('এই প্রেসক্রিপশন আর পাওয়া গেল না।');
  return r;
}
async function partsOf(ctx, doctorId, patientId) {
  const d = (await ctx.tx`select * from clinic_doctors where business_id = ${ctx.biz} and id = ${doctorId}`)[0];
  const p = (await ctx.tx`select * from clinic_patients where business_id = ${ctx.biz} and id = ${patientId}`)[0];
  if (!d || !p) throw new Error('ডাক্তার বা রোগীকে পাওয়া গেল না।');
  return { d, p };
}
const rxOut = (r) => r ? ({ id: Number(r.id), no: str(r.no), version: int(r.version), consultId: r.consult_id == null ? null : Number(r.consult_id), patientId: Number(r.patient_id),
  doctorId: Number(r.doctor_id), date: r.rx_date instanceof Date ? r.rx_date.toISOString().slice(0, 10) : str(r.rx_date).slice(0, 10), data: cleanData(r.data), state: str(r.state),
  finalAt: r.final_at ? new Date(r.final_at).toISOString() : null, struckReason: str(r.struck_reason), sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
  hasPdf: !!str(r.pdf_path), by: str(r.created_by) }) : null;

/** The pad (A4), as the doctor's pad Raj sent. */
export async function padHtml(ctx, o) {
  const { d, p, data, no, date } = o;
  let logo = '', biz = '', web = '';
  try {
    const sales = await import('./sales.js');
    const q = await sales.qProfile(ctx);
    biz = str(q.name); web = str(q.website).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    logo = (await sales.docImg(ctx, q.logoTrimId)) || (await sales.docImg(ctx, q.logoId));
  } catch (_) { /* a pad without a logo still works */ }
  if (!biz) biz = str((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0]?.name);
  const title = str(d.title).split(/\s*·\s*/).filter(Boolean);
  const head = title.length ? title[0] : '';
  const degrees = title.slice(1);
  const sex = p.gender === 'f' ? 'Female' : p.gender === 'm' ? 'Male' : '';
  const sec = (label, v) => '<div class="sec"><div class="lab">' + label + '</div><div class="val">' + (str(v) ? nl(v) : '&nbsp;') + '</div></div>';
  const prod = data.products.length ? data.products : [{ name: '', how: '', freq: '', duration: '' }];
  return '<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600&display=swap" rel="stylesheet"><style>' +
    '@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font:13.5px/1.45 "Times New Roman",Times,"Hind Siliguri",serif;color:#1d1d1f;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    '.pg{width:210mm;min-height:297mm;padding:14mm 16mm 12mm;position:relative;display:flex;flex-direction:column}' +
    '.top{display:flex;justify-content:space-between;align-items:flex-start;gap:10mm}.logo img{max-height:22mm;max-width:70mm}.logo .w{font:700 30px/1 "Hind Siliguri",sans-serif;color:#8B2346}' +
    '.doc{text-align:right}.doc .n{font:700 25px/1.15 "Times New Roman",serif;color:#8B2346}.doc .t{font-weight:700;color:#8B2346;font-size:14.5px}.doc .d{font-size:12.5px}' +
    '.doc .r{font-weight:700;font-size:12.5px;margin-top:2px}h1{font:700 18px Arial,sans-serif;margin:9mm 0 5mm}' +
    '.pt{display:grid;grid-template-columns:1fr 1fr;gap:4mm 10mm;font-size:13.5px;margin-bottom:6mm}.pt b{font-weight:700}' +
    '.two{display:grid;grid-template-columns:1fr 1fr;gap:0 8mm}.sec{border-bottom:1px solid #e3e3e6;padding:2mm 0 3mm;margin-bottom:3mm;min-height:20mm}' +
    '.lab{color:#8B2346;font-weight:700;font-size:14px;margin-bottom:1mm}.val{white-space:normal}' +
    'table{width:100%;border-collapse:collapse;margin-top:2mm}th{background:#8B2346;color:#fff;text-align:left;padding:2.6mm 3mm;font-size:13.5px}' +
    'td{border:1px solid #dcdce0;padding:3mm;vertical-align:top;font-size:13.5px}.lst{margin:1mm 0 0;padding-left:0;list-style:none;counter-reset:a}.lst li{counter-increment:a;padding-left:5mm;text-indent:-5mm;margin-bottom:1.4mm}' +
    '.lst li::before{content:counter(a) ". "}.med td{border-top:0}.medh{font-weight:700;font-size:15px}.rev{font-size:12.5px;margin-top:2mm}' +
    '.foot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;padding-top:6mm}.sig{text-align:center;color:#8B2346;font-size:13px}.sig .ln{width:62mm;border-top:1px solid #555;margin-bottom:1.5mm}' +
    '.web{text-align:center;color:#8B2346;font-size:12px;border-bottom:1px solid #8B2346;padding-bottom:2mm;margin-top:6mm}' +
    '</style></head><body><div class="pg">' +
    '<div class="top"><div class="logo">' + (logo ? '<img src="' + logo + '">' : '<div class="w">' + h(biz.toLowerCase()) + '</div>') + '</div>' +
    '<div class="doc"><div class="n">Dr. ' + h(d.name) + '</div>' + (head ? '<div class="t">' + h(head) + '</div>' : '') + degrees.map((x) => '<div class="d">' + h(x) + '</div>').join('') +
    '<div class="r">Registration No. ' + (str(d.reg_no) ? h(d.reg_no) : '____________________') + '</div></div></div>' +
    '<h1>Prescription</h1>' +
    '<div class="pt"><div><b>Patient name:</b> ' + h(p.name) + '</div><div><b>Patient ID: ' + h(no) + '</b></div>' +
    '<div><b>Age:</b> ' + (p.age ? h(p.age) : '—') + ' &nbsp; <b>Sex:</b> ' + (sex || '—') + '</div><div><b>Consultation date</b>: ' + h(longDate(date)) + '</div></div>' +
    '<div class="two">' + sec('Presenting concerns', data.concerns) + sec('Relevant history', data.history) + sec('Examination findings', data.findings) + sec('Diagnosis', data.diagnosis) + '</div>' +
    '<div class="lab" style="margin-top:3mm">Recommended products</div><table><tr><th style="width:33%">Product</th><th style="width:35%">Application instructions</th><th style="width:16%">Frequency</th><th>Duration</th></tr>' +
    prod.map((r, i) => '<tr><td>' + (str(r.name) ? (i + 1) + '. ' + h(r.name) : '&nbsp;') + '</td><td>' + nl(r.how) + '</td><td>' + h(r.freq) + '</td><td>' + h(r.duration) + '</td></tr>').join('') +
    (data.medicines.length ? '<tr class="med"><td colspan="4" class="medh">Medicine:</td></tr>' + data.medicines.map((m) => '<tr class="med"><td>' + h(m.name) + '</td><td>' + h(m.dose) + (m.note ? '<br><span style="font-size:12px">' + h(m.note) + '</span>' : '') + '</td><td></td><td>' + h(m.duration) + '</td></tr>').join('') : '') +
    '</table>' + (data.review ? '<div class="rev"><b>Frequency for doctor review</b> ' + h(data.review) + '</div>' : '') +
    (data.advice.length ? '<div class="lab" style="margin-top:4mm">Advice</div><ol class="lst">' + data.advice.map((a) => '<li>' + h(a) + '</li>').join('') + '</ol>' : '') +
    (data.followUp || data.followDate ? '<div class="lab" style="margin-top:3mm">Follow-up</div><div>' + h(data.followUp) + '</div>' : '') +
    '<div class="foot"><div><b>Date:</b> <span style="font-size:15px">' + h(longDate(data.followDate || date)) + '</span></div><div class="sig"><div class="ln"></div>Doctor’s signature and stamp</div></div>' +
    (web ? '<div class="web">' + h(web) + '</div>' : '') + '</div></body></html>';
}

/** The next number: O-<day>-<that day's count>, the letter from the business name (Oliareen -> O). */
async function nextNo(ctx, day) {
  const biz = str((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0]?.name);
  const letter = (biz.match(/[A-Za-z]/) || ['R'])[0].toUpperCase();
  const dd = day.slice(8, 10);
  const n = (await ctx.tx`select count(distinct no)::int n from clinic_prescriptions where business_id = ${ctx.biz} and rx_date = ${day}`)[0].n + 1;
  return letter + '-' + dd + '-' + String(n).padStart(4, '0');
}

export async function erpClinicRx(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  let r = null, c = null;
  if (a.id) { r = await rxOf(ctx, a.id); if (r.consult_id) c = await consultOf(ctx, r.consult_id); }
  else {
    c = await consultOf(ctx, a.consultId);
    r = (await ctx.tx`select * from clinic_prescriptions where business_id = ${ctx.biz} and consult_id = ${c.id} and state <> 'struck' order by version desc limit 1`)[0] || null;
  }
  const doctorId = r ? r.doctor_id : c.doctor_id, patientId = r ? r.patient_id : c.patient_id;
  const { d, p } = await partsOf(ctx, doctorId, patientId);
  const fresh = !r;
  const data = r ? cleanData(r.data) : cleanData({ concerns: str(c.concern || p.concern), history: [p.since ? 'Since ' + p.since : '', p.routine ? 'Using: ' + p.routine : '', p.allergies ? 'Allergies / medicines: ' + p.allergies : ''].filter(Boolean).join('\n'), advice: [] });
  // advice this doctor wrote before (most used first), then the pad's own two lines
  const used = await ctx.tx`select a, count(*)::int n from clinic_prescriptions, jsonb_array_elements_text(data->'advice') a where business_id = ${ctx.biz} and doctor_id = ${d.id} and state = 'final' group by a order by n desc limit 12`;
  const presets = Array.from(new Set(used.map((x) => str(x.a)).concat(ADVICE_DEFAULT)));
  const past = await ctx.tx`select id, no, version, rx_date, state from clinic_prescriptions where business_id = ${ctx.biz} and patient_id = ${p.id} order by rx_date desc, id desc limit 20`;
  return {
    rx: rxOut(r), fresh, data, consultId: c ? Number(c.id) : null,
    date: r ? rxOut(r).date : dayOf(c.starts_at),
    doctor: { id: Number(d.id), name: str(d.name), title: str(d.title), regNo: str(d.reg_no) },
    patient: { id: Number(p.id), name: str(p.name), age: p.age == null ? null : int(p.age), gender: str(p.gender), phone: str(p.phone) },
    presets, history: past.map((x) => ({ id: Number(x.id), no: str(x.no), version: int(x.version), date: x.rx_date instanceof Date ? x.rx_date.toISOString().slice(0, 10) : str(x.rx_date).slice(0, 10), state: str(x.state) })),
  };
}
export async function erpClinicRxHtml(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  let d, p, no = 'O-—', date;
  if (a.id) { const r = await rxOf(ctx, a.id); ({ d, p } = await partsOf(ctx, r.doctor_id, r.patient_id)); no = str(r.no); date = rxOut(r).date; if (r.state !== 'draft' && !a.data) a.data = r.data; }
  else { const c = await consultOf(ctx, a.consultId); ({ d, p } = await partsOf(ctx, c.doctor_id, c.patient_id)); date = dayOf(c.starts_at); }
  return { html: await padHtml(ctx, { d, p, data: cleanData(a.data), no, date }) };
}
export async function erpClinicRxSave(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  const data = cleanData(a.data);
  if (a.id) {
    const r = await rxOf(ctx, a.id);
    if (r.state !== 'draft') throw new Error('শেষ করা প্রেসক্রিপশন বদলানো যায় না। "সংশোধন" চাপুন — আগেরটা কাটা থাকবে, নতুন সংস্করণ হবে।');
    await ctx.tx`update clinic_prescriptions set data = ${ctx.tx.json(data)}, updated_at = now() where id = ${r.id}`;
    return { id: Number(r.id), no: str(r.no) };
  }
  const c = await consultOf(ctx, a.consultId);
  const open = (await ctx.tx`select * from clinic_prescriptions where business_id = ${ctx.biz} and consult_id = ${c.id} and state <> 'struck' order by version desc limit 1`)[0];
  if (open && open.state === 'draft') { await ctx.tx`update clinic_prescriptions set data = ${ctx.tx.json(data)}, updated_at = now() where id = ${open.id}`; return { id: Number(open.id), no: str(open.no) }; }
  if (open) throw new Error('এই বুকিংয়ের প্রেসক্রিপশন শেষ করা আছে। বদলাতে "সংশোধন" চাপুন।');
  const day = dayOf(c.starts_at);
  const no = await nextNo(ctx, day);
  const r = (await ctx.tx`insert into clinic_prescriptions (business_id, no, version, consult_id, patient_id, doctor_id, rx_date, data, created_by)
                          values (${ctx.biz}, ${no}, 1, ${c.id}, ${c.patient_id}, ${c.doctor_id}, ${day}, ${ctx.tx.json(data)}, ${byName(ctx)}) returning id`)[0];
  await ctx.tx`insert into clinic_events (business_id, consult_id, what, by_name) values (${ctx.biz}, ${c.id}, ${'প্রেসক্রিপশন খসড়া ' + no}, ${byName(ctx)})`;
  return { id: Number(r.id), no };
}
export async function erpClinicRxFinal(ctx, payload) {
  await gate(ctx);
  const r = await rxOf(ctx, payload && payload.id);
  if (r.state !== 'draft') throw new Error('এটা আগেই শেষ করা হয়েছে।');
  const data = cleanData(r.data);
  if (!data.concerns && !data.products.length && !data.medicines.length && !data.diagnosis) throw new Error('খালি প্রেসক্রিপশন শেষ করা যায় না — অন্তত সমস্যা, রোগ নির্ণয় বা একটা প্রোডাক্ট/ওষুধ লিখুন।');
  const { d, p } = await partsOf(ctx, r.doctor_id, r.patient_id);
  const html = await padHtml(ctx, { d, p, data, no: str(r.no), date: rxOut(r).date });
  const pdf = await renderPdf(ctx, html, { format: 'A4' });
  const bytes = pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf);
  const name = 'rx-' + str(r.no) + '-v' + r.version + '-' + Date.now().toString(36) + '.pdf';
  await saveFile(ctx, 'clinic', name, bytes, 'application/pdf');
  await ctx.tx`update clinic_prescriptions set state = 'final', final_at = ${ctx.now}, pdf_path = ${'clinic:' + name}, updated_at = now() where id = ${r.id}`;
  if (r.consult_id) await ctx.tx`insert into clinic_events (business_id, consult_id, what, by_name) values (${ctx.biz}, ${r.consult_id}, ${'প্রেসক্রিপশন শেষ ' + r.no + (r.version > 1 ? ' (সংস্করণ ' + r.version + ')' : '')}, ${byName(ctx)})`;
  // the follow-up date goes to the consult as well
  if (r.consult_id && data.followDate) await ctx.tx`update clinic_consults set follow_up = ${data.followDate}, doctor_note = coalesce(nullif(doctor_note, ''), ${data.diagnosis || data.concerns}) where id = ${r.consult_id}`;
  return { id: Number(r.id), state: 'final' };
}
export async function erpClinicRxPdf(ctx, payload) {
  await gate(ctx);
  const r = await rxOf(ctx, payload && payload.id);
  if (!str(r.pdf_path)) throw new Error('এর PDF এখনো হয়নি — আগে "শেষ করুন" চাপুন।');
  const [folder, ...rest] = str(r.pdf_path).split(':');
  return { url: await fileUrl(ctx, folder, rest.join(':')) };
}
export async function erpClinicRxSend(ctx, payload) {
  await gate(ctx);
  const r = await rxOf(ctx, payload && payload.id);
  if (r.state !== 'final' || !str(r.pdf_path)) throw new Error('আগে প্রেসক্রিপশন শেষ করুন, তারপর পাঠান।');
  const { p } = await partsOf(ctx, r.doctor_id, r.patient_id);
  const cl = await import('./clinic.js');
  const ch = await cl.clinicChannel(ctx);
  if (!ch) throw new Error('বুকিং বটের WhatsApp নম্বর এখনো জোড়া হয়নি।');
  const [folder, ...rest] = str(r.pdf_path).split(':');
  const raw = await readFile(ctx, folder, rest.join(':'));
  if (!raw) throw new Error('PDF ফাইলটা পাওয়া গেল না।');
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  let b64 = ''; for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  b64 = btoa(b64);
  const { sendOut } = await import('./inboxch.js');
  let to = '';
  const c = r.consult_id ? (await ctx.tx`select conversation_id from clinic_consults where id = ${r.consult_id}`)[0] : null;
  if (c && c.conversation_id) { const k = (await ctx.tx`select k.external_id from inbox_conversations v join inbox_contacts k on k.id = v.contact_id where v.id = ${c.conversation_id}`)[0]; to = k ? str(k.external_id) : ''; }
  if (!to && p.phone) to = '88' + str(p.phone);
  if (!to) throw new Error('রোগীর WhatsApp নম্বর নেই।');
  const res = await sendOut(ctx, ch, { external_id: to }, { kind: 'document', base64: b64, mime: 'application/pdf', fileName: 'Prescription ' + str(r.no) + '.pdf', caption: 'আপনার প্রেসক্রিপশন (' + str(r.no) + ')। কোনো প্রশ্ন থাকলে এখানে লিখুন।' });
  if (!res || !res.ok) throw new Error('পাঠানো গেল না: ' + str(res && res.error));
  await ctx.tx`update clinic_prescriptions set sent_at = ${ctx.now} where id = ${r.id}`;
  if (r.consult_id) await ctx.tx`insert into clinic_events (business_id, consult_id, what, by_name) values (${ctx.biz}, ${r.consult_id}, ${'প্রেসক্রিপশন রোগীকে WhatsApp-এ পাঠানো ' + r.no}, ${byName(ctx)})`;
  return { ok: true };
}
export async function erpClinicRxAmend(ctx, payload) {
  await gate(ctx);
  const a = payload || {};
  const r = await rxOf(ctx, a.id);
  if (r.state !== 'final') throw new Error('শুধু শেষ করা প্রেসক্রিপশন সংশোধন করা যায়।');
  const why = str(a.reason).slice(0, 300);
  if (!why) throw new Error('কেন সংশোধন, এক লাইনে লিখুন।');
  await ctx.tx`update clinic_prescriptions set state = 'struck', struck_at = ${ctx.now}, struck_reason = ${why}, updated_at = now() where id = ${r.id}`;
  const n = (await ctx.tx`insert into clinic_prescriptions (business_id, no, version, consult_id, patient_id, doctor_id, rx_date, data, created_by)
                          values (${ctx.biz}, ${r.no}, ${r.version + 1}, ${r.consult_id}, ${r.patient_id}, ${r.doctor_id}, ${r.rx_date}, ${ctx.tx.json(r.data)}, ${byName(ctx)}) returning id`)[0];
  if (r.consult_id) await ctx.tx`insert into clinic_events (business_id, consult_id, what, by_name) values (${ctx.biz}, ${r.consult_id}, ${'প্রেসক্রিপশন ' + r.no + ' সংশোধন: ' + why}, ${byName(ctx)})`;
  return { id: Number(n.id), version: r.version + 1 };
}
export async function erpClinicRxList(ctx, payload) {
  await gate(ctx);
  const q = str(payload && payload.q).toLowerCase();
  const rows = await ctx.tx`select x.*, p.name pname, d.name dname from clinic_prescriptions x join clinic_patients p on p.id = x.patient_id join clinic_doctors d on d.id = x.doctor_id
                            where x.business_id = ${ctx.biz} and (${q} = '' or lower(p.name) like ${'%' + q + '%'} or lower(x.no) like ${'%' + q + '%'})
                            order by x.rx_date desc, x.id desc limit 200`;
  return { list: rows.map((r) => ({ ...rxOut(r), patientName: str(r.pname), doctorName: str(r.dname) })) };
}
export async function erpClinicRxProducts(ctx, payload) {
  await gate(ctx);
  const q = str(payload && payload.q).toLowerCase();
  if (q.length < 2) return { products: [] };
  const rows = await ctx.tx`select sku, name, brand from products where business_id = ${ctx.biz} and coalesce(status, 'Active') <> 'Inactive'
                            and (lower(name) like ${'%' + q + '%'} or lower(coalesce(brand, '')) like ${'%' + q + '%'} or lower(sku) like ${'%' + q + '%'}) order by name limit 12`;
  return { products: rows.map((r) => ({ sku: str(r.sku), name: str(r.name), brand: str(r.brand) })) };
}

export const HANDLERS = { erpClinicRx, erpClinicRxHtml, erpClinicRxSave, erpClinicRxFinal, erpClinicRxPdf, erpClinicRxSend, erpClinicRxAmend, erpClinicRxList, erpClinicRxProducts };
