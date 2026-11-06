// night-stock D19 (owner 6 Nov 2026: "one lead list - campaign leads + Leads page"), migration 158.
// A number added under Campaigns > Contacts shows on the Leads page; a customer lead with a phone on the Leads page can be
// messaged by a WhatsApp campaign; old campaign rows are kept and get their Leads-page row from the migration; removing
// from the campaign list never deletes the person from the Leads page (marked Lost, with history).
// Run: TEST_SCRIPT=onelead_test.mjs ... erp_server_test.py. Made-up names and numbers only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, FIX, owner, mgr, check, done } from './harness.mjs';

const B = FIX.B, B2 = FIX.B2;
const ok = (r) => r && r.ok;
await sql`insert into erp_app_flags (key, enabled) values ('leads', true) on conflict (key) do update set enabled = true`;

// ---- 1. a campaign lead lands on the Leads page
let r = await mgr('erpLeadsAdd', [{ text: 'Test Tania 01822 000 111\nTest Babu 01822000222', source: 'Fair' }]);
check('two campaign leads added', ok(r) && r.result.added === 2, r);
let mir = await sql`select il.*, cl.lead_key from campaign_leads cl join inbox_leads il on il.id = cl.inbox_lead_id
                    where cl.business_id = ${B} order by cl.seq`;
check('...each one has its own Leads-page row, linked', mir.length === 2 && mir.every((m) => m.source === 'campaign' && m.kind === 'customer' &&
  m.stage === 1 && m.source_ref === 'campaign:' + m.lead_key && m.business_id === B), mir);
check('...the where-from goes into the note', mir[0].note === 'Fair' && mir[0].name === 'Test Tania' && mir[0].phone === '01822000111', mir[0]);
r = await mgr('erpLeads', [{ kind: 'customer' }]);
check('the Leads page lists them, source named', ok(r) && r.result.leads.filter((l) => l.source === 'campaign').length === 2 &&
  r.result.leads.find((l) => l.name === 'Test Tania').sourceName === 'Campaign phone list', r.result && r.result.leads);
r = await mgr('erpLeadsAdd', [{ text: 'Test Tania 01822000111' }]);
check('the same number again is still refused, and no second Leads row', ok(r) && r.result.added === 0 &&
  (await sql`select count(*)::int n from inbox_leads where business_id = ${B} and phone = '01822000111'`)[0].n === 1, r);
r = await mgr('erpLeadUpsert', [{ kind: 'customer', name: 'Tania again', phone: '+8801822000111' }]);
check('adding the same phone on the Leads page finds the campaign lead (never twice)', ok(r) && !r.result.added && r.result.id === mir[0].id, r);

// ---- 2. a Leads-page lead with a phone joins the campaign audience
r = await mgr('erpLeadUpsert', [{ kind: 'customer', source: 'referral', name: 'Test Shapla', phone: '01933-000333' }]);
const shapla = r.result && r.result.id;
check('(seed) a lead added on the Leads page', ok(r) && r.result.added, r);
await mgr('erpLeadUpsert', [{ kind: 'customer', source: 'referral', name: 'Test Lost', phone: '01933000444', stage: 6 }]);
await mgr('erpLeadUpsert', [{ kind: 'supplier', source: 'b2b', company: 'Test Supply Co', phone: '01933000555' }]);
await mgr('erpLeadUpsert', [{ kind: 'customer', source: 'referral', name: 'Test Mail Only', email: 'mail@lead.test' }]);
r = await mgr('erpCampaignAudience', []);
const leadsIn = ok(r) ? r.result.customers.filter((c) => c.lead) : [];
const sh = leadsIn.find((c) => c.key === '1933000333');
check('the Leads-page lead can be messaged by a campaign', sh && sh.name === 'Test Shapla' && sh.wa === '8801933000333' && sh.source === 'Leads page', leadsIn);
check('...but not a lost lead, a supplier lead or a lead without a phone', !leadsIn.some((c) => /Lost|Supply|Mail Only/.test(c.name) || c.key === '1933000444' || c.key === '1933000555'), leadsIn);
check('...and a campaign lead is listed once, not twice', leadsIn.filter((c) => c.key === '1822000111').length === 1 &&
  leadsIn.find((c) => c.key === '1822000111').source === 'Fair', leadsIn);

// ---- 3. one name: editing from Campaigns changes the Leads page row
r = await mgr('erpLeadSave', [{ key: '1822000111', name: 'Test Tania Akter', source: 'Fair', note: 'wants silk PLA' }]);
const t1 = (await sql`select name, note from inbox_leads where id = ${mir[0].id}`)[0];
check('campaign edit follows to the Leads page', ok(r) && t1.name === 'Test Tania Akter' && t1.note === 'Fair · wants silk PLA', t1);
r = await mgr('erpLeadSave', [{ key: '1933000333', name: 'Test Shapla Rani', note: 'call after 5' }]);
const s1 = (await sql`select name, note from inbox_leads where id = ${shapla}`)[0];
check('editing a Leads-page lead from Campaigns writes its own row (no campaign row made)', ok(r) && s1.name === 'Test Shapla Rani' && s1.note === 'call after 5' &&
  !(await sql`select 1 from campaign_leads where business_id = ${B} and lead_key = '1933000333'`).length, s1);
