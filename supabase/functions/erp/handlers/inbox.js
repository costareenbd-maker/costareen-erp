// The Inbox (120_inbox.sql, docs/ONE-STOP-PLAN.md): every chat channel in one place, answered by an AI agent from the
// ERP's own products, prices, stock and rules; a person takes over when one is needed.
//
// How a message travels
//   webhook / website chat -> ingest(): the contact, the conversation, the message (photos and voice notes stored)
//   -> reply_due_at = now + the channel's wait (15 s; 3 s on the website) so two quick messages get one answer
//   -> replyDue(): when the wait is over and nothing newer came, agentReply(): the AI reads the recent history, the
//      customer's ERP record, the business's details and rules, looks at photos and listens to voice notes, and
//      answers through its tools (products, cards, delivery charge, orders, leads, hand-over...). Everything it sends
//      is written down; every AI call is in ai_work with its cost.
//
// The agent's platform rules (not the business's to edit): short plain replies; speaks as "we"; never invents a price,
// discount, stock count, delivery date or policy; stock only as available / not available; asks before showing
// products when the customer is vague; up to 10 products; one extra offer before the order; name, phone and full
// address in one message, then the order is placed (the details are the consent); never takes payment details, never
// says money was received; a missing fact is said plainly and offered to the team; a complaint, refund, anger, a
// demand for a person, repeated abuse -> the chat goes to the team with the reason.

import { num, formatDate } from '../lib/time.js';
import { getConfig, setConfig, saveFile, fileUrl, readFile } from '../lib/ext.js';
import { custKey } from '../lib/phone.js';
import { roleAtLeast } from '../allow.js';
import { gemini, geminiTools, textOf, jsonOf, b64 } from '../lib/gemini.js';
import { sendOut, mediaBytes, readHook, metaSignatureOk, metaProfile, chSecret, CAN, KIND_NAME,
         commentReply, commentPrivate, commentModerate } from './inboxch.js';
import { products } from './dashboard.js';

const str = (v) => String(v == null ? '' : v).trim();
const isId = (v) => /^[0-9a-f-]{36}$/i.test(str(v));
const H24 = 24 * 3600e3;
export const REASONS = { discount: 'Asked for a discount', complaint: 'Complaint', refund: 'Refund', person: 'Asked for a person', unknown: 'Outside what it knows',
                         angry: 'Angry', ready: 'Ready to buy', abuse: 'Repeated abuse', other: 'Something else' };

// ------------------------------------------------------------------ the business's details for the agent
export const PROFILE_DEFAULTS = {
  name: '', sells: '', hours: '', phone: '', address: '', lang: 'both', style: 'sir', first_name: true,
  tone: 'Warm and polite, like a helpful shop assistant.', first_message: '',
  delivery_in: 70, delivery_out: 130, days_in: '1-2 days', days_out: '2-4 days', delivery_rule: '',
  payment: 'Cash on delivery all over Bangladesh.', returns: '', discount_answer: '', extra_offer: '',
  review_link: '', review_on: false, rating_on: true, updates: { preparing: true, courier: true, out: true, failed: true, cancelled: true },
  followups: true, follow_hot: true, follow_warm: true, broadcasts: true, saved_ai: true,
};
export async function profile(ctx, draft) {
  let p = {};
  try { p = JSON.parse(await getConfig(ctx, 'inbox_profile', '{}')) || {}; } catch (_) { p = {}; }
  if (draft) { try { const d = JSON.parse(await getConfig(ctx, 'inbox_profile_draft', '')); if (d && typeof d === 'object') p = { ...p, ...d }; } catch (_) { /* no draft */ } }
  const out = { ...PROFILE_DEFAULTS, ...p };
  if (!out.name) out.name = str(ctx.s.businessName);
  return out;
}

