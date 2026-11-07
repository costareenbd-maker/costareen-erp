// crm-1 (160_crm.sql, handlers/crm.js): the customer / lead upgrades G1-G12.
// Run: TEST_SCRIPT=crm_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done, web, deps } from './harness.mjs';
import { calFeed, crmTick } from '../functions/erp/handlers/crm.js';
import { asBusiness, owners } from '../functions/erp/jobs.js';

const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';

// ---- closed until the provider opens it
let r = await sales('erpCrm', [{}]);
check('closed while the app is off', !r.ok && /not open/.test(r.error), r);
await sql`insert into erp_app_flags (key, enabled) values ('crm', true) on conflict (key) do update set enabled = true`;
r = await sales('erpCrm', [{}]);
check('open: the settings bundle for a salesperson (no hooks, no rules)', r.ok && Array.isArray(r.result.fields) && !r.result.hooks && !r.result.rules, r);

// ---- data: a customer with a sale, a payment, a note, a follow-up, a chat, a lead
r = await sales('erpSaveCustomer', [{ name: 'Rina Akter', phone: '01712340001', email: 'rina@example.com', address: 'Road 2, Banani', type: 'Retail', source: 'Facebook' }]);
check('Rina is added', r.ok, r);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Rina Akter', phone: '01712340001', address: 'Road 2, Banani' }, items: [{ sku: PLA, qty: 2 }], payMode: 'none' }]);
check('Rina buys on credit', r.ok, r);
const INV = r.result.invoiceNo;
r = await mgr('erpSettleDue', [{ phone: '01712340001', name: 'Rina Akter', amount: 100, method: 'Cash', reason: 'payment' }]);
check('she pays a little', r.ok, r);
await sales('erpNoteAdd', [{ kind: 'customer', ref: '1712340001', body: 'Wants the silk colours next time' }]);
await sales('erpFollowupSave', [{ phone: '01712340001', due: '2026-12-01', note: 'Silk PLA arrived?' }]);
const ch = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on) values (${B}, 'wa_evo', 'Shop WA', 'crm-test', 'live', false) returning id`)[0].id;
const ct = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name, phone, customer_key) values (${B}, ${ch}, '8801712340001', 'Rina', '8801712340001', '1712340001') returning id`)[0].id;
const cv = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id) values (${B}, ${ch}, ${ct}) returning id`)[0].id;
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text) values (${B}, ${cv}, 'in', 'customer', 'text', 'Silk PLA ase?'), (${B}, ${cv}, 'out', 'team', 'text', 'Next week')`;
const mailCh = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on) values (${B}, 'email', 'Shop mail', 'crm-mail', 'live', false) returning id`)[0].id;
const mct = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name) values (${B}, ${mailCh}, 'rina@example.com', 'Rina') returning id`)[0].id;
const mcv = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id) values (${B}, ${mailCh}, ${mct}) returning id`)[0].id;
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text) values (${B}, ${mcv}, 'in', 'customer', 'text', 'Please send the bill by mail')`;

// ---- G1 timeline
r = await sales('erpCrmTimeline', [{ phone: '01712340001' }]);
const kinds = r.ok ? r.result.items.map((x) => x.kind) : [];
check('G1: invoice, payment, note, follow-up, chat and e-mail on one timeline',
  r.ok && ['invoice', 'payment', 'note', 'followup', 'chat', 'email', 'customer'].every((k) => kinds.includes(k)), r.ok ? r.result.counts : r);
check('G1: newest first', r.ok && r.result.items.every((x, i, a) => i === 0 || a[i - 1].at >= x.at), kinds);
check('G1: the chat line says how many and the last words', r.ok && r.result.items.some((x) => x.kind === 'chat' && /2 messages/.test(x.title) && /Next week/.test(x.sub)), r.result && r.result.items.filter((x) => x.kind === 'chat'));
r = await sales('erpCrmTimeline', [{ phone: '01712340001', limit: 10, before: r.result.items[2].at }]);
check('G1: older items page by "before"', r.ok && r.result.items.length >= 1 && r.result.items.length <= 10, r);
r = await sales('erpCrmTimeline', [{}]);
check('G1: needs a customer', !r.ok, r);

