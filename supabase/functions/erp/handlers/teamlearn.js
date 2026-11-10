// learn-1 (owner 10 Nov 2026): "take the data from our database and train the AI salesperson on it."
//
// The business's own team has answered thousands of customer messages in the Inbox (author 'team'). This reads those
// real exchanges (what the customer wrote -> what our person answered), asks the AI to describe HOW our team talks
// (words, length, Banglish, how they greet, how they push to the order) and to pick a handful of short real examples,
// and keeps the result in business_config 'inbox_learned'. agentReply puts it in the prompt (learnedBlock) so the AI
// salesperson writes like our people do. It copies the manner, never the old facts: prices, stock and dates always come
// from the ERP's tools. Nothing is fine-tuned; the owner sees the result in Agent Desk, can switch it off or run again.
//
//   erpInboxLearn {action: 'get'}           what was learned (and how many exchanges there are to learn from)
//   erpInboxLearn {action: 'run'}           read the newest exchanges and learn again (manager+)
//   erpInboxLearn {action: 'on'|'off'}      use it in replies or not

import { formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { gemini, jsonOf } from '../lib/gemini.js';

const str = (v) => String(v == null ? '' : v).trim();
const KEY = 'inbox_learned';
const MAX_PAIRS = 300;

/** The auto greeting of the page ("Hi X, thanks for contacting us...") is not our people talking. */
const CANNED = /thanks for contacting us|please let us know your query|one of our customer|আমাদের সাথে যোগাযোগ করার জন্য ধন্যবাদ/i;
/** Phone numbers and e-mails are never learned. */
export function scrub(t) {
  return str(t).replace(/(\+?88)?01[3-9][0-9 -]{8,10}/g, '[phone]').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\s+/g, ' ').slice(0, 300);
}

/** The newest real exchanges: the customer's message(s) just before a team reply, and that reply. */
export async function teamPairs(ctx, limit) {
  const rows = await ctx.tx`
    select t.conversation_id, t.created_at, t.text as reply,
      (select string_agg(c.text, ' / ' order by c.created_at) from inbox_messages c
        where c.conversation_id = t.conversation_id and c.direction = 'in' and coalesce(c.text, '') <> ''
          and c.created_at < t.created_at
          and c.created_at > coalesce((select max(o.created_at) from inbox_messages o where o.conversation_id = t.conversation_id and o.direction = 'out' and o.created_at < t.created_at), '-infinity'::timestamptz)) as asked
    from inbox_messages t
    where t.business_id = ${ctx.biz} and t.author = 'team' and t.direction = 'out' and length(coalesce(t.text, '')) between 2 and 400
    order by t.created_at desc limit ${Math.max(limit * 3, 300)}`;
  const out = [];
  for (const r of rows) {
    if (!str(r.asked) || CANNED.test(str(r.reply))) continue;
    out.push({ asked: scrub(r.asked), reply: scrub(r.reply) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function learned(ctx) {
  let v = null;
  try { v = JSON.parse(str(await getConfig(ctx, KEY, '')) || 'null'); } catch (_) { v = null; }
  return v && typeof v === 'object' ? v : null;
}

/** The prompt block (agentReply): empty when nothing was learned or it is switched off. */
export async function learnedBlock(ctx) {
  const L = await learned(ctx);
  if (!L || !L.on || !str(L.style)) return '';
  const ex = (L.examples || []).slice(0, 12).map((e) => 'customer: ' + str(e.customer) + ' -> our person: ' + str(e.team)).join(' | ');
  return 'HOW OUR TEAM REALLY TALKS (learned from ' + (L.pairs || 0) + ' real chats with our customers - copy this manner, length and wording; NEVER copy a price, ' +
    'stock or date from it, those come only from your tools): ' + str(L.style) + (ex ? '\nREAL EXAMPLES FROM OUR TEAM: ' + ex : '');
}

export async function erpInboxLearn(ctx, payload) {
  const p = payload || {};
  const a = str(p.action) || 'get';
  if (a !== 'get' && !roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner changes what the AI learned.');
  let L = await learned(ctx);
  if (a === 'on' || a === 'off') {
    if (!L) throw new Error('Nothing learned yet - press Learn first.');
    L.on = a === 'on';
    await setConfig(ctx, KEY, JSON.stringify(L));
  } else if (a === 'run') {
    const pairs = await teamPairs(ctx, MAX_PAIRS);
    if (pairs.length < 20) throw new Error('Too few team replies in the Inbox to learn from (' + pairs.length + '); at least 20 are needed.');
    const lines = pairs.map((x, i) => (i + 1) + '. customer: ' + x.asked + '\n   our person: ' + x.reply).join('\n');
    const { parts } = await gemini(ctx, { systemInstruction: { parts: [{ text:
      'You study how a Bangladeshi shop\'s own sales team chats with customers on Messenger / WhatsApp, so an AI salesperson can write the same way. ' +
      'Below are real exchanges (newest first). Reply with JSON only: {"style": one paragraph of at most 900 characters, plain prose, describing HOW they write - ' +
      'Bangla script vs Banglish vs English and when, typical length, how they address people (bhai / vai / apu / boss / sir), their usual short words and phrases (quote a few exactly), ' +
      'how they answer price and stock questions, how they move to the order, what they never do; "examples": 8 to 12 of the best short exchanges copied as they are ' +
      '[{"customer": "...", "team": "..."}] - pick ones that show the manner well, not ones that only state a price or say something is out of stock; ' +
      '"habits": up to 6 short notes of good selling habits you see}. Do not include phone numbers, names of customers, or any price as a rule.' }] },
      contents: [{ role: 'user', parts: [{ text: lines }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }, 'learn', null);
    const j = jsonOf(parts);
    if (!j || !str(j.style)) throw new Error('The AI did not return what it learned - try again.');
    const examples = (Array.isArray(j.examples) ? j.examples : []).map((e) => ({ customer: scrub(e && e.customer).slice(0, 200), team: scrub(e && e.team).slice(0, 200) }))
      .filter((e) => e.customer && e.team).slice(0, 12);
    L = { on: true, style: str(j.style).slice(0, 1200), examples, habits: (Array.isArray(j.habits) ? j.habits : []).map((h) => str(h).slice(0, 200)).filter(Boolean).slice(0, 6),
      pairs: pairs.length, at: ctx.now.toISOString(), by: str(ctx.s.name) };
    await setConfig(ctx, KEY, JSON.stringify(L));
  }
  const n = (await ctx.tx`select count(*)::int n from inbox_messages where business_id = ${ctx.biz} and author = 'team' and direction = 'out'`)[0].n;
  return { learned: L ? { ...L, atText: L.at ? formatDate(new Date(L.at), 'd MMM yyyy, h:mm a') : '' } : null, teamReplies: n };
}

export const HANDLERS = { erpInboxLearn };
