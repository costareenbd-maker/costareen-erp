// boss-1 (owner 10 Nov 2026): "If they want more discount than you may give, or something feels off, say: I'm talking
// to my superior right now and will let you know. Then message our manager's WhatsApp from your own WhatsApp."
//
//   askSuperior     the AI's ask_superior tool: a superior_asks row (#R<n>) + a WhatsApp from the salesperson's own
//                   number (the newest live chat WhatsApp - Faujia Alvi's) to each phone in Agent Desk "superior_wa"
//   superiorInbound a WhatsApp from that manager phone to our number: "#R12 ok 1450" (or just the text, for the
//                   newest open ask) -> answered; the customer's chat is answered at once with it (never a customer chat)
//   pendingAnswers  agentReply's prompt block: what the manager decided, to tell the customer now
//
// A price the manager writes ("1450") becomes the agreed price for that product in that chat (place_order uses it).

import { formatDate } from '../lib/time.js';
import { sendOut } from './inboxch.js';

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const H24 = 24 * 3600e3;

/** '01847-800652, +8801...' -> ['8801847800652', ...] */
export function bossPhones(v) {
  return str(v).split(/[,;\n]+/).map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean)
    .map((d) => (d.length === 11 && d[0] === '0' ? '88' + d : d)).filter((d) => d.length >= 11 && d.length <= 15);
}
/** The salesperson's own WhatsApp: the newest live WhatsApp number kept for customer chat. */
async function ownWa(ctx) {
  const rows = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind in ('wa_evo', 'wa_cloud') and status = 'live' order by created_at desc, id`;
  return rows.find((c) => str((c.settings || {}).purpose || 'chat') === 'chat') || null;
}

export async function askSuperior(ctx, conv, contact, ch, a, cat, p, test) {
  const phones = bossPhones(p.superior_wa);
  if (!phones.length) return { error: 'no superior number is set - use handover instead' };
  const x = str(a.code) ? cat.find((y) => y.sku.toLowerCase() === str(a.code).toLowerCase()) : null;
  const q = str(a.question).slice(0, 500);
  if (!q) return { error: 'write the question for your superior' };
  if (test) return { asked: true, note: 'tell the customer in one line that you are checking with your superior right now and will let them know shortly; promise nothing' };
  const from = await ownWa(ctx);
  if (!from) return { error: 'no WhatsApp number to send from - use handover instead' };
  const n = (await ctx.tx`select count(*)::int n from superior_asks where business_id = ${ctx.biz}`)[0].n + 1;
  const ref = 'R' + n;
  await ctx.tx`insert into superior_asks (business_id, conversation_id, ref, question, sku, qty, wanted_price)
    values (${ctx.biz}, ${conv.id}, ${ref}, ${q}, ${x ? x.sku : ''}, ${num(a.qty) || null}, ${num(a.wanted_price) || null})`;
  const lines = ['🙋 ' + (str(p.agent_name).replace(/\s*\(.*\)\s*/, '') || 'AI') + ' → আপনার কাছে জানতে চাই (#' + ref + ')',
    'কাস্টমার: ' + (str(contact && contact.name) || 'নাম নেই') + ' (' + str(ch.name || ch.kind) + ')',
    'প্রশ্ন: ' + q];
  if (x) lines.push('প্রোডাক্ট: ' + x.name + (num(a.qty) ? ' × ' + num(a.qty) : '') + ' — আমাদের দাম ৳' + Math.round(num(x.sell)).toLocaleString('en-IN') +
    (num(a.wanted_price) ? ', কাস্টমার চাইছেন ৳' + Math.round(num(a.wanted_price)).toLocaleString('en-IN') : ''));
  lines.push('', 'উত্তর দিন এভাবে: #' + ref + ' তারপর আপনার কথা (যেমন "#' + ref + ' 1450 দেওয়া যাবে" বা "#' + ref + ' না, ৳1550 এর নিচে না")। আমি কাস্টমারকে জানিয়ে দেব।');
  let sent = 0;
  for (const ph of phones) { const r = await sendOut(ctx, from, { external_id: ph }, { kind: 'text', text: lines.join('\n') }); if (r.ok) sent++; }
  const { writeMsgNote, task } = await import('./inbox.js');
  await writeMsgNote(ctx, conv, 'Asked the manager on WhatsApp (#' + ref + '): ' + q + (sent ? '' : ' - NOT sent, the WhatsApp number did not take it'));
  if (!sent) { await task(ctx, conv.id, 'enquiry', null, 'The AI needs the manager (#' + ref + '): ' + q); }
  return { asked: true, ref, note: 'tell the customer in one line that you are checking with your superior right now and will let them know shortly; promise nothing' };
}

/** A WhatsApp that came in on our number: from the manager about an open ask? Then it is handled here (true). */
export async function superiorInbound(ctx, ch, ev) {
  if (!/^wa_/.test(ch.kind)) return false;
  const { profile } = await import('./inbox.js');
  const p = await profile(ctx, false);
  const phones = bossPhones(p.superior_wa);
  const from = str(ev.from).replace(/@.*$/, '').replace(/[^0-9]/g, '');
  if (!from || !phones.includes(from)) return false;
  const text = str(ev.text);
  const m = text.match(/#?\b(R\d+)\b/i);
  const ask = m ? (await ctx.tx`select * from superior_asks where business_id = ${ctx.biz} and upper(ref) = ${m[1].toUpperCase()}`)[0]
    : (await ctx.tx`select * from superior_asks where business_id = ${ctx.biz} and status = 'open' and asked_at > ${new Date(ctx.now.getTime() - H24)} order by asked_at desc limit 1`)[0];
  if (!ask) return false;                         // the manager just chatting with this number: an ordinary message
  const answer = text.replace(/#?\b(R\d+)\b/i, '').trim();
  const pm = answer.replace(/[,৳]/g, '').match(/\b(\d{2,7})\b/);
  const price = ask.sku && pm ? Number(pm[1]) : null;
  await ctx.tx`update superior_asks set status = 'answered', answer = ${answer}, answer_price = ${price}, answered_at = now() where id = ${ask.id}`;
  if (ask.conversation_id) {
    const v = (await ctx.tx`select * from inbox_conversations where id = ${ask.conversation_id}`)[0];
    if (v) {
      if (price && ask.sku && !/\b(na|no|না|নাহ)\b/i.test(answer)) {
        await ctx.tx`update inbox_conversations set boss_agreed = coalesce(boss_agreed, '{}'::jsonb) || ${ctx.tx.json({ [ask.sku]: price })} where id = ${v.id}`;
      }
      const { writeMsgNote } = await import('./inbox.js');
      await writeMsgNote(ctx, v, 'Manager answered #' + ask.ref + ': ' + answer);
      if (v.mode === 'ai') await ctx.tx`update inbox_conversations set reply_due_at = ${ctx.now} where id = ${v.id}`;
    }
  }
  try { await sendOut(ctx, ch, { external_id: from }, { kind: 'text', text: '✅ #' + ask.ref + ' কাস্টমারকে জানিয়ে দিচ্ছি।' }); } catch (_) { /* fine */ }
  return true;
}

/** agentReply: what the manager decided, still to tell this customer. */
export async function pendingAnswers(ctx, convId) {
  const rows = await ctx.tx`select * from superior_asks where business_id = ${ctx.biz} and conversation_id = ${convId} and status = 'answered' order by answered_at`;
  if (!rows.length) return { block: '', ids: [] };
  return { ids: rows.map((r) => r.id), block: 'YOUR SUPERIOR HAS ANSWERED (tell the customer NOW, in one short message, as the shop\'s decision - do not mention WhatsApp or a reference): ' +
    rows.map((r) => '"' + str(r.question) + '" -> "' + str(r.answer) + '"' + (r.answer_price && r.sku ? ' (agreed price for ' + r.sku + ': ৳' + Math.round(num(r.answer_price)) + ' each - place_order uses it)' : '')).join(' | ') };
}
export async function markRelayed(ctx, ids) {
  if (ids && ids.length) await ctx.tx`update superior_asks set status = 'relayed' where id = any(${ids})`;
}
export { formatDate };
