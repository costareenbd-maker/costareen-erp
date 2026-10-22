// brief-1: what an approved move does. Every type runs the ERP's own functions as the owner (the same checks and the
// same activity log as on the screens), after checking the payload again against the live data and the limits.
//   ad          a Facebook post with the ad text, published, then an ad from it (made paused, then started) - total
//               spend (daily budget x days) within the owner's cap
//   post        a post on the business's pages (now, or at a time)
//   reorder     a PLANNED supplier order (no payment recorded)
//   price       a new selling price for one product (all its other fields kept; a cut within the discount limit)
//   followup    follow-up calls for customers on a day
//   whatsapp    a WhatsApp message to known customers / leads (only numbers the ERP already has), spread out
//   task        work for the Engine (research, writing, a plan) - its answer comes back in the Command Center
//   erp         watch-2: a fix made of the ERP's own functions (e.g. correct a cost, re-run a sync), run in order as the
//               owner, all or nothing; never deletes, users, keys, connections, platform or the AI's own settings
// Each type: name, what (for the Engine), payload (its shape), check(payload, {cap}) -> error text or '', run.

import { num, formatDate } from '../lib/time.js';
import { getConfig } from '../lib/ext.js';
import { callAllowed } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
const R = (v) => Math.round(num(v));
const money = (n) => '৳' + R(n).toLocaleString('en-US');
async function H(name, ctx, payload) { const h = (await import('./index.js')).HANDLERS[name]; return h(ctx, payload); }
export async function adCapOf(ctx) { const v = num(await getConfig(ctx, 'brief_ad_cap', '')); return v > 0 ? v : 3000; }
async function maxCut(ctx) { const v = num(await getConfig(ctx, 'brief_max_cut', '')); return v > 0 ? v : 10; }   // percent

// functions a fix may never call, even with the owner's Yes (deleting, people and access, keys and connections, the
// platform, restoring backups, the AI's own switches)
const NEVER = /^erp(\w*(Delete|Remove|Erase|Void|Reset|Restore|Wipe|Logout|Disconnect)\w*|Platform\w*|User\w*|Session\w*|SignOut\w*|Owner\w*|Recovery|Emergency\w*|AiBrainKey|ProviderKey|AiKey\w*|Install\w*|MyUpdate\w*|Google\w*|Meta\w*|Business\w*|Access\w*|Engine\w*|Skill\w*|Brain\w*|Brief\w*|Watch\w*|Pixel\w*|ShopKey|WebsiteSet|Courier\w*Key\w*|Import|Assistant|Sheet\w*)$/;
export const fixAllowed = (name) => /^erp[A-Z][A-Za-z0-9]{2,60}$/.test(str(name)) && !NEVER.test(str(name));

export const ACTION_TYPES = {
  erp: { name: 'Fix in the ERP', auto: true, what: 'a fix made of the ERP\'s own functions, run in order (all or nothing) - e.g. correct a cost, re-run a sync, close a wrong order',
    payload: '{steps: [{name: "erpFunctionName", args: {...}, summary: "what this step does, in plain words"}] (1-10)}',
    check: (p) => (!Array.isArray(p.steps) || !p.steps.length || p.steps.length > 10 ? 'A fix needs 1 to 10 steps.' : p.steps.some((x) => !fixAllowed(x && x.name) || !str(x && x.summary)) ? 'Each step needs an allowed ERP function and a plain summary (no deleting, users, keys or connections).' : '') },
  ad: { name: 'Facebook ad', auto: true, what: 'publish a Facebook post with this text and run a paid ad from it',
    payload: '{text, sku?, objective: messages|traffic|reach|sales, dailyBudget (taka), days, targeting?: {ageMin, ageMax, countries:[ISO2]}}',
    check: (p, o) => { if (str(p.text).length < 20) return 'The ad text is missing.'; if (!(num(p.dailyBudget) >= 50)) return 'Daily budget at least 50 taka.';
      const total = num(p.dailyBudget) * Math.max(1, R(p.days) || 7); return total > o.cap ? 'Total ad spend ' + money(total) + ' is over the limit of ' + money(o.cap) + '.' : ''; } },
  post: { name: 'Post', auto: true, what: 'publish a post on the business\'s Facebook page (text; now or at a time)', payload: '{text, sku?, at?: ISO time}',
    check: (p) => (str(p.text).length < 20 ? 'The post text is missing.' : '') },
  reorder: { name: 'Supplier order (planned)', auto: true, what: 'put a planned supplier order in the ERP (nothing is paid)', payload: '{lines: [{sku, qty}], supplier?, note?}',
    check: (p) => (!Array.isArray(p.lines) || !p.lines.length || p.lines.some((l) => !str(l.sku) || !(R(l.qty) > 0)) ? 'Each line needs a product code and a quantity.' : '') },
  price: { name: 'Price change', auto: true, what: 'change one product\'s selling price', payload: '{sku, newPrice, reason}',
    check: (p) => (!str(p.sku) || !(num(p.newPrice) > 0) ? 'Which product and what new price?' : '') },
  followup: { name: 'Follow-up calls', auto: true, what: 'put follow-up calls for customers on the list', payload: '{items: [{phone or name, due: YYYY-MM-DD, note}]} (up to 30)',
    check: (p) => (!Array.isArray(p.items) || !p.items.length || p.items.some((i) => !(str(i.phone) || str(i.name)) || !/^\d{4}-\d{2}-\d{2}$/.test(str(i.due)) || !str(i.note)) ? 'Each follow-up needs a phone or name, a day and a note.' : '') },
  whatsapp: { name: 'WhatsApp message', auto: true, what: 'send one WhatsApp message to known customers or leads (spread out over the day)', payload: '{text, recipients: [{phone, name}] (up to 200, only numbers that are in the ERP), name}',
    check: (p) => (str(p.text).length < 10 ? 'The message is missing.' : !Array.isArray(p.recipients) || !p.recipients.length ? 'Who gets it?' : p.recipients.length > 200 ? 'At most 200 people in one move.' : '') },
  task: { name: 'Work for the Engine', auto: true, what: 'a piece of work the Engine does next (research, writing, a plan, a list) - its answer comes back in the Command Center', payload: '{agent?: command|leads|ads|content|seo|watchdog, ask}',
    check: (p) => (str(p.ask).length < 10 ? 'Say what the Engine should do.' : '') },
};

