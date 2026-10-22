// ai-1 (owner 22 Oct 2026: "the best output from AI in every menu - tokens are not the priority, the business is; I must be
// able to switch the LLM: ChatGPT, Claude ..."). ONE door to every language model the ERP uses.
//
//   providers  openai (ChatGPT, Responses API) - anthropic (Claude, Messages API) - gemini (Google) - custom (any
//              OpenAI-compatible server: the owner's own VPS, OmniRoute, OpenRouter, Ollama ...)
//   per task   the business chooses which provider and model does which kind of work (Settings > AI brain):
//              chat (the Inbox agent), assistant (Ask your ERP), read (documents, photos), write (posts, copy),
//              leads, analyze (summaries, insights), default. "auto" = the strongest model the key can use.
//   powers     the same for every provider: text, photos, PDFs, audio (where the model hears), tools (function calling),
//              web search (OpenAI web_search, Claude web_search, Gemini Google Search), JSON answers.
//   fallback   the chosen model, then the provider's next best, then the other providers that have a key.
//   log        every call in ai_work (provider:model, tokens, an estimated cost in taka).
//
// Neutral message: { role: 'user'|'assistant', content: [ {type:'text', text} | {type:'image'|'file'|'audio', mime, data(base64)}
//                    | {type:'tool_call', id, name, args} | {type:'tool_result', id, name, result} ] }
// Keys are the provider's (platform) secrets: OPENAI_KEY, ANTHROPIC_KEY, GEMINI_KEY (also the old Gemini key),
// CUSTOM_AI_KEY + CUSTOM_AI_BASE.

import { openJSON } from './bridge.js';
import { getConfig, setConfig } from './ext.js';

const str = (v) => String(v == null ? '' : v).trim();
export const PROVIDERS = {
  openai: { name: 'ChatGPT (OpenAI)', secret: 'OPENAI_KEY', web: true, vision: true, pdf: true, audio: false },
  anthropic: { name: 'Claude (Anthropic)', secret: 'ANTHROPIC_KEY', web: true, vision: true, pdf: true, audio: false },
  gemini: { name: 'Gemini (Google)', secret: 'GEMINI_KEY', web: true, vision: true, pdf: true, audio: true },
  custom: { name: 'Own server (OpenAI-compatible)', secret: 'CUSTOM_AI_KEY', web: false, vision: true, pdf: false, audio: false },
};
export const TASKS = {
  default: 'Everything not set below',
  chat: 'Inbox: answering customers, comments, follow-ups',
  assistant: 'Ask your ERP (the chat assistant)',
  read: 'Reading supplier files, photos, voice notes',
  write: 'Writing posts, captions, ads, scripts, product text',
  leads: 'Finding and reading leads',
  analyze: 'Summaries, day reviews, insights, naming',
};
// which task each existing piece of AI work belongs to (the purpose written in ai_work)
const PURPOSE_TASK = { reply: 'chat', test: 'chat', followup: 'chat', comment: 'chat', draft: 'chat', ask: 'chat', 'saved-suggest': 'chat', 'saved-adapt': 'chat',
  summary: 'analyze', lead: 'analyze', digest: 'analyze', desk: 'analyze', catalogue: 'analyze',
  photo: 'read', 'photo-match': 'read', voice: 'read', receive: 'read',
  social: 'write', inspo: 'write', 'reel-script': 'write', 'ad-draft': 'write',
  'leads-find': 'leads', 'leads-capture': 'leads', assistant: 'assistant' };
export const taskOf = (purpose) => PURPOSE_TASK[str(purpose)] || (TASKS[str(purpose)] ? str(purpose) : 'default');