// ------------------------------------------------------------------ small helpers
async function chOf(ctx, id) { return (await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and id = ${id}`)[0] || null; }
async function convOf(ctx, id) { return (await ctx.tx`select * from inbox_conversations where business_id = ${ctx.biz} and id = ${id}`)[0] || null; }
async function contactOf(ctx, id) { return (await ctx.tx`select * from inbox_contacts where business_id = ${ctx.biz} and id = ${id}`)[0] || null; }
function chSetting(ch, k, def) { const s = ch && ch.settings || {}; return s[k] === undefined || s[k] === null || s[k] === '' ? def : s[k]; }
function waitSeconds(ch) { return Math.max(0, Math.min(15, num(chSetting(ch, 'wait_s', ch.kind === 'webchat' ? 3 : 15)))); }
function revertMinutes(ch) { return Math.max(5, num(chSetting(ch, 'revert_min', 60))); }
function phoneOk(p) { const d = str(p).replace(/[^0-9]/g, ''); const t = d.startsWith('880') ? d.slice(2) : d; return /^01[3-9][0-9]{8}$/.test(t) ? t : ''; }
export function inWindow(ch, conv, now) {
  if (!CAN[ch.kind] || !CAN[ch.kind].window24) return true;
  return !!conv.last_in_at && now.getTime() - new Date(conv.last_in_at).getTime() < H24;
}
async function aiAllowed(ctx, ch) {
  if (!ch.ai_on) return false;
  if (ch.ai_off_until && new Date(ch.ai_off_until) > ctx.now) return false;
  return true;
}
function extOf(mime, kind) {
  const m = str(mime).toLowerCase();
  if (/png/.test(m)) return 'png'; if (/webp/.test(m)) return 'webp'; if (/jpe?g/.test(m)) return 'jpg'; if (/gif/.test(m)) return 'gif';
  if (/ogg|opus/.test(m)) return 'ogg'; if (/mpeg|mp3/.test(m)) return 'mp3'; if (/mp4|m4a|aac/.test(m)) return kind === 'audio' ? 'm4a' : 'mp4'; if (/webm/.test(m)) return 'webm'; if (/wav/.test(m)) return 'wav';
  return kind === 'audio' ? 'ogg' : kind === 'image' ? 'jpg' : 'bin';
}

/** A message written to the conversation (and the conversation's summary columns kept right). */
async function writeMsg(ctx, conv, m) {
  const r = (await ctx.tx`insert into inbox_messages (business_id, conversation_id, direction, author, user_id, user_name, kind, text, media, transcript, seen_as, payload, external_id, status, error)
    values (${ctx.biz}, ${conv.id}, ${m.direction}, ${m.author}, ${m.userId || null}, ${m.userName || null}, ${m.kind || 'text'}, ${m.text || null}, ${m.media || null},
            ${m.transcript || null}, ${m.seenAs || null}, ${m.payload ? ctx.tx.json(m.payload) : null}, ${m.externalId || null}, ${m.status || (m.direction === 'in' ? 'received' : 'sent')}, ${m.error || null})
    returning id`)[0];
  const preview = str(m.text || (m.kind === 'image' ? '📷 Photo' : m.kind === 'audio' ? '🎤 Voice note' : m.kind === 'cards' ? '🛍️ Products' : m.kind === 'order' ? '✅ Order' : '')).slice(0, 140);
  if (m.direction === 'in') {
    await ctx.tx`update inbox_conversations set last_in_at = ${ctx.now}, last_at = ${ctx.now}, last_text = ${preview}, unread = unread + 1,
                 pile = case when pile = 'done' then 'open' else pile end where id = ${conv.id}`;
  } else if (m.direction === 'out') {
    await ctx.tx`update inbox_conversations set last_out_at = ${ctx.now}, last_at = ${ctx.now}, last_text = ${preview},
                 ai_replies = ai_replies + ${m.author === 'ai' ? 1 : 0}, team_replies = team_replies + ${m.author === 'team' ? 1 : 0},
                 first_reply_s = coalesce(first_reply_s, case when last_in_at is not null then greatest(0, extract(epoch from (${ctx.now}::timestamptz - created_at))::int) end)
                 where id = ${conv.id}`;
  }
  return r.id;
}

/** Send something to the customer and write it down (an AI message, a team reply, an update). */
export async function deliver(ctx, ch, conv, contact, msg, who) {
  const res = await sendOut(ctx, ch, contact, msg);
  const id = await writeMsg(ctx, conv, {
    direction: 'out', author: who.author, userId: who.userId, userName: who.userName, kind: msg.kind === 'buttons' ? 'buttons' : msg.kind === 'cards' ? 'cards' : msg.kind === 'image' ? 'image' : msg.store || 'text',
    text: msg.text || msg.caption || '', media: msg.mediaName || msg.url || null, payload: msg.cards ? { cards: msg.cards } : msg.buttons ? { buttons: msg.buttons } : msg.payload || null,
    externalId: res.externalId, status: res.ok ? 'sent' : 'failed', error: res.ok ? null : res.error,
  });
  return { ok: res.ok, error: res.error, id };
}

// ------------------------------------------------------------------ in: a message from a channel
async function upsertContact(ctx, ch, ev) {
  let c = (await ctx.tx`select * from inbox_contacts where channel_id = ${ch.id} and external_id = ${ev.from}`)[0];
  if (!c) {
    let name = str(ev.name), avatar = '';
    if (!name && (ch.kind === 'messenger' || ch.kind === 'instagram')) { try { const p = await metaProfile(ctx, ch, ev.from); name = p.name || ''; avatar = p.avatar || ''; } catch (_) { /* fine */ } }
    const phone = /^wa_/.test(ch.kind) ? phoneOk(ev.from) || ('+' + ev.from) : str(ev.phone);
    c = (await ctx.tx`insert into inbox_contacts (business_id, channel_id, external_id, name, avatar, phone, customer_key)
           values (${ctx.biz}, ${ch.id}, ${ev.from}, ${name || null}, ${avatar || null}, ${phone || null}, ${phoneOk(phone) ? custKey(phoneOk(phone), name) : null})
           on conflict (channel_id, external_id) do update set name = coalesce(inbox_contacts.name, excluded.name) returning *`)[0];
  } else if (ev.name && !c.name) {
    c = (await ctx.tx`update inbox_contacts set name = ${str(ev.name)} where id = ${c.id} returning *`)[0];
  }
  return c;
}
async function upsertConv(ctx, ch, contact) {
  let v = (await ctx.tx`select * from inbox_conversations where contact_id = ${contact.id}`)[0];
  if (!v) v = (await ctx.tx`insert into inbox_conversations (business_id, channel_id, contact_id) values (${ctx.biz}, ${ch.id}, ${contact.id})
                            on conflict (contact_id) do update set channel_id = excluded.channel_id returning *`)[0];
  return v;
}
/** A held chat whose time is up goes back to the AI (and an unanswered hand-over is marked "never answered"). */
async function revertIfDue(ctx, conv) {
  if (conv.mode !== 'human' || !conv.human_until || new Date(conv.human_until) > ctx.now) return conv;
  const answered = (await ctx.tx`select 1 from inbox_messages where conversation_id = ${conv.id} and author = 'team' and created_at >= ${conv.handover_at || conv.human_until} limit 1`).length > 0;
  if (conv.handover_reason && !answered) await ctx.tx`update inbox_tasks set never_answered = true where conversation_id = ${conv.id} and kind = 'handover' and status = 'open'`;
  const v = (await ctx.tx`update inbox_conversations set mode = 'ai', human_until = null, claimed_by = null, claimed_name = null where id = ${conv.id} returning *`)[0];
  await writeMsg(ctx, v, { direction: 'note', author: 'system', kind: 'event', text: 'Back to the AI (time was up).' });
  return v;
}

/**
 * One event from a channel. Returns { conversationId, dueInMs } when the AI should answer after the wait.
 */
export async function ingest(ctx, ch, ev) {
  if (ev.type === 'comment') return handleComment(ctx, ch, ev);
  if (!ev.from) return {};
  // our own messages come back as echoes: drop them; a person's reply from the page / the phone is the team's
  if (ev.echo) {
    if (ev.id && (await ctx.tx`select 1 from inbox_messages where business_id = ${ctx.biz} and external_id = ${ev.id} limit 1`).length) return {};
    const contact = await upsertContact(ctx, ch, { from: ev.from });
    let conv = await upsertConv(ctx, ch, contact);
    if (str(ev.text) === '.') {   // "." from the page's inbox or the business's phone: take the chat / give it back
      const toHuman = conv.mode === 'ai';
      conv = (await ctx.tx`update inbox_conversations set mode = ${toHuman ? 'human' : 'ai'}, human_until = null, claimed_name = ${toHuman ? 'Team (".")' : null}, reply_due_at = null
                           where id = ${conv.id} returning *`)[0];
      await writeMsg(ctx, conv, { direction: 'note', author: 'system', kind: 'event', text: toHuman ? 'A person took the chat (".").' : 'Back to the AI (".").' });
      return { conversationId: conv.id };
    }
    await writeMsg(ctx, conv, { direction: 'out', author: 'team', userName: ch.kind.startsWith('wa_') ? 'From the phone' : 'From the page inbox', text: ev.text, externalId: ev.id });
    return { conversationId: conv.id };
  }
  if (ev.id && (await ctx.tx`select 1 from inbox_messages where business_id = ${ctx.biz} and external_id = ${ev.id} limit 1`).length) return {};   // sent twice by the platform
  const contact = await upsertContact(ctx, ch, ev);
  let conv = await upsertConv(ctx, ch, contact);
  conv = await revertIfDue(ctx, conv);
  // a photo / voice note is kept with the conversation
  let mediaName = null, kind = 'text';
  if (ev.media) {
    kind = ev.media.kind === 'audio' ? 'audio' : ev.media.kind === 'image' ? 'image' : ev.media.kind === 'video' ? 'video' : 'file';
    try {
      const f = await mediaBytes(ctx, ch, ev.media);
      mediaName = conv.id + '-' + Date.now().toString(36) + '.' + extOf(f.mime || ev.media.mime, kind);
      await saveFile(ctx, 'inbox', mediaName, f.bytes, f.mime || ev.media.mime || 'application/octet-stream');
    } catch (_) { mediaName = ev.media.url || null; }
  }
  const text = str(ev.text);
  await writeMsg(ctx, conv, { direction: 'in', author: 'customer', kind, text, media: mediaName, externalId: ev.id, payload: ev.payload ? { payload: ev.payload } : null });
  // practice mode: only "test <code>" chats are answered before Go live
  const code = str(chSetting(ch, 'test_code', ''));
  if (ch.status !== 'live' && code && new RegExp('^test\\s+' + code + '$', 'i').test(text)) {
    conv = (await ctx.tx`update inbox_conversations set is_test = true where id = ${conv.id} returning *`)[0];
  }
  // a rating tapped after an order
  if (/^RATE:[1-5]$/.test(str(ev.payload))) {
    const n = Number(str(ev.payload).slice(5));
    await ctx.tx`update chat_orders set rating = ${n} where business_id = ${ctx.biz} and conversation_id = ${conv.id} and rating is null and created_at > ${new Date(ctx.now.getTime() - 7 * H24)}`;
    await writeMsg(ctx, conv, { direction: 'note', author: 'system', kind: 'rating', text: 'Rated ' + '⭐'.repeat(n) });
  }
  const answerable = (ch.status === 'live' || conv.is_test) && conv.mode === 'ai' && await aiAllowed(ctx, ch);
  if (!answerable) return { conversationId: conv.id };
  const wait = waitSeconds(ch);
  await ctx.tx`update inbox_conversations set reply_due_at = ${new Date(ctx.now.getTime() + wait * 1000)} where id = ${conv.id}`;
  // "Seen" a few seconds after the message (later for a photo or a voice note) - sent with the answer's typing
  return { conversationId: conv.id, dueInMs: wait * 1000 };
}

/** The wait is over: answer, unless a newer message moved the moment. */
export async function replyDue(ctx, conversationId, force) {
  const v = (await ctx.tx`select * from inbox_conversations where business_id = ${ctx.biz} and id = ${conversationId} for update`)[0];
  if (!v || !v.reply_due_at) return { skipped: 'nothing due' };
  if (!force && new Date(v.reply_due_at).getTime() > ctx.now.getTime() + 500) return { skipped: 'a newer message is waiting' };
  await ctx.tx`update inbox_conversations set reply_due_at = null where id = ${v.id}`;
  if (v.mode !== 'ai') return { skipped: 'a person holds the chat' };
  return agentReply(ctx, v, {});
}

// ------------------------------------------------------------------ the agent
const TOOLS = [
  { name: 'categories', description: 'The kinds of product this shop sells, with how many of each. Use it to ask a vague customer what they are looking for.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'find_products', description: 'Search the shop\'s products by words (name, brand, colour, material, size, code). Returns code, name, price, available (true/false), category. Never shows a stock count.',
    parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' }, category: { type: 'STRING' } }, required: ['q'] } },
  { name: 'show_products', description: 'Show products to the customer as cards (photo, name, price, code, buttons) - up to 10, by their codes from find_products. Put a short line before them in intro.',
    parameters: { type: 'OBJECT', properties: { codes: { type: 'ARRAY', items: { type: 'STRING' } }, intro: { type: 'STRING' } }, required: ['codes'] } },
  { name: 'send_photo', description: 'Send the photo of one product (when the customer asks to see it).', parameters: { type: 'OBJECT', properties: { code: { type: 'STRING' } }, required: ['code'] } },
  { name: 'ask_choice', description: 'Ask the customer to choose, with tappable options (2-10 short options).',
    parameters: { type: 'OBJECT', properties: { question: { type: 'STRING' }, options: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['question', 'options'] } },
  { name: 'delivery', description: 'The delivery charge and time for an address (inside or outside Dhaka).', parameters: { type: 'OBJECT', properties: { address: { type: 'STRING' } } } },
  { name: 'offers', description: 'The shop\'s current special offers (the only offers you may mention).', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'knowledge', description: 'Search the shop\'s own documents (policies, guides, details) for an answer.', parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' } }, required: ['q'] } },
  { name: 'my_orders', description: 'This customer\'s orders and where each stands (taken in this chat, or by the phone number on it). Never promise a date from a courier status.',
    parameters: { type: 'OBJECT', properties: { phone: { type: 'STRING' } } } },
  { name: 'place_order', description: 'Place a cash-on-delivery order once the customer has given name, phone (11 digits, 01...) and full address. Items by product code. Do NOT ask the customer to confirm again - giving the details is the confirmation. delivery_said: only if you told the customer a different delivery amount.',
    parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, phone: { type: 'STRING' }, address: { type: 'STRING' }, note: { type: 'STRING' }, delivery_said: { type: 'NUMBER' },
      items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { code: { type: 'STRING' }, qty: { type: 'NUMBER' } }, required: ['code', 'qty'] } } }, required: ['name', 'phone', 'address', 'items'] } },
  { name: 'change_order', description: 'Change an order the team has not approved yet (name, phone, address, items, note).',
    parameters: { type: 'OBJECT', properties: { no: { type: 'STRING' }, name: { type: 'STRING' }, phone: { type: 'STRING' }, address: { type: 'STRING' }, note: { type: 'STRING' },
      items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { code: { type: 'STRING' }, qty: { type: 'NUMBER' } } } } }, required: ['no'] } },
  { name: 'cancel_order', description: 'Cancel an order the team has not approved yet, after asking the reason once.', parameters: { type: 'OBJECT', properties: { no: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['no', 'reason'] } },
  { name: 'save_lead', description: 'Record a real buying interest: when the customer asks about a specific product or its price, wants to order, or gives a phone number.',
    parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, phone: { type: 'STRING' }, want: { type: 'STRING' }, interest: { type: 'STRING', description: 'warm (asked a product / price) or hot (also asked delivery, quantity, payment, gave an address, said they will order)' } } } },
  { name: 'ask_team', description: 'A detail you do not have (not written anywhere): tell the team the question; then tell the customer you will check and come back.', parameters: { type: 'OBJECT', properties: { question: { type: 'STRING' } }, required: ['question'] } },
  { name: 'handover', description: 'Hand the chat to a person: the customer asks for a person, complains, wants a refund, is angry, keeps abusing, insists on a discount, or the matter needs a person\'s judgement. Then tell the customer a colleague is looking into it - never promise when.',
    parameters: { type: 'OBJECT', properties: { reason: { type: 'STRING', description: 'discount | complaint | refund | person | unknown | angry | ready | abuse | other' }, note: { type: 'STRING' } }, required: ['reason'] } },
  { name: 'remember_customer', description: 'Remember the customer\'s name / phone / whether a man or a woman, when they tell it.', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, phone: { type: 'STRING' }, gender: { type: 'STRING', description: 'm or f' } } } },
];

function systemPrompt(p, rules, ch, contact, extra) {
  const lang = p.lang === 'bn' ? 'Always answer in Bangla (Bengali script).' : p.lang === 'en' ? 'Always answer in English.' :
    'Answer in the language the customer started the conversation in; a chat that began in Bangla stays in Bangla unless the customer asks for English. Bangla typed in English letters (Banglish, like "ki ki ache?") is Bangla: answer it in Bengali script.';
  const pair = p.style === 'bhai' ? ['ভাইয়া', 'আপু'] : ['স্যার', 'ম্যাম'];
  const can = CAN[ch.kind] || {};
  return [
    'You are the customer chat agent of "' + p.name + '", a business in Bangladesh. You speak as one of the team ("we", "our shop"). Do not say you are an AI unless asked; when asked, never deny it: say you are the team\'s AI assistant and a person joins when needed.',
    'PLATFORM RULES (always): Replies are short, in plain text, with very few emoji. Never invent a price, discount, stock level, delivery date or policy: prices and products come only from your tools, rules only from what is written below. Stock is only "available" or "not available" - never a count. Never bargain or give a discount yourself; only offers from the offers tool. Never ask for a card number, OTP or password; never say money was received.',
    'When a customer is vague ("what do you have?"), first ask what kind they want (use categories + ask_choice), then show matching products with show_products (at most 10). If a search finds nothing, say plainly that we do not have it, name the kinds of product we do sell and ask which one. Once the customer has chosen a product, do not push alternatives. Before the order is placed, mention the extra offer below once, if there is one.',
    'To order: ask for name, phone number and full address in ONE message. As soon as they are given, call place_order - do not ask to confirm again. Then thank them with the order number and say the day it should arrive (from the delivery time below). If the phone number is not 11 digits starting 01, ask again.',
    'An order the team has approved cannot be changed by you: note the request with change_order (it goes to the team). A missing detail is NOT a reason to hand over: answer what you know, say the detail is not listed, call ask_team and say we will check. Hand over (handover tool) for a complaint, a refund, an angry customer, a customer who asks for a person, repeated abuse, or when they insist on a discount.',
    'A voice note arrives as its words; a photo arrives as what was seen in it. With a photo, use the PHOTO MATCH given: name a product only when it is a strong match; otherwise show the closest ones and ask which one; if nothing is ours, say so and show similar products.',
    'Address the customer as ' + pair[0] + ' (man) or ' + pair[1] + ' (woman)' + (p.first_name ? ', after their first name when you know it' : '') + '; if you do not know, use ' + pair[0] + '. ' + lang,
    'Channel: ' + (KIND_NAME[ch.kind] || ch.kind) + '. ' + (can.cards ? 'Product cards and buttons are shown as cards.' : 'This channel shows no cards: show_products sends each product as a photo with its name, price and code; choices appear as a numbered list.'),
    '',
    'THE BUSINESS (written by the owner):',
    'Name: ' + p.name + (p.sells ? '\nWhat we sell: ' + p.sells : '') + (p.hours ? '\nOpening hours: ' + p.hours : '') + (p.phone ? '\nPhone: ' + p.phone : '') + (p.address ? '\nAddress: ' + p.address : ''),
    'Delivery: inside Dhaka ৳' + num(p.delivery_in) + ' (' + p.days_in + '), outside Dhaka ৳' + num(p.delivery_out) + ' (' + p.days_out + '). Savar, Keraniganj and Tongi count as outside Dhaka.' + (p.delivery_rule ? ' ' + p.delivery_rule : ''),
    'Payment: ' + (p.payment || 'Cash on delivery.'),
    p.returns ? 'Return and exchange rule: ' + p.returns : 'No return rule is written: pass return questions to the team (ask_team).',
    p.discount_answer ? 'When asked for a discount, say: ' + p.discount_answer : 'When asked for a discount, say politely that the price is fixed.',
    p.extra_offer ? 'Extra offer to mention once before the order: ' + p.extra_offer : '',
    'Tone: ' + (p.tone || 'polite and warm.'),
    rules.length ? '\nTHE OWNER\'S OWN RULES:\n' + rules.map((r) => '- ' + r.title + ': ' + r.body).join('\n') : '',
    extra ? '\n' + extra : '',
  ].filter((x) => x !== '').join('\n');
}

async function rulesFor(ctx, draft) {
  const rows = await ctx.tx`select title, body, draft, enabled from agent_rules where business_id = ${ctx.biz} and not archived order by updated_at`;
  return rows.filter((r) => r.enabled).map((r) => ({ title: str(r.title), body: str(draft && r.draft ? r.draft : r.body) }));
}

/** What the AI sees of a photo: a one-line description, a printed product code, and the shop's closest products. */
async function lookAtPhoto(ctx, conv, m) {
  if (m.seen_as) return m.seen_as;
  const f = m.media ? await readFile(ctx, 'inbox', m.media) : null;
  if (!f) return '';
  const { parts } = await gemini(ctx, { contents: [{ role: 'user', parts: [
    { inline_data: { mime_type: /\.png$/.test(m.media) ? 'image/png' : /\.webp$/.test(m.media) ? 'image/webp' : 'image/jpeg', data: b64(f) } },
    { text: 'A customer sent this photo to a shop. Reply with JSON only: {"desc": one line in English describing the product (type, material, colour, brand, size), "code": any product code printed in the picture or "", "words": 3-6 search words}' }] }],
    generationConfig: { temperature: 0 } }, 'photo', conv.id);
  const j = jsonOf(parts) || {};
  const seen = str(j.desc) + (j.code ? ' [code ' + str(j.code) + ']' : '') + (j.words ? ' {' + (Array.isArray(j.words) ? j.words.join(' ') : str(j.words)) + '}' : '');
  await ctx.tx`update inbox_messages set seen_as = ${seen} where id = ${m.id}`;
  return seen;
}
async function listenToVoice(ctx, conv, m) {
  if (m.transcript) return m.transcript;
  const f = m.media ? await readFile(ctx, 'inbox', m.media) : null;
  if (!f) return '';
  const mime = /\.mp3$/.test(m.media) ? 'audio/mp3' : /\.m4a$/.test(m.media) ? 'audio/mp4' : /\.wav$/.test(m.media) ? 'audio/wav' : /\.webm$/.test(m.media) ? 'audio/webm' : 'audio/ogg';
  const { parts } = await gemini(ctx, { contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: b64(f) } },
    { text: 'Write out exactly what is said in this voice note, in its own language (Bangla in Bengali script). Only the words.' }] }], generationConfig: { temperature: 0 } }, 'voice', conv.id);
  const t = textOf(parts);
  await ctx.tx`update inbox_messages set transcript = ${t} where id = ${m.id}`;
  return t;
}

async function catalogue(ctx) {
  if (ctx.memo.inboxCat) return ctx.memo.inboxCat;
  const { list } = await products(ctx);
  const extra = {};
  for (const r of await ctx.tx`select sku, photo, image_link, family, notes from products where business_id = ${ctx.biz}`) extra[str(r.sku).toLowerCase()] = r;
  ctx.memo.inboxCat = list.filter((p) => !/discontinued|inactive|archived/i.test(p.status)).map((p) => {
    const e = extra[p.sku.toLowerCase()] || {};
    return { ...p, photo: str(e.photo), link: str(e.image_link), family: str(e.family) };
  });
  return ctx.memo.inboxCat;
}
function searchCat(cat, q, category) {
  const words = str(q).toLowerCase().split(/[^a-z0-9ঀ-৿+.]+/).filter((w) => w.length > 1);
  const out = [];
  for (const p of cat) {
    if (category && str(p.cat).toLowerCase() !== str(category).toLowerCase()) continue;
    const hay = (p.sku + ' ' + p.name + ' ' + p.brand + ' ' + p.cat + ' ' + p.type + ' ' + p.family).toLowerCase();
    let s = 0; for (const w of words) if (hay.includes(w)) s += w.length > 3 ? 2 : 1;
    if (str(q).toLowerCase() === p.sku.toLowerCase()) s += 50;
    if (s || !words.length) out.push({ p, s: s + (p.stock > 0 ? 0.5 : 0) });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, 15).map((x) => x.p);
}
async function imageUrl(ctx, p) {
  if (p.photo) { try { return await fileUrl(ctx, 'products', p.photo); } catch (_) { /* fall through */ } }
  return p.link || '';
}
function deliveryFor(p, address) {
  const a = str(address).toLowerCase();
  const outside = /savar|keraniganj|tongi|gazipur|narayanganj|সাভার|কেরানীগঞ্জ|টঙ্গী|গাজীপুর|নারায়ণগঞ্জ/.test(a);
  const inside = !outside && /dhaka|ঢাকা|mirpur|uttara|dhanmondi|gulshan|banani|mohammadpur|motijheel|badda|rampura|khilgaon|jatrabari|tejgaon|farmgate|mohakhali|bashundhara|baridhara|shyamoli|lalbagh|old dhaka|wari|demra|cantonment|keraniganj|মিরপুর|উত্তরা|ধানমন্ডি|গুলশান|বনানী|মোহাম্মদপুর|বাড্ডা|রামপুরা|খিলগাঁও|যাত্রাবাড়ী/.test(a);
  if (!a) return { area: 'unknown', inside_dhaka: num(p.delivery_in), outside_dhaka: num(p.delivery_out), days_inside: p.days_in, days_outside: p.days_out };
  return inside ? { area: 'inside Dhaka', charge: num(p.delivery_in), days: p.days_in } : { area: 'outside Dhaka', charge: num(p.delivery_out), days: p.days_out };
}
async function nextOrderNo(ctx) {
  const day = formatDate(ctx.now, 'yyMMdd');
  for (let i = 0; i < 20; i++) {
    const no = 'CO-' + day + '-' + String(Math.floor(1000 + Math.random() * 9000));
    if (!(await ctx.tx`select 1 from chat_orders where business_id = ${ctx.biz} and no = ${no}`).length) return no;
  }
  return 'CO-' + day + '-' + Date.now().toString(36);
}
export async function orderEvent(ctx, orderId, what, by) {
  await ctx.tx`insert into chat_order_events (business_id, order_id, what, by_name) values (${ctx.biz}, ${orderId}, ${what}, ${by || 'AI'})`;
}
export async function task(ctx, convId, kind, reason, text) {
  await ctx.tx`insert into inbox_tasks (business_id, conversation_id, kind, reason, text) values (${ctx.biz}, ${convId || null}, ${kind}, ${reason || null}, ${text || null})`;
}
export async function leadUpsert(ctx, conv, contact, a, source) {
  const open = (await ctx.tx`select * from inbox_leads where business_id = ${ctx.biz} and conversation_id = ${conv.id} and stage < 5 order by created_at desc limit 1`)[0];
  const ph = phoneOk(a.phone) || str(a.phone);
  if (open) {
    await ctx.tx`update inbox_leads set name = coalesce(${str(a.name) || null}, name), phone = coalesce(${ph || null}, phone), want = coalesce(${str(a.want) || null}, want),
                 stage = greatest(stage, ${a.stage || 1}), updated_at = now() where id = ${open.id}`;
    if (a.want && str(a.want) !== str(open.want)) await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${open.id}, ${'Wants: ' + str(a.want)}, ${source === 'ai' ? 'AI' : source})`;
    return open.id;
  }
  const ch = await chOf(ctx, conv.channel_id);
  const r = (await ctx.tx`insert into inbox_leads (business_id, contact_id, conversation_id, name, phone, want, stage, source, channel, intent)
            values (${ctx.biz}, ${contact.id}, ${conv.id}, ${str(a.name) || contact.name || null}, ${ph || contact.phone || null}, ${str(a.want) || null}, ${a.stage || 1},
                    ${source || 'ai'}, ${ch ? ch.kind : null}, ${str(a.interest) || null}) returning id`)[0];
  await ctx.tx`insert into inbox_lead_events (business_id, lead_id, what, by_name) values (${ctx.biz}, ${r.id}, 'Lead made', ${source === 'ai' ? 'AI' : source})`;
  return r.id;
}
async function orderView(ctx, o) {
  let status = o.status === 'pending' ? 'received, the team will confirm it' : o.status === 'hold' ? 'received, being checked' : o.status === 'cancelled' ? 'cancelled' : 'confirmed';
  if (o.invoice_no) {
    const inv = (await ctx.tx`select delivery_status, payment_status from invoices where business_id = ${ctx.biz} and invoice_no = ${o.invoice_no}`)[0];
    if (inv) status = str(inv.delivery_status) || status;
  }
  const last = (await ctx.tx`select text from inbox_messages where conversation_id = ${o.conversation_id} and author = 'system' and payload->>'courier' is not null order by id desc limit 1`)[0];
  return { no: o.no, status, items: o.items, delivery: num(o.delivery_charge), total: (o.items || []).reduce((t, x) => t + num(x.qty) * num(x.price), 0) + num(o.delivery_charge), courier_update: last ? last.text : '' };
}

