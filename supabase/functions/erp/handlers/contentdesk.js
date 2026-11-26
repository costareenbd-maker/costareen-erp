// content-desk-1 (owner 19 Nov 2026, docs/CONTENT-DESK-PLAN.md + CONTENT-DESK-BUILD.md C2c/E2): the server side of a
// business's Content desk. Each business may have its own content engine on the owner's Mac (a "bizdesk" bridge,
// the same protocol as the Brand desk bridge: config brand_bridge {url, seen} + secret BRAND_BRIDGE_KEY).
//
//   contentEmit(ctx, kind, ref, facts)   a one-line hook in stock.js: a product created (addProduct - so the Excel,
//                                        joint, receive and order paths are caught too), a supplier order written
//                                        (erpPoCreate, its ETA later in erpPoStage), a shipment received
//                                        (receiveShipment). Writes a content_events row with FACTS ONLY from the ERP.
//                                        Never throws; does nothing unless the business has app `contentdesk` on and a
//                                        brand_bridge, and is not the personal brand desk itself (kind 'brand').
//   contentTick(ctx)                     the minute timer (jobs.js): due events -> POST /drafts/make on the bridge
//                                        {text (Bangla, facts only), topic, platforms, video: true}; sent / failed
//                                        (one retry after an hour); the Mac being off is not a failure.
//   erpContentDesk()                     events + videos + handlers (manager)
//   erpContentVideoUrl({id})             a 1-hour download link of one video (manager)
//   erpContentHandlersSave({handlers})   the people who run the pages: [{name, phone}] up to 10 (manager)
//   erpContentVideoUploadUrl({bytes})    owner (the studio): a one-time upload address, path content/<uuid>.mp4
//   erpContentVideoSave({path, title, platform, bytes, draftId, madeBy})   owner: the uploaded file becomes a row
//   erpContentVideoSend({id, phone})     manager: the video to one handler on the business's OWN WhatsApp
//
// Owner rules: nothing is published from here; videos wait in the ERP. "Only me" app `contentdesk` (apps.js). The gate
// is the BUSINESS's (the app is open for this business) plus a role, so the owner's manager can send videos too.
import { roleAtLeast } from '../allow.js';
import { getConfig, setConfig, getSecret } from '../lib/ext.js';
import { formatDate } from '../lib/time.js';
import { phone11 } from '../lib/phone.js';
import { appIsOff } from './apps.js';
import { platformAdmin } from './platform.js';

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const KINDS = ['new_product', 'shipment_coming', 'shipment_arrived'];
const H = 3600e3, DAY = 86400e3;
const MERGE_DELAY = 2 * H;          // a batch of new products waits 2 h after its first product for more to join
const COMING_BEFORE = 10 * DAY;     // "coming soon" goes out 10 days before the expected arrival
const COMING_NO_ETA = 30 * DAY;     // ... or 30 days after the order when no arrival date is known
const RETRY = H, MAX_TRIES = 2;
const MAX_VIDEO = 80 * 1024 * 1024;
const MAX_ITEMS = 30;               // products named in one event (an Excel import of 500 still makes one event)
const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube'];
const TOPIC = { new_product: 'cz_stock', shipment_arrived: 'cz_stock', shipment_coming: 'cz_news' };
const ONLINE_MS = 3 * 60e3, BRIDGE_MS = 25000;
const PATH_RE = /^content\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/;

// ------------------------------------------------------------------ gates
/** Is the app open for this BUSINESS (its flag row, or its owner is the platform admin) - not for the person saving. */
async function bizOn(ctx) {
  if (ctx.memo && ctx.memo.cdOn !== undefined) return ctx.memo.cdOn;
  let on = false;
  try { on = !(await appIsOff(ctx.deps, ctx.sql, 'contentdesk', { biz: ctx.biz, s: { role: 'owner' } })); } catch (_) { on = false; }
  if (ctx.memo) ctx.memo.cdOn = on;
  return on;
}
export async function gate(ctx, role) {
  if (!roleAtLeast(ctx.s.role, role)) {
    throw new Error(role === 'owner' ? 'কনটেন্ট ডেস্কের এই কাজটা শুধু মালিক করতে পারেন।'
      : role === 'sales' ? 'কনটেন্ট ডেস্ক এই ব্যবসার লোকজনই খুলতে পারেন।' : 'এই কাজটা ম্যানেজার বা তার উপরের কেউ করতে পারেন (অনুমোদন, সময়, বাতিল, নিয়ম)।');
  }
  if (!(await platformAdmin(ctx)) && !(await bizOn(ctx))) throw new Error('এই ERP-তে কনটেন্ট ডেস্ক এখনো চালু হয়নি।');
}

async function logErr(ctx, what, e) {
  console.error('contentdesk ' + what, e && e.message);
  try {
    await ctx.sql`insert into erp_errors (business_id, who, role, action, message, build)
                  values (${ctx.biz}, ${str(ctx.s && ctx.s.name) || 'Content desk'}, ${str(ctx.s && ctx.s.role)}, ${'content:' + what},
                          ${String((e && e.message) || e).slice(0, 500)}, 'contentdesk')`;
  } catch (_) { /* never the reason a save fails */ }
}

// ------------------------------------------------------------------ facts from the ERP
/** {sku: {sku, name, brand, category, price, stock}} for the asked skus (any case). */
async function productFacts(ctx, skus) {
  const keys = [...new Set(skus.map((s) => str(s).toLowerCase()).filter(Boolean))];
  if (!keys.length) return {};
  const rows = await ctx.tx`select sku, name, brand, category, sell_price, stock from product_stock
                            where business_id = ${ctx.biz} and lower(btrim(sku)) = any(${keys})`;
  const out = {};
  for (const r of rows) out[str(r.sku).toLowerCase()] = { sku: str(r.sku), name: str(r.name), brand: str(r.brand), category: str(r.category),
                                                        price: Math.round(num(r.sell_price)), stock: Math.round(num(r.stock)) };
  return out;
}
const iso = (d) => (d ? new Date(d).toISOString() : null);
const ymd = (d) => formatDate(new Date(d), 'yyyy-MM-dd');