// ---- G5 own fields
r = await sales('erpCrmFieldSave', [{ target: 'customer', label: 'Printer model', type: 'text' }]);
check('G5: only the owner makes fields', !r.ok, r);
r = await owner('erpCrmFieldSave', [{ target: 'customer', label: 'Printer model', type: 'text' }]);
check('G5: a text field', r.ok && r.result.fields.some((f) => f.key === 'f_printer_model'), r);
r = await owner('erpCrmFieldSave', [{ target: 'customer', label: 'Tier', type: 'choice', choices: 'Gold, Silver' }]);
r = await owner('erpCrmFieldSave', [{ target: 'customer', label: 'Budget', type: 'number', hideSales: true }]);
r = await owner('erpCrmFieldSave', [{ target: 'customer', label: 'Tier', type: 'choice', choices: 'Only one' }]);
check('G5: a choice field needs two choices', !r.ok, r);
r = await sales('erpCrmExtraSave', [{ phone: '01712340001', values: { f_printer_model: 'Bambu A1', f_tier: 'Gold' } }]);
check('G5: values saved on the customer', r.ok && r.result.extra.f_printer_model === 'Bambu A1' && r.result.extra.f_tier === 'Gold', r);
r = await sales('erpCrmExtraSave', [{ phone: '01712340001', values: { f_tier: 'Bronze' } }]);
check('G5: a choice outside the list is refused', !r.ok && /choose one of/.test(r.error), r);
r = await owner('erpCrmExtraSave', [{ phone: '01712340001', values: { f_budget: 'abc' } }]);
check('G5: a number field takes numbers only', !r.ok, r);
await owner('erpCrmExtraSave', [{ phone: '01712340001', values: { f_budget: '25,000' } }]);
r = await sales('erpCustomerPage', [{ phone: '01712340001' }]);
check('G5: the customer page carries the own fields', r.ok && r.result.extra.f_printer_model === 'Bambu A1', r.ok && r.result.extra);

// ---- G10 what salespeople do not see
r = await sales('erpCrmExtraSave', [{ phone: '01712340001', values: { f_budget: 1 } }]);
check('G10: a field hidden from sales cannot be changed by sales', !r.ok && /not open/.test(r.error), r);
check('G10: and is not shown to sales', r && !('f_budget' in ((await sales('erpCustomerPage', [{ phone: '01712340001' }])).result.extra || {})));
r = await mgr('erpCrmHideSet', [{ hide: ['phone'] }]);
check('G10: only the owner decides', !r.ok, r);
r = await owner('erpCrmHideSet', [{ hide: ['phone', 'address', 'nonsense'] }]);
check('G10: phone and address hidden (unknown words dropped)', r.ok && r.result.hide.join() === 'phone,address', r);
r = await sales('erpCustomerPage', [{ phone: '01712340001' }]);
check('G10: sales sees a masked phone and no address', r.ok && /•/.test(r.result.phone) && r.result.address === '•••', r.ok && [r.result.phone, r.result.address]);
r = await mgr('erpCustomerPage', [{ phone: '01712340001' }]);
check('G10: a manager still sees everything', r.ok && r.result.phone === '01712340001' && /Banani/.test(r.result.address), r.ok && r.result.phone);
r = await sales('erpListView', [{ model: 'customers', search: [{ field: 'customer', values: ['Rina'] }] }]);
check('G10: the customer list masks it for sales too', r.ok && r.result.rows.length === 1 && /•/.test(r.result.rows[0].phone), r.ok && r.result.rows[0]);
await owner('erpCrmHideSet', [{ hide: [] }]);

// ---- G3 conditions and saved views
r = await sales('erpListView', [{ model: 'customers', conds: [{ field: 'x.f_tier', op: 'eq', value: 'gold' }] }]);
check('G3: a condition on an own field', r.ok && r.result.rows.length === 1 && r.result.rows[0].name === 'Rina Akter', r.ok && r.result.rows.map((x) => x.name));
r = await sales('erpListView', [{ model: 'customers', conds: [{ field: 'x.f_tier', op: 'eq', value: 'silver' }, { field: 'name', op: 'contains', value: 'rina' }], match: 'any' }]);
check('G3: "any" joins with or', r.ok && r.result.rows.some((x) => x.name === 'Rina Akter'), r.ok && r.result.total);
r = await sales('erpListView', [{ model: 'customers', conds: [{ field: 'x.f_tier', op: 'eq', value: 'silver' }, { field: 'name', op: 'contains', value: 'rina' }], match: 'all' }]);
check('G3: "all" joins with and', r.ok && r.result.rows.length === 0, r.ok && r.result.total);
r = await sales('erpCrmViewSave', [{ target: 'customers', name: 'Gold buyers', state: { conds: [{ field: 'x.f_tier', op: 'eq', value: 'Gold' }] } }]);
check('G3: a view of my own', r.ok && r.result.views.length === 1 && r.result.views[0].mine && !r.result.views[0].shared, r);
r = await sales('erpCrmViewSave', [{ target: 'customers', name: 'For all', shared: true, state: {} }]);
check('G3: only a manager shares a view with the team', !r.ok, r);
r = await mgr('erpCrmViewSave', [{ target: 'customers', name: 'Lapsed', shared: true, state: { filters: ['lapsed'] } }]);
r = await sales('erpCrmViews', [{ target: 'customers' }]);
check('G3: sales sees its own view and the team view, not other people\'s own', r.ok && r.result.views.length === 2, r.ok && r.result.views.map((v) => v.name));
const shared = r.result.views.find((v) => v.shared);
r = await sales('erpCrmViewRemove', [{ id: shared.id }]);
check('G3: sales cannot remove the team view', !r.ok, r);

