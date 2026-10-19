// Paid campaigns on Facebook and Instagram (owner 20 Oct 2026, advertising automation S4), through Meta's Marketing
// API with the one Meta login (metaconnect.js, META_USER_TOKEN; needs ads_management and a role on the ad account).
//
//   erpAds()                      the settings, the ad accounts on the login, this month's spend against the caps, the campaigns
//   erpAdsSettings({...})         owner: the ad account, daily and monthly caps, the pixel, the auto-pause rules
//   erpAdsInterests({q})          Meta's interest search, for the audience
//   erpAdsAudience()              owner: the customers' phone numbers (hashed) as a Custom Audience, and a lookalike of it
//   erpAdsPlan({...})             build a campaign PAUSED on one of our published posts: campaign → ad set → creative → ad, the preview
//   erpAdsAct({id, action})       owner: start | pause | resume | stop; a manager may pause
//   adsTick(ctx)                  hourly: spend and results from Meta, spend into Expenses (Advertising), caps and auto-pause
//
// The ERP never spends by itself: a campaign is made PAUSED and only Start (the owner) makes it run; the daily budget
// may not pass the daily cap; the month's spend may not pass the monthly cap (then everything running is paused).

import { getSecret, getConfig, setConfig } from '../lib/ext.js';
import { formatDate, num, monthStr } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';
import { erpExpenseAdd } from './expenses.js';

const str = (v) => String(v == null ? '' : v).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
const OBJ = { messages: { objective: 'OUTCOME_ENGAGEMENT', goal: 'CONVERSATIONS', result: 'onsite_conversion.messaging_conversation_started_7d', label: 'messages started' },
              traffic: { objective: 'OUTCOME_TRAFFIC', goal: 'LINK_CLICKS', result: 'link_click', label: 'link clicks' },
              reach: { objective: 'OUTCOME_AWARENESS', goal: 'REACH', result: '', label: 'people reached' },
              sales: { objective: 'OUTCOME_SALES', goal: 'OFFSITE_CONVERSIONS', result: 'purchase', label: 'purchases' } };
const H = 3600e3;