// ------------------------------------------------------------------ capture
/**
 * The hook. kind: new_product (facts {id}), shipment_coming (ref = order no; facts {eta?, update?}),
 * shipment_arrived (ref = order no or shipment reference; facts {lines:[{sku, qty}], poId?}). Returns the event id or null.
 */
export async function contentEmit(ctx, kind, ref, facts) {
  try {
    if (!ctx || !ctx.tx || !ctx.biz || !KINDS.includes(kind)) return null;
    if (ctx.memo && ctx.memo.cdSkip) return null;
    if (!ctx.memo || ctx.memo.cdReady === undefined) {
      const cfg = await ctx.tx.savepoint(() => ctx.tx`select key, value from business_config where business_id = ${ctx.biz} and key in ('brand_bridge', 'business_kind')`);
      const m = Object.fromEntries(cfg.map((r) => [r.key, str(r.value)]));
      const ready = !!m.brand_bridge && m.business_kind !== 'brand';
      if (ctx.memo) ctx.memo.cdReady = ready;
    }
    if (ctx.memo && !ctx.memo.cdReady) return null;
    if (!(await bizOn(ctx))) return null;
    return await ctx.tx.savepoint(() => capture(ctx, kind, str(ref), facts || {}));
  } catch (e) { await logErr(ctx, kind, e); return null; }
}

async function capture(ctx, kind, ref, f) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  if (kind === 'new_product') {
    const p = (await ctx.tx`select id, sku from products where business_id = ${ctx.biz} and id = ${f.id}`)[0];
    if (!p) return null;
    const fact = (await productFacts(ctx, [p.sku]))[str(p.sku).toLowerCase()];
    if (!fact) return null;
    const item = { id: String(p.id), ...fact };
    const had = await ctx.tx`select id from content_events where business_id = ${ctx.biz} and kind = 'new_product'
                             and payload->'products' @> ${ctx.tx.json([{ id: String(p.id) }])}`;
    if (had.length) return had[0].id;
    // a batch still waiting (its first product less than 2 h ago): this product joins it
    const open = (await ctx.tx`select id, payload from content_events where business_id = ${ctx.biz} and kind = 'new_product'
                               and state = 'waiting' and due_at > ${now} and created_at > ${new Date(now.getTime() - DAY)}
                               order by created_at desc limit 1 for update`)[0];
    if (open) {
      const pl = open.payload || {};
      const list = Array.isArray(pl.products) ? pl.products : [];
      const total = num(pl.count) || list.length;
      const next = { ...pl, count: total + 1, products: list.length < MAX_ITEMS ? list.concat([item]) : list };
      await ctx.tx`update content_events set payload = ${ctx.tx.json(next)} where id = ${open.id}`;
      return open.id;
    }
    const r = await ctx.tx`insert into content_events (business_id, kind, ref, payload, due_at)
                           values (${ctx.biz}, 'new_product', ${'np-' + p.id}, ${ctx.tx.json({ products: [item], count: 1 })}, ${new Date(now.getTime() + MERGE_DELAY)})
                           on conflict (business_id, kind, ref) do nothing returning id`;
    return r[0] ? r[0].id : null;
  }

  if (kind === 'shipment_coming') {
    if (!ref) return null;
    const lines = await ctx.tx`select sku, product, qty, ordered_at from po_lines where business_id = ${ctx.biz} and po_no = ${ref} order by id`;
    if (!lines.length) return null;
    const st = (await ctx.tx`select eta from po_stages where business_id = ${ctx.biz} and po_no = ${ref}`)[0];
    const etaIn = /^\d{4}-\d{2}-\d{2}$/.test(str(f.eta)) ? str(f.eta) : (st && st.eta ? ymd(st.eta) : '');
    const ordered = lines[0].ordered_at ? new Date(lines[0].ordered_at) : now;
    let due = etaIn ? new Date(new Date(etaIn + 'T06:00:00Z').getTime() - COMING_BEFORE) : new Date(ordered.getTime() + COMING_NO_ETA);
    if (due < now) due = now;
    const have = (await ctx.tx`select id, state, payload from content_events where business_id = ${ctx.biz} and kind = 'shipment_coming' and ref = ${ref} for update`)[0];
    if (have) {
      if (have.state === 'waiting' && etaIn && etaIn !== str((have.payload || {}).eta)) {
        await ctx.tx`update content_events set due_at = ${due}, payload = ${ctx.tx.json({ ...(have.payload || {}), eta: etaIn })} where id = ${have.id}`;
      }
      return have.id;
    }
    if (f.update) return null;   // an ETA set on an order that had no event (from before the desk) makes none
    const facts = await productFacts(ctx, lines.map((l) => l.sku));
    const items = lines.slice(0, MAX_ITEMS).map((l) => { const x = facts[str(l.sku).toLowerCase()] || { sku: str(l.sku), name: str(l.product) }; return { ...x, qty: Math.round(num(l.qty)) }; });
    const r = await ctx.tx`insert into content_events (business_id, kind, ref, payload, due_at)
                           values (${ctx.biz}, 'shipment_coming', ${ref}, ${ctx.tx.json({ poId: ref, eta: etaIn, products: items, count: lines.length })}, ${due})
                           on conflict (business_id, kind, ref) do nothing returning id`;
    return r[0] ? r[0].id : null;
  }

  // shipment_arrived
  const lines = (Array.isArray(f.lines) ? f.lines : []).filter((l) => l && str(l.sku) && num(l.qty) > 0);
  if (!ref || !lines.length) return null;
  const facts = await productFacts(ctx, lines.map((l) => l.sku));
  const items = lines.slice(0, MAX_ITEMS).map((l) => ({ ...(facts[str(l.sku).toLowerCase()] || { sku: str(l.sku), name: str(l.sku) }), qty: Math.round(num(l.qty)) }));
  const r = await ctx.tx`insert into content_events (business_id, kind, ref, payload, due_at)
                         values (${ctx.biz}, 'shipment_arrived', ${ref}, ${ctx.tx.json({ poId: str(f.poId), reference: str(f.reference), products: items, count: lines.length })}, ${now})
                         on conflict (business_id, kind, ref) do nothing returning id`;
  // the order came before its "coming soon" post went out: that post is no longer true
  if (str(f.poId)) await ctx.tx`update content_events set state = 'skipped', error = 'the shipment arrived first' where business_id = ${ctx.biz}
                                and kind = 'shipment_coming' and ref = ${str(f.poId)} and state in ('waiting', 'failed')`;
  return r[0] ? r[0].id : null;
}

