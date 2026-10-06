// Stage N3 (docs/NETWORK-BLUEPRINT.md sections 4 and 4.5): the Print Doctor's community parts.
//
// The problems, causes and fixes are content in the page (web/doctor-data.js, two languages, a picture each).
// This file keeps what the community adds, on the provider's side, with no sign-in:
//   - "did this help?" votes per problem (one per address per problem per day)
//   - a member's case: a failed print with its story and a photo; a guide answers on the case link; the answer can be
//     published under the problem as a tip with the member's first name
//   - settings that worked (printer + filament + numbers); a guide approves; other members press "works for me too"
// The platform admin is the first guide (Platform screen > Print Doctor card).
//
// Public (index.ts ?pub=..., rate limited per address):
//   GET  ?pub=doctor                       tips, vote counts, approved settings
//   POST ?pub=doctorvote   {problem, helped}
//   POST ?pub=doctorcase   {problem, printer, material, story, tried, name, contact, consent: true, photo: {mime, data}}
//   GET  ?pub=doctorcase&t=                the sender's view: status and the guide's answer
//   POST ?pub=doctorsettings {printer, material, brand, nozzle, bed, speed, cooling, retraction, notes, name}
//   POST ?pub=doctorconfirm  {id}          "works for me too"
// Platform admin: erpPlatformDoctor, erpPlatformDoctorCase({id, reply, publish, tip, credit, remove}),
//                 erpPlatformDoctorSettings({id, action: approve|remove}), erpPlatformDoctorTipRemove({id})

import { formatDate, num } from '../lib/time.js';
import { pubBase, limit, tokenFor } from './passport.js';
import { platformAdmin } from './platform.js';

const str = (v) => String(v == null ? '' : v).trim();
const month = (d) => (d ? formatDate(new Date(d), 'MMM yyyy') : '');
const when = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const enc = new TextEncoder();
const NIL = '00000000-0000-0000-0000-000000000000';
const PROBLEM = /^[a-z][a-z0-9-]{1,40}$/;
const MATERIALS = ['PLA', 'PLA+', 'PETG', 'ABS', 'ASA', 'TPU', 'Nylon', 'PC', 'PLA-CF', 'PETG-CF', 'Other'];
export const CONSENT = 'I agree that my story, my photo and my first name may be shown on the Print Doctor to help others. My phone or e-mail is used only to answer me and is never shown.';

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const caseToken = (deps, id) => tokenFor(deps, 'public', NIL, 'case|' + id);
function base(deps) { return pubBase(deps).check.replace(/check$/, ''); }
const MAGIC = [['image/jpeg', [0xff, 0xd8, 0xff], 'jpg'], ['image/png', [0x89, 0x50, 0x4e, 0x47], 'png'], ['image/webp', [0x52, 0x49, 0x46, 0x46], 'webp']];
function decodePhoto(p) {
  if (!p || !p.data) return null;
  let bytes;
  try { const bin = atob(String(p.data).replace(/^data:[^,]*,/, '')); bytes = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k); } catch (_) { throw new Error('The photo could not be read. Take it again.'); }
  if (bytes.length < 200) throw new Error('The photo is empty. Take it again.');
  if (bytes.length > 1.5 * 1024 * 1024) throw new Error('The photo is over 1.5 MB. The page should have shrunk it - try again.');
  const m = MAGIC.find((x) => x[1].every((b, k) => bytes[k] === b));
  if (!m) throw new Error('The photo is not a JPEG, PNG or WebP image.');
  return { mime: m[0], ext: m[2], bytes };
}
async function photoUrl(deps, row) {
  const f = Array.isArray(row.photo) ? row.photo[0] : null;
  if (!f) return '';
  try { return await deps.storage.url('public', 'doctor/' + row.id, f.name); } catch (_) { return ''; }
}

