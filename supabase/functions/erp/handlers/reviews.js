// review-1 (owner 10 Nov 2026): "after a purchase, ask for a review in the same chat - Messenger in Messenger, WhatsApp
// in WhatsApp - as a card where the customer can give five stars straight away, to our page and to the product they
// bought, and write a review if they want. The reviews show on the website. Make it as easy as possible, so we get a
// review for every purchase."
//
// How it goes:
//   1. A chat order is delivered (inbox2.js orderUpdates) -> askReview: a review_asks row + in the chat:
//        Messenger      a card (photo of what they bought, "Give stars" button to the review page) + ⭐ quick replies
//        WhatsApp       the review page link (WhatsApp shows it as a card) + "reply 1-5"
//      in the chat's own script (Bangla / Banglish / English) with ভাই / আপু.
//   2. One tap on a ⭐ quick reply (REVIEW:n) or a reply of "5" / "⭐⭐⭐⭐⭐" rates the shop at once (chatStars);
//      the thanks carries the page link for the products and a few words.
//   3. review.html?r=<token> (reviewPage / reviewAct): big stars for the shop and for each product, an optional line
//      each, Send. Nothing is filled in for them.
//   4. reviewTick (every inbox tick) sends new or changed reviews to the website: POST <website>/reviews (cz_sync),
//      shown there as "Verified buyer" on the product and in the home page's "What our buyers say".
//   5. erpChatReviews: the list for the team (average, newest first) and Hide / Show (hidden = off the website).

import { formatDate } from '../lib/time.js';
import { getSecret, getConfig, httpFetch } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { profile, deliver, writeMsg, writeMsgNote, chatScript, catalogue, imageUrl, contactOf, chOf, inWindow } from './inbox.js';

const str = (v) => String(v == null ? '' : v).trim();
const H24 = 24 * 3600e3;
const NF = { status: 404, body: { ok: false, error: 'This page is not available.' } };

