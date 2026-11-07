// crm-1 (7 Nov 2026): the customer / lead upgrades from docs/CRM-GAP-VS-TWENTY.md, built into the ERP
// (supabase/160_crm.sql). Owner-only ("Only me" app 'crm') until the provider opens it.
//
//   G1  erpCrmTimeline({key, before})     one customer's whole story, newest first: chats, e-mails, notes, follow-ups,
//                                         invoices, payments, returns, parcels, held orders, leads
//   G2  (page) the Leads board            columns per stage; moving a card calls erpLeadAct (leads.js)
//   G3  erpCrmViews / erpCrmViewSave / erpCrmViewRemove   saved list views (kept on the server, own or for the team)
//       applyConds(rows, conds, match)    field conditions (and / or) for the list engine (listview.js) and the page
//   G4  erpCrmCompanies / erpCrmCompany / erpCrmCompanySave / erpCrmCompanyLink   a company with several people
//   G5  erpCrmFields / erpCrmFieldSave / erpCrmFieldRemove / erpCrmExtraSave      the business's own fields
//   G6  erpCrmDupes / erpCrmDupCheck / erpCrmDupeOk       possible duplicates (same name, same e-mail)
//   G7  crm_events + erpCrmEvents({after}) (pull) + erpCrmHooks / erpCrmHookSave / erpCrmHookRemove / erpCrmHookTest
//       (push, signed) - delivered by crmTick from the every-minute timer
//   G8  erpCrmRules / erpCrmRuleSave / erpCrmRuleRemove   when X happens, do Y
//   G9  erpCrmRemove / erpCrmBin / erpCrmRestore          the bin
//   G10 erpCrmHideSet                     what salespeople do not see (phone, address, e-mail, own fields)
//   G11 erpCrmCalendar({month})           follow-ups and lead follow-ups by day
//   G12 erpCrmCalLink + calFeed           a private calendar link Google Calendar subscribes to; e-mail chats on the timeline
//
// wrapCrm(HANDLERS) (handlers/index.js) hangs the events and the hiding on the existing handlers without changing them.

import { str } from '../lib/tabs.js';
import { num, formatDate } from '../lib/time.js';
import { custKey, formatBdPhone } from '../lib/phone.js';
import { getConfig, setConfig, getSecret, setSecret } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { appIsOff } from './apps.js';

