// shots-1 (handlers/aishots.js, lib/shots.js): Realistic AI shots. The business's own ChatGPT (fake gateway) plans a reel as
// a shot list; the plan is checked (schema, start + end still for a change of state, one motion, physics for heavy things,
// voice-over claims against the facts) and sent back once with the problems; a good plan becomes the prompt pack
// (build_prompt.py port). Profiles never mix (costareen / oliareen); Claude is never used; the "Only me" gate; the engine
// pack upload (platform admin); the other business untouched.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, web, fnDir } from './harness.mjs';

const S = await import(pathToFileURL(path.join(fnDir, 'lib', 'shots.js')));
const B = FIX.B, SKU = 'PRT-BAM-A1-001';

// ---- the plans the fake ChatGPT gives, one per call
const cam = { movement: 'slow push-in', start: 'medium shot of the desk', speed: 'slow and steady', framing: 'printer in the centre', end: 'close-up of the nozzle', time: 'real time, normal speed, no slow motion' };
const shot = (n, o) => ({ n, purpose: 'product', seconds: 5, model: 'veo', start_frame: 'A Bambu A1 3D printer on a sturdy wooden table in a small Dhaka workshop, daylight from a window on the left, 35mm lens, medium shot.', end_frame: null, camera: cam, action: 'The print head moves slowly across the bed', physics: null, light: 'Daylight from a window on the left, soft', mood: 'calm', sound: 'printer fan hum, no music, no speech', onscreen_text: null, ...o });
const good = (biz) => ({ business: biz, platform: 'reels', aspect_ratio: '9:16', goal: 'conversion: inbox for the price', facts_used: ['Product: Bambu A1', 'Price: BDT 52000'],
  vo: [{ shot: 1, text: 'Bambu A1, দাম ৫২০০০ টাকা।' }, { shot: 2, text: 'ইনবক্স করুন।' }],
  shots: [shot(1, { purpose: 'hook' }), shot(2, { purpose: 'cta', action: 'The closed box is opened and the printer is revealed', end_frame: 'Same place, light and camera: the printer stands on the table next to the open box.' })] });