// the strongest models first; a model the key cannot use is skipped (404) and the next one tried
const BEST = {
  openai: { pick: [/^gpt-(\d+(?:\.\d+)?)(?:-pro)?$/, /^o(\d+)(?:-pro)?$/], fallback: ['gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o'] },
  anthropic: { pick: [/^claude-opus-(\d+)-(\d+)/, /^claude-sonnet-(\d+)-(\d+)/], fallback: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-1', 'claude-sonnet-4-5'] },
  gemini: { pick: [/^gemini-(\d+(?:\.\d+)?)-pro(?:-latest)?$/, /^gemini-(\d+(?:\.\d+)?)-flash$/], fallback: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'] },
  custom: { pick: [], fallback: [] },
};
// rough prices in US$ per million tokens (input, output): an estimate for the owner, not a bill
const PRICE = [[/gemini.*flash-lite/, 0.1, 0.4], [/gemini.*flash/, 0.3, 2.5], [/gemini.*pro/, 1.25, 10], [/claude-opus/, 15, 75], [/claude-sonnet/, 3, 15], [/claude-haiku/, 1, 5],
  [/gpt-.*mini/, 0.25, 2], [/gpt-.*nano/, 0.05, 0.4], [/gpt-/, 1.25, 10], [/^o\d/, 2, 8]];
const BDT_PER_USD = 122;
// Gemini's free-tier models: the cheap first try for customer chat, and the last safety net for everything
export const FREE_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
const SENIOR = '[SENIOR]';
/** A message the cheap model should not try: a complaint, a refund / return / broken item, a technical fault, a long or many-question message. */
export function isComplex(messages) {
  const users = (messages || []).filter((m) => m.role === 'user');
  const lastU = users[users.length - 1];
  const parts = (lastU && lastU.content) || [];
  const text = parts.filter((c) => c.type === 'text').map((c) => c.text || '').join(' ');
  if (parts.some((c) => c.type === 'file')) return 'a document';
  if (text.length > 450) return 'a long message';
  if ((text.match(/\?/g) || []).length >= 3) return 'many questions';
  if (/\b(refund|return|broken|damage|damaged|defect|fake|wrong|complain|complaint|angry|cheat|scam|lawyer|police|warranty|not working|doesn'?t work|stopped working|clog|jam|error|replace|money back|late|never came|not received)\b|ফেরত|নষ্ট|সমস্যা|ভুল|অভিযোগ|ঠকা|কাজ করছে না|পাইনি|দেরি|ওয়ারেন্টি/i.test(text)) return 'a problem or complaint';
  return '';
}
export function costBdt(model, tin, tout) {
  const p = PRICE.find(([re]) => re.test(str(model))) || [null, 1, 5];
  return Math.round(((tin * p[1] + tout * p[2]) / 1e6) * BDT_PER_USD * 10000) / 10000;
}

// ---------------------------------------------------------------- keys and choices
const ctl = (ctx) => (ctx.deps && ctx.deps.control) || ctx.sql;
async function secret(ctx, name) {
  ctx.memo = ctx.memo || {};
  const mk = '__ai_secret_' + name;
  if (ctx.memo[mk] !== undefined) return ctx.memo[mk];
  let v = '';
  try {
    const r = (await ctl(ctx)`select value_enc from erp_provider_secrets where key = ${name}`)[0];
    if (r) { const e = str(r.value_enc); if (e.startsWith('v1.')) v = str((await openJSON(ctx.deps.bridgeKey, e)).v); else if (e.startsWith('v0.')) v = e.slice(3); }
  } catch (_) { v = ''; }
  if (!v && name === 'GEMINI_KEY') v = str(ctx.deps && ctx.deps.geminiKey);
  ctx.memo[mk] = v;
  return v;
}
export async function providerKeys(ctx) {
  const out = {};
  for (const p of Object.keys(PROVIDERS)) out[p] = await secret(ctx, PROVIDERS[p].secret);
  out.customBase = await secret(ctx, 'CUSTOM_AI_BASE');
  return out;
}
/** Is any AI set up (a key for any provider)? */
export async function anyAi(ctx) { const k = await providerKeys(ctx); return !!(k.openai || k.anthropic || k.gemini || (k.custom && k.customBase)); }
/** The business's choices: { default: {provider, model}, tasks: {chat: {...}, ...}, web, strength }. */
export async function routes(ctx) {
  let r = {};
  try { r = JSON.parse((ctx.biz && ctx.tx ? await getConfig(ctx, 'ai_routes', '') : '') || '{}'); } catch (_) { r = {}; }
  // ai-1b (owner 22 Oct 2026): "Gemini free tier first on chat with customers; complex or failed -> the powerful model".
  // cheap: the kinds of work tried first on Gemini's free-tier model; customer chat is on unless switched off
  const cheap = Array.isArray(r.cheap) ? r.cheap : ['chat'];
  return { default: r.default || { provider: 'auto', model: 'auto' }, tasks: r.tasks || {}, web: r.web !== false, cheap };
}
export async function saveRoutes(ctx, r) { await setConfig(ctx, 'ai_routes', JSON.stringify(r)); }

/** The providers to try for a task, in order: the chosen one first, then the others that have a key. */
async function plan(ctx, task, need) {
  const keys = await providerKeys(ctx), R = await routes(ctx);
  const pick = (R.tasks[task] && R.tasks[task].provider && R.tasks[task].provider !== 'default') ? R.tasks[task] : R.default;
  // the owner relies on ChatGPT; then Claude, Gemini, his own server
  const order = ['openai', 'anthropic', 'gemini', 'custom'];
  const have = order.filter((p) => keys[p] && (p !== 'custom' || keys.customBase));
  const able = (p) => (!need.audio || PROVIDERS[p].audio) && (!need.pdf || PROVIDERS[p].pdf) && (!need.web || PROVIDERS[p].web);
  const first = pick.provider && pick.provider !== 'auto' && have.includes(pick.provider) ? pick.provider : null;
  const list = [];
  if (first && able(first)) list.push({ provider: first, model: pick.model && pick.model !== 'auto' ? pick.model : 'auto' });
  for (const p of have) if (p !== first && able(p)) list.push({ provider: p, model: 'auto' });
  // nothing can hear / search: the chosen one anyway (the audio or search part is left out)
  if (!list.length && have.length) list.push({ provider: first || have[0], model: 'auto', degraded: true });
  // the last safety net: Gemini's free-tier models (when the paid ones all fail, the business still gets an answer)
  if (keys.gemini && able('gemini')) for (const m of FREE_MODELS) list.push({ provider: 'gemini', model: m, only: true, free: true });
  return { list, keys, web: R.web, cheap: R.cheap };
}

/** The models of a provider, strongest first (the list the key can use, kept a day; else a built-in list). */
export async function bestModels(ctx, provider, keys) {
  const B = BEST[provider];
  const ck = 'ai_models:' + provider;
  ctx.memo = ctx.memo || {};
  if (ctx.memo[ck]) return ctx.memo[ck];
  let ids = [];
  try {
    const cached = ctx.biz && ctx.tx ? JSON.parse((await getConfig(ctx, ck, '')) || 'null') : null;
    if (cached && cached.at > Date.now() - 86400e3 && Array.isArray(cached.ids)) ids = cached.ids;
    else {
      ids = await listModels(ctx, provider, keys);
      if (ids.length && ctx.biz && ctx.tx) await setConfig(ctx, ck, JSON.stringify({ at: Date.now(), ids }));
    }
  } catch (_) { ids = []; }
  const ranked = [];
  for (const re of B.pick) {
    const hits = ids.filter((id) => re.test(id) && !/mini|nano|lite|preview|audio|realtime|tts|image|search|transcribe|instruct|embedding|vision|-latest-|codex/i.test(id) || (re.test(id) && /latest$/.test(id)))
      .map((id) => { const m = re.exec(id); return { id, v: m ? m.slice(1).map(Number).filter((n) => !isNaN(n)) : [] }; })
      .sort((a, b) => { for (let i = 0; i < 3; i++) { const d = (b.v[i] || 0) - (a.v[i] || 0); if (d) return d; } return a.id.length - b.id.length; });
    for (const h of hits) if (!ranked.includes(h.id)) ranked.push(h.id);
  }
  for (const f of B.fallback) if (!ranked.includes(f)) ranked.push(f);
  if (provider === 'custom') for (const id of ids) if (!ranked.includes(id)) ranked.push(id);
  ctx.memo[ck] = ranked;
  return ranked;
}
export async function listModels(ctx, provider, keys) {
  const f = ctx.deps.fetch || fetch, k = keys[provider];
  if (!k || ctx.deps.aiListModels === false) return [];   // tests script the AI: no model list
  let r;
  if (provider === 'openai') r = await f('https://api.openai.com/v1/models', { headers: { authorization: 'Bearer ' + k } });
  else if (provider === 'anthropic') r = await f('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01' } });
  else if (provider === 'gemini') r = await f('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(k), {});
  else if (provider === 'custom') r = await f(str(keys.customBase).replace(/\/+$/, '') + '/models', { headers: { authorization: 'Bearer ' + k } });
  if (!r || !r.ok) return [];
  const j = await r.json().catch(() => ({}));
  if (provider === 'gemini') return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => str(m.name).replace(/^models\//, ''));
  return (j.data || []).map((m) => str(m.id)).filter(Boolean);
}

// ---------------------------------------------------------------- the call
const TIMEOUT = { chat: 75000, assistant: 90000, read: 110000, write: 90000, leads: 110000, analyze: 90000, default: 90000 };
/**
 * ai(ctx, { purpose, task?, system, messages, tools?, json?, web?, temperature?, maxTokens?, conversationId?, provider?, model? })
 *  -> { text, json, calls: [{id, name, args}], provider, model, raw }
 */
export async function ai(ctx, req) {
  const task = req.task || taskOf(req.purpose);
  const need = { audio: hasPart(req.messages, 'audio'), pdf: hasPart(req.messages, 'file'), web: !!req.web };
  let P = req.provider ? { list: [{ provider: req.provider, model: req.model || 'auto' }], keys: await providerKeys(ctx), web: true } : await plan(ctx, task, need);
  // the cheap first try (customer chat by default): Gemini's free-tier models alone; the caller moves on to the strong one
  if (req.tier === 'cheap') P = { ...P, list: P.keys.gemini ? FREE_MODELS.map((m) => ({ provider: 'gemini', model: m, only: true, free: true })) : [] };
  else if (!req.provider && req.tier !== 'strong' && !(req.tools && req.tools.length) && P.cheap && P.cheap.includes(task) && P.keys.gemini && !isComplex(req.messages)) {
    try {
      const c = await ai(ctx, { ...req, tier: 'cheap', system: str(req.system) + '\n\nIf the message is complex, a complaint, or you are not sure of the answer, reply with exactly ' + SENIOR + ' and nothing else.' });
      if (str(c.text) && !str(c.text).includes(SENIOR)) return { ...c, tier: 'cheap' };
    } catch (_) { /* the strong model below */ }
  }
  if (!P.list.length) throw new Error('No AI key is set up on this ERP - add a ChatGPT, Claude or Gemini key under Settings > AI brain.');
  let last = '';
  for (const choice of P.list) {
    const models = choice.only ? [choice.model] : choice.model && choice.model !== 'auto' ? [choice.model, ...(await bestModels(ctx, choice.provider, P.keys)).filter((m) => m !== choice.model)] : await bestModels(ctx, choice.provider, P.keys);
    for (const model of models.slice(0, 4)) {
      const t0 = Date.now();
      try {
        // a whole conversation has a deadline (the server stops a request at 150 s): each call gets what is left
        const left = req.deadline ? req.deadline - Date.now() : Infinity;
        if (left < 8000) throw Object.assign(new Error('timeout (out of time)'), { skipProvider: true });
        const out = await callOne(ctx, choice.provider, model, P.keys, { ...req, web: req.web && P.web !== false, task }, Math.min(TIMEOUT[task] || TIMEOUT.default, left));
        await logWork(ctx, req.purpose || task, req.conversationId, choice.provider + ':' + model, out.usage, Date.now() - t0);
        if (req.json) out.json = parseJson(out.text);
        return { ...out, provider: choice.provider, model };
      } catch (e) {
        last = choice.provider + ':' + model + ' ' + str(e && e.message).slice(0, 200);
        if (e && e.fatal) throw e;                       // a refused key is not cured by another model of the same provider
        if (e && e.skipProvider) break;
      }
    }
  }
  throw new Error(/429|busy|timeout|overloaded|529|503/i.test(last) ? 'The AI is busy right now - try again in a minute.' : 'The AI could not answer. ' + last);
}
function hasPart(messages, type) { return (messages || []).some((m) => (m.content || []).some((c) => c.type === type)); }
export function parseJson(t) {
  const s = str(t).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(s); } catch (_) {
    const m = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(s);
    if (m) { try { return JSON.parse(m[0]); } catch (_) { /* none */ } }
    return null;
  }
}
async function logWork(ctx, purpose, conversationId, model, usage, ms) {
  if (!ctx.tx || !ctx.biz) return;
  const tin = Number((usage && usage.in) || 0), tout = Number((usage && usage.out) || 0);
  try {
    await ctx.tx.savepoint((t) => t`insert into ai_work (business_id, purpose, conversation_id, model, tokens_in, tokens_out, cost_bdt)
                 values (${ctx.biz}, ${purpose}, ${conversationId || null}, ${model}, ${tin}, ${tout}, ${costBdt(model.split(':').pop(), tin, tout)})`);
  } catch (_) { /* the log is never the reason an answer fails */ }
}

async function post(ctx, url, headers, body, ms) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null, timer = ac ? setTimeout(() => ac.abort(), ms) : null;
  let res, txt;
  try {
    res = await (ctx.deps.fetch || fetch)(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ac ? ac.signal : undefined });
    txt = await res.text();
  } catch (_) { throw new Error('timeout'); } finally { if (timer) clearTimeout(timer); }
  let j = null; try { j = JSON.parse(txt); } catch (_) { j = null; }
  if (!res.ok) {
    const msg = res.status + ' ' + str((j && (j.error && (j.error.message || j.error.type) || j.message)) || txt).slice(0, 200);
    const e = new Error(msg);
    if (res.status === 401 || res.status === 403) { e.fatal = false; e.skipProvider = true; }   // this key is refused: the next provider
    throw e;
  }
  if (!j) throw new Error('not json');
  return j;
}
// JSON-schema types in lower case (the Gemini-style 'OBJECT' / 'STRING' the ERP's tools were written in)
function schema(s) {
  if (!s || typeof s !== 'object') return s;
  if (Array.isArray(s)) return s.map(schema);
  const o = {};
  for (const [k, v] of Object.entries(s)) o[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : schema(v);
  if (o.type === 'object' && !o.properties) o.properties = {};
  return o;
}
const dataUrl = (c) => 'data:' + (c.mime || 'application/octet-stream') + ';base64,' + c.data;
const resultText = (r) => (typeof r === 'string' ? r : JSON.stringify(r === undefined ? null : r));

async function callOne(ctx, provider, model, keys, req, ms) {
  const sys = str(req.system) + (req.json ? '\n\nAnswer with valid JSON only - no words before or after it.' : '');
  const maxTokens = req.maxTokens || 16000;
  if (provider === 'openai') {
    const input = [];
    for (const m of req.messages || []) {
      const parts = [];
      for (const c of m.content || []) {
        if (c.type === 'text') parts.push(m.role === 'assistant' ? { type: 'output_text', text: c.text } : { type: 'input_text', text: c.text });
        else if (c.type === 'image' && m.role !== 'assistant') parts.push({ type: 'input_image', image_url: dataUrl(c) });
        else if (c.type === 'file' && m.role !== 'assistant') parts.push({ type: 'input_file', filename: c.name || 'document.pdf', file_data: dataUrl(c) });
        else if (c.type === 'audio') parts.push({ type: 'input_text', text: '[a voice note was attached; this model cannot hear it]' });
        else if (c.type === 'tool_call') input.push({ type: 'function_call', call_id: c.id, name: c.name, arguments: JSON.stringify(c.args || {}) });
        else if (c.type === 'tool_result') input.push({ type: 'function_call_output', call_id: c.id, output: resultText(c.result) });
      }
      if (parts.length) input.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: parts });
    }
    const tools = (req.tools || []).map((t) => ({ type: 'function', name: t.name, description: t.description || '', parameters: schema(t.parameters || { type: 'object', properties: {} }) }));
    if (req.web) tools.push({ type: 'web_search' });
    const body = { model, instructions: sys || undefined, input, max_output_tokens: maxTokens };
    if (tools.length) body.tools = tools;
    if (req.json && !tools.length) body.text = { format: { type: 'json_object' } };
    const j = await post(ctx, 'https://api.openai.com/v1/responses', { authorization: 'Bearer ' + keys.openai }, body, ms);
    let text = ''; const calls = [];
    for (const o of j.output || []) {
      if (o.type === 'message') for (const c of o.content || []) { if (c.type === 'output_text') text += c.text || ''; }
      if (o.type === 'function_call') { let a = {}; try { a = JSON.parse(o.arguments || '{}'); } catch (_) { a = {}; } calls.push({ id: o.call_id, name: o.name, args: a }); }
    }
    return { text: text.trim(), calls, usage: { in: (j.usage || {}).input_tokens, out: (j.usage || {}).output_tokens } };
  }
  if (provider === 'anthropic') {
    const messages = [];
    for (const m of req.messages || []) {
      const parts = [];
      for (const c of m.content || []) {
        if (c.type === 'text' && str(c.text)) parts.push({ type: 'text', text: c.text });
        else if (c.type === 'image') parts.push({ type: 'image', source: { type: 'base64', media_type: c.mime || 'image/jpeg', data: c.data } });
        else if (c.type === 'file') parts.push({ type: 'document', source: { type: 'base64', media_type: c.mime || 'application/pdf', data: c.data } });
        else if (c.type === 'audio') parts.push({ type: 'text', text: '[a voice note was attached; this model cannot hear it]' });
        else if (c.type === 'tool_call') parts.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
        else if (c.type === 'tool_result') parts.push({ type: 'tool_result', tool_use_id: c.id, content: resultText(c.result) });
      }
      if (parts.length) messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: parts });
    }
    const tools = (req.tools || []).map((t) => ({ name: t.name, description: t.description || '', input_schema: schema(t.parameters || { type: 'object', properties: {} }) }));
    if (req.web) tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 8 });
    const body = { model, max_tokens: maxTokens, messages };
    if (sys) body.system = sys;
    if (tools.length) body.tools = tools;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    const j = await post(ctx, 'https://api.anthropic.com/v1/messages', { 'x-api-key': keys.anthropic, 'anthropic-version': '2023-06-01' }, body, ms);
    let text = ''; const calls = [];
    for (const c of j.content || []) {
      if (c.type === 'text') text += c.text || '';
      if (c.type === 'tool_use') calls.push({ id: c.id, name: c.name, args: c.input || {} });
    }
    return { text: text.trim(), calls, usage: { in: (j.usage || {}).input_tokens, out: (j.usage || {}).output_tokens } };
  }
  if (provider === 'gemini') {
    const contents = [];
    for (const m of req.messages || []) {
      const parts = [];
      for (const c of m.content || []) {
        if (c.type === 'text' && str(c.text)) parts.push({ text: c.text });
        else if (c.type === 'image' || c.type === 'file' || c.type === 'audio') parts.push({ inline_data: { mime_type: c.mime, data: c.data } });
        else if (c.type === 'tool_call') parts.push({ functionCall: { name: c.name, args: c.args || {} } });
        else if (c.type === 'tool_result') parts.push({ functionResponse: { name: c.name, response: c.result && typeof c.result === 'object' && !Array.isArray(c.result) ? c.result : { result: c.result } } });
      }
      if (parts.length) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
    }
    const body = { contents, generationConfig: { maxOutputTokens: maxTokens } };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    if (req.temperature !== undefined) body.generationConfig.temperature = req.temperature;
    const tools = [];
    if (req.tools && req.tools.length) tools.push({ function_declarations: req.tools.map((t) => ({ name: t.name, description: t.description || '', parameters: t.parameters })) });
    if (req.web && !tools.length) tools.push({ google_search: {} });   // Gemini does not mix search with own tools
    if (tools.length) body.tools = tools;
    if (req.json && !tools.length) body.generationConfig.responseMimeType = 'application/json';
    const j = await post(ctx, 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(keys.gemini), {}, body, ms);
    const parts = ((((j.candidates || [])[0] || {}).content || {}).parts || []);
    const calls = parts.filter((x) => x.functionCall).map((x, i) => ({ id: 'g' + i + '-' + Date.now(), name: x.functionCall.name, args: x.functionCall.args || {} }));
    const u = j.usageMetadata || {};
    return { text: parts.filter((x) => !x.thought).map((x) => x.text || '').join('').trim(), calls, usage: { in: u.promptTokenCount, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) }, rawParts: parts };
  }
  if (provider === 'custom') {
    const messages = [];
    if (sys) messages.push({ role: 'system', content: sys });
    for (const m of req.messages || []) {
      const parts = [], calls = [];
      for (const c of m.content || []) {
        if (c.type === 'text') parts.push({ type: 'text', text: c.text });
        else if (c.type === 'image') parts.push({ type: 'image_url', image_url: { url: dataUrl(c) } });
        else if (c.type === 'tool_call') calls.push({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } });
        else if (c.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: c.id, content: resultText(c.result) });
      }
      if (calls.length) messages.push({ role: 'assistant', content: parts.map((p) => p.text || '').join('') || null, tool_calls: calls });
      else if (parts.length) messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: parts.every((p) => p.type === 'text') ? parts.map((p) => p.text).join('\n') : parts });
    }
    const body = { model, messages, max_tokens: maxTokens };
    if (req.tools && req.tools.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: schema(t.parameters || { type: 'object', properties: {} }) } }));
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.json && !body.tools) body.response_format = { type: 'json_object' };
    const j = await post(ctx, str(keys.customBase).replace(/\/+$/, '') + '/chat/completions', { authorization: 'Bearer ' + keys.custom }, body, ms);
    const msg = (((j.choices || [])[0] || {}).message) || {};
    const calls = (msg.tool_calls || []).map((c) => { let a = {}; try { a = JSON.parse((c.function || {}).arguments || '{}'); } catch (_) { a = {}; } return { id: c.id, name: (c.function || {}).name, args: a }; });
    return { text: str(msg.content), calls, usage: { in: (j.usage || {}).prompt_tokens, out: (j.usage || {}).completion_tokens } };
  }
  throw new Error('Unknown AI provider.');
}