const day = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const ymd = (d) => formatDate(new Date(d), 'yyyy-MM-dd');
const last10 = (p) => { const d = str(p).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const normName = (n) => str(n).toLowerCase().replace(/[^a-z0-9\u0980-\u09ff]+/g, ' ').trim();
const STAGES = ['', 'New', 'Contacted', 'Interested', 'Quoted', 'Won', 'Lost'];
const BASE_HIDE = ['phone', 'address', 'email'];
export const EVENT_KINDS = {
  'customer.saved': 'A customer was added or changed',
  'invoice.created': 'An invoice was made',
  'lead.added': 'A lead was added',
  'lead.stage': 'A lead moved to another stage',
  'lead.converted': 'A lead became a customer or supplier',
  'followup.done': 'A follow-up was done',
  'customer.removed': 'A customer went to the bin',
  'customer.restored': 'A customer came back from the bin',
  'lead.removed': 'A lead went to the bin',
  'lead.restored': 'A lead came back from the bin',
};
const ACTS = { followup: 'Plan a follow-up', lead_stage: 'Move the lead to a stage', lead_followup: 'Set the lead\'s follow-up day', note: 'Write a note on the customer' };
const OPS = ['eq', 'ne', 'contains', 'gt', 'lt', 'empty', 'notempty'];

function need(ctx, role, what) {
  if (!roleAtLeast(ctx.s.role, role)) throw new Error((what || 'This') + ' is for ' + (role === 'owner' ? 'the owner' : role === 'manager' ? 'a manager or the owner' : 'the team') + '. If you need this, ask the owner to open it for you (Settings > Users).');
}
async function needOn(ctx) {
  if (await appIsOff(ctx.deps, ctx.sql, 'crm', ctx)) throw new Error('The customer tools are not open on this ERP yet.');
}
const who = (ctx) => str(ctx.s && ctx.s.name) || 'Someone';

/** The customers row of a key (last 10 digits of the phone, or n:<name> for someone without a phone). */
async function custRow(ctx, key) {
  if (!key || key === 'n:') return null;
  return key.startsWith('n:')
    ? (await ctx.tx`select * from customers where business_id = ${ctx.biz} and lower(btrim(name)) = ${key.slice(2)}
                    and length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) < 10 order by seq limit 1`)[0] || null
    : (await ctx.tx`select * from customers where business_id = ${ctx.biz}
                    and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${key} order by seq limit 1`)[0] || null;
}
function keyOf(p) {
  const k = str(p && p.key);
  return k || custKey(str(p && p.phone), str(p && p.name));
}

// ================================================================== G1 the timeline
export async function erpCrmTimeline(ctx, payload) {
  await needOn(ctx);
  const p = payload || {};
  const key = keyOf(p);
  if (!key || key === 'n:') throw new Error('Whose timeline?');
  const byPhone = !key.startsWith('n:');
  const limit = Math.max(10, Math.min(200, num(p.limit) || 60));
  const before = p.before ? new Date(str(p.before)) : null;
  const cust = await custRow(ctx, key);
  const items = [];
  const add = (at, kind, title, more) => { if (at) items.push({ at: new Date(at).toISOString(), when: day(at), kind, title, ...(more || {}) }); };

  const invs = byPhone
    ? await ctx.tx`select invoice_no, created_at, grand_total, source from invoices where business_id = ${ctx.biz} and invoice_no not like 'RTN-%'
                   and right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${key} order by created_at desc limit 500`
    : await ctx.tx`select invoice_no, created_at, grand_total, source from invoices where business_id = ${ctx.biz} and invoice_no not like 'RTN-%'
                   and lower(btrim(customer_name)) = ${key.slice(2)} and length(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g')) < 10
                   order by created_at desc limit 500`;
  for (const i of invs) add(i.created_at, 'invoice', 'Invoice', { amount: Math.round(num(i.grand_total)), ref: i.invoice_no, sub: str(i.source) });
  const nos = invs.map((i) => i.invoice_no);
  if (nos.length) {
    for (const x of await ctx.tx`select payment_no, invoice_no, paid_at, amount, method from payments where business_id = ${ctx.biz} and invoice_no = any(${nos}) order by paid_at desc limit 500`)
      add(x.paid_at, 'payment', 'Payment' + (x.method ? ' by ' + str(x.method) : ''), { amount: Math.round(num(x.amount) * 100) / 100, ref: str(x.invoice_no) });
    for (const x of await ctx.tx`select return_no, invoice_no, returned_at, product, qty, value from returns where business_id = ${ctx.biz} and invoice_no = any(${nos}) order by returned_at desc limit 200`)
      add(x.returned_at, 'return', 'Returned ' + num(x.qty) + ' × ' + str(x.product), { amount: Math.round(num(x.value)), ref: str(x.invoice_no) });
    for (const x of await ctx.tx`select invoice_no, booked_at, consignment_id, cod_amount, note from courier_log where business_id = ${ctx.biz} and invoice_no = any(${nos}) order by booked_at desc limit 200`)
      add(x.booked_at, 'parcel', /\[by hand\]/.test(str(x.note)) ? 'Sent by hand' : 'Parcel booked' + (x.consignment_id ? ' (' + str(x.consignment_id) + ')' : ''), { amount: Math.round(num(x.cod_amount)), ref: str(x.invoice_no) });
  }
  if (byPhone) {
    for (const x of await ctx.tx`select paid_at, amount from payments where business_id = ${ctx.biz} and invoice_no is null and note like ${'%[acct:' + key + ']%'} order by paid_at desc limit 100`)
      add(x.paid_at, 'payment', 'Money on account', { amount: Math.round(num(x.amount)) });
    try {
      for (const x of await ctx.tx`select hold_no, status, created_at, grand_total from order_holds where business_id = ${ctx.biz}
                                    and right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${key} order by created_at desc limit 100`)
        add(x.created_at, 'hold', 'Order waiting for the customer\'s OK (' + str(x.hold_no) + ')', { amount: Math.round(num(x.grand_total)), sub: str(x.status) });
    } catch (_) { /* before 156 */ }
  }
  for (const x of await ctx.tx`select body, file_name, by, at from record_notes where business_id = ${ctx.biz} and kind = 'customer' and lower(ref) = ${key.toLowerCase()} and voided is null order by at desc limit 200`)
    add(x.at, 'note', str(x.body) || (x.file_name ? 'File: ' + str(x.file_name) : 'Note'), { by: str(x.by) });
  for (const x of await ctx.tx`select due_on, note, status, outcome, by, at, done_by, done_at from customer_followups where business_id = ${ctx.biz} and customer_key = ${key} order by at desc limit 200`) {
    add(x.at, 'followup', 'Follow-up planned for ' + day(x.due_on) + ': ' + str(x.note), { by: str(x.by) });
    if (x.status === 'done') add(x.done_at, 'followup', 'Follow-up done: ' + (str(x.outcome) || str(x.note)), { by: str(x.done_by) });
  }
  // chats: every Inbox contact of this customer (by its key, its phone, or - G12 - its e-mail on an e-mail channel)
  const email = cust ? str(cust.email).toLowerCase() : '';
  const contacts = await ctx.tx`select k.id, ch.kind, ch.name as ch_name from inbox_contacts k join inbox_channels ch on ch.id = k.channel_id
      where k.business_id = ${ctx.biz} and (k.customer_key = ${key}
        or (${byPhone} and right(regexp_replace(coalesce(k.phone, ''), '[^0-9]', '', 'g'), 10) = ${key})
        or (${email} <> '' and ch.kind = 'email' and lower(k.external_id) = ${email}))`;
  if (contacts.length) {
    const kindOf = {}; for (const c of contacts) kindOf[c.id] = c;
    const rows = await ctx.tx`select v.contact_id, date_trunc('day', m.created_at) as d, count(*)::int as n, max(m.created_at) as last_at,
        (array_agg(m.text order by m.created_at desc, m.id desc))[1] as last_text,
        count(*) filter (where m.direction = 'in')::int as n_in
      from inbox_messages m join inbox_conversations v on v.id = m.conversation_id
      where v.business_id = ${ctx.biz} and v.contact_id = any(${contacts.map((c) => c.id)}) and m.direction <> 'note'
      group by v.contact_id, d order by last_at desc limit 300`;
    const CH = { messenger: 'Messenger', instagram: 'Instagram', wa_cloud: 'WhatsApp', wa_evo: 'WhatsApp', wa_sender: 'WhatsApp', webchat: 'Website chat', email: 'E-mail' };
    for (const r of rows) {
      const c = kindOf[r.contact_id] || {};
      add(r.last_at, c.kind === 'email' ? 'email' : 'chat', (CH[c.kind] || 'Chat') + ': ' + r.n + ' message' + (r.n === 1 ? '' : 's') + (r.n_in ? ' (' + r.n_in + ' from them)' : ''),
        { sub: str(r.last_text).slice(0, 160), channel: str(c.ch_name) });
    }
  }
  const leads = byPhone
    ? await ctx.tx`select id, name, stage, source, created_at, updated_at from inbox_leads where business_id = ${ctx.biz}
                   and (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${key} or (${cust ? cust.id : null}::uuid is not null and customer_id = ${cust ? cust.id : null})) limit 50`
    : cust ? await ctx.tx`select id, name, stage, source, created_at, updated_at from inbox_leads where business_id = ${ctx.biz} and customer_id = ${cust.id} limit 50` : [];
  for (const l of leads) add(l.created_at, 'lead', 'Lead added (' + (str(l.source) || 'by hand') + '), now ' + STAGES[l.stage], { ref: l.id });
  if (cust) add(cust.created_at, 'customer', 'On the customer list since ' + day(cust.created_at));

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const after = before ? items.filter((x) => new Date(x.at) < before) : items;
  const page = after.slice(0, limit);
  const counts = {}; for (const x of items) counts[x.kind] = (counts[x.kind] || 0) + 1;
  return { key, items: page, more: after.length > page.length, next: page.length ? page[page.length - 1].at : '', counts, total: items.length };
}

// ================================================================== G3 conditions + saved views
function valueOf(row, field) {
  if (!field) return undefined;
  if (field.startsWith('x.')) return row.extra ? row.extra[field.slice(2)] : row['x_' + field.slice(2)];
  return row[field];
}
function test1(v, op, want) {
  const s = v === null || v === undefined ? '' : String(v);
  const w = want === null || want === undefined ? '' : String(want);
  const n = Number(s), m = Number(w), both = s !== '' && w !== '' && isFinite(n) && isFinite(m);
  switch (op) {
    case 'eq': return both ? n === m : s.toLowerCase() === w.toLowerCase();
    case 'ne': return both ? n !== m : s.toLowerCase() !== w.toLowerCase();
    case 'contains': return s.toLowerCase().includes(w.toLowerCase());
    case 'gt': return both ? n > m : s > w;
    case 'lt': return both ? n < m : s < w;
    case 'empty': return s.trim() === '' || s === '—';
    case 'notempty': return !(s.trim() === '' || s === '—');
    default: return true;
  }
}
/** rows that meet the conditions: match 'all' (and) or 'any' (or). Unknown operators are ignored. */
export function applyConds(rows, conds, match) {
  const cs = (Array.isArray(conds) ? conds : []).filter((c) => c && str(c.field) && OPS.includes(str(c.op))).slice(0, 12);
  if (!cs.length) return rows;
  const any = str(match) === 'any';
  return rows.filter((r) => (any ? cs.some((c) => test1(valueOf(r, str(c.field)), str(c.op), c.value)) : cs.every((c) => test1(valueOf(r, str(c.field)), str(c.op), c.value))));
}
function viewOut(v, ctx) {
  return { id: v.id, target: v.target, name: v.name, state: v.state || {}, shared: !!v.shared, owner: str(v.owner_name), mine: !!(ctx.s.userId && v.owner_id === ctx.s.userId) };
}
export async function erpCrmViews(ctx, payload) {
  await needOn(ctx);
  const t = str(payload && payload.target);
  const rows = await ctx.tx`select * from crm_views where business_id = ${ctx.biz} and (${t} = '' or target = ${t})
                            and (shared or owner_id = ${ctx.s.userId || null}) order by shared, lower(name)`;
  return { views: rows.map((v) => viewOut(v, ctx)) };
}
export async function erpCrmViewSave(ctx, payload) {
  await needOn(ctx);
  const p = payload || {};
  const target = str(p.target), name = str(p.name).slice(0, 60);
  if (!['customers', 'leads'].includes(target)) throw new Error('Which list?');
  if (!name) throw new Error('Give the view a name.');
  const shared = !!p.shared;
  if (shared) need(ctx, 'manager', 'A view for the whole team');
  const state = p.state && typeof p.state === 'object' ? p.state : {};
  if (JSON.stringify(state).length > 8000) throw new Error('That view is too big.');
  if (p.id) {
    const v = (await ctx.tx`select * from crm_views where business_id = ${ctx.biz} and id = ${str(p.id)}`)[0];
    if (!v) throw new Error('That view is gone.');
    if (v.owner_id !== ctx.s.userId && !roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only the person who made it changes this view.');
    await ctx.tx`update crm_views set name = ${name}, state = ${ctx.tx.json(state)}, shared = ${shared} where id = ${v.id}`;
  } else {
    await ctx.tx`insert into crm_views (business_id, target, name, state, shared, owner_id, owner_name) values (${ctx.biz}, ${target}, ${name}, ${ctx.tx.json(state)}, ${shared}, ${ctx.s.userId || null}, ${who(ctx)})`;
  }
  return erpCrmViews(ctx, { target });
}
export async function erpCrmViewRemove(ctx, payload) {
  await needOn(ctx);
  const v = (await ctx.tx`select * from crm_views where business_id = ${ctx.biz} and id = ${str(payload && payload.id)}`)[0];
  if (!v) throw new Error('That view is gone.');
  if (v.owner_id !== ctx.s.userId && !roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only the person who made it removes this view.');
  await ctx.tx`delete from crm_views where id = ${v.id}`;
  return erpCrmViews(ctx, { target: v.target });
}

// ================================================================== G5 own fields
async function fieldsOf(ctx, target) {
  return ctx.tx`select * from crm_fields where business_id = ${ctx.biz} and removed_at is null and (${target || ''} = '' or target = ${target || ''}) order by target, sort, created_at`;
}
const fieldOut = (f) => ({ id: f.id, target: f.target, key: f.key, label: f.label, type: f.type, choices: f.choices || [], hideSales: !!f.hide_sales });
export async function erpCrmFields(ctx, payload) {
  await needOn(ctx);
  return { fields: (await fieldsOf(ctx, str(payload && payload.target))).map(fieldOut) };
}
export async function erpCrmFieldSave(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'owner', 'Making fields');
  const p = payload || {};
  const label = str(p.label).slice(0, 40);
  if (!label) throw new Error('What is the field called?');
  const type = ['text', 'number', 'date', 'choice', 'yesno'].includes(str(p.type)) ? str(p.type) : 'text';
  const choices = type === 'choice' ? (Array.isArray(p.choices) ? p.choices : str(p.choices).split(',')).map((c) => str(c).slice(0, 40)).filter(Boolean).slice(0, 30) : [];
  if (type === 'choice' && choices.length < 2) throw new Error('A choice field needs at least two choices, separated by commas.');
  if (p.id) {
    const f = (await ctx.tx`select * from crm_fields where business_id = ${ctx.biz} and id = ${str(p.id)} and removed_at is null`)[0];
    if (!f) throw new Error('That field is gone.');
    await ctx.tx`update crm_fields set label = ${label}, type = ${type}, choices = ${choices}, hide_sales = ${!!p.hideSales} where id = ${f.id}`;
  } else {
    const target = str(p.target);
    if (!['customer', 'lead'].includes(target)) throw new Error('A field for customers or for leads?');
    const n = (await ctx.tx`select count(*)::int n from crm_fields where business_id = ${ctx.biz} and target = ${target} and removed_at is null`)[0].n;
    if (n >= 40) throw new Error('40 fields is the most.');
    let key = 'f_' + (label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'field');
    const taken = new Set((await ctx.tx`select key from crm_fields where business_id = ${ctx.biz} and target = ${target}`).map((r) => r.key));
    for (let i = 2; taken.has(key); i++) key = key.replace(/_\d+$/, '') + '_' + i;
    await ctx.tx`insert into crm_fields (business_id, target, key, label, type, choices, hide_sales, sort, by)
                 values (${ctx.biz}, ${target}, ${key}, ${label}, ${type}, ${choices}, ${!!p.hideSales}, ${n}, ${who(ctx)})`;
  }
  return erpCrmFields(ctx, {});
}
export async function erpCrmFieldRemove(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'owner', 'Removing fields');
  const f = (await ctx.tx`select * from crm_fields where business_id = ${ctx.biz} and id = ${str(payload && payload.id)} and removed_at is null`)[0];
  if (!f) throw new Error('That field is gone.');
  await ctx.tx`update crm_fields set removed_at = now() where id = ${f.id}`;   // the values stay in extra; making it again shows them
  return erpCrmFields(ctx, {});
}
function cleanValue(f, v) {
  if (v === null || v === undefined || str(v) === '') return null;
  if (f.type === 'number') { const n = Number(str(v).replace(/,/g, '')); if (!isFinite(n)) throw new Error(f.label + ' must be a number.'); return n; }
  if (f.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(str(v))) throw new Error(f.label + ' is a date like 2026-11-30.'); return str(v); }
  if (f.type === 'choice') { if (!(f.choices || []).includes(str(v))) throw new Error(f.label + ': choose one of ' + (f.choices || []).join(', ') + '.'); return str(v); }
  if (f.type === 'yesno') return v === true || /^(yes|true|1|on)$/i.test(str(v));
  return str(v).slice(0, 500);
}
export async function erpCrmExtraSave(ctx, payload) {
  await needOn(ctx);
  const p = payload || {};
  const target = str(p.target) === 'lead' ? 'lead' : 'customer';
  const fields = await fieldsOf(ctx, target);
  const byKey = {}; for (const f of fields) byKey[f.key] = f;
  const vals = p.values && typeof p.values === 'object' ? p.values : {};
  const hid = await hiddenFor(ctx);
  const set = {};
  for (const k of Object.keys(vals)) {
    const f = byKey[k];
    if (!f) continue;
    if (hid.fields.includes(k)) throw new Error(f.label + ' is not open for your account.');
    set[k] = cleanValue(f, vals[k]);
  }
  if (target === 'customer') {
    const c = await custRow(ctx, keyOf(p));
    if (!c) throw new Error('Put them on the customer list first (Customers > New).');
    const ex = { ...(c.extra || {}), ...set }; for (const k of Object.keys(ex)) if (ex[k] === null) delete ex[k];
    await ctx.tx`update customers set extra = ${ctx.tx.json(ex)}, updated_at = now() where id = ${c.id}`;
    return { ok: true, extra: ex };
  }
  const l = (await ctx.tx`select * from inbox_leads where business_id = ${ctx.biz} and id = ${str(p.id)}`)[0];
  if (!l) throw new Error('No such lead.');
  const ex = { ...(l.extra || {}), ...set }; for (const k of Object.keys(ex)) if (ex[k] === null) delete ex[k];
  await ctx.tx`update inbox_leads set extra = ${ctx.tx.json(ex)}, updated_at = now() where id = ${l.id}`;
  return { ok: true, extra: ex };
}

