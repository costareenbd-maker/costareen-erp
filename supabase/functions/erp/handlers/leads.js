// leads-1 (owner 22 Oct 2026): "a Leads menu - different kinds of leads from different sources: Google, LinkedIn,
// Facebook comments and all the possible sources, of both customers and suppliers".
//
// One list (the Inbox's inbox_leads, 137 adds kind / company / links / source_ref) fed four ways:
//   auto    - brought in from inside the ERP: Facebook / Instagram comments asking a price, warm chats that did not order
//             (Messenger, Instagram, WhatsApp, website chat, e-mail), unfinished landing-page orders, print quote
//             requests, buyers' "wanted" posts on the platform market            (erpLeadHarvest)
//   find    - searched outside: map listings (OpenStreetMap, free) and Google through the AI with Google Search
//             (needs the AI key)                                                   (erpLeadFind -> erpLeadUpsert)
//   paste   - a LinkedIn profile, a Facebook post, a Google Maps listing, an Alibaba / 1688 supplier page, a website,
//             a visiting card's text: the fields are pulled out (rules; the AI when a key is set)   (erpLeadCapture)
//   import  - an Excel / CSV list (a LinkedIn export, a trade-fair list)          (erpLeadImport)
// A lead is never added twice (source_ref, or the same phone / e-mail / link of the same kind). Converting makes the
// customer or the supplier and marks the lead Won. Owner-only ("Only me") until the provider opens the app.
//
//   erpLeads({kind, source, stage, q, open})   the list, counts per source and stage, the sources, what can be found
//   erpLeadUpsert(lead)                          add (de-duplicated) or change one
//   erpLeadAct({id, stage | note | followUp | assign | convert})
//   erpLeadHarvest()                           bring in from Inbox, landing pages, quote requests, the market
//   erpLeadFind({kind, via: 'map'|'ai', what, place})   candidates (nothing saved)
//   erpLeadCapture({text, kind})               a pasted page / profile / card -> a filled lead form (nothing saved)
//   erpLeadImport({rows, kind, source})        a sheet's rows -> leads

import { num, formatDate } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';
import { phone11, normalizePhone } from '../lib/phone.js';
import { platformAdmin } from './platform.js';
import { appIsOff } from './apps.js';
import { gemini, textOf, jsonOf } from '../lib/gemini.js';
import { aiKey } from './receivefile.js';

const str = (v) => String(v == null ? '' : v).trim();
const STAGES = ['', 'New', 'Contacted', 'Interested', 'Quoted', 'Won', 'Lost'];

// every place a lead can come from - the screen lists them all, with how each one arrives
export const SOURCES = [
  { key: 'facebook_comment', name: 'Facebook comments', kind: 'customer', how: 'auto', note: 'A comment on your posts asking the price, stock or details' },
  { key: 'instagram_comment', name: 'Instagram comments', kind: 'customer', how: 'auto', note: 'A comment on your posts asking the price, stock or details' },
  { key: 'messenger', name: 'Messenger chats', kind: 'customer', how: 'auto', note: 'A warm chat that has not ordered yet' },
  { key: 'instagram', name: 'Instagram chats', kind: 'customer', how: 'auto', note: 'A warm chat that has not ordered yet' },
  { key: 'whatsapp', name: 'WhatsApp chats', kind: 'customer', how: 'auto', note: 'A warm chat that has not ordered yet' },
  { key: 'webchat', name: 'Website chat', kind: 'customer', how: 'auto', note: 'A warm chat that has not ordered yet' },
  { key: 'email', name: 'E-mail', kind: 'customer', how: 'auto', note: 'A warm e-mail conversation that has not ordered yet' },
  { key: 'landing', name: 'Landing pages', kind: 'customer', how: 'auto', note: 'Started an order on a landing page and did not finish' },
  { key: 'quote', name: 'Print quote requests', kind: 'customer', how: 'auto', note: 'Asked your shop for a print price' },
  { key: 'market_wanted', name: 'Market: buyers looking', kind: 'customer', how: 'auto', note: 'A buyer’s "wanted" post on the platform market' },
  { key: 'google', name: 'Google (AI search)', kind: 'both', how: 'find', note: 'Businesses found on Google by the AI; needs the AI key' },
  { key: 'maps', name: 'Map listings', kind: 'both', how: 'find', note: 'Shops, offices and factories on the map (OpenStreetMap), by area' },
  { key: 'linkedin', name: 'LinkedIn', kind: 'both', how: 'paste', note: 'Paste a profile or company page, or import an export' },
  { key: 'facebook', name: 'Facebook pages and groups', kind: 'both', how: 'paste', note: 'Paste a page, a group post or a profile' },
  { key: 'google_maps', name: 'Google Maps listing', kind: 'both', how: 'paste', note: 'Paste a listing’s details' },
  { key: 'b2b', name: 'Alibaba / 1688 / Made-in-China', kind: 'supplier', how: 'paste', note: 'Paste a supplier’s page' },
  { key: 'website', name: 'A website', kind: 'both', how: 'paste', note: 'Paste the contact page' },
  { key: 'trade_fair', name: 'Trade fair / visiting card', kind: 'both', how: 'paste', note: 'Type or paste the card' },
  { key: 'referral', name: 'Referral', kind: 'both', how: 'hand', note: 'Someone told you about them' },
  { key: 'walk_in', name: 'Walk-in or phone call', kind: 'customer', how: 'hand', note: 'Came to the shop or called' },
  { key: 'import', name: 'Excel / CSV list', kind: 'both', how: 'import', note: 'A list from anywhere' },
  { key: 'team', name: 'Added by hand', kind: 'both', how: 'hand', note: '' },
];
const SRC = Object.fromEntries(SOURCES.map((s) => [s.key, s]));
const CH_SOURCE = { messenger: 'messenger', instagram: 'instagram', wa_cloud: 'whatsapp', wa_evo: 'whatsapp', wa_sender: 'whatsapp', webchat: 'webchat', email: 'email' };
/** The source a row shows: the Inbox's own rows said 'ai' / 'comment' / 'website' with the channel apart. */
function sourceOf(l) {
  const s = str(l.source), ch = str(l.channel);
  if (SRC[s]) return s;
  if (s === 'comment') return ch === 'instagram' ? 'instagram_comment' : 'facebook_comment';
  if (s === 'website') return 'webchat';
  return CH_SOURCE[ch] || (s === 'ai' ? 'messenger' : 'team');
}

