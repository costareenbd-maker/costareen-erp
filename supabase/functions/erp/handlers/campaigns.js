// Group 'campaigns' - WhatsApp marketing (ERP.js:9632-10640, spec 04 A2).
//
// The sheet tabs CAMPAIGNS / CAMPAIGN_SENDS / CAMPAIGN_OPTOUT /
// CAMPAIGN_MESSAGES / CAMPAIGN_GROUPS / CAMPAIGN_LEADS are the 007 tables of
// the same name (row order = `seq`, added in 019). The spread state that the
// original kept in the project-wide ERP_CMP_STATE script property lives in
// campaigns.spread, per campaign and so per business (docs/fixes/campaigns.md).
//
// Evolution API (the owner's own WhatsApp server): secrets ERP_EVO_URL /
// ERP_EVO_INSTANCE / ERP_EVO_KEY / ERP_EVO_HOOK, every call through
// httpFetch. The gap between two messages is ctx.deps.sleep when present.

import { salesLog, customersTab, SL, CU, asDate, str } from '../lib/tabs.js';
import { formatDate, num } from '../lib/time.js';
import { phone11, custKey } from '../lib/phone.js';
import { getSecret, setSecret, getConfig, httpFetch, saveFile, fileUrl, readFile, findFiles, renderPdf } from '../lib/ext.js';
import { erpCatalog } from './catalog.js';
import { erpDues, who } from './money.js';

// ---------------------------------------------------------------- constants
export const ERP_LEAD_DAILY = 30;            // leads messaged in one day, at most
export const ERP_LEAD_REST_DAYS = 7;         // a lead is not messaged twice inside this many days
const ERP_LEAD_FOOTER = '\n\nReply STOP to stop these messages.';
const ERP_SPREAD_FROM = 10, ERP_SPREAD_TO = 20;
const ERP_SPREAD_EVERY_MIN = 10;
const ERP_SPREAD_PER_TICK = 3;
const ERP_SPREAD_FAILS = 3;
export const ERP_EVO_GAP_MS = 8000;          // between two people - throughput control, not a disguise
// Was 20 (20 x 8 s inside Google's 6 minutes). An Edge Function has ~150 s,
// so 12 x 8 s = 88 s plus the sends themselves (docs/fixes/campaigns.md).
export const ERP_EVO_BATCH = 12;
const DAY = 86400000;

const nowMs = (ctx) => ctx.now.getTime();
const sleep = (ctx, ms) => (ctx.deps && ctx.deps.sleep) ? ctx.deps.sleep(ms) : new Promise((r) => setTimeout(r, ms));
const whoIs = (ctx) => (ctx.as || who(ctx));

// ------------------------------------------------------------------ phones

/** erpWaNumber_ (ERP:9676): 8801XXXXXXXXX, a foreign number's digits, or ''. */
export function waNumber(phone) {
  const raw = String(phone == null ? '' : phone).trim();
  let d = raw.replace(/\D/g, '');
  if (raw.charAt(0) === '+' && d.indexOf('880') !== 0) return /^[1-9]\d{7,14}$/.test(d) ? d : '';
  if (d.length === 13 && d.indexOf('880') === 0) d = d.slice(3);
  else if (d.length === 12 && d.indexOf('88') === 0) d = d.slice(2);
  if (d.length === 10 && d.charAt(0) === '1') d = '0' + d;
  return /^01[3-9]\d{8}$/.test(d) ? '88' + d : '';
}

/** erpLeadKey_ (ERP:10333). */
function leadKey(phone, name) {
  const p = String(phone || '').trim();
  return p.charAt(0) === '+' ? 'i' + p.replace(/\D/g, '') : custKey(p, name);
}

/** erpAnyPhone_ (ERP:10342). */
function anyPhone(text, code) {
  let raw = String(text || '').trim(), d = raw.replace(/\D/g, '');
  let cc = String(code || '').replace(/\D/g, '');
  if (raw.charAt(0) === '+') { cc = ''; }
  else if (raw.indexOf('00') === 0 && d.length > 11) { d = d.slice(2); raw = '+' + d; cc = ''; }
  else if (cc && cc !== '880') { d = cc + d.replace(/^0+/, ''); raw = '+' + d; }
  if (raw.charAt(0) === '+' && d.indexOf('880') !== 0) {
    if (!/^[1-9]\d{7,14}$/.test(d)) throw new Error('not a full number with its country code');
    return '+' + d;
  }
  return phone11(d);
}

// ------------------------------------------------------------------- tables

async function optedMap(ctx) {
  const rows = await ctx.tx`select customer_key, reason from campaign_optouts
                            where business_id = ${ctx.biz} order by seq`;
  const m = {};
  for (const o of rows) if (o.customer_key) m[String(o.customer_key)] = String(o.reason || 'asked to stop');
  return m;
}

async function sendsAll(ctx) {
  return ctx.tx`select id, campaign_no, customer_key, customer, phone, status, updated_at, by
                from campaign_sends where business_id = ${ctx.biz} order by seq`;
}

/** erpLeadMap_: key -> lead (the last row wins, as the sheet's loop did). */
async function leadMap(ctx) {
  const rows = await ctx.tx`select id, lead_key, name, phone, source, note from campaign_leads
                            where business_id = ${ctx.biz} order by seq`;
  const map = {};
  for (const r of rows) {
    const k = String(r.lead_key || '');
    if (k) map[k] = { id: r.id, key: k, name: str0(r.name), phone: str0(r.phone), source: str0(r.source), note: str0(r.note) };
  }
  return map;
}
function str0(v) { return String(v == null ? '' : v); }

/** erpCustomerKeys_ (ERP:10365): keys of the customer list (not 'n:' ones). */
async function customerKeys(ctx) {
  const keys = {};
  for (const c of await customersTab(ctx)) {
    const k = custKey(str0(c[CU.contact_number]), str0(c[CU.customer_name]));
    if (k.indexOf('n:') !== 0) keys[k] = true;
  }
  return keys;
}

async function campaignRow(ctx, id) {
  const r = await ctx.tx`select * from campaigns where business_id = ${ctx.biz} and campaign_no = ${id}
                         order by seq desc limit 1`;
  return r[0] || null;
}

async function saveSpread(ctx, id, sp) {
  await ctx.tx`update campaigns set spread = ${sp === null ? null : ctx.tx.json(sp)}
               where business_id = ${ctx.biz} and campaign_no = ${id}`;
}

/** The business name for {business} and the product list: quotation profile name, else SETTINGS business_name, else the business. */
async function bizName(ctx) {
  try {
    const r = await ctx.tx`select value from quote_settings where business_id = ${ctx.biz} and key = 'profile'`;
    const n = r[0] && r[0].value && r[0].value.name;
    if (n) return String(n);
  } catch (_) { /* fall through */ }
  const c = String(await getConfig(ctx, 'business_name', '') || '').trim();
  return c || String((ctx.s && ctx.s.businessName) || '');
}

