// Creators (Campaigns > Creators): influencer sponsorships run for a brand as its reseller. Who the creators are,
// what they were given, what they posted and how it did, projects to pass on to the brand, and the monthly report
// the brand asked for (creator, SKU and quantity, link, date, performance, enquiries and sales). Owner-only.
//
//   erpCreators({month})            everything for one month (default: this month) + the report text
//   erpCreatorSave({...})           add or change a creator (its terms are the brief)
//   erpCreatorShip({...})           filament handed over (value from the product's sell price when the SKU is known)
//   erpCreatorPost({...})           a video / post / reel with its numbers (id = update the numbers later)
//   erpCreatorProject({...})        a student / robotics project to send to the brand
//   erpCreatorRemove({kind,id})     take a ship / post / project line out again

import { num, formatDate } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
const money = (n) => '৳' + Math.round(num(n)).toLocaleString('en-US');
function needOwner(ctx) { if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder or a shareholder runs the creator programme.'); }
function monthOf(ctx, m) {
  const s = str(m);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return formatDate(ctx.now, 'yyyy-MM');
}
function dateOf(v, ctx) {
  const s = str(v);
  if (!s) return formatDate(ctx.now, 'yyyy-MM-dd');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('The date must look like 2026-10-08.');
  return s;
}
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthName(ym) { const [y, m] = ym.split('-'); return MONTH_NAMES[num(m) - 1] + ' ' + y; }
async function own(ctx, id) {
  const r = (await ctx.tx`select * from erp_creators where business_id = ${ctx.biz} and id = ${num(id)}`)[0];
  if (!r) throw new Error('No such creator.');
  return r;
}

export async function erpCreators(ctx, payload) {
  needOwner(ctx);
  const month = monthOf(ctx, (payload || {}).month), from = month + '-01';
  const creators = await ctx.tx`select * from erp_creators where business_id = ${ctx.biz} order by status = 'active' desc, name`;
  const ships = await ctx.tx`select * from erp_creator_ships where business_id = ${ctx.biz} order by on_date desc, id desc`;
  const posts = await ctx.tx`select * from erp_creator_posts where business_id = ${ctx.biz} order by on_date desc, id desc`;
  const projects = await ctx.tx`select * from erp_creator_projects where business_id = ${ctx.biz} order by id desc`;
  const codes = creators.map((c) => str(c.code).toLowerCase()).filter(Boolean);
  const salesByCode = {};
  if (codes.length) {
    const rows = await ctx.tx`
      select lower(coalesce(note, '') || ' ' || coalesce(source, '')) as hay, grand_total, created_at
        from invoices where business_id = ${ctx.biz} and voided_at is null
         and created_at >= ${from}::date and created_at < (${from}::date + interval '1 month')`;
    for (const r of rows) for (const c of codes) if (r.hay.includes(c)) { const s = salesByCode[c] = salesByCode[c] || { orders: 0, revenue: 0 }; s.orders++; s.revenue += num(r.grand_total); }
  }
  const inMonth = (d) => formatDate(new Date(d), 'yyyy-MM') === month;
  const out = creators.map((c) => {
    const myShips = ships.filter((s) => s.creator_id === c.id), myPosts = posts.filter((p) => p.creator_id === c.id), myProjects = projects.filter((p) => p.creator_id === c.id);
    const mShips = myShips.filter((s) => inMonth(s.on_date)), mPosts = myPosts.filter((p) => inMonth(p.on_date));
    const sum = (l, k) => l.reduce((a, x) => a + num(x[k]), 0);
    const videos = mPosts.filter((p) => p.kind === 'video').length, others = mPosts.length - videos;
    const sales = salesByCode[str(c.code).toLowerCase()] || { orders: 0, revenue: 0 };
    const views = sum(mPosts, 'views'), eng = sum(mPosts, 'likes') + sum(mPosts, 'comments') + sum(mPosts, 'shares');
    const rollsM = sum(mShips, 'qty'), valueM = sum(mShips, 'value'), rollsAll = sum(myShips, 'qty'), valueAll = sum(myShips, 'value');
    const behind = [];
    if (c.status === 'active') {
      if (videos < num(c.videos_month)) behind.push(videos + ' of ' + num(c.videos_month) + ' videos');
      if (others < num(c.posts_month)) behind.push(others + ' of ' + num(c.posts_month) + ' posts');
    }
    const fmt = (r) => ({ ...r, on_date: r.on_date ? formatDate(new Date(r.on_date), 'yyyy-MM-dd') : '' });
    return {
      ...c, trial_until: c.trial_until ? formatDate(new Date(c.trial_until), 'yyyy-MM-dd') : '', hasLogin: !!c.user_id, applied_at: c.applied_at ? new Date(c.applied_at).toISOString() : '', profile_at: c.profile_at ? new Date(c.profile_at).toISOString() : '',
      month: { rolls: rollsM, value: valueM, videos, posts: others, views, engagement: eng, rate: views > 0 ? Math.round(eng / views * 1000) / 10 : 0,
               leads: sum(mPosts, 'leads'), orders: sales.orders, revenue: Math.round(sales.revenue), behind, cpm: views > 0 ? Math.round(valueM / views * 1000) : 0 },
      total: { rolls: rollsAll, value: valueAll, posts: myPosts.length, views: sum(myPosts, 'views') },
      ships: myShips.slice(0, 60).map(fmt), posts: myPosts.slice(0, 60).map(fmt), projects: myProjects,
    };
  });
  return { month, monthName: monthName(month), creators: out, report: reportText(ctx, month, out), briefs: Object.fromEntries(out.map((c) => [c.id, briefText(ctx, c)])) };
}

/** The monthly report for the brand, in the shape it asked for: creator, SKU and quantity, links, dates, numbers, leads, sales. */
function reportText(ctx, month, list) {
  const L = [];
  L.push('Creator programme report — ' + monthName(month));
  const tot = list.reduce((a, c) => ({ rolls: a.rolls + c.month.rolls, value: a.value + c.month.value, posts: a.posts + c.month.videos + c.month.posts, views: a.views + c.month.views, leads: a.leads + c.month.leads, orders: a.orders + c.month.orders, revenue: a.revenue + c.month.revenue }), { rolls: 0, value: 0, posts: 0, views: 0, leads: 0, orders: 0, revenue: 0 });
  L.push('Summary: ' + tot.rolls + ' rolls given (' + money(tot.value) + ' retail), ' + tot.posts + ' pieces of content, ' + tot.views.toLocaleString('en-US') + ' views, ' + tot.leads + ' enquiries, ' + tot.orders + ' orders with creator codes (' + money(tot.revenue) + ').');
  L.push('');
  list.forEach((c, i) => {
    L.push((i + 1) + '. ' + c.name + (c.handle ? ' — ' + c.handle : '') + (c.platforms ? ' (' + c.platforms + ')' : '') + (c.status !== 'active' ? ' [' + c.status + ']' : ''));
    const ships = c.ships.filter((s) => s.on_date.startsWith(month));
    L.push('   Filament provided: ' + (ships.length ? ships.map((s) => (s.sku ? s.sku + ' ' : '') + s.product + ' × ' + num(s.qty)).join('; ') + ' (' + money(c.month.value) + ')' : 'none this month'));
    const posts = c.posts.filter((p) => p.on_date.startsWith(month));
    if (posts.length) { L.push('   Content:'); posts.forEach((p) => L.push('   • ' + p.on_date + ' ' + (p.platform || '') + ' ' + p.kind + (p.product ? ' — ' + p.product : '') + (p.url ? ' ' + p.url : '') + ' — ' + num(p.views).toLocaleString('en-US') + ' views, ' + num(p.likes) + ' likes, ' + num(p.comments) + ' comments' + (num(p.shares) ? ', ' + num(p.shares) + ' shares' : '') + (num(p.leads) ? ', ' + num(p.leads) + ' enquiries' : ''))); }
    else L.push('   Content: none this month' + (c.month.behind.length ? ' (agreed: ' + num(c.videos_month) + ' videos + ' + num(c.posts_month) + ' posts)' : ''));
    L.push('   Results: ' + c.month.views.toLocaleString('en-US') + ' views, engagement ' + c.month.rate + '%, ' + c.month.leads + ' enquiries, ' + c.month.orders + ' orders' + (c.code ? ' with code ' + c.code : '') + ' (' + money(c.month.revenue) + ')' + (c.month.cpm ? ', ' + money(c.month.cpm) + ' of filament per 1,000 views' : ''));
    if (c.month.behind.length) L.push('   Behind the agreement: ' + c.month.behind.join(', '));
    const pr = c.projects.filter((p) => p.status === 'new' || p.status === 'sent');
    if (pr.length) L.push('   Projects for your review: ' + pr.map((p) => p.team + (p.project ? ' — ' + p.project : '') + (p.competition ? ' (' + p.competition + ')' : '') + (p.material ? ', needs ' + p.material + (p.qty ? ' × ' + p.qty : '') : '')).join('; '));
    L.push('');
  });
  L.push('Prepared ' + formatDate(ctx.now, 'd MMM yyyy') + '.');
  return L.join('\n');
}

/** The one-page brief a creator gets: what they receive, what they deliver, the rules. */
function briefText(ctx, c) {
  const L = [];
  L.push('Creator brief — ' + c.name + (c.brand ? ' × ' + c.brand : ''));
  L.push('');
  L.push('What you get: ' + num(c.rolls_video) + ' rolls per video' + (c.filament ? ' (' + c.filament + ')' : '') + '; up to ' + (num(c.rolls_video) * num(c.videos_month)) + ' rolls a month.');
  L.push('What you deliver each month: ' + num(c.videos_month) + ' videos and ' + num(c.posts_month) + ' posts' + (c.platforms ? ' on ' + c.platforms : '') + '.');
  L.push('In every video and post: tag ' + (c.brand || 'the brand') + ', link our store, show the raw filament, ' + (c.code ? 'mention your code ' + c.code : 'mention us as the seller') + '.');
  L.push('Before publishing: send us any product claims (strength, heat, comparisons with other brands) and anything that could affect the market. We confirm within a day.');
  L.push('After each post: send the link, date, views, likes, comments and any customer messages. After 30 days send the updated views.');
  L.push('Trial: ' + (c.trial_until ? 'until ' + c.trial_until : 'two months') + ', then a review together. The sponsorship stops if the results are weak.');
  if (/robot|student|project|team/i.test(str(c.notes))) L.push('Projects: send us promising student or robotics teams (team, project, competition, material and quantity) and we pass them to ' + (c.brand || 'the brand') + ' for a possible sponsorship.');
  if (str(c.notes)) L.push('Notes: ' + str(c.notes));
  return L.join('\n');
}

export async function erpCreatorSave(ctx, payload) {
  needOwner(ctx);
  const p = payload || {}, name = str(p.name);
  if (!name) throw new Error('The creator needs a name.');
  const status = ['active', 'paused', 'stopped', 'applied'].includes(str(p.status)) ? str(p.status) : 'active';
  const trial = str(p.trial_until) ? dateOf(p.trial_until, ctx) : null;
  const row = { name, handle: str(p.handle) || null, platforms: str(p.platforms) || null, followers: str(p.followers) || null, brand: str(p.brand), code: str(p.code).toUpperCase() || null,
                videos_month: Math.max(0, Math.round(num(p.videos_month))), posts_month: Math.max(0, Math.round(num(p.posts_month))), rolls_video: Math.max(0, Math.round(num(p.rolls_video))),
                filament: str(p.filament) || null, trial_until: trial, status, notes: str(p.notes) || null, open_limit: Math.max(1, Math.round(num(p.open_limit)) || 1),
                links: str(p.links) || null, niche: str(p.niche) || null, city: str(p.city) || null, about: str(p.about) || null, whatsapp: str(p.whatsapp) || null, updated_at: ctx.now };
  if (num(p.id) > 0) {
    await own(ctx, p.id);
    // only what the payload names changes (the creator's own profile fields stay when the owner's form does not send them)
    const keys = { handle: 'handle', platforms: 'platforms', followers: 'followers', brand: 'brand', code: 'code', videos_month: 'videos_month', posts_month: 'posts_month', rolls_video: 'rolls_video', filament: 'filament', trial_until: 'trial_until', status: 'status', notes: 'notes', open_limit: 'open_limit', links: 'links', niche: 'niche', city: 'city', about: 'about', whatsapp: 'whatsapp' };
    const upd = { name, updated_at: ctx.now };
    for (const k of Object.keys(keys)) if (p[k] !== undefined) upd[k] = row[k];
    await ctx.tx`update erp_creators set ${ctx.tx(upd)} where id = ${num(p.id)} and business_id = ${ctx.biz}`;
  }
  else {
    const email = str(p.email).toLowerCase();
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That is not an e-mail address.');
      if ((await ctx.tx`select 1 from erp_creators where business_id = ${ctx.biz} and lower(email) = ${email}`)[0]) throw new Error('Another creator already uses that e-mail.');
    }
    const made = (await ctx.tx`insert into erp_creators ${ctx.tx({ ...row, email: email || null, business_id: ctx.biz })} returning id`)[0];
    return { ...(await erpCreators(ctx, { month: p.month })), created: Number(made.id) };
  }
  return erpCreators(ctx, { month: p.month });
}