async function needOn(ctx) {
  if (await platformAdmin(ctx)) return;
  if (await appIsOff(ctx.deps, ctx.sql, 'leads')) throw new Error('Leads is not open on this ERP yet.');
}
const key10 = (p) => { const d = normalizePhone(str(p)).replace(/[^0-9]/g, ''); return d.length >= 8 ? d.slice(-10) : ''; };
const cleanUrl = (u) => { const s = str(u); if (!s) return ''; return (/^https?:\/\//i.test(s) ? s : 'https://' + s).replace(/[)\].,;]+$/, '').slice(0, 400); };

/** Add one lead unless it is already there. -> { id, added } */
async function addLead(ctx, l, by) {
  const kind = l.kind === 'supplier' ? 'supplier' : 'customer';
  const name = str(l.name).slice(0, 120), company = str(l.company).slice(0, 160);
  if (!name && !company && !str(l.phone) && !str(l.email)) throw new Error('A lead needs a name, a company, a phone or an e-mail.');
  const ref = str(l.ref).slice(0, 200) || null;
  if (ref) { const hit = (await ctx.tx`select id from inbox_leads where business_id = ${ctx.biz} and source_ref = ${ref}`)[0]; if (hit) return { id: hit.id, added: false }; }
  const k = key10(l.phone), em = str(l.email).toLowerCase(), link = cleanUrl(l.link), web = cleanUrl(l.website);
  if (k || em || link) {
    const same = (await ctx.tx`select id, phone, email, link from inbox_leads where business_id = ${ctx.biz} and kind = ${kind}
                               and ((${!!em} and lower(email) = ${em}) or (${!!link} and link = ${link}) or (${!!k} and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${k}))
                               limit 1`)[0];
    if (same) return { id: same.id, added: false };
  }
  const src = SRC[str(l.source)] ? str(l.source) : 'team';
  const ph = str(l.phone) ? (phone11(l.phone) || str(l.phone)).slice(0, 40) : null;
  const r = (await ctx.tx`insert into inbox_leads (business_id, kind, name, company, phone, email, website, link, city, country, want, stage, source, channel,
                            source_ref, follow_up_on, note, added_by, tags)
             values (${ctx.biz}, ${kind}, ${name || null}, ${company || null}, ${ph}, ${em || null}, ${web || null}, ${link || null}, ${str(l.city).slice(0, 80) || null},
                     ${str(l.country).slice(0, 60) || null}, ${str(l.want).slice(0, 500) || null}, ${Math.max(1, Math.min(6, num(l.stage) || 1))}, ${src}, ${str(l.channel) || null},
                     ${ref}, ${str(l.followUp) || null}, ${str(l.note).slice(0, 2000) || null}, ${by || ctx.s.name || null}, ${Array.isArray(l.tags) && l.tags.length ? l.tags.map(str).filter(Boolean).slice(0, 10) : null})
             returning id`)[0];
  await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${r.id}, ${'Added from ' + (SRC[src] ? SRC[src].name : src)}, ${by || ctx.s.name || null})`;
  return { id: r.id, added: true };
}

function view(l, today, ev) {
  const src = sourceOf(l), f = l.follow_up_on ? formatDate(new Date(l.follow_up_on), 'yyyy-MM-dd') : '';
  return { id: l.id, kind: str(l.kind) || 'customer', name: str(l.name), company: str(l.company), phone: str(l.phone), email: str(l.email), website: str(l.website), link: str(l.link),
    city: str(l.city), country: str(l.country), want: str(l.want), stage: l.stage, stageName: STAGES[l.stage], value: l.value === null ? null : num(l.value), priority: str(l.priority),
    source: src, sourceName: SRC[src] ? SRC[src].name : src, conv: l.conversation_id, assigned: str(l.assigned_name), followUp: f, due: !!(f && f <= today && l.stage < 5),
    note: str(l.note), tags: l.tags || [], customerId: l.customer_id, supplierId: l.supplier_id, addedBy: str(l.added_by),
    added: formatDate(new Date(l.created_at), 'd MMM yyyy'), updated: formatDate(new Date(l.updated_at), 'd MMM'),
    history: (ev || []).map((e) => ({ what: e.what, by: str(e.by_name), at: formatDate(new Date(e.at), 'd MMM h:mm a') })) };
}

export async function erpLeads(ctx, payload) {
  await needOn(ctx);
  const p = payload || {};
  const kind = p.kind === 'supplier' ? 'supplier' : 'customer';
  const today = formatDate(ctx.now, 'yyyy-MM-dd');
  // a teammate (sales) sees the leads given to them and the unassigned ones; a manager and the owner see all
  const all = roleAtLeast(ctx.s.role, 'manager');
  const rows = await ctx.tx`select * from inbox_leads where business_id = ${ctx.biz} and coalesce(kind, 'customer') = ${kind}
                            and (${all} or assigned_to is null or assigned_to = ${ctx.s.userId})
                            order by (follow_up_on is not null and follow_up_on <= ${today} and stage < 5) desc, updated_at desc limit 2000`;
  const q = str(p.q).toLowerCase();
  const bySource = {}, byStage = [0, 0, 0, 0, 0, 0, 0];
  let due = 0;
  const out = [];
  for (const l of rows) {
    const src = sourceOf(l);
    bySource[src] = (bySource[src] || 0) + 1; byStage[l.stage]++;
    if (l.follow_up_on && formatDate(new Date(l.follow_up_on), 'yyyy-MM-dd') <= today && l.stage < 5) due++;
    if (p.source && src !== p.source) continue;
    if (p.stage && num(p.stage) !== l.stage) continue;
    if (q && ![l.name, l.company, l.phone, l.email, l.want, l.city, l.note].map(str).join(' ').toLowerCase().includes(q)) continue;
    if (out.length < 500) out.push(view(l, today, p.open === l.id ? await ctx.tx`select what, by_name, at from inbox_lead_events where lead_id = ${l.id} order by id` : null));
  }
  const counts = { customer: 0, supplier: 0 };
  for (const r of await ctx.tx`select coalesce(kind, 'customer') as k, count(*)::int as n from inbox_leads where business_id = ${ctx.biz} group by 1`) counts[r.k] = r.n;
  let ai = false; try { ai = !!(await aiKey(ctx)).key; } catch (_) { ai = false; }
  return { kind, leads: out, total: rows.length, bySource, byStage: STAGES.slice(1).map((n, i) => ({ stage: i + 1, name: n, n: byStage[i + 1] })), due, counts,
           sources: SOURCES.filter((s) => s.kind === 'both' || s.kind === kind), stages: STAGES.slice(1), ai, canFind: roleAtLeast(ctx.s.role, 'manager') };
}

export async function erpLeadUpsert(ctx, payload) {
  await needOn(ctx);
  const l = payload || {};
  if (!l.id) {
    const r = await addLead(ctx, l);
    return { ok: true, id: r.id, added: r.added, message: r.added ? 'Lead added.' : 'Already on the list - not added twice.' };
  }
  const old = (await ctx.tx`select * from inbox_leads where business_id = ${ctx.biz} and id = ${str(l.id)}`)[0];
  if (!old) throw new Error('No such lead.');
  const pick = (k, max) => (l[k] !== undefined ? str(l[k]).slice(0, max) || null : old[k]);
  await ctx.tx`update inbox_leads set kind = ${l.kind === 'supplier' || l.kind === 'customer' ? l.kind : old.kind}, name = ${pick('name', 120)}, company = ${pick('company', 160)},
      phone = ${l.phone !== undefined ? (str(l.phone) ? (phone11(l.phone) || str(l.phone)).slice(0, 40) : null) : old.phone}, email = ${l.email !== undefined ? str(l.email).toLowerCase() || null : old.email},
      website = ${l.website !== undefined ? cleanUrl(l.website) || null : old.website}, link = ${l.link !== undefined ? cleanUrl(l.link) || null : old.link},
      city = ${pick('city', 80)}, country = ${pick('country', 60)}, want = ${pick('want', 500)}, note = ${pick('note', 2000)},
      source = ${l.source !== undefined && SRC[str(l.source)] ? str(l.source) : old.source},
      value = ${l.value !== undefined ? (str(l.value) === '' ? null : num(l.value)) : old.value}, updated_at = now() where id = ${old.id}`;
  await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${old.id}, 'Details changed', ${ctx.s.name})`;
  return { ok: true, id: old.id };
}

export async function erpLeadAct(ctx, payload) {
  await needOn(ctx);
  const p = payload || {};
  const l = (await ctx.tx`select * from inbox_leads where business_id = ${ctx.biz} and id = ${str(p.id)}`)[0];
  if (!l) throw new Error('No such lead.');
  if (!roleAtLeast(ctx.s.role, 'manager') && l.assigned_to && l.assigned_to !== ctx.s.userId) throw new Error('This lead is given to someone else.');
  const ev = (what) => ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${l.id}, ${what}, ${ctx.s.name})`;
  if (p.stage !== undefined) {
    const s = Math.max(1, Math.min(6, num(p.stage)));
    if (s !== l.stage) { await ctx.tx`update inbox_leads set stage = ${s}, updated_at = now() where id = ${l.id}`; await ev('Stage: ' + STAGES[s]); }
  }
  if (p.note !== undefined && str(p.note)) {
    await ctx.tx`update inbox_leads set note = ${(str(l.note) ? str(l.note) + '\n' : '') + formatDate(ctx.now, 'd MMM') + ': ' + str(p.note).slice(0, 1000)}, updated_at = now() where id = ${l.id}`;
    await ev('Note: ' + str(p.note).slice(0, 300));
  }
  if (p.followUp !== undefined) {
    const d = str(p.followUp);
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('A follow-up date is like 2026-10-30.');
    await ctx.tx`update inbox_leads set follow_up_on = ${d || null}, updated_at = now() where id = ${l.id}`;
    await ev(d ? 'Follow up on ' + d : 'Follow-up cleared');
  }
  if (p.assign !== undefined) {
    if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager gives leads to people.');
    await ctx.tx`update inbox_leads set assigned_to = ${str(p.assign) || null}, assigned_name = ${str(p.assignName) || null}, updated_at = now() where id = ${l.id}`;
    await ev(str(p.assignName) ? 'Given to ' + str(p.assignName) : 'Not given to anyone');
  }
  if (p.convert) {
    if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager makes a customer or a supplier from a lead.');
    if (p.convert === 'customer') {
      if (l.customer_id) throw new Error('Already a customer.');
      const { erpSaveCustomer } = await import('./customers.js');
      const nm = str(l.name) || str(l.company);
      await erpSaveCustomer(ctx, { name: nm, phone: str(l.phone), email: str(l.email), address: [str(l.city), str(l.country)].filter(Boolean).join(', '),
                                   note: ['From a lead (' + (SRC[sourceOf(l)] || {}).name + ')', str(l.company) && str(l.company) !== nm ? str(l.company) : '', str(l.want)].filter(Boolean).join(' - ') });
      const c = (await ctx.tx`select id from customers where business_id = ${ctx.biz} and lower(name) = ${nm.toLowerCase()} order by created_at desc limit 1`)[0];
      await ctx.tx`update inbox_leads set customer_id = ${c ? c.id : null}, stage = 5, updated_at = now() where id = ${l.id}`;
      await ev('Made a customer');
    } else if (p.convert === 'supplier') {
      if (l.supplier_id) throw new Error('Already a supplier.');
      const { erpSupplierSave } = await import('./suppliers.js');
      const nm = str(l.company) || str(l.name);
      await erpSupplierSave(ctx, { name: nm, phone: str(l.phone), country: str(l.country), note: ['From a lead (' + (SRC[sourceOf(l)] || {}).name + ')', str(l.name) && str(l.name) !== nm ? 'contact ' + str(l.name) : '',
                                   str(l.email), str(l.website), str(l.want)].filter(Boolean).join(' - ') });
      const s = (await ctx.tx`select id from suppliers where business_id = ${ctx.biz} and lower(name) = ${nm.toLowerCase()} limit 1`)[0];
      await ctx.tx`update inbox_leads set supplier_id = ${s ? s.id : null}, stage = 5, updated_at = now() where id = ${l.id}`;
      await ev('Made a supplier');
    } else throw new Error('Make a customer or a supplier?');
  }
  return { ok: true };
}

// ------------------------------------------------------------------ bring in from inside the ERP
const ASKING = /\b(price|prices|dam|daam|koto|kot|rate|cost|how\s*much|available|availability|stock|ase|ache|order|inbox|details|detail|pm|dm|interested|need|chai|lagbe|lagbo|wholesale)\b|দাম|কত|আছে|লাগবে|অর্ডার|ইনবক্স|ডিটেইলস|প্রাইস|চাই/i;
export async function erpLeadHarvest(ctx) {
  await needOn(ctx);
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager brings in leads.');
  const got = {};
  const tally = (src, r) => { got[src] = got[src] || { added: 0, seen: 0 }; got[src].seen++; if (r.added) got[src].added++; };
  const since = new Date(ctx.now.getTime() - 60 * 86400e3);
  // 1. comments asking a price / stock / details (not the page's own replies)
  for (const c of await ctx.tx`select c.id, c.from_id, c.from_name, c.text, c.created_at, ch.kind, ch.external_id from inbox_comments c join inbox_channels ch on ch.id = c.channel_id
                               where c.business_id = ${ctx.biz} and c.created_at > ${since} order by c.created_at desc limit 1000`) {
    if (!ASKING.test(str(c.text)) || (c.external_id && str(c.from_id) === str(c.external_id))) continue;
    const src = c.kind === 'instagram' ? 'instagram_comment' : 'facebook_comment';
    tally(src, await addLead(ctx, { source: src, ref: 'comment:' + c.id, name: str(c.from_name) || 'Commenter', want: str(c.text), channel: c.kind }, 'Brought in'));
  }
  // 2. warm chats that did not order and have no lead yet
  for (const v of await ctx.tx`select v.id, v.contact_id, v.interest, v.last_text, ch.kind, ct.name, ct.phone from inbox_conversations v join inbox_channels ch on ch.id = v.channel_id
                               left join inbox_contacts ct on ct.id = v.contact_id
                               where v.business_id = ${ctx.biz} and not v.ordered and not coalesce(v.is_test, false) and v.interest in ('warm', 'hot') and v.last_in_at > ${since}
                                 and not exists (select 1 from inbox_leads l where l.conversation_id = v.id) order by v.last_in_at desc limit 500`) {
    const src = CH_SOURCE[v.kind] || 'messenger';
    const r = await addLead(ctx, { source: src, ref: 'chat:' + v.id, name: str(v.name) || 'Chat', phone: str(v.phone), want: str(v.last_text), channel: v.kind,
                                   note: v.interest === 'hot' ? 'Hot chat' : 'Warm chat' }, 'Brought in');
    if (r.added) await ctx.tx`update inbox_leads set conversation_id = ${v.id}, contact_id = ${v.contact_id} where id = ${r.id}`;
    tally(src, r);
  }
  // 3. landing-page orders started and not finished
  try {
    for (const d of await ctx.tx`select d.id, d.name, d.phone, d.address, d.area, d.qty, coalesce(p.headline, p.sku) as title from landing_drafts d left join landing_pages p on p.id = d.page_id
                                 where d.business_id = ${ctx.biz} and d.status in ('open', 'called') and coalesce(d.phone, '') <> '' and d.created_at > ${since} order by d.created_at desc limit 500`) {
      tally('landing', await addLead(ctx, { source: 'landing', ref: 'landing:' + d.id, name: str(d.name) || 'Landing visitor', phone: str(d.phone), city: str(d.area),
                                            want: [str(d.title), d.qty ? 'x' + d.qty : ''].filter(Boolean).join(' '), note: str(d.address) }, 'Brought in'));
    }
  } catch (_) { /* no landing pages here */ }
  // 4. print quote requests not answered with a job
  try {
    for (const q of await ctx.tx`select req_no, name, phone, email, notes, status from print_requests where business_id = ${ctx.biz} and created_at > ${since} order by created_at desc limit 300`) {
      if (/done|job|closed|declined/i.test(str(q.status))) continue;
      tally('quote', await addLead(ctx, { source: 'quote', ref: 'quote:' + q.req_no, name: str(q.name) || 'Quote request', phone: str(q.phone), email: str(q.email), want: str(q.notes) }, 'Brought in'));
    }
  } catch (_) { /* no print kit here */ }
  // 5. buyers' "wanted" posts on the platform market (other shops' buyers; the phone is given when you answer on the market)
  try {
    const ctl = ctx.deps && ctx.deps.control;
    if (ctl) {
      for (const w of await ctl`select id, buyer_name, city, item, qty from erp_market_wanted where status = 'open' and (until is null or until >= now()::date)
                                and coalesce(business_id::text, '') <> ${String(ctx.biz)} order by created_at desc limit 200`) {
        tally('market_wanted', await addLead(ctx, { source: 'market_wanted', ref: 'wanted:' + w.id, name: str(w.buyer_name) || 'Buyer on the market', city: str(w.city),
                                                    want: str(w.item) + (w.qty ? ' x' + w.qty : ''), note: 'Answer it under Market > Wanted' }, 'Brought in'));
      }
    }
  } catch (_) { /* the market is not on this server */ }
  const added = Object.values(got).reduce((a, x) => a + x.added, 0);
  return { ok: true, added, bySource: Object.fromEntries(Object.entries(got).map(([k, v]) => [k, { ...v, name: SRC[k] ? SRC[k].name : k }])) };
}

// ------------------------------------------------------------------ find outside
// map listings: OpenStreetMap through Overpass (free, no key). What a shop sells is guessed from its tags and name.
const MAP_PRESETS = {
  customer: [
    { key: 'printing', name: '3D printing, makers, labs', tags: ['shop~"3d|printing|copyshop"', 'craft~"printer|3d"', 'office~"engineer|architect|design"'], words: /3d|print|maker|fab|lab|design|architect|engineer/i },
    { key: 'electronics', name: 'Electronics and computer shops', tags: ['shop~"electronics|computer|mobile_phone|hifi"'], words: /./ },
    { key: 'education', name: 'Schools, colleges, universities', tags: ['amenity~"university|college|school"'], words: /./ },
    { key: 'hobby', name: 'Toy, hobby, gift, craft shops', tags: ['shop~"toys|hobby|craft|gift|art|model"'], words: /./ },
  ],
  supplier: [
    { key: 'plastics', name: 'Plastic, chemicals and materials', tags: ['industrial~"."', 'craft~"plastic"', 'shop~"trade|wholesale"'], words: /plast|polymer|chemical|resin|material|factory|industr|wholesale|trad/i },
    { key: 'electronics', name: 'Electronics wholesale and parts', tags: ['shop~"electronics|electrical|hardware|trade|wholesale"'], words: /./ },
    { key: 'manufacturers', name: 'Factories and manufacturers', tags: ['industrial~"."', 'man_made~"works"', 'office~"company"'], words: /./ },
  ],
};
// the main towns are built in (no lookup needed); anything else: Nominatim, then Photon (both free OpenStreetMap services;
// either may refuse a cloud server now and then)
const TOWNS = { dhaka: [23.70, 90.34, 23.90, 90.46], chattogram: [22.23, 91.75, 22.45, 91.88], chittagong: [22.23, 91.75, 22.45, 91.88], sylhet: [24.86, 91.83, 24.93, 91.92],
  khulna: [22.77, 89.50, 22.88, 89.60], rajshahi: [24.34, 88.55, 24.40, 88.66], barishal: [22.67, 90.32, 22.73, 90.39], barisal: [22.67, 90.32, 22.73, 90.39], rangpur: [25.72, 89.22, 25.78, 89.30],
  mymensingh: [24.72, 90.37, 24.78, 90.43], gazipur: [23.95, 90.36, 24.05, 90.45], narayanganj: [23.58, 90.47, 23.66, 90.53], cumilla: [23.43, 91.14, 23.49, 91.21], comilla: [23.43, 91.14, 23.49, 91.21],
  "cox's bazar": [21.40, 91.96, 21.47, 92.02], coxsbazar: [21.40, 91.96, 21.47, 92.02], bogura: [24.82, 89.34, 24.88, 89.40], jessore: [23.14, 89.18, 23.20, 89.24], jashore: [23.14, 89.18, 23.20, 89.24],
  savar: [23.82, 90.23, 23.89, 90.29], uttara: [23.85, 90.36, 23.89, 90.41], mirpur: [23.79, 90.34, 23.83, 90.38], gulshan: [23.77, 90.40, 23.80, 90.43], dhanmondi: [23.73, 90.36, 23.76, 90.39],
  motijheel: [23.72, 90.41, 23.74, 90.43], tejgaon: [23.75, 90.38, 23.78, 90.41], shenzhen: [22.45, 113.75, 22.80, 114.35], guangzhou: [22.95, 113.15, 23.30, 113.50], ningbo: [29.75, 121.40, 30.00, 121.75],
  shanghai: [30.95, 121.20, 31.45, 121.75], yiwu: [29.25, 120.00, 29.38, 120.15], kolkata: [22.45, 88.25, 22.65, 88.45] };
async function geo(ctx, place) {
  const key = str(place).toLowerCase().replace(/,.*$/, '').trim();
  if (TOWNS[key]) { const [s, w, n, e] = TOWNS[key]; return { name: str(place).replace(/,.*$/, ''), box: [s, w, n, e] }; }
  const UA = { 'user-agent': 'erp-leads/1.0 (lead finder; contact via the ERP provider)', 'accept-language': 'en' };
  try {
    const r = await ctx.deps.fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(place), { headers: UA });
    const j = r.ok ? await r.json().catch(() => []) : [];
    if (j.length) { const b = j[0].boundingbox.map(Number); return box(str(j[0].display_name), b[0], b[1], b[2], b[3]); }
  } catch (_) { /* try the next */ }
  try {
    const r = await ctx.deps.fetch('https://photon.komoot.io/api/?limit=1&q=' + encodeURIComponent(place), { headers: UA });
    const j = r.ok ? await r.json().catch(() => ({})) : {};
    const f = (j.features || [])[0];
    if (f) {
      const p = f.properties || {}, ex = p.extent, c = (f.geometry || {}).coordinates || [];
      const nm = [p.name, p.state, p.country].filter(Boolean).join(', ');
      if (ex) return box(nm, Math.min(ex[1], ex[3]), Math.max(ex[1], ex[3]), Math.min(ex[0], ex[2]), Math.max(ex[0], ex[2]));
      if (c.length) return box(nm, c[1] - 0.05, c[1] + 0.05, c[0] - 0.05, c[0] + 0.05);
    }
  } catch (_) { /* nothing found */ }
  throw new Error('That place was not found on the map. Try a city name, like Dhaka or Chattogram.');
}
function box(name, south, north, west, east) {
  const lat = (south + north) / 2, lon = (west + east) / 2, h = Math.min(0.3, Math.max(0.05, (north - south) / 2)), w = Math.min(0.3, Math.max(0.05, (east - west) / 2));
  return { name: str(name).split(',').slice(0, 2).join(','), box: [lat - h, lon - w, lat + h, lon + w].map((x) => Math.round(x * 1e4) / 1e4) };
}
async function findOnMap(ctx, kind, what, place) {
  const preset = (MAP_PRESETS[kind] || []).find((x) => x.key === what);
  const words = str(what) && !preset ? new RegExp(str(what).replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).join('|') || '.', 'i') : preset ? preset.words : /./;
  const tags = preset ? preset.tags : ['shop~"."', 'office~"."', 'craft~"."', 'industrial~"."'];
  const g = await geo(ctx, place || 'Dhaka');
  const bb = '(' + g.box.join(',') + ')';
  const q = '[out:json][timeout:45];(' + tags.map((t) => { const [k, v] = t.split('~'); return 'nwr["' + k + '"~' + v + ']' + bb + ';'; }).join('') + ');out tags center 1000;';
  // the main Overpass server, then a mirror (either can be busy)
  let j = null, last = '';
  for (const base of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const r = await ctx.deps.fetch(base, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'erp-leads/1.0' }, body: 'data=' + encodeURIComponent(q) });
      if (r.ok) { j = await r.json().catch(() => null); if (j) break; } else last = String(r.status);
    } catch (e) { last = 'no answer'; }
  }
  if (!j) throw new Error('The map service is busy (' + last + '). Try again in a minute.');
  const out = [];
  for (const e of j.elements || []) {
    const t = e.tags || {}; const nm = str(t.name || t['name:en']);
    if (!nm) continue;
    const blob = [nm, t.shop, t.office, t.craft, t.industrial, t.amenity, t.description, t.product].map(str).join(' ');
    if (!words.test(blob)) continue;
    out.push({ ref: 'osm:' + e.type + '/' + e.id, source: 'maps', kind, name: '', company: nm, phone: str(t.phone || t['contact:phone'] || t.mobile || t['contact:mobile']).split(';')[0],
               email: str(t.email || t['contact:email']), website: str(t.website || t['contact:website'] || t.url), link: str(t['contact:facebook'] || t.facebook) || 'https://www.openstreetmap.org/' + e.type + '/' + e.id,
               city: str(t['addr:city'] || g.name.split(',')[0]), country: str(t['addr:country']), want: [t.shop, t.office, t.craft, t.industrial, t.amenity].map(str).filter(Boolean).join(', '),
               note: [t['addr:street'], t['addr:housenumber']].map(str).filter(Boolean).join(' ') });
  }
  // the ones with a way to reach them first
  out.sort((a, b) => (b.phone || b.email || b.website ? 1 : 0) - (a.phone || a.email || a.website ? 1 : 0));
  return { place: g.name, list: out.slice(0, 150), total: out.length };
}
async function findWithAi(ctx, kind, what, place) {
  const want = str(what) || (kind === 'supplier' ? '3D printing filament, 3D printers and spare parts manufacturers or wholesalers' : 'businesses that would buy 3D printers, filament or 3D printing services');
  const prompt = 'Use Google Search. Find up to 15 real ' + (kind === 'supplier' ? 'SUPPLIERS (manufacturers, factories, wholesalers, distributors)' : 'POTENTIAL CUSTOMERS (businesses, institutions, makers)') +
    ' for this: ' + want + '. Where: ' + (str(place) || 'Bangladesh') + '.\n' +
    'For each one give what you actually found on the web - never invent a phone or e-mail; leave a field empty when it was not found. ' +
    'Answer with ONLY a JSON array of objects {"company": "", "name": "contact person or empty", "what": "what they do, short", "city": "", "country": "", "phone": "", "email": "", ' +
    '"website": "", "link": "their Facebook / LinkedIn / Alibaba page or empty", "source_url": "the page where you found them"}.';
  const r = await gemini(ctx, { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }, 'leads-find');
  let arr = jsonOf(r.parts);
  if (!Array.isArray(arr)) { const m = /\[[\s\S]*\]/.exec(textOf(r.parts)); try { arr = m ? JSON.parse(m[0]) : []; } catch (_) { arr = []; } }
  const list = (arr || []).filter((x) => x && (str(x.company) || str(x.name))).slice(0, 20).map((x) => ({
    ref: 'web:' + (str(x.website) || str(x.link) || str(x.company)).toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 150),
    source: 'google', kind, name: str(x.name), company: str(x.company), phone: str(x.phone), email: str(x.email), website: str(x.website), link: str(x.link) || str(x.source_url),
    city: str(x.city), country: str(x.country), want: str(x.what), note: str(x.source_url) ? 'Found on ' + str(x.source_url) : '' }));
  return { place: str(place) || 'Bangladesh', list, total: list.length };
}
export async function erpLeadFind(ctx, payload) {
  await needOn(ctx);
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager searches for leads.');
  const p = payload || {};
  const kind = p.kind === 'supplier' ? 'supplier' : 'customer';
  const res = p.via === 'ai' ? await findWithAi(ctx, kind, p.what, p.place) : await findOnMap(ctx, kind, p.what, p.place);
  // what is already on the list
  const refs = res.list.map((x) => x.ref);
  const have = new Set((await ctx.tx`select source_ref from inbox_leads where business_id = ${ctx.biz} and source_ref = any(${refs})`).map((r) => r.source_ref));
  res.list.forEach((x) => { x.have = have.has(x.ref); });
  return { ...res, via: p.via === 'ai' ? 'ai' : 'map', presets: MAP_PRESETS[kind].map((x) => ({ key: x.key, name: x.name })) };
}
export function leadPresets() { return MAP_PRESETS; }

// ------------------------------------------------------------------ paste a page / profile / card
const HOSTS = [[/linkedin\.com/i, 'linkedin'], [/facebook\.com|fb\.com|fb\.me/i, 'facebook'], [/google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i, 'google_maps'],
               [/alibaba\.com|1688\.com|made-in-china\.com|globalsources\.com|aliexpress\.com|indiamart\.com/i, 'b2b']];
export function captureRules(text, kindHint) {
  const t = str(text).replace(/\r/g, '');
  const urls = t.match(/https?:\/\/[^\s<>"']+|(?:www\.)[^\s<>"']+/gi) || [];
  let source = 'website', link = '', website = '';
  for (const u of urls) { const h = HOSTS.find(([re]) => re.test(u)); if (h) { if (!link) { link = u; source = h[1]; } } else if (!website) website = u; }
  if (!urls.length) source = /linkedin/i.test(t) ? 'linkedin' : /visiting|card|fair|expo/i.test(t) ? 'trade_fair' : 'team';
  const email = ((t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [])[0] || '').toLowerCase();
  const phoneRaw = (t.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || []).map((x) => x.trim()).find((x) => x.replace(/[^0-9]/g, '').length >= 9 && x.replace(/[^0-9]/g, '').length <= 15) || '';
  const lines = t.split('\n').map((x) => x.trim()).filter((x) => x && !/^https?:|^www\./i.test(x) && !x.includes('@') && x.replace(/[^0-9]/g, '').length < 7);
  const COMPANY = /\b(ltd|limited|co\.?|company|corp|corporation|inc|llc|gmbh|trading|traders|industries|industry|enterprise|enterprises|technolog\w*|solutions|group|factory|manufactur\w*|store|shop|lab|labs|studio)\b/i;
  let company = (lines.find((x) => COMPANY.test(x)) || '').slice(0, 160);
  const at = /\b(?:at|@)\s+([A-Z][\w&.,' -]{2,60})/.exec(t); if (!company && at) company = at[1].trim();
  let name = (lines.find((x) => x !== company && x.length <= 60 && /^[\p{L}][\p{L} .'-]+$/u.test(x) && x.split(/\s+/).length <= 5) || '').slice(0, 120);
  // "Head of Design at Bright Architects Ltd." -> the company alone; the job title goes to the note
  let title = '';
  const split = /^(.{2,80}?)\s+(?:at|@)\s+(.{2,120})$/i.exec(company);
  if (split) { title = split[1].trim(); company = split[2].trim(); }
  const supplierish = source === 'b2b' || /\b(manufacturer|factory|supplier|wholesale|wholesaler|distributor|exporter|oem)\b/i.test(t);
  const kind = kindHint === 'supplier' || kindHint === 'customer' ? kindHint : supplierish ? 'supplier' : 'customer';
  const city = (/\b(Dhaka|Chattogram|Chittagong|Sylhet|Khulna|Rajshahi|Barishal|Rangpur|Mymensingh|Gazipur|Narayanganj|Comilla|Cumilla|Shenzhen|Guangzhou|Shanghai|Ningbo|Yiwu|Suzhou|Hangzhou|Kolkata|Delhi|Mumbai)\b/i.exec(t) || [])[1] || '';
  const country = /bangladesh|dhaka|chattogram|chittagong/i.test(t) ? 'Bangladesh' : /china|shenzhen|guangzhou|shanghai|ningbo|yiwu|suzhou|hangzhou/i.test(t) ? 'China' : /india|kolkata|delhi|mumbai/i.test(t) ? 'India' : '';
  return { kind, source, name, company, phone: phoneRaw, email, website, link, city, country, want: '', note: title };
}
export async function erpLeadCapture(ctx, payload) {
  await needOn(ctx);
  const p = payload || {};
  const text = str(p.text).slice(0, 8000);
  if (!text) throw new Error('Paste the page, profile or card first.');
  const rules = captureRules(text, p.kind);
  let ai = null, used = 'rules';
  try {
    if ((await aiKey(ctx)).key) {
      const r = await gemini(ctx, { contents: [{ role: 'user', parts: [{ text: 'From this pasted text (a LinkedIn / Facebook / Google Maps / supplier page, a website or a visiting card), pull out one lead. ' +
        'Only what is written - leave a field empty when it is not there. Answer with ONLY JSON {"name": "person", "title": "", "company": "", "phone": "", "email": "", "website": "", ' +
        '"city": "", "country": "", "what": "what they do or want, short", "kind": "customer or supplier (supplier = they make or sell goods we could buy)"}.\n\n' + text }] }],
        generationConfig: { responseMimeType: 'application/json' } }, 'leads-capture');
      ai = jsonOf(r.parts); used = 'ai';
    }
  } catch (_) { ai = null; used = 'rules'; }
  const a = ai && typeof ai === 'object' ? ai : {};
  const lead = { ...rules, name: str(a.name) || rules.name, company: str(a.company) || rules.company, phone: str(a.phone) || rules.phone, email: str(a.email) || rules.email,
    website: str(a.website) || rules.website, city: str(a.city) || rules.city, country: str(a.country) || rules.country, want: str(a.what) || '',
    note: str(a.title) || rules.note || '', kind: p.kind === 'supplier' || p.kind === 'customer' ? p.kind : (a.kind === 'supplier' ? 'supplier' : rules.kind) };
  return { lead, used };
}

// ------------------------------------------------------------------ an Excel / CSV list
const COLS = { name: /^(name|full ?name|contact|contact ?name|person|first ?name)$/i, company: /^(company|organi[sz]ation|business|firm|shop|employer|company ?name)$/i,
  phone: /^(phone|mobile|cell|whatsapp|tel|telephone|contact ?no|phone ?number)$/i, email: /^(e-?mail|email ?address|mail)$/i, website: /^(website|web|site|url|homepage)$/i,
  link: /^(link|profile|linkedin|facebook|profile ?url|page)$/i, city: /^(city|town|location|area|district)$/i, country: /^(country|nation)$/i,
  want: /^(want|interest|need|product|products|what|category|title|position|job ?title|headline)$/i, note: /^(note|notes|comment|comments|remarks?)$/i };
export async function erpLeadImport(ctx, payload) {
  await needOn(ctx);
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager imports leads.');
  const p = payload || {};
  const rows = (Array.isArray(p.rows) ? p.rows : []).slice(0, 2001).map((r) => (Array.isArray(r) ? r : [r]).map(str));
  if (rows.length < 2) throw new Error('The sheet needs a heading row and at least one lead.');
  const head = rows[0].map((h) => { for (const k of Object.keys(COLS)) if (COLS[k].test(h.replace(/[_.]/g, ' ').trim())) return k; return ''; });
  if (!head.some((k) => ['name', 'company', 'phone', 'email'].includes(k))) throw new Error('No column called Name, Company, Phone or Email in the first row.');
  const kind = p.kind === 'supplier' ? 'supplier' : 'customer', src = SRC[str(p.source)] ? str(p.source) : 'import';
  let added = 0, same = 0, bad = 0;
  for (const r of rows.slice(1)) {
    const l = { kind, source: src };
    head.forEach((k, i) => { if (k && r[i]) l[k] = l[k] ? l[k] + ' ' + r[i] : r[i]; });
    if (!l.name && !l.company && !l.phone && !l.email) { bad++; continue; }
    try { const x = await addLead(ctx, l, ctx.s.name + ' (import)'); if (x.added) added++; else same++; } catch (_) { bad++; }
  }
  return { ok: true, added, same, skipped: bad };
}

export const HANDLERS = { erpLeads, erpLeadUpsert, erpLeadAct, erpLeadHarvest, erpLeadFind, erpLeadCapture, erpLeadImport };
