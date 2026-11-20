// score-ui-1 (20 Nov 2026): the universal score button and the "স্কোর কীভাবে এল" popup.
// Server: erpBrandDeskFit passes the engine's `scorecard` through untouched and erpBrandDeskDrafts passes `uscore`
// (no handler change was needed; this pins it). Page: the score-ui-1 block of web/app.html is run in a tiny fake
// window and its renderers are checked: bands and Bangla digits on the chip, aria-label, "এখনো যাচাই হয়নি" when there
// is no score, AI-estimate label, ±spread, before->after, who-judged chips, judge disagreement, what changed / what is
// left, the owner-is-final note, and that the hooks into the cockpit and the Content desk are in place.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { sql, FIX, owner, mgr, check, done, web, fnDir } from './harness.mjs';

const B = FIX.B, KEY = 's'.repeat(40), URL = 'https://score-test.trycloudflare.com';
const SC = {
  score: 88, estimate: true, spread: 4, note: 'এটা AI-এর আনুমানিক স্কোর; শেষ সিদ্ধান্ত আপনার রিভিউ।', learned: 3,
  parts: [
    { key: 'virality', name: 'ভাইরালিটি (facebook)', score: 86, before: 64, changed: ['hook', 'hashtags'], gate: [],
      who: ['কোড নিয়ম (ভাঁজ, ট্যাগ, লিংক, দৈর্ঘ্য, বেইট)', 'AI বিচারক ×2 (gpt-5.5)', 'ffmpeg মাপ (দৈর্ঘ্য, কাট, শব্দ)', 'ভিশন বিচারক (৫টা ফ্রেম)'],
      items: [{ name: 'হুক', score: 90, checks: [{ t: 'প্রথম লাইন ১০ শব্দ', ok: true }, { t: 'প্রশ্ন নেই', ok: false }], judge: { stop: 2, curiosity: 1.5, clear: 0 }, fixes: ['[hook] Start with the number'] }],
      audit: [{ module: 'caption', module_score: 70, fix: 'Cut the second paragraph <b>' }] },
    { key: 'plan', name: 'প্ল্যান আর ব্লুপ্রিন্ট', score: 80, who: ['কোড: গবেষণা আর ৬০ দিনের প্ল্যানের নিয়ম'], items: [{ name: 'ভাষা', ok: true, t: 'বাংলা' }, { name: 'ডাক', ok: false, t: 'কেনার ডাক আছে' }] },
    { key: 'claims', name: 'দাবি আর নিষেধ', score: 100, who: ['কোড: নিষেধ, বিক্রি, দাবি-যাচাই (plan_guard, lint)'], items: [] },
  ],
};