/** The receipt sent after an order (AiPraktor sends the bill as a picture; here it is a laid-out text bill). */
function receiptText(p, o) {
  const lines = (o.items || []).map((x) => '• ' + x.name + ' × ' + num(x.qty) + ' = ৳' + Math.round(num(x.qty) * num(x.price)).toLocaleString('en-IN'));
  const goods = (o.items || []).reduce((t, x) => t + num(x.qty) * num(x.price), 0);
  return '🧾 ' + p.name + ' — ' + o.no + '\n' + lines.join('\n') + '\nDelivery: ৳' + Math.round(num(o.delivery_charge)) + '\nTotal (cash on delivery): ৳' + Math.round(goods + num(o.delivery_charge)).toLocaleString('en-IN') +
    '\n' + o.name + ' · ' + o.phone + '\n' + o.address;
}

/**
 * The AI answers a conversation. opts.test: the Agent Desk's test (the draft details and rules; nothing is sent,
 * nothing is booked - the answers come back). Returns { sent: n, handover } or { replies } for a test.
 */
export async function agentReply(ctx, conv, opts) {
  opts = opts || {};
  const test = !!opts.test;
  const ch = opts.channel || await chOf(ctx, conv.channel_id);
  const contact = opts.contact || await contactOf(ctx, conv.contact_id);
  const p = await profile(ctx, test);
  const rules = await rulesFor(ctx, test);
  const now = ctx.now;
  // the recent history (the last 30 entries), with photos looked at and voice notes written out
  const hist = test ? (opts.history || []) : (await ctx.tx`select * from inbox_messages where conversation_id = ${conv.id} and direction <> 'note' order by id desc limit 30`).reverse();
  let photoBlock = '';
  for (const m of hist) {
    if (m.direction !== 'in') continue;
    if (m.kind === 'audio' && !m.transcript) { try { m.transcript = await listenToVoice(ctx, conv, m); } catch (_) { m.transcript = ''; } }
    if (m.kind === 'image' && !m.seen_as) { try { m.seen_as = await lookAtPhoto(ctx, conv, m); } catch (_) { m.seen_as = ''; } }
  }
  const lastPhoto = hist.slice().reverse().find((m) => m.direction === 'in' && m.kind === 'image' && m.seen_as);
  if (lastPhoto && hist.indexOf(lastPhoto) >= hist.length - 3) {
    const cat = await catalogue(ctx);
    const code = (/\[code ([^\]]+)\]/.exec(lastPhoto.seen_as) || [])[1] || '';
    const byCode = code ? cat.find((x) => x.sku.toLowerCase() === code.toLowerCase().trim()) : null;
    const words = (/\{([^}]*)\}/.exec(lastPhoto.seen_as) || [])[1] || lastPhoto.seen_as;
    const near = searchCat(cat, words).slice(0, 10);
    photoBlock = 'PHOTO MATCH for the customer\'s latest photo (seen: ' + lastPhoto.seen_as.replace(/\{[^}]*\}/, '') + '): ' +
      (byCode ? 'STRONG MATCH by the printed code: ' + byCode.sku + ' ' + byCode.name + ' ৳' + byCode.sell + (byCode.stock > 0 ? ' (available)' : ' (not available)') :
        near.length ? 'no strong match; closest products: ' + near.map((x) => x.sku + ' ' + x.name).join('; ') : 'nothing in our catalogue is like it');
  }
  // the customer's record in the ERP
  let custBlock = '';
  if (contact && contact.customer_key && !test) {
    const ph = phoneOk(contact.phone);
    if (ph) {
      const inv = await ctx.tx`select invoice_no, created_at, grand_total, delivery_status from invoices where business_id = ${ctx.biz}
                               and right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${ph.slice(-10)} and voided_at is null order by created_at desc limit 3`;
      if (inv.length) custBlock = 'THIS CUSTOMER\'S PAST ORDERS (do not mention unless relevant): ' + inv.map((i) => i.invoice_no + ' ' + formatDate(new Date(i.created_at), 'd MMM') + ' ৳' + Math.round(num(i.grand_total)) + ' ' + str(i.delivery_status)).join('; ');
    }
  }
  const who = contact ? 'Customer: ' + (contact.name || 'unknown name') + (contact.gender ? ' (' + (contact.gender === 'f' ? 'woman' : 'man') + ')' : '') + (contact.phone ? ', phone ' + contact.phone : '') : '';
  const extra = [who, custBlock, photoBlock, 'Now: ' + formatDate(now, 'EEEE d MMMM yyyy, h:mm a') + ' (Dhaka).'].filter(Boolean).join('\n');
  const contents = [];
  for (const m of hist) {
    let t = str(m.text);
    if (m.kind === 'audio') t = '[voice note] ' + (str(m.transcript) || '(could not be heard)') + (t ? ' ' + t : '');
    if (m.kind === 'image') t = '[photo: ' + (str(m.seen_as).replace(/\{[^}]*\}/, '') || 'a picture') + ']' + (t ? ' ' + t : '');
    if (m.kind === 'cards') t = '[shown products: ' + ((m.payload && m.payload.cards) || []).map((c) => c.code).join(', ') + '] ' + t;
    if (m.payload && m.payload.payload && /^ORDER:/.test(m.payload.payload)) t = '[tapped Order on ' + m.payload.payload.slice(6) + '] ' + t;
    if (!t) continue;
    const role = m.direction === 'in' ? 'user' : 'model';
    if (contents.length && contents[contents.length - 1].role === role) contents[contents.length - 1].parts[0].text += '\n' + t;
    else contents.push({ role, parts: [{ text: (m.author === 'team' ? '[a person from the team wrote] ' : '') + t }] });
  }
  if (!contents.length || contents[contents.length - 1].role !== 'user') return { sent: 0, skipped: 'nothing to answer' };

  const queue = [];   // what goes to the customer, in order
  const effects = { handover: null, order: null };
  const cat = await catalogue(ctx);
  const can = CAN[ch.kind] || {};
  const run = async (name, a) => {
    if (name === 'categories') {
      const c = {}; for (const x of cat) { const k = x.cat || 'Other'; c[k] = (c[k] || 0) + 1; }
      return { categories: Object.keys(c).map((k) => ({ name: k, products: c[k] })) };
    }
    if (name === 'find_products') {
      const found = searchCat(cat, a.q, a.category);
      return { products: found.map((x) => ({ code: x.sku, name: x.name, price: x.sell || null, available: x.stock > 0, category: x.cat, brand: x.brand })), note: found.length ? '' : 'nothing found' };
    }
    if (name === 'show_products') {
      const codes = (a.codes || []).map(str).slice(0, 10);
      const ps = codes.map((c) => cat.find((x) => x.sku.toLowerCase() === c.toLowerCase())).filter(Boolean);
      if (!ps.length) return { error: 'none of those codes is a product' };
      if (a.intro) queue.push({ kind: 'text', text: str(a.intro) });
      const cards = [];
      for (const x of ps) {
        cards.push({ code: x.sku, title: x.name, subtitle: (x.sell ? '৳' + Math.round(x.sell).toLocaleString('en-IN') : 'Price on request') + ' · ' + x.sku + (x.stock > 0 ? '' : ' · not available now'),
                     image: await imageUrl(ctx, x), buttons: [{ title: 'Order', payload: 'ORDER:' + x.sku }, { title: 'More photos', payload: 'PHOTO:' + x.sku }] });
      }
      if (can.cards) queue.push({ kind: 'cards', cards, text: '' });
      else if (ch.kind === 'webchat') queue.push({ kind: 'cards', cards, text: '', store: 'cards' });
      else for (const c of cards) queue.push(c.image ? { kind: 'image', url: c.image, caption: c.title + '\n' + c.subtitle } : { kind: 'text', text: c.title + ' — ' + c.subtitle });
      return { shown: ps.length };
    }
    if (name === 'send_photo') {
      const x = cat.find((y) => y.sku.toLowerCase() === str(a.code).toLowerCase());
      if (!x) return { error: 'no such product' };
      const u = await imageUrl(ctx, x);
      if (!u) return { error: 'no photo is kept for it' };
      queue.push({ kind: 'image', url: u, caption: x.name });
      return { sent: true };
    }
    if (name === 'ask_choice') {
      const opts2 = (a.options || []).map(str).filter(Boolean).slice(0, 10);
      queue.push({ kind: 'buttons', text: str(a.question), buttons: opts2.map((o) => ({ title: o, payload: o })) });
      return { asked: true };
    }
    if (name === 'delivery') return deliveryFor(p, a.address);
    if (name === 'offers') {
      const rows = await ctx.tx`select label, sku, detail, ends_on from shop_offers where business_id = ${ctx.biz} and active and (starts_on is null or starts_on <= ${now}) and (ends_on is null or ends_on >= ${formatDate(now, 'yyyy-MM-dd')})`;
      return { offers: rows.map((r) => ({ label: r.label, product: r.sku || 'all products', detail: r.detail, until: r.ends_on ? formatDate(new Date(r.ends_on), 'd MMM') : '' })) };
    }
    if (name === 'knowledge') return { passages: await kbSearch(ctx, a.q) };
    if (name === 'my_orders') {
      if (test) return { orders: [] };
      const ph = phoneOk(a.phone) || phoneOk(contact && contact.phone);
      const rows = await ctx.tx`select * from chat_orders where business_id = ${ctx.biz} and (conversation_id = ${conv.id} or (${ph || ''} <> '' and phone = ${ph || ''})) order by created_at desc limit 5`;
      const out = []; for (const o of rows) out.push(await orderView(ctx, o));
      return { orders: out };
    }
    if (name === 'place_order') {
      const ph = phoneOk(a.phone);
      if (!ph) return { error: 'the phone number must be 11 digits starting 01 - ask again' };
      if (!str(a.name) || str(a.address).length < 6) return { error: 'name and the full address are needed' };
      const items = [];
      for (const it of a.items || []) {
        const x = cat.find((y) => y.sku.toLowerCase() === str(it.code).toLowerCase());
        if (!x) return { error: 'no product with code ' + it.code };
        if (!(x.sell > 0)) { return { error: x.name + ' has no price in the system - hand the chat to the team (handover)' }; }
        if (!(x.stock > 0)) return { error: x.name + ' is not available now - tell the customer' };
        items.push({ sku: x.sku, name: x.name, qty: Math.max(1, Math.round(num(it.qty) || 1)), price: x.sell });
      }
      if (!items.length) return { error: 'no items' };
      const d = deliveryFor(p, a.address), charge = d.charge !== undefined ? d.charge : num(p.delivery_out);
      if (test) { effects.order = { no: 'CO-TEST', total: items.reduce((t, x) => t + x.qty * x.price, 0) + charge }; return { placed: true, no: 'CO-TEST', delivery: charge, days: d.days }; }
      const said = a.delivery_said !== undefined && num(a.delivery_said) !== charge ? num(a.delivery_said) : null;
      const no = await nextOrderNo(ctx);
      const o = (await ctx.tx`insert into chat_orders (business_id, no, conversation_id, name, phone, address, items, delivery_charge, delivery_said, note, taken_by)
                 values (${ctx.biz}, ${no}, ${conv.id}, ${str(a.name)}, ${ph}, ${str(a.address)}, ${ctx.tx.json(items)}, ${said !== null ? said : charge}, ${said}, ${str(a.note) || null}, 'ai') returning *`)[0];
      await orderEvent(ctx, o.id, 'Taken by the AI in the chat' + (said !== null ? ' (the AI said delivery ৳' + said + '; the rule gives ৳' + charge + ')' : ''), 'AI');
      await ctx.tx`update inbox_conversations set ordered = true, interest = 'hot', followups_left = 0, next_followup = null where id = ${conv.id}`;
      await ctx.tx`update inbox_contacts set phone = coalesce(phone, ${ph}), customer_key = coalesce(customer_key, ${custKey(ph, str(a.name))}), name = coalesce(name, ${str(a.name)}) where id = ${contact.id}`;
      await leadUpsert(ctx, conv, contact, { name: a.name, phone: ph, want: items.map((x) => x.name).join(', '), stage: 5 }, 'ai');
      await task(ctx, conv.id, 'order', null, 'New order ' + no + ' from ' + str(a.name) + ' (' + ph + '): ' + items.map((x) => x.name + ' × ' + x.qty).join(', '));
      effects.order = o;
      return { placed: true, no, delivery: num(o.delivery_charge), days: d.days, total: items.reduce((t, x) => t + x.qty * x.price, 0) + num(o.delivery_charge) };
    }
    if (name === 'change_order' || name === 'cancel_order') {
      if (test) return { done: true };
      const o = (await ctx.tx`select * from chat_orders where business_id = ${ctx.biz} and no = ${str(a.no)} and (conversation_id = ${conv.id} or phone = ${phoneOk(contact && contact.phone) || '-'})`)[0];
      if (!o) return { error: 'no such order for this customer' };
      if (o.status === 'approved' || o.status === 'cancelled' || o.approved_at) {
        const what = name === 'cancel_order' ? 'Wants to cancel: ' + str(a.reason) : 'Wants a change: ' + JSON.stringify(a);
        await ctx.tx`update chat_orders set change_request = ${what} where id = ${o.id}`;
        await orderEvent(ctx, o.id, what, 'Customer (via AI)');
        effects.handover = { reason: 'other', note: what + ' on ' + o.no };
        return { sent_to_team: true, note: 'the team has approved this order already; tell the customer the team will look at it' };
      }
      if (name === 'cancel_order') {
        await ctx.tx`update chat_orders set status = 'cancelled', cancel_reason = ${'Customer: ' + str(a.reason)} where id = ${o.id}`;
        await orderEvent(ctx, o.id, 'Cancelled in the chat: ' + str(a.reason), 'Customer (via AI)');
        return { cancelled: true };
      }
      const set = {};
      if (a.name) set.name = str(a.name);
      if (a.phone) { const ph = phoneOk(a.phone); if (!ph) return { error: 'phone must be 11 digits starting 01' }; set.phone = ph; }
      if (a.address) set.address = str(a.address);
      if (a.note) set.note = str(a.note);
      if (Array.isArray(a.items) && a.items.length) {
        const items = [];
        for (const it of a.items) { const x = cat.find((y) => y.sku.toLowerCase() === str(it.code).toLowerCase()); if (!x || !(x.sell > 0)) return { error: 'no priced product ' + it.code }; items.push({ sku: x.sku, name: x.name, qty: Math.max(1, Math.round(num(it.qty) || 1)), price: x.sell }); }
        set.items = items;
      }
      await ctx.tx`update chat_orders set name = coalesce(${set.name || null}, name), phone = coalesce(${set.phone || null}, phone), address = coalesce(${set.address || null}, address),
                   note = coalesce(${set.note || null}, note), items = coalesce(${set.items ? ctx.tx.json(set.items) : null}, items) where id = ${o.id}`;
      if (set.address) { const d = deliveryFor(p, set.address); if (d.charge !== undefined) await ctx.tx`update chat_orders set delivery_charge = ${d.charge} where id = ${o.id}`; }
      await orderEvent(ctx, o.id, 'Changed in the chat: ' + Object.keys(set).join(', '), 'Customer (via AI)');
      return { changed: Object.keys(set) };
    }
    if (name === 'save_lead') {
      if (test) return { saved: true };
      const interest = /hot/i.test(a.interest) ? 'hot' : 'warm';
      await leadUpsert(ctx, conv, contact, { ...a, stage: interest === 'hot' ? 3 : 2, interest }, 'ai');
      if (a.phone && phoneOk(a.phone)) await ctx.tx`update inbox_contacts set phone = ${phoneOk(a.phone)}, customer_key = coalesce(customer_key, ${custKey(phoneOk(a.phone), str(a.name || contact.name))}) where id = ${contact.id}`;
      // follow-ups: warm one reminder, hot two (inside the 24-hour window; set from the customer's last message)
      const cur = (await ctx.tx`select interest, ordered from inbox_conversations where id = ${conv.id}`)[0];
      const rank = { cold: 0, warm: 1, hot: 2 };
      if (!cur.ordered && rank[interest] > rank[cur.interest]) {
        await ctx.tx`update inbox_conversations set interest = ${interest}, followups_left = ${interest === 'hot' ? 2 : 1} where id = ${conv.id}`;
      }
      return { saved: true };
    }
    if (name === 'ask_team') { if (!test) await task(ctx, conv.id, 'enquiry', 'unknown', str(a.question)); return { asked: true }; }
    if (name === 'handover') { effects.handover = { reason: REASONS[str(a.reason)] ? str(a.reason) : 'other', note: str(a.note) }; return { handed: true }; }
    if (name === 'remember_customer') {
      if (test) return { ok: true };
      const ph = phoneOk(a.phone);
      await ctx.tx`update inbox_contacts set name = coalesce(${str(a.name) || null}, name), phone = coalesce(${ph || null}, phone),
                   gender = coalesce(${/^[mf]$/.test(str(a.gender)) ? str(a.gender) : null}, gender),
                   customer_key = coalesce(customer_key, ${ph ? custKey(ph, str(a.name || (contact && contact.name))) : null}) where id = ${contact.id}`;
      return { ok: true };
    }
    return { error: 'unknown tool' };
  };

  // show "Seen", then "typing…"
  const lastIn = hist.slice().reverse().find((m) => m.direction === 'in');
  if (!test && can.seen) { try { await sendOut(ctx, ch, contact, { kind: 'seen', replyTo: lastIn && lastIn.external_id }); } catch (_) { /* fine */ } }
  if (!test && can.typing) { try { await sendOut(ctx, ch, contact, { kind: 'typing', replyTo: lastIn && lastIn.external_id }); } catch (_) { /* fine */ } }

  const res = await geminiTools(ctx, { system: systemPrompt(p, rules, ch, contact, extra), contents, tools: TOOLS, run, purpose: test ? 'test' : 'reply', conversationId: test ? null : conv.id });
  const finalText = str(res.text);
  if (finalText) queue.push({ kind: 'text', text: finalText });
  // after an order: the receipt and a rating request (Messenger)
  if (effects.order && effects.order.items) {
    queue.push({ kind: 'text', text: receiptText(p, effects.order), store: 'order', payload: { order: effects.order.no } });
    if (p.rating_on && can.buttons && ch.kind !== 'webchat') queue.push({ kind: 'buttons', text: 'How was your experience ordering from us?', buttons: [1, 2, 3, 4, 5].map((n) => ({ title: '⭐'.repeat(n), payload: 'RATE:' + n })) });
  }
  if (test) return { replies: queue, handover: effects.handover, order: effects.order, calls: res.calls.map((c) => c.name) };

  let sent = 0;
  for (const q of queue) { const r = await deliver(ctx, ch, conv, contact, q, { author: 'ai' }); if (r.ok) sent++; }
  if (effects.handover) await handOver(ctx, conv, effects.handover.reason, effects.handover.note);
  await ctx.tx`update inbox_conversations set unread = 0 where id = ${conv.id}`;
  // follow-ups are planned from the customer's last message (inside 24 h)
  const cur = (await ctx.tx`select * from inbox_conversations where id = ${conv.id}`)[0];
  if (cur.followups_left > 0 && !cur.ordered && cur.last_in_at) {
    const first = cur.interest === 'hot' && cur.followups_left === 2 ? 3 : 20;   // hot: after 3 h and 20 h; warm: after 20 h
    await ctx.tx`update inbox_conversations set next_followup = ${new Date(new Date(cur.last_in_at).getTime() + first * 3600e3)} where id = ${conv.id}`;
  }
  return { sent, handover: effects.handover ? effects.handover.reason : null, order: effects.order ? effects.order.no : null };
}