r = await mgr('erpLeadSave', [{ key: '1933000333', name: 'Test Shapla R', source: '' }]);   // the Campaigns edit row sends no note
const s2 = (await sql`select name, note from inbox_leads where id = ${shapla}`)[0];
check('an edit without a note keeps the Leads-page note', ok(r) && s2.name === 'Test Shapla R' && s2.note === 'call after 5', s2);

// ---- 4. removing from the campaign list keeps the person on the Leads page
r = await mgr('erpLeadRemove', [{ key: '1822000222' }]);
const babu = (await sql`select stage from inbox_leads where id = ${mir[1].id}`)[0];
const ev = await sql`select what from inbox_lead_events where lead_id = ${mir[1].id} order by id`;
check('removed from campaigns: campaign row gone, Leads row kept as Lost with a reason', ok(r) && babu && babu.stage === 6 &&
  !(await sql`select 1 from campaign_leads where lead_key = '1822000222'`).length && ev.some((e) => /Removed from the campaign list/.test(e.what)), { babu, ev });
r = await mgr('erpLeadRemove', [{ key: '1933000333' }]);
check('removing a Leads-page lead marks it Lost (never deleted)', ok(r) && (await sql`select stage from inbox_leads where id = ${shapla}`)[0].stage === 6, r);
r = await mgr('erpCampaignAudience', []);
check('...both are off the campaign list now', ok(r) && !r.result.customers.some((c) => c.key === '1822000222' || c.key === '1933000333'), r.result && r.result.customers.filter((c) => c.lead));
r = await mgr('erpLeadRemove', [{ key: '1933000333' }]);
check('...and a second remove says it is gone', !ok(r) && r.error === 'That lead is no longer on the list.', r);

// ---- 5. won on the Leads page = off the campaign list
await sql`update inbox_leads set stage = 5 where id = ${mir[0].id}`;
r = await mgr('erpCampaignAudience', []);
check('a campaign lead marked Won on the Leads page is not messaged as a lead', ok(r) && !r.result.customers.some((c) => c.lead && c.key === '1822000111'), r.result && r.result.customers.filter((c) => c.lead));
await sql`update inbox_leads set stage = 1 where id = ${mir[0].id}`;

// ---- 6. the migration: old campaign rows (written before 158) get a Leads row; nothing old is removed
await sql`insert into campaign_leads (business_id, lead_key, name, phone, source, note, by) values
  (${B}, '1744000666', 'Old Rumi', '01744000666', 'Sheet', '', 'Mehedi'),
  (${B}, '1744000777', 'Old Polash', '01744000777', '', 'from the fair', 'Mehedi'),
  (${B2}, '1744000888', 'Other Shop Lead', '01744000888', '', '', 'Them')`;
const pre = (await sql`insert into inbox_leads (business_id, kind, name, phone, source, stage) values (${B}, 'customer', 'Polash (already here)', '+880 1744-000777', 'referral', 2) returning id`)[0].id;
const before = (await sql`select count(*)::int n from campaign_leads`)[0].n;
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '158_one_lead_list.sql');
await sql.unsafe(fs.readFileSync(file, 'utf8'));
await sql.unsafe(fs.readFileSync(file, 'utf8'));   // idempotent
const rumi = (await sql`select il.* from campaign_leads cl join inbox_leads il on il.id = cl.inbox_lead_id where cl.lead_key = '1744000666'`)[0];
const pol = (await sql`select inbox_lead_id from campaign_leads where lead_key = '1744000777'`)[0];
const oth = (await sql`select il.business_id from campaign_leads cl join inbox_leads il on il.id = cl.inbox_lead_id where cl.lead_key = '1744000888'`)[0];
check('migration: an old campaign lead gets its Leads row', rumi && rumi.business_id === B && rumi.source === 'campaign' && rumi.note === 'Sheet' && rumi.name === 'Old Rumi', rumi);
check('migration: a number already on the Leads page links to it, not a second row', pol && pol.inbox_lead_id === pre &&
  (await sql`select count(*)::int n from inbox_leads where business_id = ${B} and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = '1744000777'`)[0].n === 1, pol);
check('migration: each business keeps its own lead', oth && oth.business_id === B2, oth);
check('migration: no campaign row removed, run twice adds nothing twice', (await sql`select count(*)::int n from campaign_leads`)[0].n === before &&
  (await sql`select count(*)::int n from inbox_leads where source_ref = 'campaign:1744000666'`)[0].n === 1, before);

// ---- 7. the other business saw none of the live calls
check('the other business has no leads from these calls', (await sql`select count(*)::int n from inbox_leads where business_id = ${B2} and source_ref <> 'campaign:1744000888'`)[0].n === 0);

await done();
