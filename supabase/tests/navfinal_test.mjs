// crit8-nav (10 Nov 2026): calls that only read in their list form are reads (ERP_READ_WHEN / isReadCall in allow.js):
// no activity-log row for merely opening a screen, the kept dashboard stays, no one-time key stored; the same call with a
// change is still a write (logged, idempotent, dashboard dropped). And the part paid at the moment of sale is noted
// "paid at sale", not "advance" (an advance is money held for the customer).
// Run: sh local/onetest.sh supabase/tests/navfinal_test.mjs
import { sql, FIX, owner, mgr, check, done, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { ERP_READS, ERP_ALLOW, ERP_READ_WHEN, isReadCall } = await import(pathToFileURL(path.join(fnDir, 'allow.js')));

const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
let r;

// ---------------------------------------------------------------- 1. the rule itself
check('every read-by-arguments name is an allowed action', Object.keys(ERP_READ_WHEN).every((n) => ERP_ALLOW[n]), Object.keys(ERP_READ_WHEN).filter((n) => !ERP_ALLOW[n]));
check('no read-by-arguments name is also an always-read', Object.keys(ERP_READ_WHEN).every((n) => !ERP_READS.test(n)));
check('an always-read stays a read', isReadCall('erpSales', [{}]) === true);
check('an unknown write stays a write', isReadCall('erpCreateInvoice', [{}]) === false);
check('Saved replies: the list is a read', isReadCall('erpSavedReplies', [{}]) && isReadCall('erpSavedReplies', []) && isReadCall('erpSavedReplies', [{ opKey: 'k123456789' }]));
check('Saved replies: add / archive are writes', !isReadCall('erpSavedReplies', [{ add: { title: 'a', body: 'b' } }]) && !isReadCall('erpSavedReplies', [{ archive: 'x' }]));
check('Features: looking is a read, switching is a write', isReadCall('erpInboxFeatures', [{}]) && !isReadCall('erpInboxFeatures', [{ save: { ai: true } }]) && !isReadCall('erpInboxFeatures', [{ warnAt: 70 }]));
check('Plans: looking is a read, saving is a write', isReadCall('erpPlatformInboxPlan', [{}]) && !isReadCall('erpPlatformInboxPlan', [{ save: {} }]));
check('document language: reading is a read, setting is a write', isReadCall('erpDocLang', ['']) && isReadCall('erpDocLang', []) && !isReadCall('erpDocLang', ['bn']));
check('Agent desk: list is a read, publish is a write', isReadCall('erpAgentDesk', [{}]) && isReadCall('erpAgentDesk', [{ action: 'list' }]) && !isReadCall('erpAgentDesk', [{ action: 'publish' }]));
check('Inbox leads: opening one is a read, saving is a write', isReadCall('erpInboxLeads', [{ open: 'x' }]) && !isReadCall('erpInboxLeads', [{ save: { name: 'x' } }]));
check('a string where an object belongs is not taken as a read', !isReadCall('erpInboxFeatures', ['save']));
check('erpTool and erpBrainFact always write', !isReadCall('erpTool', ['previewPush']) && !isReadCall('erpBrainFact', [{}]));

// ---------------------------------------------------------------- 2. through the real door (core.js)
const acts = async (name) => Number((await sql`select count(*)::int n from erp_activity where business_id = ${B} and action = ${name}`)[0].n);
const keys = async (k) => Number((await sql`select count(*)::int n from erp_op_keys where business_id = ${B} and op_key = ${k}`)[0].n);
const keepDash = async () => { await sql`delete from erp_dash_cache where business_id = ${B}`; await sql`insert into erp_dash_cache (business_id, tier, day, dash, kept_at) values (${B}, 'full', '2026-11-10', ${sql.json({ t: 1 })}, now())`; };
const dashKept = async () => Number((await sql`select count(*)::int n from erp_dash_cache where business_id = ${B}`)[0].n) > 0;

let a0 = await acts('erpInboxFeatures');
await keepDash();
r = await owner('erpInboxFeatures', [{ opKey: 'knavlook0001' }]);
check('Features opens', r.ok, r.error);
check('looking at Features writes no "Switched Inbox features" row', (await acts('erpInboxFeatures')) === a0);
check('looking at Features keeps the kept dashboard', await dashKept());
check('looking at Features stores no one-time key', (await keys('knavlook0001')) === 0);
r = await owner('erpInboxFeatures', [{ warnAt: 70, opKey: 'knavsave0001' }]);
check('switching a Features setting saves', r.ok, r.error);
check('switching is logged once', (await acts('erpInboxFeatures')) === a0 + 1);
check('switching drops the kept dashboard', !(await dashKept()));
check('switching keeps its one-time key (a double send saves once)', (await keys('knavsave0001')) === 1);

a0 = await acts('erpSavedReplies');
r = await mgr('erpSavedReplies', [{}]);
check('Saved replies list opens for a manager', r.ok, r.error);
check('the list writes no activity row', (await acts('erpSavedReplies')) === a0);
r = await mgr('erpSavedReplies', [{ add: { title: 'Thanks nav', body: 'Thank you for your order.' }, opKey: 'knavsave0002' }]);
check('adding a saved reply saves', r.ok && (r.result.list || []).some((x) => x.title === 'Thanks nav'), r.error);
check('adding is logged', (await acts('erpSavedReplies')) === a0 + 1);
const again = await mgr('erpSavedReplies', [{ add: { title: 'Thanks nav', body: 'Thank you for your order.' }, opKey: 'knavsave0002' }]);
check('the same add sent twice is saved once', again.ok && Number((await sql`select count(*)::int n from saved_replies where business_id = ${B} and title = 'Thanks nav'`)[0].n) === 1);

a0 = await acts('erpDocLang');
r = await owner('erpDocLang', ['']);
check('reading the document language works', r.ok && /^(en|bn)$/.test(r.result.lang), r.error);

// ---------------------------------------------------------------- 3. "paid at sale"
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Nav Part', phone: '01712345670' }, items: [{ sku: PLA, qty: 1 }], payMode: 'part', paidNow: 500, payMethod: 'Cash' }]);
check('a part-paid sale saves', r.ok, r.error);
if (r.ok) {
  const no = r.result.invoiceNo;
  const notes = (await sql`select note from payments where business_id = ${B} and invoice_no = ${no}`).map((x) => String(x.note || ''));
  check('the part paid at the sale is noted "paid at sale"', notes.length === 1 && /^paid at sale/.test(notes[0]), notes);
  check('it is not noted "advance"', !notes.some((n) => /^advance/.test(n)), notes);
}
done();