/** The AI (or a rule) hands the chat to the team: the reason written down, the team alerted. */
export async function handOver(ctx, conv, reason, note) {
  const ch = await chOf(ctx, conv.channel_id);
  const until = new Date(ctx.now.getTime() + revertMinutes(ch) * 60e3);
  await ctx.tx`update inbox_conversations set mode = 'human', human_until = ${until}, handover_reason = ${reason}, handover_note = ${note || null}, handover_at = ${ctx.now},
               claimed_by = null, claimed_name = null, pile = 'open', reply_due_at = null where id = ${conv.id}`;
  await task(ctx, conv.id, 'handover', reason, note || REASONS[reason] || reason);
  await writeMsg(ctx, conv, { direction: 'note', author: 'system', kind: 'event', text: 'Handed to the team: ' + (REASONS[reason] || reason) + (note ? ' — ' + note : '') });
}

// ------------------------------------------------------------------ comments on posts
async function handleComment(ctx, ch, ev) {
  if (!ev.commentId) return {};
  if (ev.from && ev.from === ch.external_id) return {};   // the page's own comment
  const dup = (await ctx.tx`insert into inbox_comments (business_id, channel_id, post_id, comment_id, from_id, from_name, text)
                            values (${ctx.biz}, ${ch.id}, ${ev.postId || null}, ${ev.commentId}, ${ev.from || null}, ${ev.name || null}, ${ev.text || null})
                            on conflict (channel_id, comment_id) do nothing returning id`);
  if (!dup.length) return {};
  if (!(ch.status === 'live' && ch.comments_ai && await aiAllowed(ctx, ch))) return { comment: ev.commentId };
  return { comment: ev.commentId, commentDue: true };
}
/** The AI answers one comment: a public reply by name (with the product's photo), a private message, or it removes junk. */
export async function answerComment(ctx, chId, commentId) {
  const ch = await chOf(ctx, chId);
  const c = (await ctx.tx`select * from inbox_comments where channel_id = ${chId} and comment_id = ${commentId}`)[0];
  if (!ch || !c || c.action) return { skipped: true };
  const p = await profile(ctx, false);
  const cat = await catalogue(ctx);
  const near = searchCat(cat, c.text).slice(0, 5);
  const { parts } = await gemini(ctx, { systemInstruction: { parts: [{ text:
    'You answer comments on the Facebook / Instagram posts of "' + p.name + '", a shop in Bangladesh. Reply with JSON only: {"kind": "reply" | "junk" | "unsure", "public": a short public reply that names the person' +
    ' (no address, no phone number, no customer details), "private": one short private message to their inbox, "code": a product code if the comment is about one of these products else ""}.' +
    ' junk = certainly spam, scam or abuse; unsure = might be abusive. Never invent prices; only these products: ' + near.map((x) => x.sku + ' ' + x.name + ' ৳' + x.sell).join('; ') +
    '. Language: ' + (p.lang === 'en' ? 'English' : p.lang === 'bn' ? 'Bangla' : 'the language of the comment (Banglish -> Bangla script)') + '.' }] },
    contents: [{ role: 'user', parts: [{ text: (c.from_name || 'Someone') + ' commented: ' + str(c.text) }] }], generationConfig: { temperature: 0.2 } }, 'comment', null);
  const j = jsonOf(parts) || {};
  if (j.kind === 'junk') {
    const r = await commentModerate(ctx, ch, commentId, 'delete');
    await ctx.tx`update inbox_comments set action = 'deleted', by_name = 'AI' where id = ${c.id}`;
    return { deleted: r.ok };
  }
  if (j.kind === 'unsure') {
    const r = await commentModerate(ctx, ch, commentId, 'hide');
    await ctx.tx`update inbox_comments set action = 'hidden', by_name = 'AI' where id = ${c.id}`;
    await task(ctx, null, 'comment', 'unsure', 'A comment was hidden for you to decide: "' + str(c.text).slice(0, 120) + '" — ' + (c.from_name || ''));
    return { hidden: r.ok };
  }
  let img = '';
  if (j.code) { const x = cat.find((y) => y.sku.toLowerCase() === str(j.code).toLowerCase()); if (x && ch.kind === 'messenger') img = await imageUrl(ctx, x); }
  const r1 = await commentReply(ctx, ch, commentId, str(j.public) || ('Thank you, ' + (c.from_name || '') + '! We have sent you a message.'), img);
  if (str(j.private)) await commentPrivate(ctx, ch, commentId, str(j.private));
  await ctx.tx`update inbox_comments set action = 'replied', ai_reply = ${str(j.public)}, by_name = 'AI' where id = ${c.id}`;
  return { replied: r1.ok };
}

