// crmai-1 (owner 11 Nov 2026): "we have the AI now; it reads every chat - WhatsApp and both Facebook pages - so the AI
// itself should fill in and keep the customer tools, not the team."
//
// From the every-minute inbox timer (inboxTick), at most every 10 minutes, the AI reads up to 6 chats that have gone
// quiet (no message for 20 minutes) and have something it has not read yet (inbox_conversations.crm_ai_msg). For each
// it writes what the chat says - nothing it has to guess:
//   - the lead (stage, what they want) and, when there is a reason, the follow-up date with what to say
//     (a customer already on the customer list gets a follow-up on the customer instead, so the calendar has one entry)
//   - the customer's / lead's fields the AI keeps: Printer model, Customer type, Area, Interested in
//     (made once; a field the owner removes is never made again; a value a person typed is never overwritten)
//   - a business buyer's company (shop, school, print farm) and the customer linked to it
// Once a day it looks at the possible duplicates: two different people -> "Not the same" (the pair leaves the list);
// the same person -> written in its log for a person to merge (merging moves invoices, so a person does it).
// Everything it does is written in business_config 'crm_ai' (the newest 60 lines), shown on Customer tools.
//
//   erpCrmAi {action: 'get'}            the switch, the last run and what the AI did lately
//   erpCrmAi {action: 'on'|'off'}       owner
//   erpCrmAi {action: 'run'}            run now (manager+), same as the timer

import { str } from '../lib/tabs.js';
import { formatDate } from '../lib/time.js';
import { custKey, formatBdPhone } from '../lib/phone.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { appIsOff } from './apps.js';
import { gemini, jsonOf } from '../lib/gemini.js';

