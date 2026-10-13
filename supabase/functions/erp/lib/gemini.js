// One door to the AI for the Inbox (handlers/inbox*.js): Gemini through the business's key (aiKey), the models
// tried in order, function calling, photos and voice notes as inline data, and every call written to ai_work with
// its tokens and an estimated cost in taka - the owner sees what each piece of AI work cost (as AiPraktor's billing
// page lists every reply). Tests stand a scripted Gemini in through deps.fetch.

import { aiKey, GEMINI_MODELS } from '../handlers/receivefile.js';

const str = (v) => String(v == null ? '' : v).trim();
// rough prices in US$ per million tokens (input, output) - an estimate for the owner, not a bill
const PRICE = { 'gemini-flash-lite-latest': [0.10, 0.40], 'gemini-2.5-flash-lite': [0.10, 0.40], 'gemini-2.5-flash': [0.30, 2.50] };
const BDT_PER_USD = 122;
const TIMEOUT_MS = 40000;

export function costBdt(model, tin, tout) {
  const p = PRICE[model] || [0.30, 2.50];
  return Math.round(((tin * p[0] + tout * p[1]) / 1e6) * BDT_PER_USD * 10000) / 10000;
}

/** Bytes -> base64 (for a photo or a voice note sent to the AI). */
export function b64(bytes) {
  let s = '';
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

async function logWork(ctx, purpose, conversationId, model, usage) {
  const tin = Number((usage && usage.promptTokenCount) || 0), tout = Number((usage && (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0)) || 0);
  try {
    await ctx.tx`insert into ai_work (business_id, purpose, conversation_id, model, tokens_in, tokens_out, cost_bdt)
                 values (${ctx.biz}, ${purpose}, ${conversationId || null}, ${model}, ${tin}, ${tout}, ${costBdt(model, tin, tout)})`;
  } catch (_) { /* the log is never the reason an answer fails */ }
}

/**
 * One request. body = Gemini generateContent body. Returns { parts, model }.
 * Throws a plain sentence when no model answers.
 */
export async function gemini(ctx, body, purpose, conversationId) {
  const key = (await aiKey(ctx)).key;
  if (!key) throw new Error('No AI key is set on this ERP (Platform > AI reader).');
  let last = '';
  for (const model of GEMINI_MODELS) {
    const ac = typeof AbortController === 'function' ? new AbortController() : null, timer = ac ? setTimeout(() => ac.abort(), TIMEOUT_MS) : null;
    let res, txt;
    try {
      res = await (ctx.deps.fetch || fetch)('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac ? ac.signal : undefined });
      txt = await res.text();
    } catch (_) { last = 'timeout'; continue; } finally { if (timer) clearTimeout(timer); }
    if (!res.ok) { last = res.status + ' ' + String(txt).slice(0, 160); if ([404, 429, 500, 503].includes(res.status)) continue; throw new Error('The AI could not answer (' + res.status + ').'); }
    let j; try { j = JSON.parse(txt); } catch (_) { last = 'not json'; continue; }
    await logWork(ctx, purpose, conversationId, model, j.usageMetadata);
    const parts = ((((j.candidates || [])[0] || {}).content || {}).parts || []);
    return { parts, model };
  }
  throw new Error(/429|503|timeout/.test(last) ? 'The AI is busy right now.' : 'The AI could not answer. ' + last);
}

/** Text of a reply. */
export function textOf(parts) { return (parts || []).map((x) => x.text || '').join('').trim(); }

/** Ask for JSON and read it (```json fences tolerated). */
export function jsonOf(parts) {
  const t = textOf(parts).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (_) {
    const m = /\{[\s\S]*\}|\[[\s\S]*\]/.exec(t);
    if (m) { try { return JSON.parse(m[0]); } catch (_) { /* fall through */ } }
    return null;
  }
}

/**
 * A conversation with tools: run(name, args) answers each call; up to `turns` rounds.
 * Returns { text, calls: [{name, args, result}] }.
 */
export async function geminiTools(ctx, { system, contents, tools, run, purpose, conversationId, turns = 6, temperature = 0.3 }) {
  const convo = contents.slice();
  const calls = [];
  for (let t = 0; t < turns; t++) {
    const { parts } = await gemini(ctx, {
      systemInstruction: { parts: [{ text: system }] }, contents: convo,
      tools: tools && tools.length ? [{ function_declarations: tools }] : undefined,
      generationConfig: { temperature },
    }, purpose, conversationId);
    const fc = parts.filter((x) => x.functionCall);
    if (!fc.length) return { text: textOf(parts), calls };
    convo.push({ role: 'model', parts });
    const responses = [];
    for (const c of fc) {
      const name = str(c.functionCall.name), args = c.functionCall.args || {};
      let result;
      try { result = await run(name, args); } catch (e) { result = { error: String((e && e.message) || e) }; }
      calls.push({ name, args, result });
      responses.push({ functionResponse: { name, response: result && typeof result === 'object' && !Array.isArray(result) ? result : { result } } });
    }
    convo.push({ role: 'user', parts: responses });
  }
  return { text: '', calls };
}