export async function erpCreatorShip(ctx, payload) {
  needOwner(ctx);
  const p = payload || {}, c = await own(ctx, p.creator_id), qty = num(p.qty);
  if (!(qty > 0)) throw new Error('How many rolls?');
  let sku = str(p.sku), product = str(p.product), value = num(p.value);
  if (sku) {
    const pr = (await ctx.tx`select sku, name, sell_price from products where business_id = ${ctx.biz} and lower(sku) = ${sku.toLowerCase()}`)[0];
    if (pr) { sku = pr.sku; product = product || pr.name; if (!(value > 0)) value = num(pr.sell_price) * qty; }
  }
  if (!product) throw new Error('Which product?');
  await ctx.tx`insert into erp_creator_ships ${ctx.tx({ business_id: ctx.biz, creator_id: c.id, on_date: dateOf(p.date, ctx), sku: sku || null, product, qty, value, note: str(p.note) || null })}`;
  return erpCreators(ctx, { month: p.month });
}

export async function erpCreatorPost(ctx, payload) {
  needOwner(ctx);
  const p = payload || {};
  const kind = ['video', 'post', 'reel'].includes(str(p.kind)) ? str(p.kind) : 'video';
  const nums = { views: Math.max(0, Math.round(num(p.views))), likes: Math.max(0, Math.round(num(p.likes))), comments: Math.max(0, Math.round(num(p.comments))), shares: Math.max(0, Math.round(num(p.shares))), leads: Math.max(0, Math.round(num(p.leads))) };
  if (num(p.id) > 0) {
    const r = (await ctx.tx`select creator_id from erp_creator_posts where business_id = ${ctx.biz} and id = ${num(p.id)}`)[0];
    if (!r) throw new Error('No such post.');
    await ctx.tx`update erp_creator_posts set ${ctx.tx({ ...nums, url: str(p.url) || null, note: str(p.note) || null, updated_at: ctx.now })} where id = ${num(p.id)} and business_id = ${ctx.biz}`;
  } else {
    const c = await own(ctx, p.creator_id);
    await ctx.tx`insert into erp_creator_posts ${ctx.tx({ business_id: ctx.biz, creator_id: c.id, on_date: dateOf(p.date, ctx), platform: str(p.platform) || null, kind, url: str(p.url) || null, product: str(p.product) || null, ...nums, note: str(p.note) || null })}`;
  }
  return erpCreators(ctx, { month: p.month });
}