// ------------------------------------------------------------------ the words sent to the engine (facts only)
const tk = (n) => '৳' + Math.round(num(n)).toLocaleString('en-US');
function itemLine(p, qtyWord) {
  const bits = [];
  if (p.brand && !str(p.name).toLowerCase().includes(str(p.brand).toLowerCase())) bits.push('ব্র্যান্ড ' + p.brand);
  if (p.sku) bits.push('SKU ' + p.sku);
  if (num(p.price) > 0) bits.push('দাম ' + tk(p.price));
  if (qtyWord && num(p.qty) > 0) bits.push(qtyWord + ' ' + Math.round(num(p.qty)) + 'টি');
  if (p.stock !== undefined && p.stock !== null) bits.push('এখন স্টকে ' + Math.max(0, Math.round(num(p.stock))) + 'টি');
  return '• ' + str(p.name) + (bits.length ? ' (' + bits.join(', ') + ')' : '');
}
export function eventText(ev) {
  const pl = ev.payload || {};
  const items = Array.isArray(pl.products) ? pl.products : [];
  const names = items.map((p) => str(p.name)).filter(Boolean);
  const more = Math.max(0, num(pl.count) - items.length);
  const head = ev.kind === 'new_product' ? 'নতুন এসেছে: ' + names.join(', ')
    : ev.kind === 'shipment_coming' ? 'শিপমেন্ট আসছে: ' + names.join(', ') + (pl.eta ? '। সম্ভাব্য পৌঁছানোর দিন ' + pl.eta : '')
    : 'শিপমেন্ট চলে এসেছে: ' + names.join(', ');
  const lines = items.map((p) => itemLine(p, ev.kind === 'shipment_coming' ? 'আসছে' : ev.kind === 'shipment_arrived' ? 'এসেছে' : ''));
  if (more) lines.push('• আরও ' + more + 'টি প্রোডাক্ট');
  return [head + '।', ...lines, '', 'শুধু উপরের তথ্য ব্যবহার করুন; দাম, স্টক বা তারিখ নিজে থেকে বানাবেন না।'].join('\n');
}