/**
 * A conversation with tools: run(name, args) answers each call; up to `turns` rounds.
 * Returns { text, calls: [{name, args, result}], provider, model }.
 */
export async function aiTools(ctx, opts) {
  const { messages, purpose, task, budgetMs = 115000 } = opts;
  const t = task || taskOf(purpose);
  if (!opts.tier) {
    const R = await routes(ctx), keys = await providerKeys(ctx);
    const why = isComplex(messages);
    if (R.cheap.includes(t) && keys.gemini && !why) {
      const t0 = Date.now();
      let r = null, reason = '';
      try {
        r = await aiTools(ctx, { ...opts, tier: 'cheap', budgetMs: Math.min(45000, budgetMs / 2),
          system: str(opts.system) + '\n\nIf the customer\'s message is complex, a complaint, a technical problem, or you are not sure, call hand_to_senior - a stronger assistant answers instead.',
          tools: [...(opts.tools || []), { name: 'hand_to_senior', description: 'Hand this conversation to a stronger assistant: use it for complex questions, complaints, technical problems or when you are not sure.', parameters: { type: 'object', properties: { reason: { type: 'string' } } } }] });
      } catch (e) { reason = 'the free model failed: ' + str(e && e.message).slice(0, 80); }
      const handed = r && r.calls.find((c) => c.name === 'hand_to_senior');
      if (r && !handed && str(r.text)) return { ...r, tier: 'cheap' };
      if (handed) reason = 'handed over: ' + str(handed.args && handed.args.reason).slice(0, 80);
      else if (r && !str(r.text)) reason = 'no answer from the free model';
      const sres = await aiTools(ctx, { ...opts, tier: 'strong', budgetMs: Math.max(30000, budgetMs - (Date.now() - t0)) });
      return { ...sres, tier: 'strong', escalated: reason, calls: [...((r && r.calls) || []).filter((c) => c.name !== 'hand_to_senior'), ...sres.calls] };
    }
    if (why && R.cheap.includes(t)) { const sres = await aiTools(ctx, { ...opts, tier: 'strong' }); return { ...sres, tier: 'strong', escalated: why }; }
  }
  return toolLoop(ctx, { ...opts, task: t });
}
async function toolLoop(ctx, { system, messages, tools, run, purpose, task, conversationId, turns = 8, temperature, web, onCall, budgetMs = 115000, tier }) {
  const convo = (messages || []).slice();
  const deadline = Date.now() + budgetMs;
  const calls = [];
  let last = {};
  for (let t = 0; t < turns; t++) {
    let r;
    try { r = await ai(ctx, { system, messages: convo, tools, purpose, task, conversationId, temperature, web, deadline, tier }); }
    catch (e) { if (t > 0 && /timeout|out of time|busy/i.test(String(e && e.message))) return { text: last.text || '', calls, provider: last.provider, model: last.model, cut: true }; throw e; }
    last = r;
    if (!r.calls.length) return { text: r.text, calls, provider: r.provider, model: r.model };
    convo.push({ role: 'assistant', content: [...(r.text ? [{ type: 'text', text: r.text }] : []), ...r.calls.map((c) => ({ type: 'tool_call', id: c.id, name: c.name, args: c.args }))] });
    const results = [];
    // the hand-over is not an ERP function: the cheap loop stops at once and the strong one answers
    if (r.calls.some((c) => c.name === 'hand_to_senior')) return { text: '', calls: [...calls, ...r.calls.map((c) => ({ name: c.name, args: c.args, result: null }))], provider: r.provider, model: r.model };
    for (const c of r.calls) {
      let result;
      try { result = await run(c.name, c.args || {}); } catch (e) { result = { error: String((e && e.message) || e) }; }
      if (onCall) { try { onCall(c, result); } catch (_) { /* only a listener */ } }
      calls.push({ name: c.name, args: c.args, result });
      results.push({ type: 'tool_result', id: c.id, name: c.name, result: result && typeof result === 'object' && !Array.isArray(result) ? result : { result } });
    }
    convo.push({ role: 'user', content: results });
  }
  return { text: last.text || '', calls, provider: last.provider, model: last.model };
}