export async function erpCreatorProject(ctx, payload) {
  needOwner(ctx);
  const p = payload || {}, status = ['new', 'sent', 'approved', 'declined'].includes(str(p.status)) ? str(p.status) : 'new';
  if (num(p.id) > 0) {
    const r = (await ctx.tx`select id from erp_creator_projects where business_id = ${ctx.biz} and id = ${num(p.id)}`)[0];
    if (!r) throw new Error('No such project.');
    await ctx.tx`update erp_creator_projects set status = ${status}, note = ${str(p.note) || null} where id = ${num(p.id)} and business_id = ${ctx.biz}`;
  } else {
    const c = await own(ctx, p.creator_id), team = str(p.team);
    if (!team) throw new Error('Which team?');
    await ctx.tx`insert into erp_creator_projects ${ctx.tx({ business_id: ctx.biz, creator_id: c.id, team, project: str(p.project) || null, competition: str(p.competition) || null, material: str(p.material) || null, qty: str(p.qty) || null, status, note: str(p.note) || null })}`;
  }
  return erpCreators(ctx, { month: p.month });
}

export async function erpCreatorRemove(ctx, payload) {
  needOwner(ctx);
  const p = payload || {}, id = num(p.id);
  if (p.kind === 'ship') await ctx.tx`delete from erp_creator_ships where business_id = ${ctx.biz} and id = ${id}`;
  else if (p.kind === 'post') await ctx.tx`delete from erp_creator_posts where business_id = ${ctx.biz} and id = ${id}`;
  else if (p.kind === 'project') await ctx.tx`delete from erp_creator_projects where business_id = ${ctx.biz} and id = ${id}`;
  else throw new Error('What to remove?');
  return erpCreators(ctx, { month: p.month });
}

export const HANDLERS = { erpCreators, erpCreatorSave, erpCreatorShip, erpCreatorPost, erpCreatorProject, erpCreatorRemove };