function need(ctx, role) { if (!roleAtLeast(ctx.s.role, role || 'manager')) throw new Error('Not open to your role.'); }
function needOwner(ctx) { if (ctx.s.role !== 'owner') throw new Error('Only the owner spends money on ads.'); }
async function settings(ctx) {
  let s = {}; try { s = JSON.parse(str(await getConfig(ctx, 'ads_settings', '')) || '{}') || {}; } catch (_) { s = {}; }
  return { account: str(s.account), dailyCap: num(s.dailyCap) || 500, monthlyCap: num(s.monthlyCap) || 10000, pixel: str(s.pixel), maxCostPerResult: num(s.maxCostPerResult) || 0, minCtr: num(s.minCtr) || 0, audience: s.audience || null };
}
async function graph(ctx, method, path, body) {
  const token = await getSecret(ctx, 'META_USER_TOKEN');
  if (!token) throw new Error('Connect Facebook first (Settings → Connections).');
  const f = ctx.deps.fetch || fetch;
  const url = GRAPH + path + (path.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token);
  const res = await f(url, method === 'GET' ? { method: 'GET' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  let j = {}; try { j = JSON.parse(await res.text()); } catch (_) { j = {}; }
  if (!res.ok || j.error) { const e = j.error || {}; throw new Error('Facebook said: ' + str(e.error_user_msg || e.message || res.status) + (e.error_subcode ? ' (subcode ' + e.error_subcode + ')' : e.code ? ' (#' + e.code + ')' : '')); }
  return j;
}
async function accounts(ctx) {
  let assets = {}; try { assets = JSON.parse(str(await getConfig(ctx, 'meta_assets', '')) || '{}') || {}; } catch (_) { assets = {}; }
  return (assets.adAccounts || []).map((a) => ({ id: str(a.id), name: str(a.name), currency: str(a.currency) || 'BDT', active: !!a.active }));
}
async function pageOf(ctx) {
  let assets = {}; try { assets = JSON.parse(str(await getConfig(ctx, 'meta_assets', '')) || '{}') || {}; } catch (_) { assets = {}; }
  const pages = assets.pages || [];
  try { const used = (await ctx.tx`select external_id from inbox_channels where business_id = ${ctx.biz} and kind = 'messenger' and status <> 'removed' order by created_at limit 1`)[0]; if (used) return pages.find((p) => str(p.id) === str(used.external_id)) || pages[0]; } catch (_) { /* fine */ }
  return pages[0];
}
function view(r) {
  return { id: r.id, postId: r.post_id, name: str(r.name), objective: r.objective, label: OBJ[r.objective].label, account: r.account, campaignId: str(r.campaign_id), adId: str(r.ad_id), dailyBudget: num(r.daily_budget), days: r.days,
           starts: r.starts_at ? formatDate(new Date(r.starts_at), 'd MMM') : '', ends: r.ends_at ? formatDate(new Date(r.ends_at), 'd MMM') : '', targeting: r.targeting || {}, status: r.status, preview: str(r.preview), spend: num(r.spend),
           results: r.results || {}, error: str(r.error), autoNote: str(r.auto_note), statsAt: r.stats_at ? formatDate(new Date(r.stats_at), 'd MMM h:mm a') : '', startedBy: str(r.started_by), createdBy: str(r.created_by), created: formatDate(new Date(r.created_at), 'd MMM') };
}
async function monthSpend(ctx) {
  const m = monthStr(ctx.now);
  const r = (await ctx.tx`select coalesce(sum((results->'byDay'->>d.key)::numeric), 0) s from ad_campaigns c, jsonb_each_text(coalesce(c.results->'byDay', '{}'::jsonb)) d where c.business_id = ${ctx.biz} and d.key like ${m + '%'}`)[0];
  return Math.round(num(r && r.s));
}

export async function erpAds(ctx) {
  need(ctx);
  const s = await settings(ctx);
  const rows = await ctx.tx`select * from ad_campaigns where business_id = ${ctx.biz} order by created_at desc limit 100`;
  const acc = await accounts(ctx);
  let balance = null;
  if (s.account) { try { const a = await graph(ctx, 'GET', '/' + s.account + '?fields=name,currency,amount_spent,balance,account_status,spend_cap'); balance = { name: str(a.name), currency: str(a.currency), spent: num(a.amount_spent) / 100, balance: num(a.balance) / 100, status: num(a.account_status) }; } catch (e) { balance = { error: str(e.message) }; } }
  return { settings: s, accounts: acc, connected: !!(await getSecret(ctx, 'META_USER_TOKEN')), monthSpend: await monthSpend(ctx), balance, campaigns: rows.map(view), canStart: ctx.s.role === 'owner',
           objectives: Object.keys(OBJ).map((k) => ({ key: k, label: OBJ[k].label })) };
}

export async function erpAdsSettings(ctx, payload) {
  needOwner(ctx);
  const p = payload || {}, old = await settings(ctx);
  const acc = await accounts(ctx);
  const account = str(p.account);
  if (account && !acc.some((a) => a.id === account)) throw new Error('That ad account is not on this login: press Refresh under Settings → Connections.');
  const s = { account: p.account !== undefined ? account : old.account, dailyCap: p.dailyCap !== undefined ? Math.max(0, num(p.dailyCap)) : old.dailyCap, monthlyCap: p.monthlyCap !== undefined ? Math.max(0, num(p.monthlyCap)) : old.monthlyCap,
              pixel: p.pixel !== undefined ? str(p.pixel).slice(0, 40) : old.pixel, maxCostPerResult: p.maxCostPerResult !== undefined ? Math.max(0, num(p.maxCostPerResult)) : old.maxCostPerResult, minCtr: p.minCtr !== undefined ? Math.max(0, num(p.minCtr)) : old.minCtr, audience: old.audience };
  await setConfig(ctx, 'ads_settings', JSON.stringify(s));
  return erpAds(ctx);
}

export async function erpAdsInterests(ctx, payload) {
  need(ctx);
  const q = str(payload && payload.q);
  if (q.length < 2) return { interests: [] };
  const j = await graph(ctx, 'GET', '/search?type=adinterest&limit=12&q=' + encodeURIComponent(q));
  return { interests: (j.data || []).map((x) => ({ id: str(x.id), name: str(x.name), size: num(x.audience_size_lower_bound || x.audience_size) })) };
}

/** The customers' phone numbers, hashed on this server (SHA-256 of the E.164 number), as a Custom Audience; and a lookalike of it in Bangladesh. */
export async function erpAdsAudience(ctx) {
  needOwner(ctx);
  const s = await settings(ctx);
  if (!s.account) throw new Error('Choose the ad account first.');
  const rows = await ctx.tx`select distinct phone from customers where business_id = ${ctx.biz} and phone is not null`;
  const hashes = [];
  for (const r of rows) {
    let d = str(r.phone).replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('01')) d = '880' + d.slice(1);
    else if (d.length === 13 && d.startsWith('8801')) { /* fine */ }
    else continue;
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(d));
    hashes.push([Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')]);
  }
  if (hashes.length < 100) throw new Error('Meta needs at least 100 customers with a phone number for an audience; there are ' + hashes.length + '.');
  let aud = s.audience && s.audience.id ? s.audience : null;
  if (!aud) {
    const c = await graph(ctx, 'POST', '/' + s.account + '/customaudiences', { name: 'ERP customers', subtype: 'CUSTOM', description: 'People who bought from us (phone numbers, hashed)', customer_file_source: 'USER_PROVIDED_ONLY' });
    aud = { id: str(c.id), n: 0 };
  }
  for (let i = 0; i < hashes.length; i += 5000) await graph(ctx, 'POST', '/' + aud.id + '/users', { payload: { schema: ['PHONE_SHA256'], data: hashes.slice(i, i + 5000) } });
  aud.n = hashes.length; aud.at = ctx.now.toISOString();
  if (!aud.lookalike) {
    try { const l = await graph(ctx, 'POST', '/' + s.account + '/customaudiences', { name: 'Like our customers (BD)', subtype: 'LOOKALIKE', origin_audience_id: aud.id, lookalike_spec: { type: 'similarity', country: 'BD' } }); aud.lookalike = str(l.id); } catch (e) { aud.lookalikeError = str(e.message); }
  }
  await setConfig(ctx, 'ads_settings', JSON.stringify({ ...s, audience: aud }));
  return { ok: true, audience: aud };
}

/** Build the campaign, PAUSED, on a published post. Returns the campaign with Meta's preview; nothing runs yet. */
export async function erpAdsPlan(ctx, payload) {
  need(ctx);
  const p = payload || {}, s = await settings(ctx);
  if (!s.account) throw new Error('Choose the ad account first (Paid ads → Settings).');
  const ob = OBJ[str(p.objective)]; if (!ob) throw new Error('What should the ad do: messages, traffic, reach or sales?');
  const post = (await ctx.tx`select * from social_posts where business_id = ${ctx.biz} and id = ${str(p.postId)}`)[0];
  if (!post || post.state !== 'published') throw new Error('Choose a published post to boost.');
  const fb = post.results && post.results.facebook;
  if (!fb || !fb.id) throw new Error('That post is not on the Facebook Page (Instagram-only posts cannot be boosted from here yet).');
  const page = await pageOf(ctx);
  if (!page) throw new Error('No Facebook Page on this login.');
  const storyId = fb.id.includes('_') ? fb.id : page.id + '_' + fb.id;
  const daily = Math.round(num(p.dailyBudget));
  if (!(daily >= 50)) throw new Error('The daily budget is at least 50.');
  if (daily > s.dailyCap) throw new Error('The daily budget ' + daily + ' is above your daily cap ' + s.dailyCap + ' (Paid ads → Settings).');
  const days = Math.max(1, Math.min(60, Math.round(num(p.days) || 7)));
  const spent = await monthSpend(ctx);
  if (spent + daily * Math.min(days, 31) > s.monthlyCap) throw new Error('This would pass the monthly cap: ' + spent + ' spent + ' + daily + ' × ' + Math.min(days, 31) + ' days > ' + s.monthlyCap + '.');
  const t = p.targeting || {};
  const ageMin = Math.max(18, Math.min(65, Math.round(num(t.ageMin) || 18))), ageMax = Math.max(ageMin, Math.min(65, Math.round(num(t.ageMax) || 55)));
  const interests = (Array.isArray(t.interests) ? t.interests : []).filter((x) => str(x.id)).slice(0, 15).map((x) => ({ id: str(x.id), name: str(x.name) }));
  const countries = (Array.isArray(t.countries) ? t.countries : ['BD']).map(str).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 5);
  const targeting = { geo_locations: { countries: countries.length ? countries : ['BD'] }, age_min: ageMin, age_max: ageMax };
  if (interests.length) targeting.flexible_spec = [{ interests }];
  if (t.lookalike && s.audience && s.audience.lookalike) targeting.custom_audiences = [{ id: s.audience.lookalike }];
  else if (t.customers && s.audience && s.audience.id) targeting.custom_audiences = [{ id: s.audience.id }];
  if (ob.goal === 'CONVERSATIONS') targeting.publisher_platforms = ['facebook', 'instagram', 'messenger'];
  const name = (str(p.name) || (str(post.title) + ' · ' + ob.label)).slice(0, 100);
  const start = new Date(ctx.now.getTime() + 10 * 60e3), end = new Date(start.getTime() + days * 24 * H);
  const camp = await graph(ctx, 'POST', '/' + s.account + '/campaigns', { name, objective: ob.objective, status: 'PAUSED', special_ad_categories: [], buying_type: 'AUCTION' });
  const adset = { name: name + ' · audience', campaign_id: str(camp.id), daily_budget: daily * 100, billing_event: 'IMPRESSIONS', optimization_goal: ob.goal, bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting, status: 'PAUSED', start_time: start.toISOString(), end_time: end.toISOString() };
  if (ob.goal === 'CONVERSATIONS') { adset.destination_type = 'MESSENGER'; adset.promoted_object = { page_id: page.id }; }
  if (ob.goal === 'OFFSITE_CONVERSIONS') { if (!s.pixel) throw new Error('Sales ads need the website pixel id (Paid ads → Settings).'); adset.promoted_object = { pixel_id: s.pixel, custom_event_type: 'PURCHASE' }; }
  const set = await graph(ctx, 'POST', '/' + s.account + '/adsets', adset);
  const creative = await graph(ctx, 'POST', '/' + s.account + '/adcreatives', { name: name + ' · creative', object_story_id: storyId });
  const ad = await graph(ctx, 'POST', '/' + s.account + '/ads', { name: name + ' · ad', adset_id: str(set.id), creative: { creative_id: str(creative.id) }, status: 'PAUSED' });
  let preview = '';
  try { const pv = await graph(ctx, 'GET', '/' + str(ad.id) + '/previews?ad_format=MOBILE_FEED_STANDARD'); preview = str((((pv.data || [])[0] || {}).body)); } catch (_) { preview = ''; }
  const r = (await ctx.tx`insert into ad_campaigns (business_id, post_id, name, objective, account, campaign_id, adset_id, creative_id, ad_id, story_id, daily_budget, days, starts_at, ends_at, targeting, status, preview, created_by)
                          values (${ctx.biz}, ${post.id}, ${name}, ${str(p.objective)}, ${s.account}, ${str(camp.id)}, ${str(set.id)}, ${str(creative.id)}, ${str(ad.id)}, ${storyId}, ${daily}, ${days}, ${start}, ${end},
                                  ${ctx.tx.json({ countries: targeting.geo_locations.countries, ageMin, ageMax, interests, customers: !!targeting.custom_audiences && !t.lookalike, lookalike: !!(t.lookalike && s.audience && s.audience.lookalike) })}, 'ready', ${preview || null}, ${ctx.s.name}) returning *`)[0];
  return { campaign: view(r), total: daily * days };
}

async function setStatus(ctx, r, status) {
  for (const id of [r.campaign_id, r.adset_id, r.ad_id]) if (id) await graph(ctx, 'POST', '/' + id, { status });
}
export async function erpAdsAct(ctx, payload) {
  need(ctx);
  const p = payload || {}, action = str(p.action);
  const r = (await ctx.tx`select * from ad_campaigns where business_id = ${ctx.biz} and id = ${str(p.id)}`)[0];
  if (!r) throw new Error('That campaign was not found.');
  const s = await settings(ctx);
  if (action === 'start' || action === 'resume') {
    needOwner(ctx);
    if (!['ready', 'paused'].includes(r.status)) throw new Error('It is ' + r.status + '.');
    if (num(r.daily_budget) > s.dailyCap) throw new Error('Its daily budget is above the daily cap now.');
    const spent = await monthSpend(ctx);
    if (spent >= s.monthlyCap) throw new Error('The monthly cap ' + s.monthlyCap + ' is reached (' + spent + ' spent). Raise it under Settings, or wait for next month.');
    await setStatus(ctx, r, 'ACTIVE');
    const row = (await ctx.tx`update ad_campaigns set status = 'running', started_by = coalesce(started_by, ${ctx.s.name}), auto_note = null, error = null, updated_at = now() where id = ${r.id} returning *`)[0];
    return { campaign: view(row) };
  }
  if (action === 'pause') {
    if (r.status !== 'running') throw new Error('It is not running.');
    await setStatus(ctx, r, 'PAUSED');
    return { campaign: view((await ctx.tx`update ad_campaigns set status = 'paused', updated_at = now() where id = ${r.id} returning *`)[0]) };
  }
  if (action === 'stop') {
    needOwner(ctx);
    if (['done', 'stopped'].includes(r.status)) throw new Error('It is already ' + r.status + '.');
    try { await setStatus(ctx, r, 'PAUSED'); if (r.campaign_id) await graph(ctx, 'POST', '/' + r.campaign_id, { status: 'ARCHIVED' }); } catch (e) { /* kept as stopped here anyway */ }
    return { campaign: view((await ctx.tx`update ad_campaigns set status = 'stopped', updated_at = now() where id = ${r.id} returning *`)[0]) };
  }
  throw new Error('Which action?');
}

/** Hourly: spend and results from Meta, the day's spend into Expenses, the caps and the auto-pause rules. */
export async function adsTick(ctx) {
  const out = { read: 0, paused: 0, expenses: 0 };
  const s = await settings(ctx);
  const rows = await ctx.tx`select * from ad_campaigns where business_id = ${ctx.biz} and status in ('running', 'paused', 'ready') and campaign_id is not null and (stats_at is null or stats_at < ${new Date(ctx.now.getTime() - H)}) order by stats_at nulls first limit 10`;
  for (const r of rows) {
    try {
      const life = await graph(ctx, 'GET', '/' + r.campaign_id + '/insights?fields=spend,impressions,reach,clicks,actions,cpm,ctr&date_preset=maximum');
      const d = ((life.data || [])[0]) || {};
      const acts = {}; for (const a of d.actions || []) acts[str(a.action_type)] = num(a.value);
      const resultKey = OBJ[r.objective].result, results = resultKey ? num(acts[resultKey]) : num(d.reach);
      const byDay = { ...((r.results || {}).byDay || {}) };
      try { const days = await graph(ctx, 'GET', '/' + r.campaign_id + '/insights?fields=spend&time_increment=1&date_preset=maximum'); for (const x of days.data || []) byDay[str(x.date_start)] = num(x.spend); } catch (_) { /* fine */ }
      const spend = num(d.spend);
      const res = { impressions: num(d.impressions), reach: num(d.reach), clicks: num(d.clicks), results, cpm: num(d.cpm), ctr: num(d.ctr), costPerResult: results ? Math.round(spend / results * 100) / 100 : 0, messages: num(acts['onsite_conversion.messaging_conversation_started_7d']), purchases: num(acts.purchase), byDay };
      let status = r.status, note = str(r.auto_note);
      if (r.status === 'running' && r.ends_at && new Date(r.ends_at) < ctx.now) status = 'done';
      if (r.status === 'running' && s.maxCostPerResult > 0 && results >= 5 && res.costPerResult > s.maxCostPerResult) { await setStatus(ctx, r, 'PAUSED'); status = 'paused'; note = 'Paused by the ERP: cost per result ' + res.costPerResult + ' is above your limit ' + s.maxCostPerResult + '.'; out.paused++; }
      if (r.status === 'running' && s.minCtr > 0 && res.impressions >= 2000 && res.ctr < s.minCtr) { await setStatus(ctx, r, 'PAUSED'); status = 'paused'; note = 'Paused by the ERP: click rate ' + res.ctr + '% is below your floor ' + s.minCtr + '%.'; out.paused++; }
      await ctx.tx`update ad_campaigns set spend = ${spend}, results = ${ctx.tx.json(res)}, status = ${status}, auto_note = ${note || null}, stats_at = ${ctx.now}, updated_at = now() where id = ${r.id}`;
      out.read++;
      // yesterday's and today's spend into Expenses (one line per campaign per day, written once)
      for (const day of Object.keys(byDay).sort().slice(-2)) {
        const amt = Math.round(byDay[day] * 100) / 100; if (!(amt > 0)) continue;
        const tag = 'Meta ads · ' + str(r.name).slice(0, 50) + ' · ' + day;
        const have = (await ctx.tx`select expense_no, amount from expenses where business_id = ${ctx.biz} and description = ${tag} and voided is null`)[0];
        if (have && Math.abs(num(have.amount) - amt) < 1) continue;
        if (have) continue;   // the figure moved after being written: left for the owner (Meta's numbers settle for ~2 days)
        try { await erpExpenseAdd(ctx, { amount: amt, description: tag, category: 'Advertising', month: day.slice(0, 7) }); out.expenses++; } catch (_) { /* a closed month: left out */ }
      }
    } catch (e) { await ctx.tx`update ad_campaigns set error = ${str(e && e.message).slice(0, 300)}, stats_at = ${ctx.now}, updated_at = now() where id = ${r.id}`; }
  }
  // the monthly cap: everything running is paused once it is reached
  const spent = await monthSpend(ctx);
  if (spent >= s.monthlyCap) {
    for (const r of await ctx.tx`select * from ad_campaigns where business_id = ${ctx.biz} and status = 'running'`) {
      try { await setStatus(ctx, r, 'PAUSED'); await ctx.tx`update ad_campaigns set status = 'paused', auto_note = ${'Paused by the ERP: the monthly cap ' + s.monthlyCap + ' is reached.'}, updated_at = now() where id = ${r.id}`; out.paused++; } catch (_) { /* next hour */ }
    }
  }
  return out;
}

export const HANDLERS = { erpAds, erpAdsSettings, erpAdsInterests, erpAdsAudience, erpAdsPlan, erpAdsAct };