function html(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ------------------------------------------------------------------ audience

/** erpCampaignAudience (ERP:9687). */
export async function erpCampaignAudience(ctx) {
  const prods = await ctx.tx`select sku, category from products where business_id = ${ctx.biz} order by created_at, id`;
  const catOf = {};
  for (const p of prods) {
    const s = String(p.sku || '').trim().toLowerCase();
    if (s) catOf[s] = String(p.category || '').trim();
  }
  const bought = {}, now = nowMs(ctx);
  for (const row of await salesLog(ctx)) {
    const id = str(row[SL.order_id]);
    if (!id || /^RTN-/.test(id)) continue;
    const k = custKey(str0(row[SL.customer_contact]), str0(row[SL.customer_name]));
    if (!k || k.indexOf('n:') === 0) continue;
    const b = bought[k] || (bought[k] = { cats: {}, orders: {}, spent: 0, last: 0 });
    const c = catOf[str(row[SL.sku]).toLowerCase()];
    if (c) b.cats[c] = 1;
    b.orders[id] = 1;
    b.spent += num(row[SL.total]);
    const d = asDate(row[SL.timestamp]);
    if (d && d.getTime() > b.last) b.last = d.getTime();
  }
  const opted = await optedMap(ctx);
  const sends = await sendsAll(ctx);
  const lastMsg = {};
  for (const x of sends) {
    if (String(x.status) !== 'sent') continue;
    const t = x.updated_at instanceof Date ? x.updated_at.getTime() : 0;
    const k = String(x.customer_key);
    if (!lastMsg[k] || lastMsg[k] < t) lastMsg[k] = t;
  }
  let dues = {};
  try { dues = (await ctx.tx.savepoint(() => erpDues(ctx))).byKey || {}; } catch (_) { /* as original */ }

  let out = [];
  const seen = {};
  for (const cu of await customersTab(ctx)) {
    const name = str(cu[CU.customer_name]), phone = str(cu[CU.contact_number]);
    const wa = waNumber(phone);
    if (!wa) continue;
    const key = custKey(phone, name);
    if (seen[key]) continue;
    seen[key] = true;
    const bb = bought[key] || { cats: {}, orders: {}, spent: 0, last: 0 };
    out.push({ key, name, phone, wa,
               orders: Object.keys(bb.orders).length, spent: Math.round(bb.spent),
               daysSince: bb.last ? Math.floor((now - bb.last) / DAY) : null,
               cats: Object.keys(bb.cats), due: dues[key] ? dues[key].due : 0,
               optedOut: opted[key] || '', lastMessagedDays: lastMsg[key] ? Math.floor((now - lastMsg[key]) / DAY) : null });
  }
  out.sort((a, b) => b.spent - a.spent);
  const custSeen = {};
  Object.keys(seen).forEach((k) => { custSeen[k] = true; });
  Object.keys(bought).forEach((k) => { custSeen[k] = true; });
  // erpLeadAudience_ (ERP:10436)
  const map = await leadMap(ctx);
  for (const k of Object.keys(map)) {
    const l = map[k], wa = waNumber(l.phone);
    if (!wa || custSeen[k]) continue;
    out.push({ key: k, name: l.name, phone: l.phone, wa, orders: 0, spent: 0, daysSince: null, cats: [], due: 0,
               optedOut: opted[k] || '', lastMessagedDays: lastMsg[k] ? Math.floor((now - lastMsg[k]) / DAY) : null,
               lead: true, source: l.source, note: l.note });
  }
  const monthKey = formatDate(ctx.now, 'yyyy-MM');
  const stats = { sentMonth: 0, failedMonth: 0, stopped: Object.keys(opted).length };
  for (const x of sends) {
    if (!(x.updated_at instanceof Date) || formatDate(x.updated_at, 'yyyy-MM') !== monthKey) continue;
    if (String(x.status) === 'sent') stats.sentMonth++; else if (String(x.status) === 'failed') stats.failedMonth++;
  }
  const cats = Object.keys(catOf).map((x) => catOf[x]).filter((v, i, a) => v && a.indexOf(v) === i).sort();
  return { stats, saved: await campSaved(ctx), leadDaily: ERP_LEAD_DAILY, leadRestDays: ERP_LEAD_REST_DAYS,
           spreadFrom: ERP_SPREAD_FROM, spreadTo: ERP_SPREAD_TO, customers: out, categories: cats };
}

// ------------------------------------------------------------------ campaigns

/** erpCampaignCreate (ERP:9759). */
export async function erpCampaignCreate(ctx, payload) {
  payload = payload || {};
  const name = String(payload.name || '').trim().slice(0, 120) || ('Campaign ' + formatDate(ctx.now, 'd MMM yyyy'));
  const msg = String(payload.message || '');
  if (!msg.trim()) throw new Error('Write the message first.');
  if (msg.length > 20000) throw new Error('The message is too long.');
  const opted = await optedMap(ctx);
  const seen = {}, list = [];
  for (const r of (payload.recipients || [])) {
    if (!r) continue;
    const key = String(r.key || ''), wa = waNumber(r.phone);
    if (!key || !wa || seen[key] || opted[key]) continue;
    seen[key] = true;
    list.push(r);
  }
  if (!list.length) throw new Error('Choose at least one customer with a mobile number.');
  if (list.length > 2000) throw new Error('At most 2,000 customers in one campaign.');
  if (!(await sendLock(ctx, false))) throw new Error('Sheet is busy. Try again in a moment.');
  // CMP-yyMMdd-HHmmss; a second campaign in the same second gets -2, -3 (fix: the sheet gave both the same id)
  const base = 'CMP-' + formatDate(ctx.now, 'yyMMdd-HHmmss');
  let id = base;
  for (let n = 2; await campaignRow(ctx, id); n++) id = base + '-' + n;
  const now = ctx.now, by = whoIs(ctx);
  await ctx.tx`insert into campaigns (business_id, campaign_no, created_at, created_by, name, message, recipients)
               values (${ctx.biz}, ${id}, ${now}, ${by}, ${name}, ${msg.slice(0, 45000)}, ${list.length})`;
  const rows = list.map((r) => ({ business_id: ctx.biz, campaign_no: id, customer_key: String(r.key),
    customer: String(r.name || ''), phone: String(r.phone || ''), status: 'waiting', updated_at: now, by }));
  for (let i = 0; i < rows.length; i += 500) {
    await ctx.tx`insert into campaign_sends ${ctx.tx(rows.slice(i, i + 500), 'business_id', 'campaign_no', 'customer_key',
      'customer', 'phone', 'status', 'updated_at', 'by')}`;
  }
  return erpCampaignGet(ctx, { id });
}

/** erpCampaignGet (ERP:9795). */
export async function erpCampaignGet(ctx, payload) {
  const id = String((payload && payload.id) || '');
  const c = id ? await campaignRow(ctx, id) : null;
  if (!c) throw new Error('No such campaign.');
  const rows = await ctx.tx`select customer_key, customer, phone, status, updated_at, by from campaign_sends
                            where business_id = ${ctx.biz} and campaign_no = ${id} order by seq`;
  const recips = rows.map((r) => ({ key: str0(r.customer_key), name: str0(r.customer), phone: str0(r.phone), wa: waNumber(r.phone),
    status: str0(r.status), at: r.updated_at instanceof Date ? formatDate(r.updated_at, 'd MMM, h:mm a') : '', by: str0(r.by) }));
  const sp = c.spread || null;
  if (sp) {
    const lm = await leadMap(ctx), ck = await customerKeys(ctx);
    recips.forEach((x) => { if (lm[x.key] && !ck[x.key]) x.lead = true; });
  }
  return { id, name: str0(c.name), message: str0(c.message),
           created: c.created_at instanceof Date ? formatDate(c.created_at, 'd MMM yyyy, h:mm a') : '', by: str0(c.created_by),
           spread: sp ? { from: sp.from, to: sp.to, paused: !!sp.paused, why: String(sp.why || ''), leadDaily: ERP_LEAD_DAILY,
                          start: String(sp.start || ''), last: sp.last ? formatDate(new Date(sp.last), 'd MMM, h:mm a') : '' } : null,
           recipients: recips };
}

/** erpCampaignList (ERP:9816): newest first, at most 50. */
export async function erpCampaignList(ctx) {
  const cnt = await ctx.tx`select campaign_no, status, count(*)::int as n from campaign_sends
                           where business_id = ${ctx.biz} group by campaign_no, status`;
  const counts = {};
  for (const r of cnt) {
    const c = counts[r.campaign_no] || (counts[r.campaign_no] = { waiting: 0, sent: 0, skipped: 0, failed: 0 });
    c[String(r.status)] = (c[String(r.status)] || 0) + r.n;
  }
  const rows = await ctx.tx`select campaign_no, created_at, created_by, name, message, spread from campaigns
                            where business_id = ${ctx.biz} order by seq desc limit 50`;
  return rows.map((r) => {
    const sp = r.spread || null, msg = str0(r.message);
    return { id: str0(r.campaign_no), name: str0(r.name), by: str0(r.created_by),
             spread: !!sp, paused: !!(sp && sp.paused), startOn: String((sp && sp.start) || ''),
             created: r.created_at instanceof Date ? formatDate(r.created_at, 'd MMM yyyy') : '',
             auto: msg.indexOf('API:') === 0 || msg.indexOf('EVO:') === 0,
             counts: counts[r.campaign_no] || { waiting: 0, sent: 0, skipped: 0, failed: 0 } };
  });
}

/** erpCampaignMark (ERP:9835). */
export async function erpCampaignMark(ctx, payload) {
  payload = payload || {};
  const status = String(payload.status || '');
  if (!/^(sent|skipped|waiting)$/.test(status)) throw new Error('Unknown status.');
  const any = await ctx.tx`select 1 from campaign_sends where business_id = ${ctx.biz} limit 1`;
  if (!any.length) throw new Error('No such campaign.');
  const hit = await ctx.tx`select id from campaign_sends where business_id = ${ctx.biz}
                           and campaign_no = ${String(payload.id)} and customer_key = ${String(payload.key)}
                           order by seq limit 1`;
  if (!hit.length) throw new Error('That customer is not in this campaign.');
  await ctx.tx`update campaign_sends set status = ${status}, updated_at = ${ctx.now}, by = ${whoIs(ctx)} where id = ${hit[0].id}`;
  return { ok: true };
}

/** erpCampaignOptOut (ERP:9853). */
export async function erpCampaignOptOut(ctx, payload) {
  payload = payload || {};
  const key = String(payload.key || '');
  if (!key) throw new Error('Which customer?');
  if (payload.undo) {
    await ctx.tx`delete from campaign_optouts where business_id = ${ctx.biz} and customer_key = ${key}`;
    return { ok: true, optedOut: false };
  }
  await ctx.tx`insert into campaign_optouts (business_id, customer_key, customer, phone, opted_out_at, reason, by)
               values (${ctx.biz}, ${key}, ${String(payload.name || '')}, ${String(payload.phone || '')}, ${ctx.now},
                       ${String(payload.reason || 'asked to stop').slice(0, 200)}, ${whoIs(ctx)})`;
  // anyone still waiting in a campaign is taken off it (status only, as the sheet did)
  await ctx.tx`update campaign_sends set status = 'skipped'
               where business_id = ${ctx.biz} and customer_key = ${key} and status = 'waiting'`;
  return { ok: true, optedOut: true };
}

/** erpCampaignRetry (ERP:9980). */
export async function erpCampaignRetry(ctx, payload) {
  const id = String((payload && payload.id) || '');
  const any = await ctx.tx`select 1 from campaign_sends where business_id = ${ctx.biz} limit 1`;
  if (!any.length) throw new Error('No such campaign.');
  const n = await ctx.tx`update campaign_sends set status = 'waiting', updated_at = ${ctx.now}, by = ${whoIs(ctx)}
                         where business_id = ${ctx.biz} and campaign_no = ${id} and status = 'failed' returning id`;
  if (!n.length) throw new Error('Nobody in this campaign has failed.');
  const c = await campaignRow(ctx, id);
  if (c && c.spread) await saveSpread(ctx, id, { ...c.spread, paused: false, why: '', fails: 0 });
  return erpCampaignGet(ctx, { id });
}

/** erpCampaignPause (ERP:10475). */
export async function erpCampaignPause(ctx, payload) {
  const id = String((payload && payload.id) || '');
  const c = id ? await campaignRow(ctx, id) : null;
  if (!c || !c.spread) throw new Error('That campaign does not send itself.');
  const sp = { ...c.spread };
  sp.paused = !!(payload && payload.pause);
  sp.why = sp.paused ? 'Paused by ' + whoIs(ctx) + '.' : '';
  sp.fails = 0;
  await saveSpread(ctx, id, sp);
  return erpCampaignGet(ctx, { id });
}

// ------------------------------------------------------- saved messages / groups

async function campSaved(ctx) {
  const m = await ctx.tx`select message_no, name, text, attach from campaign_messages
                         where business_id = ${ctx.biz} order by seq`;
  const g = await ctx.tx`select group_no, name, filter from campaign_groups
                         where business_id = ${ctx.biz} order by seq`;
  return {
    messages: m.filter((r) => r.message_no).map((r) => ({ id: str0(r.message_no), name: str0(r.name), text: str0(r.text), attach: String(r.attach || 'none') })),
    groups: g.filter((r) => r.group_no).map((r) => ({ id: str0(r.group_no), name: str0(r.name),
      filter: (r.filter && typeof r.filter === 'object') ? r.filter : {} })),
  };
}

function shortId(prefix) {
  return prefix + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

/** erpCampMsgSave + erpCampKeep_ (ERP:9906-9936). */
export async function erpCampMsgSave(ctx, payload) {
  payload = payload || {};
  const text = String(payload.text || '');
  if (!payload.remove && !text.trim()) throw new Error('Write the message first.');
  if (text.length > 4000) throw new Error('The message is over 4,000 characters.');
  const att = /^(none|pdf|sheet)$/.test(String(payload.attach)) ? String(payload.attach) : 'none';
  const rows = await ctx.tx`select id, message_no, name from campaign_messages where business_id = ${ctx.biz} order by seq`;
  const id = String(payload.id || '');
  let at = -1;
  rows.forEach((r, i) => { if (id && String(r.message_no) === id) at = i; });
  if (payload.remove) {
    if (at < 0) throw new Error('That is no longer there.');
    await ctx.tx`delete from campaign_messages where id = ${rows[at].id}`;
    return campSaved(ctx);
  }
  const name = String(payload.name || '').trim().slice(0, 80);
  if (!name) throw new Error('Give it a name.');
  rows.forEach((r, j) => {
    if (j !== at && String(r.name || '').toLowerCase() === name.toLowerCase()) throw new Error('There is already one called ' + name + '.');
  });
  if (at < 0 && rows.length >= 100) throw new Error('A hundred is the limit. Delete one that is no longer used.');
  if (at < 0) {
    await ctx.tx`insert into campaign_messages (business_id, message_no, name, text, attach, updated_at, by)
                 values (${ctx.biz}, ${shortId('MSG-')}, ${name}, ${text}, ${att}, ${ctx.now}, ${whoIs(ctx)})`;
  } else {
    await ctx.tx`update campaign_messages set name = ${name}, text = ${text}, attach = ${att}, updated_at = ${ctx.now}, by = ${whoIs(ctx)}
                 where id = ${rows[at].id}`;
  }
  return campSaved(ctx);
}

/** erpCampGroupSave (ERP:9938). */
export async function erpCampGroupSave(ctx, payload) {
  payload = payload || {};
  const f = payload.filter || {}, clean = {};
  ['q', 'last', 'pattern', 'due', 'minSpent', 'skipRecent', 'who'].forEach((k) => { if (f[k] !== undefined) clean[k] = String(f[k]).slice(0, 80); });
  clean.cats = (Array.isArray(f.cats) ? f.cats : []).slice(0, 30).map((c) => String(c).slice(0, 80));
  const rows = await ctx.tx`select id, group_no, name from campaign_groups where business_id = ${ctx.biz} order by seq`;
  const id = String(payload.id || '');
  let at = -1;
  rows.forEach((r, i) => { if (id && String(r.group_no) === id) at = i; });
  if (payload.remove) {
    if (at < 0) throw new Error('That is no longer there.');
    await ctx.tx`delete from campaign_groups where id = ${rows[at].id}`;
    return campSaved(ctx);
  }
  const name = String(payload.name || '').trim().slice(0, 80);
  if (!name) throw new Error('Give the group a name.');
  rows.forEach((r, j) => {
    if (j !== at && String(r.name || '').toLowerCase() === name.toLowerCase()) throw new Error('There is already a group called ' + name + '.');
  });
  if (at < 0 && rows.length >= 100) throw new Error('A hundred groups is the limit. Delete one that is no longer used.');
  if (at < 0) {
    await ctx.tx`insert into campaign_groups (business_id, group_no, name, filter, updated_at, by)
                 values (${ctx.biz}, ${shortId('GRP-')}, ${name}, ${ctx.tx.json(clean)}, ${ctx.now}, ${whoIs(ctx)})`;
  } else {
    await ctx.tx`update campaign_groups set name = ${name}, filter = ${ctx.tx.json(clean)}, updated_at = ${ctx.now}, by = ${whoIs(ctx)}
                 where id = ${rows[at].id}`;
  }
  return campSaved(ctx);
}

// --------------------------------------------------------------------- leads

/** erpLeadsAdd (ERP:10377). */
export async function erpLeadsAdd(ctx, payload) {
  payload = payload || {};
  const source = String(payload.source || '').trim().slice(0, 60), note = String(payload.note || '').trim().slice(0, 200);
  let lines = String(payload.text || '').split(/\r?\n/).map((x) => x.trim()).filter((x) => x);
  const one = payload.one || null;
  if (one) {
    if (!String(one.phone || '').trim()) throw new Error('Type the phone number.');
    lines = ['\u0001'];
  }
  if (!lines.length) throw new Error('Paste at least one number.');
  if (lines.length > 500) throw new Error('At most 500 at a time.');
  const have = await leadMap(ctx), cust = await customerKeys(ctx), add = [], skipped = [], by = whoIs(ctx);
  for (let line of lines) {
    let phone = '', name = '';
    if (one) {
      line = String(one.name || '').trim() + ' ' + String(one.phone || '').trim();
      try { phone = anyPhone(one.phone, one.code); } catch (_) {
        throw new Error('That phone number cannot be used: ' + String(one.phone) + '. At home it is 11 digits starting 01; abroad, the country code and the full number.');
      }
      name = String(one.name || '').trim().slice(0, 80);
    } else {
      const m = /[+0-9][0-9 ()\-]{7,}/.exec(line);
      if (!m) { skipped.push({ line, why: 'no phone number in it' }); continue; }
      try { phone = anyPhone(m[0], ''); } catch (_) { skipped.push({ line, why: 'not an 11-digit mobile number, nor a number with a country code (+…)' }); continue; }
      name = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).replace(/[,;|\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    }
    const key = leadKey(phone, name);
    if (cust[key]) { skipped.push({ line, why: 'already a customer' }); continue; }
    if (have[key]) { skipped.push({ line, why: 'already a lead' }); continue; }
    have[key] = { key };
    add.push({ business_id: ctx.biz, lead_key: key, name, phone, source, note, added_at: ctx.now, by });
  }
  if (add.length) {
    await ctx.tx`insert into campaign_leads ${ctx.tx(add, 'business_id', 'lead_key', 'name', 'phone', 'source', 'note', 'added_at', 'by')}`;
  }
  if (one && skipped.length) throw new Error(String(one.phone) + ' is ' + skipped[0].why + '.');
  return { added: add.length, skipped };
}

/** erpLeadSave (ERP:9967): name, source and note (a missing note is written blank, as the sheet did). */
export async function erpLeadSave(ctx, payload) {
  payload = payload || {};
  const hit = (await leadMap(ctx))[String(payload.key || '')];
  if (!hit) throw new Error('That lead is no longer on the list.');
  await ctx.tx`update campaign_leads set name = ${String(payload.name || '').trim().slice(0, 80)},
                 source = ${String(payload.source || '').trim().slice(0, 60)}, note = ${String(payload.note || '').trim().slice(0, 200)}
               where id = ${hit.id}`;
  return { ok: true };
}

/** erpLeadRemove (ERP:10425). */
export async function erpLeadRemove(ctx, payload) {
  const key = String((payload && payload.key) || ''), hit = (await leadMap(ctx))[key];
  if (!hit) throw new Error('That lead is no longer on the list.');
  await ctx.tx`delete from campaign_leads where id = ${hit.id}`;
  return { ok: true };
}

// ------------------------------------------------------------ product lists

function productPick(cat, payload) {
  const cats = Array.isArray(payload.cats) ? payload.cats : [];
  const stockOnly = payload.stockOnly !== false;
  return cat.filter((p) => {
    if (String(p.status || '').toLowerCase() === 'discontinued') return false;
    if (stockOnly && !(p.stock > 0)) return false;
    if (cats.length && cats.indexOf(p.cat) < 0) return false;
    return true;
  });
}

/** erpWaProductPdf (ERP:10023): the product list as a PDF in 'assets'. */
export async function erpWaProductPdf(ctx, payload) {
  payload = payload || {};
  const prices = payload.prices !== false;
  const by = {};
  for (const p of productPick(await erpCatalog(ctx), payload)) (by[p.cat || 'Other'] = by[p.cat || 'Other'] || []).push(p);
  const biz = await bizName(ctx);
  const today = formatDate(ctx.now, 'd MMMM yyyy');
  let h = '<html><body style="font-family:Arial,sans-serif;font-size:11px;color:#111">' +
    '<h2 style="margin:0">' + html(biz) + '</h2><div style="margin:2px 0 12px;color:#666">Available products · ' + today + '</div>';
  Object.keys(by).sort().forEach((c) => {
    h += '<h3 style="margin:14px 0 6px">' + html(c) + '</h3><table width="100%" cellpadding="4" cellspacing="0" border="1" style="border-collapse:collapse">' +
      by[c].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((p) =>
        '<tr><td>' + html(p.name) + '</td>' + (prices ? '<td align="right" width="90">' + (p.sell ? Math.round(p.sell) : '') + '</td>' : '') + '</tr>').join('') + '</table>';
  });
  h += '</body></html>';
  const name = (biz || 'Products').replace(/[^\w\- ]+/g, '') + ' - available products ' + formatDate(ctx.now, 'yyyy-MM-dd') + '.pdf';
  const bytes = await renderPdf(ctx, h);
  const f = await saveFile(ctx, 'assets', name, bytes, 'application/pdf');
  return { fileId: f.id, url: f.url, name, products: Object.keys(by).reduce((n, c) => n + by[c].length, 0) };
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * erpProductListShare (ERP:10583). kind 'pdf' as erpWaProductPdf; kind
 * 'sheet' was a new Google Sheet - there is none now, so it is a CSV file
 * (same columns, same order) in 'assets' (docs/fixes/campaigns.md).
 */
export async function erpProductListShare(ctx, payload) {
  payload = payload || {};
  if (payload.kind !== 'sheet') {
    const pdf = await erpWaProductPdf(ctx, payload);
    return { kind: 'pdf', fileId: pdf.fileId, name: pdf.name, products: pdf.products, url: pdf.url };
  }
  const prices = payload.prices !== false;
  const rows = productPick(await erpCatalog(ctx), payload).map((p) => [p.cat || '', p.name, p.brand || '', prices ? (p.sell || '') : '']);
  rows.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const biz = await bizName(ctx);
  const name = (biz || 'Products') + ' - available products ' + formatDate(ctx.now, 'yyyy-MM-dd');
  const head = prices ? ['Category', 'Product', 'Brand', 'Price (BDT)'] : ['Category', 'Product', 'Brand'];
  const lines = [head].concat(rows.map((r) => (prices ? r : r.slice(0, 3)))).map((r) => r.map(csvCell).join(','));
  const bytes = new TextEncoder().encode('﻿' + lines.join('\r\n') + '\r\n');
  const file = name.replace(/[^\w\- ]+/g, '') + '.csv';
  const f = await saveFile(ctx, 'assets', file, bytes, 'text/csv');
  return { kind: 'sheet', fileId: f.id, name, products: rows.length, url: f.url };
}

/** A file id from saveFile -> where it lives. Only 'assets' may be shared or sent. */
function assetRef(fileId) {
  const s = String(fileId || '');
  const i = s.indexOf('/');
  const ref = i > 0 ? { folder: s.slice(0, i), name: s.slice(i + 1) } : { folder: 'assets', name: s };
  if (ref.folder !== 'assets' || !ref.name || ref.name.indexOf('..') >= 0) throw new Error('That file is no longer there.');
  return ref;
}
const UPLOAD_TAG = /^u\d{12}[0-9a-f]{4}-/;

/** erpShareFile (ERP:10629): a link to an uploaded file. */
export async function erpShareFile(ctx, payload) {
  const id = String((payload && payload.fileId) || '');
  if (!id) throw new Error('Which file?');
  const ref = assetRef(id);
  const hit = (await findFiles(ctx, 'assets', ref.name)).find((f) => f.name === ref.name);
  if (!hit) throw new Error('That file is no longer there.');
  return { fileId: id, name: ref.name.replace(UPLOAD_TAG, ''), url: hit.url || await fileUrl(ctx, 'assets', ref.name) };
}

function b64decode(s) {
  const bin = atob(String(s || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** erpEvoUpload (ERP:10157): a PDF/PNG/JPEG up to 10 MB, kept in 'assets'. */
export async function erpEvoUpload(ctx, payload) {
  const mime = String((payload && payload.mime) || '');
  if (!/^(application\/pdf|image\/(png|jpeg))$/.test(mime)) throw new Error('Attach a PDF, PNG or JPEG.');
  let bytes;
  try { bytes = b64decode(payload.data); } catch (_) { throw new Error('The file could not be read.'); }
  if (bytes.length > 10 * 1024 * 1024) throw new Error('The file is over 10 MB.');
  const shown = String(payload.name || 'file').replace(/[\\/]+/g, '_').slice(0, 120) || 'file';
  // Drive kept two files of one name apart; storage would overwrite, so each upload gets its own tag
  const tag = 'u' + formatDate(ctx.now, 'yyMMddHHmmss') + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 4);
  const f = await saveFile(ctx, 'assets', tag + '-' + shown, bytes, mime);
  return { fileId: f.id, name: shown, mime };
}

// ------------------------------------------------------------- Evolution API

async function evoKeys(ctx) {
  if (!ctx.memo.evoKeys) {
    ctx.memo.evoKeys = { url: await getSecret(ctx, 'ERP_EVO_URL'), instance: await getSecret(ctx, 'ERP_EVO_INSTANCE'),
                         key: await getSecret(ctx, 'ERP_EVO_KEY') };
  }
  return ctx.memo.evoKeys;
}

/** erpEvoCall_ (ERP:10098). A host that cannot be reached throws, as UrlFetchApp did. */
export async function evoCall(ctx, method, path, body) {
  const k = await evoKeys(ctx);
  if (!k.url || !k.instance || !k.key) throw new Error('Evolution API is not connected for this business. Settings → WhatsApp.');
  const headers = { apikey: k.key };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await httpFetch(ctx, k.url + path + '/' + encodeURIComponent(k.instance), { method, headers, body: body || undefined });
  if (r.code === 0) throw new Error(r.text || 'no answer');
  return { code: r.code, json: (r.json && typeof r.json === 'object') ? r.json : {}, text: String(r.text || '').slice(0, 300) };
}

/** erpEvoStatus (ERP:10110): never returns the key. */
export async function erpEvoStatus(ctx) {
  const k = await evoKeys(ctx);
  const out = { configured: !!(k.url && k.instance && k.key), url: k.url, instance: k.instance, hasKey: !!k.key, state: '',
                stopHook: !!(await getSecret(ctx, 'ERP_EVO_HOOK')) };
  if (!out.configured) return out;
  try {
    const r = await evoCall(ctx, 'GET', '/instance/connectionState', null);
    if (r.code === 401 || r.code === 403) out.error = 'The server refused the API key.';
    else if (r.code === 404) out.error = 'The server has no instance called "' + k.instance + '".';
    else if (r.code !== 200) out.error = 'The server answered ' + r.code + '.';
    else out.state = String((r.json.instance && r.json.instance.state) || r.json.state || '');
    out.connected = out.state === 'open';
    if (!out.error && !out.connected) { out.needsLink = true; out.error = 'The server is set up, but no WhatsApp number is linked to it yet.'; }
  } catch (e) { out.error = 'The server could not be reached: ' + e.message; }
  return out;
}

/** erpEvoSetup (ERP:10078). */
export async function erpEvoSetup(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can connect Evolution API.');
  payload = payload || {};
  delete ctx.memo.evoKeys;
  if (payload.clear) {
    for (const x of ['URL', 'INSTANCE', 'KEY']) await setSecret(ctx, 'ERP_EVO_' + x, '');
    return { configured: false };
  }
  const url = String(payload.url || '').trim().replace(/\/+$/, '');
  const inst = String(payload.instance || '').trim();
  if (url && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(url)) throw new Error('The server address should look like https://wa.example.com');
  if (inst && !/^[\w.-]{1,80}$/.test(inst)) throw new Error('The instance name: letters, numbers, - _ . only.');
  if (url) await setSecret(ctx, 'ERP_EVO_URL', url);
  if (inst) await setSecret(ctx, 'ERP_EVO_INSTANCE', inst);
  if (payload.key) await setSecret(ctx, 'ERP_EVO_KEY', String(payload.key).trim());
  return erpEvoStatus(ctx);
}

/** erpEvoQr (ERP:10134). */
export async function erpEvoQr(ctx) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can link a WhatsApp number.');
  const st = await erpEvoStatus(ctx);
  if (st.connected) return { connected: true };
  const r = await evoCall(ctx, 'GET', '/instance/connect', null);
  if (r.code !== 200) throw new Error('The server did not give a QR code (' + r.code + ').');
  let b = String(r.json.base64 || '');
  if (b && b.indexOf('data:image') !== 0) b = 'data:image/png;base64,' + b;
  return { connected: false, qr: b };
}

/** erpEvoLogout (ERP:10148). */
export async function erpEvoLogout(ctx) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can do that.');
  await evoCall(ctx, 'DELETE', '/instance/logout', null);
  return erpEvoStatus(ctx);
}

async function loadMedia(ctx, att) {
  const ref = assetRef(att.fileId);
  const bytes = await readFile(ctx, ref.folder, ref.name);
  if (!bytes) throw new Error('The attached file is no longer there: ' + String(att.name || ref.name) + '.');
  return { base64: b64encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
           mime: String(att.mime || 'application/pdf'), name: String(att.name || 'file') };
}

function evoWhy(r) {
  return (r.json.response && JSON.stringify(r.json.response.message || r.json.response)) || r.json.message || r.text;
}

/** erpEvoSendTest (ERP:9998). */
export async function erpEvoSendTest(ctx, payload) {
  payload = payload || {};
  const wa = waNumber(payload.phone);
  if (!wa) throw new Error('The test number must be an 11-digit mobile number, or a number abroad written with + and its country code.');
  const text = String(payload.text || '');
  if (!text.trim()) throw new Error('Write the message first.');
  if (text.length > 4000) throw new Error('The message is over 4,000 characters.');
  const st = await erpEvoStatus(ctx);
  if (!st.connected) throw new Error(st.error || 'Evolution API is not ready.');
  const att = payload.attach && payload.attach.fileId ? payload.attach : null;
  let r;
  if (att) {
    const m = await loadMedia(ctx, att);
    r = await evoCall(ctx, 'POST', '/message/sendMedia', { number: wa, mediatype: /^image/.test(m.mime) ? 'image' : 'document', mimetype: m.mime,
                      caption: text, media: m.base64, fileName: m.name });
  } else r = await evoCall(ctx, 'POST', '/message/sendText', { number: wa, text });
  if (r.code !== 200 && r.code !== 201) throw new Error('It did not go: ' + String(evoWhy(r) || r.code).slice(0, 200));
  return { ok: true, to: wa };
}

/** erpEvoCampaignStart (ERP:10175). */
export async function erpEvoCampaignStart(ctx, payload) {
  payload = payload || {};
  const k = await evoKeys(ctx);
  if (!k.url || !k.instance || !k.key) throw new Error('Evolution API is not connected for this business. Settings → WhatsApp.');
  const text = String(payload.text || '');
  if (!text.trim()) throw new Error('Write the message first.');
  if (text.length > 4000) throw new Error('The message is over 4,000 characters. Shorten it or send the product list as a PDF.');
  const att = payload.attach && payload.attach.fileId
    ? { fileId: String(payload.attach.fileId), name: String(payload.attach.name || 'file'), mime: String(payload.attach.mime || 'application/pdf') } : null;
  const spec = { evo: true, text, attach: att };
  const leads = await leadMap(ctx), cust = await customerKeys(ctx);
  let hasLead = false;
  (payload.recipients || []).forEach((r) => { const rk = String((r && r.key) || ''); if (leads[rk] && !cust[rk]) hasLead = true; });
  const startOn = String(payload.startOn || '').trim();
  if (startOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn)) throw new Error('The start date should look like 2026-10-05.');
    if (startOn < formatDate(ctx.now, 'yyyy-MM-dd')) throw new Error('The start date has already passed.');
  }
  const spread = !!payload.spread || hasLead || !!startOn;
  let made = await erpCampaignCreate(ctx, { name: payload.name, message: 'EVO:' + JSON.stringify(spec), recipients: payload.recipients });
  if (spread) {
    await saveSpread(ctx, made.id, { from: ERP_SPREAD_FROM, to: ERP_SPREAD_TO, paused: false, why: '', fails: 0, last: 0, start: startOn });
    made = await erpCampaignGet(ctx, { id: made.id });
  }
  return made;
}

/** erpEvoSendBatch (ERP:10206). The page asks for 25; the server decides (was 20, now 12). */
export async function erpEvoSendBatch(ctx, payload) {
  const id = String((payload && payload.id) || '');
  const c = id ? await campaignRow(ctx, id) : null;
  if (c && c.spread) throw new Error('This campaign sends itself through the day. Pause or resume it instead.');
  return sendCore(ctx, id, ERP_EVO_BATCH, whoIs(ctx), false);
}

/** The script lock: the timer gives up at once (busy), a person waits up to 20 s. */
async function sendLock(ctx, timer) {
  const key = ctx.biz + ':campaign';
  const tryIt = async () => (await ctx.tx`select pg_try_advisory_xact_lock(hashtext(${key})) as ok`)[0].ok;
  if (await tryIt()) return true;
  if (timer) return false;
  for (let waited = 0; waited < 20000; waited += 500) {
    await sleep(ctx, 500);
    if (await tryIt()) return true;
  }
  return false;
}

/** erpEvoSendCore_ (ERP:10222): for a person and for the timer alike. */
export async function sendCore(ctx, id, max, by, timer) {
  const camp = id ? await campaignRow(ctx, id) : null;
  if (!camp) throw new Error('No such campaign.');
  const msg = str0(camp.message);
  if (msg.indexOf('EVO:') !== 0) throw new Error('This campaign is not sent through Evolution API.');
  const spec = JSON.parse(msg.slice(4));
  const st = await erpEvoStatus(ctx);
  if (!st.connected) throw new Error(st.error || 'Evolution API is not ready.');
  const media = spec.attach ? await loadMedia(ctx, spec.attach) : null;
  const opted = await optedMap(ctx);
  const leads = await leadMap(ctx), cust = await customerKeys(ctx);
  const isLead = (key) => !!leads[key] && !cust[key];

  if (!(await sendLock(ctx, timer))) {
    if (timer) return { sent: 0, failed: 0, left: 0, errors: [], stopped: false, trail: 0, busy: true };
    throw new Error('Another batch is still sending. Wait a moment.');
  }
  const v = await sendsAll(ctx);
  const t0 = Date.now();
  const at = () => new Date(nowMs(ctx) + (Date.now() - t0));
  const today = formatDate(ctx.now, 'yyyy-MM-dd'), lastLead = {}, startMs = nowMs(ctx);
  let leadToday = 0;
  for (const a of v) {
    if (String(a.status) !== 'sent' || !(a.updated_at instanceof Date) || !isLead(String(a.customer_key))) continue;
    if (formatDate(a.updated_at, 'yyyy-MM-dd') === today) leadToday++;
    const k = String(a.customer_key);
    if (!lastLead[k] || lastLead[k] < a.updated_at.getTime()) lastLead[k] = a.updated_at.getTime();
  }
  const mark = (row, status, byText) => ctx.tx`update campaign_sends set status = ${status}, updated_at = ${at()}, by = ${byText} where id = ${row.id}`;
  let sent = 0, failed = 0, done = 0, stopped = false, trail = 0, leadHeld = 0;
  const errors = [];
  for (let i = 0; i < v.length && done < max; i++) {
    const row = v[i];
    if (String(row.campaign_no) !== id || String(row.status) !== 'waiting') continue;
    const key = String(row.customer_key), wa = waNumber(row.phone), lead = isLead(key);
    if (opted[key] || !wa) { await mark(row, 'skipped', by); continue; }
    if (lead && lastLead[key] && startMs - lastLead[key] < ERP_LEAD_REST_DAYS * DAY) {
      await mark(row, 'skipped', by + ' · messaged in the last ' + ERP_LEAD_REST_DAYS + ' days'); continue;
    }
    if (lead && leadToday >= ERP_LEAD_DAILY) { leadHeld++; continue; }
    if (done > 0) await sleep(ctx, ERP_EVO_GAP_MS);
    done++;
    let text = String(spec.text).replace(/\{name\}/g, str0(row.customer).trim()).replace(/ ,/g, ',');
    if (lead && text.indexOf(ERP_LEAD_FOOTER.trim()) < 0) text += ERP_LEAD_FOOTER;
    let r;
    try {
      r = media
        ? await evoCall(ctx, 'POST', '/message/sendMedia', { number: wa, mediatype: /^image/.test(media.mime) ? 'image' : 'document',
            mimetype: media.mime, caption: text, media: media.base64, fileName: media.name })
        : await evoCall(ctx, 'POST', '/message/sendText', { number: wa, text });
    } catch (e) { r = { code: 0, json: {}, text: e.message }; }
    if (r.code === 200 || r.code === 201) {
      const mid = (r.json.key && r.json.key.id) || '';
      await mark(row, 'sent', by + (mid ? ' · ' + mid : ''));
      sent++; trail = 0;
      if (lead) { leadToday++; lastLead[key] = startMs; }
    } else {
      const why = evoWhy(r) || ('the server answered ' + r.code);
      await mark(row, 'failed', by + ' · ' + String(why).slice(0, 200));
      failed++; trail++;
      if (errors.length < 5) errors.push(String(row.customer || row.phone) + ': ' + why);
      if (r.code === 0 || r.code === 401 || r.code === 403 || r.code >= 500 || /closed|disconnect|logged out|not connected/i.test(String(why))) {
        errors.push('Stopped: ' + why); stopped = true; break;
      }
    }
  }
  if (!timer && !done && leadHeld) { stopped = true; errors.push('Today\'s ' + ERP_LEAD_DAILY + ' leads have been messaged. The rest wait for tomorrow.'); }
  const left = (await ctx.tx`select count(*)::int as n from campaign_sends where business_id = ${ctx.biz}
                             and campaign_no = ${id} and status = 'waiting'`)[0].n;
  return { sent, failed, left, errors, stopped, trail, leadHeld };
}

// --------------------------------------------------------- the spread timer

/**
 * erpCampaignTick (ERP:10494), for ctx's business. Called by the scheduler
 * (pg_cron, every 10 min) once per business that has spread campaigns
 * waiting - see spreadBusinesses(). Never throws for one campaign's trouble.
 */
export async function campaignTick(ctx) {
  const rows = await ctx.tx`select campaign_no, spread from campaigns
                            where business_id = ${ctx.biz} and spread is not null order by seq`;
  const wait = await ctx.tx`select campaign_no, count(*)::int as n from campaign_sends
                            where business_id = ${ctx.biz} and status = 'waiting' group by campaign_no`;
  const waiting = {};
  for (const w of wait) waiting[w.campaign_no] = w.n;
  if (!rows.some((r) => waiting[r.campaign_no] > 0)) return { done: true };
  const live = rows.filter((r) => waiting[r.campaign_no] > 0 && !r.spread.paused);
  const hm = formatDate(ctx.now, 'HH:mm').split(':');
  const hour = Number(hm[0]) + Number(hm[1]) / 60, today = formatDate(ctx.now, 'yyyy-MM-dd');
  let sentAll = 0;
  for (const c of live) {
    const id = c.campaign_no;
    let s = c.spread;
    const from = s.from || ERP_SPREAD_FROM, to = s.to || ERP_SPREAD_TO;
    if (hour < from || hour >= to) continue;
    if (s.start && today < s.start) continue;
    const gapMin = Math.min(60, (to - hour) * 60 / waiting[id]);
    if (s.last && nowMs(ctx) - s.last < gapMin * 60000 * 0.9) continue;
    const ticksLeft = Math.max(1, Math.floor((to - hour) * 60 / ERP_SPREAD_EVERY_MIN));
    const n = Math.min(ERP_SPREAD_PER_TICK, Math.max(1, Math.ceil(waiting[id] / ticksLeft)));
    const t0 = Date.now();
    let r;
    try { r = await ctx.tx.savepoint(() => sendCore(ctx, id, n, 'Timer', true)); }
    catch (e) { r = { sent: 0, failed: 0, stopped: true, errors: [String((e && e.message) || e)], trail: 0 }; }
    sentAll += r.sent;
    const again = await campaignRow(ctx, id);
    s = { ...((again && again.spread) || s) };
    if (r.busy) continue;
    if (r.sent + r.failed > 0) s.fails = (r.trail === r.sent + r.failed) ? (s.fails || 0) + r.trail : r.trail;
    if (r.stopped) {
      s.paused = true;
      s.why = 'Stopped by itself: ' + String(r.errors[r.errors.length - 1] || 'the WhatsApp server did not answer').replace(/^Stopped: /, '').slice(0, 200);
    } else if ((s.fails || 0) >= ERP_SPREAD_FAILS) {
      s.paused = true;
      s.why = 'Stopped by itself: ' + s.fails + ' messages in a row failed. Last: ' + String(r.errors[r.errors.length - 1] || '').slice(0, 160);
    }
    s.last = nowMs(ctx) + (Date.now() - t0);
    await saveSpread(ctx, id, s);
  }
  return { sent: sentAll };
}

/** The businesses the timer has work for (privileged connection: it runs as nobody). */
export async function spreadBusinesses(sql) {
  const r = await sql`select distinct c.business_id from campaigns c
                      join campaign_sends s on s.business_id = c.business_id and s.campaign_no = c.campaign_no
                      where c.spread is not null and s.status = 'waiting'`;
  return r.map((x) => x.business_id);
}

// ------------------------------------------------------------ STOP replies

const STOP_WORDS = ['stop', 'unsubscribe', 'stop it', 'বন্ধ', 'বন্ধ করুন'];

/**
 * erpWaHook_ (ERP:10532): Evolution reports a message that came in. Only a
 * reply that is the word STOP is acted on. `query.hook` must equal the
 * business's ERP_EVO_HOOK secret.
 */
export async function waHook(ctx, body, query) {
  const want = await getSecret(ctx, 'ERP_EVO_HOOK');
  const got = String((query && query.hook) || '');
  if (!want || got !== want) return { ok: false };
  body = body || {};
  if (String(body.event || '').toLowerCase().replace(/_/g, '.') !== 'messages.upsert') return { ok: true };
  const d = body.data || {}, key = d.key || {};
  if (key.fromMe) return { ok: true };
  const jid = String(key.senderPn || key.remoteJidAlt || key.remoteJid || '');
  if (!/@s\.whatsapp\.net$/.test(jid)) return { ok: true };
  const m = d.message || {};
  const text = String(m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) || '').trim().toLowerCase().replace(/[.!\s]+$/, '');
  if (STOP_WORDS.indexOf(text) < 0) return { ok: true };
  const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, ''), wa = waNumber(digits);
  if (!wa && !/^[1-9]\d{7,14}$/.test(digits)) return { ok: true };
  const phone = wa ? wa.slice(2) : '+' + digits, ck = wa ? custKey(phone, '') : 'i' + digits;
  const opted = await optedMap(ctx);
  if (opted[ck] !== undefined) return { ok: true, stopped: true };
  const lead = (await leadMap(ctx))[ck];
  await erpCampaignOptOut({ ...ctx, as: 'WhatsApp reply' },
    { key: ck, name: lead ? lead.name : String(d.pushName || '').slice(0, 60), phone, reason: 'replied STOP' });
  return { ok: true, stopped: true };
}