// ------------------------------------------------------------------ knowledge base search (words; Postgres full text)
export async function kbSearch(ctx, q) {
  const words = str(q).toLowerCase().split(/[^a-z0-9ঀ-৿]+/).filter((w) => w.length > 2).slice(0, 8);
  if (!words.length) return [];
  const tsq = words.join(' | ');
  let rows = [];
  try {
    rows = await ctx.tx`select k.text, d.title, ts_rank(k.tsv, to_tsquery('simple', ${tsq})) as r from kb_chunks k join kb_docs d on d.id = k.doc_id
                        where k.business_id = ${ctx.biz} and not d.archived and k.tsv @@ to_tsquery('simple', ${tsq}) order by r desc limit 4`;
  } catch (_) { rows = []; }
  if (!rows.length) {
    rows = await ctx.tx`select k.text, d.title from kb_chunks k join kb_docs d on d.id = k.doc_id where k.business_id = ${ctx.biz} and not d.archived
                        and (${'%' + words[0] + '%'} = '' or lower(k.text) like ${'%' + words[0] + '%'}) limit 3`;
  }
  return rows.map((r) => ({ from: r.title, text: str(r.text).slice(0, 900) }));
}

// ------------------------------------------------------------------ the timer (every minute)
export async function inboxTick(ctx) {
  const out = { replies: 0, reverted: 0, followups: 0, updates: 0, comments: 0 };
  // answers whose wait is over (the webhook's own wait normally answers; this catches anything it missed)
  for (const v of await ctx.tx`select id from inbox_conversations where business_id = ${ctx.biz} and reply_due_at is not null and reply_due_at <= ${ctx.now} limit 20`) {
    try { await replyDue(ctx, v.id, true); out.replies++; } catch (e) { await task(ctx, v.id, 'alert', 'error', 'The AI could not answer: ' + str(e.message || e)); await ctx.tx`update inbox_conversations set reply_due_at = null where id = ${v.id}`; }
  }
  // held chats whose time is up go back to the AI
  for (const v of await ctx.tx`select * from inbox_conversations where business_id = ${ctx.biz} and mode = 'human' and human_until is not null and human_until <= ${ctx.now} limit 50`) {
    await revertIfDue(ctx, v); out.reverted++;
  }
  // follow-ups (one for warm, two for hot; only inside 24 h; not when a person holds it or the customer ordered)
  const p = await profile(ctx, false);
  if (p.followups) {
    for (const v of await ctx.tx`select * from inbox_conversations where business_id = ${ctx.biz} and next_followup is not null and next_followup <= ${ctx.now} and followups_left > 0 limit 20`) {
      await ctx.tx`update inbox_conversations set next_followup = null where id = ${v.id}`;
      const ch = await chOf(ctx, v.channel_id);
      const want = v.interest === 'hot' ? p.follow_hot : p.follow_warm;
      if (!want || v.mode !== 'ai' || v.ordered || !CAN[ch.kind].followups || ch.status !== 'live' || !inWindow(ch, v, new Date(ctx.now.getTime() + 10 * 60e3))) continue;
      if (v.last_out_at && v.last_in_at && new Date(v.last_in_at) > new Date(v.last_out_at)) continue;   // they wrote again: the normal answer handles it
      try { if (await followUp(ctx, ch, v)) out.followups++; } catch (_) { /* skipped */ }
    }
  }
  // comments waiting for the AI
  for (const c of await ctx.tx`select c.channel_id, c.comment_id from inbox_comments c join inbox_channels ch on ch.id = c.channel_id
                               where c.business_id = ${ctx.biz} and c.action is null and ch.status = 'live' and ch.comments_ai and c.created_at > ${new Date(ctx.now.getTime() - 6 * 3600e3)} limit 10`) {
    try { await answerComment(ctx, c.channel_id, c.comment_id); out.comments++; } catch (_) { /* next time */ }
  }
  // delivery updates for orders taken in a chat (from the invoice's delivery status), and the review request
  try { out.updates = await (await import('./inbox2.js')).orderUpdates(ctx); } catch (_) { /* fine */ }
  return out;
}
async function followUp(ctx, ch, v) {
  const contact = await contactOf(ctx, v.contact_id);
  const hist = (await ctx.tx`select direction, text, transcript from inbox_messages where conversation_id = ${v.id} and direction <> 'note' order by id desc limit 12`).reverse();
  const p = await profile(ctx, false);
  const { parts } = await gemini(ctx, { systemInstruction: { parts: [{ text: 'You write ONE short, friendly reminder from "' + p.name + '" to a customer who went quiet after asking about a product. ' +
    'No pressure, no discount, no invented facts. Same language as the conversation (Banglish -> Bangla script). If a reminder would be pointless or rude here, answer exactly NONE.' }] },
    contents: [{ role: 'user', parts: [{ text: hist.map((m) => (m.direction === 'in' ? 'Customer: ' : 'Shop: ') + str(m.text || m.transcript)).join('\n') }] }], generationConfig: { temperature: 0.4 } }, 'followup', v.id);
  const t = textOf(parts);
  await ctx.tx`update inbox_conversations set followups_left = greatest(0, followups_left - 1) where id = ${v.id}`;
  if (!t || /^NONE\b/i.test(t)) return false;
  await deliver(ctx, ch, v, contact, { kind: 'text', text: t }, { author: 'ai' });
  const left = (await ctx.tx`select followups_left from inbox_conversations where id = ${v.id}`)[0].followups_left;
  if (left > 0) await ctx.tx`update inbox_conversations set next_followup = ${new Date(new Date(v.last_in_at).getTime() + 20 * 3600e3)} where id = ${v.id}`;
  return true;
}

