// leads-2 (owner 22 Oct 2026): "only two lists - customers and suppliers; I don't give sources, the AI researches the
// best ones itself, when I ask and by itself". The Leads agent finds leads, skips known ones, and adds each with why it
// fits, how hot it is and a first message; a daily search runs by itself (switchable).
import { sql, FIX, owner, sales, call, check, done, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const B = FIX.B;
const { keyHash } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
await sql`insert into erp_app_flags (key, enabled) values ('engine', true), ('leads', true) on conflict (key) do update set enabled = true`;
const KEY = 'engine-leads-key-00000000000000000000000000000000000';
await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(KEY)}, ${FIX.U.owner}, 'Engine (VPS)')`;
const eng = (name, a) => call(name, [a], { token: { key: KEY, device: 'engine' } });

await owner('erpEngine', [{}]);   // the Engine is on for this business
let r = await owner('erpLeads', [{ kind: 'customer' }]);
check('the Engine looks for new leads by itself every day at 11:00 (on from the start)', r.ok && r.result.research && r.result.research.engine && r.result.research.auto.enabled && r.result.research.auto.at === '11:00', r.result && r.result.research);
r = await sales('erpLeadResearch', [{ kind: 'customer' }]);
check('a salesperson does not send the Engine searching', !r.ok, r);
r = await owner('erpLeadResearch', [{ kind: 'supplier', what: 'PETG filament makers' }]);
check('the owner asks for supplier leads (the kind of lead is optional)', r.ok && r.result.research.last && /supplier leads: PETG/.test(r.result.research.last.title), r.result && r.result.research);
r = await owner('erpLeadResearch', [{ kind: 'customer' }]);
check('...not a second search while one runs', !r.ok, r);

r = await eng('erpEngineClaim', { runner: 'vps1' });
const J = r.result.job;
check('the Leads agent gets the search: it chooses the sources itself, never logs in anywhere', r.ok && J && r.result.agent.key === 'leads' && /YOU choose the best sources/.test(J.ask) && /Never log in/.test(J.ask) &&
  r.result.tools.some((t) => t.name === 'lead_add') && r.result.tools.some((t) => t.name === 'leads_known'), J);
r = await eng('erpEngineTool', { id: J.id, tool: 'lead_add', args: { kind: 'supplier', company: 'Shenzhen PETG Co.' } });
check('a lead without the why is refused', r.ok && /why/.test(r.result.error), r.result);
r = await eng('erpEngineTool', { id: J.id, tool: 'lead_add', args: { kind: 'supplier', company: 'Shenzhen PETG Co.', website: 'szpetg.example', email: 'sales@szpetg.example', country: 'China', want: 'PETG and PLA filament, OEM',
  why: 'Factory making PETG since 2015, exports to South Asia, MOQ 200 kg.', heat: 'hot', sourceUrl: 'https://szpetg.example/about', firstMessage: 'Hello, we import filament to Bangladesh...' } });
check('a researched lead is added', r.ok && r.result.added, r.result);
r = await eng('erpEngineTool', { id: J.id, tool: 'lead_add', args: { kind: 'supplier', company: 'SZ PETG', email: 'sales@szpetg.example', why: 'The same factory again under another name.' } });
check('...the same one again is skipped', r.ok && r.result.added === false, r.result);
r = await eng('erpEngineTool', { id: J.id, tool: 'leads_known', args: { kind: 'supplier' } });
check('leads_known lists who is already there', r.ok && r.result.leads.some((x) => /Shenzhen PETG/.test(x)), r.result);
await eng('erpEngineDone', { id: J.id, ok: true, result: 'Added 1 supplier.' });

r = await owner('erpLeads', [{ kind: 'supplier' }]);
const L = r.result.leads.find((l) => l.company === 'Shenzhen PETG Co.');
check('the supplier list shows it with WHY, how hot, found by the Engine, and the first message ready', L && /since 2015/.test(L.why) && L.heat === 'hot' && L.source === 'engine' && /First message/.test(L.note), L);
r = await owner('erpLeadResearch', [{ auto: false, kind: 'supplier' }]);
check('the owner switches the daily search off', r.ok && !r.result.research.auto.enabled, r.result && r.result.research);
r = await owner('erpLeadResearch', [{ auto: true }]);
check('...and on again', r.ok && r.result.research.auto.enabled, '');

await done();
