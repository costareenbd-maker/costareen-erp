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
//
// boss-2 (owner 11 Nov 2026): "any doubt, anything - tell the manager directly". The same WhatsApp line now also carries
//   askTeam      a question the AI cannot answer (ask_team) -> the manager's answer goes to the customer
//   tellHandover the AI handed the chat over (angry, complaint, refund, a person) -> "#R6 ami dekhchi" keeps it with a
//                person; any other answer gives the chat back to the AI, which tells the customer
// The manager writing to this number with nothing open gets a one-line hint (never the sales AI).
// boss-3 (owner 11 Nov 2026): strategic questions (bring a printer in within two weeks, new stock, dealer / bulk deals)
//   go to the MD (Agent Desk team_wa), basic ones to the manager (superior_wa) - one person each, never both. Their
//   words are never sent to the customer as they are: the AI tells the decision in its own polite words. What they
//   answered (facts, not one customer's deal) is kept and put in the AI's prompt for later chats (bossKnowledge).
const ROLE_BN = { manager: 'ম্যানেজার', md: 'MD' };
/** Who gets it: 'md' -> the MD's WhatsApp (team_wa), else the manager's (superior_wa); either falls back to the other. */
export function targetOf(p, want) {
  const md = bossPhones(p.team_wa), mg = bossPhones(p.superior_wa);
  if (want === 'md' && md.length) return { to: 'md', phones: md.slice(0, 1) };
  if (mg.length) return { to: 'manager', phones: mg };
  return md.length ? { to: 'md', phones: md.slice(0, 1) } : { to: '', phones: [] };
}

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

const agentOf = (p) => str(p.agent_name).replace(/\s*\(.*\)\s*/, '') || 'AI';
/** boss-2: one row (#R<n>) + the WhatsApp to each manager phone from the salesperson's own number. */
export async function tellManager(ctx, conv, contact, ch, p, kind, question, lines, extra) {
  const x = extra || {};
  const { to, phones } = targetOf(p, x.to);
  if (!phones.length) return { sent: 0, error: 'no superior number' };
  const from = await ownWa(ctx);
  if (!from) return { sent: 0, error: 'no WhatsApp number to send from' };
  const n = (await ctx.tx`select count(*)::int n from superior_asks where business_id = ${ctx.biz}`)[0].n + 1;
  const ref = 'R' + n;
  await ctx.tx`insert into superior_asks (business_id, conversation_id, ref, question, sku, qty, wanted_price, kind, sent_to)
    values (${ctx.biz}, ${conv.id}, ${ref}, ${str(question).slice(0, 500)}, ${x.sku || ''}, ${x.qty || null}, ${x.wanted || null}, ${kind}, ${to})`;
  const text = lines(ref).join('\n');
  let sent = 0;
  for (const ph of phones) { try { const r = await sendOut(ctx, from, { external_id: ph }, { kind: 'text', text }); if (r.ok) sent++; } catch (_) { /* counted as not sent */ } }
  return { sent, ref, to };
}
const who = (contact, ch) => 'কাস্টমার: ' + (str(contact && contact.name) || 'নাম নেই') + ' (' + str(ch.name || ch.kind) + (str(contact && contact.phone) ? ', ' + str(contact.phone) : '') + ')';
async function lastIn(ctx, conv) {
  const m = (await ctx.tx`select text, kind from inbox_messages where conversation_id = ${conv.id} and direction = 'in' order by created_at desc, id desc limit 1`)[0];
  return m ? (str(m.text) || (m.kind === 'image' ? '(একটা ছবি)' : m.kind === 'audio' ? '(ভয়েস মেসেজ)' : '')) : '';
}
/** ask_team: a detail the AI does not have - the manager on WhatsApp (and the task, as before). */
export async function askTeam(ctx, conv, contact, ch, p, q, level) {
  const md = level === 'strategic';
  const r = await tellManager(ctx, conv, contact, ch, p, 'team', q, (ref) => [(md ? '📌 ' + agentOf(p) + ' → স্যার, একটা সিদ্ধান্ত দরকার (নং ' + ref.slice(1) + ')' : '❓ ' + agentOf(p) + ' → এটা আমার জানা নেই, আপনার কাছে জানতে চাই (নং ' + ref.slice(1) + ')'), who(contact, ch), 'প্রশ্ন: ' + q,
    '', 'যেভাবে খুশি উত্তর দিন, আমি বুঝে গুছিয়ে কাস্টমারকে বলব।'], { to: md ? 'md' : 'manager' });
  const { writeMsgNote } = await import('./inbox.js');
  if (r.ref) await writeMsgNote(ctx, conv, 'Asked the ' + (r.to === 'md' ? 'MD' : 'manager') + ' on WhatsApp (#' + r.ref + '): ' + q + (r.sent ? '' : ' - NOT sent, the WhatsApp number did not take it'));
  return r;
}
/** After the AI handed a chat over: the manager hears it at once on WhatsApp. */
export async function tellHandover(ctx, conv, contact, ch, p, label, note) {
  const said = await lastIn(ctx, conv);
  const r = await tellManager(ctx, conv, contact, ch, p, 'handover', label + (note ? ' - ' + note : ''), (ref) => ['🚨 ' + agentOf(p) + ' → এই কাস্টমারকে একজন মানুষ দেখা দরকার (নং ' + ref.slice(1) + ')', who(contact, ch),
    'কারণ: ' + label + (note ? ' — ' + note : '')].concat(said ? ['কাস্টমারের শেষ কথা: "' + said.slice(0, 300) + '"'] : [],
    ['', 'নিজে দেখলে লিখুন "আমি দেখছি"। নইলে বলুন কাস্টমারকে কী বলব - আমি জানিয়ে দেব।']));
  const { writeMsgNote } = await import('./inbox.js');
  if (r.ref) await writeMsgNote(ctx, conv, 'Told the manager on WhatsApp (#' + r.ref + ')' + (r.sent ? '' : ' - NOT sent, the WhatsApp number did not take it'));
  return r;
}