// ------------------------------------------------------------------ the webhook door (index.ts: ?inbox=hook&ch=<id>&k=<key>)
export async function hookChannel(sql, chId, key) {
  if (!isId(chId) || !/^[0-9a-f]{20,64}$/i.test(str(key))) return null;
  const r = (await sql`select id, business_id, kind, hook_key, status from inbox_channels where id = ${chId}`)[0];
  if (!r || r.hook_key !== key || r.status === 'removed') return null;
  return r;
}
/** GET from Meta when the webhook is set up: answer hub.challenge when the verify word matches. */
export async function hookVerify(ctx, ch, q) {
  const want = await chSecret(ctx, ch, 'VERIFY');
  if (q['hub.mode'] === 'subscribe' && want && q['hub.verify_token'] === want) return { text: str(q['hub.challenge']) };
  return { status: 403, text: 'no' };
}
/** POST: read the events, ingest each. Returns what needs answering after the wait. */
export async function hookPost(ctx, chRow, raw, headers) {
  const ch = await chOf(ctx, chRow.id);
  if (!ch) return { due: [] };
  if (ch.kind === 'messenger' || ch.kind === 'instagram' || ch.kind === 'wa_cloud') {
    const ok = await metaSignatureOk(await chSecret(ctx, ch, 'APP_SECRET'), raw, headers['x-hub-signature-256']);
    if (!ok) return { status: 403, due: [] };
  }
  if (ch.kind === 'wa_sender') {
    const want = await chSecret(ctx, ch, 'HOOK_SECRET');
    if (want && str(headers['x-webhook-signature']) !== want) return { status: 403, due: [] };
  }
  let body = {}; try { body = JSON.parse(raw || '{}'); } catch (_) { body = {}; }
  const evs = readHook(ch.kind, body);
  const due = [], comments = [];
  for (const ev of evs) {
    const r = await ingest(ctx, ch, ev);
    if (r && r.dueInMs !== undefined) due.push({ id: r.conversationId, ms: r.dueInMs });
    if (r && r.commentDue) comments.push(r.comment);
  }
  return { due, comments, channelId: ch.id };
}