// ---- G4 companies
r = await sales('erpCrmCompanySave', [{ name: 'Robo Club BUET' }]);
check('G4: a manager makes companies', !r.ok, r);
r = await mgr('erpCrmCompanySave', [{ name: 'Robo Club BUET', kind: 'School', phone: '01800000000' }]);
check('G4: company made', r.ok && r.result.companies.length === 1, r);
const COMP = r.result.id;
r = await mgr('erpCrmCompanySave', [{ name: 'robo club buet' }]);
check('G4: no two companies with the same name', !r.ok, r);
r = await sales('erpCrmCompanyLink', [{ phone: '01712340001', companyId: COMP }]);
check('G4: Rina goes under the company', r.ok && r.result.company.name === 'Robo Club BUET', r);
r = await mgr('erpCrmCompany', [{ id: COMP }]);
check('G4: the company page lists its people with orders, spent and due', r.ok && r.result.people.length === 1 && r.result.orders === 1 && r.result.spent > 0 && r.result.owes > 0, r.ok && r.result);
r = await sales('erpCrmCompany', [{ id: COMP }]);
check('G4: sales sees the company without money owed', r.ok && r.result.owes === null && r.result.people[0].owes === null, r.ok && r.result);
r = await sales('erpListView', [{ model: 'customers', groupBy: 'company' }]);
check('G4: the customer list groups by company', r.ok && r.result.groups.some((g) => g.label === 'Robo Club BUET'), r.ok && r.result.groups.map((g) => g.label));

// ---- G6 duplicates
await sales('erpSaveCustomer', [{ name: 'Rina  Akter', phone: '01912340002', type: 'Retail', source: 'Walk-in' }]);
r = await sales('erpCrmDupCheck', [{ name: 'rina akter', phone: '' }]);
check('G6: typing a name that is already there warns', r.ok && r.result.matches.length >= 1 && r.result.matches.every((m) => m.why === 'Same name'), r);
r = await sales('erpCrmDupCheck', [{ name: 'Someone', phone: '+8801712340001' }]);
check('G6: the same phone in another form warns', r.ok && r.result.matches.length === 1 && r.result.matches[0].why === 'Same phone', r);
r = await sales('erpCrmDupes', [{}]);
check('G6: the duplicate list is a manager\'s', !r.ok, r);
r = await mgr('erpCrmDupes', [{}]);
const g = r.ok ? r.result.groups.find((x) => x.people.some((p) => p.name === 'Rina Akter')) : null;
check('G6: both Rinas are listed as the same name', g && g.why === 'Same name' && g.people.length === 2, r.ok && r.result.groups);
r = await mgr('erpCrmDupeOk', [{ keys: g.people.map((p) => p.key) }]);
check('G6: "not the same" takes the pair off the list', r.ok && !r.result.groups.some((x) => x.people.some((p) => p.name === 'Rina Akter')), r.ok && r.result.groups);

