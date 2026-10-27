// The Inbox's other screens (120_inbox.sql): channels (connect, practice, Go live, AI switches), the business details
// the agent answers from, chat orders (approve -> a real invoice), leads, the Agent Desk (rules as drafts, tested in a
// customer's-phone view, published, undone), the knowledge base, special offers, broadcasts, comments, saved replies,
// analytics and the log of AI work with its cost.

import { num, formatDate, todayStr } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { platformAdmin } from './platform.js';
import { orderLink, orderBase, orderSuffix } from './inboxpub.js';
import { gemini, textOf, jsonOf } from '../lib/gemini.js';
import { aiKey } from './receivefile.js';
import { feat, needFeat, budget, planOf, ownerSwitches, ownOn, DEFAULT_OFF, FEATURES, FEATURE_KEYS, KIND_FEATURE } from '../lib/inboxplan.js';
import { templatesCreate, templatesCheck, sendTemplate, templateName, TEMPLATE_KEYS } from './inboxch.js';
import { writeMsg } from './inbox.js';
import { KINDS, KIND_NAME, CAN, chSecret, chSecretSet, evoQr, evoState, evoSetHook, metaSubscribe, commentModerate, commentReply } from './inboxch.js';
import { scopeOf, profile, PROFILE_DEFAULTS, agentReply, deliver, orderEvent, task, leadUpsert, kbSearch, REASONS, inWindow } from './inbox.js';

