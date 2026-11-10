// crmai-1 (owner 11 Nov 2026): the AI reads the quiet chats and keeps the customer tools itself - leads, follow-ups,
// the four fields, companies, duplicates. Made-up people only; the model is faked.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, check, done, deps, web, fnDir } from './harness.mjs';

const ai = await import(pathToFileURL(path.join(fnDir, 'handlers', 'crmai.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';
await sql`insert into erp_app_flags (key, enabled) values ('crm', true) on conflict (key) do update set enabled = true`;

// the fake model: answers by what the chat says
let calls = 0;
const ANSWERS = {
  'Karim chat': { kind: 'buyer', name: 'Karim', phone: '', want: 'PLA red 2kg', stage: 3, followup: { days: 3, note: 'Ask Karim if he is ready for the red PLA after salary' },
    company: null, fields: { printer: 'Bambu Lab A1', ctype: 'Hobby', area: 'Mirpur', wants: 'PLA' }, summary: 'wants red PLA after salary' },
  'School chat': { kind: 'business', name: 'Nadia', phone: '01711000222', want: '10 kg PLA for the lab', stage: 4, followup: { days: 2, note: 'Send the quote to the school' },
    company: { name: 'Sunrise School', kind: 'school' }, fields: { printer: 'Creality K1', ctype: 'School / university', area: 'Uttara', wants: 'PLA bulk' }, summary: 'school wants bulk' },
  'Spam chat': { kind: 'other', name: '', phone: '', want: '', stage: 1, followup: null, company: null, fields: {}, summary: 'job seeker' },
};
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  calls++;
  const body = String(opts && opts.body || '');
  let j = { verdict: 'unsure', why: 'no idea' };
  if (/one person or different people/.test(body)) j = { verdict: 'different', why: 'different areas' };
  else for (const k of Object.keys(ANSWERS)) if (body.includes(k)) j = ANSWERS[k];
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(j) }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } } };
});

const ch = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on) values (${FIX.B}, 'messenger', 'Page', 'PAGE7', 'live', true) returning *`)[0];
async function chat(ext, name, phone, key, lines, quietMin) {
  const ct = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name, phone, customer_key) values (${FIX.B}, ${ch.id}, ${ext}, ${name}, ${phone}, ${key}) returning *`)[0];
  const at = new Date(Date.now() - (quietMin || 60) * 60e3);
  const cv = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id, last_at) values (${FIX.B}, ${ch.id}, ${ct.id}, ${at}) returning *`)[0];
  for (const [who, text] of lines) await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text, created_at)
      values (${FIX.B}, ${cv.id}, ${who === 'customer' ? 'in' : 'out'}, ${who}, 'text', ${text}, ${at})`;
  return cv;
}
const karim = await chat('P1', 'Karim', null, null, [['customer', 'Karim chat: lal PLA ache? salary pele nibo'], ['ai', 'Ji bhai ache, ৳1,450']]);
// Nadia is already a customer (phone on the list), with a Printer model a person typed
await sql`insert into customers (business_id, name, phone, extra) values (${FIX.B}, 'Nadia Rahman', '01711000222', ${sql.json({ f_printer: 'Typed by a person' })})`;
const school = await chat('P2', 'Nadia', '01711000222', '1711000222', [['customer', 'School chat: amader school lab er jonno 10 kg PLA lagbe'], ['ai', 'Quote pathacchi']]);
const spam = await chat('P3', 'X', null, null, [['customer', 'Spam chat: job ache?']]);
const fresh = await chat('P4', 'Busy', null, null, [['customer', 'Karim chat: still typing']], 5);   // not quiet yet

// two customers with the same name, different phones (the duplicate check)
await sql`insert into customers (business_id, name, phone) values (${FIX.B}, 'Rahim Uddin', '01811000001'), (${FIX.B}, 'Rahim Uddin', '01911000002')`;

let r = await asB((ctx) => ai.crmAiTick(ctx));
check('crmai: reads the 3 quiet chats, not the one still going', r.chats === 3 && r.failed === 0, r);
check('crmai: the duplicate pair is checked once today', r.dupes === 1, r);

const f = await sql`select target, key, by from crm_fields where business_id = ${FIX.B} and key like 'f_%' order by target, key`;
check('crmai: the 4 AI fields are made on customers and on leads', f.length === 8 && f.every((x) => x.by === 'AI'), f);

