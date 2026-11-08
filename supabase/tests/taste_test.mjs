// taste-1 (handlers/taste.js): "not like this / like this" with the owner's reason, his own formula, reset - and the next
// ChatGPT picture prompt (and the video script writer's words) carry them.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const taste = await import(pathToFileURL(path.join(fnDir, 'handlers', 'taste.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
const gw = [];
web.on(/gw\.test\/v1/, (url, opts) => {
  const body = opts.body ? JSON.parse(opts.body) : null; gw.push({ url, body });
  if (/\/images\/jobs$/.test(url)) return { status: 200, body: { id: 'b'.repeat(32), state: 'queued' } };
  return { status: 200, body: { state: 'working' } };
});
await sql`insert into erp_provider_secrets (key, value_enc) values ('CUSTOM_AI_KEY', 'v0.gwsecret'), ('CUSTOM_AI_BASE', 'v0.https://gw.test/v1') on conflict (key) do update set value_enc = excluded.value_enc`;
await deps.storage.save(FIX.B, 'products', 'taste.jpg', Buffer.concat([Buffer.from('\xff\xd8\xff'), Buffer.alloc(300, 2)]), 'image/jpeg');
const sku = (await sql`select sku from products where business_id = ${FIX.B} limit 1`)[0].sku;
await sql`update products set photo = 'taste.jpg' where business_id = ${FIX.B} and sku = ${sku}`;

let r = await mgr('erpTaste', [{ kind: 'photo' }]);
check('nothing set at first', r.ok && r.result.formula === '' && r.result.notes.length === 0, r);
check('...and the AI is told nothing extra', (await asB((ctx) => taste.tasteText(ctx, 'photo'))) === '');
// a picture to judge
r = await sales('erpSocialAiPhoto', [{ sku, scene: 'studio' }]);
const asset = r.ok && r.result.asset;
check('set-up: a ChatGPT picture', asset && asset.id, r);
r = await mgr('erpTasteNote', [{ kind: 'photo', verdict: 'no', why: 'too dark', assetId: asset.id }]);
check('a manager cannot teach the taste (the owner\'s)', !r.ok, r);
r = await owner('erpTasteNote', [{ kind: 'photo', verdict: 'no', why: 'x', assetId: asset.id }]);
check('a reason of a few words is needed', !r.ok && /why/.test(r.error), r);
r = await owner('erpTasteNote', [{ kind: 'photo', verdict: 'no', why: 'Too dark and the spool looks fake; I want bright daylight', assetId: asset.id }]);
check('"not like this" with the reason: kept, named after the picture', r.ok && r.result.notes[0].verdict === 'no' && /bright daylight/.test(r.result.notes[0].why) && r.result.notes[0].what, r);
check('...and the rejected picture is hidden', (await sql`select status, meta->>'verdictWhy' w from social_assets where id = ${asset.id}`)[0].status === 'removed');
r = await owner('erpTasteNote', [{ kind: 'photo', verdict: 'yes', why: 'a wooden desk with a printer behind feels real' }]);
r = await owner('erpTasteSet', [{ kind: 'photo', formula: 'Always daylight, never black backgrounds, the logo of the brand visible' }]);
check('the owner writes his formula', r.ok && /never black/.test(r.result.formula) && r.result.notes.length === 2, r);
const text = await asB((ctx) => taste.tasteText(ctx, 'photo'));
check('the AI is told the formula, what he rejected and what he liked', /never black/.test(text) && /NOT like[\s\S]*bright daylight/.test(text) && /liked[\s\S]*wooden desk/.test(text), text);
gw.length = 0;
r = await sales('erpSocialAiPhoto', [{ sku, scene: 'minimal' }]);
const sent = gw.find((x) => /\/images\/jobs$/.test(x.url));
check('the next ChatGPT picture prompt carries his taste', sent && /never black backgrounds/.test(sent.body.prompt) && /bright daylight/.test(sent.body.prompt), sent && sent.body.prompt);
// video is separate
r = await owner('erpTasteSet', [{ kind: 'video', formula: 'Short cuts, my own voice, no music with words' }]);
check('videos have their own formula', r.ok && r.result.kind === 'video' && /own voice/.test(await asB((ctx) => taste.tasteText(ctx, 'video'))) && !/own voice/.test(await asB((ctx) => taste.tasteText(ctx, 'photo'))), r);
// forget one, then reset with a new formula
const note = (await owner('erpTaste', [{ kind: 'photo' }])).result.notes[0];
r = await owner('erpTasteForget', [{ kind: 'photo', at: note.at }]);
check('one note can be dropped', r.ok && r.result.notes.length === 1, r);
r = await owner('erpTasteReset', [{ kind: 'photo', formula: 'Bright, minimal, white table' }]);
check('reset: notes forgotten, the new formula in force', r.ok && r.result.notes.length === 0 && r.result.formula === 'Bright, minimal, white table' && r.result.resetAt, r);
const after = await asB((ctx) => taste.tasteText(ctx, 'photo'));
check('...the AI is told only the new formula', /white table/.test(after) && !/bright daylight/.test(after) && !/never black/.test(after), after);
check('the other business has no taste set', !(await sql`select 1 from business_config where business_id = ${FIX.B2} and key like 'taste_%'`).length);
done();