// ---- server: the bridge's answer reaches the page untouched
await sql`insert into erp_app_flags (key, enabled) values ('branddesk', true) on conflict (key) do update set enabled = true`;
await sql`insert into business_config (business_id, key, value) values (${B}, 'brand_bridge', ${JSON.stringify({ url: URL, seen: new Date().toISOString() })})
          on conflict (business_id, key) do update set value = excluded.value`;
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'BRAND_BRIDGE_KEY', ${KEY}) on conflict (business_id, key) do update set value = excluded.value`;
web.on(/^https:\/\/score-test\.trycloudflare\.com\//, (url, opts) => {
  if (opts.headers['X-Bridge-Key'] !== KEY) return { status: 401, body: { error: 'wrong key' } };
  if (url.endsWith('/fit')) { const b = JSON.parse(opts.body); return { body: { id: b.id, platform: 'facebook', score: [4, 5], rules: [], steps: [], scorecard: b.id === 227 ? SC : null } }; }
  if (url.endsWith('/drafts')) return { body: { waiting: [{ id: 227, platform: 'facebook', body: 'x', fit: [4, 5], uscore: 88 }, { id: 228, platform: 'linkedin', body: 'y', fit: [5, 5], uscore: null }], ideas: [], jobs: {}, networks: [] } };
  return { status: 404, body: { error: 'no route' } };
});
let r = await owner('erpBrandDeskFit', [{ id: 227 }]);
check('the fit report carries the scorecard as the engine sent it', r.ok && r.result.scorecard && r.result.scorecard.score === 88 && r.result.scorecard.spread === 4 && r.result.scorecard.parts.length === 3 && r.result.scorecard.parts[0].before === 64, r);
r = await owner('erpBrandDeskFit', [{ id: 300 }]);
check('a draft without a scorecard yet comes back as null, not an error', r.ok && r.result.scorecard === null, r);
r = await owner('erpBrandDeskDrafts', []);
check('each waiting draft carries uscore (a number or null)', r.ok && r.result.waiting[0].uscore === 88 && r.result.waiting[1].uscore === null, r);
r = await mgr('erpBrandDeskFit', [{ id: 227 }]);
check('a manager does not get the score report', !r.ok, r);

// ---- page: run the score-ui-1 block
const html = fs.readFileSync(path.join(fnDir, '..', '..', '..', 'web', 'app.html'), 'utf8');
const i0 = html.indexOf('<!-- score-ui-1');
check('the score-ui-1 block is in the page', i0 > 0);
const js = html.slice(i0).match(/<script>([\s\S]*?)<\/script>/)[1];
const BN = '০১২৩৪৫৬৭৮৯';
const listeners = {};
const ctx = {
  bn: (n) => String(n).replace(/[0-9]/g, (d) => BN[d]),
  esc: (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  srv: () => {}, toast: () => {},
  document: { addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); }, getElementById: () => null, querySelector: () => null, createElement: () => ({}), body: { appendChild: () => {} }, contains: () => false },
  setTimeout: () => 0,
};
ctx.window = ctx; ctx.window.addEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(js, ctx);
const U = ctx.scUi;
check('scUi is exposed', !!U && typeof U.chip === 'function' && typeof U.body === 'function' && typeof U.top === 'function');

let c = U.chip(91, 'data-bc="score" data-id="5"');
check('chip: good band, Bangla digits, the number is the button', /class="sc-chip good"/.test(c) && /<b>৯১<\/b>/.test(c) && /data-bc="score" data-id="5"/.test(c) && /aria-haspopup="dialog"/.test(c), c);
check('chip: aria-label names the score', /aria-label="সব চেকের স্কোর ৯১, কী কী দিয়ে দেখুন"/.test(c), c);
check('chip: 85 is good, 84 and 60 are mid, 59 is weak', /sc-chip good/.test(U.chip(85, '')) && /sc-chip mid/.test(U.chip(84, '')) && /sc-chip mid/.test(U.chip(60, '')) && /sc-chip weak/.test(U.chip(59, '')));
c = U.chip(null, '');
check('chip: no score says এখনো যাচাই হয়নি (never 0)', /sc-chip na/.test(c) && /এখনো যাচাই হয়নি/.test(c) && !/<b>/.test(c), c);
check('chip: undefined (old engine) is the same as no score', /sc-chip na/.test(U.chip(undefined, '')));

let t = U.top(SC, 'data-bc="score" data-id="227"');
check('plan sheet top: the same number as a button that opens the popup', /class="sc-top good"/.test(t) && /৮৮/.test(t) && /data-bc="score" data-id="227"/.test(t) && /AI-এর আনুমানিক/.test(t), t);
check('plan sheet top without a scorecard', /এখনো যাচাই হয়নি/.test(U.top(null, '')));

const b = U.body({ id: 227, scorecard: SC }, 227);
check('popup: big number with the band and the honest AI-estimate label', /sc-hero good/.test(b) && /<span class="sc-fig">৮৮<\/span>/.test(b) && /ভালো/.test(b) && /AI-এর আনুমানিক স্কোর/.test(b), b.slice(0, 400));
check('popup: ±spread next to the number', /class="sc-spr"[^>]*>±৪</.test(b));
check('popup: before -> after for the virality part', /আগে ৬৪/.test(b) && /এখন ৮৬/.test(b) && /\+২২/.test(b));
check('popup: the engine note is shown (owner review decides)', b.includes(SC.note) && /sc-final/.test(b));
check('popup: judge ran twice and the ± difference is said in words', /দুই বার পড়েছে/.test(b) && /±৪ পার্থক্য/.test(b) && /১টা প্রশ্নে মত আলাদা/.test(b));
check('popup: one row per part with its share of the total', (b.match(/class="sc-row"/g) || []).length === 3 && /মোটের ৪৫% ভাগ/.test(b) && /মোটের ২৫% ভাগ/.test(b));
check('popup: who judged as typed chips (AI, কোড, মাপ, ছবি দেখে)', /<i>AI<\/i><span>AI বিচারক ×2 \(gpt-5.5\)/.test(b) && /<i>কোড<\/i>/.test(b) && /<i>মাপ<\/i>/.test(b) && /<i>ছবি দেখে<\/i>/.test(b));
check('popup: code-rule prefix dropped inside the chip', /<i>কোড<\/i><span>গবেষণা আর ৬০ দিনের/.test(b));
check('popup: checks with tick and cross', /class="ok"[^]*প্রথম লাইন ১০ শব্দ/.test(b) && /class="bad"[^]*প্রশ্ন নেই/.test(b));
check('popup: judge answers summed (yes / partly-split / no)', /AI বিচারকের উত্তর \(৩টা প্রশ্ন\): ১টা হ্যাঁ · ১টা না · ১টায় দুই বিচারের মত আলাদা/.test(b), b.match(/AI বিচারকের উত্তর[^<]*/));
check('popup: what AI changed', /AI যা বদলেছে/.test(b) && /<span>হুক<\/span>/.test(b) && /<span>হ্যাশট্যাগ<\/span>/.test(b));
check('popup: what is left comes from the audit, escaped', /যা এখনও ভালো করা যায়/.test(b) && /Cut the second paragraph &lt;b&gt;/.test(b) && !/paragraph <b>/.test(b));
check('popup: plan items carry tick/cross with the rule name', /<em>ডাক<\/em>/.test(b));
check('popup: a part with nothing broken says so', /কোনো নিষেধ ভাঙেনি/.test(b));
check('popup: rows start closed (details hidden)', (b.match(/class="sc-det"[^>]*hidden/g) || []).length === 3);
check('popup: AI text is never translated', /data-noi18n="1"/.test(b));

// open a row, then a redraw keeps it open
const fakeBtn = { getAttribute: () => '227_virality', setAttribute: () => {}, closest: () => fakeBtn };
listeners.click.forEach((f) => f({ target: { closest: (q) => (q === '[data-scp]' ? fakeBtn : null) } }));
const b2 = U.body({ id: 227, scorecard: SC }, 227);
check('an opened row stays open across a redraw', /data-scp="227_virality" aria-expanded="true"/.test(b2) && (b2.match(/class="sc-det"[^>]*hidden/g) || []).length === 2);

const n0 = U.body({ id: 9, scorecard: null }, 9);
check('popup without a scorecard: এখনো যাচাই হয়নি + what will show + owner is final', /sc-hero na/.test(n0) && /এখনো যাচাই হয়নি/.test(n0) && /ভাইরাল চেক চললে/.test(n0) && /শেষ কথা আপনার রিভিউ/.test(n0) && !/sc-row/.test(n0));
const g = U.body({ scorecard: { score: 40, parts: [{ key: 'virality', name: 'ভাইরালিটি', score: 40, gate: ['এনগেজমেন্ট বেইট ("comment YES")'], who: ['AI বিচারক ×1'], items: [] }] } }, 'g');
check('popup: hard stops show in red above the parts, weak band', /sc-hero weak/.test(g) && /বাধা আছে/.test(g) && /comment YES/.test(g) && /এক বার পড়েছে/.test(g));

// ---- hooks in the two screens
check('cockpit card: chip before "প্ল্যানের সাথে মিল"', /scUi\.chip\(x\.uscore, 'data-bc="score" data-id="' \+ id \+ '"'\)/.test(html));
check('cockpit: score sheet route + click + plan-sheet top', html.includes("indexOf('score:') === 0) return scoreSheetHtml(") && html.includes("else if (w === 'score')") && html.includes('scUi.top(f.scorecard'));
check('cockpit: the score sheet is titled স্কোর কীভাবে এল on pnSheet', html.includes("return pnSheet('স্কোর কীভাবে এল'"));
check('Content desk card: the same chip opens the block sheet', html.includes("scUi.chip(d.uscore, 'data-sccd=\"' + d.id + '\"')"));
done();