// ================================================================== G4 companies
const compOut = (c) => ({ id: c.id, name: c.name, kind: str(c.kind), phone: str(c.phone), address: str(c.address), note: str(c.note), people: Number(c.people || 0), since: day(c.created_at) });
export async function erpCrmCompanies(ctx) {
  await needOn(ctx);
  const rows = await ctx.tx`select c.*, (select count(*) from customers u where u.business_id = c.business_id and u.company_id = c.id) as people
                            from crm_companies c where c.business_id = ${ctx.biz} order by lower(c.name) limit 1000`;
  return { companies: rows.map(compOut) };
}
export async function erpCrmCompany(ctx, payload) {
  await needOn(ctx);
  const c = (await ctx.tx`select * from crm_companies where business_id = ${ctx.biz} and id = ${str(payload && payload.id)}`)[0];
  if (!c) throw new Error('That company is gone.');
  const ppl = await ctx.tx`select seq, name, phone, email, address, extra from customers where business_id = ${ctx.biz} and company_id = ${c.id} order by lower(name)`;
  const money = roleAtLeast(ctx.s.role, 'manager');
  let byKey = {};
  if (money) { try { byKey = (await (await import('./money.js')).erpDues(ctx)).byKey || {}; } catch (_) { byKey = {}; } }
  const people = [];
  let spent = 0, orders = 0, owes = 0;
  for (const u of ppl) {
    const k = custKey(u.phone, u.name);
    const inv = k.startsWith('n:') ? { n: 0, s: 0 } : (await ctx.tx`select count(*)::int n, coalesce(sum(grand_total), 0)::float s from invoices where business_id = ${ctx.biz} and invoice_no not like 'RTN-%'
                                                                       and right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${k}`)[0];
    spent += inv.s; orders += inv.n;
    const due = money ? Math.round(num((byKey[k] || {}).due)) : null; if (due) owes += due;
    people.push({ key: k, name: str(u.name), phone: formatBdPhone(str(u.phone)), orders: inv.n, spent: Math.round(inv.s), owes: due });
  }
  return { company: compOut({ ...c, people: people.length }), people, orders, spent: Math.round(spent), owes: money ? owes : null };
}
export async function erpCrmCompanySave(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'manager', 'Companies');
  const p = payload || {};
  const name = str(p.name).slice(0, 120);
  if (!name) throw new Error('What is the company called?');
  const dup = (await ctx.tx`select id from crm_companies where business_id = ${ctx.biz} and lower(btrim(name)) = ${name.toLowerCase()} and id::text <> ${str(p.id)}`)[0];
  if (dup) throw new Error('There is already a company called ' + name + '.');
  let id = str(p.id);
  if (id) {
    const c = (await ctx.tx`select id from crm_companies where business_id = ${ctx.biz} and id = ${id}`)[0];
    if (!c) throw new Error('That company is gone.');
    await ctx.tx`update crm_companies set name = ${name}, kind = ${str(p.kind) || null}, phone = ${str(p.phone) || null}, address = ${str(p.address) || null}, note = ${str(p.note) || null}, updated_at = now() where id = ${id}`;
  } else {
    id = (await ctx.tx`insert into crm_companies (business_id, name, kind, phone, address, note, by) values (${ctx.biz}, ${name}, ${str(p.kind) || null}, ${str(p.phone) || null}, ${str(p.address) || null}, ${str(p.note) || null}, ${who(ctx)}) returning id`)[0].id;
  }
  return { ok: true, id, ...(await erpCrmCompanies(ctx)) };
}
export async function erpCrmCompanyLink(ctx, payload) {
  await needOn(ctx);
  const p = payload || {};
  const c = await custRow(ctx, keyOf(p));
  if (!c) throw new Error('Put them on the customer list first (Customers > New).');
  let comp = null;
  if (str(p.companyId)) {
    comp = (await ctx.tx`select id, name from crm_companies where business_id = ${ctx.biz} and id = ${str(p.companyId)}`)[0];
    if (!comp) throw new Error('That company is gone.');
  }
  await ctx.tx`update customers set company_id = ${comp ? comp.id : null}, updated_at = now() where id = ${c.id}`;
  return { ok: true, company: comp ? { id: comp.id, name: comp.name } : null };
}

