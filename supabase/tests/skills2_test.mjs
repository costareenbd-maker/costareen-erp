// skills-2 (owner 23 Oct 2026): "a section where skills are suggested based on our needs, requirements and agents - the
// best ones growing on GitHub and newly out". A weekly timed job (or Suggest now) has the AI file ranked suggestions;
// the owner sees them with why, for which agent, popular / new; "Not useful" hides one; installed ones drop out.
import { sql, FIX, owner, call, check, done, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const B = FIX.B;
const { keyHash } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
await sql`insert into erp_app_flags (key, enabled) values ('engine', true) on conflict (key) do update set enabled = true`;
const KEY = 'engine-skills2-key-000000000000000000000000000000000';
await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(KEY)}, ${FIX.U.owner}, 'Engine (VPS)')`;
const eng = (name, a) => call(name, [a], { token: { key: KEY, device: 'engine' } });

let r = await owner('erpSkills', []);
check('the Skills screen has a "suggested for you" part (empty until the AI looks)', r.ok && r.result.suggest && r.result.suggest.items.length === 0, r.result && r.result.suggest);
const sch = (await sql`select every, weekday, at_time, enabled, ask from engine_schedules where business_id = ${B} and key = 'skills-suggest'`)[0];
check('...and it is refreshed by itself every Monday at 10:00', sch && sch.every === 'weekly' && sch.weekday === 1 && sch.at_time === '10:00' && sch.enabled && /Business Brain/.test(sch.ask), sch);
r = await owner('erpSkillSuggest', []);
check('Suggest now: a job for the AI', r.ok && r.result.suggest.job && r.result.suggest.job.status === 'queued', r.result && r.result.suggest);
r = await owner('erpSkillSuggest', []);
check('...not twice at once', !r.ok, r);
r = await eng('erpEngineClaim', { runner: 'vps1' });
const J = r.result.job;
check('the AI gets skills_installed and skill_suggest_save, and is told to look at new and growing skills', r.ok && J.title === 'Suggest skills' && r.result.tools.some((t) => t.name === 'skills_installed') && r.result.tools.some((t) => t.name === 'skill_suggest_save') && /topic:agent-skills/.test(J.ask) && /skills.sh/.test(J.ask), J);
r = await eng('erpEngineTool', { id: J.id, tool: 'skills_installed', args: {} });
check('skills_installed lists every agent with how many skills it has', r.ok && r.result.agents.length === 8 && r.result.agents.every((a) => a.skills === 0), r.result);
r = await eng('erpEngineTool', { id: J.id, tool: 'skill_suggest_save', args: { items: [
  { name: 'seo-audit', url: 'https://github.com/acme/skills/tree/main/seo-audit', repo: 'acme/skills', why: 'Checks the shop\'s product pages for SEO and gives exact fixes.', agents: ['seo', 'nonsense'], stars: 1200, isNew: false, category: 'SEO' },
  { name: 'ad-copy-bn', url: 'https://github.com/new/bn-ads', repo: 'new/bn-ads', why: 'Writes Facebook ads in Bangla and Banglish.', agents: ['ads', 'content'], stars: 85, isNew: true, category: 'Marketing' },
  { name: 'shady', url: 'https://example.com/x', why: 'not github' }] } });
check('the suggestions are saved (a link outside GitHub is left out)', r.ok && r.result.saved === 2, r.result);
await eng('erpEngineDone', { id: J.id, ok: true, result: 'Install seo-audit first.' });

r = await owner('erpSkills', []);
const S = r.result.suggest.items;
check('the owner sees them ranked, with why, the agents (only real ones), stars and NEW', S.length === 2 && S[0].name === 'seo-audit' && S[0].agents.join() === 'seo' && S[1].isNew && S[1].stars === 85 && r.result.suggest.when, S);
r = await owner('erpSkillSuggestDismiss', [{ url: 'https://github.com/new/bn-ads' }]);
check('"Not useful" hides one', r.ok && r.result.suggest.items.length === 1, r.result.suggest.items.map((i) => i.name));
await sql`insert into engine_skills (business_id, slug, name, source, source_url, repo) values (${B}, 'seo-audit', 'seo-audit', 'github', 'https://github.com/acme/skills/tree/main/seo-audit', 'acme/skills')`;
r = await owner('erpSkills', []);
check('one already installed drops out of the suggestions', r.ok && r.result.suggest.items.length === 0, r.result.suggest.items);
r = await owner('erpEngine', [{}]);
check('the suggestion job stays out of the Command Center (it shows in Skills)', !r.result.jobs.some((j) => j.title === 'Suggest skills'), r.result.jobs.map((j) => j.title));

await done();
