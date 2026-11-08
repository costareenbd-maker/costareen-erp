// factory-1 (162_ad_factory.sql, handlers/factory.js): the weekly ad factory - Monday plan (What to push -> 2 angles each ->
// ChatGPT pictures), ONE owner approval -> scheduled posts Tue-Thu, Friday review -> the best two as PAUSED paid ads,
// "Start the winners"; refusals, the timer's days and hours, and the other business untouched.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const fac = await import(pathToFileURL(path.join(fnDir, 'handlers', 'factory.js')));
const sm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'socialmake.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };

// the outside world: the own-server gateway (ChatGPT writing + pictures) and Meta
let chat = 0, jobsMade = 0, gwState = 'working';
web.on(/gw\.test\/v1/, (url, opts) => {
  if (/\/images\/jobs$/.test(url)) { jobsMade++; return { status: 200, body: { id: String(jobsMade).padStart(32, 'a'), state: 'queued' } }; }
  if (/\/images\/jobs\//.test(url)) return { status: 200, body: { state: gwState, bytes: 1000, width: 1024, height: 1024, revisedPrompt: 'p' } };
  if (/chat\/completions$/.test(url)) {
    chat++;
    const angles = [{ angle: 'Demo', hook: 'এক রোলে কতগুলো প্রিন্ট?', caption: 'এক রোলে কতগুলো প্রিন্ট?\nদাম ৳১৬০০। ইনবক্স করুন।', scene: 'desk', direction: 'morning light', why: 'shows use' },
                    { angle: 'Price', hook: 'এই দামে আসল ফিলামেন্ট', caption: 'এই দামে আসল ফিলামেন্ট\nদাম ৳১৬০০। অর্ডার করুন।', scene: 'minimal', direction: 'soft shadow', why: 'value' }];
    return { status: 200, body: { choices: [{ message: { role: 'assistant', content: JSON.stringify({ angles }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } } };
  }
  return { status: 404, body: {} };
});
const graph = [];
web.on(/graph\.facebook\.com/, (url, opts) => { graph.push({ url, method: opts.method }); return { status: 200, body: { id: 'g' + graph.length, data: [] } }; });
await sql`insert into erp_provider_secrets (key, value_enc) values ('CUSTOM_AI_KEY', 'v0.gwsecret'), ('CUSTOM_AI_BASE', 'v0.https://gw.test/v1') on conflict (key) do update set value_enc = excluded.value_enc`;
await owner('erpAiBrainSet', [{ routes: { default: { provider: 'custom', model: 'gpt-5.6-luna' }, tasks: {}, cheap: [] } }]);

// What to push must have something: every product counts as "advertise" when the rules ask for nothing
await owner('erpPushRulesSave', [{ coverDays: 1, slowDays: 9999, marginFloor: 1, lowCover: 1, keepMargin: 1, minValue: 999999999 }]);
const push = await owner('erpPushList', [{}]);
const pushN = push.ok ? push.result.advertise.length + push.result.rising.length + push.result.clear.length : 0;
check('set-up: What to push has products', pushN > 0, push.ok ? { a: push.result.advertise.length, r: push.result.rising.length, c: push.result.clear.length } : push);
const firstSku = push.result.rising[0] ? push.result.rising[0].sku : push.result.advertise[0] ? push.result.advertise[0].sku : push.result.clear[0].sku;
await deps.storage.save(FIX.B, 'products', 'fac.jpg', Buffer.concat([Buffer.from('\xff\xd8\xff'), Buffer.alloc(300, 2)]), 'image/jpeg');
await sql`update products set photo = 'fac.jpg' where business_id = ${FIX.B}`;

// ---- 1. settings
let r = await mgr('erpFactory', [{}]);
check('the factory: off by default, 4 products, budget 200 for 5 days', r.ok && r.result.on === false && r.result.products === 4 && r.result.budget === 200 && r.result.days === 5 && r.result.weeks.length === 0, r);
r = await sales('erpFactory', [{}]);
check('sales staff do not see it', !r.ok, r);
r = await mgr('erpFactorySet', [{ on: true }]);
check('a manager cannot switch it on', !r.ok, r);
r = await owner('erpFactorySet', [{ products: 9 }]);
check('more than 6 products a week is refused', !r.ok && /1 to 6/.test(r.error), r);
r = await owner('erpFactorySet', [{ on: true, hour: 10, products: 2, budget: 150, days: 4 }]);
check('the owner sets it: on at 10:00, 2 products, 150 a day for 4 days', r.ok && r.result.on && r.result.products === 2 && r.result.budget === 150, r);

// ---- 2. Monday: the timer plans the week (not before the hour, not on another day)
const mon8 = new Date('2026-11-09T02:00:00Z'), mon11 = new Date('2026-11-09T05:00:00Z'), tue = new Date('2026-11-10T05:00:00Z');   // Dhaka 08:00 / 11:00 Monday, Tuesday
r = await asB((ctx) => { ctx.now = mon8; return fac.factoryTick(ctx); });
check('Monday 08:00: waiting for 10:00', r === 'waiting' && (await sql`select count(*)::int n from ad_factory_weeks`)[0].n === 0, r);
r = await asB((ctx) => { ctx.now = tue; return fac.factoryTick(ctx); });
check('Tuesday: nothing is planned', (await sql`select count(*)::int n from ad_factory_weeks`)[0].n === 0, r);
r = await asB((ctx) => { ctx.now = mon11; return fac.factoryTick(ctx); });
const wk = (await sql`select * from ad_factory_weeks where business_id = ${FIX.B}`)[0];
const items = await sql`select * from ad_factory_items where week_id = ${wk && wk.id} order by created_at`;
check('Monday 11:00: the week 2026-W46 is planned and ready', /planned 2026-W46/.test(r) && wk && wk.week === '2026-W46' && wk.status === 'ready', { r, wk });
const uniq = new Set([...push.result.rising, ...push.result.advertise, ...push.result.clear].map((x) => String(x.sku).toLowerCase())).size;
const nProd = Math.min(2, uniq), nItems = 2 * nProd;
check('...each product (up to 2) x 2 different angles, each with its own ChatGPT picture started', items.length === nItems && items.every((i) => i.state === 'photo' && i.asset_id) && new Set(items.map((i) => i.angle)).size === 2 && jobsMade === nItems, items.map((i) => [i.sku, i.angle, i.state]));
check('...the hook, the post text and why are kept', items[0].hook && /দাম/.test(items[0].caption) && items[0].why, items[0]);
r = await asB((ctx) => { ctx.now = mon11; return fac.factoryTick(ctx); });
check('the next minute does not plan it again', (await sql`select count(*)::int n from ad_factory_weeks`)[0].n === 1 && jobsMade === nItems, r);
let refused = ''; try { const x = await asB((ctx) => { ctx.now = mon11; return fac.erpFactoryAct(ctx, { action: 'make' }); }); refused = JSON.stringify(x && (x.error || x)).slice(0, 200); } catch (e) { refused = String(e.message); }
check('"make" again in the same week is refused', /planned already/.test(refused), refused);

// ---- 3. ONE approval: ready pictures become scheduled posts, the rest follow when their picture is done
r = await mgr('erpFactoryAct', [{ action: 'approve', week: wk.id }]);
check('a manager cannot approve the week', !r.ok, r);
const last = items[items.length - 1];
r = await owner('erpFactoryAct', [{ action: 'skip', week: wk.id, item: last.id }]);
check('the owner can drop one angle', r.ok && (await sql`select state from ad_factory_items where id = ${last.id}`)[0].state === 'skipped', r);
r = await asB((ctx) => { ctx.now = mon11; return fac.erpFactoryAct(ctx, { action: 'approve', week: wk.id }); });
check('approved while the pictures are still being made: nothing posted yet, the week waits', r.done.made === 0 && r.done.waiting === nItems - 1 && (await sql`select status from ad_factory_weeks where id = ${wk.id}`)[0].status === 'approving', r.done);
gwState = 'done';
const at = await asB((ctx) => { ctx.now = mon11; return sm.assetsTick(ctx); });
r = await asB((ctx) => { ctx.now = mon11; return fac.factoryTick(ctx); });
const posts = await sql`select p.state, p.scheduled_at, p.media, p.captions, p.targets from ad_factory_items i join social_posts p on p.id = i.post_id where i.week_id = ${wk.id} order by p.scheduled_at`;
check('once the pictures are done the timer posts them as scheduled Facebook posts with the ChatGPT picture and the text', posts.length === nItems - 1 && posts.every((p) => p.state === 'scheduled' && p.targets.facebook && /^social\/ai-/.test(p.media[0].file) && /দাম/.test(p.captions.facebook)), posts);
const hrs = posts.map((p) => new Date(new Date(p.scheduled_at).getTime() + 6 * 3600e3).toISOString().slice(0, 13));
check('...from Tuesday 11:00, then 19:00, then Wednesday 11:00 (Dhaka), two a day', JSON.stringify(hrs) === JSON.stringify(['2026-11-10T11', '2026-11-10T19', '2026-11-11T11'].slice(0, nItems - 1)), hrs);
check('...the week is testing', (await sql`select status from ad_factory_weeks where id = ${wk.id}`)[0].status === 'testing');

// ---- 4. Friday review: scores; without an ad account the winners are named only
await sql`update social_posts set state = 'published', published_at = now(), stats = case when id = (select post_id from ad_factory_items where id = ${items[0].id}) then '{"facebook":{"reach":100,"reactions":10,"comments":4,"shares":1}}'::jsonb
                                                                                      when id = (select post_id from ad_factory_items where id = ${items[1].id}) then '{"facebook":{"reach":100,"reactions":2}}'::jsonb else '{"facebook":{"reach":100}}'::jsonb end
          where id in (select post_id from ad_factory_items where week_id = ${wk.id} and post_id is not null)`;
const fri = new Date('2026-11-13T05:00:00Z');
r = await asB((ctx) => { ctx.now = fri; return fac.factoryTick(ctx); });
const after = await sql`select id, state, score, campaign_id, error from ad_factory_items where week_id = ${wk.id} order by created_at`;
check('Friday: the week is reviewed; the posts people reacted to are the winners (at most 2)', /reviewed 2026-W46/.test(r) && after.filter((i) => i.state === 'winner').length === Math.min(2, nItems - 1) && (nItems < 4 || after[2].state === 'tested'), after.map((i) => [i.state, i.score]));
check('...the best one first by engagement per reach (10+12+5 on 100 = 27)', after[0].state === 'winner' && after[0].score.rate === 27, after[0].score);
check('...no ad account: no paid ad is made, it says so', after.filter((i) => i.state === 'winner').every((i) => !i.campaign_id && /No ad account/.test(i.error)), after);

// ---- 5. with an ad account the winners are made PAUSED; "Start the winners" is the owner's
await sql`delete from ad_factory_items where week_id = ${wk.id}`; await sql`delete from ad_factory_weeks where id = ${wk.id}`;
await sql`insert into business_config (business_id, key, value) values (${FIX.B}, 'ads_settings', ${JSON.stringify({ account: 'act_1', dailyCap: 1000, monthlyCap: 50000 })}) on conflict (business_id, key) do update set value = excluded.value`;
await sql`insert into business_secrets (business_id, key, value) values (${FIX.B}, 'META_USER_TOKEN', 'tok') on conflict (business_id, key) do update set value = excluded.value`;
r = await asB((ctx) => { ctx.now = mon11; return fac.erpFactoryAct(ctx, { action: 'make' }); });
const wk2 = (await sql`select * from ad_factory_weeks where business_id = ${FIX.B}`)[0];
await asB((ctx) => { ctx.now = mon11; return sm.assetsTick(ctx); });
r = await asB((ctx) => { ctx.now = mon11; return fac.erpFactoryAct(ctx, { action: 'approve', week: wk2.id }); });
check('a new week whose pictures are done is approved straight into posts', r.done.made === nItems && r.done.waiting === 0, r.done);
await sql`update social_posts set state = 'published', published_at = now(), results = jsonb_build_object('facebook', jsonb_build_object('id', 'PAGE_' || substr(id::text, 1, 6))), stats = '{"facebook":{"reach":50,"reactions":5}}'::jsonb
          where id in (select post_id from ad_factory_items where week_id = ${wk2.id})`;
r = await asB((ctx) => { ctx.now = fri; return fac.erpFactoryAct(ctx, { action: 'review', week: wk2.id }); });
const win = await sql`select i.campaign_id, i.error, c.status, c.daily_budget, c.days from ad_factory_items i left join ad_campaigns c on c.id = i.campaign_id where i.week_id = ${wk2.id} and i.state = 'winner'`;
const made = win.filter((w) => w.campaign_id);
check('with an ad account: the winners become PAUSED paid ads at the factory budget (150 x 4 days) - or say why not', win.length === Math.min(2, nItems) && (made.length === 2 ? made.every((w) => w.status === 'ready' && Number(w.daily_budget) === 150 && w.days === 4) : win.every((w) => w.error)), win);
if (made.length) {
  r = await mgr('erpFactoryAct', [{ action: 'start', week: wk2.id }]);
  check('a manager cannot start the winners (money)', !r.ok, r);
  r = await owner('erpFactoryAct', [{ action: 'start', week: wk2.id }]);
  check('the owner starts them with one button', r.ok && r.result.done.started === made.length && (await sql`select count(*)::int n from ad_campaigns where id = any(${made.map((w) => w.campaign_id)}) and status = 'running'`)[0].n === made.length, r);
}

// ---- 6. the other business
check('the other business has no factory weeks', (await sql`select count(*)::int n from ad_factory_weeks where business_id = ${FIX.B2}`)[0].n === 0);
done();