export async function askSuperior(ctx, conv, contact, ch, a, cat, p, test) {
  const phones = bossPhones(p.superior_wa);
  if (!phones.length) return { error: 'no superior number is set - use handover instead' };
  const x = str(a.code) ? cat.find((y) => y.sku.toLowerCase() === str(a.code).toLowerCase()) : null;
  const q = str(a.question).slice(0, 500);
  if (!q) return { error: 'write the question for your superior' };
  if (test) return { asked: true, note: 'tell the customer in one line that you are checking with your superior right now and will let them know shortly; promise nothing' };
  if (!(await ownWa(ctx))) return { error: 'no WhatsApp number to send from - use handover instead' };
  const { ref, sent, to } = await tellManager(ctx, conv, contact, ch, p, 'discount', q, (ref) => {
    const lines = ['🙋 ' + agentOf(p) + ' → আপনার কাছে জানতে চাই (নং ' + ref.slice(1) + ')', who(contact, ch), 'প্রশ্ন: ' + q];
    if (x) lines.push('প্রোডাক্ট: ' + x.name + (num(a.qty) ? ' × ' + num(a.qty) : '') + ' — আমাদের দাম ৳' + Math.round(num(x.sell)).toLocaleString('en-IN') +
      (num(a.wanted_price) ? ', কাস্টমার চাইছেন ৳' + Math.round(num(a.wanted_price)).toLocaleString('en-IN') : ''));
    lines.push('', 'যেভাবে খুশি উত্তর দিন (যেমন "1450 দেওয়া যাবে" বা "না, 1550 এর নিচে না") - আমি গুছিয়ে কাস্টমারকে বলব।');
    return lines;
  }, { sku: x ? x.sku : '', qty: num(a.qty) || null, wanted: num(a.wanted_price) || null, to: str(a.level) === 'strategic' ? 'md' : 'manager' });
  const { writeMsgNote, task } = await import('./inbox.js');
  await writeMsgNote(ctx, conv, 'Asked the ' + (to === 'md' ? 'MD' : 'manager') + ' on WhatsApp (#' + ref + '): ' + q + (sent ? '' : ' - NOT sent, the WhatsApp number did not take it'));
  if (!sent) { await task(ctx, conv.id, 'enquiry', null, 'The AI needs the manager (#' + ref + '): ' + q); }
  return { asked: true, ref, note: 'tell the customer in one line that you are checking with your superior right now and will let them know shortly; promise nothing' };
}

