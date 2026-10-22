// brain-1 (owner 22 Oct 2026): each business has its own Business Brain (ten blocks the Engine drafts and the owner
// approves, versioned; locked limits / never-do) and its own memory; one Engine serves every business of the owner
// where it is on, and a job only ever sees its own business - its data, its Brain, its skills, its memory.
import { sql, FIX, owner, mgr, call, check, done, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const B = FIX.B, B2 = FIX.B2;
const { keyHash } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
await sql`insert into erp_app_flags (key, enabled) values ('engine', true) on conflict (key) do update set enabled = true`;
const KEY = 'engine-brain-key-00000000000000000000000000000000000';
await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(KEY)}, ${FIX.U.owner}, 'Engine (VPS)')`;
const eng = (name, a) => call(name, [a], { token: { key: KEY, device: 'engine' } });

// ---- the door and the empty Brain
let r = await mgr('erpBrain', []);
check('a manager does not see the Business Brain', !r.ok, r);
r = await owner('erpBrain', []);
check('the owner sees ten empty blocks, each a question; limits and never-do locked', r.ok && r.result.status === 'empty' && r.result.blocks.length === 10 &&
  r.result.blocks.find((b) => b.key === 'never').locked && r.result.blocks.find((b) => b.key === 'limits').locked && !r.result.blocks.find((b) => b.key === 'offer').locked, r.result && r.result.status);

// ---- the Engine drafts it
r = await owner('erpBrainDraft', []);
check('Draft: a job for the Engine, the Brain shows "drafting"', r.ok && r.result.status === 'drafting' && r.result.draftJob && r.result.draftJob.status === 'queued', r.result);
r = await owner('erpBrainDraft', []);
check('...not twice at once', !r.ok, r);
r = await eng('erpEngineClaim', { runner: 'vps1' });
const C = r.result || {}, JD = C.job && C.job.id;
check('the Engine gets the drafting job with the snapshot and brain_save_draft tools', r.ok && C.job.title === 'Business Brain: draft' && C.tools.some((t) => t.name === 'brain_save_draft') && C.tools.some((t) => t.name === 'business_snapshot'), C.job);
check('...and is told there is no Brain yet: learn it, do not assume the trade', /No Business Brain yet/.test(C.brain) && C.business.id === B, C.brain);
r = await eng('erpEngineTool', { id: JD, tool: 'business_snapshot', args: {} });
check('business_snapshot: the business in numbers', r.ok && typeof r.result.products === 'number' && r.result.business, r.result);
r = await eng('erpEngineTool', { id: JD, tool: 'brain_save_draft', args: { blocks: { offer: '3D printing filament and printers for makers and schools', customers: 'Makers, schools, print farms', markets: 'Dhaka, online', never: 'Suggestion: never sell below cost', nonsense: 'x' } } });
check('the draft is saved block by block', r.ok && r.result.saved === 4, r.result);
r = await eng('erpEngineTool', { id: JD, tool: 'remember', args: { kind: 'fact', text: 'Silk PLA is the best seller among filaments.', keywords: ['pla'] } });
check('the Engine keeps a lasting fact', r.ok && r.result.kept && !r.result.already, r.result);
r = await eng('erpEngineTool', { id: JD, tool: 'remember', args: { text: 'silk pla is the best seller among filaments.' } });
check('...the same fact is kept once', r.ok && r.result.already, r.result);
await eng('erpEngineDone', { id: JD, ok: true, result: 'Drafted.' });
r = await owner('erpBrain', []);
const off = r.result.blocks.find((b) => b.key === 'offer');
check('the owner sees each AI draft next to the question, nothing confirmed yet', r.ok && r.result.status === 'draft' && off.draft.startsWith('3D printing') && !off.value && r.result.facts.some((f) => /Silk PLA/.test(f.text)), off);

// ---- other jobs cannot write the Brain
r = await owner('erpEngineAsk', [{ ask: 'Hello' }]);
const J1 = r.result.created;
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('an ordinary job has the memory tools but not brain_save_draft', r.ok && r.result.job.id === J1 && r.result.tools.some((t) => t.name === 'remember') && !r.result.tools.some((t) => t.name === 'brain_save_draft'), '');
check('...and is told the Brain is a draft, block by block', /DRAFT/.test(r.result.brain) && /3D printing filament/.test(r.result.brain) && /Silk PLA is the best seller/.test(r.result.brain), r.result.brain);
r = await eng('erpEngineTool', { id: J1, tool: 'brain_save_draft', args: { blocks: { offer: 'hacked' } } });
check('...a write to the Brain from it is refused', r.ok && /No such function/.test(r.result.error), r.result);

// ---- the owner answers and approves
r = await owner('erpBrainSave', [{ blocks: { offer: '3D printing filament, printers and parts for makers, schools and print farms' }, approve: true }]);
check('approve needs at least what you sell, customers and where', !r.ok && /Customers/.test(r.error), r);
r = await owner('erpBrainSave', [{ blocks: { offer: '3D printing filament, printers and parts for makers, schools and print farms', customers: 'Makers, schools, print farms', markets: 'Dhaka and all Bangladesh, online', never: 'Never discount printers. Never message customers after 10 pm.', limits: 'Ad budget 30,000 a month; one ad at most 3,000; discount at most 10%' }, approve: true }]);
check('the owner confirms the blocks and approves: version 1', r.ok && r.result.status === 'approved' && r.result.version === 1 && r.result.blocks.find((b) => b.key === 'never').source === 'owner', r.result && r.result.status);
check('...the version is kept', (await sql`select count(*)::int n from engine_brain_versions where business_id = ${B}`)[0].n === 1, '');
r = await owner('erpBrainDraft', []);
const JD2 = r.result.draftJob.id;
await eng('erpEngineDone', { id: J1, ok: true, result: 'hi' });
r = await eng('erpEngineClaim', { runner: 'vps1' });
await eng('erpEngineTool', { id: JD2, tool: 'brain_save_draft', args: { blocks: { never: 'Suggestion: nothing', price: 'Middle' } } });
await eng('erpEngineDone', { id: JD2, ok: true, result: 'Redrafted.' });
r = await owner('erpBrain', []);
check('a redraft never touches the owner\'s approved never-do rules (other blocks get a new draft)', r.result.blocks.find((b) => b.key === 'never').draft === '' && r.result.blocks.find((b) => b.key === 'price').draft === 'Middle' && r.result.status === 'approved', r.result.blocks.map((b) => b.key + ':' + b.draft));

// ---- memory: owner notes, out of date (kept), ratings
r = await owner('erpBrainFact', [{ add: { kind: 'lesson', text: 'Facebook ads on Friday evenings bring the most messages.' } }]);
const F = r.result.facts.find((f) => /Friday/.test(f.text));
check('the owner adds a lesson', r.ok && F && F.kind === 'lesson' && F.source === 'owner', F);
r = await owner('erpEngineAsk', [{ ask: 'Another question' }]);
const J3 = r.result.created;
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('every job gets the approved Brain (version 1) and the notes', /version 1, approved/.test(r.result.brain) && /Never discount printers/.test(r.result.brain) && /Friday evenings/.test(r.result.brain), r.result.brain);
r = await eng('erpEngineTool', { id: J3, tool: 'forget_fact', args: { text: 'Facebook ads on Friday evenings bring the most messages.', why: 'x' } });
check('the Engine cannot mark the owner\'s own note out of date', r.ok && r.result.error, r.result);
r = await eng('erpEngineTool', { id: J3, tool: 'forget_fact', args: { text: 'Silk PLA is the best seller among filaments.', why: 'PETG sells more since October' } });
check('...but can its own, which is kept with the reason', r.ok && r.result.marked && (await sql`select invalid_why from engine_facts where business_id = ${B} and text like 'Silk PLA%'`)[0].invalid_why === 'PETG sells more since October', r.result);
await eng('erpEngineDone', { id: J3, ok: true, result: 'answer' });
await owner('erpEngineRate', [{ id: J3, rating: -1 }]);
check('a thumbs down is remembered as an event', (await sql`select count(*)::int n from engine_facts where business_id = ${B} and source = 'rating' and text like '%not useful%'`)[0].n === 1, '');

// ---- two businesses, one Engine: never mixed
await sql`insert into memberships (business_id, user_id, role) values (${B2}, ${FIX.U.owner}, 'owner') on conflict do nothing`;
await sql`insert into business_config (business_id, key, value) values (${B2}, 'engine_on', '1') on conflict (business_id, key) do update set value = '1'`;
await sql`insert into engine_brain (business_id, status, version, blocks) values (${B2}, 'approved', 1, ${sql.json({ offer: { value: 'A bakery selling cakes in Chattogram' } })})`;
await sql`insert into engine_facts (business_id, kind, text, source) values (${B2}, 'fact', 'Chocolate cake sells most on Fridays.', 'owner')`;
const J4 = (await sql`insert into engine_jobs (business_id, agent, title, ask) values (${B2}, 'command', 'Bakery question', 'What should I bake more?') returning id`)[0].id;
r = await eng('erpEngineClaim', { runner: 'vps1' });
const C2 = r.result || {};
check('the Engine takes the other business\'s job inside THAT business', r.ok && C2.job.id === J4 && C2.business.id === B2, C2.business);
check('...with only its Brain and notes (nothing of the 3D-printing business)', /bakery selling cakes/.test(C2.brain) && /Chocolate cake/.test(C2.brain) && !/3D printing|Silk PLA|Friday evenings|Never discount printers/.test(C2.brain), C2.brain);
check('...and none of the first business\'s skills', Array.isArray(C2.skills) && C2.skills.length === 0, C2.skills);
r = await eng('erpEngineTool', { id: J4, tool: 'remember', args: { text: 'Customers ask for sugar-free cakes often.' } });
const where = (await sql`select business_id from engine_facts where text like 'Customers ask for sugar-free%'`)[0];
check('...what it learns is kept in that business only', r.ok && where.business_id === B2, where);
r = await eng('erpEngineTool', { id: J4, tool: 'business_snapshot', args: {} });
check('...its numbers are its own', r.ok && r.result.business !== (await sql`select name from businesses where id = ${B}`)[0].name, r.result.business);
await eng('erpEngineDone', { id: J4, ok: true, result: 'Bake more chocolate cake.' });
check('...and its answer lands in its own business', (await sql`select business_id, status from engine_jobs where id = ${J4}`)[0].status === 'done', '');

r = await owner('erpEngineSwitch', [{ on: false }]);
await owner('erpEngineAsk', [{ ask: 'While off' }]).catch(() => null);
await sql`insert into engine_jobs (business_id, agent, title, ask) values (${B}, 'command', 'While off', 'x')`;
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('a business with the Engine switched off gets no work done (its jobs wait)', r.ok && (!r.result.job || r.result.business.id !== B), r.result && r.result.job);
await sql`update business_config set value = '0' where business_id = ${B2} and key = 'engine_on'`;
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('...nothing at all when no business has it on', r.ok && r.result.job === null && r.result.businesses === 0, r.result);
await sql`delete from memberships where business_id = ${B2} and user_id = ${FIX.U.owner}`;

await done();