// ------------------------------------------------------------------ the website chat (public; index.ts ?chat=...)
async function visitorToken(hookKey, visitor) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(hookKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('v:' + visitor)));
  return Array.from(s.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const RATE = new Map();
function rateOk(key, max, perMs) {
  const now = Date.now(), r = RATE.get(key) || { n: 0, t: now };
  if (now - r.t > perMs) { r.n = 0; r.t = now; }
  r.n++; RATE.set(key, r);
  if (RATE.size > 5000) RATE.clear();
  return r.n <= max;
}
/** a: info | start | send | poll. Returns { status, body, due }. */
export async function webchat(ctx, chId, a, b, ip) {
  const ch = (await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and id = ${chId} and kind = 'webchat'`)[0];
  if (!ch || ch.status === 'removed') return { status: 404, body: { ok: false, error: 'This chat is not available.' } };
  const p = await profile(ctx, false);
  const look = { name: p.name, colour: str(chSetting(ch, 'colour', '#F5A623')), logo: str(chSetting(ch, 'logo', '')), greeting: str(p.first_message) || ('Hello! How can we help you today?'),
                 ai: true, open: ch.status !== 'setup' };
  if (a === 'info') return { status: 200, body: { ok: true, ...look } };
  if (!rateOk('ip:' + ip, 60, 60e3)) return { status: 429, body: { ok: false, error: 'Too many messages - wait a minute.' } };
  if (a === 'start') {
    const name = str(b.name).slice(0, 60), phone = phoneOk(b.phone);
    if (!name || !phone) return { status: 200, body: { ok: false, error: 'Your name and an 11-digit mobile number (01…) please.' } };
    const visitor = 'v' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const contact = (await ctx.tx`insert into inbox_contacts (business_id, channel_id, external_id, name, phone, customer_key)
                    values (${ctx.biz}, ${ch.id}, ${visitor}, ${name}, ${phone}, ${custKey(phone, name)}) returning *`)[0];
    const conv = await upsertConv(ctx, ch, contact);
    await writeMsg(ctx, conv, { direction: 'out', author: 'ai', text: look.greeting });
    await task(ctx, conv.id, 'enquiry', 'website', 'Website chat started by ' + name + ' (' + phone + ')');
    return { status: 200, body: { ok: true, visitor, token: await visitorToken(ch.hook_key, visitor), ...look } };
  }
  const visitor = str(b.visitor);
  if (!/^v[0-9a-f]{20}$/.test(visitor) || str(b.token) !== await visitorToken(ch.hook_key, visitor)) return { status: 403, body: { ok: false, error: 'Start the chat again.' } };
  const contact = (await ctx.tx`select * from inbox_contacts where channel_id = ${ch.id} and external_id = ${visitor}`)[0];
  if (!contact) return { status: 403, body: { ok: false, error: 'Start the chat again.' } };
  const conv = (await ctx.tx`select * from inbox_conversations where contact_id = ${contact.id}`)[0];
  if (a === 'send') {
    if (!rateOk('v:' + visitor, 20, 60e3)) return { status: 429, body: { ok: false, error: 'Slow down a little.' } };
    const ev = { type: 'message', from: visitor, text: str(b.text).slice(0, 2000) };
    if (b.image || b.audio) {
      const data = str(b.image || b.audio);
      if (data.length > 7_000_000) return { status: 200, body: { ok: false, error: 'That file is too big.' } };
      ev.media = { kind: b.image ? 'image' : 'audio', base64: data, mime: str(b.mime) || (b.image ? 'image/jpeg' : 'audio/webm') };
    }
    if (!ev.text && !ev.media) return { status: 200, body: { ok: false } };
    // a visitor gets a set number of AI answers a day; then the chat goes to the team
    const cap = num(chSetting(ch, 'daily_cap', 40));
    const used = (await ctx.tx`select count(*)::int n from inbox_messages where conversation_id = ${conv.id} and author = 'ai' and created_at > ${new Date(ctx.now.getTime() - H24)}`)[0].n;
    const r = await ingest(ctx, ch, ev);
    if (used >= cap && conv.mode === 'ai') { await handOver(ctx, conv, 'other', 'The visitor used today\'s AI answers'); return { status: 200, body: { ok: true } }; }
    // the AI is not answering here (practice mode, switched off): the message goes to the team
    if (!(r && r.dueInMs !== undefined) && conv.mode === 'ai') await task(ctx, conv.id, 'enquiry', 'website', 'Website message from ' + (contact.name || 'a visitor') + ': ' + (str(b.text).slice(0, 160) || '(a photo or voice note)'));
    return { status: 200, body: { ok: true }, due: r && r.dueInMs !== undefined ? { id: r.conversationId, ms: r.dueInMs } : null };
  }
  if (a === 'poll') {
    const after = Math.max(0, num(b.after));
    const rows = await ctx.tx`select id, direction, author, kind, text, payload, media, created_at from inbox_messages where conversation_id = ${conv.id} and id > ${after} and direction <> 'note' order by id limit 50`;
    const msgs = [];
    for (const m of rows) {
      const one = { id: Number(m.id), mine: m.direction === 'in', kind: m.kind, text: str(m.text), at: m.created_at };
      if (m.kind === 'cards') one.cards = ((m.payload && m.payload.cards) || []).map((c) => ({ title: c.title, subtitle: c.subtitle, image: c.image, code: c.code }));
      if (m.kind === 'buttons') one.buttons = ((m.payload && m.payload.buttons) || []).map((x) => x.title);
      if (m.kind === 'image' && m.media && !/^https?:/.test(m.media)) { try { one.image = await fileUrl(ctx, 'inbox', m.media); } catch (_) { /* none */ } }
      else if (m.kind === 'image' && m.media) one.image = m.media;
      msgs.push(one);
    }
    const typing = !!conv.reply_due_at;   // only while an answer is really coming
    return { status: 200, body: { ok: true, msgs, typing, person: conv.mode === 'human' } };
  }
  return { status: 400, body: { ok: false } };
}

// ================================================================== the Inbox screen (the team)
function need(ctx, role) { if (!roleAtLeast(ctx.s.role, role || 'sales')) throw new Error('The Inbox is not open to your role.'); }
function ago(d, now) { const s = Math.max(0, Math.round((now - new Date(d)) / 1000)); return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; }

/** erpInbox({pile, q, channel, mine}) - the list: whoever has waited longest at the top of Waiting. */
export async function erpInbox(ctx, payload) {
  need(ctx);
  const p = payload || {};
  const pile = ['open', 'later', 'done', 'waiting', 'all'].includes(p.pile) ? p.pile : 'open';
  const q = str(p.q).toLowerCase();
  const rows = await ctx.tx`select v.*, c.name, c.phone, c.avatar, c.external_id, ch.kind, ch.name as ch_name from inbox_conversations v
    join inbox_contacts c on c.id = v.contact_id join inbox_channels ch on ch.id = v.channel_id
    where v.business_id = ${ctx.biz} and ch.status <> 'removed'
      and (${pile} = 'all' or (${pile} = 'waiting' and v.mode = 'human' and v.handover_reason is not null and v.claimed_by is null) or (${pile} not in ('all', 'waiting') and v.pile = ${pile}))
      and (${str(p.channel)} = '' or v.channel_id::text = ${str(p.channel)})
      and (${q} = '' or lower(coalesce(c.name, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(v.last_text, '')) like ${'%' + q + '%'})
    order by case when ${pile} = 'waiting' then v.handover_at end asc nulls last, v.last_at desc limit 200`;
  const counts = (await ctx.tx`select
      count(*) filter (where pile = 'open')::int as open, count(*) filter (where pile = 'later')::int as later, count(*) filter (where pile = 'done')::int as done,
      count(*) filter (where mode = 'human' and handover_reason is not null and claimed_by is null)::int as waiting, coalesce(sum(unread), 0)::int as unread
      from inbox_conversations v join inbox_channels ch on ch.id = v.channel_id where v.business_id = ${ctx.biz} and ch.status <> 'removed'`)[0];
  const tasks = (await ctx.tx`select count(*)::int n from inbox_tasks where business_id = ${ctx.biz} and status = 'open'`)[0].n;
  return {
    counts: { ...counts, tasks },
    list: rows.map((r) => ({ id: r.id, name: str(r.name) || 'Customer', phone: str(r.phone), avatar: str(r.avatar), channel: r.kind, channelName: r.ch_name, mode: r.mode,
      reason: r.handover_reason ? REASONS[r.handover_reason] : '', claimed: str(r.claimed_name), waiting: r.mode === 'human' && r.handover_at ? ago(r.handover_at, ctx.now) : '',
      last: str(r.last_text), ago: ago(r.last_at, ctx.now), unread: r.unread, pile: r.pile, interest: r.interest, test: r.is_test,
      window: CAN[r.kind] && CAN[r.kind].window24 && r.last_in_at ? Math.max(0, Math.round((H24 - (ctx.now - new Date(r.last_in_at))) / 3600e3)) : null })),
  };
}

/** One conversation: the timeline (latest 80), the customer's ERP record, its leads and chat orders. */
export async function erpInboxOpen(ctx, payload) {
  need(ctx);
  const v = await convOf(ctx, str(payload && payload.id));
  if (!v) throw new Error('That conversation is not here.');
  const ch = await chOf(ctx, v.channel_id), c = await contactOf(ctx, v.contact_id);
  const before = num(payload && payload.before);
  const rows = (await ctx.tx`select * from inbox_messages where conversation_id = ${v.id} and (${before} = 0 or id < ${before}) order by id desc limit 80`).reverse();
  const msgs = [];
  for (const m of rows) {
    const one = { id: Number(m.id), dir: m.direction, author: m.author, who: str(m.user_name), kind: m.kind, text: str(m.text), transcript: str(m.transcript), seen: str(m.seen_as).replace(/\{[^}]*\}/, ''),
                  status: m.status, error: str(m.error), at: formatDate(new Date(m.created_at), 'd MMM, h:mm a') };
    if (m.payload && m.payload.cards) one.cards = m.payload.cards.map((x) => ({ code: x.code, title: x.title, subtitle: x.subtitle, image: x.image }));
    if (m.payload && m.payload.buttons) one.buttons = m.payload.buttons.map((x) => x.title);
    if (m.media && (m.kind === 'image' || m.kind === 'audio' || m.kind === 'video' || m.kind === 'file')) {
      try { one.url = /^https?:/.test(m.media) ? m.media : await fileUrl(ctx, 'inbox', m.media); } catch (_) { /* none */ }
    }
    msgs.push(one);
  }
  if (!before) await ctx.tx`update inbox_conversations set unread = 0 where id = ${v.id}`;
  // the customer's record: ERP invoices by phone, dues, chat orders, leads
  const ph = phoneOk(c.phone);
  let invoices = [], due = 0;
  if (ph) {
    invoices = (await ctx.tx`select invoice_no, created_at, grand_total, due_amount, delivery_status, payment_status from invoices where business_id = ${ctx.biz}
                and right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${ph.slice(-10)} and voided_at is null order by created_at desc limit 8`)
      .map((i) => ({ no: i.invoice_no, date: formatDate(new Date(i.created_at), 'd MMM yy'), total: num(i.grand_total), due: num(i.due_amount), delivery: str(i.delivery_status), paid: str(i.payment_status) }));
    due = invoices.reduce((t, i) => t + (i.paid === 'Paid' ? 0 : i.due), 0);
  }
  const orders = await ctx.tx`select no, status, items, delivery_charge, invoice_no, created_at from chat_orders where business_id = ${ctx.biz} and (conversation_id = ${v.id} or (${ph || ''} <> '' and phone = ${ph || ''})) order by created_at desc limit 6`;
  const leads = await ctx.tx`select id, stage, want, follow_up_on from inbox_leads where business_id = ${ctx.biz} and conversation_id = ${v.id} order by created_at desc limit 3`;
  return {
    id: v.id, mode: v.mode, until: v.human_until ? formatDate(new Date(v.human_until), 'h:mm a') : (v.mode === 'human' ? 'for good' : ''), claimed: str(v.claimed_name),
    reason: v.handover_reason ? REASONS[v.handover_reason] : '', note: str(v.handover_note), pile: v.pile, interest: v.interest, test: v.is_test,
    channel: { id: ch.id, kind: ch.kind, name: ch.name, can: CAN[ch.kind] }, window: inWindow(ch, v, ctx.now),
    windowLeft: CAN[ch.kind].window24 && v.last_in_at ? Math.max(0, Math.round((H24 - (ctx.now - new Date(v.last_in_at))) / 60e3)) : null,
    contact: { id: c.id, name: str(c.name), phone: str(c.phone), avatar: str(c.avatar), gender: c.gender, tags: c.tags || [], note: str(c.note), customerKey: str(c.customer_key) },
    msgs, more: rows.length === 80 ? Number(rows[0].id) : 0,
    record: { invoices, due, orders: orders.map((o) => ({ no: o.no, status: o.status, items: (o.items || []).map((x) => x.name + ' × ' + x.qty).join(', '), invoice: o.invoice_no,
      total: (o.items || []).reduce((t, x) => t + num(x.qty) * num(x.price), 0) + num(o.delivery_charge) })), leads: leads.map((l) => ({ id: l.id, stage: l.stage, want: str(l.want) })) },
  };
}

/** The team replies (text or a photo). After Meta's 24 hours a person's reply goes with the HUMAN_AGENT tag (7 days). */
export async function erpInboxSend(ctx, payload) {
  need(ctx);
  const p = payload || {};
  const v = await convOf(ctx, str(p.id));
  if (!v) throw new Error('That conversation is not here.');
  const ch = await chOf(ctx, v.channel_id), c = await contactOf(ctx, v.contact_id);
  const text = str(p.text);
  let msg;
  if (p.image) {
    const data = str(p.image).replace(/^data:[^,]+,/, '');
    const bin = atob(data); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    if (u.length > 8_000_000) throw new Error('The photo is over 8 MB.');
    const name = v.id + '-t' + Date.now().toString(36) + '.jpg';
    await saveFile(ctx, 'inbox', name, u, 'image/jpeg');
    msg = { kind: 'image', url: await fileUrl(ctx, 'inbox', name), caption: text, mediaName: name };
  } else {
    if (!text) throw new Error('Write the message first.');
    msg = { kind: 'text', text };
  }
  if (CAN[ch.kind].window24 && !inWindow(ch, v, ctx.now)) {
    const age = ctx.now - new Date(v.last_in_at || 0);
    if (age > 7 * H24) throw new Error('Meta allows no message 7 days after the customer\'s last one.');
    msg.tag = 'HUMAN_AGENT';
  }
  const r = await deliver(ctx, ch, v, c, msg, { author: 'team', userId: ctx.s.userId, userName: ctx.s.name });
  // a person answering a handed-over chat claims it
  if (v.mode === 'human' && !v.claimed_by) await ctx.tx`update inbox_conversations set claimed_by = ${ctx.s.userId}, claimed_name = ${ctx.s.name} where id = ${v.id}`;
  await ctx.tx`update inbox_tasks set status = 'done', done_by = ${ctx.s.name}, done_at = now() where conversation_id = ${v.id} and kind in ('handover', 'enquiry') and status = 'open'`;
  if (!r.ok) throw new Error('Not delivered: ' + r.error);
  return erpInboxOpen(ctx, { id: v.id });
}

/** Take a chat (minutes, or 0 = for good), give it back to the AI, claim a handed-over chat, move it between piles. */
export async function erpInboxMode(ctx, payload) {
  need(ctx);
  const p = payload || {};
  const v = await convOf(ctx, str(p.id));
  if (!v) throw new Error('That conversation is not here.');
  const ch = await chOf(ctx, v.channel_id);
  if (p.action === 'take' || p.action === 'claim') {
    const mins = p.minutes === 0 || p.minutes === '0' ? 0 : num(p.minutes) || revertMinutes(ch);
    await ctx.tx`update inbox_conversations set mode = 'human', human_until = ${mins ? new Date(ctx.now.getTime() + mins * 60e3) : null}, claimed_by = ${ctx.s.userId},
                 claimed_name = ${ctx.s.name}, reply_due_at = null where id = ${v.id}`;
    await ctx.tx`update inbox_tasks set status = 'done', done_by = ${ctx.s.name}, done_at = now() where conversation_id = ${v.id} and kind = 'handover' and status = 'open'`;
    await writeMsg(ctx, v, { direction: 'note', author: 'system', kind: 'event', text: ctx.s.name + ' took the chat' + (mins ? ' for ' + (mins >= 60 ? mins / 60 + ' h' : mins + ' min') : ' for good') + '.' });
  } else if (p.action === 'back') {
    await ctx.tx`update inbox_conversations set mode = 'ai', human_until = null, claimed_by = null, claimed_name = null, handover_reason = null where id = ${v.id}`;
    await writeMsg(ctx, v, { direction: 'note', author: 'system', kind: 'event', text: 'Back to the AI (' + ctx.s.name + ').' });
  } else if (['open', 'later', 'done'].includes(p.action)) {
    await ctx.tx`update inbox_conversations set pile = ${p.action} where id = ${v.id}`;
  } else if (p.action === 'note') {
    if (!str(p.text)) throw new Error('Write the note.');
    await writeMsg(ctx, v, { direction: 'note', author: 'team', userId: ctx.s.userId, userName: ctx.s.name, kind: 'text', text: str(p.text) });
  } else throw new Error('Unknown action.');
  return erpInboxOpen(ctx, { id: v.id });
}

/** Change what we know about the contact (name, phone, gender, tags, note). */
export async function erpInboxContact(ctx, payload) {
  need(ctx);
  const p = payload || {};
  const c = await contactOf(ctx, str(p.id));
  if (!c) throw new Error('No such contact.');
  const ph = p.phone !== undefined ? (str(p.phone) ? phoneOk(p.phone) : '') : null;
  if (p.phone !== undefined && str(p.phone) && !ph) throw new Error('The phone must be 11 digits starting 01.');
  await ctx.tx`update inbox_contacts set name = coalesce(${p.name !== undefined ? str(p.name) : null}, name), phone = case when ${ph !== null} then ${ph || null} else phone end,
               customer_key = case when ${!!ph} then ${ph ? custKey(ph, str(p.name || c.name)) : null} else customer_key end,
               gender = coalesce(${/^[mf]$/.test(str(p.gender)) ? str(p.gender) : null}, gender),
               tags = coalesce(${Array.isArray(p.tags) ? p.tags.map(str).filter(Boolean).slice(0, 12) : null}, tags), note = coalesce(${p.note !== undefined ? str(p.note) : null}, note)
               where id = ${c.id}`;
  return { ok: true };
}

/** The AI beside the chat: summary | ask | draft | lead (it sends nothing). */
export async function erpInboxAssist(ctx, payload) {
  need(ctx);
  const p = payload || {};
  const v = await convOf(ctx, str(p.id));
  if (!v) throw new Error('That conversation is not here.');
  const c = await contactOf(ctx, v.contact_id);
  const hist = (await ctx.tx`select direction, author, kind, text, transcript, seen_as, created_at from inbox_messages where conversation_id = ${v.id} order by id desc limit 60`).reverse();
  const lines = hist.map((m) => formatDate(new Date(m.created_at), 'd MMM h:mm a') + ' ' + (m.direction === 'in' ? 'Customer' : m.author === 'team' ? 'Team' : m.author === 'ai' ? 'Shop (AI)' : 'Note') + ': ' +
    str(m.text || '') + (m.transcript ? ' [voice: ' + m.transcript + ']' : '') + (m.seen_as ? ' [photo: ' + str(m.seen_as).replace(/\{[^}]*\}/, '') + ']' : '')).join('\n');
  const ph = phoneOk(c.phone);
  let record = '';
  if (ph) {
    const inv = await ctx.tx`select invoice_no, created_at, grand_total, delivery_status from invoices where business_id = ${ctx.biz} and right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10) = ${ph.slice(-10)} and voided_at is null order by created_at desc limit 10`;
    record = 'ERP invoices: ' + inv.map((i) => i.invoice_no + ' ' + formatDate(new Date(i.created_at), 'd MMM yy') + ' ৳' + Math.round(num(i.grand_total)) + ' ' + str(i.delivery_status)).join('; ');
  }
  const pr = await profile(ctx, false);
  const ask = p.mode === 'summary' ? 'Summarise this customer in one short paragraph: who they are, what they bought or want, any problem, what is open now.'
    : p.mode === 'draft' ? 'Write the next reply the shop should send now (only the reply text, in the customer\'s language, short, never inventing prices or promises).'
    : p.mode === 'lead' ? 'Return JSON only: {"name": "", "phone": "", "want": "", "interest": "warm|hot"} from the conversation.'
    : 'Answer this question about the customer from the record only: ' + str(p.question);
  const { parts } = await gemini(ctx, { systemInstruction: { parts: [{ text: 'You help the team of "' + pr.name + '" with one customer. Use only the conversation and the record given.' }] },
    contents: [{ role: 'user', parts: [{ text: 'Customer: ' + (c.name || '') + ' ' + (c.phone || '') + '\n' + record + '\n\nConversation:\n' + lines + '\n\n' + ask }] }], generationConfig: { temperature: 0.3 } },
    p.mode === 'draft' ? 'draft' : p.mode === 'summary' ? 'summary' : p.mode === 'lead' ? 'lead' : 'ask', v.id);
  if (p.mode === 'lead') {
    const j = jsonOf(parts) || {};
    const id = await leadUpsert(ctx, v, c, { name: j.name, phone: j.phone, want: j.want, interest: j.interest, stage: /hot/i.test(j.interest) ? 3 : 2 }, ctx.s.name);
    return { lead: id, ...j };
  }
  return { text: textOf(parts) };
}

/** Notifications: every thing a person has to act on, open until someone deals with it. */
export async function erpInboxTasks(ctx, payload) {
  need(ctx);
  const p = payload || {};
  if (p.done) {
    await ctx.tx`update inbox_tasks set status = 'done', done_by = ${ctx.s.name}, done_at = now() where business_id = ${ctx.biz} and id = ${num(p.done)}`;
  }
  const rows = await ctx.tx`select t.*, c.name from inbox_tasks t left join inbox_conversations v on v.id = t.conversation_id left join inbox_contacts c on c.id = v.contact_id
                            where t.business_id = ${ctx.biz} and (t.status = 'open' or t.done_at > ${new Date(ctx.now.getTime() - 3 * H24)}) order by t.status desc, t.created_at desc limit 200`;
  return { tasks: rows.map((t) => ({ id: Number(t.id), conv: t.conversation_id, kind: t.kind, reason: t.reason ? (REASONS[t.reason] || t.reason) : '', text: str(t.text), name: str(t.name),
    open: t.status === 'open', never: t.never_answered, ago: ago(t.created_at, ctx.now), done: t.done_by ? t.done_by + ', ' + ago(t.done_at, ctx.now) + ' ago' : '' })) };
}

export const HANDLERS = { erpInbox, erpInboxOpen, erpInboxSend, erpInboxMode, erpInboxContact, erpInboxAssist, erpInboxTasks };