const str = (v) => String(v == null ? '' : v).trim();
const H24 = 24 * 3600e3;
function owner(ctx) { if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder changes this.'); }
function need(ctx, role) { if (!roleAtLeast(ctx.s.role, role || 'sales')) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).'); }
async function chOf(ctx, id) { return (await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and id = ${id}`)[0] || null; }

// ------------------------------------------------------------------ channels
function hookUrl(ctx, ch) {
  const base = str(ctx.deps && ctx.deps.hookBase);
  if (!base) return '';
  return base + (base.includes('?') ? '&' : '?') + 'inbox=hook&ch=' + ch.id + '&k=' + ch.hook_key;
}
function chatUrl(ctx, ch) {
  const base = str(ctx.deps && ctx.deps.hookBase);
  return base ? base + (base.includes('?') ? '&' : '?') + 'chat=' + ch.id : '';
}
const NEEDS = { messenger: ['TOKEN', 'APP_SECRET'], instagram: ['TOKEN', 'APP_SECRET'], wa_cloud: ['TOKEN', 'APP_SECRET'], wa_evo: ['URL', 'KEY'], wa_sender: ['KEY', 'HOOK_SECRET'], webchat: [], email: ['PASSWORD'] };

export async function erpInboxChannels(ctx) {
  need(ctx, 'manager');
  const rows = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and status <> 'removed' order by created_at`;
  const out = [];
  for (const ch of rows) {
    const keys = {};
    for (const k of NEEDS[ch.kind].concat(ch.kind.match(/messenger|instagram|wa_cloud/) ? ['VERIFY'] : [])) keys[k] = !!(await chSecret(ctx, ch, k));
    const verify = ctx.s.role === 'owner' && /messenger|instagram|wa_cloud/.test(ch.kind) ? await chSecret(ctx, ch, 'VERIFY') : '';
    out.push({ id: ch.id, kind: ch.kind, kindName: KIND_NAME[ch.kind], name: ch.name, externalId: str(ch.external_id), status: ch.status, aiOn: ch.ai_on,
      aiOffUntil: ch.ai_off_until && new Date(ch.ai_off_until) > ctx.now ? formatDate(new Date(ch.ai_off_until), 'd MMM, h:mm a') : '', commentsAi: ch.comments_ai,
      settings: ch.settings || {}, keys, hookUrl: ctx.s.role === 'owner' ? hookUrl(ctx, ch) : '', verify, chatUrl: ch.kind === 'webchat' ? chatUrl(ctx, ch) : '',
      official: !/wa_evo|wa_sender/.test(ch.kind), can: CAN[ch.kind],
      mail: ch.kind === 'email' ? { checked: ch.settings && ch.settings.mail_checked ? formatDate(new Date(ch.settings.mail_checked), 'd MMM, h:mm a') : '', error: str(ch.settings && ch.settings.mail_error),
                                    skipped: Number(ch.settings && ch.settings.mail_skipped) || 0 } : null });
  }
  const k = { key: await (await import('../lib/ai.js')).anyAi(ctx) };
  return { channels: out, kinds: KINDS.map((x) => ({ kind: x, name: KIND_NAME[x], official: !/wa_evo|wa_sender/.test(x) })), aiKey: !!k.key, profile: await profile(ctx, false) };
}
/** Add or change a channel. Secrets are written, never read back. */
export async function erpInboxChannelSave(ctx, payload) {
  owner(ctx);
  const p = payload || {};
  let ch = p.id ? await chOf(ctx, str(p.id)) : null;
  if (!ch) {
    if (!KINDS.includes(p.kind)) throw new Error('Choose what to connect.');
    await needFeat(ctx, KIND_FEATURE[p.kind]);
    if (/wa_evo|wa_sender/.test(p.kind) && !p.acceptRisk) throw new Error('Read and accept the notice first: a linked-device WhatsApp is not Meta\'s official system and the number can be banned.');
    const ext = p.kind === 'email' ? str(p.externalId).toLowerCase() : str(p.externalId) || (p.kind === 'webchat' ? 'site-' + Date.now().toString(36) : '');
    if (p.kind === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(ext)) throw new Error('Type the e-mail address of the mailbox.');
    if (!ext) throw new Error(p.kind === 'wa_evo' ? 'Type the Evolution instance name.' : p.kind === 'wa_cloud' ? 'Type the WhatsApp phone number id (from Meta).' : p.kind === 'wa_sender' ? 'Type the WhatsApp number.' : 'Type the page / account id.');
    const settings = { wait_s: p.kind === 'webchat' ? 3 : 15, revert_min: 60, test_code: String(Math.floor(10000 + Math.random() * 90000)) };
    ch = (await ctx.tx`insert into inbox_channels (business_id, kind, name, external_id, status, settings, created_by)
           values (${ctx.biz}, ${p.kind}, ${str(p.name) || KIND_NAME[p.kind]}, ${ext}, 'practice', ${ctx.tx.json(settings)}, ${ctx.s.name}) returning *`)[0];
    if (/messenger|instagram|wa_cloud/.test(p.kind)) await chSecretSet(ctx, ch, 'VERIFY', 'v' + crypto.randomUUID().replace(/-/g, '').slice(0, 24));
  } else {
    if (p.name !== undefined || p.externalId !== undefined) await ctx.tx`update inbox_channels set name = coalesce(${str(p.name) || null}, name), external_id = coalesce(${str(p.externalId) || null}, external_id) where id = ${ch.id}`;
  }
  for (const k of ['TOKEN', 'APP_SECRET', 'URL', 'KEY', 'HOOK_SECRET']) if (p.secrets && str(p.secrets[k])) await chSecretSet(ctx, ch, k, str(p.secrets[k]).replace(/\/+$/, k === 'URL' ? '' : '$&'));
  if (p.secrets && str(p.secrets.PASSWORD)) await chSecretSet(ctx, ch, 'PASSWORD', str(p.secrets.PASSWORD).replace(/\s+/g, ch.kind === 'email' && /gmail|google/i.test(str((p.settings || {}).smtp_host || (ch.settings || {}).smtp_host)) ? '' : '$&'));
  if (p.settings && typeof p.settings === 'object') {
    const s = { ...(ch.settings || {}) };
    if (p.settings.wait_s !== undefined) s.wait_s = Math.max(0, Math.min(15, Math.round(num(p.settings.wait_s))));
    if (p.settings.revert_min !== undefined) s.revert_min = Math.max(5, Math.min(1440, Math.round(num(p.settings.revert_min))));
    if (p.settings.colour !== undefined && /^#[0-9a-f]{6}$/i.test(str(p.settings.colour))) s.colour = str(p.settings.colour);
    if (p.settings.logo !== undefined) s.logo = /^https:\/\//.test(str(p.settings.logo)) ? str(p.settings.logo) : '';
    if (p.settings.daily_cap !== undefined) s.daily_cap = Math.max(1, Math.min(500, Math.round(num(p.settings.daily_cap))));
    if (p.settings.site !== undefined) s.site = str(p.settings.site).slice(0, 200);
    if (p.settings.waba_id !== undefined) s.waba_id = str(p.settings.waba_id).replace(/[^0-9]/g, '').slice(0, 30);
    if (ch.kind === 'email') {   // 134: the mailbox's servers (a preset fills them on the page)
      for (const k of ['imap_host', 'smtp_host']) if (p.settings[k] !== undefined) s[k] = str(p.settings[k]).toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 120);
      if (p.settings.imap_port !== undefined) s.imap_port = Math.round(num(p.settings.imap_port)) || 993;
      if (p.settings.smtp_port !== undefined) s.smtp_port = Math.round(num(p.settings.smtp_port)) || 465;
      if (p.settings.user !== undefined) s.user = str(p.settings.user).slice(0, 200);
      if (p.settings.from_name !== undefined) s.from_name = str(p.settings.from_name).replace(/[\r\n"<>]/g, '').slice(0, 80);
    }
    await ctx.tx`update inbox_channels set settings = ${ctx.tx.json(s)} where id = ${ch.id}`;
  }
  ch = await chOf(ctx, ch.id);
  // connect the platform side where we can
  const done = {};
  if ((ch.kind === 'messenger') && await chSecret(ctx, ch, 'TOKEN')) done.subscribe = await metaSubscribe(ctx, ch);
  if (ch.kind === 'wa_evo' && await chSecret(ctx, ch, 'URL') && hookUrl(ctx, ch)) done.hook = await evoSetHook(ctx, ch, hookUrl(ctx, ch));
  if (ch.kind === 'email' && (p.secrets && str(p.secrets.PASSWORD) || p.settings)) done.mail = await (await import('./inboxmail.js')).mailConnect(ctx, ch);
  return { ...(await erpInboxChannels(ctx)), done };
}
/** AI on / off for a channel (for a time, or until switched on), comments on / off, removed. */
export async function erpInboxChannelAct(ctx, payload) {
  owner(ctx);
  const p = payload || {};
  if (p.action === 'pauseall' || p.action === 'resumeall') {
    await ctx.tx`update inbox_channels set ai_on = ${p.action === 'resumeall'}, ai_off_until = null where business_id = ${ctx.biz} and status <> 'removed'`;
    return erpInboxChannels(ctx);
  }
  const ch = await chOf(ctx, str(p.id));
  if (!ch) throw new Error('No such channel.');
  if (p.action === 'ai') {
    const mins = num(p.minutes);
    await ctx.tx`update inbox_channels set ai_on = ${!!p.on || mins > 0}, ai_off_until = ${!p.on && mins > 0 ? new Date(ctx.now.getTime() + mins * 60e3) : null} where id = ${ch.id}`;
  } else if (p.action === 'comments') await ctx.tx`update inbox_channels set comments_ai = ${!!p.on} where id = ${ch.id}`;
  else if (p.action === 'remove') {
    await ctx.tx`update inbox_channels set status = 'removed' where id = ${ch.id}`;
    for (const k of ['TOKEN', 'APP_SECRET', 'URL', 'KEY', 'HOOK_SECRET', 'VERIFY', 'PASSWORD']) await chSecretSet(ctx, ch, k, '');
  } else if (p.action === 'practice') await ctx.tx`update inbox_channels set status = 'practice' where id = ${ch.id}`;
  else if (p.action === 'qr') { if (ch.kind !== 'wa_evo') throw new Error('Only for an Evolution WhatsApp.'); return { qr: await evoQr(ctx, ch), state: await evoState(ctx, ch) }; }
  else if (p.action === 'state') return { state: ch.kind === 'wa_evo' ? await evoState(ctx, ch) : { state: ch.status } };
  else if (p.action === 'mailcheck') {   // 134: try the mailbox now (reading and sending)
    if (ch.kind !== 'email') throw new Error('Only for an e-mail channel.');
    const r = await (await import('./inboxmail.js')).mailConnect(ctx, ch);
    return { ...(await erpInboxChannels(ctx)), done: { mail: r } };
  }
  else throw new Error('Unknown action.');
  return erpInboxChannels(ctx);
}
/** Go live: details written, an AI key, and three usual questions answered by the agent (asked by itself). */
export async function erpInboxGoLive(ctx, payload) {
  owner(ctx);
  const ch = await chOf(ctx, str(payload && payload.id));
  if (!ch) throw new Error('No such channel.');
  const pr = await profile(ctx, false);
  const missing = [];
  if (!pr.name) missing.push('the business name');
  if (!pr.sells) missing.push('what you sell');
  if (!(await (await import('../lib/ai.js')).anyAi(ctx))) missing.push('an AI key');
  for (const k of NEEDS[ch.kind]) if (!(await chSecret(ctx, ch, k))) missing.push(k.toLowerCase().replace('_', ' '));
  if (missing.length) throw new Error('Before going live: ' + missing.join(', ') + '.');
  const qs = ['What do you sell?', 'What is the delivery charge?', 'Are you open today?'];
  const answers = [];
  for (const q of qs) {
    const r = await agentReply(ctx, { id: null, channel_id: ch.id }, { test: true, channel: ch, contact: { name: 'Test', external_id: 'test' }, history: [{ direction: 'in', kind: 'text', text: q }] });
    const t = (r.replies || []).map((x) => x.text || (x.cards ? x.cards.map((c) => c.title).join(', ') : '')).join(' ').trim();
    answers.push({ q, a: t });
    if (!t) throw new Error('The AI did not answer "' + q + '" - check the AI key and try again.');
  }
  await ctx.tx`update inbox_channels set status = 'live' where id = ${ch.id}`;
  return { live: true, answers, ...(await erpInboxChannels(ctx)) };
}

// ------------------------------------------------------------------ the business's details (setup) - saved at once; the Agent Desk keeps drafts
export async function erpInboxProfile(ctx, payload) {
  need(ctx, 'manager');
  const p = payload || {};
  if (p.save) {
    owner(ctx);
    const cur = await profile(ctx, false), next = { ...cur };
    for (const k of Object.keys(PROFILE_DEFAULTS)) {
      if (p.save[k] === undefined) continue;
      const d = PROFILE_DEFAULTS[k];
      next[k] = typeof d === 'number' ? Math.max(0, num(p.save[k])) : typeof d === 'boolean' ? !!p.save[k] : typeof d === 'object' ? { ...d, ...(p.save[k] || {}) } : str(p.save[k]).slice(0, 2000);
    }
    if (!['bn', 'en', 'both'].includes(next.lang)) next.lang = 'both';
    if (!['sir', 'bhai'].includes(next.style)) next.style = 'sir';
    if (!['shop', 'services', 'both'].includes(next.biz_type)) next.biz_type = 'shop';
    if (!['fixed', 'limit'].includes(next.disc_mode)) next.disc_mode = 'fixed';
    next.disc_max_pct = Math.min(50, next.disc_max_pct); next.disc_min_margin = Math.min(500, next.disc_min_margin);
    await setConfig(ctx, 'inbox_profile', JSON.stringify(next));
  }
  return { profile: await profile(ctx, false), draft: await profile(ctx, true), hasDraft: !!(await getConfig(ctx, 'inbox_profile_draft', '')) };
}

// ------------------------------------------------------------------ the Agent Desk
/** Rules: list, add / change (a draft), publish, undo, switch on/off, archive; test (customer's-phone view). */
export async function erpAgentDesk(ctx, payload) {
  need(ctx, 'manager');
  const p = payload || {};
  const a = str(p.action);
  if (a && a !== 'list') owner(ctx);
  if (a === 'add') {
    if (!str(p.title) || !str(p.body)) throw new Error('A rule needs a name and what it says.');
    await ctx.tx`insert into agent_rules (business_id, title, body, draft, version, updated_by) values (${ctx.biz}, ${str(p.title).slice(0, 80)}, '', ${str(p.body).slice(0, 4000)}, 0, ${ctx.s.name})`;
  } else if (a === 'edit') {
    await ctx.tx`update agent_rules set draft = ${str(p.body).slice(0, 4000)}, title = coalesce(${str(p.title) || null}, title), updated_by = ${ctx.s.name}, updated_at = now() where business_id = ${ctx.biz} and id = ${str(p.id)}`;
  } else if (a === 'discard') {
    await ctx.tx`update agent_rules set draft = null where business_id = ${ctx.biz} and id = ${str(p.id)}`;
    await setConfig(ctx, 'inbox_profile_draft', '');
  } else if (a === 'publish') {
    for (const r of await ctx.tx`select * from agent_rules where business_id = ${ctx.biz} and draft is not null and not archived`) {
      const v = r.version + 1;
      await ctx.tx`update agent_rules set body = ${r.draft}, draft = null, version = ${v}, updated_by = ${ctx.s.name}, updated_at = now() where id = ${r.id}`;
      await ctx.tx`insert into agent_rule_versions (business_id, rule_id, version, body, by_name) values (${ctx.biz}, ${r.id}, ${v}, ${r.draft}, ${ctx.s.name})`;
    }
    const d = await getConfig(ctx, 'inbox_profile_draft', '');
    if (d) {
      const cur = await profile(ctx, false), next = { ...cur }, dj = JSON.parse(d);
      await setConfig(ctx, 'inbox_profile_prev', JSON.stringify(cur));
      Object.assign(next, dj);
      await setConfig(ctx, 'inbox_profile', JSON.stringify(next));
      await setConfig(ctx, 'inbox_profile_draft', '');
    }
  } else if (a === 'undo') {
    const r = (await ctx.tx`select * from agent_rules where business_id = ${ctx.biz} and id = ${str(p.id)}`)[0];
    if (r) {
      if (r.draft !== null) throw new Error('Publish or discard the open draft first.');
      const prev = (await ctx.tx`select body, version from agent_rule_versions where rule_id = ${r.id} and version < ${r.version} order by version desc limit 1`)[0];
      if (!prev) throw new Error('There is no earlier version.');
      await ctx.tx`update agent_rules set body = ${prev.body}, version = ${r.version + 1}, updated_by = ${ctx.s.name}, updated_at = now() where id = ${r.id}`;
      await ctx.tx`insert into agent_rule_versions (business_id, rule_id, version, body, by_name) values (${ctx.biz}, ${r.id}, ${r.version + 1}, ${prev.body}, ${ctx.s.name + ' (undo)'})`;
    } else if (str(p.id) === 'details') {
      const prev = await getConfig(ctx, 'inbox_profile_prev', '');
      if (!prev) throw new Error('There is no earlier version of the details.');
      await setConfig(ctx, 'inbox_profile', prev);
      await setConfig(ctx, 'inbox_profile_prev', '');
    }
  } else if (a === 'toggle') {
    await ctx.tx`update agent_rules set enabled = not enabled, updated_by = ${ctx.s.name}, updated_at = now() where business_id = ${ctx.biz} and id = ${str(p.id)}`;
  } else if (a === 'archive') {
    await ctx.tx`update agent_rules set archived = true, updated_by = ${ctx.s.name}, updated_at = now() where business_id = ${ctx.biz} and id = ${str(p.id)}`;
  } else if (a === 'test') {
    // a test conversation in the customer's-phone view, with the DRAFT rules and details; nothing is sent or booked
    const hist = (Array.isArray(p.history) ? p.history : []).slice(-20).map((m) => ({ direction: m.mine ? 'in' : 'out', kind: 'text', text: str(m.text).slice(0, 1500) }));
    if (!hist.length || hist[hist.length - 1].direction !== 'in') throw new Error('Type a test message.');
    const ch = (await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and status <> 'removed' order by (kind = 'messenger') desc, created_at limit 1`)[0]
      || { id: null, kind: 'messenger', settings: {}, status: 'practice' };
    const r = await agentReply(ctx, { id: null, channel_id: ch.id }, { test: true, channel: ch, contact: { name: 'Test customer', external_id: 'test' }, history: hist });
    return { replies: r.replies, handover: r.handover ? REASONS[r.handover.reason] : '', order: r.order ? r.order.no : '', tools: r.calls };
  } else if (a === 'helper') {
    // "make the delivery charge 80": the helper reads what is set, proposes the change as a draft (rule or detail), and says what it did
    return deskHelper(ctx, str(p.text));
  }
  const rules = await ctx.tx`select r.*, (select count(*)::int from agent_rule_versions v where v.rule_id = r.id) as versions from agent_rules r where r.business_id = ${ctx.biz} and not r.archived order by r.updated_at`;
  const pd = await getConfig(ctx, 'inbox_profile_draft', '');
  return { rules: rules.map((r) => ({ id: r.id, title: r.title, body: r.body, draft: r.draft, enabled: r.enabled, version: r.version, versions: r.versions, by: str(r.updated_by), at: formatDate(new Date(r.updated_at), 'd MMM, h:mm a') })),
           details: await profile(ctx, false), detailsDraft: pd ? JSON.parse(pd) : null, hasPrevDetails: !!(await getConfig(ctx, 'inbox_profile_prev', '')),
           drafts: rules.filter((r) => r.draft !== null).length + (pd ? 1 : 0) };
}
async function deskHelper(ctx, text) {
  if (!text) throw new Error('Tell the helper what to change.');
  const cur = await profile(ctx, true);
  const rules = await ctx.tx`select id, title, coalesce(draft, body) as body from agent_rules where business_id = ${ctx.biz} and not archived`;
  const { parts } = await gemini(ctx, { systemInstruction: { parts: [{ text:
    'You help a shop owner change what their customer chat agent knows. Current details (JSON): ' + JSON.stringify(cur) + '. Current rules: ' + JSON.stringify(rules.map((r) => ({ id: r.id, title: r.title, body: r.body }))) +
    '. Reply with JSON only: {"say": a short sentence to the owner saying what is set now and what you will change (in the owner\'s language), "details": {only the changed detail fields, same keys} or null, ' +
    '"rule": {"id": an existing rule id or "", "title": "", "body": ""} or null, "fact": a fact to file in the knowledge base or ""}. Delivery charges: delivery_in (inside Dhaka), delivery_out (outside). Do not invent anything the owner did not say.' }] },
    contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { temperature: 0 } }, 'desk', null);
  const j = jsonOf(parts) || {};
  const did = [];
  if (j.details && typeof j.details === 'object' && Object.keys(j.details).length) {
    const dPrev = await getConfig(ctx, 'inbox_profile_draft', '');
    const d = { ...(dPrev ? JSON.parse(dPrev) : {}) };
    for (const k of Object.keys(j.details)) if (PROFILE_DEFAULTS[k] !== undefined) d[k] = typeof PROFILE_DEFAULTS[k] === 'number' ? num(j.details[k]) : j.details[k];
    await setConfig(ctx, 'inbox_profile_draft', JSON.stringify(d));
    did.push('details: ' + Object.keys(j.details).join(', '));
  }
  if (j.rule && str(j.rule.body)) {
    const ex = j.rule.id ? rules.find((r) => r.id === j.rule.id) : null;
    if (ex) await ctx.tx`update agent_rules set draft = ${str(j.rule.body)}, updated_by = ${ctx.s.name}, updated_at = now() where id = ${ex.id}`;
    else await ctx.tx`insert into agent_rules (business_id, title, body, draft, version, updated_by) values (${ctx.biz}, ${str(j.rule.title) || 'Rule'}, '', ${str(j.rule.body)}, 0, ${ctx.s.name})`;
    did.push('rule: ' + (str(j.rule.title) || (ex && ex.title) || 'new'));
  }
  if (str(j.fact)) { await kbAdd(ctx, 'From the Agent Desk', 'text', str(j.fact)); did.push('knowledge base'); }
  return { say: str(j.say) || (did.length ? 'Drafted.' : 'Nothing to change.'), drafted: did, ...(await erpAgentDesk(ctx, {})) };
}

// ------------------------------------------------------------------ knowledge base
export async function kbAdd(ctx, title, kind, body) {
  const d = (await ctx.tx`insert into kb_docs (business_id, title, kind, body, created_by) values (${ctx.biz}, ${title}, ${kind}, ${body}, ${ctx.s.name}) returning id`)[0];
  const parts = [];
  if (kind === 'qa') parts.push(body);
  else {
    const paras = body.split(/\n\s*\n|(?<=[.!?।])\s+(?=[A-Zঀ-৿])/);
    let cur = '';
    for (const x of paras) { if ((cur + ' ' + x).length > 700 && cur) { parts.push(cur.trim()); cur = x; } else cur += ' ' + x; }
    if (cur.trim()) parts.push(cur.trim());
  }
  for (const t of parts) await ctx.tx`insert into kb_chunks (business_id, doc_id, text) values (${ctx.biz}, ${d.id}, ${t})`;
  return d.id;
}
export async function erpInboxKb(ctx, payload) {
  await needFeat(ctx, 'knowledge');
  need(ctx, 'manager');
  const p = payload || {};
  if (p.add) {
    owner(ctx);
    const kind = ['text', 'qa', 'file'].includes(p.add.kind) ? p.add.kind : 'text';
    let body = str(p.add.body);
    if (kind === 'qa') body = 'Q: ' + str(p.add.q) + '\nA: ' + str(p.add.a);
    if (body.length < 3) throw new Error('Nothing to add.');
    if (body.length > 200000) throw new Error('That document is too long (200,000 characters at most).');
    await kbAdd(ctx, str(p.add.title) || (kind === 'qa' ? str(p.add.q).slice(0, 80) : 'Document'), kind, body);
  }
  if (p.archive) { owner(ctx); await ctx.tx`update kb_docs set archived = true where business_id = ${ctx.biz} and id = ${str(p.archive)}`; }
  if (p.test) return { found: await kbSearch(ctx, p.test) };
  const docs = await ctx.tx`select d.id, d.title, d.kind, left(d.body, 300) as body, d.created_at, d.created_by, (select count(*)::int from kb_chunks k where k.doc_id = d.id) as chunks
                            from kb_docs d where d.business_id = ${ctx.biz} and not d.archived order by d.created_at desc`;
  return { docs: docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind, body: d.body, chunks: d.chunks, by: str(d.created_by), at: formatDate(new Date(d.created_at), 'd MMM yy') })) };
}

// ------------------------------------------------------------------ special offers
export async function erpShopOffers(ctx, payload) {
  await needFeat(ctx, 'offers');
  need(ctx, 'manager');
  const p = payload || {};
  if (p.add) { owner(ctx); if (!str(p.add.label)) throw new Error('Name the offer.');
    await ctx.tx`insert into shop_offers (business_id, label, sku, detail, starts_on, ends_on) values (${ctx.biz}, ${str(p.add.label)}, ${str(p.add.sku) || null}, ${str(p.add.detail) || null},
                 ${str(p.add.starts) || null}, ${str(p.add.ends) || null})`; }
  if (p.toggle) { owner(ctx); await ctx.tx`update shop_offers set active = not active where business_id = ${ctx.biz} and id = ${str(p.toggle)}`; }
  const rows = await ctx.tx`select * from shop_offers where business_id = ${ctx.biz} order by active desc, created_at desc`;
  return { offers: rows.map((r) => ({ id: r.id, label: r.label, sku: str(r.sku), detail: str(r.detail), starts: r.starts_on ? formatDate(new Date(r.starts_on), 'yyyy-MM-dd') : '', ends: r.ends_on ? formatDate(new Date(r.ends_on), 'yyyy-MM-dd') : '', active: r.active })) };
}

// ------------------------------------------------------------------ chat orders (approve -> invoice)
const HOLD = ['Could not reach the customer', 'Waiting for the advance payment', 'Pre-order', 'Out of stock', 'The customer asked to wait', 'The address needs checking', 'Something else'];
export async function erpChatOrders(ctx, payload) {
  await needFeat(ctx, 'orders');
  need(ctx);
  const p = payload || {};
  const st = ['pending', 'hold', 'approved', 'cancelled', 'all', 'today'].includes(p.status) ? p.status : 'pending';
  const q = str(p.q).toLowerCase();
  const today = formatDate(ctx.now, 'yyyy-MM-dd');
  // 135: the fake-order shield reads every open order once (chat, product page, landing page)
  try { await (await import('./landing.js')).shieldOpenOrders(ctx); } catch (_) { /* before 135 */ }
  const rows = await ctx.tx`select o.*, (select count(*)::int from chat_orders x where x.business_id = o.business_id and x.phone = o.phone and x.status in ('pending', 'hold') and x.id <> o.id) as dup
    from chat_orders o where o.business_id = ${ctx.biz}
      and (${st} = 'all' or (${st} = 'today' and o.status = 'hold' and o.follow_up_on <= ${today}) or o.status = ${st})
      and (${q} = '' or lower(o.no || ' ' || o.name || ' ' || o.phone) like ${'%' + q + '%'}) order by o.created_at desc limit 200`;
  const counts = (await ctx.tx`select count(*) filter (where status = 'pending')::int pending, count(*) filter (where status = 'hold')::int hold,
    count(*) filter (where status = 'approved')::int approved, count(*) filter (where status = 'cancelled')::int cancelled,
    count(*) filter (where status = 'hold' and follow_up_on <= ${today})::int today from chat_orders where business_id = ${ctx.biz}`)[0];
  const out = [];
  for (const o of rows) {
    let inv = null;
    if (o.invoice_no) inv = (await ctx.tx`select delivery_status, payment_status, due_amount from invoices where business_id = ${ctx.biz} and invoice_no = ${o.invoice_no}`)[0] || null;
    const ev = await ctx.tx`select what, by_name, at from chat_order_events where order_id = ${o.id} order by id`;
    out.push({ id: o.id, no: o.no, name: o.name, phone: o.phone, address: o.address, items: o.items, delivery: num(o.delivery_charge), deliverySaid: o.delivery_said, note: str(o.note),
      status: o.status, hold: str(o.hold_reason), followUp: o.follow_up_on ? formatDate(new Date(o.follow_up_on), 'yyyy-MM-dd') : '', cancel: str(o.cancel_reason), invoice: str(o.invoice_no),
      takenBy: o.taken_by, change: str(o.change_request), rating: o.rating, dup: o.dup > 0, conv: o.conversation_id, risk: o.risk || null, landing: !!o.landing_id,
      total: (o.items || []).reduce((t, x) => t + num(x.qty) * num(x.price), 0) + num(o.delivery_charge), at: formatDate(new Date(o.created_at), 'd MMM, h:mm a'),
      delivery_status: inv ? str(inv.delivery_status) : '', paid: inv ? str(inv.payment_status) : '', history: ev.map((e) => ({ what: e.what, by: str(e.by_name), at: formatDate(new Date(e.at), 'd MMM h:mm a') })) });
  }
  return { orders: out, counts, holdReasons: HOLD };
}
export async function erpChatOrderAct(ctx, payload) {
  need(ctx);
  const p = payload || {};
  const o = (await ctx.tx`select * from chat_orders where business_id = ${ctx.biz} and id = ${str(p.id)} for update`)[0];
  if (!o) throw new Error('No such order.');
  const by = ctx.s.name;
  if (p.action === 'approve') {
    if (o.status === 'approved') throw new Error('Already approved: ' + o.invoice_no);
    if (o.status === 'cancelled') throw new Error('A cancelled order cannot be approved.');
    const conv = o.conversation_id ? (await ctx.tx`select v.*, ch.kind from inbox_conversations v join inbox_channels ch on ch.id = v.channel_id where v.id = ${o.conversation_id}`)[0] : null;
    const channel = conv ? ({ messenger: 'Facebook', instagram: 'Instagram', wa_cloud: 'WhatsApp', wa_evo: 'WhatsApp', wa_sender: 'WhatsApp', webchat: 'Website', email: 'Email' }[conv.kind] || 'Other') : 'Other';
    const H = (await import('./index.js')).HANDLERS;
    const res = await H.erpCreateInvoice(ctx, {
      customer: { name: o.name, phone: o.phone, address: o.address, source: str(p.delivery) || 'Steadfast courier' },
      items: (o.items || []).map((x) => ({ sku: x.sku, qty: num(x.qty) })), deliveryCharge: num(o.delivery_charge),
      payMode: 'cod', paymentMethod: 'COD', channel, note: 'Chat order ' + o.no + (o.note ? ' · ' + o.note : ''),
    });
    await ctx.tx`update chat_orders set status = 'approved', invoice_no = ${res.invoiceNo}, approved_at = now() where id = ${o.id}`;
    await orderEvent(ctx, o.id, 'Approved → invoice ' + res.invoiceNo, by);
    // tell the customer the order is being prepared (when that update is on)
    await notifyOrder(ctx, { ...o, invoice_no: res.invoiceNo }, 'preparing');
    return { invoiceNo: res.invoiceNo, ...(await erpChatOrders(ctx, { status: 'pending' })) };
  }
  if (p.action === 'hold') {
    if (o.status !== 'pending') throw new Error('Only a pending order is put on hold.');
    await ctx.tx`update chat_orders set status = 'hold', hold_reason = ${str(p.reason) || 'Something else'}, follow_up_on = ${str(p.followUp) || null} where id = ${o.id}`;
    await orderEvent(ctx, o.id, 'On hold: ' + (str(p.reason) || 'Something else') + (p.note ? ' — ' + str(p.note) : ''), by);
  } else if (p.action === 'release') {
    await ctx.tx`update chat_orders set status = 'pending', hold_reason = null, follow_up_on = null where id = ${o.id} and status = 'hold'`;
    await orderEvent(ctx, o.id, 'Released from hold', by);
  } else if (p.action === 'cancel') {
    if (o.status === 'approved') throw new Error('Approved: cancel the invoice ' + o.invoice_no + ' on the Sales screen instead.');
    if (!str(p.reason)) throw new Error('Pick the reason.');
    await ctx.tx`update chat_orders set status = 'cancelled', cancel_reason = ${str(p.reason)} where id = ${o.id}`;
    await orderEvent(ctx, o.id, 'Cancelled: ' + str(p.reason), by);
    if (!/duplicate|fake|test|wrong/i.test(str(p.reason))) await notifyOrder(ctx, o, 'cancelled');
  } else if (p.action === 'edit') {
    if (o.status === 'approved' || o.status === 'cancelled') throw new Error('This order can no longer be changed here.');
    await ctx.tx`update chat_orders set name = coalesce(${str(p.name) || null}, name), phone = coalesce(${str(p.phone) || null}, phone), address = coalesce(${str(p.address) || null}, address),
                 delivery_charge = coalesce(${p.delivery !== undefined && p.delivery !== '' ? num(p.delivery) : null}, delivery_charge), note = coalesce(${p.note !== undefined ? str(p.note) : null}, note),
                 items = coalesce(${Array.isArray(p.items) ? ctx.tx.json(p.items.map((x) => ({ sku: str(x.sku), name: str(x.name), qty: Math.max(1, num(x.qty)), price: num(x.price) }))) : null}, items) where id = ${o.id}`;
    await orderEvent(ctx, o.id, 'Edited', by);
  } else if (p.action === 'note') {
    if (!str(p.note)) throw new Error('Write the note.');
    await orderEvent(ctx, o.id, 'Note: ' + str(p.note), by);
  } else throw new Error('Unknown action.');
  return erpChatOrders(ctx, { status: str(p.back) || 'pending' });
}
/** Tell the customer about their order in its chat (the updates the owner switched on; inside Meta's window). */
async function notifyOrder(ctx, o, what, extra) {
  if (!o.conversation_id) return false;
  const pr = await profile(ctx, false);
  if (!(pr.updates || {})[what === 'delivered' ? 'courier' : what] && what !== 'review') return false;
  const v = (await ctx.tx`select * from inbox_conversations where id = ${o.conversation_id}`)[0];
  if (!v) return false;
  const ch = (await ctx.tx`select * from inbox_channels where id = ${v.channel_id}`)[0], c = (await ctx.tx`select * from inbox_contacts where id = ${v.contact_id}`)[0];
  if (!ch || ch.status === 'removed') return false;
  const bn = pr.lang !== 'en';
  const T = {
    preparing: bn ? 'আপনার অর্ডার ' + o.no + ' প্রস্তুত করা হচ্ছে।' : 'Your order ' + o.no + ' is being prepared.',
    courier: bn ? 'আপনার পার্সেল কুরিয়ারে দেওয়া হয়েছে (' + o.no + ')।' : 'Your parcel has been handed to the courier (' + o.no + ').',
    out: bn ? 'আপনার পার্সেল আজ ডেলিভারির জন্য বের হয়েছে।' : 'Your parcel is out for delivery today.',
    failed: bn ? 'আপনার পার্সেল ডেলিভারি করা যায়নি। আমরা যোগাযোগ করব।' : 'Your parcel could not be delivered. We will get in touch.',
    delivered: bn ? 'আপনার পার্সেল পৌঁছে গেছে। ধন্যবাদ!' : 'Your parcel has been delivered. Thank you!',
    cancelled: bn ? 'আপনার অর্ডার ' + o.no + ' বাতিল করা হয়েছে।' : 'Your order ' + o.no + ' has been cancelled.',
    review: (bn ? 'পণ্যটি কেমন লাগলো? আমাদের পেজে একটি রিভিউ দিলে খুব খুশি হবো: ' : 'How did you like it? A review on our page would mean a lot: ') + str(pr.review_link),
  };
  if (!T[what]) return false;
  if (CAN[ch.kind].window24 && !inWindow(ch, v, ctx.now)) {
    // after 24 h only a template Meta approved (Messenger, official WhatsApp): courier updates and the review request - never an offer
    const key = { courier: 'order_courier', out: 'order_out', failed: 'order_problem', review: 'review' }[what];
    if (!key) return false;
    const total = (o.items || []).reduce((t, x) => t + num(x.qty) * num(x.price), 0) + num(o.delivery_charge);
    const params = key === 'order_courier' ? [o.name, o.no, pr.name] : key === 'order_out' ? [o.name, o.no, 'Tk ' + Math.round(total).toLocaleString('en-IN')] : [o.name, o.no];
    return viaTemplate(ctx, ch, v, c, key, params, key !== 'review' && o.page_token && await feat(ctx, 'order_page') ? orderSuffix(ctx, o) : '', T[what]);
  }
  // the order's own page carries the Track button
  const link = ['courier', 'out', 'failed', 'preparing'].includes(what) && o.page_token && await feat(ctx, 'order_page') ? (bn ? '\nঅবস্থা ও ট্র্যাক: ' : '\nStatus and tracking: ') + orderLink(ctx, o) : '';
  const r = await deliver(ctx, ch, v, c, { kind: 'text', text: T[what] + (extra ? ' ' + extra : '') + link, payload: { courier: what } }, { author: 'system' });
  return r.ok;
}
/** The timer: delivery status changes of approved chat orders go to the customer; a review request a day after delivery. */
export async function orderUpdates(ctx) {
  let n = 0;
  const pr = await profile(ctx, false);
  const rows = await ctx.tx`select o.*, i.delivery_status from chat_orders o join invoices i on i.business_id = o.business_id and i.invoice_no = o.invoice_no
                            where o.business_id = ${ctx.biz} and o.status = 'approved' and o.approved_at > ${new Date(ctx.now.getTime() - 30 * H24)} limit 100`;
  for (const o of rows) {
    const ds = str(o.delivery_status).toLowerCase();
    const stage = /deliver(ed)?$|^delivered|complete/.test(ds) ? 'delivered' : /out for|on the way/.test(ds) ? 'out' : /return|cancel|fail|hold/.test(ds) ? 'failed' : /shipped|sent|courier|transit|booked|picked/.test(ds) ? 'courier' : '';
    if (stage && stage !== o.notified_status) {
      await ctx.tx`update chat_orders set notified_status = ${stage} where id = ${o.id}`;
      if (await notifyOrder(ctx, o, stage)) n++;
    }
    if (stage === 'delivered' && pr.review_on && pr.review_link && !o.review_asked_at && o.notified_status === 'delivered') {
      await ctx.tx`update chat_orders set review_asked_at = now() where id = ${o.id}`;
      if (await notifyOrder(ctx, o, 'review')) n++;
    }
  }
  return n;
}

// ------------------------------------------------------------------ bookings (service businesses)
export async function erpBookings(ctx, payload) {
  await needFeat(ctx, 'bookings');
  need(ctx);
  const p = payload || {};
  const st = ['requested', 'proposed', 'confirmed', 'declined', 'cancelled', 'done', 'all', 'upcoming'].includes(p.status) ? p.status : 'requested';
  const rows = await ctx.tx`select * from bookings where business_id = ${ctx.biz}
    and (${st} = 'all' or (${st} = 'upcoming' and status = 'confirmed' and at >= ${ctx.now}) or status = ${st}) order by coalesce(at, created_at) ${st === 'upcoming' ? ctx.tx`asc` : ctx.tx`desc`} limit 200`;
  const counts = (await ctx.tx`select count(*) filter (where status = 'requested')::int requested, count(*) filter (where status = 'proposed')::int proposed,
    count(*) filter (where status = 'confirmed' and at >= ${ctx.now})::int upcoming, count(*) filter (where trx_id is not null and not paid)::int unpaid from bookings where business_id = ${ctx.biz}`)[0];
  const out = [];
  for (const b of rows) {
    const ev = await ctx.tx`select what, by_name, at from booking_events where booking_id = ${b.id} order by id`;
    out.push({ id: b.id, no: b.no, name: b.name, phone: str(b.phone), service: b.service, wanted: str(b.wanted), at: b.at ? formatDate(new Date(b.at), 'EEE d MMM, h:mm a') : '',
      atIso: b.at ? formatDate(new Date(b.at), 'yyyy-MM-dd HH:mm').replace(' ', 'T') : '', place: str(b.place), bring: str(b.bring), answers: b.answers || {}, status: b.status, reason: str(b.reason),
      advance: b.advance === null ? null : num(b.advance), trx: str(b.trx_id), paid: b.paid, conv: b.conversation_id,
      history: ev.map((e) => ({ what: e.what, by: str(e.by_name), at: formatDate(new Date(e.at), 'd MMM h:mm a') })) });
  }
  return { bookings: out, counts };
}
async function bookingTell(ctx, b, text, tpl) {
  if (!b.conversation_id) return null;     // made by hand, no chat: nothing to tell
  const v = (await ctx.tx`select * from inbox_conversations where id = ${b.conversation_id}`)[0];
  if (!v) return false;
  const ch = await chOf(ctx, v.channel_id), c = (await ctx.tx`select * from inbox_contacts where id = ${v.contact_id}`)[0];
  if (!ch || ch.status === 'removed' || ch.kind === 'webchat') return false;   // the website chat gets no confirmations yet (as AiPraktor)
  if (CAN[ch.kind].window24 && !inWindow(ch, v, ctx.now)) return tpl ? viaTemplate(ctx, ch, v, c, tpl.key, tpl.params, '', text) : false;   // after 24 h: a Meta-approved template or nothing
  const r = await deliver(ctx, ch, v, c, { kind: 'text', text }, { author: 'system' });
  return r.ok;
}
/** A message after Meta's 24 hours: the approved template, written into the chat; false when there is none. */
async function viaTemplate(ctx, ch, v, c, key, params, suffix, shown) {
  if (!['messenger', 'wa_cloud'].includes(ch.kind) || !(await feat(ctx, 'templates'))) return false;
  const st = (ch.settings || {}).templates || {}, lang = (ch.settings || {}).templates_lang || 'bn';
  if (st[templateName(key, lang)] !== 'APPROVED') return false;
  const r = await sendTemplate(ctx, ch, c, key, lang, params, suffix);
  try { await writeMsg(ctx, v, { direction: 'out', author: 'system', kind: 'text', text: shown + ' [template]', status: r.ok ? 'sent' : 'failed', error: r.ok ? null : r.error, externalId: r.externalId || null }); } catch (_) { /* the history is not the reason it fails */ }
  return r.ok;
}
function bookingText(pr, b) {
  const bn = pr.lang !== 'en';
  const when = b.at ? formatDate(new Date(b.at), 'EEEE d MMMM, h:mm a') : '';
  return (bn ? 'আপনার বুকিং নিশ্চিত হয়েছে: ' : 'Your booking is confirmed: ') + b.service + (when ? ' — ' + when : '') + (b.place ? ' — ' + b.place : '') + (b.bring ? (bn ? '\nসাথে আনবেন: ' : '\nPlease bring: ') + b.bring : '') + ' (' + b.no + ')';
}
export async function erpBookingAct(ctx, payload) {
  await needFeat(ctx, 'bookings');
  need(ctx);
  const p = payload || {};
  const b = (await ctx.tx`select * from bookings where business_id = ${ctx.biz} and id = ${str(p.id)} for update`)[0];
  if (!b) throw new Error('No such booking.');
  const pr = await profile(ctx, false), by = ctx.s.name, bn = pr.lang !== 'en';
  let told = null;
  if (p.action === 'confirm' || p.action === 'propose') {
    const at = str(p.at) ? new Date(str(p.at) + (str(p.at).length <= 16 ? ':00+06:00' : '')) : null;
    if (!at || isNaN(at.getTime())) throw new Error('Pick the date and time.');
    await ctx.tx`update bookings set status = ${p.action === 'confirm' ? 'confirmed' : 'proposed'}, at = ${at}, place = coalesce(${str(p.place) || null}, place), bring = coalesce(${str(p.bring) || null}, bring),
                 reminded_day = false, reminded_hours = false where id = ${b.id}`;
    const nb = (await ctx.tx`select * from bookings where id = ${b.id}`)[0];
    await ctx.tx`insert into booking_events (business_id, booking_id, what, by_name) values (${ctx.biz}, ${b.id}, ${(p.action === 'confirm' ? 'Confirmed for ' : 'Proposed ') + formatDate(at, 'd MMM h:mm a')}, ${by})`;
    told = await bookingTell(ctx, nb, p.action === 'confirm' ? bookingText(pr, nb) : (bn ? 'এই সময়টা কি আপনার সুবিধা হবে? ' : 'Would this time suit you? ') + nb.service + ' — ' + formatDate(at, 'EEEE d MMMM, h:mm a') + ' (' + nb.no + ')',
      p.action === 'confirm' ? { key: 'booking_confirmed', params: [nb.name, nb.no, nb.service, formatDate(at, 'EEEE d MMMM, h:mm a')] } : null);
  } else if (p.action === 'decline' || p.action === 'cancel') {
    if (!str(p.reason)) throw new Error('Say why.');
    await ctx.tx`update bookings set status = ${p.action === 'decline' ? 'declined' : 'cancelled'}, reason = ${str(p.reason)} where id = ${b.id}`;
    await ctx.tx`insert into booking_events (business_id, booking_id, what, by_name) values (${ctx.biz}, ${b.id}, ${(p.action === 'decline' ? 'Declined: ' : 'Cancelled: ') + str(p.reason)}, ${by})`;
    told = await bookingTell(ctx, b, (bn ? 'দুঃখিত, আপনার বুকিং ' + b.no + ' নেওয়া যাচ্ছে না: ' : 'Sorry, your booking ' + b.no + ' cannot go ahead: ') + str(p.reason));
  } else if (p.action === 'paid') {
    if (!b.trx_id && !p.trx) throw new Error('No transaction id to confirm.');
    try { await ctx.tx`update bookings set paid = true, trx_id = coalesce(trx_id, ${str(p.trx) || null}), advance = coalesce(${p.amount ? num(p.amount) : null}, advance) where id = ${b.id}`; }
    catch (_) { throw new Error('That transaction id is already used on another booking.'); }
    await ctx.tx`insert into booking_events (business_id, booking_id, what, by_name) values (${ctx.biz}, ${b.id}, 'Advance received', ${by})`;
    await ctx.tx`update inbox_tasks set status = 'done', done_by = ${by}, done_at = now() where conversation_id = ${b.conversation_id} and kind = 'payment' and status = 'open'`;
    told = await bookingTell(ctx, b, bn ? 'আপনার অগ্রিম পেমেন্ট পাওয়া গেছে। ধন্যবাদ! (' + b.no + ')' : 'Your advance payment has been received. Thank you! (' + b.no + ')');
  } else if (p.action === 'done') {
    await ctx.tx`update bookings set status = 'done' where id = ${b.id}`;
    await ctx.tx`insert into booking_events (business_id, booking_id, what, by_name) values (${ctx.biz}, ${b.id}, 'Done', ${by})`;
  } else throw new Error('Unknown action.');
  const r = await erpBookings(ctx, { status: str(p.back) || 'requested' });
  return { ...r, told: told === null ? null : !!told };
}
/** The timer: a reminder the day before and a few hours before a confirmed booking (inside Meta's window). */
export async function bookingReminders(ctx) {
  const pr = await profile(ctx, false);
  if (pr.biz_type === 'shop' || !(await feat(ctx, 'bookings'))) return 0;
  let n = 0;
  const bn = pr.lang !== 'en';
  const hrs = Math.max(1, Math.min(12, num(pr.remind_hours) || 3));
  for (const b of await ctx.tx`select * from bookings where business_id = ${ctx.biz} and status = 'confirmed' and at > ${ctx.now} and at < ${new Date(ctx.now.getTime() + 26 * 3600e3)} limit 100`) {
    const left = new Date(b.at).getTime() - ctx.now.getTime();
    const line = b.service + ' — ' + formatDate(new Date(b.at), 'EEEE d MMMM, h:mm a') + (b.place ? ' — ' + b.place : '');
    if (pr.remind_day && !b.reminded_day && left <= H24 && left > hrs * 3600e3) {
      await ctx.tx`update bookings set reminded_day = true where id = ${b.id}`;
      if (await bookingTell(ctx, b, (bn ? 'মনে করিয়ে দিচ্ছি — আগামীকাল: ' : 'A reminder — tomorrow: ') + line, { key: 'booking_reminder', params: [b.name, b.no, b.service, formatDate(new Date(b.at), 'EEEE d MMMM, h:mm a')] })) n++;
    } else if (num(pr.remind_hours) > 0 && !b.reminded_hours && left <= hrs * 3600e3) {
      await ctx.tx`update bookings set reminded_hours = true, reminded_day = true where id = ${b.id}`;
      if (await bookingTell(ctx, b, (bn ? 'মনে করিয়ে দিচ্ছি — আর কয়েক ঘণ্টা পর: ' : 'A reminder — in a few hours: ') + line, { key: 'booking_reminder', params: [b.name, b.no, b.service, formatDate(new Date(b.at), 'EEEE d MMMM, h:mm a')] })) n++;
    }
  }
  return n;
}

// ------------------------------------------------------------------ leads
const STAGES = ['', 'New', 'Contacted', 'Interested', 'Quoted', 'Won', 'Lost'];
export async function erpInboxLeads(ctx, payload) {
  await needFeat(ctx, 'leads');
  need(ctx);
  const p = payload || {};
  if (p.save) {
    const s = p.save;
    if (s.id) {
      const old = (await ctx.tx`select * from inbox_leads where business_id = ${ctx.biz} and id = ${str(s.id)}`)[0];
      if (!old) throw new Error('No such lead.');
      await ctx.tx`update inbox_leads set stage = coalesce(${s.stage ? Math.max(1, Math.min(6, num(s.stage))) : null}, stage), name = coalesce(${s.name !== undefined ? str(s.name) : null}, name),
        phone = coalesce(${s.phone !== undefined ? str(s.phone) : null}, phone), email = coalesce(${s.email !== undefined ? str(s.email) : null}, email), want = coalesce(${s.want !== undefined ? str(s.want) : null}, want),
        value = coalesce(${s.value !== undefined && s.value !== '' ? num(s.value) : null}, value), priority = coalesce(${/^(low|normal|high)$/.test(str(s.priority)) ? str(s.priority) : null}, priority),
        follow_up_on = case when ${s.followUp !== undefined} then ${str(s.followUp) || null}::date else follow_up_on end, note = coalesce(${s.note !== undefined ? str(s.note) : null}, note),
        assigned_to = case when ${s.assign !== undefined} then ${str(s.assign) || null}::uuid else assigned_to end,
        assigned_name = case when ${s.assign !== undefined} then ${str(s.assignName) || null} else assigned_name end, updated_at = now() where id = ${old.id}`;
      if (s.stage && num(s.stage) !== old.stage) await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${old.id}, ${'Stage: ' + STAGES[num(s.stage)]}, ${ctx.s.name})`;
      if (s.note !== undefined && str(s.note) !== str(old.note)) await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${old.id}, ${'Note: ' + str(s.note)}, ${ctx.s.name})`;
    } else {
      if (!str(s.name) && !str(s.phone)) throw new Error('A lead needs a name or a phone.');
      const r = (await ctx.tx`insert into inbox_leads (business_id, name, phone, email, want, stage, value, source, follow_up_on, note)
        values (${ctx.biz}, ${str(s.name) || null}, ${str(s.phone) || null}, ${str(s.email) || null}, ${str(s.want) || null}, 1, ${s.value ? num(s.value) : null}, 'team', ${str(s.followUp) || null}, ${str(s.note) || null}) returning id`)[0];
      await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${r.id}, 'Added by hand', ${ctx.s.name})`;
    }
  }
  const today = formatDate(ctx.now, 'yyyy-MM-dd');
  // a teammate (sales) sees the leads given to them and the unassigned ones; a manager and the owner see all
  const mineOnly = !roleAtLeast(ctx.s.role, 'manager');
  const rows = await ctx.tx`select * from inbox_leads where business_id = ${ctx.biz} and (${!mineOnly} or assigned_to is null or assigned_to = ${ctx.s.userId})
                            order by (follow_up_on is not null and follow_up_on <= ${today}) desc, updated_at desc limit 500`;
  const leads = [];
  for (const l of rows) {
    const ev = p.open === l.id ? await ctx.tx`select what, by_name, at from inbox_lead_events where lead_id = ${l.id} order by id` : [];
    leads.push({ id: l.id, name: str(l.name), phone: str(l.phone), email: str(l.email), want: str(l.want), stage: l.stage, stageName: STAGES[l.stage], value: l.value === null ? null : num(l.value),
      priority: str(l.priority), source: str(l.source), channel: str(l.channel), assigned: str(l.assigned_name), followUp: l.follow_up_on ? formatDate(new Date(l.follow_up_on), 'yyyy-MM-dd') : '',
      due: !!(l.follow_up_on && formatDate(new Date(l.follow_up_on), 'yyyy-MM-dd') <= today && l.stage < 5), note: str(l.note), conv: l.conversation_id,
      updated: formatDate(new Date(l.updated_at), 'd MMM'), history: ev.map((e) => ({ what: e.what, by: str(e.by_name), at: formatDate(new Date(e.at), 'd MMM h:mm a') })) });
  }
  // "To chase": an open lead (interested / quoted) with no chat order since it was made
  const chase = (await ctx.tx`select l.id, l.name, l.phone, l.want, l.conversation_id, l.updated_at from inbox_leads l where l.business_id = ${ctx.biz} and l.stage between 2 and 4
      and not exists (select 1 from chat_orders o where o.business_id = l.business_id and (o.conversation_id = l.conversation_id or (l.phone is not null and o.phone = l.phone)) and o.created_at >= l.created_at)
      order by l.updated_at desc limit 50`).map((l) => ({ id: l.id, name: str(l.name), phone: str(l.phone), want: str(l.want), conv: l.conversation_id, at: formatDate(new Date(l.updated_at), 'd MMM') }));
  return { leads, stages: STAGES.slice(1), chase };
}

// ------------------------------------------------------------------ broadcasts (only to people who wrote in the last 23 h)
async function audience(ctx, gapHours) {
  return ctx.tx`select v.* from inbox_conversations v join inbox_channels ch on ch.id = v.channel_id
    where v.business_id = ${ctx.biz} and ch.status = 'live' and ch.kind in ('messenger', 'instagram') and v.mode = 'ai' and not v.is_test
      and v.last_in_at > ${new Date(ctx.now.getTime() - 23 * 3600e3)}
      and not exists (select 1 from inbox_broadcast_sends s where s.conversation_id = v.id and s.at > ${new Date(ctx.now.getTime() - gapHours * 3600e3)})`;
}
export async function erpInboxBroadcasts(ctx, payload) {
  need(ctx, 'manager');
  const p = payload || {};
  const gap = Math.max(1, Math.min(168, num(p.gap) || 24));
  if (p.save) {
    owner(ctx);
    if (!str(p.save.text)) throw new Error('Write the offer.');
    if (p.save.id) await ctx.tx`update inbox_broadcasts set text = ${str(p.save.text)} where business_id = ${ctx.biz} and id = ${str(p.save.id)} and sent_at is null`;
    else await ctx.tx`insert into inbox_broadcasts (business_id, text, created_by) values (${ctx.biz}, ${str(p.save.text)}, ${ctx.s.name})`;
  }
  if (p.test) {
    owner(ctx);
    const b = (await ctx.tx`select * from inbox_broadcasts where business_id = ${ctx.biz} and id = ${str(p.test)}`)[0];
    const v = (await ctx.tx`select v.* from inbox_conversations v where v.business_id = ${ctx.biz} and v.id = ${str(p.to)}`)[0];
    if (!b || !v) throw new Error('Choose the broadcast and one of your own chats to test on.');
    const ch = await chOf(ctx, v.channel_id), c = (await ctx.tx`select * from inbox_contacts where id = ${v.contact_id}`)[0];
    const r = await deliver(ctx, ch, v, c, { kind: 'text', text: b.text }, { author: 'team', userId: ctx.s.userId, userName: ctx.s.name + ' (broadcast test)' });
    if (!r.ok) throw new Error('The test did not go: ' + r.error);
    await ctx.tx`update inbox_broadcasts set tested_text = text, tested_at = now() where id = ${b.id}`;
  }
  if (p.send) {
    await needFeat(ctx, 'broadcasts');
    owner(ctx);
    const b = (await ctx.tx`select * from inbox_broadcasts where business_id = ${ctx.biz} and id = ${str(p.send)}`)[0];
    if (!b || b.sent_at) throw new Error('Already sent.');
    if (str(b.tested_text) !== str(b.text)) throw new Error('Send a test to one of your own chats first (and again after every change).');
    const pr = await profile(ctx, false);
    if (!pr.broadcasts) throw new Error('Broadcasts are switched off.');
    let n = 0;
    for (const v of await audience(ctx, gap)) {
      const ch = await chOf(ctx, v.channel_id), c = (await ctx.tx`select * from inbox_contacts where id = ${v.contact_id}`)[0];
      const r = await deliver(ctx, ch, v, c, { kind: 'text', text: b.text }, { author: 'team', userId: ctx.s.userId, userName: 'Broadcast' });
      if (r.ok) { n++; await ctx.tx`insert into inbox_broadcast_sends (business_id, broadcast_id, conversation_id) values (${ctx.biz}, ${b.id}, ${v.id})`; }
    }
    await ctx.tx`update inbox_broadcasts set sent_at = now(), sent_count = ${n} where id = ${b.id}`;
  }
  const list = await ctx.tx`select * from inbox_broadcasts where business_id = ${ctx.biz} order by created_at desc limit 50`;
  const reach = (await audience(ctx, gap)).length;
  return { reach, gap, broadcasts: list.map((b) => ({ id: b.id, text: b.text, tested: str(b.tested_text) === str(b.text), testedAt: b.tested_at ? formatDate(new Date(b.tested_at), 'd MMM h:mm a') : '',
    sent: b.sent_at ? formatDate(new Date(b.sent_at), 'd MMM h:mm a') : '', count: b.sent_count })) };
}

// ------------------------------------------------------------------ follow-ups (the screen)
export async function erpInboxFollowups(ctx, payload) {
  need(ctx, 'manager');
  const p = payload || {};
  if (p.save) { owner(ctx); await erpInboxProfile(ctx, { save: { followups: !!p.save.on, follow_hot: !!p.save.hot, follow_warm: !!p.save.warm } }); }
  const pr = await profile(ctx, false);
  const c = (await ctx.tx`select count(*) filter (where interest = 'hot')::int hot, count(*) filter (where interest = 'warm')::int warm, count(*) filter (where interest = 'cold')::int cold
                          from inbox_conversations where business_id = ${ctx.biz} and last_in_at > ${new Date(ctx.now.getTime() - 7 * H24)}`)[0];
  const next = await ctx.tx`select v.id, v.interest, v.next_followup, v.followups_left, ct.name from inbox_conversations v join inbox_contacts ct on ct.id = v.contact_id
                            where v.business_id = ${ctx.biz} and v.next_followup is not null order by v.next_followup limit 50`;
  return { on: pr.followups, hot: pr.follow_hot, warm: pr.follow_warm, counts: c,
           planned: next.map((v) => ({ id: v.id, name: str(v.name) || 'Customer', interest: v.interest, at: formatDate(new Date(v.next_followup), 'd MMM, h:mm a'), left: v.followups_left })) };
}

// ------------------------------------------------------------------ comments (the screen)
export async function erpInboxComments(ctx, payload) {
  await needFeat(ctx, 'comments');
  need(ctx);
  const p = payload || {};
  if (p.act) {
    const c = (await ctx.tx`select * from inbox_comments where business_id = ${ctx.biz} and id = ${str(p.act.id)}`)[0];
    if (!c) throw new Error('No such comment.');
    const ch = await chOf(ctx, c.channel_id);
    if (p.act.action === 'reply') {
      if (!str(p.act.text)) throw new Error('Write the reply.');
      const r = await commentReply(ctx, ch, c.comment_id, str(p.act.text));
      if (!r.ok) throw new Error(r.error);
      await ctx.tx`update inbox_comments set action = 'replied', ai_reply = ${str(p.act.text)}, by_name = ${ctx.s.name} where id = ${c.id}`;
    } else if (['hide', 'delete', 'block', 'unhide'].includes(p.act.action)) {
      const r = await commentModerate(ctx, ch, c.comment_id, p.act.action, c.from_id);
      if (!r.ok) throw new Error(r.error);
      await ctx.tx`update inbox_comments set action = ${p.act.action === 'unhide' ? 'ignored' : p.act.action === 'hide' ? 'hidden' : p.act.action === 'delete' ? 'deleted' : 'blocked'}, by_name = ${ctx.s.name} where id = ${c.id}`;
    }
  }
  const rows = await ctx.tx`select c.*, ch.kind from inbox_comments c join inbox_channels ch on ch.id = c.channel_id where c.business_id = ${ctx.biz} order by c.created_at desc limit 200`;
  return { comments: rows.map((c) => ({ id: c.id, channel: c.kind, from: str(c.from_name), text: str(c.text), reply: str(c.ai_reply), action: str(c.action), by: str(c.by_name), at: formatDate(new Date(c.created_at), 'd MMM, h:mm a') })) };
}

// ------------------------------------------------------------------ saved replies (+ the two AI helpers)
export async function erpSavedReplies(ctx, payload) {
  need(ctx);
  const p = payload || {};
  if (p.add) { need(ctx, 'manager'); if (!str(p.add.title) || !str(p.add.body)) throw new Error('A saved reply needs a name and the words.');
    await ctx.tx`insert into saved_replies (business_id, title, body) values (${ctx.biz}, ${str(p.add.title).slice(0, 60)}, ${str(p.add.body).slice(0, 2000)})`; }
  if (p.archive) { need(ctx, 'manager'); await ctx.tx`update saved_replies set archived = true where business_id = ${ctx.biz} and id = ${str(p.archive)}`; }
  const list = (await ctx.tx`select id, title, body from saved_replies where business_id = ${ctx.biz} and not archived order by title`).map((r) => ({ id: r.id, title: r.title, body: r.body }));
  const pr = await profile(ctx, false);
  if ((p.suggest || p.adapt) && pr.saved_ai && list.length && await feat(ctx, 'saved_ai')) {
    const v = (await ctx.tx`select id from inbox_conversations where business_id = ${ctx.biz} and id = ${str(p.suggest || p.conv)}`)[0];
    const hist = v ? (await ctx.tx`select direction, text, transcript from inbox_messages where conversation_id = ${v.id} and direction <> 'note' order by id desc limit 8`).reverse() : [];
    const convo = hist.map((m) => (m.direction === 'in' ? 'Customer: ' : 'Shop: ') + str(m.text || m.transcript)).join('\n');
    if (p.suggest) {
      const { parts } = await gemini(ctx, { contents: [{ role: 'user', parts: [{ text: 'Saved replies: ' + JSON.stringify(list.map((x) => ({ id: x.id, title: x.title }))) + '\nConversation:\n' + convo +
        '\nWhich saved replies fit the customer\'s last message? JSON only: an array of up to 3 ids, best first (empty if none).' }] }], generationConfig: { temperature: 0 } }, 'saved-suggest', v ? v.id : null);
      const ids = jsonOf(parts) || [];
      return { list, suggested: Array.isArray(ids) ? ids.filter((x) => list.some((y) => y.id === x)) : [] };
    }
    const base = list.find((x) => x.id === str(p.adapt));
    if (!base) throw new Error('Choose the saved reply.');
    const { parts } = await gemini(ctx, { contents: [{ role: 'user', parts: [{ text: 'Rewrite this saved reply for this customer, keeping every fact exactly, in the customer\'s language, short:\n' + base.body + '\n\nConversation:\n' + convo + '\nOnly the reply.' }] }], generationConfig: { temperature: 0.3 } }, 'saved-adapt', v ? v.id : null);
    return { list, text: textOf(parts) };
  }
  return { list, ai: pr.saved_ai };
}

// ------------------------------------------------------------------ analytics and the AI work log
/** Day review (owner 19 Oct 2026): one short summary per customer per day, so the owner reads what happened without
 *  opening the chats. Summaries are kept (inbox_digests) and rewritten only when the chat grew since. */
export async function erpInboxDigest(ctx, payload) {
  need(ctx, 'manager');
  const p = payload || {};
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(p.day)) ? str(p.day) : todayStr(ctx.now);
  const from = new Date(day + 'T00:00:00+06:00'), to = new Date(from.getTime() + H24);   // Dhaka has no summer time
  const sc = await scopeOf(ctx), CH = sc.channels || ['-'];
  if (p.again) await ctx.tx`delete from inbox_digests where business_id = ${ctx.biz} and day = ${day}`;   // Refresh: read the chats again
  const rows = await ctx.tx`
    select v.id, v.contact_id, v.is_test, v.mode, v.handover_reason, v.handover_at, v.ordered, ch.kind, ch.name as channel, c.name, c.phone,
           count(m.id)::int msgs, count(*) filter (where m.direction = 'in')::int inn, count(*) filter (where m.author = 'ai')::int ai, count(*) filter (where m.author = 'team')::int team,
           max(m.created_at) last_at, (array_agg(m.direction order by m.id desc))[1] last_dir,
           d.summary, d.msgs as done_msgs
    from inbox_messages m join inbox_conversations v on v.id = m.conversation_id join inbox_channels ch on ch.id = v.channel_id left join inbox_contacts c on c.id = v.contact_id
    left join inbox_digests d on d.conversation_id = v.id and d.day = ${day}
    where m.business_id = ${ctx.biz} and m.created_at >= ${from} and m.created_at < ${to} and m.direction in ('in', 'out')
      and (${!sc.channels} or v.channel_id::text = any(${CH}))
    group by v.id, ch.kind, ch.name, c.name, c.phone, d.summary, d.msgs order by max(m.created_at) desc`;
  const orders = await ctx.tx`select conversation_id, no, status, items, delivery_charge, taken_by from chat_orders where business_id = ${ctx.biz} and created_at >= ${from} and created_at < ${to}`;
  const byConv = {};
  for (const o of orders) (byConv[o.conversation_id] = byConv[o.conversation_id] || []).push(o);
  const val = (o) => (o.items || []).reduce((t, x) => t + num(x.qty) * num(x.price), 0) + num(o.delivery_charge);
  const pr = await profile(ctx, false);
  const out = [], totals = { chats: rows.length, orders: 0, amount: 0, handed: 0, waiting: 0, aiAlone: 0, unanswered: 0 };
  let made = 0, left = 0;
  const MAX = p.make === false ? 0 : 20;   // summaries written per call: the page asks again for the rest
  for (const r of rows) {
    const os = byConv[r.id] || [];
    const amount = os.filter((o) => o.status !== 'cancelled').reduce((t, o) => t + val(o), 0);
    const handed = !!(r.handover_at && new Date(r.handover_at) >= from && new Date(r.handover_at) < to);
    const outcome = os.length ? 'order' : handed ? 'handover' : r.last_dir === 'in' && r.mode === 'human' ? 'waiting' : r.last_dir === 'in' ? 'unanswered' : r.team > 0 ? 'team' : 'ai';
    if (os.length) { totals.orders += os.length; totals.amount += amount; }
    if (handed) totals.handed++;
    if (outcome === 'waiting') totals.waiting++;
    if (outcome === 'unanswered') totals.unanswered++;
    if (outcome === 'ai') totals.aiAlone++;
    let summary = str(r.summary);
    const fresh = r.done_msgs === r.msgs && summary;
    if (!fresh) {
      if (made >= MAX) { left++; summary = ''; }
      else {
        made++;
        const hist = await ctx.tx`select direction, author, text, transcript, seen_as, created_at from inbox_messages where conversation_id = ${r.id} and created_at >= ${from} and created_at < ${to} order by id limit 80`;
        const lines = hist.map((m) => formatDate(new Date(m.created_at), 'h:mm a') + ' ' + (m.direction === 'in' ? 'Customer' : m.author === 'team' ? 'Team' : m.author === 'ai' ? 'Shop (AI)' : 'Note') + ': ' +
          str(m.text || '') + (m.transcript ? ' [voice: ' + m.transcript + ']' : '') + (m.seen_as ? ' [photo]' : '')).join('\n');
        const facts = os.map((o) => 'Order ' + o.no + ' (' + o.status + ', ' + (o.taken_by === 'ai' ? 'taken by the AI' : 'taken by ' + o.taken_by) + ') total BDT ' + Math.round(val(o)) + ': ' + (o.items || []).map((x) => x.name + ' x ' + num(x.qty)).join(', ')).join('\n') +
          (handed ? '\nHanded to the team: ' + (REASONS[r.handover_reason] || r.handover_reason || '') : '');
        try {
          const { parts } = await gemini(ctx, { systemInstruction: { parts: [{ text: 'You write the owner\'s evening review for "' + pr.name + '". Use only the conversation and facts given. Never invent prices or promises.' }] },
            contents: [{ role: 'user', parts: [{ text: 'Customer: ' + (r.name || 'unknown') + (r.phone ? ' ' + r.phone : '') + '\nFacts:\n' + (facts || 'none') + '\n\nConversation today:\n' + lines +
              '\n\nIn at most two short sentences, plain English, no greeting: what the customer wanted, what was done (by the AI or by the team), the result, and what is still open if anything. Numbers as figures.' }] }],
            generationConfig: { temperature: 0.2 } }, 'digest', r.id);
          summary = str(textOf(parts)).replace(/\s+/g, ' ').trim().slice(0, 600);
        } catch (e) { summary = ''; left++; made--; }
        if (summary) await ctx.tx`insert into inbox_digests (business_id, conversation_id, day, summary, msgs) values (${ctx.biz}, ${r.id}, ${day}, ${summary}, ${r.msgs})
                                   on conflict (conversation_id, day) do update set summary = excluded.summary, msgs = excluded.msgs, made_at = now()`;
      }
    }
    out.push({ conv: r.id, name: str(r.name) || 'Customer', phone: str(r.phone), channel: KIND_NAME[r.kind] || r.kind, channelName: r.channel, test: !!r.is_test,
               outcome, orders: os.map((o) => ({ no: o.no, status: o.status, total: Math.round(val(o)) })), amount: Math.round(amount), reason: handed ? (REASONS[r.handover_reason] || r.handover_reason) : '',
               msgs: r.msgs, inn: r.inn, ai: r.ai, team: r.team, last: formatDate(new Date(r.last_at), 'h:mm a'), summary, pending: !summary });
  }
  totals.amount = Math.round(totals.amount);
  const prev = formatDate(new Date(from.getTime() - H24), 'yyyy-MM-dd'), next = formatDate(to, 'yyyy-MM-dd');
  return { day, label: formatDate(from, 'EEEE d MMM yyyy'), prev, next: to <= ctx.now ? next : null, totals, rows: out, left };
}

export async function erpInboxStats(ctx, payload) {
  await needFeat(ctx, 'analytics');
  need(ctx, 'manager');
  const days = [7, 14, 30].includes(num(payload && payload.days)) ? num(payload.days) : 7;
  const from = new Date(ctx.now.getTime() - days * H24);
  const m = (await ctx.tx`select count(*) filter (where direction = 'in')::int as inn, count(*) filter (where author = 'ai')::int as ai, count(*) filter (where author = 'team')::int as team,
    count(distinct conversation_id)::int as convs from inbox_messages where business_id = ${ctx.biz} and created_at >= ${from}`)[0];
  const v = (await ctx.tx`select count(*)::int as n, count(*) filter (where handover_at is null)::int as ai_alone, count(*) filter (where handover_at >= ${from})::int as handed,
    percentile_cont(0.5) within group (order by first_reply_s)::int as median_first, count(*) filter (where mode = 'human' and claimed_by is null and handover_reason is not null)::int as waiting
    from inbox_conversations where business_id = ${ctx.biz} and last_at >= ${from}`)[0];
  const reasons = await ctx.tx`select reason, count(*)::int n from inbox_tasks where business_id = ${ctx.biz} and kind = 'handover' and created_at >= ${new Date(ctx.now.getTime() - 30 * H24)} group by reason order by n desc`;
  const claim = (await ctx.tx`select percentile_cont(0.5) within group (order by extract(epoch from (done_at - created_at)))::int s from inbox_tasks where business_id = ${ctx.biz} and kind = 'handover' and done_at is not null and created_at >= ${from}`)[0];
  const hours = await ctx.tx`select extract(hour from (created_at at time zone 'Asia/Dhaka'))::int h, count(*)::int n from inbox_messages where business_id = ${ctx.biz} and direction = 'in' and created_at >= ${from} group by 1 order by 1`;
  const byCh = await ctx.tx`select ch.kind, count(*)::int n from inbox_messages m join inbox_conversations v on v.id = m.conversation_id join inbox_channels ch on ch.id = v.channel_id
                            where m.business_id = ${ctx.biz} and m.direction = 'in' and m.created_at >= ${from} group by 1`;
  const leads = (await ctx.tx`select count(*)::int n, count(*) filter (where stage = 5)::int won, count(*) filter (where stage = 6)::int lost from inbox_leads where business_id = ${ctx.biz} and created_at >= ${from}`)[0];
  const orders = (await ctx.tx`select count(*)::int n, count(*) filter (where taken_by = 'ai')::int ai from chat_orders where business_id = ${ctx.biz} and created_at >= ${from}`)[0];
  // the order report (AiPraktor's Orders → Report): who took them, with their value; why orders were cancelled or held
  const val = (r) => (r.items || []).reduce((t, x) => t + num(x.qty) * num(x.price), 0);
  const taker = {}, cancel = {}, hold = {};
  for (const o of await ctx.tx`select taken_by, items, status, cancel_reason, hold_reason from chat_orders where business_id = ${ctx.biz} and created_at >= ${from}`) {
    const k = o.taken_by === 'ai' ? 'The AI' : o.taken_by === 'product page' ? 'Product page' : str(o.taken_by) || 'Team';
    taker[k] = taker[k] || { who: k, n: 0, value: 0 }; taker[k].n++; taker[k].value += val(o);
    if (o.status === 'cancelled' && o.cancel_reason) cancel[str(o.cancel_reason)] = (cancel[str(o.cancel_reason)] || 0) + 1;
    if (o.hold_reason) hold[str(o.hold_reason)] = (hold[str(o.hold_reason)] || 0) + 1;
  }
  orders.byTaker = Object.values(taker).sort((a, b) => b.n - a.n);
  orders.cancelled = Object.keys(cancel).map((k) => ({ reason: k, n: cancel[k] })).sort((a, b) => b.n - a.n);
  orders.held = Object.keys(hold).map((k) => ({ reason: k, n: hold[k] })).sort((a, b) => b.n - a.n);
  const cost = (await ctx.tx`select coalesce(sum(cost_bdt), 0)::float as bdt, count(*)::int n from ai_work where business_id = ${ctx.biz} and at >= ${from}`)[0];
  return { days, messages: m, conversations: v, reasons: reasons.map((r) => ({ reason: REASONS[r.reason] || r.reason || 'Other', n: r.n })), claimMedianS: claim.s,
           hours: hours.map((h) => ({ h: h.h, n: h.n })), byChannel: byCh.map((x) => ({ channel: KIND_NAME[x.kind] || x.kind, n: x.n })), leads, orders, aiCost: { bdt: Math.round(cost.bdt * 100) / 100, n: cost.n } };
}
export async function erpAiWork(ctx, payload) {
  owner(ctx);
  const p = payload || {};
  // the days are Dhaka days
  const dhaka = (d) => new Date(d + 'T00:00:00+06:00');
  const from = /^\d{4}-\d{2}-\d{2}$/.test(str(p.from)) ? str(p.from) : todayStr(new Date(ctx.now.getTime() - 30 * H24)), to = /^\d{4}-\d{2}-\d{2}$/.test(str(p.to)) ? str(p.to) : todayStr(ctx.now);
  const a = dhaka(from), b = new Date(dhaka(to).getTime() + H24);
  const rows = await ctx.tx`select * from ai_work where business_id = ${ctx.biz} and at >= ${a} and at < ${b} order by at desc limit 500`;
  const byDay = await ctx.tx`select to_char(at at time zone 'Asia/Dhaka', 'YYYY-MM-DD') d, sum(cost_bdt)::float bdt, count(*)::int n from ai_work where business_id = ${ctx.biz}
                             and at >= ${a} and at < ${b} group by 1 order by 1`;
  const byPurpose = await ctx.tx`select purpose, sum(cost_bdt)::float bdt, count(*)::int n from ai_work where business_id = ${ctx.biz} and at >= ${a} and at < ${b} group by 1 order by 2 desc`;
  return { from, to, total: Math.round(byDay.reduce((t, x) => t + x.bdt, 0) * 100) / 100,
    rows: rows.map((r) => ({ at: formatDate(new Date(r.at), 'd MMM, h:mm a'), purpose: r.purpose, model: r.model, tin: r.tokens_in, tout: r.tokens_out, bdt: num(r.cost_bdt), conv: r.conversation_id ? String(r.conversation_id).slice(0, 6) : '' })),
    byDay: byDay.map((x) => ({ day: x.d, bdt: Math.round(x.bdt * 100) / 100, n: x.n })), byPurpose: byPurpose.map((x) => ({ purpose: x.purpose, bdt: Math.round(x.bdt * 100) / 100, n: x.n })) };
}

/** Rows for a file the page saves: orders | leads | ai | handovers | chat (one conversation, as text). */
export async function erpInboxExport(ctx, payload) {
  await needFeat(ctx, 'exports');
  const p = payload || {};
  const w = str(p.what);
  if (w === 'chat') {
    need(ctx);
    const v = (await ctx.tx`select v.id, c.name, c.phone from inbox_conversations v join inbox_contacts c on c.id = v.contact_id where v.business_id = ${ctx.biz} and v.id = ${str(p.id)}`)[0];
    if (!v) throw new Error('No such conversation.');
    const rows = await ctx.tx`select created_at, direction, author, user_name, text, transcript, seen_as from inbox_messages where conversation_id = ${v.id} order by id`;
    const who = (m) => (m.direction === 'in' ? 'Customer' : m.direction === 'note' ? 'Note' : m.author === 'ai' ? 'AI' : (str(m.user_name) || 'Team'));
    return { name: 'chat-' + ((str(v.name) || 'customer').replace(/\s+/g, '-')) + '.txt',
      text: (str(v.name) + ' ' + str(v.phone)).trim() + '\n\n' + rows.map((m) => formatDate(new Date(m.created_at), 'd MMM yyyy h:mm a') + '  ' + who(m) + ': ' + str(m.text) +
        (m.transcript ? ' [voice: ' + m.transcript + ']' : '') + (m.seen_as ? ' [photo: ' + str(m.seen_as).replace(/\{[^}]*\}/, '') + ']' : '')).join('\n') };
  }
  owner(ctx);
  if (w === 'orders') {
    const r = await ctx.tx`select * from chat_orders where business_id = ${ctx.biz} order by created_at desc`;
    return { name: 'chat-orders.csv', head: ['No', 'Date', 'Status', 'Name', 'Phone', 'Address', 'Items', 'Delivery', 'Total', 'Invoice', 'Taken by', 'Hold', 'Cancelled', 'Rating'],
      rows: r.map((o) => [o.no, formatDate(new Date(o.created_at), 'yyyy-MM-dd HH:mm'), o.status, o.name, o.phone, o.address, (o.items || []).map((x) => x.name + ' x ' + x.qty).join('; '),
        num(o.delivery_charge), (o.items || []).reduce((t, x) => t + num(x.qty) * num(x.price), 0) + num(o.delivery_charge), str(o.invoice_no), o.taken_by, str(o.hold_reason), str(o.cancel_reason), o.rating || '']) };
  }
  if (w === 'leads') {
    const r = await ctx.tx`select * from inbox_leads where business_id = ${ctx.biz} order by created_at desc`;
    return { name: 'leads.csv', head: ['Made', 'Stage', 'Name', 'Phone', 'Email', 'Wants', 'Value', 'Priority', 'Source', 'Channel', 'Assigned', 'Follow up', 'Note'],
      rows: r.map((l) => [formatDate(new Date(l.created_at), 'yyyy-MM-dd'), STAGES[l.stage], str(l.name), str(l.phone), str(l.email), str(l.want), l.value === null ? '' : num(l.value), str(l.priority),
        str(l.source), str(l.channel), str(l.assigned_name), l.follow_up_on ? formatDate(new Date(l.follow_up_on), 'yyyy-MM-dd') : '', str(l.note)]) };
  }
  if (w === 'ai') {
    const r = await ctx.tx`select * from ai_work where business_id = ${ctx.biz} order by at desc limit 20000`;
    return { name: 'ai-work.csv', head: ['When', 'Work', 'Model', 'Tokens in', 'Tokens out', 'Taka (est.)'], rows: r.map((x) => [formatDate(new Date(x.at), 'yyyy-MM-dd HH:mm:ss'), x.purpose, x.model, x.tokens_in, x.tokens_out, num(x.cost_bdt)]) };
  }
  if (w === 'handovers') {
    const r = await ctx.tx`select t.*, c.name from inbox_tasks t left join inbox_conversations v on v.id = t.conversation_id left join inbox_contacts c on c.id = v.contact_id where t.business_id = ${ctx.biz} and t.kind = 'handover' order by t.created_at desc`;
    return { name: 'handovers.csv', head: ['When', 'Customer', 'Reason', 'Details', 'Done by', 'Done at', 'Never answered'],
      rows: r.map((t) => [formatDate(new Date(t.created_at), 'yyyy-MM-dd HH:mm'), str(t.name), REASONS[t.reason] || str(t.reason), str(t.text), str(t.done_by), t.done_at ? formatDate(new Date(t.done_at), 'yyyy-MM-dd HH:mm') : '', t.never_answered ? 'yes' : '']) };
  }
  throw new Error('What to download?');
}

// ------------------------------------------------------------------ features (the subscription)
/** The owner's Features screen: every feature, in the plan or not, on or off; the AI budget this month. */
export async function erpInboxFeatures(ctx, payload) {
  need(ctx);
  const p = payload || {};
  if (p.save || p.warnAt !== undefined) {
    owner(ctx);
    const plan = await planOf(ctx), own = { ...(await ownerSwitches(ctx)) };
    for (const k of Object.keys(p.save || {})) {
      if (!FEATURE_KEYS.includes(k)) continue;
      if (p.save[k] && plan.features[k] === false) throw new Error('That feature is not in your plan.');
      if (p.save[k]) { if (DEFAULT_OFF.includes(k)) own[k] = true; else delete own[k]; } else own[k] = false;
    }
    await setConfig(ctx, 'inbox_features', JSON.stringify(own));
    if (p.warnAt !== undefined) await setConfig(ctx, 'inbox_budget_warn', String(Math.max(10, Math.min(100, num(p.warnAt) || 80))));
    ctx.memo.inboxOwn = null;
  }
  const plan = await planOf(ctx), own = await ownerSwitches(ctx);
  return { plan: plan.name, budget: await budget(ctx),
    features: FEATURES.map((f) => ({ key: f[0], group: f[1], name: f[2], what: f[3], inPlan: plan.features[f[0]] !== false, on: plan.features[f[0]] !== false && ownOn(own, f[0]) })) };
}
/** For the page: which features run (one call when the Inbox opens). */
export async function erpInboxFeatureMap(ctx) {
  need(ctx);
  const out = {};
  for (const k of FEATURE_KEYS) out[k] = await feat(ctx, k);
  const b = await budget(ctx);
  return { on: out, budget: { warn: b.warn, stopped: b.stopped, pct: b.pct, used: b.used, budget: b.budget } };
}

/**
 * The provider's plans (platform admin): every business with its Inbox plan, and this month's AI use.
 * save: {businessId, name, features: {key: false}, aiBudget (taka a month, '' = no limit)}.
 */
export async function erpPlatformInboxPlan(ctx, payload) {
  if (!(await platformAdmin(ctx))) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).');
  const p = payload || {};
  if (p.save) {
    const sv = p.save, id = str(sv.businessId);
    if (!/^[0-9a-f-]{36}$/i.test(id) || !(await ctx.sql`select 1 from businesses where id = ${id}`).length) throw new Error('Which business?');
    const features = {};
    for (const k of FEATURE_KEYS) if (sv.features && sv.features[k] === false) features[k] = false;
    const b = sv.aiBudget === '' || sv.aiBudget === null || sv.aiBudget === undefined ? null : Math.max(0, num(sv.aiBudget));
    await ctx.sql`insert into inbox_plans (business_id, plan_name, features, ai_budget_bdt, set_by) values (${id}, ${str(sv.name) || null}, ${ctx.sql.json(features)}, ${b}, ${ctx.s.userId})
                  on conflict (business_id) do update set plan_name = excluded.plan_name, features = excluded.features, ai_budget_bdt = excluded.ai_budget_bdt, set_by = excluded.set_by, set_at = now()`;
    try { await ctx.tx`select platform_log(${id}, ${'Platform admin: ' + (str(ctx.s.name) || 'admin')}, 'erpPlatformInboxPlan',
      ${('Inbox plan ' + (str(sv.name) || '') + ': ' + (Object.keys(features).length ? Object.keys(features).length + ' features left out' : 'every feature') + (b === null ? ', no AI limit' : ', AI ৳' + b + ' a month')).slice(0, 300)})`; } catch (_) { /* the log never blocks */ }
  }
  const d = new Date(ctx.now.getTime() + 6 * 3600e3), since = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 6 * 3600e3);
  const used = {};
  for (const r of await ctx.sql`select business_id, sum(cost_bdt) as t from ai_work where at >= ${since} group by business_id`) used[r.business_id] = Math.round(Number(r.t) * 100) / 100;
  const rows = await ctx.sql`select b.id, b.name, ip.plan_name, ip.features, ip.ai_budget_bdt, ip.set_at from businesses b left join inbox_plans ip on ip.business_id = b.id where not b.is_pool order by b.created_at`;
  return { features: FEATURES.map((f) => ({ key: f[0], group: f[1], name: f[2] })),
    businesses: rows.map((r) => ({ id: r.id, name: r.name, plan: str(r.plan_name), off: Object.keys(r.features || {}).filter((k) => r.features[k] === false),
      budget: r.ai_budget_bdt === null || r.ai_budget_bdt === undefined ? null : Number(r.ai_budget_bdt), used: used[r.id] || 0, setAt: r.set_at ? formatDate(new Date(r.set_at), 'd MMM yyyy') : '' })) };
}

