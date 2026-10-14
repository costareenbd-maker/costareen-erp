// The Inbox's public pages (123_inbox_pages.sql; index.ts ?inbox=order|bill|item):
//
//   orderPage(ctx, token)            order.html?o=<token>: the order's status in the customer's words, the bill, Track
//   orderBill(ctx, token)            the bill as a PNG (deps.svgPng) - sent in the chat right after an order
//   itemPage(ctx, convToken, sku)    item.html?c=<conversation token>&sku=...: a product page opened from the chat
//   itemAct(ctx, convToken, body)    'intent' (pressed Buy: the lead is kept - "To chase") or 'buy' (an order linked to the chat)
//
// Plus the links the agent sends: orderLink, billLink, itemLink. Every page answers only for its token and only while
// the feature is in the plan and on (order_page, bill_picture, product_page).

import { num, formatDate } from '../lib/time.js';
import { feat } from '../lib/inboxplan.js';
import { billSvg } from '../lib/billsvg.js';
import { profile, catalogue, searchCat, imageUrl, deliveryFor, nextOrderNo, orderEvent, leadUpsert, task, deliver, chOf, contactOf, phoneOk, inWindow } from './inbox.js';
import { custKey } from '../lib/phone.js';

const str = (v) => String(v == null ? '' : v).trim();
const NF = { status: 404, body: { ok: false, error: 'This page is not available.' } };