// ================================================================== G6 duplicates
async function dupeOkSet(ctx) {
  const s = new Set();
  for (const r of await ctx.tx`select a, b from crm_dupe_ok where business_id = ${ctx.biz}`) s.add(r.a + '|' + r.b);
  return s;
}
export async function erpCrmDupes(ctx) {
  await needOn(ctx);
  need(ctx, 'manager', 'The duplicate list');
  const rows = await ctx.tx`select seq, name, phone, email, created_at from customers where business_id = ${ctx.biz} limit 20000`;
  const ok = await dupeOkSet(ctx);
  const byName = new Map(), byMail = new Map();
  for (const r of rows) {
    const k = custKey(r.phone, r.name), n = normName(r.name), m = str(r.email).toLowerCase();
    const one = { key: k, row: Number(r.seq), name: str(r.name), phone: formatBdPhone(str(r.phone)), email: str(r.email), since: day(r.created_at) };
    if (n && n.length >= 3 && !/^(walk ?in|customer|removed customer)/.test(n)) { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(one); }
    if (m && /@/.test(m)) { if (!byMail.has(m)) byMail.set(m, []); byMail.get(m).push(one); }
  }
  const groups = [];
  const take = (why, list) => {
    const uniq = []; const seen = new Set();
    for (const x of list) if (!seen.has(x.key)) { seen.add(x.key); uniq.push(x); }
    if (uniq.length < 2) return;
    const pairs = []; for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) { const a = [uniq[i].key, uniq[j].key].sort(); if (!ok.has(a[0] + '|' + a[1])) pairs.push(a); }
    if (pairs.length) groups.push({ why, people: uniq });
  };
  for (const [, l] of byName) take('Same name', l);
  for (const [, l] of byMail) take('Same e-mail', l);
  return { groups: groups.slice(0, 100), total: groups.length };
}
export async function erpCrmDupCheck(ctx, payload) {
  await needOn(ctx);
  const p = payload || {};
  const n = normName(p.name), k = last10(p.phone), m = str(p.email).toLowerCase(), row = num(p.row);
  if (!n && !k && !m) return { matches: [] };
  const rows = await ctx.tx`select seq, name, phone, email from customers where business_id = ${ctx.biz} and seq <> ${row || -1}
      and ((${k} <> '' and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${k})
        or (${m} <> '' and lower(coalesce(email, '')) = ${m})
        or (${n.length >= 3} and lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) = ${str(p.name).trim().toLowerCase().replace(/\s+/g, ' ')})) limit 10`;
  return { matches: rows.map((r) => ({ key: custKey(r.phone, r.name), row: Number(r.seq), name: str(r.name), phone: formatBdPhone(str(r.phone)), email: str(r.email),
    why: k && last10(r.phone) === k ? 'Same phone' : m && str(r.email).toLowerCase() === m ? 'Same e-mail' : 'Same name' })) };
}
export async function erpCrmDupeOk(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'manager', 'The duplicate list');
  const keys = (Array.isArray(payload && payload.keys) ? payload.keys : []).map(str).filter(Boolean).slice(0, 20);
  if (keys.length < 2) throw new Error('Which customers?');
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = [keys[i], keys[j]].sort();
    await ctx.tx`insert into crm_dupe_ok (business_id, a, b, by) values (${ctx.biz}, ${a[0]}, ${a[1]}, ${who(ctx)}) on conflict do nothing`;
  }
  return erpCrmDupes(ctx);
}