// ------------------------------------------------------------------ team groups (124_inbox_groups.sql)
const HEARS = [['complaint', 'Complaints'], ['refund', 'Refunds'], ['angry', 'Angry customers'], ['abuse', 'Abuse'], ['person', 'Asked for a person'], ['discount', 'Asked for a discount'],
  ['ready', 'Ready to buy'], ['unknown', 'Outside what the AI knows'], ['other', 'Something else'], ['order', 'New orders and booking requests'], ['payment', 'Payments to check'],
  ['enquiry', 'Messages while the AI is off'], ['comment', 'Comments'], ['alert', 'AI alerts']];
/** Groups (who hears which hand-overs) and which channels each teammate sees. Owner changes; managers read. */
export async function erpInboxGroups(ctx, payload) {
  need(ctx, 'manager');
  await needFeat(ctx, 'groups');
  const p = payload || {};
  const okUser = async (id) => (await ctx.tx`select 1 from memberships where business_id = ${ctx.biz} and user_id = ${id} and active`).length > 0;
  if (p.save || p.remove || p.access) owner(ctx);
  if (p.save) {
    const g = p.save, name = str(g.name);
    if (!name) throw new Error('Name the group.');
    const hears = (g.hears || []).map(str).filter((h) => HEARS.some((x) => x[0] === h));
    const members = [];
    for (const m of g.members || []) if (/^[0-9a-f-]{36}$/i.test(str(m)) && await okUser(str(m))) members.push(str(m));
    if (g.id) await ctx.tx`update inbox_groups set name = ${name}, hears = ${hears}, members = ${members} where business_id = ${ctx.biz} and id = ${str(g.id)}`;
    else await ctx.tx`insert into inbox_groups (business_id, name, hears, members) values (${ctx.biz}, ${name}, ${hears}, ${members})`;
  }
  if (p.remove) await ctx.tx`delete from inbox_groups where business_id = ${ctx.biz} and id = ${str(p.remove)}`;
  if (p.access) {
    const a = p.access, uid = str(a.userId);
    if (!(await okUser(uid))) throw new Error('No such teammate.');
    if (a.all || !Array.isArray(a.channels)) await ctx.tx`delete from inbox_access where business_id = ${ctx.biz} and user_id = ${uid}`;
    else {
      const valid = (await ctx.tx`select id from inbox_channels where business_id = ${ctx.biz} and status <> 'removed'`).map((r) => String(r.id));
      const chs = a.channels.map(str).filter((c) => valid.includes(c));
      await ctx.tx`insert into inbox_access (business_id, user_id, channels, set_by) values (${ctx.biz}, ${uid}, ${chs}, ${ctx.s.name})
                   on conflict (business_id, user_id) do update set channels = excluded.channels, set_by = excluded.set_by, set_at = now()`;
    }
  }
  const users = (await ctx.tx`select m.user_id, m.role, p.full_name, p.email from memberships m left join profiles p on p.id = m.user_id where m.business_id = ${ctx.biz} and m.active order by m.role, p.full_name`)
    .map((u) => ({ id: u.user_id, name: str(u.full_name) || str(u.email).split('@')[0] || 'Teammate', role: u.role }));
  const access = {};
  for (const a of await ctx.tx`select user_id, channels from inbox_access where business_id = ${ctx.biz}`) access[a.user_id] = (a.channels || []).map(String);
  return { hears: HEARS.map((h) => ({ key: h[0], name: h[1] })), users, access,
    channels: (await ctx.tx`select id, name, kind from inbox_channels where business_id = ${ctx.biz} and status <> 'removed' order by created_at`).map((c) => ({ id: String(c.id), name: c.name, kind: c.kind })),
    groups: (await ctx.tx`select * from inbox_groups where business_id = ${ctx.biz} order by created_at`).map((g) => ({ id: g.id, name: g.name, hears: g.hears || [], members: (g.members || []).map(String) })) };
}