// ---------------------------------------------------------------- the old Gemini-shaped calls, now through the router
/** A Gemini generateContent body -> neutral { system, messages, tools, json, web, temperature }. */
export function fromGeminiBody(body) {
  const b = body || {};
  const sys = ((b.systemInstruction || b.system_instruction || {}).parts || []).map((p) => p.text || '').join('\n');
  const messages = [];
  let n = 0;
  const pending = [];
  for (const c of b.contents || []) {
    const content = [];
    for (const p of c.parts || []) {
      const inl = p.inline_data || p.inlineData;
      if (p.text !== undefined) content.push({ type: 'text', text: p.text });
      else if (inl) { const mime = inl.mime_type || inl.mimeType || ''; content.push({ type: /^image\//.test(mime) ? 'image' : /^audio\//.test(mime) || /^video\//.test(mime) ? 'audio' : 'file', mime, data: inl.data }); }
      else if (p.functionCall) { const id = 'c' + (n++); pending.push({ id, name: p.functionCall.name }); content.push({ type: 'tool_call', id, name: p.functionCall.name, args: p.functionCall.args || {} }); }
      else if (p.functionResponse) { const i = pending.findIndex((x) => x.name === p.functionResponse.name); const id = i >= 0 ? pending.splice(i, 1)[0].id : 'c' + (n++); content.push({ type: 'tool_result', id, name: p.functionResponse.name, result: p.functionResponse.response }); }
    }
    if (content.length) messages.push({ role: c.role === 'model' ? 'assistant' : 'user', content });
  }
  const gc = b.generationConfig || b.generation_config || {};
  const tools = [];
  let web = false;
  for (const t of b.tools || []) {
    if (t.google_search || t.googleSearch) web = true;
    for (const f of t.function_declarations || t.functionDeclarations || []) tools.push(f);
  }
  return { system: sys, messages, tools, web, json: /json/i.test(str(gc.responseMimeType || gc.response_mime_type)), temperature: gc.temperature, maxTokens: gc.maxOutputTokens };
}