let queue = [], asked = [];
web.on(/gw\.test\/v1/, (url, opts) => {
  if (/chat\/completions$/.test(url)) {
    asked.push(JSON.parse(String(opts.body || '{}')));
    const next = queue.length ? queue.shift() : {};
    return { status: 200, body: { choices: [{ message: { role: 'assistant', content: JSON.stringify(next) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } } };
  }
  return { status: 404, body: {} };
});
let claude = 0;
web.on(/api\.anthropic\.com/, () => { claude++; return { status: 200, body: { content: [{ type: 'text', text: '{}' }], usage: {} } }; });
await sql`insert into erp_provider_secrets (key, value_enc) values ('CUSTOM_AI_KEY', 'v0.gwsecret'), ('CUSTOM_AI_BASE', 'v0.https://gw.test/v1') on conflict (key) do update set value_enc = excluded.value_enc`;
await owner('erpAiBrainSet', [{ routes: { default: { provider: 'custom', model: 'gpt-5.6-sol' }, tasks: {}, cheap: [] } }]);

// ---- 1. pure parts: the port of build_prompt.py and the rules
const pk = S.promptPack(good('costareen'), S.FALLBACK);
check('prompt pack: shot 1 has a start still and a video prompt, no end still', pk[0].start.includes('Bambu A1 3D printer') && pk[0].start.endsWith('Aspect ratio 9:16. photorealism') && pk[0].end === '' && pk[0].video.startsWith('Movement: slow push-in. Start: medium shot of the desk.'), pk[0]);
check('prompt pack: the state-change shot has an end still; video ends with the sound line', pk[1].end.startsWith('Same place, light and camera') && /Sound: printer fan hum, no music, no speech\.$/.test(pk[1].video), pk[1]);
const heavy = S.promptPack({ aspect_ratio: '9:16', shots: [shot(1, { physics: 'The box moves straight down and lands flat' })] }, S.FALLBACK)[0];
check('a physics line brings the physics sentence before it', heavy.video.includes(S.FALLBACK.physics + ' The box moves straight down and lands flat.'), heavy.video);
check('a good plan passes the rules', S.validatePlan(good('costareen'), { profile: 'costareen', aspect: '9:16' }).length === 0, S.validatePlan(good('costareen'), { profile: 'costareen', aspect: '9:16' }));
let e = S.validatePlan({ ...good('costareen'), shots: [shot(1, { action: 'The lid opens' })], vo: [] }, { profile: 'costareen' });
check('state change without an end still is refused', e.some((x) => /end_frame/.test(x)), e);
e = S.validatePlan({ ...good('costareen'), shots: [shot(1, { action: 'A man lifts the printer box onto the table' })], vo: [] }, { profile: 'costareen' });
check('a heavy thing moving without physics is refused', e.some((x) => /physics/.test(x)), e);
e = S.validatePlan({ ...good('costareen'), shots: [shot(1, { action: 'He walks in, then sits, then smiles' })], vo: [] }, { profile: 'costareen' });
check('more than one motion is refused', e.some((x) => /one cause, one motion/.test(x)), e);
e = S.validatePlan({ ...good('costareen'), shots: [shot(1, { seconds: 12 })], vo: [] }, { profile: 'costareen' });
check('a 12-second veo shot is refused', e.some((x) => /at most 8 seconds/.test(x)), e);
e = S.validatePlan(good('oliareen'), { profile: 'costareen' });
check('a plan for the other business is refused (never mix)', e.some((x) => /never mix/.test(x)), e);
e = S.validatePlan({ ...good('costareen'), aspect_ratio: '16:9' }, { profile: 'costareen', aspect: '9:16' });
check('the wrong aspect ratio is refused', e.some((x) => /aspect ratio must be 9:16/.test(x)), e);
const cam5 = { ...cam }; delete cam5.speed;
e = S.validatePlan({ ...good('costareen'), shots: [shot(1, { camera: cam5 })], vo: [] }, {});
check('a camera without its six slots is refused', e.some((x) => /"speed"/.test(x)), e);
const facts = 'Shop: Test\nProduct: Bambu A1\nPrice: BDT 52000\nBrand: Bambulab';
check('voice-over claims in the facts pass (Bangla digits too)', S.factCheck(good('costareen'), facts).ok, S.factCheck(good('costareen'), facts));
let fc = S.factCheck({ ...good('costareen'), vo: [{ shot: 1, text: 'দাম মাত্র ৪৯৯৯৯ টাকা, 2 years warranty!' }] }, facts);
check('an invented price and warranty in the voice-over are refused', !fc.ok && fc.problems.some((x) => /49999/.test(x)) && fc.problems.some((x) => /"years"|"warranty"/.test(x)), fc);
fc = S.factCheck({ ...good('costareen'), facts_used: ['Prints at 500 mm/s'] }, facts);
check('a facts_used line not in the facts is refused', !fc.ok && /not in the facts given/.test(fc.problems[0]), fc);
const w = (n) => Array(n).fill('শব্দ').join(' ');
e = S.validatePlan({ ...good('costareen'), vo: [{ shot: 1, text: w(14) }, { shot: 2, text: w(4) }] }, { profile: 'costareen' });
check('pace: a line may run a little into the next shot (14 Bangla words on a 5 s shot, 18 in 10 s)', e.length === 0, e);
e = S.validatePlan({ ...good('costareen'), vo: [{ shot: 1, text: w(24) }] }, { profile: 'costareen' });
check('pace: far too long for its shot is refused', e.some((x) => /far too long/.test(x)), e);
e = S.validatePlan({ ...good('costareen'), vo: [{ shot: 1, text: w(16) }, { shot: 2, text: w(16) }] }, { profile: 'costareen' });
check('pace: the whole voice-over must fit the whole video', e.some((x) => /whole voice-over/.test(x)), e);
e = S.validatePlan({ ...good('oliareen'), vo: [{ shot: 1, text: 'This cream cures acne.' }] }, { profile: 'oliareen' });
check('oliareen: a medical claim is refused', e.some((x) => /medical/.test(x)), e);

// ---- 2. the gate: "Only me" app, owner only
let r = await mgr('erpVideoShots', [{}]);
check('a manager is refused', !r.ok, r);
r = await owner('erpVideoShots', [{}]);
check('the owner of a company that is not the provider\'s: closed until the app is open', !r.ok && /not open/.test(r.error), r);
await sql`insert into erp_app_flags (key, enabled) values ('aishots', true) on conflict (key) do update set enabled = true`;
r = await owner('erpVideoShots', [{}]);
check('open: profile costareen guessed from what the shop sells, fallback pack, no generator, no plans', r.ok && r.result.profile === 'costareen' && r.result.pack === 'fallback' && r.result.generators.length === 0 && r.result.plans.length === 0, r);

// ---- 3. a plan: first answer breaks a rule (no end still on a reveal), the second is good
const bad1 = good('costareen'); bad1.shots[1] = { ...bad1.shots[1], end_frame: null };
queue = [bad1, good('costareen')]; asked = [];
r = await owner('erpVideoPlan', [{ sku: SKU, platform: 'reels', seconds: 20, lang: 'bn' }]);
check('plan made on the second try, kept, with prompts', r.ok && r.result.valid && r.result.tries === 2 && r.result.plan.prompts.length === 2 && r.result.plan.prompts[1].end !== '', r);
check('the AI was the business\'s own gateway (ChatGPT), never Claude', asked.length === 2 && asked[0].model === 'gpt-5.6-sol' && claude === 0, { n: asked.length, m: asked[0] && asked[0].model, claude });
const sys0 = (asked[0].messages || []).map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
check('the planner got the rules, the costareen profile and the product facts - and nothing of oliareen', /Stills? first|STILL/i.test(sys0) && /Business profile: costareen/.test(sys0) && /Price: BDT 52000/.test(sys0) && !/Business profile: oliareen/.test(sys0), sys0.slice(0, 300));
const sys1 = (asked[1].messages || []).map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
check('the second try was told why the first was refused', /refused for these reasons/.test(sys1) && /end_frame/.test(sys1), sys1.slice(-400));
r = await owner('erpVideoShots', [{}]);
check('the plan is in the list with its prompts', r.ok && r.result.plans.length === 1 && r.result.plans[0].sku === SKU && r.result.plans[0].prompts[0].video.startsWith('Movement:'), r);

// ---- 4. refused twice: an invented price -> nothing kept
const lie = good('costareen'); lie.vo = [{ shot: 1, text: 'দাম মাত্র ৩৯৯৯৯ টাকা' }];
queue = [lie, lie];
r = await owner('erpVideoPlan', [{ sku: SKU, platform: 'reels', seconds: 20 }]);
check('an invented price twice: refused with the reason, nothing kept', r.ok && r.result.valid === false && r.result.errors.some((x) => /39999/.test(x)) && (await owner('erpVideoShots', [{}])).result.plans.length === 1, r);
queue = [good('oliareen'), good('oliareen')];
r = await owner('erpVideoPlan', [{ sku: SKU, platform: 'reels', seconds: 20 }]);
check('a plan for oliareen inside costareen: refused (never mix)', r.ok && r.result.valid === false && r.result.errors.some((x) => /never mix/.test(x)), r);

// ---- 5. the oliareen profile
await sql`insert into business_config (business_id, key, value) values (${B}, 'video_profile', 'oliareen') on conflict (business_id, key) do update set value = excluded.value`;
queue = [good('oliareen'), good('oliareen')]; asked = [];
r = await owner('erpVideoPlan', [{ sku: SKU, platform: 'feed', seconds: 20 }]);
check('feed asks for 4:5, so a 9:16 plan is refused', r.ok && r.result.valid === false && r.result.errors.some((x) => /4:5/.test(x)), r);
queue = [{ ...good('oliareen'), platform: 'feed', aspect_ratio: '4:5' }]; asked = [];
r = await owner('erpVideoPlan', [{ sku: SKU, platform: 'feed', seconds: 20, profile: 'costareen' }]);
const sysO = (asked[0].messages || []).map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
check('oliareen: women, beauty scenes, female voice; the page cannot ask for the other profile', r.ok && r.result.valid && r.result.profile === 'oliareen' && /Business profile: oliareen/.test(sysO) && /women/.test(sysO) && /female voice/.test(sysO) && !/Business profile: costareen/.test(sysO), r.ok ? r.result.profile : r);

// ---- 6. the engine pack (platform admin only) replaces the fallback words
r = await owner('erpVideoPackSet', [{ rules: 'x'.repeat(300) }]);
check('not the platform admin: the pack cannot be loaded', !r.ok, r);
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
r = await owner('erpVideoPackSet', [{ rules: 'PACK RULES ' + 'y'.repeat(300), realism: 'PACK REALISM.', physics: 'PACK PHYSICS.', version: 'v1-test' }]);
check('platform admin loads the pack', r.ok && r.result.pack === 'v1-test', r);
r = await owner('erpVideoShots', [{}]);
check('prompts now use the pack\'s realism words', r.ok && r.result.pack === 'v1-test' && r.result.plans[0].prompts[0].start.includes('PACK REALISM.'), r.ok ? r.result.plans[0].prompts[0].start : r);
queue = [{ ...good('oliareen'), platform: 'feed', aspect_ratio: '4:5' }]; asked = [];
await owner('erpVideoPlan', [{ sku: SKU, platform: 'feed', seconds: 20 }]);
check('the planner got the pack\'s rules', JSON.stringify(asked[0] || {}).includes('PACK RULES'), '');

// ---- 7. Claude is never used, even if it is the business's writing AI
await sql`insert into erp_provider_secrets (key, value_enc) values ('ANTHROPIC_KEY', 'v0.sk-ant-test') on conflict (key) do update set value_enc = excluded.value_enc`;
await owner('erpAiBrainSet', [{ routes: { default: { provider: 'anthropic', model: 'auto' }, tasks: {}, cheap: [] } }]);
r = await owner('erpVideoPlan', [{ sku: SKU, platform: 'reels', seconds: 20 }]);
check('Claude as the writer: refused with a plain reason, Claude not called', !r.ok && /ChatGPT/.test(r.error) && claude === 0, r);

// ---- 8. the personal brand business has its own studio
await sql`insert into business_config (business_id, key, value) values (${B}, 'business_kind', 'brand') on conflict (business_id, key) do update set value = excluded.value`;
r = await owner('erpVideoShots', [{}]);
check('a personal-brand business is sent to its own studio', !r.ok && /Brand desk/.test(r.error), r);
await sql`delete from business_config where business_id = ${B} and key = 'business_kind'`;

// ---- 9. the other business is untouched
const other = await sql`select count(*)::int n from business_config where business_id = ${FIX.B2} and key in ('video_plans', 'video_profile')`;
check('the other business has no plans', other[0].n === 0, other);
await done();