// ------------------------------------------------------------------ templates (messages after 24 hours)
/** create: ask Meta for every template on this channel (Bangla or English); check: read their status back. */
export async function erpInboxTemplates(ctx, payload) {
  owner(ctx);
  await needFeat(ctx, 'templates');
  const p = payload || {};
  const ch = await chOf(ctx, str(p.id));
  if (!ch || !['messenger', 'wa_cloud'].includes(ch.kind)) throw new Error('Templates are for a Messenger page or the official WhatsApp.');
  const s = { ...(ch.settings || {}) };
  const pr = await profile(ctx, false);
  if (p.action === 'create') {
    const lang = p.lang === 'en' ? 'en' : 'bn';
    const r = await templatesCreate(ctx, ch, lang, { orderBase: (await feat(ctx, 'order_page')) ? orderBase(ctx) : '', reviewLink: /^https:\/\//.test(str(pr.review_link)) ? str(pr.review_link) : '' });
    s.templates_lang = lang;
    s.templates = { ...(s.templates || {}) };
    for (const k of Object.keys(r)) s.templates[r[k].name] = r[k].status;
    await ctx.tx`update inbox_channels set settings = ${ctx.tx.json(s)} where id = ${ch.id}`;
    const errs = Object.keys(r).filter((k) => r[k].status === 'ERROR').map((k) => k + ': ' + r[k].error);
    return { ...(await erpInboxChannels(ctx)), errors: errs };
  }
  if (p.action === 'check') {
    const got = await templatesCheck(ctx, ch);
    s.templates = { ...(s.templates || {}), ...got };
    await ctx.tx`update inbox_channels set settings = ${ctx.tx.json(s)} where id = ${ch.id}`;
    return erpInboxChannels(ctx);
  }
  throw new Error('Create or check?');
}

export const HANDLERS = { erpInboxTemplates, erpInboxGroups, erpPlatformInboxPlan, erpInboxFeatures, erpInboxFeatureMap, erpInboxExport, erpBookings, erpBookingAct, erpInboxChannels, erpInboxChannelSave, erpInboxChannelAct, erpInboxGoLive, erpInboxProfile, erpAgentDesk, erpInboxKb, erpShopOffers,
  erpChatOrders, erpChatOrderAct, erpInboxLeads, erpInboxBroadcasts, erpInboxFollowups, erpInboxComments, erpSavedReplies, erpInboxStats, erpInboxDigest, erpAiWork };