// ================================================================== G7 events out
/** Write an event (and run the rules, G8). Never throws into the caller: an event is a side note. */
export async function emit(ctx, kind, ref, data, depth) {
  try {
    await ctx.tx.savepoint(async (tx) => {
      const c = { ...ctx, tx };
      const ev = (await tx`insert into crm_events (business_id, kind, ref, data, by) values (${ctx.biz}, ${kind}, ${str(ref) || null}, ${tx.json(data || {})}, ${who(ctx)}) returning id`)[0];
      if (!depth) await runRules(c, { id: ev.id, kind, ref: str(ref), data: data || {} });
    });
  } catch (e) { console.error('crm emit', kind, e && e.message); }
}
const evOut = (e) => ({ id: Number(e.id), kind: e.kind, ref: str(e.ref), data: e.data || {}, by: str(e.by), at: new Date(e.at).toISOString() });
export async function erpCrmEvents(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'owner', 'The event list');
  const after = Math.max(0, num(payload && payload.after)), limit = Math.max(1, Math.min(500, num(payload && payload.limit) || 100));
  const kind = str(payload && payload.kind);
  const rows = await ctx.tx`select * from crm_events where business_id = ${ctx.biz} and id > ${after} and (${kind} = '' or kind = ${kind}) order by id limit ${limit}`;
  return { events: rows.map(evOut), next: rows.length ? Number(rows[rows.length - 1].id) : after, kinds: EVENT_KINDS };
}
const hookOut = (h) => ({ id: h.id, url: h.url, kinds: h.kinds || [], on: !!h.on_, sentUpTo: Number(h.after_id), lastOk: h.last_ok_at ? day(h.last_ok_at) + ' ' + formatDate(new Date(h.last_ok_at), 'HH:mm') : '', lastError: str(h.last_error) });
export async function erpCrmHooks(ctx) {
  await needOn(ctx);
  need(ctx, 'owner', 'Sending events');
  const hooks = await ctx.tx`select * from crm_hooks where business_id = ${ctx.biz} order by created_at`;
  const last = (await ctx.tx`select coalesce(max(id), 0)::bigint m from crm_events where business_id = ${ctx.biz}`)[0].m;
  return { hooks: hooks.map(hookOut), kinds: EVENT_KINDS, lastEvent: Number(last) };
}
export async function erpCrmHookSave(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'owner', 'Sending events');
  const p = payload || {};
  const url = str(p.url);
  if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error('The address starts with https:// (for n8n: the Webhook node\'s production URL).');
  const kinds = (Array.isArray(p.kinds) ? p.kinds : []).map(str).filter((k) => EVENT_KINDS[k]);
  let id = str(p.id), made = '';
  if (id) {
    const h = (await ctx.tx`select id from crm_hooks where business_id = ${ctx.biz} and id = ${id}`)[0];
    if (!h) throw new Error('That address is gone.');
    await ctx.tx`update crm_hooks set url = ${url}, kinds = ${kinds}, on_ = ${p.on !== false} where id = ${id}`;
  } else {
    if ((await ctx.tx`select count(*)::int n from crm_hooks where business_id = ${ctx.biz}`)[0].n >= 10) throw new Error('10 addresses is the most.');
    const last = (await ctx.tx`select coalesce(max(id), 0)::bigint m from crm_events where business_id = ${ctx.biz}`)[0].m;
    id = (await ctx.tx`insert into crm_hooks (business_id, url, kinds, after_id, by) values (${ctx.biz}, ${url}, ${kinds}, ${last}, ${who(ctx)}) returning id`)[0].id;
    made = randHex(24);
    await setSecret(ctx, 'CRM_HOOK_' + id, made);
  }
  const out = await erpCrmHooks(ctx);
  return made ? { ...out, secret: made, secretFor: id } : out;   // the secret is shown once, when the address is made
}
export async function erpCrmHookRemove(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'owner', 'Sending events');
  const h = (await ctx.tx`select id from crm_hooks where business_id = ${ctx.biz} and id = ${str(payload && payload.id)}`)[0];
  if (!h) throw new Error('That address is gone.');
  await ctx.tx`delete from crm_hooks where id = ${h.id}`;
  await setSecret(ctx, 'CRM_HOOK_' + h.id, '');
  return erpCrmHooks(ctx);
}
function randHex(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
async function sign(secret, body) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)));
  return Array.from(s, (x) => x.toString(16).padStart(2, '0')).join('');
}
async function post(ctx, h, events) {
  const body = JSON.stringify({ business: ctx.biz, events: events.map(evOut) });
  const secret = await getSecret(ctx, 'CRM_HOOK_' + h.id);
  const f = (ctx.deps && ctx.deps.fetch) || fetch;
  try {
    const res = await f(h.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-erp-signature': secret ? 'sha256=' + await sign(secret, body) : '' }, body });
    const t = await res.text();
    return res.status >= 200 && res.status < 300 ? { ok: true } : { ok: false, error: 'HTTP ' + res.status + ' ' + t.slice(0, 120) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 160) }; }
}
export async function erpCrmHookTest(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'owner', 'Sending events');
  const h = (await ctx.tx`select * from crm_hooks where business_id = ${ctx.biz} and id = ${str(payload && payload.id)}`)[0];
  if (!h) throw new Error('That address is gone.');
  const r = await post(ctx, h, [{ id: 0, kind: 'test', ref: '', data: { hello: 'This is a test from the ERP' }, by: who(ctx), at: ctx.now }]);
  await ctx.tx`update crm_hooks set last_error = ${r.ok ? null : r.error}, last_ok_at = ${r.ok ? ctx.now : h.last_ok_at} where id = ${h.id}`;
  return { ok: r.ok, error: r.error || '', ...(await erpCrmHooks(ctx)) };
}
/** Every minute (jobs.js 'inbox'): send what each address has not had yet, 50 at a time, in order. */
export async function crmTick(ctx) {
  const out = {};
  for (const h of await ctx.tx`select * from crm_hooks where business_id = ${ctx.biz} and on_`) {
    const evs = await ctx.tx`select * from crm_events where business_id = ${ctx.biz} and id > ${h.after_id} and (cardinality(${h.kinds}::text[]) = 0 or kind = any(${h.kinds}::text[])) order by id limit 50`;
    if (!evs.length) {
      const top = (await ctx.tx`select coalesce(max(id), 0)::bigint m from crm_events where business_id = ${ctx.biz}`)[0].m;
      if (Number(top) > Number(h.after_id)) await ctx.tx`update crm_hooks set after_id = ${top} where id = ${h.id}`;
      continue;
    }
    const r = await post(ctx, h, evs);
    if (r.ok) await ctx.tx`update crm_hooks set after_id = ${evs[evs.length - 1].id}, last_ok_at = now(), last_error = null where id = ${h.id}`;
    else await ctx.tx`update crm_hooks set last_error = ${r.error} where id = ${h.id}`;   // tried again next minute
    out[h.id] = r.ok ? evs.length : r.error;
  }
  return out;
}