// ---------------------------------------------------------------- public reads
export async function doctorData(deps, ip) {
  const ctl = deps.control; if (!ctl) throw new Error('The Print Doctor is not available on this server.');
  await limit(deps, ip, 'doctor', 120);
  const tips = (await ctl`select id, problem, text, credit, created_at from erp_doctor_tips order by created_at desc limit 300`)
    .map((t) => ({ id: t.id, problem: str(t.problem), text: str(t.text), credit: str(t.credit), month: month(t.created_at) }));
  const votes = {};
  for (const v of await ctl`select problem, count(*) filter (where helped)::int as yes, count(*) filter (where not helped)::int as no from erp_doctor_votes group by problem`) votes[str(v.problem)] = { yes: num(v.yes), no: num(v.no) };
  const settings = (await ctl`select * from erp_doctor_settings where status = 'approved' order by confirms desc, created_at desc limit 300`).map(settingRow);
  return { tips, votes, settings, materials: MATERIALS };
}
function settingRow(s) {
  return { id: s.id, printer: str(s.printer), material: str(s.material), brand: str(s.brand), nozzle: s.nozzle_c == null ? null : num(s.nozzle_c), bed: s.bed_c == null ? null : num(s.bed_c),
    speed: str(s.speed), cooling: str(s.cooling), retraction: str(s.retraction), notes: str(s.notes), name: str(s.name), confirms: num(s.confirms), month: month(s.created_at), status: str(s.status) };
}

// ---------------------------------------------------------------- votes
export async function vote(deps, body, ip) {
  const ctl = deps.control;
  await limit(deps, ip, 'doctorvote', 60);
  const p = str(body && body.problem);
  if (!PROBLEM.test(p)) throw new Error('Which problem?');
  const helped = body && body.helped === true;
  const h = await sha256hex('vote|' + str(ip));
  // one answer per address per problem per day: the latest wins
  await ctl`delete from erp_doctor_votes where problem = ${p} and ip_hash = ${h} and at > now() - interval '1 day'`;
  await ctl`insert into erp_doctor_votes (problem, helped, ip_hash) values (${p}, ${helped}, ${h})`;
  const r = (await ctl`select count(*) filter (where helped)::int as yes, count(*) filter (where not helped)::int as no from erp_doctor_votes where problem = ${p}`)[0];
  return { problem: p, yes: num(r.yes), no: num(r.no) };
}

// ---------------------------------------------------------------- a member's case
export async function sendCase(deps, body, ip) {
  const ctl = deps.control; if (!ctl) throw new Error('The Print Doctor is not available on this server.');
  await limit(deps, ip, 'doctorcase', 5);
  const b = body || {};
  const problem = PROBLEM.test(str(b.problem)) ? str(b.problem) : 'other';
  const story = str(b.story).slice(0, 2000);
  if (story.length < 15) throw new Error('Tell what happened in a sentence or two: what you printed, what you saw.');
  const printer = str(b.printer).slice(0, 60), material = str(b.material).slice(0, 30), tried = str(b.tried).slice(0, 1000);
  const name = str(b.name).slice(0, 40), contact = str(b.contact).slice(0, 80);
  if (name.length < 2) throw new Error('Your first name, for the credit when your case helps others.');
  if (b.consent !== true) throw new Error('Tick the consent line: your story, photo and first name may be shown to help others.');
  const photo = decodePhoto(b.photo);
  const consent = ctl.json({ at: new Date().toISOString(), text: CONSENT, ip: str(ip) });
  const id = (await ctl`insert into erp_doctor_cases (problem, printer, material, story, tried, name, contact, consent, photo)
                          values (${problem}, ${printer || null}, ${material || null}, ${story}, ${tried || null}, ${name}, ${contact || null}, ${consent}, ${ctl.json([])}) returning id`)[0].id;
  const token = await caseToken(deps, id);
  await ctl`update erp_doctor_cases set token_hash = ${await sha256hex(token)} where id = ${id}`;
  if (photo && deps.storage) {
    const fname = 'photo.' + photo.ext;
    await deps.storage.save('public', 'doctor/' + id, fname, photo.bytes, photo.mime);
    await ctl`update erp_doctor_cases set photo = ${ctl.json([{ name: fname, mime: photo.mime }])} where id = ${id}`;
  }
  return { id, caseUrl: base(deps) + 'doctor?c=' + token };
}
export async function caseView(deps, token, ip) {
  await limit(deps, ip, 'doctorcaseview', 40);
  const t = str(token);
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) throw new Error('This link is not complete.');
  const r = (await deps.control`select * from erp_doctor_cases where token_hash = ${await sha256hex(t)}`)[0];
  if (!r || r.status === 'removed') throw new Error('This case link is not known.');
  return { problem: str(r.problem), printer: str(r.printer), material: str(r.material), story: str(r.story), tried: str(r.tried), name: str(r.name), status: str(r.status),
    reply: str(r.reply), sent: when(r.created_at), answered: when(r.answered_at), photo: await photoUrl(deps, r) };
}