// ---- G7 events + G8 rules
r = await sales('erpCrmEvents', [{}]);
check('G7: the event list is the owner\'s', !r.ok, r);
r = await owner('erpCrmEvents', [{}]);
const evk = r.ok ? r.result.events.map((e) => e.kind) : [];
check('G7: customer saved and invoice made were written', r.ok && evk.includes('customer.saved') && evk.includes('invoice.created'), evk);
const inv = r.result.events.find((e) => e.kind === 'invoice.created');
check('G7: the invoice event carries the number, the customer and the total', inv && inv.data.invoiceNo === INV && inv.data.key === '1712340001' && inv.data.total > 0, inv);
r = await owner('erpCrmRuleSave', [{ name: 'Big sale: call in 3 days', when: 'invoice.created', cond: { field: 'total', op: 'gt', value: '1' }, act: 'followup', params: { days: 3, note: 'Thank them for the big order' } }]);
check('G8: a rule', r.ok && r.result.rules.length === 1, r);
r = await owner('erpCrmRuleSave', [{ name: 'Bad', when: 'lead.stage', act: 'followup', params: { note: 'x' } }]);
check('G8: a follow-up rule needs a customer event', !r.ok, r);
r = await owner('erpCrmRuleSave', [{ name: 'Quoted: chase in 2 days', when: 'lead.stage', cond: { field: 'stageName', op: 'eq', value: 'Quoted' }, act: 'lead_followup', params: { days: 2 } }]);
check('G8: a lead rule', r.ok && r.result.rules.length === 2, r);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Rina Akter', phone: '01712340001' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
const fu = await sql`select note, by, due_on from customer_followups where business_id = ${B} and customer_key = '1712340001' and by like 'Rule:%'`;
check('G8: the rule planned a follow-up on the new sale', fu.length === 1 && fu[0].note === 'Thank them for the big order', fu);
const rr = (await sql`select runs from crm_rules where business_id = ${B} and when_kind = 'invoice.created'`)[0];
check('G8: the rule counts its runs', rr.runs === 1, rr);

// ---- leads: G2 (stage moves), G7 lead events, G8 lead rule
await sql`insert into erp_app_flags (key, enabled) values ('leads', true) on conflict (key) do update set enabled = true`;
r = await mgr('erpLeadUpsert', [{ kind: 'customer', name: 'Lab of Dhaka Uni', phone: '01555000111', source: 'hand' }]);
check('a lead is added', r.ok && r.result.id, r);
const LEAD = r.result.id;
r = await mgr('erpLeadAct', [{ id: LEAD, stage: 4 }]);
check('G2: the board moves a lead (erpLeadAct)', r.ok, r);
const ld = (await sql`select stage, follow_up_on from inbox_leads where id = ${LEAD}`)[0];
check('G8: "Quoted" set a follow-up day by the rule', ld.stage === 4 && !!ld.follow_up_on, ld);
r = await owner('erpCrmEvents', [{ kind: 'lead.stage' }]);
check('G7: the lead move is an event with old and new stage', r.ok && r.result.events.length === 1 && r.result.events[0].data.stageName === 'Quoted' && r.result.events[0].data.was === 'New', r.ok && r.result.events);
r = await owner('erpCrmExtraSave', [{ target: 'lead', id: LEAD, values: {} }]);
check('G5: lead extras save (empty is fine)', r.ok, r);

// ---- G7 sending: an address, the signed post, a failure kept and tried again
r = await owner('erpCrmHookSave', [{ url: 'ftp://nope' }]);
check('G7: the address must be http(s)', !r.ok, r);
r = await owner('erpCrmHookSave', [{ url: 'https://n8n.example.com/webhook/erp', kinds: ['customer.saved', 'lead.stage'] }]);
check('G7: address saved, the secret shown once', r.ok && r.result.hooks.length === 1 && /^[0-9a-f]{48}$/.test(r.result.secret), r.ok && Object.keys(r.result));
const HOOK = r.result.hooks[0].id;
r = await owner('erpCrmHooks', [{}]);
check('G7: the secret is not shown again', r.ok && !r.result.secret && !JSON.stringify(r.result).includes('secret"'), r.ok && r.result);
let got = null, fail = true;
web.on(/n8n\.example\.com/, (url, opts) => { if (fail) return { status: 500, body: 'down' }; got = { body: JSON.parse(opts.body), sig: opts.headers['x-erp-signature'] }; return { status: 200, body: 'ok' }; });
await sales('erpSaveCustomer', [{ name: 'Tanvir', phone: '01712340009', type: 'Retail', source: 'Walk-in' }]);
const tick = async () => asBusiness(deps, (await owners(sql, [B]))[0], 'crm:test', (ctx) => crmTick(ctx));
let t = await tick();
check('G7: a failure is kept, nothing skipped', /HTTP 500/.test(String(t[HOOK])) && (await sql`select last_error from crm_hooks where id = ${HOOK}`)[0].last_error, t);
fail = false;
t = await tick();
check('G7: sent next time, only the kinds asked for, in order', t[HOOK] === 1 && got && got.body.events.length === 1 && got.body.events[0].kind === 'customer.saved' && got.body.events[0].data.name === 'Tanvir', [t, got && got.body]);
check('G7: the post is signed', got && /^sha256=[0-9a-f]{64}$/.test(got.sig), got && got.sig);
t = await tick();
check('G7: nothing is sent twice', !t[HOOK], t);
r = await owner('erpCrmHookTest', [{ id: HOOK }]);
check('G7: Test reaches the address', r.ok && r.result.ok, r);