// ================================================================== G8 rules
const ruleOut = (r) => ({ id: r.id, name: r.name, when: r.when_kind, cond: r.cond || {}, act: r.act, params: r.params || {}, on: !!r.on_, runs: r.runs, lastRun: day(r.last_run_at) });
export async function erpCrmRules(ctx) {
  await needOn(ctx);
  need(ctx, 'owner', 'Rules');
  const rows = await ctx.tx`select * from crm_rules where business_id = ${ctx.biz} order by created_at`;
  return { rules: rows.map(ruleOut), kinds: EVENT_KINDS, acts: ACTS, ops: OPS, stages: STAGES.slice(1) };
}
export async function erpCrmRuleSave(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'owner', 'Rules');
  const p = payload || {};
  const name = str(p.name).slice(0, 80);
  if (!name) throw new Error('Give the rule a name.');
  if (!EVENT_KINDS[str(p.when)]) throw new Error('When should it run?');
  if (!ACTS[str(p.act)]) throw new Error('What should it do?');
  const cond = p.cond && str(p.cond.field) && OPS.includes(str(p.cond.op)) ? { field: str(p.cond.field).slice(0, 40), op: str(p.cond.op), value: p.cond.value === undefined ? '' : str(p.cond.value).slice(0, 100) } : {};
  const pr = p.params || {};
  const params = { days: Math.max(0, Math.min(365, Math.round(num(pr.days)))), note: str(pr.note).slice(0, 300), stage: Math.max(1, Math.min(6, Math.round(num(pr.stage) || 1))) };
  if (['followup', 'note'].includes(str(p.act)) && !params.note) throw new Error('Write what the follow-up or the note says.');
  if (['followup', 'note'].includes(str(p.act)) && !/^(customer|invoice|followup)\./.test(str(p.when))) throw new Error('A follow-up or a note needs a customer: choose a customer, invoice or follow-up event.');
  if (['lead_stage', 'lead_followup'].includes(str(p.act)) && !/^lead\./.test(str(p.when))) throw new Error('Moving a lead needs a lead event.');
  if (p.id) {
    const r = (await ctx.tx`select id from crm_rules where business_id = ${ctx.biz} and id = ${str(p.id)}`)[0];
    if (!r) throw new Error('That rule is gone.');
    await ctx.tx`update crm_rules set name = ${name}, when_kind = ${str(p.when)}, cond = ${ctx.tx.json(cond)}, act = ${str(p.act)}, params = ${ctx.tx.json(params)}, on_ = ${p.on !== false} where id = ${r.id}`;
  } else {
    if ((await ctx.tx`select count(*)::int n from crm_rules where business_id = ${ctx.biz}`)[0].n >= 50) throw new Error('50 rules is the most.');
    await ctx.tx`insert into crm_rules (business_id, name, when_kind, cond, act, params, by) values (${ctx.biz}, ${name}, ${str(p.when)}, ${ctx.tx.json(cond)}, ${str(p.act)}, ${ctx.tx.json(params)}, ${who(ctx)})`;
  }
  return erpCrmRules(ctx);
}
export async function erpCrmRuleRemove(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'owner', 'Rules');
  await ctx.tx`delete from crm_rules where business_id = ${ctx.biz} and id = ${str(payload && payload.id)}`;
  return erpCrmRules(ctx);
}
async function runRules(ctx, ev) {
  const rules = await ctx.tx`select * from crm_rules where business_id = ${ctx.biz} and on_ and when_kind = ${ev.kind}`;
  for (const r of rules) {
    const c = r.cond || {};
    if (c.field && !test1(ev.data[c.field], c.op, c.value)) continue;
    const pr = r.params || {};
    const due = ymd(ctx.now.getTime() + num(pr.days) * 86400e3);
    const by = 'Rule: ' + r.name;
    const key = str(ev.data.key);
    if (r.act === 'followup' && key && key !== 'n:') {
      await ctx.tx`insert into customer_followups (business_id, customer_key, customer, phone, due_on, note, by)
                   values (${ctx.biz}, ${key}, ${str(ev.data.name) || 'Customer'}, ${str(ev.data.phone) || null}, ${due}, ${str(pr.note)}, ${by})`;
    } else if (r.act === 'note' && key && key !== 'n:') {
      await ctx.tx`insert into record_notes (business_id, kind, ref, body, by) values (${ctx.biz}, 'customer', ${key}, ${str(pr.note)}, ${by})`;
    } else if (r.act === 'lead_stage' && ev.data.id) {
      await ctx.tx`update inbox_leads set stage = ${num(pr.stage)}, updated_at = now() where business_id = ${ctx.biz} and id = ${str(ev.data.id)}`;
      await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${str(ev.data.id)}, ${'Stage: ' + STAGES[num(pr.stage)]}, ${by})`;
    } else if (r.act === 'lead_followup' && ev.data.id) {
      await ctx.tx`update inbox_leads set follow_up_on = ${due}, updated_at = now() where business_id = ${ctx.biz} and id = ${str(ev.data.id)}`;
      await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${str(ev.data.id)}, ${'Follow up on ' + due}, ${by})`;
    } else continue;
    await ctx.tx`update crm_rules set runs = runs + 1, last_run_at = now() where id = ${r.id}`;
  }
}

// ================================================================== G9 the bin
export async function erpCrmRemove(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'manager', 'Removing');
  const p = payload || {};
  const reason = str(p.reason).slice(0, 200);
  if (str(p.kind) === 'lead') {
    const l = (await ctx.tx`select * from inbox_leads where business_id = ${ctx.biz} and id = ${str(p.id)}`)[0];
    if (!l) throw new Error('No such lead.');
    const evs = await ctx.tx`select what, by_name, at from inbox_lead_events where lead_id = ${l.id} order by id`;
    await ctx.tx`insert into crm_bin (business_id, kind, label, row_data, extra_data, reason, removed_by) values (${ctx.biz}, 'lead', ${str(l.name) || str(l.company) || 'Lead'}, ${ctx.tx.json(l)}, ${ctx.tx.json({ events: evs })}, ${reason || null}, ${who(ctx)})`;
    try { await ctx.tx`update campaign_leads set inbox_lead_id = null where business_id = ${ctx.biz} and inbox_lead_id = ${l.id}`; } catch (_) { /* before 159 */ }
    await ctx.tx`delete from inbox_leads where id = ${l.id}`;
    await emit(ctx, 'lead.removed', l.id, { id: l.id, name: str(l.name) });
    return { ok: true };
  }
  const key = keyOf(p);
  const c = await custRow(ctx, key);
  if (!c) throw new Error('That customer is not on the list.');
  const byPhone = !key.startsWith('n:');
  const inv = (byPhone
    ? await ctx.tx`select count(*)::int n from invoices where business_id = ${ctx.biz} and (customer_id = ${c.id} or right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${key})`
    : await ctx.tx`select count(*)::int n from invoices where business_id = ${ctx.biz} and (customer_id = ${c.id} or lower(btrim(customer_name)) = ${key.slice(2)})`)[0].n;
  if (inv) throw new Error(str(c.name) + ' has ' + inv + ' invoice(s), so they stay in the books. Only a customer with no sales goes to the bin.');
  const adv = (await ctx.tx`select count(*)::int n from payments where business_id = ${ctx.biz} and note like ${'%[acct:' + key + ']%'}`)[0].n;
  if (adv) throw new Error(str(c.name) + ' has money on account, so they stay.');
  const fu = await ctx.tx`select * from customer_followups where business_id = ${ctx.biz} and customer_key = ${key}`;
  await ctx.tx`insert into crm_bin (business_id, kind, label, row_data, extra_data, reason, removed_by) values (${ctx.biz}, 'customer', ${str(c.name) || 'Customer'}, ${ctx.tx.json(c)}, ${ctx.tx.json({ followups: fu })}, ${reason || null}, ${who(ctx)})`;
  await ctx.tx`update inbox_leads set customer_id = null where business_id = ${ctx.biz} and customer_id = ${c.id}`;
  await ctx.tx`delete from customer_followups where business_id = ${ctx.biz} and customer_key = ${key}`;
  await ctx.tx`delete from customers where id = ${c.id} and business_id = ${ctx.biz}`;
  await emit(ctx, 'customer.removed', key, { key, name: str(c.name) });
  return { ok: true };
}
const binOut = (b) => ({ id: b.id, kind: b.kind, label: b.label, reason: str(b.reason), by: str(b.removed_by), when: day(b.removed_at), back: b.restored_at ? day(b.restored_at) : '' });
export async function erpCrmBin(ctx) {
  await needOn(ctx);
  need(ctx, 'manager', 'The bin');
  const rows = await ctx.tx`select * from crm_bin where business_id = ${ctx.biz} order by removed_at desc limit 300`;
  return { bin: rows.map(binOut) };
}
export async function erpCrmRestore(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'manager', 'The bin');
  const b = (await ctx.tx`select * from crm_bin where business_id = ${ctx.biz} and id = ${str(payload && payload.id)} and restored_at is null`)[0];
  if (!b) throw new Error('That is not in the bin.');
  const row = b.row_data || {};
  if (row.business_id !== ctx.biz) throw new Error('That is not in the bin.');
  if (b.kind === 'customer') {
    const k = custKey(row.phone, row.name);
    if (await custRow(ctx, k)) throw new Error('A customer with that ' + (k.startsWith('n:') ? 'name' : 'phone') + ' is already on the list.');
    await ctx.tx`insert into customers select * from jsonb_populate_record(null::public.customers, ${ctx.tx.json(row)})`;
    for (const f of (b.extra_data && b.extra_data.followups) || []) await ctx.tx`insert into customer_followups select * from jsonb_populate_record(null::public.customer_followups, ${ctx.tx.json(f)}) on conflict do nothing`;
    await emit(ctx, 'customer.restored', k, { key: k, name: str(row.name) });
  } else {
    await ctx.tx`insert into inbox_leads select * from jsonb_populate_record(null::public.inbox_leads, ${ctx.tx.json(row)})`;
    for (const e of (b.extra_data && b.extra_data.events) || []) await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name, at) values (${ctx.biz}, ${row.id}, ${str(e.what)}, ${str(e.by_name)}, ${e.at})`;
    await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${row.id}, 'Back from the bin', ${who(ctx)})`;
    await emit(ctx, 'lead.restored', row.id, { id: row.id, name: str(row.name) });
  }
  await ctx.tx`update crm_bin set restored_at = now(), restored_by = ${who(ctx)} where id = ${b.id}`;
  return { ok: true, ...(await erpCrmBin(ctx)) };
}

