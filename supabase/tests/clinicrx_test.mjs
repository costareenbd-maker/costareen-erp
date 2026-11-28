// clinic-rx (owner 29 Nov 2026): prescriptions like a sales invoice. A consult's prescription starts filled from the
// booking (concern, history from the patient), is kept as a draft, is finished (locked + PDF on the pad Raj sent),
// goes to the patient on the bot's WhatsApp, and a correction strikes it out and starts the next version.
import { sql, FIX, owner as owner0, mgr as mgr0, sales as sales0, check, done, pdfs, web, files } from './harness.mjs';

const un = (x) => (x && x.ok && 'result' in x ? x.result : x);
const owner = async (n, a) => un(await owner0(n, a)), mgr = async (n, a) => un(await mgr0(n, a)), sales = async (n, a) => un(await sales0(n, a));

await sql`insert into erp_app_flags (key, enabled) values ('clinic', true) on conflict (key) do update set enabled = true`;
const D = (await owner('erpClinicDoctorSave', [{ name: 'Demo Doctor', title: 'Aesthetic Dermatologist · MBBS, DDV (UK), MPH · Diploma in Cosmetic Gynaecology (UAE)', regNo: 'A-000001', phone: '01711000001', fee: 0, slotMin: 10 }])).id;
await owner('erpClinicHoursSave', [{ doctorId: D, hours: [0, 1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, from: '00:00', to: '23:50' })) }]);
const P = (await mgr('erpClinicPatientSave', [{ name: 'Demo Patient One', phone: '01712000001', age: 15, gender: 'f', concern: 'Bums and acne on face', since: '3 months', consent: true }])).id;
const tom = new Date(Date.now() + 864e5 + 6 * 3600e3).toISOString().slice(0, 10);
const C = (await mgr('erpClinicBook', [{ doctorId: D, patientId: P, day: tom, time: '18:00', anyTime: true }])).id;
await sql`insert into products (business_id, sku, name, brand, cost_price, sell_price) values (${FIX.B}, 'SA-MOIST-1', 'Salicylic Acid Moisturiser 50ml', 'TestBrand', 500, 900)`;

let r = await sales('erpClinicRx', [{ consultId: C }]);
check('a salesperson cannot write a prescription', r && r.error, r);
r = await mgr('erpClinicRx', [{ consultId: C }]);
check('a new prescription starts filled from the booking', r && r.fresh && r.data.concerns === 'Bums and acne on face' && /3 months/.test(r.data.history) && r.doctor.regNo === 'A-000001' && r.presets.length >= 2, r);
r = await mgr('erpClinicRxProducts', [{ q: 'salicylic' }]);
check('the product lines search this business\'s products', r && r.products.some((p) => p.sku === 'SA-MOIST-1'), r);
const data = { concerns: 'Bums and acne on face', diagnosis: 'Acne vulgaris (mild)', products: [{ name: 'Salicylic Acid Moisturiser 50ml', sku: 'SA-MOIST-1', how: 'Thin layer on the face', freq: 'Twice daily', duration: '1 month' }, { name: 'Broad-Spectrum Sunscreen SPF 50+', how: 'Morning', freq: 'Daily', duration: '' }],
  medicines: [{ name: 'Cap. Reticap 20mg', dose: '0+0+1', duration: '3 months' }], advice: ['Drink at least 2 litres of water daily.'], followUp: 'After one month.', followDate: '2026-12-28', review: '2–3 times daily' };
r = await mgr('erpClinicRxHtml', [{ consultId: C, data }]);
check('the live preview is the pad: doctor, BMDC, patient, products table, medicine, advice', r && /Dr\. Demo Doctor/.test(r.html) && /A-000001/.test(r.html) && /Demo Patient One/.test(r.html) && /Recommended products/.test(r.html) && /Reticap/.test(r.html) && /2 litres/.test(r.html), r && String(r.html).slice(0, 200));
r = await mgr('erpClinicRxSave', [{ consultId: C, data }]);
const X = r.id;
check('a draft is kept with a number like the pad (letter-day-serial)', r && X > 0 && /^[A-Z]-\d{2}-0001$/.test(r.no), r);
r = await mgr('erpClinicRxSave', [{ consultId: C, data: { ...data, diagnosis: 'Acne vulgaris' } }]);
check('saving again updates the same draft', r && r.id === X, r);
pdfs.length = 0;
r = await mgr('erpClinicRxFinal', [{ id: X }]);
const row = (await sql`select * from clinic_prescriptions where id = ${X}`)[0];
check('finishing locks it and keeps the PDF', r && r.state === 'final' && row.state === 'final' && /^clinic:rx-/.test(row.pdf_path) && pdfs.length === 1 && files.list().some((k) => /clinic\/rx-/.test(k)), [r, row.pdf_path]);
check('the follow-up date goes to the booking', (await sql`select follow_up from clinic_consults where id = ${C}`)[0].follow_up !== null);
r = await mgr('erpClinicRxSave', [{ id: X, data }]);
check('a finished prescription cannot change', r && r.error && /সংশোধন/.test(r.error), r);
r = await mgr('erpClinicRxPdf', [{ id: X }]);
check('the PDF has a link', r && /files\.test/.test(r.url), r);
r = await mgr('erpClinicRxSend', [{ id: X }]);
check('sending without the bot\'s number says so', r && r.error && /জোড়া হয়নি/.test(r.error), r);
const W = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings) values (${FIX.B}, 'wa_evo', 'Doctor desk', 'instRx', 'live', true, '{"purpose":"clinic"}'::jsonb) returning *`)[0];
await sql`insert into business_secrets (business_id, key, value) values (${FIX.B}, ${'INBOX_' + W.id + '_URL'}, 'https://evorx.test'), (${FIX.B}, ${'INBOX_' + W.id + '_KEY'}, 'k')`;
const sent = [];
web.on(/evorx\.test/, (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { status: 201, body: { key: { id: 'D1' } } }; });
r = await mgr('erpClinicRxSend', [{ id: X }]);
check('the PDF goes to the patient as a document', r && r.ok && sent.some((s) => /sendMedia/.test(s.url) && s.body.mediatype === 'document' && s.body.number === '8801712000001' && s.body.media.length > 10), [r, sent.map((s) => s.url)]);
r = await mgr('erpClinicRxAmend', [{ id: X }]);
check('a correction needs a reason', r && r.error, r);
r = await mgr('erpClinicRxAmend', [{ id: X, reason: 'dose changed' }]);
const v1 = (await sql`select state, struck_reason from clinic_prescriptions where id = ${X}`)[0], v2 = (await sql`select * from clinic_prescriptions where id = ${r.id}`)[0];
check('the old one is struck (kept), the new version is a draft with the same number', v1.state === 'struck' && v1.struck_reason === 'dose changed' && v2.state === 'draft' && v2.version === 2 && v2.no === row.no, [v1, v2 && v2.no]);
r = await mgr('erpClinicRxList', [{}]);
check('the list shows both versions', r && r.list.filter((x) => x.no === row.no).length === 2, r);
r = await mgr('erpClinicRx', [{ consultId: C }]);
check('opening the booking again gives the new draft', r && r.rx && r.rx.version === 2 && r.rx.state === 'draft' && r.history.length === 2, r && r.rx);
check('nothing for the other business', (await sql`select count(*)::int n from clinic_prescriptions where business_id = ${FIX.B2}`)[0].n === 0);
done();
