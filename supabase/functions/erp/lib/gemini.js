// One door to the AI for the Inbox (handlers/inbox*.js): Gemini through the business's key (aiKey), the models
// tried in order, function calling, photos and voice notes as inline data, and every call written to ai_work with
// its tokens and an estimated cost in taka - the owner sees what each piece of AI work cost (as AiPraktor's billing
// page lists every reply). Tests stand a scripted Gemini in through deps.fetch.

import { ai, aiTools, fromGeminiBody } from './ai.js';
export { costBdt } from './ai.js';
import { budget } from './inboxplan.js';

const str = (v) => String(v == null ? '' : v).trim();
/** Bytes -> base64 (for a photo or a voice note sent to the AI). */
export function b64(bytes) {
  let s = '';
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * One request. body = Gemini generateContent body (as every caller was written). Returns { parts, model }.
 * ai-1: it goes through lib/ai.js - the provider and model chosen for this kind of work (ChatGPT, Claude, Gemini or
 * the owner's own server), the strongest first, the others as fallback. Throws a plain sentence when no AI answers.
 */
export async function gemini(ctx, body, purpose, conversationId) {
  await budgetGate(ctx);
  const n = fromGeminiBody(body);
  const r = await ai(ctx, { ...n, purpose, conversationId });
  return { parts: [{ text: r.text }], model: r.provider + ':' + r.model };
}

/** The plan's monthly AI budget: once used up, no AI work (the minute timer opens the team's alert - inboxTick). */
async function budgetGate(ctx) {
  let b;
  try { b = await budget(ctx); } catch (_) { return; }
  if (b.stopped) throw new Error('The AI budget for this month is used up.');
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
 * Returns { text, calls: [{name, args, result}] }. ai-1: through lib/ai.js (any provider).
 */
export async function geminiTools(ctx, { system, contents, tools, run, purpose, conversationId, turns = 8, temperature = 0.3 }) {
  await budgetGate(ctx);
  const n = fromGeminiBody({ contents });
  return aiTools(ctx, { system, messages: n.messages, tools, run, purpose, conversationId, turns, temperature });
}