// ================================================================== G10 what salespeople do not see
async function hideConfig(ctx) {
  let base = [];
  try { base = JSON.parse(await getConfig(ctx, 'crm_hide_sales', '[]')); } catch (_) { base = []; }
  return (Array.isArray(base) ? base : []).filter((x) => BASE_HIDE.includes(x));
}
/** What this person may not see: nothing for a manager and up. */
async function hiddenFor(ctx) {
  if (roleAtLeast(ctx.s.role, 'manager')) return { base: [], fields: [] };
  let on = false; try { on = !(await appIsOff(ctx.deps, ctx.sql, 'crm', ctx)); } catch (_) { on = false; }
  if (!on) return { base: [], fields: [] };
  const fields = (await ctx.tx`select key from crm_fields where business_id = ${ctx.biz} and removed_at is null and hide_sales`).map((r) => r.key);
  return { base: await hideConfig(ctx), fields };
}
export async function erpCrmHideSet(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'owner', 'What salespeople see');
  const list = (Array.isArray(payload && payload.hide) ? payload.hide : []).map(str).filter((x) => BASE_HIDE.includes(x));
  await setConfig(ctx, 'crm_hide_sales', JSON.stringify([...new Set(list)]));
  return { hide: await hideConfig(ctx) };
}
const maskPhone = (p) => { const s = str(p); if (!s) return s; const d = s.replace(/\D/g, ''); return d.length >= 4 ? d.slice(0, 3) + '•••••' + d.slice(-2) : '•••'; };
function maskObj(o, h) {
  if (!o || typeof o !== 'object') return o;
  if (h.base.includes('phone') && o.phone) o.phone = maskPhone(o.phone);
  if (h.base.includes('address') && 'address' in o) o.address = o.address ? '•••' : o.address;
  if (h.base.includes('email') && 'email' in o) o.email = o.email ? '•••' : o.email;
  if (h.fields.length && o.extra && typeof o.extra === 'object') { const e = { ...o.extra }; for (const k of h.fields) delete e[k]; o.extra = e; }
  return o;
}