/** A WhatsApp that came in on our number: from the manager / MD? Then it is handled here (true), never by the sales AI. */
export async function superiorInbound(ctx, ch, ev) {
  if (!/^wa_/.test(ch.kind)) return false;
  const { profile } = await import('./inbox.js');
  const p = await profile(ctx, false);
  const mg = bossPhones(p.superior_wa), md = bossPhones(p.team_wa);
  const from = str(ev.from).replace(/@.*$/, '').replace(/[^0-9]/g, '');
  if (!from || !(mg.includes(from) || md.includes(from))) return false;
  const role = mg.includes(from) ? 'manager' : 'md';
  const text = str(ev.text);
  if (!text) return true;
  const sir = role === 'md' ? 'স্যার' : 'ভাই';
  const say = async (t) => { try { await sendOut(ctx, ch, { external_id: from }, { kind: 'text', text: t }); } catch (_) { /* fine */ } };
  // an explicit "#R12 ..." still answers that question at once (fast, no AI needed)
  const m = text.match(/#\s*(R\d+)\b/i) || text.match(/^\s*(R\d+)\b/i);
  const byRef = m ? (await ctx.tx`select * from superior_asks where business_id = ${ctx.biz} and upper(ref) = ${m[1].toUpperCase()}`)[0] : null;
  if (byRef) { await say(await applyAnswer(ctx, role, byRef, text.replace(m[0], '').trim())); return true; }
  // boss-4: everything else is a conversation with the AI (questions, look-ups, answers, commands) in plain words
  let out = null;
  try { out = await ctx.tx.savepoint(async () => (await import('./bosschat.js')).bossChat(ctx, ch, from, role, text, p, applyAnswer)); } catch (e) { console.error('bossChat', e && e.message); out = null; }
  if (out) { await say(out); return true; }
  // no AI answered: the newest open question sent to this person takes the message as its answer; else a plain sentence
  const ask = (await ctx.tx`select * from superior_asks where business_id = ${ctx.biz} and status = 'open' and asked_at > ${new Date(ctx.now.getTime() - H24)}
                 and (sent_to = ${role} or ${mg.includes(from) && md.includes(from)}) order by asked_at desc limit 1`)[0];
  if (ask) { await say(await applyAnswer(ctx, role, ask, text)); return true; }
  await say('জি ' + sir + ', এই মুহূর্তে আমি উত্তর দিতে পারছি না (AI ব্যস্ত)। কয়েক মিনিট পরে আবার লিখুন।');
  return true;
}

/** Their answer to one question (a hand-over or a question): recorded, the customer's chat is told. Returns the reply to them. */
export async function applyAnswer(ctx, role, ask, answer) {
  const sir = role === 'md' ? 'স্যার' : 'ভাই';
  const label = role === 'md' ? 'MD' : 'Manager';
  const v = ask.conversation_id ? (await ctx.tx`select * from inbox_conversations where id = ${ask.conversation_id}`)[0] : null;
  const c = v ? (await ctx.tx`select name from inbox_contacts where id = ${v.contact_id}`)[0] : null;
  const cust = str(c && c.name) ? str(c.name) + '-কে' : 'কাস্টমারকে';
  const { writeMsgNote } = await import('./inbox.js');
  // boss-2: a hand-over - "ami dekhchi" keeps it with a person; any other answer gives the chat back to the AI to tell
  if (ask.kind === 'handover') {
    const mine = /আমি\s*দেখ|ami\s*dekh|i'?ll\s*handle|handle\s*kor|দেখতেছি|দেখছি|কল\s*দিচ্ছি|call\s*di/i.test(answer);
    await ctx.tx`update superior_asks set status = ${mine ? 'relayed' : 'answered'}, answer = ${answer}, answered_at = now() where id = ${ask.id}`;
    if (v) {
      await writeMsgNote(ctx, v, label + ' answered #' + ask.ref + ': ' + answer + (mine ? ' (a person takes it)' : ' - back to the AI to tell the customer'));
      if (mine) await ctx.tx`update inbox_conversations set claimed_name = ${label + ' (WhatsApp)'} where id = ${v.id}`;
      else await ctx.tx`update inbox_conversations set mode = 'ai', human_until = null, claimed_by = null, claimed_name = null, reply_due_at = ${ctx.now} where id = ${v.id}`;
    }
    return mine ? 'জি ' + sir + ', চ্যাটটা আপনার হাতে দিলাম। আমি আর উত্তর দিচ্ছি না।' : 'জি ' + sir + ', ' + cust + ' এখনই জানিয়ে দিচ্ছি।';
  }
  const pm = answer.replace(/[,৳]/g, '').match(/\b(\d{2,7})\b/);
  const price = ask.sku && pm ? Number(pm[1]) : null;
  await ctx.tx`update superior_asks set status = 'answered', answer = ${answer}, answer_price = ${price}, answered_at = now() where id = ${ask.id}`;
  if (v) {
    if (price && ask.sku && !/\b(na|no|না|নাহ)\b/i.test(answer)) {
      await ctx.tx`update inbox_conversations set boss_agreed = coalesce(boss_agreed, '{}'::jsonb) || ${ctx.tx.json({ [ask.sku]: price })} where id = ${v.id}`;
    }
    await writeMsgNote(ctx, v, label + ' answered #' + ask.ref + ': ' + answer);
    if (v.mode === 'ai') await ctx.tx`update inbox_conversations set reply_due_at = ${ctx.now} where id = ${v.id}`;
  }
  return 'জি ' + sir + ', ' + cust + ' এখনই জানিয়ে দিচ্ছি।';
}

/** agentReply: what the manager decided, still to tell this customer. */
export async function pendingAnswers(ctx, convId) {
  const rows = await ctx.tx`select * from superior_asks where business_id = ${ctx.biz} and conversation_id = ${convId} and status = 'answered' order by answered_at`;
  if (!rows.length) return { block: '', ids: [] };
  return { ids: rows.map((r) => r.id), block: 'YOUR SUPERIOR HAS ANSWERED (tell the customer NOW, in one short message, as the shop\'s decision - do not mention WhatsApp or a reference). ' +
    'Their words are an internal note to YOU, written casually: NEVER copy, quote or forward them; understand the decision and say it to the customer in your own polite words, in the customer\'s language ' +
    '(e.g. the note "haa 1400 e diye dao" -> you: "ভাই, আপনার জন্য স্পেশালি ৳১,৪০০ করে দিতে পারবো।"; "2 week e ana jabe, 50% advance" -> "জি ভাই, ২ সপ্তাহের মধ্যে এনে দিতে পারবো, ৫০% অ্যাডভান্স দিয়ে অর্ডার কনফার্ম করতে হবে।"): ' +
    rows.map((r) => '"' + str(r.question) + '" -> note: "' + str(r.answer) + '"' + (r.answer_price && r.sku ? ' (agreed price for ' + r.sku + ': ৳' + Math.round(num(r.answer_price)) + ' each - place_order uses it)' : '')).join(' | ') };
}
/** boss-3: what the manager / MD answered before - facts and policies for later chats (one customer's price is not). */
export async function bossKnowledge(ctx) {
  let rows = [];
  try {
    rows = await ctx.tx`select question, answer, sent_to, answered_at from superior_asks where business_id = ${ctx.biz} and kind = 'team' and status in ('answered', 'relayed')
                        and coalesce(answer, '') <> '' and answered_at > now() - interval '120 days' order by answered_at desc limit 25`;
  } catch (_) { return ''; }
  if (!rows.length) return '';
  return 'WHAT OUR MANAGER / MD TOLD YOU BEFORE (answers to questions you asked them - use them as the shop\'s facts and policy so you need not ask again; never quote them word for word, ' +
    'never say who told you; if a fact may have changed (stock, a date, a price) or the case is different, ask again): ' +
    rows.map((r) => '[' + formatDate(new Date(r.answered_at), 'd MMM') + ', ' + (r.sent_to === 'md' ? 'MD' : 'manager') + '] "' + str(r.question).slice(0, 200) + '" -> "' + str(r.answer).slice(0, 300) + '"').join(' | ');
}
export async function markRelayed(ctx, ids) {
  if (ids && ids.length) await ctx.tx`update superior_asks set status = 'relayed' where id = any(${ids})`;
}
export { formatDate };