/** Where Evolution should report incoming messages for this business. */
function hookBase(ctx) {
  if (ctx.deps && ctx.deps.hookBase) return String(ctx.deps.hookBase);
  const env = globalThis.Deno && globalThis.Deno.env ? globalThis.Deno.env.get('SUPABASE_URL') : '';
  return env ? env.replace(/\/+$/, '') + '/functions/v1/erp' : '';
}

/** erpEvoStopHook (ERP:10558). */
export async function erpEvoStopHook(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can change this.');
  const base = hookBase(ctx);
  if (!base) throw new Error('The web address for STOP replies is not known.');
  const on = !(payload && payload.off);
  const url = base + '?biz=' + encodeURIComponent(ctx.biz);
  if (!on) {
    await evoCall(ctx, 'POST', '/webhook/set', { webhook: { enabled: false, url, events: ['MESSAGES_UPSERT'] } });
    await setSecret(ctx, 'ERP_EVO_HOOK', '');
    return erpEvoStatus(ctx);
  }
  const word = (globalThis.crypto.randomUUID() + globalThis.crypto.randomUUID()).replace(/-/g, '');
  const r = await evoCall(ctx, 'POST', '/webhook/set', { webhook: { enabled: true, url: url + '&hook=' + word,
    byEvents: false, base64: false, events: ['MESSAGES_UPSERT'] } });
  if (r.code !== 200 && r.code !== 201) throw new Error('The WhatsApp server would not take it (' + r.code + '): ' + r.text);
  await setSecret(ctx, 'ERP_EVO_HOOK', word);
  return erpEvoStatus(ctx);
}

export const HANDLERS = {
  erpCampaignAudience, erpCampaignList, erpCampaignGet, erpCampaignCreate, erpCampaignMark,
  erpCampaignOptOut, erpCampaignRetry, erpCampaignPause, erpCampMsgSave, erpCampGroupSave,
  erpLeadsAdd, erpLeadSave, erpLeadRemove, erpWaProductPdf, erpProductListShare, erpShareFile,
  erpEvoUpload, erpEvoStatus, erpEvoSetup, erpEvoQr, erpEvoLogout, erpEvoStopHook,
  erpEvoCampaignStart, erpEvoSendBatch, erpEvoSendTest,
};