/** Runs an approved move. Returns {ok, text}. */
export async function runAction(ctx, a, o) {
  const t = ACTION_TYPES[a.type];
  if (!t) return { ok: false, text: 'Unknown kind of move.' };
  const p = a.payload || {}, cap = await o.cap(ctx);
  const err = t.check(p, { cap });
  if (err) return { ok: false, text: err };

  if (a.type === 'post' || a.type === 'ad') {
    const saved = await H('erpSocialSave', ctx, { sku: str(p.sku) || undefined, title: str(a.title).slice(0, 120), captions: { facebook: str(p.text) }, targets: { facebook: true }, approved: true });
    const id = saved.post.id;
    if (a.type === 'post' && str(p.at)) { await H('erpSocialAct', ctx, { id, action: 'schedule', at: str(p.at) }); return { ok: true, text: 'Post scheduled for ' + formatDate(new Date(p.at), 'd MMM, h:mm a') + '.' }; }
    const pub = await H('erpSocialAct', ctx, { id, action: 'publish' });
    const row = (await ctx.tx`select results, state, error from social_posts where id = ${id}`)[0] || {};
    const fb = (row.results || {}).facebook || {};
    if (!fb.id) return { ok: false, text: 'The post could not be published: ' + (str(fb.error) || str(row.error) || str(pub && pub.error) || 'no answer from Facebook') + '.' };
    if (a.type === 'post') return { ok: true, text: 'Posted on Facebook.' };
    const days = Math.min(60, Math.max(1, R(p.days) || 7));
    const plan = await H('erpAdsPlan', ctx, { postId: id, objective: ['messages', 'traffic', 'reach', 'sales'].includes(str(p.objective)) ? str(p.objective) : 'messages', dailyBudget: R(p.dailyBudget), days,
      name: str(a.title).slice(0, 100), targeting: p.targeting && typeof p.targeting === 'object' ? p.targeting : undefined });
    const adId = str(plan && plan.campaign && plan.campaign.id);
    if (!adId) return { ok: false, text: 'Posted, but the ad could not be made.' };
    await H('erpAdsAct', ctx, { id: adId, action: 'start' });
    return { ok: true, text: 'Posted and the ad is running: ' + money(p.dailyBudget) + ' a day for ' + days + ' days (' + money(num(p.dailyBudget) * days) + ' in all).' };
  }
  if (a.type === 'reorder') {
    const lines = p.lines.slice(0, 40).map((l) => ({ sku: str(l.sku), qty: R(l.qty) }));
    await H('erpPoCreate', ctx, { lines, planned: true, supplier: str(p.supplier) || undefined, note: (str(p.note) || str(a.title)).slice(0, 300) + ' (approved move)' });
    return { ok: true, text: 'Planned supplier order made: ' + lines.map((l) => l.qty + ' × ' + l.sku).join(', ') + '. Nothing paid - finish it under Shipments.' };
  }
  if (a.type === 'price') {
    const cur = await H('erpProduct', ctx, str(p.sku));
    const prod = cur;
    if (!prod || !str(prod.sku)) return { ok: false, text: 'No product ' + str(p.sku) + '.' };
    if (/discontinued/i.test(str(prod.status))) return { ok: false, text: str(prod.product_name) + ' is discontinued - its price is not changed.' };
    const old = num(prod.sell_price), np = R(p.newPrice), cut = old > 0 ? ((old - np) / old) * 100 : 0;
    const limit = await maxCut(ctx);
    if (cut > limit + 0.01) return { ok: false, text: 'That is ' + Math.round(cut) + '% below today\'s ' + money(old) + ' - more than the ' + limit + '% the AI may cut. Change the price yourself if you want it.' };
    // the save writes every field: send the product as it is, with only the new price
    const { row, ...fields } = prod;
    await H('erpSaveProduct', ctx, { ...fields, sell_price: np });
    return { ok: true, text: 'Price of ' + prod.product_name + ' changed from ' + money(old) + ' to ' + money(np) + '.' };
  }
  if (a.type === 'followup') {
    let n = 0;
    for (const i of p.items.slice(0, 30)) { await H('erpFollowupSave', ctx, { phone: str(i.phone) || undefined, name: str(i.name) || undefined, due: str(i.due), note: str(i.note).slice(0, 280) + ' (approved move)' }); n++; }
    return { ok: true, text: n + ' follow-up call' + (n === 1 ? '' : 's') + ' put on the list.' };
  }
  if (a.type === 'whatsapp') {
    // only people the ERP already knows: customers or leads with that number
    const tail = (v) => str(v).replace(/[^0-9]/g, '').slice(-10);
    const want = p.recipients.slice(0, 200).map((r) => ({ phone: str(r.phone), t: tail(r.phone), name: str(r.name) })).filter((r) => r.t.length === 10);
    const known = {};
    if (want.length) {
      const tails = want.map((r) => r.t);
      for (const r of await ctx.tx`select phone, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) t from customers where business_id = ${ctx.biz} and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = any(${tails})`) known[r.t] = str(r.phone);
      try { for (const r of await ctx.tx`select phone, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) t from inbox_leads where business_id = ${ctx.biz} and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = any(${tails})`) if (!known[r.t]) known[r.t] = str(r.phone); } catch (_) { /* no leads */ }
    }
    const rec = want.filter((r) => known[r.t]).map((r) => ({ key: known[r.t], phone: known[r.t], name: r.name }));
    if (!rec.length) return { ok: false, text: 'None of those numbers is a customer or lead in the ERP, so nothing was sent.' };
    await H('erpEvoCampaignStart', ctx, { text: str(p.text), recipients: rec, name: (str(p.name) || str(a.title)).slice(0, 120), spread: true });
    return { ok: true, text: 'WhatsApp message going to ' + rec.length + ' people, spread over the day' + (rec.length < want.length ? ' (' + (want.length - rec.length) + ' unknown numbers left out)' : '') + '.' };
  }
  if (a.type === 'erp') {
    const HS = (await import('./index.js')).HANDLERS, done = [];
    for (const st of p.steps.slice(0, 10)) {
      const name = str(st.name);
      if (!fixAllowed(name) || !HS[name]) return { ok: false, text: 'Step "' + str(st.summary) + '": ' + name + ' is not a function a fix may use.' };
      if (!callAllowed(ctx.s, name)) return { ok: false, text: 'Step "' + str(st.summary) + '" is not allowed for your role.' };
      await HS[name](ctx, st.args === undefined ? {} : st.args);   // an error stops the fix and undoes the steps before it
      done.push(str(st.summary));
    }
    return { ok: true, text: 'Fixed: ' + done.join('; ') + '.' };
  }
  if (a.type === 'task') {
    const agent = ['command', 'leads', 'ads', 'content', 'seo', 'watchdog', 'inbox'].includes(str(p.agent)) ? str(p.agent) : 'command';
    const id = (await ctx.tx`insert into engine_jobs (business_id, agent, title, ask, source, created_by) values (${ctx.biz}, ${agent}, ${str(a.title).slice(0, 90)}, ${str(p.ask).slice(0, 8000)}, 'brief', ${str(ctx.s.name)}) returning id`)[0].id;
    return { ok: true, text: 'Given to the Engine - the answer will be in the Command Center.', jobId: id };
  }
  return { ok: false, text: 'Nothing to do.' };
}