// ------------------------------------------------------------------ the bridge (the business's own engine on the Mac)
async function bridgeState(ctx) {
  let s = {}; try { s = JSON.parse(str(await getConfig(ctx, 'brand_bridge', '')) || '{}'); } catch (_) { s = {}; }
  const seen = s.seen ? new Date(s.seen) : null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  return { url: str(s.url), seen, online: !!(seen && now - seen < ONLINE_MS) };
}
async function bridgePost(ctx, st, key, path, body) {
  const f = (ctx.deps && ctx.deps.fetch) || fetch;
  let r;
  try {
    r = await f(st.url + path, { method: 'POST', headers: { 'X-Bridge-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(BRIDGE_MS) });
  } catch (_) { throw new Error('Mac সাড়া দিল না।'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Mac চাবিটা নিল না।');
  if (!r.ok) throw new Error(str(j.error) || ('Mac থেকে ভুল উত্তর এল (' + r.status + ')।'));
  return j;
}

/** The minute timer for one business. */
export async function contentTick(ctx) {
  if (!(await bizOn(ctx))) return { skipped: 'the Content desk is not open for this business' };
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const due = await ctx.tx`select * from content_events where business_id = ${ctx.biz} and due_at <= ${now}
                           and (state = 'waiting' or (state = 'failed' and tries < ${MAX_TRIES}))
                           order by due_at, id limit 5 for update skip locked`;
  if (!due.length) return { sent: 0 };
  const st = await bridgeState(ctx), key = await getSecret(ctx, 'BRAND_BRIDGE_KEY');
  if (!key || !st.url || !st.online) return { sent: 0, waiting: due.length, offline: true };   // not a failure: next minute
  let sent = 0, failed = 0;
  for (const ev of due) {
    // price and stock as they are NOW (a product made on Receive had 0 in stock when the event was written)
    try { await ctx.tx.savepoint(async () => {
      const pl = ev.payload || {}, items = Array.isArray(pl.products) ? pl.products : [];
      const fresh = await productFacts(ctx, items.map((p) => p.sku));
      ev.payload = { ...pl, products: items.map((p) => { const x = fresh[str(p.sku).toLowerCase()]; return x ? { ...p, name: x.name, brand: x.brand, price: x.price, stock: x.stock } : p; }) };
      await ctx.tx`update content_events set payload = ${ctx.tx.json(ev.payload)} where id = ${ev.id}`;
    }); } catch (_) { /* the facts written at the time stand */ }
    const body = { text: eventText(ev), topic: TOPIC[ev.kind], platforms: PLATFORMS, video: true,
                   event: { id: Number(ev.id), kind: ev.kind, ref: ev.ref } };
    try {
      const j = await bridgePost(ctx, st, key, '/drafts/make', body);
      const idea = Number.isFinite(Number(j.idea_id)) && j.idea_id !== null && j.idea_id !== '' ? Math.round(Number(j.idea_id)) : null;
      await ctx.tx`update content_events set state = 'sent', sent_at = ${now}, tries = tries + 1, error = null,
                   bridge_job = ${str(j.job).slice(0, 120) || null}, idea_id = ${idea} where id = ${ev.id}`;
      sent++;
    } catch (e) {
      await ctx.tx`update content_events set state = 'failed', tries = tries + 1, error = ${String((e && e.message) || e).slice(0, 300)},
                   due_at = ${new Date(now.getTime() + RETRY)} where id = ${ev.id}`;
      failed++;
    }
  }
  return { sent, failed };
}

// ------------------------------------------------------------------ the handlers' list
async function handlersOf(ctx) {
  try { const v = JSON.parse(str(await getConfig(ctx, 'content_handlers', '')) || '[]'); return Array.isArray(v) ? v.filter((h) => h && h.phone) : []; } catch (_) { return []; }
}
export async function erpContentHandlersSave(ctx, payload) {
  await gate(ctx, 'manager');
  const list = payload && Array.isArray(payload.handlers) ? payload.handlers : null;
  if (!list) throw new Error('কার কাছে ভিডিও যাবে, তাদের নাম আর নম্বর দিন।');
  if (list.length > 10) throw new Error('সর্বোচ্চ ১০ জন রাখা যায়।');
  const out = [], seen = new Set();
  for (const h of list) {
    const name = str(h && h.name).replace(/\s+/g, ' ');
    if (!name) throw new Error('প্রত্যেকের একটা নাম দিন।');
    if (name.length > 60) throw new Error('নামটা ৬০ অক্ষরের মধ্যে রাখুন।');
    let phone;
    try { phone = phone11(h && h.phone); } catch (_) { throw new Error(name + '-এর নম্বরটা ঠিক নেই। ০১ দিয়ে শুরু ১১ সংখ্যার মোবাইল নম্বর দিন।'); }
    if (!phone) throw new Error(name + '-এর মোবাইল নম্বর দিন।');
    if (seen.has(phone)) throw new Error(phone + ' নম্বরটা দুবার দেওয়া হয়েছে।');
    seen.add(phone);
    out.push({ name, phone });
  }
  await setConfig(ctx, 'content_handlers', JSON.stringify(out));
  return { handlers: out };
}

// ------------------------------------------------------------------ reads
const evOut = (r) => ({ id: Number(r.id), kind: r.kind, ref: r.ref, payload: r.payload || {}, dueAt: iso(r.due_at), state: r.state, tries: r.tries,
                        sentAt: iso(r.sent_at), error: str(r.error), job: str(r.bridge_job), ideaId: r.idea_id == null ? null : Number(r.idea_id), createdAt: iso(r.created_at) });
const vidOut = (r) => ({ id: Number(r.id), draftId: r.draft_id == null ? null : Number(r.draft_id), title: str(r.title), platform: str(r.platform), path: str(r.file_path),
                         bytes: r.bytes == null ? null : Number(r.bytes), madeBy: str(r.made_by), createdAt: iso(r.created_at), sent: Array.isArray(r.sent) ? r.sent : [] });
export async function erpContentDesk(ctx) {
  await gate(ctx, 'sales');
  const st = await bridgeState(ctx);
  const events = (await ctx.tx`select * from content_events where business_id = ${ctx.biz} order by created_at desc, id desc limit 60`).map(evOut);
  const videos = (await ctx.tx`select * from content_videos where business_id = ${ctx.biz} and not hidden order by created_at desc, id desc limit 60`).map(vidOut);
  const wa = await waChannels(ctx);
  return { online: st.online, seen: st.seen ? st.seen.toISOString() : null, bridge: !!st.url, events, videos,
           handlers: await handlersOf(ctx), whatsapp: wa.length > 0, owner: roleAtLeast(ctx.s.role, 'owner'), maxBytes: MAX_VIDEO,
           canAct: roleAtLeast(ctx.s.role, 'manager'), role: str(ctx.s.role) };
}
async function videoRow(ctx, id) {
  const n = parseInt(id, 10);
  if (!(n > 0)) throw new Error('কোন ভিডিও? একটা বাছুন।');
  const v = (await ctx.tx`select * from content_videos where business_id = ${ctx.biz} and id = ${n}`)[0];
  if (!v) throw new Error('ভিডিওটা আর এখানে নেই। পেজটা নতুন করে আনুন।');
  return v;
}
async function signedUrl(ctx, path, secs) {
  const s = ctx.deps && ctx.deps.storage;
  if (!s || !s.url) throw new Error('এই সার্ভারে ফাইল রাখার ব্যবস্থা নেই।');
  const name = str(path).replace(/^content\//, '');
  const url = await s.url(ctx.biz, 'content', name, secs);
  if (!url) throw new Error('ভিডিওর লিংক বানানো গেল না। একটু পরে আবার চেষ্টা করুন।');
  return url;
}
export async function erpContentVideoUrl(ctx, payload) {
  await gate(ctx, 'sales');
  const v = await videoRow(ctx, payload && payload.id);
  return { id: Number(v.id), url: await signedUrl(ctx, v.file_path, 3600), expiresIn: 3600 };
}

// ------------------------------------------------------------------ videos in (from the studio)
export async function erpContentVideoUploadUrl(ctx, payload) {
  await gate(ctx, 'owner');
  const bytes = num(payload && payload.bytes);
  if (bytes > MAX_VIDEO) throw new Error('ভিডিওটা ৮০ MB-এর বেশি। ছোট করে (কমপ্রেস করে) আবার দিন।');
  const s = ctx.deps && ctx.deps.storage;
  if (!s || !s.signUpload) throw new Error('এই সার্ভারে ফাইল রাখার ব্যবস্থা নেই।');
  const name = crypto.randomUUID() + '.mp4';
  const up = await s.signUpload(ctx.biz, 'content', name);
  return { url: up.url, token: up.token, path: 'content/' + name, maxBytes: MAX_VIDEO, contentType: 'video/mp4' };
}
export async function erpContentVideoSave(ctx, payload) {
  await gate(ctx, 'owner');
  const p = payload || {};
  const path = str(p.path);
  if (!PATH_RE.test(path)) throw new Error('ভিডিওর ঠিকানাটা চেনা নেই। আগে আপলোডের ঠিকানা নিন, তারপর ফাইলটা দিন।');
  const bytes = Math.round(num(p.bytes));
  if (!(bytes > 0)) throw new Error('ভিডিওর আকার (bytes) দিন।');
  if (bytes > MAX_VIDEO) throw new Error('ভিডিওটা ৮০ MB-এর বেশি। ছোট করে (কমপ্রেস করে) আবার দিন।');
  const platform = str(p.platform).toLowerCase();
  if (platform && !PLATFORMS.includes(platform)) throw new Error('এই নেটওয়ার্ক চেনা নেই (facebook, instagram, tiktok, youtube)।');
  const draft = p.draftId == null || p.draftId === '' ? null : parseInt(p.draftId, 10);
  if (draft !== null && !(draft > 0)) throw new Error('ড্রাফটের নম্বরটা ঠিক নেই।');
  const title = str(p.title).slice(0, 200) || 'ভিডিও';
  const r = await ctx.tx`insert into content_videos (business_id, draft_id, title, platform, file_path, bytes, made_by)
                         values (${ctx.biz}, ${draft}, ${title}, ${platform}, ${path}, ${bytes}, ${str(p.madeBy).slice(0, 60) || str(ctx.s.name) || null})
                         on conflict (business_id, file_path) do update set title = excluded.title, platform = excluded.platform, bytes = excluded.bytes,
                           draft_id = coalesce(excluded.draft_id, content_videos.draft_id)
                         returning *`;
  return { video: vidOut(r[0]) };
}

// The business video studio (owner's PC/Mac) names the business in the call and proves itself with THAT business's
// content-engine key (BRAND_BRIDGE_KEY), like erpBrandDeskHello: the owner's key keeps its own active business, so the
// personal Brand desk is never switched (owner 19 Nov 2026: zero loss for the personal setup).
async function studioCtx(ctx, p) {
  if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner\'s studio uploads videos.');
  const biz = str(p && p.biz);
  const mine = await ctx.tx`select 1 from public.my_business_ids('owner') b(id) where b.id::text = ${biz}`;
  if (!mine.length) throw new Error('That business is not yours.');
  const c2 = { ...ctx, biz, memo: {} };   // own memo: the app flag of THIS business, not the active one
  const key = await getSecret(c2, 'BRAND_BRIDGE_KEY');
  if (!key || str(p.key) !== key) throw new Error('Wrong content engine key.');
  return c2;
}
export async function erpContentStudioUploadUrl(ctx, payload) {
  const c2 = await studioCtx(ctx, payload);
  return erpContentVideoUploadUrl(c2, payload);
}
export async function erpContentStudioSave(ctx, payload) {
  const c2 = await studioCtx(ctx, payload);
  return erpContentVideoSave(c2, { ...(payload || {}), madeBy: str(payload && payload.madeBy) || 'studio' });
}

// ------------------------------------------------------------------ videos out (the business's own WhatsApp)
async function waChannels(ctx) {
  try {
    const chs = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind in ('wa_evo', 'wa_cloud', 'wa_sender') and status <> 'removed'
                             order by (status = 'live') desc, created_at, id`;
    // the chat number first (mgr-quiet-1: the manager's own number is not the business's voice)
    const chat = (c) => str((c.settings || {}).purpose || 'chat') === 'chat';
    return chs.filter(chat).concat(chs.filter((c) => !chat(c)));
  } catch (_) { return []; }
}
export async function erpContentVideoSend(ctx, payload) {
  await gate(ctx, 'manager');
  const v = await videoRow(ctx, payload && payload.id);
  let want;
  try { want = phone11(payload && payload.phone); } catch (_) { want = ''; }
  const h = (await handlersOf(ctx)).find((x) => str(x.phone) === want);
  if (!h) throw new Error('এই নম্বরটা পেজ চালানো লোকদের তালিকায় নেই। আগে তালিকায় যোগ করুন।');
  const chs = await waChannels(ctx);
  if (!chs.length) throw new Error('এই ব্যবসার নিজের কোনো WhatsApp নম্বর ERP-তে যুক্ত নেই। আগে Inbox-এ ব্যবসার WhatsApp যুক্ত করুন।');
  const url = await signedUrl(ctx, v.file_path, 3600);
  const { sendOut } = await import('./inboxch.js');
  const to = '880' + h.phone.slice(1);
  const caption = str(v.title) + (v.platform ? ' (' + v.platform + ')' : '');
  let last = '';
  for (const ch of chs) {
    let r;
    try { r = await sendOut(ctx, ch, { external_id: to }, { kind: 'video', url, mime: 'video/mp4', fileName: 'video-' + v.id + '.mp4', caption }); }
    catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (r && r.ok) {
      const entry = { name: h.name, phone: h.phone, at: new Date().toISOString(), by: str(ctx.s.name), via: str(ch.name) };
      await ctx.tx`update content_videos set sent = coalesce(sent, '[]'::jsonb) || ${ctx.tx.json([entry])} where id = ${v.id}`;
      return { ok: true, sent: entry };
    }
    last = str(r && r.error);
  }
  throw new Error(h.name + '-কে WhatsApp-এ পাঠানো গেল না' + (last ? ' (' + last.slice(0, 120) + ')' : '') + '। একটু পরে আবার চেষ্টা করুন।');
}

// ------------------------------------------------------------------ channels-1 (owner 21 Nov 2026): the Channels tab
// Each business posts through ITS OWN Postiz workspace and its own posting line (the pacer next to its content engine on
// the Mac). The ERP only talks to THIS business's engine (its brand_bridge + BRAND_BRIDGE_KEY), so one business can never
// see or touch another's channels. Posting itself is the owner's approve on a draft (erpBrandDeskDraftDecide).
//   erpContentChannels()                      channels + status, posting rules, today's line (everyone in the business;
//                                             the writes below are manager and up - owner 21 Nov 2026)
//   erpContentRulesSave({gap, caps, hold})    gap between two posts on one network (min), daily max per network, one
//                                             channel on a break ({hold: {id, on}}: its posts wait, the others go on)
//   erpContentStop({on})                      the emergency stop: true = nothing goes out, false = the line runs again
//   erpContentCancel({id})                    a waiting post leaves the line before it goes
//   erpContentConnect({platform, refresh?})   Postiz's connect page for this business's workspace (the owner logs in)
const LINE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAP_MAX = { facebook: 50, instagram: 25, tiktok: 15, youtube: 6 };
async function engine(ctx, path, body) {
  const st = await bridgeState(ctx), key = await getSecret(ctx, 'BRAND_BRIDGE_KEY');
  if (!key || !st.url) throw new Error('এই ব্যবসার কনটেন্ট ইঞ্জিন যুক্ত নেই।');
  return bridgePost(ctx, st, key, path, body || {});
}
const chOut = (c) => ({ id: str(c.id), name: str(c.name), platform: str(c.platform), picture: str(c.picture), profile: str(c.profile),
                        status: ['ok', 'reconnect', 'off'].includes(c.status) ? c.status : 'ok', error: str(c.error).slice(0, 200), sentToday: Math.round(num(c.sentToday)), held: !!c.held });
const lineOut = (x) => ({ id: str(x.id), platform: str(x.platform), integration: str(x.integration), at: str(x.at), state: str(x.state), sentAt: str(x.sentAt),
                          link: /^https:\/\//i.test(str(x.link)) ? str(x.link) : '', head: str(x.head).slice(0, 90), error: str(x.error).slice(0, 200), urgent: !!x.urgent });
function capsIn(v) {
  const out = {};
  for (const k of PLATFORMS) if (v && v[k] !== undefined && v[k] !== null && v[k] !== '') out[k] = Math.round(num(v[k]));
  return out;
}
export async function erpContentChannels(ctx) {
  await gate(ctx, 'sales');
  const st = await bridgeState(ctx);
  const base = { online: st.online, bridge: !!st.url, pacer: false, workspace: false, paused: false, gap: 20, caps: {}, hardCaps: CAP_MAX, channels: [], line: [], error: '' };
  if (!st.url) return { ...base, error: 'এই ব্যবসার কনটেন্ট ইঞ্জিন যুক্ত নেই।' };
  let r;
  try { r = await engine(ctx, '/biz/state', {}); } catch (e) { return { ...base, error: String((e && e.message) || e) }; }
  return { ...base, pacer: r.pacer !== false, workspace: !!r.workspace, paused: !!r.paused, gap: Math.round(num(r.gap)) || 20, caps: capsIn(r.caps),
           channels: (Array.isArray(r.channels) ? r.channels : []).map(chOut).filter((c) => PLATFORMS.includes(c.platform)),
           line: (Array.isArray(r.line) ? r.line : []).map(lineOut), error: str(r.error) };
}
export async function erpContentRulesSave(ctx, payload) {
  await gate(ctx, 'manager');
  const p = payload || {}, body = {};
  if (p.gap !== undefined) {
    const g = Math.round(num(p.gap));
    if (!(g >= 5 && g <= 240)) throw new Error('দুই পোস্টের মাঝে ফাঁক ৫ থেকে ২৪০ মিনিটের মধ্যে দিন।');
    body.gap = g;
  }
  if (p.caps !== undefined) {
    for (const k of Object.keys(p.caps || {})) if (!PLATFORMS.includes(k)) throw new Error('এই নেটওয়ার্ক চেনা নেই: ' + k);
    const caps = capsIn(p.caps);
    for (const [k, v] of Object.entries(caps)) if (!(v >= 0 && v <= CAP_MAX[k])) throw new Error(k + '-এ দিনে ০ থেকে ' + CAP_MAX[k] + '-টা পোস্ট রাখা যায়।');
    body.caps = caps;
  }
  if (p.hold !== undefined) {
    const hid = str(p.hold && p.hold.id);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(hid)) throw new Error('কোন চ্যানেলে বিরতি দেবেন? একটা বাছুন।');
    body.hold = { id: hid, on: !!(p.hold && p.hold.on) };
  }
  if (!Object.keys(body).length) throw new Error('কী বদলাবেন? ফাঁক বা দিনে সর্বোচ্চ পোস্ট দিন।');
  const r = await engine(ctx, '/biz/rules', body);
  return { gap: Math.round(num(r.gap)), caps: capsIn(r.caps), paused: !!r.paused, held: Array.isArray(r.held) ? r.held.map(str) : [] };
}
export async function erpContentStop(ctx, payload) {
  await gate(ctx, 'manager');
  const on = !!(payload && payload.on);
  const r = await engine(ctx, '/biz/rules', { paused: on });
  return { paused: !!r.paused };
}
export async function erpContentCancel(ctx, payload) {
  await gate(ctx, 'manager');
  const id = str(payload && payload.id);
  if (!LINE_ID.test(id)) throw new Error('কোন পোস্টটা বাতিল করবেন? একটা বাছুন।');
  await engine(ctx, '/biz/cancel', { id });
  return { ok: true, id };
}
export async function erpContentConnect(ctx, payload) {
  await gate(ctx, 'manager');
  const platform = str(payload && payload.platform).toLowerCase();
  if (!PLATFORMS.includes(platform)) throw new Error('কোন নেটওয়ার্ক যুক্ত করবেন? (Facebook, Instagram, TikTok, YouTube)');
  const refresh = str(payload && payload.refresh);
  if (refresh && !/^[A-Za-z0-9_-]{6,64}$/.test(refresh)) throw new Error('এই চ্যানেলটা চেনা নেই।');
  const r = await engine(ctx, '/biz/connect', refresh ? { platform, refresh } : { platform });
  const url = str(r && r.url);
  if (!/^https:\/\//i.test(url)) throw new Error('Postiz যুক্ত করার লিংক দিল না। একটু পরে আবার চেষ্টা করুন।');
  return { url };
}

// ------------------------------------------------------------------ desk-open-1 (owner 21 Nov 2026): the business runs its own desk
// "Whoever runs Oliareen and Costareen (managers, partners, the others) sees and controls all of this, and THEY approve;
// I approve only my Brand desk." So the business desk has its own doors, NOT the owner-only erpBrandDesk* ones:
//   erpContentDrafts()            the drafts waiting in this business's engine (everyone in the business)
//   erpContentSeries()            the 60-day plan (everyone)
//   erpContentPosts()             this business's own Postiz workspace: scheduled / posted / failed posts (everyone)
//   erpContentDraftDecide({id, action: approve|reject, networks, at?})   manager and up; written to the activity log
// The personal Brand desk (business_kind 'brand') never answers here: it stays owner-only through erpBrandDesk*.
async function notBrand(ctx) {
  const k = str(await getConfig(ctx, 'business_kind', ''));
  if (k === 'brand') throw new Error('এটা মালিকের নিজের ব্র্যান্ড ডেস্ক; এখানে খোলে না।');
}
async function engineGet(ctx, path) {
  const st = await bridgeState(ctx), key = await getSecret(ctx, 'BRAND_BRIDGE_KEY');
  if (!key || !st.url) throw new Error('এই ব্যবসার কনটেন্ট ইঞ্জিন যুক্ত নেই।');
  const f = (ctx.deps && ctx.deps.fetch) || fetch;
  let r;
  try { r = await f(st.url + path, { method: 'GET', headers: { 'X-Bridge-Key': key }, signal: AbortSignal.timeout(40000) }); } catch (_) { throw new Error('Mac সাড়া দিল না।'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Mac চাবিটা নিল না।');
  if (!r.ok) throw new Error(str(j.error) || ('Mac থেকে ভুল উত্তর এল (' + r.status + ')।'));
  return j;
}
export async function erpContentDrafts(ctx) {
  await gate(ctx, 'sales'); await notBrand(ctx);
  const j = await engineGet(ctx, '/drafts');
  return { waiting: Array.isArray(j.waiting) ? j.waiting : [], canAct: roleAtLeast(ctx.s.role, 'manager') };
}
export async function erpContentSeries(ctx) {
  await gate(ctx, 'sales'); await notBrand(ctx);
  return engine(ctx, '/series', {});
}
const postOut = (x) => ({ id: str(x.id), platform: str(x.platform), channel: str(x.channel).slice(0, 120), at: str(x.at), state: str(x.state).toUpperCase().slice(0, 20),
                          link: /^https:\/\//i.test(str(x.link)) ? str(x.link) : '', head: str(x.head).slice(0, 160), error: str(x.error).slice(0, 200) });
export async function erpContentPosts(ctx) {
  await gate(ctx, 'sales'); await notBrand(ctx);
  const r = await engine(ctx, '/biz/posts', {});
  return { workspace: !!r.workspace, posts: (Array.isArray(r.posts) ? r.posts : []).map(postOut).filter((x) => PLATFORMS.includes(x.platform)).slice(0, 300) };
}
export async function erpContentDraftDecide(ctx, payload) {
  await gate(ctx, 'manager'); await notBrand(ctx);
  const p = payload || {}, id = parseInt(p.id, 10), action = str(p.action);
  if (!(id > 0)) throw new Error('একটা ড্রাফট বাছুন।');
  if (!['approve', 'reject', 'undo'].includes(action)) throw new Error('অনুমোদন দিন বা বাদ দিন।');
  if (action === 'reject') return engine(ctx, '/drafts/decide', { id, action, note: (str(p.note) || 'content desk').slice(0, 500) });
  if (action === 'undo') return engine(ctx, '/drafts/decide', { id, action });   // undo-1: a reject taken back within a minute
  const nets = Array.isArray(p.networks) ? p.networks.filter((n) => n && str(n.id) && str(n.platform)).map((n) => ({ id: str(n.id).slice(0, 64), platform: str(n.platform).toLowerCase().slice(0, 30) })) : [];
  if (!nets.length) throw new Error('কোথায় যাবে, বাছুন।');
  if (nets.length > 8) throw new Error('একবারে ৮টার বেশি চ্যানেলে দেওয়া যায় না।');
  const handler = nets.every((n) => n.id === 'page-handler');
  if (!handler && nets.some((n) => n.id === 'page-handler')) throw new Error('পেজ চালানো লোকের জন্য "তৈরি" আর চ্যানেলে পোস্ট একসাথে হয় না।');
  if (!handler && nets.some((n) => !PLATFORMS.includes(n.platform) || !/^[A-Za-z0-9_-]{6,64}$/.test(n.id))) throw new Error('এই চ্যানেলটা চেনা নেই।');
  let at = null;
  if (p.at) {
    const d = new Date(p.at);
    if (isNaN(d)) throw new Error('সময়টা ঠিক নেই। আবার বাছুন।');
    if (d.getTime() > Date.now() + 60 * DAY) throw new Error('৬০ দিনের বেশি পরের সময় দেওয়া যায় না।');
    at = d.toISOString();
  }
  const out = { id, action, networks: nets, at };
  const text = str(p.body);
  if (text) { if (text.length > 63000) throw new Error('পোস্টটা অনেক লম্বা। ছোট করুন।'); out.body = text; }
  if (p.force === true) {   // force-1: only the owner sends a text past the claim check
    if (ctx.s.role !== 'owner') throw new Error('আটকানো লেখা শুধু মালিক পাঠাতে পারেন।');
    out.force = true;
  }
  return engine(ctx, '/drafts/decide', out);
}

// autofix-2 (owner 21 Nov 2026: the Brand desk's one-tap "AI দিয়ে ঠিক করুন", also on the business desks). {id} starts a
// fix in this business's own engine (its own drafts, its own AI; nothing crosses brands); {job} reads how it is going.
export async function erpContentDraftAutofix(ctx, payload) {
  await gate(ctx, 'manager'); await notBrand(ctx);
  const p = payload || {};
  if (p.job) return engine(ctx, '/drafts/autofix/job', { job: str(p.job).slice(0, 40) });
  const id = parseInt(p.id, 10);
  if (!(id > 0)) throw new Error('একটা ড্রাফট বাছুন।');
  return engine(ctx, '/drafts/autofix', { id });
}

// ------------------------------------------------------------------ sched-1 (owner 21 Nov 2026): "what goes out when", per business
// "My Brand desk shows what goes out when (on Home and a few other places). Build the same for Costareen and Oliareen."
// One read for this business only, from its own engine: the posting line (pacer: waiting / late / failed), its own Postiz
// workspace (published / failed / queued) and the drafts still waiting for approval at their routine slot. Each source
// may fail on its own; the others still show. Items: {key, src: line|postiz|draft, platform, at, state: wait|next|gone|
// stuck, head, link, id, error}. Everyone in the business reads it (the Dashboard card and the Content desk).
const SCHED_STATE = { waiting: 'next', ask: 'stuck', failed: 'stuck' };
// seen-1: a sent post's whole text and its pictures/video, kept by this business's post line for 7 days
export async function erpContentPostView(ctx, payload) {
  await gate(ctx, 'sales'); await notBrand(ctx);
  const id = str(payload && payload.id);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) throw new Error('পোস্টটা চেনা গেল না।');
  return engine(ctx, '/post/view', { id });
}

export async function erpContentSchedule(ctx) {
  await gate(ctx, 'sales'); await notBrand(ctx);
  const st = await bridgeState(ctx);
  const out = { online: st.online, bridge: !!st.url, workspace: null, paused: false, items: [], errors: [], canAct: roleAtLeast(ctx.s.role, 'manager') };
  if (!st.url) return out;
  const [ln, pz, dr] = await Promise.allSettled([engine(ctx, '/biz/state', {}), engine(ctx, '/biz/posts', {}), engineGet(ctx, '/drafts')]);
  const items = [];
  if (ln.status === 'fulfilled') {
    out.workspace = !!ln.value.workspace; out.paused = !!ln.value.paused;
    for (const x of Array.isArray(ln.value.line) ? ln.value.line : []) {
      const state = SCHED_STATE[str(x.state)];
      if (!state) continue;   // sent: its Postiz post shows (with the link); cancelled: gone from the plan
      const o = lineOut(x);
      items.push({ key: 'l' + o.id, src: 'line', id: o.id, platform: o.platform, at: o.at, state, head: o.head, link: '', error: o.error, late: str(x.state) === 'ask' });
    }
  } else out.errors.push('line: ' + String(ln.reason && ln.reason.message || ln.reason).slice(0, 160));
  if (pz.status === 'fulfilled') {
    if (out.workspace === null) out.workspace = !!pz.value.workspace;
    for (const x of Array.isArray(pz.value.posts) ? pz.value.posts : []) {
      const o = postOut(x);
      if (!PLATFORMS.includes(o.platform)) continue;
      const state = o.state === 'PUBLISHED' ? 'gone' : o.state === 'ERROR' ? 'stuck' : 'next';
      items.push({ key: 'p' + o.id, src: 'postiz', id: o.id, platform: o.platform, at: o.at, state, head: o.head, link: o.link, error: o.error });
    }
  } else out.errors.push('postiz: ' + String(pz.reason && pz.reason.message || pz.reason).slice(0, 160));
  if (dr.status === 'fulfilled') {
    for (const d of Array.isArray(dr.value.waiting) ? dr.value.waiting : []) {
      if (!d || !d.planned_at) continue;
      const t = new Date(d.planned_at); if (isNaN(t)) continue;
      items.push({ key: 'd' + d.id, src: 'draft', id: String(d.id), platform: str(d.platform).toLowerCase(), at: t.toISOString(), state: 'wait',
                   head: str(d.title_working || String(d.body || '').split('\n')[0]).slice(0, 160), link: '', error: '' });
    }
  } else out.errors.push('drafts: ' + String(dr.reason && dr.reason.message || dr.reason).slice(0, 160));
  out.items = items.filter((x) => x.at && !isNaN(new Date(x.at))).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(0, 400);
  return out;
}

export const HANDLERS = { erpContentDesk, erpContentVideoUrl, erpContentHandlersSave, erpContentVideoUploadUrl, erpContentVideoSave, erpContentVideoSend,
  erpContentStudioUploadUrl, erpContentStudioSave, erpContentChannels, erpContentRulesSave, erpContentStop, erpContentCancel, erpContentConnect,
  erpContentDrafts, erpContentSeries, erpContentPosts, erpContentDraftDecide, erpContentSchedule, erpContentDraftAutofix, erpContentPostView };