function pageBase(ctx) { return String((ctx.deps && ctx.deps.google && ctx.deps.google.appUrl) || 'https://erp.costareen.com/').replace(/#.*$/, '').replace(/\/+$/, ''); }
const apiParam = (ctx) => (ctx.deps && ctx.deps.hookBase ? '&api=' + encodeURIComponent(String(ctx.deps.hookBase)) : '');
/** The review page's fixed start (a Meta template's URL button) and the end for one ask. */
export function reviewBase(ctx) { return pageBase(ctx) + '/review.html?r='; }
export function reviewSuffix(ctx, ask) { return ask.token + apiParam(ctx); }
export function reviewLink(ctx, ask) { return reviewBase(ctx) + reviewSuffix(ctx, ask); }

function token() { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); }

/** The chat's script for the review words: what the customer writes in, else the shop's language. */
async function scriptOfChat(ctx, convId, p) {
  if (p.lang === 'en') return 'en';
  if (p.lang === 'bn') return 'bn';
  const hist = await ctx.tx`select direction, text from inbox_messages where conversation_id = ${convId} and direction = 'in' order by created_at desc limit 20`;
  return chatScript(hist.reverse()) || 'bn';
}
/** ভাই / আপু (or nothing until the gender is known); sir-style shops say নাম. */
function callWord(p, c, w) {
  const g = c && c.gender;
  if (p.style === 'vai' || p.style === 'bhai') {
    if (g === 'f') return w === 'bn' ? 'আপু' : 'apu';
    if (g === 'm') return w === 'bn' ? (p.style === 'vai' ? 'ভাই' : 'ভাইয়া') : (p.style === 'vai' ? 'bhai' : 'bhaiya');
    return '';
  }
  return '';
}

const W = {
  bn: { ask: (n) => 'আপনার পার্সেলটি পৌঁছে গেছে' + (n ? ' ' + n : '') + ' 🙌 কেমন লাগলো? এক ট্যাপে স্টার দিন, খুব উপকার হবে।',
        card: 'এক ট্যাপে স্টার দিন ⭐', btn: '⭐ স্টার দিন', waStars: 'এখানেই ১ থেকে ৫ লিখেও দিতে পারেন (৫ = দারুণ)।',
        thanks: (n, k) => 'অনেক ধন্যবাদ' + (n ? ' ' + n : '') + '! ' + '⭐'.repeat(k) + (k >= 4 ? ' শুনে খুব ভালো লাগলো।' : ' কোথায় সমস্যা হলো একটু জানাবেন? আমরা ঠিক করে দেবো।'),
        more: 'প্রোডাক্টে স্টার আর দুই লাইন লিখতে চাইলে (১০ সেকেন্ড): ' },
  banglish: { ask: (n) => 'apnar parcel ta pouche geche' + (n ? ' ' + n : '') + ' 🙌 kemon laglo? ek tap e star diye din, onek help hobe.',
        card: 'Ek tap e star din ⭐', btn: '⭐ Star din', waStars: 'ekhanei 1 theke 5 likheo dite paren (5 = darun).',
        thanks: (n, k) => 'onek dhonnobad' + (n ? ' ' + n : '') + '! ' + '⭐'.repeat(k) + (k >= 4 ? ' shune khub bhalo laglo.' : ' kothay problem holo ektu janaben? amra thik kore dibo.'),
        more: 'product e star ar 2 line likhte chaile (10 second): ' },
  en: { ask: (n) => 'Your parcel has arrived' + (n ? ', ' + n : '') + ' 🙌 How was it? One tap on the stars helps us a lot.',
        card: 'One tap on the stars ⭐', btn: '⭐ Give stars', waStars: 'Or just reply 1 to 5 here (5 = great).',
        thanks: (n, k) => 'Thank you so much' + (n ? ', ' + n : '') + '! ' + '⭐'.repeat(k) + (k >= 4 ? ' So glad to hear it.' : ' What went wrong? Tell us and we will fix it.'),
        more: 'To rate the product and add a line (10 seconds): ' },
};
const STAR_BTNS = [5, 4, 3, 2, 1].map((n) => ({ title: '⭐'.repeat(n), payload: 'REVIEW:' + n }));

/** A delivered chat order: make its review ask and send the card in the same chat. Returns true when sent. */
export async function askReview(ctx, o) {
  if (!o.conversation_id) return false;
  const v = (await ctx.tx`select * from inbox_conversations where id = ${o.conversation_id}`)[0];
  if (!v) return false;
  const ch = await chOf(ctx, v.channel_id), c = await contactOf(ctx, v.contact_id);
  if (!ch || ch.status === 'removed' || !c) return false;
  const p = await profile(ctx, false);
  const items = (o.items || []).filter((x) => str(x.sku) || str(x.name)).map((x) => ({ sku: str(x.sku), name: str(x.name) }));
  const ask = (await ctx.tx`insert into review_asks (business_id, chat_order_id, conversation_id, token, name, phone, items, channel_kind)
    values (${ctx.biz}, ${o.id}, ${v.id}, ${token()}, ${str(o.name)}, ${str(o.phone)}, ${ctx.tx.json(items)}, ${ch.kind})
    on conflict (chat_order_id) do nothing returning *`)[0];
  if (!ask) return false;                      // asked already
  const w = await scriptOfChat(ctx, v.id, p), T = W[w], n = callWord(p, c, w), link = reviewLink(ctx, ask);
  if (CAN_WINDOW[ch.kind] && !inWindow(ch, v, ctx.now)) {
    // Messenger after 24 h: only a template Meta approved (inbox2.js sends it) - the page link is its button
    const { reviewTemplate } = await import('./inbox2.js');
    return reviewTemplate(ctx, ch, v, c, o, reviewSuffix(ctx, ask), T.ask(n) + ' ' + link);
  }
  if (ch.kind === 'messenger' || ch.kind === 'instagram') {
    let image = '';
    try { const cat = await catalogue(ctx); const x = cat.find((y) => items.some((i) => i.sku && i.sku.toLowerCase() === y.sku.toLowerCase())); if (x) image = await imageUrl(ctx, x); } catch (_) { /* no photo */ }
    const r1 = await deliver(ctx, ch, v, c, { kind: 'cards', text: T.ask(n), cards: [{ title: T.ask(n).slice(0, 80), subtitle: (items.map((i) => i.name).join(', ') || T.card).slice(0, 80), image: image || undefined,
      buttons: [{ title: T.btn, url: link }] }] }, { author: 'system' });
    const r2 = await deliver(ctx, ch, v, c, { kind: 'buttons', text: T.card, buttons: STAR_BTNS }, { author: 'system' });
    return !!(r1.ok || r2.ok);
  }
  // WhatsApp (Evolution / official) and the website chat: the link shows as a card; a reply of 1-5 counts too
  const r = await deliver(ctx, ch, v, c, { kind: 'text', text: T.ask(n) + '\n' + link + '\n' + T.waStars }, { author: 'system' });
  return !!r.ok;
}
const CAN_WINDOW = { messenger: true, instagram: true, wa_cloud: true };

/** "5", "৫", "⭐⭐⭐⭐", "5 star" - a star reply, or 0. */
export function starsIn(text, payload) {
  const pl = str(payload).match(/^REVIEW:([1-5])$/);
  if (pl) return Number(pl[1]);
  const t = str(text).replace(/[১২৩৪৫]/g, (d) => String('১২৩৪৫'.indexOf(d) + 1));
  const stars = (t.match(/⭐|★/g) || []).length;
  if (stars >= 1 && stars <= 5 && t.replace(/⭐|★|\s|star[s]?|ta|ti|টা|টি/gi, '') === '') return stars;
  const m = t.match(/^\s*([1-5])\s*(star[s]?|⭐|★|ta|টা|টি)?\s*[!.]*\s*$/i);
  return m ? Number(m[1]) : 0;
}

/** Inbound: a star tap / reply while the chat has an open review ask -> the shop's rating, a thanks, the page link.
 *  Returns true when handled (the AI does not answer it). */
export async function chatStars(ctx, ch, contact, conv, text, payload) {
  const k = starsIn(text, payload);
  if (!k) return false;
  const ask = (await ctx.tx`select * from review_asks where business_id = ${ctx.biz} and conversation_id = ${conv.id}
    and asked_at > ${new Date(ctx.now.getTime() - 14 * H24)} order by asked_at desc limit 1`)[0];
  if (!ask) return false;
  // a typed number counts only for a few days and only while the shop has no rating yet (a tap always counts)
  const had = (await ctx.tx`select rating from chat_reviews where ask_id = ${ask.id} and kind = 'shop'`)[0];
  if (!str(payload) && (had || ctx.now - new Date(ask.asked_at) > 4 * H24)) return false;
  await saveOne(ctx, ask, { kind: 'shop', sku: '', name: '', rating: k, text: null });
  await writeMsg(ctx, conv, { direction: 'note', author: 'system', kind: 'rating', text: 'Rated the shop ' + '⭐'.repeat(k) + ' (review)' });
  const p = await profile(ctx, false), w = await scriptOfChat(ctx, conv.id, p), T = W[w], n = callWord(p, contact, w);
  await deliver(ctx, ch, conv, contact, { kind: 'text', text: T.thanks(n, k) + '\n' + T.more + reviewLink(ctx, ask) }, { author: 'system' });
  if (k <= 3) {
    // a low rating: a person looks at it today
    try { const { task } = await import('./inbox.js'); await task(ctx, conv.id, 'enquiry', null, 'Low rating ' + '⭐'.repeat(k) + ' after delivery - call ' + (str(ask.name) || 'the customer') + ' (' + str(ask.phone) + ')'); } catch (_) { /* the note is there */ }
  }
  return true;
}

async function saveOne(ctx, ask, r) {
  await ctx.tx`insert into chat_reviews (business_id, ask_id, kind, sku, product_name, rating, text)
    values (${ctx.biz}, ${ask.id}, ${r.kind}, ${r.sku}, ${r.name}, ${r.rating}, ${r.text == null ? '' : r.text})
    on conflict (ask_id, kind, sku) do update set rating = excluded.rating,
      text = case when ${r.text == null} then chat_reviews.text else excluded.text end, pushed_at = null, push_error = null, updated_at = now()`;
}

/** review.html?r=<token>: what to rate. */
export async function reviewPage(ctx, tok) {
  if (!/^[0-9a-f]{32}$/.test(str(tok))) return NF;
  const ask = (await ctx.tx`select * from review_asks where business_id = ${ctx.biz} and token = ${tok}`)[0];
  if (!ask) return NF;
  if (!ask.opened_at) await ctx.tx`update review_asks set opened_at = now() where id = ${ask.id}`;
  const p = await profile(ctx, false);
  const v = ask.conversation_id ? (await ctx.tx`select * from inbox_conversations where id = ${ask.conversation_id}`)[0] : null;
  const c = v ? await contactOf(ctx, v.contact_id) : null;
  const w = v ? await scriptOfChat(ctx, v.id, p) : (p.lang === 'en' ? 'en' : 'bn');
  const given = await ctx.tx`select kind, sku, rating, text from chat_reviews where ask_id = ${ask.id}`;
  let cat = [];
  try { cat = await catalogue(ctx); } catch (_) { cat = []; }
  const items = [];
  for (const it of ask.items || []) {
    const x = it.sku ? cat.find((y) => y.sku.toLowerCase() === str(it.sku).toLowerCase()) : null;
    let image = '';
    if (x) { try { image = await imageUrl(ctx, x); } catch (_) { image = ''; } }
    if (!items.some((i) => i.sku === str(it.sku) && it.sku)) items.push({ sku: str(it.sku), name: str(it.name) || (x && x.name) || '', image });
  }
  const g = (kind, sku) => { const r = given.find((x) => x.kind === kind && str(x.sku) === sku); return r ? { rating: r.rating, text: str(r.text) } : null; };
  return { status: 200, body: { ok: true, lang: w, shop: { name: str(p.name), colour: str(p.colour) }, you: { name: str(ask.name).split(/\s+/)[0] || '', word: callWord(p, c, w === 'bn' ? 'bn' : 'en') },
    items: items.filter((i) => i.sku).map((i) => ({ ...i, given: g('product', i.sku) })), shopGiven: g('shop', ''), done: !!ask.done_at,
    facebook: /^https:\/\//.test(str(p.review_link)) ? str(p.review_link) : '' } };
}

const SENDS = new Map();
/** review.html Send: {shop: {rating, text}, items: [{sku, rating, text}]}. */
export async function reviewAct(ctx, tok, b, ip) {
  if (!/^[0-9a-f]{32}$/.test(str(tok))) return NF;
  const ask = (await ctx.tx`select * from review_asks where business_id = ${ctx.biz} and token = ${tok}`)[0];
  if (!ask) return NF;
  const key = str(ip) + ':' + ask.id, now = Date.now(), recent = (SENDS.get(key) || []).filter((t) => now - t < 3600e3);
  if (recent.length >= 10) return { status: 429, body: { ok: false, error: 'Too many tries - please wait a little.' } };
  SENDS.set(key, recent.concat([now]));
  const rate = (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : 0; };
  const words = (v) => str(v).replace(/\s+/g, ' ').slice(0, 1000);
  const rows = [];
  const s = (b && b.shop) || {};
  if (rate(s.rating)) rows.push({ kind: 'shop', sku: '', name: '', rating: rate(s.rating), text: words(s.text) });
  for (const it of (b && Array.isArray(b.items) ? b.items : []).slice(0, 20)) {
    const own = (ask.items || []).find((x) => str(x.sku) && str(x.sku).toLowerCase() === str(it && it.sku).toLowerCase());
    if (own && rate(it.rating)) rows.push({ kind: 'product', sku: str(own.sku), name: str(own.name), rating: rate(it.rating), text: words(it.text) });
  }
  if (!rows.length) return { status: 200, body: { ok: false, error: 'Tap the stars first.' } };
  for (const r of rows) await saveOne(ctx, ask, r);
  await ctx.tx`update review_asks set done_at = coalesce(done_at, now()) where id = ${ask.id}`;
  if (ask.conversation_id) {
    const v = (await ctx.tx`select * from inbox_conversations where id = ${ask.conversation_id}`)[0];
    if (v) {
      const line = rows.map((r) => (r.kind === 'shop' ? 'Shop' : r.name) + ' ' + '⭐'.repeat(r.rating) + (r.text ? ': "' + r.text + '"' : '')).join('\n');
      await writeMsgNote(ctx, v, 'Review given:\n' + line);
      const low = rows.find((r) => r.rating <= 3);
      if (low) { try { const { task } = await import('./inbox.js'); await task(ctx, v.id, 'enquiry', null, 'Low rating ' + '⭐'.repeat(low.rating) + ' - call ' + (str(ask.name) || 'the customer') + ' (' + str(ask.phone) + ')'); } catch (_) { /* noted */ } }
    }
  }
  let pushed = false;
  try { pushed = (await pushReviews(ctx)).sent > 0; } catch (_) { /* the timer sends it */ }
  const p = await profile(ctx, false);
  return { status: 200, body: { ok: true, pushed, facebook: /^https:\/\//.test(str(p.review_link)) ? str(p.review_link) : '' } };
}

/** Send new / changed reviews to the website (cz_sync POST /reviews). -> {sent, failed} */
export async function pushReviews(ctx) {
  const rows = await ctx.tx`select r.*, a.name as who, a.phone, a.channel_kind, a.items, a.id as ask from chat_reviews r join review_asks a on a.id = r.ask_id
    where r.business_id = ${ctx.biz} and r.pushed_at is null order by r.updated_at limit 100`;
  if (!rows.length) return { sent: 0, failed: 0 };
  const keyV = await getSecret(ctx, 'CZ_SYNC_KEY');
  const dflt = ctx.deps && ctx.deps.install && ctx.deps.install.id ? '' : 'https://costareen.com/wp-json/cz/v1';
  const base = str(await getConfig(ctx, 'website_api', dflt)) || dflt;
  if (!keyV || !base) return { sent: 0, failed: 0, waiting: 'no website' };
  const first = (n) => { const w = str(n).split(/\s+/).filter(Boolean); return w.length > 1 ? w[0] + ' ' + w[1][0] + '.' : (w[0] || 'Customer'); };
  const body = { reviews: rows.map((r) => ({ ref: 'erp-' + r.id, kind: r.kind, sku: r.sku, name: first(r.who), phone: str(r.phone), rating: r.rating, text: str(r.text),
    products: (r.items || []).map((x) => str(x.name)).filter(Boolean).join(', ').slice(0, 300), channel: str(r.channel_kind), hidden: !!r.hidden })) };
  const res = await httpFetch(ctx, base.replace(/\/+$/, '') + '/reviews', { method: 'POST', headers: { 'x-cz-key': keyV, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (res.code !== 200 || !res.json) {
    const why = 'website HTTP ' + res.code;
    for (const r of rows) await ctx.tx`update chat_reviews set push_error = ${why} where id = ${r.id}`;
    return { sent: 0, failed: rows.length, error: why };
  }
  const saved = new Set((res.json.saved || []).map(String)), missing = new Set((res.json.missing || []).map(String));
  let sent = 0;
  for (const r of rows) {
    const ref = 'erp-' + r.id;
    if (saved.has(ref)) { sent++; await ctx.tx`update chat_reviews set pushed_at = now(), push_error = null where id = ${r.id}`; }
    // the product is not on the website: kept here, marked so it is not sent again and again
    else if (missing.has(ref)) await ctx.tx`update chat_reviews set pushed_at = now(), push_error = 'not on the website' where id = ${r.id}`;
  }
  return { sent, failed: rows.length - sent };
}

/** The inbox tick: reviews to the website. */
export async function reviewTick(ctx) {
  const any = (await ctx.tx`select 1 from chat_reviews where business_id = ${ctx.biz} and pushed_at is null limit 1`).length;
  return any ? pushReviews(ctx) : { sent: 0 };
}

/** The team's list: {avg, count, asked, answered, reviews[]}; {action:'hide'|'show', id}. */
export async function erpChatReviews(ctx, payload) {
  const p = payload || {};
  if (p.action === 'hide' || p.action === 'show') {
    if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner hides a review.');
    const r = (await ctx.tx`update chat_reviews set hidden = ${p.action === 'hide'}, pushed_at = null, updated_at = now() where business_id = ${ctx.biz} and id = ${str(p.id)} returning id`)[0];
    if (!r) throw new Error('No such review.');
    try { await pushReviews(ctx); } catch (_) { /* the timer sends it */ }
    return { ok: true };
  }
  const st = (await ctx.tx`select count(*)::int asked, count(*) filter (where done_at is not null or exists (select 1 from chat_reviews r where r.ask_id = a.id))::int answered
    from review_asks a where a.business_id = ${ctx.biz}`)[0];
  const avg = (await ctx.tx`select round(avg(rating)::numeric, 1)::float avg, count(*)::int n from chat_reviews where business_id = ${ctx.biz} and kind = 'shop' and not hidden`)[0];
  const rows = await ctx.tx`select r.*, a.name as who, a.channel_kind, a.conversation_id from chat_reviews r join review_asks a on a.id = r.ask_id
    where r.business_id = ${ctx.biz} order by r.updated_at desc limit 100`;
  return { avg: avg.avg, count: avg.n, asked: st.asked, answered: st.answered,
    reviews: rows.map((r) => ({ id: r.id, kind: r.kind, product: str(r.product_name), sku: str(r.sku), rating: r.rating, text: str(r.text), name: str(r.who), channel: str(r.channel_kind),
      conv: r.conversation_id, hidden: r.hidden, onSite: !!r.pushed_at && !r.push_error && !r.hidden, siteError: str(r.push_error), at: formatDate(new Date(r.updated_at), 'd MMM yyyy, h:mm a') })) };
}

export const HANDLERS = { erpChatReviews };
