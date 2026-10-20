// The Inbox's features as a subscription product (122_inbox_plans.sql).
//
// The provider's plan says which features a business may use (inbox_plans.features, {key: false} = left out) and
// a monthly AI budget in taka; the owner switches included features on or off (business_config 'inbox_features').
// feat(ctx, key) is the one check every handler and the agent ask; budget(ctx) says how much AI this month used.

import { getConfig } from './ext.js';

const str = (v) => String(v == null ? '' : v).trim();

// key, group, name, what it does. Order = the order on the Features screen.
export const FEATURES = [
  ['ch_messenger', 'Channels', 'Facebook Messenger', 'Chats from your Facebook page'],
  ['ch_instagram', 'Channels', 'Instagram', 'Instagram direct messages'],
  ['ch_wa_cloud', 'Channels', 'WhatsApp (official)', 'Meta\'s WhatsApp Cloud API'],
  ['ch_wa_linked', 'Channels', 'WhatsApp (linked device)', 'Evolution or WaSenderAPI - like WhatsApp Web; the number can be banned'],
  ['ch_webchat', 'Channels', 'Website chat', 'A chat bubble on your own website'],
  ['ch_email', 'Channels', 'Email', 'A mailbox (Gmail, Zoho, your domain): e-mails come in as chats, answers go out as e-mails'],
  ['comments', 'Channels', 'Post comments', 'Replies under your Facebook and Instagram posts, hide and delete'],
  ['voice_call', 'Channels', 'Voice call on the website', 'Visitors talk to the AI on your website chat'],
  ['photos', 'The AI', 'Reads photos', 'Understands a photo a customer sends'],
  ['photo_match', 'The AI', 'Finds the product in a photo', 'Compares the customer\'s photo with your product pictures'],
  ['voice', 'The AI', 'Reads voice notes', 'Writes out a customer\'s voice note'],
  ['knowledge', 'The AI', 'Knowledge base', 'Answers from your own documents'],
  ['offers', 'The AI', 'Special offers', 'Mentions the offers you set'],
  ['orders', 'Sales', 'Orders in the chat', 'The AI takes cash-on-delivery orders; the team approves them'],
  ['order_page', 'Sales', 'Order page and Track button', 'Each order gets its own page with its status and the courier\'s tracking'],
  ['bill_picture', 'Sales', 'Bill as a picture', 'After an order the customer gets the bill as an image'],
  ['product_page', 'Sales', 'Product pages with Buy', 'Each product has a page with a Buy button, opened from the chat'],
  ['landing', 'Sales', 'Landing pages and unfinished orders', 'A product page for your ads with a cash-on-delivery order form; visitors who typed their number but did not order are kept to call back'],
  ['bookings', 'Sales', 'Bookings', 'For service businesses: booking requests, advance, reminders'],
  ['leads', 'Later (own menu)', 'Leads', 'Interested customers kept with a follow-up date - its own menu later; off until then'],
  ['followups', 'Sales', 'Follow-ups', 'A reminder to a customer who went quiet (inside 24 hours)'],
  ['broadcasts', 'Later (own menu)', 'Broadcasts', 'An offer to everyone who wrote in the last 23 hours - Advertisement menu later; off until then'],
  ['templates', 'Sales', 'Messages after 24 hours', 'Meta-approved templates for courier updates and booking reminders'],
  ['assistant', 'Team', 'AI assistant beside a chat', 'Summary, a question about the customer, a drafted reply'],
  ['saved_ai', 'Team', 'Saved replies with AI', 'Suggest the fitting saved reply; adapt it to the chat'],
  ['groups', 'Team', 'Team groups', 'Which group hears which hand-over; teammates limited to some channels'],
  ['analytics', 'Team', 'Analytics', 'Messages, replies, hand-overs, first-reply time'],
  ['exports', 'Team', 'Downloads', 'Orders, leads, AI work and conversations as files'],
];
export const FEATURE_KEYS = FEATURES.map((f) => f[0]);
export const FEATURE_NAME = Object.fromEntries(FEATURES.map((f) => [f[0], f[2]]));
/** The channel kind -> its feature. */
export const KIND_FEATURE = { messenger: 'ch_messenger', instagram: 'ch_instagram', wa_cloud: 'ch_wa_cloud', wa_evo: 'ch_wa_linked', wa_sender: 'ch_wa_linked', webchat: 'ch_webchat', email: 'ch_email' };

/** The plan row (cached on the call). */
export async function planOf(ctx) {
  const m = ctx.memo || (ctx.memo = {});
  if (m.inboxPlan) return m.inboxPlan;
  let row = null;
  try { row = (await ctx.tx`select * from inbox_plans where business_id = ${ctx.biz}`)[0] || null; } catch (_) { row = null; }
  m.inboxPlan = { name: str(row && row.plan_name), features: (row && row.features) || {}, budget: row && row.ai_budget_bdt !== null && row.ai_budget_bdt !== undefined ? Number(row.ai_budget_bdt) : null };
  return m.inboxPlan;
}
/** The owner's own switches ({key: false} = off). */
export async function ownerSwitches(ctx) {
  const m = ctx.memo || (ctx.memo = {});
  if (m.inboxOwn) return m.inboxOwn;
  let o = {};
  try { o = JSON.parse(str(await getConfig(ctx, 'inbox_features', '')) || '{}') || {}; } catch (_) { o = {}; }
  m.inboxOwn = o;
  return o;
}
/** Features that stay off until the owner switches them on (their own menus come later). */
export const DEFAULT_OFF = ['leads', 'broadcasts'];
/** Is the owner's switch on? (a default-off feature needs an explicit yes) */
export function ownOn(own, key) { return DEFAULT_OFF.includes(key) ? own[key] === true : own[key] !== false; }
/** Is this feature in the plan AND switched on? */
export async function feat(ctx, key) {
  const plan = await planOf(ctx), own = await ownerSwitches(ctx);
  return plan.features[key] !== false && ownOn(own, key);
}
/** A plain refusal when a feature is off. */
export async function needFeat(ctx, key) {
  if (!(await feat(ctx, key))) {
    const plan = await planOf(ctx);
    throw new Error((FEATURE_NAME[key] || key) + (plan.features[key] === false ? ' is not in your plan.' : ' is switched off (Inbox > Features).'));
  }
}
/** Dhaka's calendar month so far. */
function monthStart(now) {
  const d = new Date(now.getTime() + 6 * 3600e3);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 6 * 3600e3);
}
/** The AI spent this month against the plan's budget. */
export async function budget(ctx) {
  const plan = await planOf(ctx);
  const used = Number((await ctx.tx`select coalesce(sum(cost_bdt), 0) as t from ai_work where business_id = ${ctx.biz} and at >= ${monthStart(ctx.now)}`)[0].t) || 0;
  let warnAt = 80;
  try { warnAt = Math.max(10, Math.min(100, Number(await getConfig(ctx, 'inbox_budget_warn', '80')) || 80)); } catch (_) { /* default */ }
  const pct = plan.budget ? Math.round((used / plan.budget) * 100) : 0;
  return { budget: plan.budget, used: Math.round(used * 100) / 100, pct, warnAt, warn: !!plan.budget && pct >= warnAt, stopped: !!plan.budget && used >= plan.budget };
}