// ---- G9 the bin
r = await sales('erpCrmRemove', [{ phone: '01712340009' }]);
check('G9: a manager removes', !r.ok, r);
r = await mgr('erpCrmRemove', [{ phone: '01712340001' }]);
check('G9: a customer with sales stays in the books', !r.ok && /stay/.test(r.error), r);
await sales('erpFollowupSave', [{ phone: '01712340009', due: '2026-12-05', note: 'Call Tanvir' }]);
r = await mgr('erpCrmRemove', [{ phone: '01712340009', reason: 'typed by mistake' }]);
check('G9: a customer with no sales goes to the bin', r.ok && !(await sql`select 1 from customers where business_id = ${B} and phone like '%1712340009%'`).length, r);
r = await mgr('erpCrmRemove', [{ kind: 'lead', id: LEAD, reason: 'test' }]);
check('G9: a lead goes to the bin', r.ok && !(await sql`select 1 from inbox_leads where id = ${LEAD}`).length, r);
r = await mgr('erpCrmBin', [{}]);
check('G9: the bin lists both', r.ok && r.result.bin.length === 2 && r.result.bin.some((b) => b.label === 'Tanvir' && b.reason === 'typed by mistake'), r);
for (const b of r.result.bin) { const x = await mgr('erpCrmRestore', [{ id: b.id }]); check('G9: back from the bin: ' + b.label, x.ok, x); }
check('G9: Tanvir is back with the follow-up', (await sql`select 1 from customers where business_id = ${B} and phone like '%1712340009%'`).length === 1 && (await sql`select 1 from customer_followups where business_id = ${B} and customer_key = '1712340009'`).length === 1);
const back = (await sql`select stage from inbox_leads where id = ${LEAD}`)[0];
check('G9: the lead is back with its stage and history', back && back.stage === 4 && (await sql`select count(*)::int n from inbox_lead_events where lead_id = ${LEAD}`)[0].n >= 3, back);
r = await mgr('erpCrmRestore', [{ id: (await mgr('erpCrmBin', [{}])).result.bin[0].id }]);
check('G9: cannot be brought back twice', !r.ok, r);

// ---- G11 calendar, G12 the calendar link
r = await sales('erpCrmCalendar', [{ month: '2026-12' }]);
check('G11: December shows the follow-ups', r.ok && r.result.items.some((x) => x.kind === 'followup' && /Silk PLA/.test(x.title)) && r.result.items.some((x) => /Call Tanvir/.test(x.title)), r.ok && r.result.items);
r = await mgr('erpCrmCalLink', [{ make: true }]);
check('G12: only the owner makes the calendar link', !r.ok, r);
r = await owner('erpCrmCalLink', [{ make: true }]);
check('G12: the link', r.ok && /crmcal=/.test(r.result.url), r);
const token = decodeURIComponent(r.result.url.split('crmcal=')[1]);
await sql`update customer_followups set due_on = current_date + 5 where business_id = ${B} and customer_key = '1712340001' and by not like 'Rule:%'`;
const feed = await calFeed(deps, new URLSearchParams({ crmcal: token }), { asBusiness, owners });
check('G12: the calendar has the follow-ups as all-day events', feed.status === 200 && /BEGIN:VCALENDAR/.test(feed.body) && /SUMMARY:Follow up: Rina Akter/.test(feed.body) && /DTSTART;VALUE=DATE:\d{8}/.test(feed.body), feed.body && feed.body.slice(0, 400));
const bad = await calFeed(deps, new URLSearchParams({ crmcal: B + '.0000' }), { asBusiness, owners });
check('G12: a wrong link shows nothing', bad.status === 404, bad);
await owner('erpCrmCalLink', [{ stop: true }]);
const gone = await calFeed(deps, new URLSearchParams({ crmcal: token }), { asBusiness, owners });
check('G12: a stopped link shows nothing', gone.status === 404, gone);

// ---- the other business sees none of it
const o = await sql`select (select count(*) from crm_fields where business_id = ${FIX.B2})::int f, (select count(*) from crm_events where business_id = ${FIX.B2})::int e,
                           (select count(*) from crm_companies where business_id = ${FIX.B2})::int c, (select count(*) from crm_views where business_id = ${FIX.B2})::int v`;
check('the other business is untouched', o[0].f === 0 && o[0].e === 0 && o[0].c === 0 && o[0].v === 0, o);

await done();