const lk = (await sql`select * from inbox_leads where conversation_id = ${karim.id}`)[0];
check('crmai: Karim (not a customer) becomes a lead with what he wants and the stage', lk && lk.want === 'PLA red 2kg' && lk.stage === 3, lk);
check('crmai: Karim\'s follow-up date is on the lead (3 days)', lk && lk.follow_up_on && Math.round((new Date(lk.follow_up_on) - new Date(new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10))) / 864e5) === 3, lk && lk.follow_up_on);
check('crmai: Karim\'s lead has the printer, type and area', lk && lk.extra.f_printer === 'Bambu Lab A1' && lk.extra.f_ctype === 'Hobby' && lk.extra.f_area === 'Mirpur', lk && lk.extra);

const nad = (await sql`select * from customers where phone = '01711000222'`)[0];
check('crmai: a value a person typed is not overwritten', nad.extra.f_printer === 'Typed by a person', nad.extra);
check('crmai: the empty fields of the customer are filled', nad.extra.f_ctype === 'School / university' && nad.extra.f_area === 'Uttara', nad.extra);
const comp = (await sql`select * from crm_companies where business_id = ${FIX.B}`)[0];
check('crmai: the school is made as a company and the customer linked to it', comp && comp.name === 'Sunrise School' && nad.company_id === comp.id, { comp, nad });
const fu = await sql`select * from customer_followups where business_id = ${FIX.B} and customer_key = '1711000222'`;
check('crmai: the customer gets one follow-up (not a lead) by AI', fu.length === 1 && fu[0].by === 'AI' && /quote/i.test(fu[0].note), fu);
check('crmai: no lead for a customer already on the list', !(await sql`select 1 from inbox_leads where conversation_id = ${school.id}`).length);
check('crmai: the spam chat makes nothing', !(await sql`select 1 from inbox_leads where conversation_id = ${spam.id}`).length);
check('crmai: the duplicate pair the AI calls different leaves the list', (await sql`select count(*)::int n from crm_dupe_ok where business_id = ${FIX.B}`)[0].n === 1);

// the next tick waits 10 minutes; a forced run has nothing new to read
const before = calls;
r = await asB((ctx) => ai.crmAiTick(ctx));
check('crmai: the timer waits 10 minutes between runs', r.wait === true, r);
r = await asB((ctx) => ai.crmAiTick(ctx, true));
check('crmai: a chat already read is not read again', r.chats === 0 && calls === before, { r, calls, before });

// a new message, then quiet: read again, still one follow-up
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text, created_at) values (${FIX.B}, ${school.id}, 'in', 'customer', 'text', 'School chat: ar 5 kg PETG o', now() - interval '30 minutes')`;
await sql`update inbox_conversations set last_at = now() - interval '30 minutes' where id = ${school.id}`;
r = await asB((ctx) => ai.crmAiTick(ctx, true));
check('crmai: a new message makes the chat read again', r.chats === 1, r);
check('crmai: an open follow-up is not doubled', (await sql`select count(*)::int n from customer_followups where customer_key = '1711000222'`)[0].n === 1);

// a field the owner removes is never made again
await sql`update crm_fields set removed_at = now() where business_id = ${FIX.B} and key = 'f_area'`;
await asB((ctx) => ai.ensureFields(ctx));
check('crmai: a removed field stays removed', (await sql`select count(*)::int n from crm_fields where key = 'f_area' and removed_at is null`)[0].n === 0);

// the screen and the switch
const res1 = (x) => (x && x.result !== undefined ? x.result : x);
let g = res1(await owner('erpCrmAi', [{ action: 'get' }]));
check('crmai: the screen shows the log and totals', g.on === true && g.log.length >= 4 && g.totals.chats >= 3 && g.totals.followups >= 2, g);
g = res1(await owner('erpCrmAi', [{ action: 'off' }]));
check('crmai: the owner switches it off', g.on === false);
r = await asB((ctx) => ai.crmAiTick(ctx));
check('crmai: off = the timer does nothing', r.off === true, r);
await owner('erpCrmAi', [{ action: 'on' }]);
check('crmai: mergeExtra refuses a choice that is not one of the choices', ai.mergeExtra({}, { ctype: 'Alien' }, { f_ctype: { type: 'choice', choices: ['Hobby'] } }).put.length === 0);
done();