function pageBase(ctx) { return String((ctx.deps && ctx.deps.google && ctx.deps.google.appUrl) || 'https://erp.costareen.com/').replace(/#.*$/, '').replace(/\/+$/, ''); }
function api(ctx) { return String((ctx.deps && ctx.deps.hookBase) || ''); }
function withQ(url, q) { return url + (url.includes('?') ? '&' : '?') + q; }
const apiParam = (ctx) => (api(ctx) ? '&api=' + encodeURIComponent(api(ctx)) : '');
export function orderLink(ctx, o) { return pageBase(ctx) + '/order.html?o=' + o.page_token + apiParam(ctx); }
export function billLink(ctx, o) { return api(ctx) ? withQ(api(ctx), 'inbox=bill&o=' + o.page_token) : ''; }
export function itemLink(ctx, conv, sku) { return pageBase(ctx) + '/item.html?c=' + conv.shop_token + '&sku=' + encodeURIComponent(sku) + apiParam(ctx); }

/** The delivery stage of an approved order, from its invoice (as orderUpdates reads it). */
function stageOf(ds) {
  ds = str(ds).toLowerCase();
  return /deliver(ed)?$|^delivered|complete/.test(ds) ? 'delivered' : /out for|on the way/.test(ds) ? 'out' : /return|cancel|fail|hold/.test(ds) ? 'failed' : /shipped|sent|courier|transit|booked|picked/.test(ds) ? 'courier' : '';
}
const WORDS = {
  en: { received: 'Order received', preparing: 'Being prepared', courier: 'With the courier', out: 'Out for delivery', delivered: 'Delivered', failed: 'Delivery problem — we will call you', cancelled: 'Cancelled' },
  bn: { received: 'অর্ডার পাওয়া গেছে', preparing: 'প্রস্তুত করা হচ্ছে', courier: 'কুরিয়ারে দেওয়া হয়েছে', out: 'ডেলিভারির পথে', delivered: 'ডেলিভারি হয়েছে', failed: 'ডেলিভারিতে সমস্যা — আমরা ফোন করব', cancelled: 'বাতিল' },
};
const STEPS = ['received', 'preparing', 'courier', 'out', 'delivered'];
async function shopOf(ctx) {
  const p = await profile(ctx, false);
  return { name: str(p.name), phone: str(p.phone), address: str(p.address), hours: str(p.hours), lang: p.lang === 'en' ? 'en' : 'bn', p };
}
function maskPhone(ph) { ph = str(ph); return ph.length > 6 ? ph.slice(0, 3) + '•••••' + ph.slice(-3) : ph; }

export async function orderPage(ctx, token) {
  if (!/^[0-9a-f]{32}$/.test(str(token)) || !(await feat(ctx, 'order_page'))) return NF;
  const o = (await ctx.tx`select * from chat_orders where business_id = ${ctx.biz} and page_token = ${token}`)[0];
  if (!o) return NF;
  let ds = '', track = '';
  if (o.invoice_no) {
    const inv = (await ctx.tx`select delivery_status from invoices where business_id = ${ctx.biz} and invoice_no = ${o.invoice_no}`)[0];
    ds = str(inv && inv.delivery_status);
    const cl = (await ctx.tx`select consignment_id, tracking_code from courier_log where business_id = ${ctx.biz} and invoice_no = ${o.invoice_no} order by booked_at desc limit 1`)[0];
    if (cl && str(cl.tracking_code)) track = 'https://steadfast.com.bd/t/' + encodeURIComponent(str(cl.tracking_code));
  }
  const stage = o.status === 'cancelled' ? 'cancelled' : o.status !== 'approved' ? 'received' : (stageOf(ds) || 'preparing');
  const shop = await shopOf(ctx);
  const items = (o.items || []).map((x) => ({ name: str(x.name), qty: num(x.qty), price: num(x.price) }));
  return { status: 200, body: { ok: true,
    shop: { name: shop.name, phone: shop.phone, hours: shop.hours }, lang: shop.lang, words: WORDS,
    order: { no: o.no, date: formatDate(new Date(o.created_at), 'd MMM yyyy, h:mm a'), name: str(o.name), phone: maskPhone(o.phone), address: str(o.address), items,
      delivery: num(o.delivery_charge), total: items.reduce((t, x) => t + x.qty * x.price, 0) + num(o.delivery_charge), stage, steps: stage === 'cancelled' || stage === 'failed' ? [] : STEPS,
      track, bill: (await feat(ctx, 'bill_picture')) ? billLink(ctx, o) : '' } } };
}

export async function orderBill(ctx, token) {
  if (!/^[0-9a-f]{32}$/.test(str(token)) || !(await feat(ctx, 'bill_picture')) || !ctx.deps.svgPng) return null;
  const o = (await ctx.tx`select * from chat_orders where business_id = ${ctx.biz} and page_token = ${token}`)[0];
  if (!o) return null;
  const shop = await shopOf(ctx);
  const svg = billSvg({ name: shop.name, phone: shop.phone, address: shop.address, colour: str(shop.p.colour) },
    { no: o.no, date: formatDate(new Date(o.created_at), 'd MMM yyyy'), name: o.name, phone: o.phone, address: o.address, items: o.items || [], delivery: num(o.delivery_charge) });
  return await ctx.deps.svgPng(svg);
}

async function convByToken(ctx, token) {
  if (!/^[0-9a-f]{32}$/.test(str(token))) return null;
  return (await ctx.tx`select * from inbox_conversations where business_id = ${ctx.biz} and shop_token = ${token}`)[0] || null;
}

export async function itemPage(ctx, convToken, sku) {
  if (!(await feat(ctx, 'product_page'))) return NF;
  const v = await convByToken(ctx, convToken);
  if (!v) return NF;
  const cat = await catalogue(ctx);
  const x = cat.find((y) => y.sku.toLowerCase() === str(sku).toLowerCase());
  if (!x) return NF;
  const shop = await shopOf(ctx), c = await contactOf(ctx, v.contact_id);
  const more = searchCat(cat, x.cat || x.brand || x.name).filter((y) => y.sku !== x.sku && y.stock > 0 && y.sell > 0).slice(0, 6);
  const card = async (y) => ({ sku: y.sku, name: y.name, price: num(y.sell), available: y.stock > 0, image: await imageUrl(ctx, y) });
  const moreCards = [];
  for (const y of more) moreCards.push(await card(y));
  return { status: 200, body: { ok: true, lang: shop.lang, orders: await feat(ctx, 'orders'),
    shop: { name: shop.name, phone: shop.phone, hours: shop.hours },
    product: { ...(await card(x)), brand: str(x.brand), category: str(x.cat), about: str(x.notes || x.desc || '') },
    delivery: { inside: num(shop.p.delivery_in), outside: num(shop.p.delivery_out), daysIn: str(shop.p.days_in), daysOut: str(shop.p.days_out), rule: str(shop.p.delivery_rule) },
    payment: str(shop.p.payment), returns: str(shop.p.returns),
    you: { name: str(c && c.name), phone: str(c && c.phone) }, more: moreCards } };
}

const BUYS = new Map();
export async function itemAct(ctx, convToken, b, ip) {
  if (!(await feat(ctx, 'product_page'))) return NF;
  const v = await convByToken(ctx, convToken);
  if (!v) return NF;
  const cat = await catalogue(ctx);
  const x = cat.find((y) => y.sku.toLowerCase() === str(b.sku).toLowerCase());
  if (!x) return NF;
  const c = await contactOf(ctx, v.contact_id);
  if (b.a === 'intent') {
    // pressed Buy: the interest is kept (an open lead) - "To chase" lists it if no order follows
    await leadUpsert(ctx, v, c, { want: x.name, stage: 2 }, 'product page');
    return { status: 200, body: { ok: true } };
  }
  if (b.a !== 'buy') return { status: 400, body: { ok: false, error: 'What to do?' } };
  if (!(await feat(ctx, 'orders'))) return { status: 200, body: { ok: false, error: 'Orders are taken in the chat - write to us there.' } };
  const k = str(ip) + ':' + v.id, now = Date.now(), r = BUYS.get(k) || [];
  const recent = r.filter((t) => now - t < 3600e3);
  if (recent.length >= 5) return { status: 429, body: { ok: false, error: 'Too many orders - write to us in the chat.' } };
  const ph = phoneOk(b.phone);
  if (!str(b.name)) return { status: 200, body: { ok: false, error: 'Write your name.' } };
  if (!ph) return { status: 200, body: { ok: false, error: 'The phone number must be 11 digits starting 01.' } };
  if (str(b.address).length < 6) return { status: 200, body: { ok: false, error: 'Write the full address.' } };
  if (!(x.sell > 0)) return { status: 200, body: { ok: false, error: 'This product has no price yet - ask us in the chat.' } };
  if (!(x.stock > 0)) return { status: 200, body: { ok: false, error: 'This product is not available now.' } };
  const qty = Math.max(1, Math.min(50, Math.round(num(b.qty) || 1)));
  const p = await profile(ctx, false);
  const charge = b.area === 'inside' ? num(p.delivery_in) : b.area === 'outside' ? num(p.delivery_out) : (deliveryFor(p, b.address).charge ?? num(p.delivery_out));
  const items = [{ sku: x.sku, name: x.name, qty, price: x.sell }];
  const no = await nextOrderNo(ctx);
  const o = (await ctx.tx`insert into chat_orders (business_id, no, conversation_id, name, phone, address, items, delivery_charge, note, taken_by)
             values (${ctx.biz}, ${no}, ${v.id}, ${str(b.name)}, ${ph}, ${str(b.address)}, ${ctx.tx.json(items)}, ${charge}, ${str(b.note) || null}, 'product page') returning *`)[0];
  BUYS.set(k, recent.concat([now]));
  await orderEvent(ctx, o.id, 'Placed on the product page opened from the chat', 'Customer');
  await ctx.tx`update inbox_conversations set ordered = true, interest = 'hot', followups_left = 0, next_followup = null where id = ${v.id}`;
  await ctx.tx`update inbox_contacts set phone = coalesce(phone, ${ph}), customer_key = coalesce(customer_key, ${custKey(ph, str(b.name))}), name = coalesce(name, ${str(b.name)}) where id = ${c.id}`;
  await leadUpsert(ctx, v, c, { name: b.name, phone: ph, want: x.name, stage: 5 }, 'product page');
  await task(ctx, v.id, 'order', null, 'New order ' + no + ' from the product page: ' + str(b.name) + ' (' + ph + '): ' + x.name + ' × ' + qty);
  // the chat hears it too (inside Meta's window)
  const total = qty * x.sell + charge;
  try {
    const ch = await chOf(ctx, v.channel_id);
    if (ch && (!ch.kind.match(/messenger|instagram/) || inWindow(ch, v, ctx.now))) {
      const bn = p.lang !== 'en';
      await deliver(ctx, ch, v, c, { kind: 'text', text: (bn ? 'ধন্যবাদ! আপনার অর্ডার ' + no + ' পাওয়া গেছে — মোট ৳' : 'Thank you! Your order ' + no + ' is received — total ৳') + Math.round(total).toLocaleString('en-IN') +
        ((await feat(ctx, 'order_page')) ? (bn ? '\nঅর্ডারের অবস্থা: ' : '\nYour order: ') + orderLink(ctx, o) : '') }, { author: 'system' });
    }
  } catch (_) { /* the order stands */ }
  return { status: 200, body: { ok: true, no, total, page: (await feat(ctx, 'order_page')) ? orderLink(ctx, o) : '' } };
}