const KEY = 'crm_ai';
const EVERY_MIN = 10, PER_RUN = 6, QUIET_MIN = 20, BACK_DAYS = 30, LOG_MAX = 60;
const STAGES = ['', 'New', 'Contacted', 'Interested', 'Quoted', 'Won', 'Lost'];
export const AI_FIELDS = [
  { key: 'f_printer', label: 'Printer model', type: 'text', choices: [] },
  { key: 'f_ctype', label: 'Customer type', type: 'choice', choices: ['Hobby', 'Business', 'School / university', 'Print farm', 'Reseller', 'Gift'] },
  { key: 'f_area', label: 'Area', type: 'text', choices: [] },
  { key: 'f_wants', label: 'Interested in', type: 'text', choices: [] },
];
const FIELD_OF = { printer: 'f_printer', ctype: 'f_ctype', area: 'f_area', wants: 'f_wants' };
const last10 = (p) => { const d = str(p).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const ymd = (d) => formatDate(new Date(d), 'yyyy-MM-dd');

async function cfg(ctx) {
  let v = null;
  try { v = JSON.parse(str(await getConfig(ctx, KEY, '')) || 'null'); } catch (_) { v = null; }
  v = v && typeof v === 'object' ? v : {};
  if (v.on === undefined) v.on = true;           // the owner asked for it: on unless he switches it off
  v.log = Array.isArray(v.log) ? v.log : [];
  v.totals = v.totals && typeof v.totals === 'object' ? v.totals : {};
  v.dupSeen = Array.isArray(v.dupSeen) ? v.dupSeen : [];
  return v;
}
async function save(ctx, C) {
  C.log = C.log.slice(0, LOG_MAX);
  C.dupSeen = C.dupSeen.slice(-500);
  await setConfig(ctx, KEY, JSON.stringify(C));
}
function note(C, ctx, what, kind) {
  C.log.unshift({ at: ctx.now.toISOString(), what: str(what).slice(0, 240), kind: kind || 'info' });
  if (kind) C.totals[kind] = (C.totals[kind] || 0) + 1;
}

/** The four fields the AI keeps, on customers and on leads - made once (a removed one stays removed). */
export async function ensureFields(ctx) {
  for (const target of ['customer', 'lead']) {
    let i = 0;
    for (const f of AI_FIELDS) {
      await ctx.tx`insert into crm_fields (business_id, target, key, label, type, choices, sort, by)
                   values (${ctx.biz}, ${target}, ${f.key}, ${f.label}, ${f.type}, ${f.choices}, ${100 + i++}, 'AI')
                   on conflict (business_id, target, key) do nothing`;
    }
  }
  const rows = await ctx.tx`select target, key, type, choices from crm_fields where business_id = ${ctx.biz} and removed_at is null and key = any(${AI_FIELDS.map((f) => f.key)})`;
  const live = { customer: {}, lead: {} };
  for (const r of rows) live[r.target][r.key] = r;
  return live;
}
/** Only empty boxes are filled; a choice must be one of the choices. */
export function mergeExtra(extra, vals, live) {
  const ex = { ...(extra || {}) }; const put = [];
  for (const k of Object.keys(vals || {})) {
    const fk = FIELD_OF[k], f = fk && live[fk]; let v = str(vals[k]).slice(0, 120);
    if (!f || !v || /^(unknown|none|n\/a|null|-)$/i.test(v)) continue;
    if (f.type === 'choice') { const c = (f.choices || []).find((x) => x.toLowerCase() === v.toLowerCase()); if (!c) continue; v = c; }
    if (ex[fk] !== undefined && ex[fk] !== null && str(ex[fk]) !== '') continue;
    ex[fk] = v; put.push(fk);
  }
  return { ex, put };
}

const SYSTEM = (today, comps) =>
  'You keep the customer records of a Bangladeshi shop that sells 3D printers, filament (PLA, PETG, TPU, silk ...), parts and accessories. ' +
  'You read one chat (Messenger or WhatsApp; Bangla, Banglish or English) between a customer and the shop (our AI salesperson and our team) and write down ONLY what the chat clearly says. ' +
  'Never guess. Today is ' + today + '. Reply with JSON only:\n' +
  '{"kind": "buyer" (wants to buy for themselves) | "business" (buys for a shop, school, company, print farm or to resell) | "browsing" (asked prices / stock, no clear plan) | "support" (help with a product they have) | "other" (spam, job, wrong number, only hello),\n' +
  ' "name": their name if they said it, else "",\n "phone": a Bangladeshi mobile they wrote, else "",\n' +
  ' "want": what they want in a few words (product, colour, quantity), else "",\n' +
  ' "stage": 1 new, 2 we answered, 3 interested (asked price/stock for something real), 4 quoted (we gave a price or an order summary), 5 bought (an order was placed in this chat), 6 lost (said no / bought elsewhere / too expensive and left),\n' +
  ' "followup": {"days": 1-30, "note": "what our person should say or check, one short English sentence"} ONLY when there is a reason - they said they will order later, after salary, next week, asked us to tell them when stock comes, ' +
  'got a price and went quiet while clearly interested, or a printer buyer may need filament soon; else null,\n' +
  ' "company": {"name": "", "kind": "shop | school | university | company | print farm | reseller"} only when they named the business they buy for, else null,\n' +
  ' "fields": {"printer": the 3D printer model they own or use (e.g. "Bambu Lab A1"), "ctype": one of Hobby, Business, School / university, Print farm, Reseller, Gift, "area": city or area in Bangladesh they gave, "wants": the product kinds they are interested in} - "" for anything not said,\n' +
  ' "summary": one short English line for the log}\n' +
  (comps.length ? 'Companies already on file (use the same spelling if it is one of them): ' + comps.join(', ') + '\n' : '');

function lineOf(m) {
  const who = m.author === 'customer' ? 'customer' : m.author === 'ai' ? 'shop (AI)' : m.author === 'team' ? 'shop (team)' : 'system';
  const t = str(m.text) || str(m.transcript) || (m.seen_as ? '[photo: ' + str(m.seen_as) + ']' : m.kind !== 'text' ? '[' + m.kind + ']' : '');
  return '[' + formatDate(new Date(m.created_at), 'd MMM HH:mm') + '] ' + who + ': ' + t.replace(/\s+/g, ' ').slice(0, 400);
}

async function custOf(ctx, key) {
  const k = last10(key);
  if (!k) return null;
  return (await ctx.tx`select id, seq, name, phone, extra, company_id from customers where business_id = ${ctx.biz}
                       and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${k} order by seq limit 1`)[0] || null;
}

async function companyId(ctx, comp) {
  const name = str(comp && comp.name).slice(0, 120);
  if (name.length < 3) return null;
  const had = (await ctx.tx`select id from crm_companies where business_id = ${ctx.biz} and lower(btrim(name)) = ${name.toLowerCase()}`)[0];
  if (had) return { id: had.id, made: false, name };
  const r = (await ctx.tx`insert into crm_companies (business_id, name, kind, by) values (${ctx.biz}, ${name}, ${str(comp.kind).slice(0, 40) || null}, 'AI')
                          on conflict do nothing returning id`)[0];
  return r ? { id: r.id, made: true, name } : null;
}

/** One chat: read it, write what it says. Returns the log lines. */
export async function readChat(ctx, c, live, comps, C) {
  const msgs = (await ctx.tx`select id, direction, author, kind, text, transcript, seen_as, created_at from inbox_messages
                             where conversation_id = ${c.id} and direction in ('in', 'out') order by id desc limit 60`).reverse();
  const top = msgs.length ? Number(msgs[msgs.length - 1].id) : Number(c.lastid || 0);
  const mark = async () => { await ctx.tx`update inbox_conversations set crm_ai_msg = ${Math.max(top, Number(c.lastid || 0))} where id = ${c.id}`; };
  if (!msgs.some((m) => m.author === 'customer' && (str(m.text) || str(m.transcript)))) { await mark(); return; }
  const cust = await custOf(ctx, c.ckey || c.cphone);
  const lead = (await ctx.tx`select * from inbox_leads where business_id = ${ctx.biz} and conversation_id = ${c.id} order by created_at desc limit 1`)[0] || null;
  const known = 'Channel: ' + str(c.chname || c.chkind) + '. Contact name: ' + (str(c.cname) || 'unknown') + '.' +
    (cust ? ' Already a customer of ours (on the customer list).' : '') + (c.ordered ? ' An order was placed in this chat.' : '') +
    (lead ? ' Lead on file: stage ' + STAGES[lead.stage] + (lead.want ? ', wants ' + str(lead.want) : '') + (lead.follow_up_on ? ', follow-up ' + ymd(lead.follow_up_on) : '') + '.' : '');
  const { parts } = await gemini(ctx, {
    systemInstruction: { parts: [{ text: SYSTEM(formatDate(ctx.now, 'yyyy-MM-dd (EEEE)'), comps) }] },
    contents: [{ role: 'user', parts: [{ text: known + '\n\nTHE CHAT (oldest first):\n' + msgs.map(lineOf).join('\n') }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  }, 'crm', c.id);
  const j = jsonOf(parts);
  if (!j || typeof j !== 'object') throw new Error('The AI gave no answer for a chat.');
  const who = str(j.name) || str(c.cname) || (cust && str(cust.name)) || 'A customer';
  const did = [];
  const kind = str(j.kind);
  const stage = Math.min(6, Math.max(1, Math.round(Number(j.stage) || 1)));
  const fu = j.followup && Number(j.followup.days) >= 1 && str(j.followup.note)
    ? { due: ymd(new Date(ctx.now.getTime() + Math.min(30, Math.round(Number(j.followup.days))) * 864e5)), note: str(j.followup.note).slice(0, 300) } : null;
  const phone = last10(j.phone) ? '0' + last10(j.phone) : '';

  // the company of a business buyer
  let comp = null;
  if (kind === 'business' && j.company) {
    comp = await companyId(ctx, j.company);
    if (comp && comp.made) { did.push('company ' + comp.name); comps.push(comp.name); note(C, ctx, 'New company: ' + comp.name + ' (from ' + who + '’s chat)', 'companies'); }
  }

  if (cust) {
    // a customer on the list: their fields, their company, a follow-up on them
    const { ex, put } = mergeExtra(cust.extra, j.fields, live.customer);
    if (put.length) { await ctx.tx`update customers set extra = ${ctx.tx.json(ex)}, updated_at = now() where id = ${cust.id}`; did.push(put.length + ' field(s)'); note(C, ctx, cust.name + ': ' + put.map((k) => AI_FIELDS.find((f) => f.key === k).label + ' = ' + ex[k]).join(', '), 'fields'); }
    if (comp && !cust.company_id) { await ctx.tx`update customers set company_id = ${comp.id}, updated_at = now() where id = ${cust.id}`; did.push('linked to ' + comp.name); }
    if (fu) {
      const key = custKey(cust.phone, cust.name);
      const open = (await ctx.tx`select 1 from customer_followups where business_id = ${ctx.biz} and customer_key = ${key} and status = 'open' limit 1`).length;
      if (!open) {
        await ctx.tx`insert into customer_followups (business_id, customer_key, customer, phone, due_on, note, by)
                     values (${ctx.biz}, ${key}, ${str(cust.name)}, ${str(cust.phone) || null}, ${fu.due}, ${fu.note}, 'AI')`;
        did.push('follow-up ' + fu.due); note(C, ctx, 'Follow-up ' + fu.due + ' for ' + cust.name + ': ' + fu.note, 'followups');
      }
    }
  } else if (['buyer', 'business', 'browsing'].includes(kind) && !c.ordered && stage < 5) {
    // someone who is not a customer yet: the lead
    const inbox = await import('./inbox.js');
    const contact = { id: c.contact_id, name: c.cname, phone: c.cphone };
    const id = await inbox.leadUpsert(ctx, { id: c.id, channel_id: c.channel_id }, contact, { name: str(j.name), phone, want: str(j.want).slice(0, 200), stage }, 'ai');
    const l = (await ctx.tx`select * from inbox_leads where id = ${id}`)[0];
    if (!lead) { did.push('lead'); note(C, ctx, 'New lead: ' + who + (j.want ? ' wants ' + str(j.want) : '') + ' (' + STAGES[stage] + ')', 'leads'); }
    else if (stage > lead.stage) { did.push('stage ' + STAGES[stage]); note(C, ctx, who + ' moved to ' + STAGES[stage], 'stages'); }
    const { ex, put } = mergeExtra(l.extra, j.fields, live.lead);
    if (put.length) { await ctx.tx`update inbox_leads set extra = ${ctx.tx.json(ex)}, updated_at = now() where id = ${id}`; did.push(put.length + ' field(s)'); C.totals.fields = (C.totals.fields || 0) + 1; }
    if (comp && !l.company) { try { await ctx.tx`update inbox_leads set company = ${comp.name} where id = ${id}`; } catch (_) { /* no company column */ } }
    const today = ymd(ctx.now);
    if (fu && (!l.follow_up_on || ymd(l.follow_up_on) < today)) {
      await ctx.tx`update inbox_leads set follow_up_on = ${fu.due}, note = ${(str(l.note) ? str(l.note) + '\n' : '') + 'AI ' + today + ': ' + fu.note}, updated_at = now() where id = ${id}`;
      await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${id}, ${'Follow-up ' + fu.due + ': ' + fu.note}, 'AI')`;
      did.push('follow-up ' + fu.due); note(C, ctx, 'Follow-up ' + fu.due + ' for ' + who + ': ' + fu.note, 'followups');
    }
  } else if (lead && stage === 6 && lead.stage < 5) {
    await ctx.tx`update inbox_leads set stage = 6, updated_at = now() where id = ${lead.id}`;
    await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${lead.id}, 'Lost (from the chat)', 'AI')`;
    note(C, ctx, who + ': lost - ' + str(j.summary), 'stages');
  }
  await mark();
  C.totals.chats = (C.totals.chats || 0) + 1;
  return did;
}

/** Once a day: the possible duplicates - different people leave the list, the same person is noted for a person to merge. */
async function checkDupes(ctx, C) {
  const crm = await import('./crm.js');
  const own = { ...ctx, s: { ...ctx.s, role: 'owner', name: 'AI' } };
  const { groups } = await crm.erpCrmDupes(own);
  let asked = 0;
  for (const g of groups) {
    const sig = g.people.map((p) => p.key).sort().join('|');
    if (C.dupSeen.includes(sig)) continue;
    if (asked >= 8) break;
    asked++;
    const people = [];
    for (const p of g.people.slice(0, 6)) {
      const k = last10(p.key);
      const inv = k ? await ctx.tx`select invoice_no, created_at, customer_address, grand_total from invoices where business_id = ${ctx.biz}
                                   and right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${k} order by created_at desc limit 3` : [];
      people.push({ key: p.key, name: p.name, phone: p.phone, email: p.email, since: p.since,
        invoices: inv.map((i) => ymd(i.created_at) + ' ' + Math.round(Number(i.grand_total)) + ' to ' + str(i.customer_address).slice(0, 80)) });
    }
    const { parts } = await gemini(ctx, {
      systemInstruction: { parts: [{ text: 'A Bangladeshi shop\'s customer list has people with ' + g.why.toLowerCase() + ' but a different phone. Decide if they are one person or different people. ' +
        'Common Bangla names (Rahim, Hasan, Akter, Islam ...) are shared by many people: same name alone is NOT the same person. Same person needs more: the same address/area, the same e-mail, or invoices that clearly continue. ' +
        'Reply JSON only: {"verdict": "different" | "same" | "unsure", "why": one short English line}' }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(people) }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }, 'crm', null);
    const j = jsonOf(parts) || {};
    const names = g.people.map((p) => p.name + ' ' + p.phone).join(' / ');
    if (j.verdict === 'different') { await crm.erpCrmDupeOk(own, { keys: g.people.map((p) => p.key) }); note(C, ctx, 'Not the same person: ' + names + ' - ' + str(j.why), 'dupes'); }
    else { C.dupSeen.push(sig); note(C, ctx, (j.verdict === 'same' ? 'Probably the SAME person - merge them: ' : 'Could not tell, check: ') + names + ' - ' + str(j.why), j.verdict === 'same' ? 'merge' : 'unsure'); }
  }
  return asked;
}

/** The timer (inboxTick) and Run now. */
export async function crmAiTick(ctx, force) {
  const C = await cfg(ctx);
  if (!C.on && !force) return { off: true };
  if (await appIsOff(ctx.deps, ctx.sql, 'crm', ctx)) return { closed: true };
  if (!force && C.lastRun && ctx.now.getTime() - new Date(C.lastRun).getTime() < EVERY_MIN * 60e3) return { wait: true };
  C.lastRun = ctx.now.toISOString();
  await save(ctx, C);                              // a failure below does not make it try again every minute
  const live = await ensureFields(ctx);
  const comps = (await ctx.tx`select name from crm_companies where business_id = ${ctx.biz} order by updated_at desc limit 60`).map((r) => str(r.name));
  const chats = await ctx.tx`
    select c.id, c.channel_id, c.contact_id, c.ordered, c.crm_ai_msg, ct.name as cname, ct.phone as cphone, ct.customer_key as ckey, ch.kind as chkind, ch.name as chname,
           (select max(m.id) from inbox_messages m where m.conversation_id = c.id) as lastid
    from inbox_conversations c join inbox_contacts ct on ct.id = c.contact_id join inbox_channels ch on ch.id = c.channel_id
    where c.business_id = ${ctx.biz} and not c.is_test
      and c.last_at > ${new Date(ctx.now.getTime() - BACK_DAYS * 864e5)} and c.last_at < ${new Date(ctx.now.getTime() - QUIET_MIN * 60e3)}
      and coalesce(c.crm_ai_msg, 0) < coalesce((select max(m.id) from inbox_messages m where m.conversation_id = c.id), 0)
    order by c.last_at desc limit ${PER_RUN}`;
  const out = { chats: 0, wrote: 0, failed: 0, dupes: 0 };
  for (const c of chats) {
    try {
      const did = await ctx.tx.savepoint(async (sp) => readChat({ ...ctx, tx: sp }, c, live, comps, C));
      out.chats++; if (did && did.length) out.wrote++;
    } catch (e) {
      out.failed++;
      const msg = String((e && e.message) || e);
      if (/budget/i.test(msg)) { note(C, ctx, 'Stopped: ' + msg); break; }
      // a chat that fails is not read again until it has a new message (the error is in the log)
      try { await ctx.tx`update inbox_conversations set crm_ai_msg = ${Number(c.lastid || 0)} where id = ${c.id}`; } catch (_) { /* fine */ }
      note(C, ctx, 'Could not read a chat (' + str(c.cname || c.chname) + '): ' + msg.slice(0, 120));
    }
  }
  const today = ymd(ctx.now);
  if (C.dupDay !== today) {
    try { out.dupes = await ctx.tx.savepoint(async (sp) => checkDupes({ ...ctx, tx: sp }, C)); C.dupDay = today; }
    catch (e) { note(C, ctx, 'Duplicate check failed: ' + String((e && e.message) || e).slice(0, 120)); C.dupDay = today; }
  }
  C.lastOut = out;
  await save(ctx, C);
  return out;
}

export async function erpCrmAi(ctx, payload) {
  const a = str(payload && payload.action) || 'get';
  if (a === 'on' || a === 'off') {
    if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner switches the AI’s customer work on or off.');
    const C = await cfg(ctx); C.on = a === 'on'; note(C, ctx, 'Switched ' + a + ' by ' + (str(ctx.s.name) || 'the owner')); await save(ctx, C);
  } else if (a === 'run') {
    if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('A manager or the owner runs this.');
    await crmAiTick(ctx, true);
  }
  const C = await cfg(ctx);
  const left = (await ctx.tx`select count(*)::int n from inbox_conversations c where c.business_id = ${ctx.biz} and not c.is_test
      and c.last_at > ${new Date(ctx.now.getTime() - BACK_DAYS * 864e5)}
      and coalesce(c.crm_ai_msg, 0) < coalesce((select max(m.id) from inbox_messages m where m.conversation_id = c.id), 0)`)[0].n;
  return { on: C.on, lastRun: C.lastRun ? formatDate(new Date(C.lastRun), 'd MMM, h:mm a') : '', totals: C.totals, left, every: EVERY_MIN, perRun: PER_RUN,
    log: C.log.slice(0, 40).map((l) => ({ ...l, atText: formatDate(new Date(l.at), 'd MMM, h:mm a') })) };
}

export const HANDLERS = { erpCrmAi };