// ---------------------------------------------------------------- settings that worked
export async function sendSettings(deps, body, ip) {
  const ctl = deps.control;
  await limit(deps, ip, 'doctorsettings', 5);
  const b = body || {};
  const printer = str(b.printer).slice(0, 60), material = str(b.material).slice(0, 30);
  if (printer.length < 2) throw new Error('Which printer?');
  if (!MATERIALS.includes(material)) throw new Error('Pick the material.');
  const nozzle = b.nozzle === '' || b.nozzle == null ? null : Math.round(num(b.nozzle)), bed = b.bed === '' || b.bed == null ? null : Math.round(num(b.bed));
  if (nozzle != null && (nozzle < 150 || nozzle > 350)) throw new Error('The nozzle temperature should be between 150 and 350 °C.');
  if (bed != null && (bed < 0 || bed > 130)) throw new Error('The bed temperature should be between 0 and 130 °C.');
  const name = str(b.name).slice(0, 40);
  if (name.length < 2) throw new Error('Your first name, for the credit.');
  const id = (await ctl`insert into erp_doctor_settings (printer, material, brand, nozzle_c, bed_c, speed, cooling, retraction, notes, name)
                          values (${printer}, ${material}, ${str(b.brand).slice(0, 40) || null}, ${nozzle}, ${bed}, ${str(b.speed).slice(0, 40) || null}, ${str(b.cooling).slice(0, 40) || null},
                                  ${str(b.retraction).slice(0, 40) || null}, ${str(b.notes).slice(0, 500) || null}, ${name}) returning id`)[0].id;
  return { id, pending: true };
}
export async function confirmSettings(deps, body, ip) {
  const ctl = deps.control;
  await limit(deps, ip, 'doctorconfirm', 30);
  const id = str(body && body.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Which settings?');
  const h = await sha256hex('conf|' + str(ip) + '|' + id);
  const dup = await ctl`select 1 from erp_doctor_votes where problem = ${'settings:' + id} and ip_hash = ${h}`;
  if (dup.length) return { id, already: true };
  const r = await ctl`update erp_doctor_settings set confirms = confirms + 1 where id = ${id}::uuid and status = 'approved' returning confirms`;
  if (!r.length) throw new Error('Those settings are not on the list.');
  await ctl`insert into erp_doctor_votes (problem, helped, ip_hash) values (${'settings:' + id}, true, ${h})`;
  return { id, confirms: num(r[0].confirms) };
}

/** passport.js pubRoute hands the doctor routes here. */
export async function route(deps, what, method, params, body, ip) {
  if (what === 'doctor' && method === 'GET') return doctorData(deps, ip);
  if (what === 'doctorvote' && method === 'POST') return vote(deps, body, ip);
  if (what === 'doctorcase') return method === 'POST' ? sendCase(deps, body, ip) : caseView(deps, params.get('t'), ip);
  if (what === 'doctorsettings' && method === 'POST') return sendSettings(deps, body, ip);
  if (what === 'doctorconfirm' && method === 'POST') return confirmSettings(deps, body, ip);
  return null;
}

// ---------------------------------------------------------------- platform admin: the first guide
async function needAdmin(ctx) {
  if (!(await platformAdmin(ctx))) throw new Error('Only the platform admin answers Print Doctor cases.');
}
export async function erpPlatformDoctor(ctx) {
  await needAdmin(ctx);
  const ctl = ctx.deps.control; if (!ctl) throw new Error('This server has no Print Doctor.');
  const cases = [];
  for (const r of await ctl`select * from erp_doctor_cases where status <> 'removed' order by (status = 'new') desc, created_at desc limit 200`) {
    cases.push({ id: r.id, problem: str(r.problem), printer: str(r.printer), material: str(r.material), story: str(r.story), tried: str(r.tried), name: str(r.name), contact: str(r.contact),
      status: str(r.status), reply: str(r.reply), sent: when(r.created_at), answered: when(r.answered_at), photo: await photoUrl(ctx.deps, r) });
  }
  const settings = (await ctl`select * from erp_doctor_settings where status <> 'removed' order by (status = 'pending') desc, created_at desc limit 200`).map(settingRow);
  const tips = (await ctl`select id, problem, text, credit, created_at from erp_doctor_tips order by created_at desc limit 200`).map((t) => ({ id: t.id, problem: str(t.problem), text: str(t.text), credit: str(t.credit), month: month(t.created_at) }));
  const votes = (await ctl`select problem, count(*) filter (where helped)::int as yes, count(*) filter (where not helped)::int as no from erp_doctor_votes where problem not like 'settings:%' group by problem order by 2 desc limit 100`).map((v) => ({ problem: str(v.problem), yes: num(v.yes), no: num(v.no) }));
  return { cases, settings, tips, votes, newCases: cases.filter((c) => c.status === 'new').length, pendingSettings: settings.filter((s) => s.status === 'pending').length, doctorUrl: base(ctx.deps) + 'doctor' };
}
export async function erpPlatformDoctorCase(ctx, payload) {
  await needAdmin(ctx);
  const ctl = ctx.deps.control, p = payload || {};
  const r = (await ctl`select * from erp_doctor_cases where id = ${str(p.id)}::uuid`)[0];
  if (!r) throw new Error('No such case.');
  if (p.remove) {
    const f = Array.isArray(r.photo) ? r.photo[0] : null;
    if (f) { try { await ctx.deps.storage.remove('public', 'doctor/' + r.id, f.name); } catch (_) { /* best effort */ } }
    await ctl`update erp_doctor_cases set status = 'removed', photo = ${ctl.json([])}, contact = null where id = ${r.id}`;
    return { removed: true };
  }
  const reply = str(p.reply).slice(0, 3000);
  if (reply.length < 5) throw new Error('Write the answer first.');
  let tipId = null;
  if (p.publish) {
    const problem = PROBLEM.test(str(p.problem)) ? str(p.problem) : str(r.problem);
    const text = str(p.tip).slice(0, 1200) || reply.slice(0, 1200);
    const credit = str(p.credit).slice(0, 60) || str(r.name);
    tipId = (await ctl`insert into erp_doctor_tips (problem, text, credit, case_id) values (${problem}, ${text}, ${credit}, ${r.id}) returning id`)[0].id;
  }
  await ctl`update erp_doctor_cases set reply = ${reply}, status = ${p.publish ? 'published' : 'answered'}, answered_at = now() where id = ${r.id}`;
  return { answered: true, tipId };
}
export async function erpPlatformDoctorSettings(ctx, payload) {
  await needAdmin(ctx);
  const id = str(payload && payload.id), action = str(payload && payload.action);
  if (!['approve', 'remove'].includes(action)) throw new Error('Approve or remove.');
  const r = await ctx.deps.control`update erp_doctor_settings set status = ${action === 'approve' ? 'approved' : 'removed'} where id = ${id}::uuid returning id`;
  if (!r.length) throw new Error('No such settings.');
  return { status: action === 'approve' ? 'approved' : 'removed' };
}
export async function erpPlatformDoctorTipRemove(ctx, payload) {
  await needAdmin(ctx);
  const r = await ctx.deps.control`delete from erp_doctor_tips where id = ${str(payload && payload.id)}::uuid returning id`;
  if (!r.length) throw new Error('No such tip.');
  return { removed: true };
}
export const HANDLERS = { erpPlatformDoctor, erpPlatformDoctorCase, erpPlatformDoctorSettings, erpPlatformDoctorTipRemove };