// ================================================================== G11 calendar, G12 the calendar link
export async function erpCrmCalendar(ctx, payload) {
  await needOn(ctx);
  const m = /^\d{4}-\d{2}$/.test(str(payload && payload.month)) ? str(payload.month) : formatDate(ctx.now, 'yyyy-MM');
  const from = m + '-01';
  const d = new Date(from + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1);
  const to = ymd(d);
  const items = [];
  for (const f of await ctx.tx`select id, customer_key, customer, due_on, note, status, outcome from customer_followups where business_id = ${ctx.biz} and due_on >= ${from} and due_on < ${to} order by due_on`)
    items.push({ day: ymd(f.due_on), kind: 'followup', title: str(f.customer) + ': ' + str(f.note), done: f.status === 'done', key: f.customer_key, id: f.id });
  for (const l of await ctx.tx`select id, name, company, stage, follow_up_on from inbox_leads where business_id = ${ctx.biz} and follow_up_on >= ${from} and follow_up_on < ${to} order by follow_up_on`)
    items.push({ day: ymd(l.follow_up_on), kind: 'lead', title: (str(l.name) || str(l.company) || 'Lead') + ' (' + STAGES[l.stage] + ')', done: l.stage >= 5, id: l.id });
  return { month: m, today: formatDate(ctx.now, 'yyyy-MM-dd'), items };
}
async function sha(s) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join(''); }
export async function erpCrmCalLink(ctx, payload) {
  await needOn(ctx);
  need(ctx, 'owner', 'The calendar link');
  const have = (await ctx.tx`select * from crm_cal_feeds where business_id = ${ctx.biz}`)[0];
  if (payload && payload.stop) { await ctx.tx`delete from crm_cal_feeds where business_id = ${ctx.biz}`; return { on: false }; }
  if (!payload || !payload.make) return { on: !!have, since: have ? day(have.created_at) : '' };
  const token = ctx.biz + '.' + randHex(20);   // shown once; only its hash is kept
  await ctx.tx`insert into crm_cal_feeds (business_id, token_hash, by) values (${ctx.biz}, ${await sha(token)}, ${who(ctx)})
               on conflict (business_id) do update set token_hash = excluded.token_hash, by = excluded.by, created_at = now()`;
  const base = str(ctx.deps && ctx.deps.hookBase).replace(/[?&].*$/, '');
  return { on: true, since: day(ctx.now), url: (base || '') + '?crmcal=' + encodeURIComponent(token) };
}
const icsEsc = (s) => str(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** GET ?crmcal=<token> (index.ts): the open follow-ups and lead follow-ups as a calendar (.ics). */
export async function calFeed(deps, q, R) {
  const token = str(q.get('crmcal'));
  const biz = token.split('.')[0];
  if (!/^[0-9a-f-]{36}$/.test(biz)) return { status: 404, body: 'Not found' };
  const rows = await R.owners(deps.sql, [biz]);
  if (!rows.length) return { status: 404, body: 'Not found' };
  return R.asBusiness(deps, rows[0], 'crm:cal', async (ctx) => {
    const f = (await ctx.tx`select token_hash from crm_cal_feeds where business_id = ${ctx.biz}`)[0];
    if (!f || f.token_hash !== await sha(token)) return { status: 404, body: 'Not found' };
    const from = ymd(ctx.now.getTime() - 30 * 86400e3), to = ymd(ctx.now.getTime() + 180 * 86400e3);
    const ev = [];
    const one = (uid, d, title, desc) => {
      const a = d.replace(/-/g, ''), nx = new Date(d + 'T00:00:00Z'); nx.setUTCDate(nx.getUTCDate() + 1);
      ev.push(['BEGIN:VEVENT', 'UID:' + uid + '@erp', 'DTSTAMP:' + ctx.now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', 'DTSTART;VALUE=DATE:' + a, 'DTEND;VALUE=DATE:' + ymd(nx).replace(/-/g, ''),
               'SUMMARY:' + icsEsc(title), desc ? 'DESCRIPTION:' + icsEsc(desc) : '', 'END:VEVENT'].filter(Boolean).join('\r\n'));
    };
    for (const x of await ctx.tx`select id, customer, phone, due_on, note from customer_followups where business_id = ${ctx.biz} and status = 'open' and due_on >= ${from} and due_on <= ${to}`)
      one('fu-' + x.id, ymd(x.due_on), 'Follow up: ' + str(x.customer), str(x.note) + (x.phone ? '\n' + str(x.phone) : ''));
    for (const x of await ctx.tx`select id, name, company, phone, want, follow_up_on from inbox_leads where business_id = ${ctx.biz} and stage < 5 and follow_up_on >= ${from} and follow_up_on <= ${to}`)
      one('ld-' + x.id, ymd(x.follow_up_on), 'Lead: ' + (str(x.name) || str(x.company) || 'lead'), [str(x.want), str(x.phone)].filter(Boolean).join('\n'));
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Costareen ERP//crm-1//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + icsEsc((rows[0].name || 'ERP') + ' follow-ups'), ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
    return { status: 200, body };
  });
}

// ================================================================== the settings bundle + list decoration
export async function erpCrm(ctx) {
  await needOn(ctx);
  const own = roleAtLeast(ctx.s.role, 'owner'), mgr = roleAtLeast(ctx.s.role, 'manager');
  const out = { fields: (await fieldsOf(ctx, '')).map(fieldOut), companies: (await erpCrmCompanies(ctx)).companies, views: (await erpCrmViews(ctx, {})).views,
                stages: STAGES.slice(1), ops: OPS, kinds: EVENT_KINDS, acts: ACTS, own, mgr };
  if (own) { out.hide = await hideConfig(ctx); out.cal = await erpCrmCalLink(ctx, {}); out.hooks = (await erpCrmHooks(ctx)).hooks; out.rules = (await erpCrmRules(ctx)).rules; }
  if (mgr) out.binCount = (await ctx.tx`select count(*)::int n from crm_bin where business_id = ${ctx.biz} and restored_at is null`)[0].n;
  return out;
}
/** listview.js customers model: own fields (x_<key>) and the company on every row; hidden things masked for sales. */
export async function crmDecorate(ctx, rows) {
  try {
    if (await appIsOff(ctx.deps, ctx.sql, 'crm', ctx)) return rows;
    const cs = await ctx.tx`select c.phone, c.name, c.extra, c.company_id, k.name as company from customers c left join crm_companies k on k.id = c.company_id where c.business_id = ${ctx.biz}`;
    const by = new Map(); for (const c of cs) by.set(custKey(c.phone, c.name), c);
    const h = await hiddenFor(ctx);
    for (const r of rows) {
      const c = by.get(custKey(r.act ? r.act.phone : r.phone, r.act ? r.act.name : r.name));
      r.company = c && c.company ? str(c.company) : '';
      r.companyId = c && c.company_id ? c.company_id : '';
      const ex = (c && c.extra) || {};
      for (const k of Object.keys(ex)) if (!h.fields.includes(k)) r['x_' + k] = ex[k];
      if (h.base.length) { maskObj(r, h); if (r.act) maskObj(r.act, h); }
    }
  } catch (e) { console.error('crmDecorate', e && e.message); }
  return rows;
}

// ================================================================== hanging events + hiding on the existing handlers
export function wrapCrm(H) {
  const wrap = (name, fn) => { const old = H[name]; if (old) H[name] = (ctx, ...a) => fn(old, ctx, ...a); };
  const crmOn = async (ctx) => { try { return !(await appIsOff(ctx.deps, ctx.sql, 'crm', ctx)); } catch (_) { return false; } };
  wrap('erpSaveCustomer', async (old, ctx, data) => {
    const r = await old(ctx, data);
    if (await crmOn(ctx)) { const k = custKey(str(data && data.phone), str(data && data.name)); await emit(ctx, 'customer.saved', k, { key: k, name: str(data && data.name), phone: str(data && data.phone), new: !(data && data.row) }); }
    return r;
  });
  wrap('erpCreateInvoice', async (old, ctx, payload) => {
    const r = await old(ctx, payload);
    if (r && r.invoiceNo && await crmOn(ctx)) {
      const i = (await ctx.tx`select customer_name, customer_phone, grand_total, source from invoices where business_id = ${ctx.biz} and invoice_no = ${r.invoiceNo}`)[0] || {};
      const k = custKey(str(i.customer_phone), str(i.customer_name));
      await emit(ctx, 'invoice.created', r.invoiceNo, { invoiceNo: r.invoiceNo, key: k, name: str(i.customer_name), phone: str(i.customer_phone), total: Math.round(num(i.grand_total)), source: str(i.source) });
    }
    return r;
  });
  wrap('erpLeadUpsert', async (old, ctx, payload) => {
    const isNew = !(payload && payload.id);
    const r = await old(ctx, payload);
    if (isNew && r && r.id && await crmOn(ctx)) {
      const l = (await ctx.tx`select id, name, phone, source, kind from inbox_leads where id = ${r.id}`)[0] || {};
      await emit(ctx, 'lead.added', l.id, { id: l.id, name: str(l.name), phone: str(l.phone), source: str(l.source), kind: str(l.kind) });
    }
    return r;
  });
  wrap('erpLeadAct', async (old, ctx, payload) => {
    const before = (await ctx.tx`select stage, customer_id, supplier_id from inbox_leads where business_id = ${ctx.biz} and id = ${str(payload && payload.id)}`)[0];
    const r = await old(ctx, payload);
    if (before && await crmOn(ctx)) {
      const l = (await ctx.tx`select id, name, phone, stage, source, customer_id, supplier_id from inbox_leads where id = ${str(payload.id)}`)[0];
      if (l && l.stage !== before.stage) await emit(ctx, 'lead.stage', l.id, { id: l.id, name: str(l.name), phone: str(l.phone), stage: l.stage, stageName: STAGES[l.stage], was: STAGES[before.stage], source: str(l.source) });
      if (l && ((l.customer_id && !before.customer_id) || (l.supplier_id && !before.supplier_id))) await emit(ctx, 'lead.converted', l.id, { id: l.id, name: str(l.name), to: l.customer_id && !before.customer_id ? 'customer' : 'supplier' }, 1);
    }
    return r;
  });
  wrap('erpFollowupDone', async (old, ctx, payload) => {
    const f = (await ctx.tx`select customer_key, customer, phone, note from customer_followups where business_id = ${ctx.biz} and id::text = ${str(payload && payload.id)}`)[0];
    const r = await old(ctx, payload);
    if (f && await crmOn(ctx)) await emit(ctx, 'followup.done', f.customer_key, { key: f.customer_key, name: str(f.customer), phone: str(f.phone), note: str(f.note), outcome: str(payload && payload.outcome) });
    return r;
  });
  // G10: hide for salespeople; G5: the own fields and company on a customer's page and on leads
  wrap('erpCustomerPage', async (old, ctx, payload) => {
    const r = await old(ctx, payload);
    if (!(await crmOn(ctx))) return r;
    const c = await custRow(ctx, r.key);
    r.extra = (c && c.extra) || {};
    r.company = null;
    if (c && c.company_id) { const k = (await ctx.tx`select id, name from crm_companies where id = ${c.company_id}`)[0]; if (k) r.company = { id: k.id, name: k.name }; }
    const h = await hiddenFor(ctx);
    return h.base.length || h.fields.length ? maskObj(r, h) : r;
  });
  wrap('erpLeads', async (old, ctx, payload) => {
    const r = await old(ctx, payload);
    if (!(await crmOn(ctx)) || !r || !Array.isArray(r.leads) || !r.leads.length) return r;
    const ids = r.leads.map((l) => l.id).filter(Boolean);
    const ex = new Map(); for (const x of await ctx.tx`select id, extra from inbox_leads where business_id = ${ctx.biz} and id = any(${ids})`) ex.set(x.id, x.extra || {});
    const h = await hiddenFor(ctx);
    for (const l of r.leads) { l.extra = ex.get(l.id) || {}; if (h.base.length || h.fields.length) maskObj(l, h); }
    return r;
  });
}

export const HANDLERS = {
  erpCrm, erpCrmTimeline, erpCrmViews, erpCrmViewSave, erpCrmViewRemove, erpCrmFields, erpCrmFieldSave, erpCrmFieldRemove, erpCrmExtraSave,
  erpCrmCompanies, erpCrmCompany, erpCrmCompanySave, erpCrmCompanyLink, erpCrmDupes, erpCrmDupCheck, erpCrmDupeOk,
  erpCrmEvents, erpCrmHooks, erpCrmHookSave, erpCrmHookRemove, erpCrmHookTest, erpCrmRules, erpCrmRuleSave, erpCrmRuleRemove,
  erpCrmRemove, erpCrmBin, erpCrmRestore, erpCrmHideSet, erpCrmCalendar, erpCrmCalLink,
};
