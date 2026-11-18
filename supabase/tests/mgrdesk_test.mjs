// mgrdesk-1 (owner 19 Nov 2026): what Alvi does for the manager / MD on WhatsApp - website orders, parcels, due
// reminders, group name / add, payment thanks, the day's summary, stock watch. Made-up numbers only.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { sql, FIX, owner, check, done, deps, web, fnDir } from './harness.mjs';

const md = await import(pathToFileURL(path.join(fnDir, 'handlers', 'mgrdesk.js')));
const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const chm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inboxch.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';

const OWN = { boss1: '8801900000652', ai9: '8801900000659' };
const calls = [];
web.on(/evo\.test/, (url, opts) => {
  const b = opts && opts.body ? JSON.parse(opts.body) : null;
  if (/fetchInstances/.test(url)) { const inst = /instanceName=([^&]+)/.exec(url)[1]; return { status: 200, body: [{ name: inst, ownerJid: OWN[inst] + '@s.whatsapp.net' }] }; }
  calls.push({ url, inst: (/\/(boss1|ai9)(\?|$)/.exec(url) || [])[1], ...(b || {}) });
  return { status: 201, body: { key: { id: 'W' + calls.length } } };
});
const mk = async (name, inst, purpose, ago) => {
  const c = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings, created_at) values (${FIX.B}, 'wa_evo', ${name}, ${inst}, 'live', true, ${sql.json({ purpose })}, ${new Date(Date.now() - ago)}) returning *`)[0];
  await asB(async (ctx) => { await chm.chSecretSet(ctx, c, 'URL', 'https://evo.test'); await chm.chSecretSet(ctx, c, 'KEY', 'k'); });
  return c;
};
const BOSS = await mk('WhatsApp', 'boss1', 'collect', 3600e3), AI = await mk('Faujia Alvi', 'ai9', 'chat', 1000);
await owner('erpInboxProfile', [{ save: { name: 'Costareen', agent_name: 'Faujia Alvi', superior_wa: '01900000652', team_wa: '01900000070', style: 'vai' } }]);
const prof = await asB(async (ctx) => ib.profile(ctx, false));
const roleCtx = (ctx) => ({ ...ctx, s: { ...ctx.s, role: 'manager', name: 'Manager via WhatsApp (AI)' } });
const run = (name, a, propose) => asB(async (ctx) => md.runMgrTool(ctx, roleCtx(ctx), prof, name, a, propose || (async (x) => ({ prepared: true, ...x }))));

const ch = await asB(async (ctx) => md.channels(ctx, prof));
check('mgrdesk-1: Alvi = the chat number, the groups\' admin = the manager\'s (collect) number', ch.ai.id === AI.id && ch.maker.id === BOSS.id, ch);

// a customer with a group (made by the manager's number) and an invoice
await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, subtotal, grand_total) values (${FIX.B}, 'INV-MD-1', 'Karim Hasan', '01713-000009', 500, 500)`;
const kc = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name) values (${FIX.B}, ${AI.id}, '120363000001@g.us', 'Karim') returning *`)[0];
const vc = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id) values (${FIX.B}, ${AI.id}, ${kc.id}) returning *`)[0];
await sql`insert into customer_groups (business_id, phone, name, gender, source, status, group_jid, conversation_id, made_at, subject) values (${FIX.B}, '8801713000009', 'Karim Hasan', 'm', 'purchase', 'made', '120363000001@g.us', ${vc.id}, now(), 'Karim Vai (Costareen)')`;
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text, external_id) values (${FIX.B}, ${vc.id}, 'in', 'customer', 'image', 'bkash screenshot', 'CUSTMSG1')`;

// web orders
const wo = (await sql`insert into web_orders (business_id, order_no, order_date, status, customer_name, customer_phone, payment, order_total) values (${FIX.B}, '9001', now(), 'processing', 'Salma', '01713000077', 'cod', 2950) returning *`)[0];
await sql`insert into web_order_lines (business_id, web_order_id, sku, product_name, qty, line_total) values (${FIX.B}, ${wo.id}, 'X1', 'Panchroma PLA White', 2, 2900)`;
let r = await run('web_order', { order: '9001' });
check('mgrdesk-1: a website order by number - customer, items, total, status, not yet an invoice', r.customer === 'Salma' && r.items.length === 1 && r.items[0].qty === 2 && /2,950/.test(r.total) && r.enteredAsInvoice === 'not yet', r);
r = await run('web_order', { day: 'today' });
check('mgrdesk-1: today\'s website orders', r.count === 1 && r.orders[0].order === '9001', r);
r = await run('web_order', { order: '123456' });
check('mgrdesk-1: an unknown website order is a plain answer', /No website order/.test(r.error || ''), r);

// parcels
r = await run('parcel_status', { invoice: 'INV-MD-1' });
check('mgrdesk-1: no booked parcel -> plain answer', /No parcel was booked/.test(r.error || ''), r);
await sql`insert into courier_log (business_id, invoice_no, consignment_id, customer, phone, cod_amount, invoice_total, tracking_code) values (${FIX.B}, 'INV-MD-1', 'C1', 'Karim Hasan', '01713000009', 500, 500, 'TRK1')`;
calls.length = 0;
r = await run('parcel_status', { invoice: 'inv-md-1', tell: true });
check('mgrdesk-1: parcel by invoice (any letter case); the customer is told in their group from Alvi\'s number', r.parcels && r.parcels[0].invoice === 'INV-MD-1' && r.told && r.toldWhere === 'group' &&
  calls.some((c) => c.inst === 'ai9' && c.number === '120363000001@g.us' && /পার্সেল/.test(c.text) && /TRK1/.test(c.text)), [r, calls]);
r = await run('parcel_status', { phone: '01713-000009' });
check('mgrdesk-1: parcel by phone', r.parcels && r.parcels.length === 1, r);

// group name / add
calls.length = 0;
r = await run('group_rename', { who: '01713000009', name: 'Karim Vai (Costareen VIP)' });
check('mgrdesk-1: group rename from the manager\'s number (the admin)', r.renamed && calls.some((c) => /updateGroupSubject\/boss1/.test(c.url) && c.subject === 'Karim Vai (Costareen VIP)') &&
  (await sql`select subject from customer_groups where phone = '8801713000009'`)[0].subject === 'Karim Vai (Costareen VIP)', [r, calls]);
calls.length = 0;
r = await run('group_add', { who: 'INV-MD-1', phone: '01713-000055' });
check('mgrdesk-1: add a person to the group (by invoice)', r.added === '8801713000055' && calls.some((c) => /updateParticipant\/boss1/.test(c.url) && c.action === 'add' && c.participants[0] === '8801713000055'), [r, calls]);
r = await run('group_rename', { who: '01713000099', name: 'x' });
check('mgrdesk-1: a customer without a group is a plain answer', /no WhatsApp group|not found/.test(r.error || ''), r);

// payment thanks + love reaction
calls.length = 0;
r = await asB(async (ctx) => md.thankPayment(ctx, prof, 'INV-MD-1', 500));
check('mgrdesk-1: a confirmed payment -> thanks in the group from Alvi', r.thanked && calls.some((c) => c.inst === 'ai9' && c.number === '120363000001@g.us' && /৳500 পেয়েছি/.test(c.text) && / ভাই/.test(c.text)), [r, calls]);
check('mgrdesk-1: ...and a ❤️ on the customer\'s last message (the screenshot)', calls.some((c) => /sendReaction\/ai9/.test(c.url) && c.reaction === '❤️' && c.key.id === 'CUSTMSG1' && c.key.remoteJid === '120363000001@g.us'), calls);

// due reminders (after the yes)
calls.length = 0;
r = await asB(async (ctx) => md.doMgrChange(ctx, prof, { tool: 'due_remind', args: { people: [{ phone: '8801713000009', name: 'Karim Hasan', due: 1200 }, { phone: '8801713000044', name: 'Nadia', due: 300 }] } }));
check('mgrdesk-1: due reminders: group when there is one, else their WhatsApp, polite, with the amount', r.sent === 2 &&
  calls.some((c) => c.number === '120363000001@g.us' && /৳1,200 বাকি/.test(c.text)) && calls.some((c) => c.number === '8801713000044' && /৳300 বাকি/.test(c.text)) && calls.every((c) => c.inst === 'ai9'), [r, calls]);
const seen = JSON.parse((await sql`select value from business_config where business_id = ${FIX.B} and key = 'mgr_due_reminded'`)[0].value);
check('mgrdesk-1: reminded people are remembered (not again for 3 days)', seen['8801713000009'] && seen['8801713000044']);
r = await run('due_reminders', { action: 'list' });
check('mgrdesk-1: due list answers (total + people)', r.total !== undefined && Array.isArray(r.customers), r);

// logo on all groups: prepared, needs a logo
r = await run('group_logo_all', {});
check('mgrdesk-1: logo on all groups: without a shop logo it says so plainly', /logo/.test(r.error || '') || r.prepared, r);
r = await asB(async (ctx) => md.doMgrChange(ctx, prof, { tool: 'group_logo_all', args: {} }));
check('mgrdesk-1: after the yes the groups are queued (one every 15 min)', r.queued === 1, r);

// the day's summary + stock watch
const txt = await asB(async (ctx) => md.dailySummary(ctx));
check('mgrdesk-1: the day\'s summary has sales, website orders, waiting chats, parcels, dues', /আজকের হিসাব/.test(txt) && /বিক্রি: \d+টা ইনভয়েস/.test(txt) && /ওয়েবসাইট অর্ডার: 1টা/.test(txt) && /উত্তর বাকি/.test(txt) && /পার্সেল/.test(txt), txt);
let s1 = await asB(async (ctx) => md.stockWatch(ctx, prof));
check('mgrdesk-1: stock watch: the first look only remembers', s1.first, s1);
const cat = await asB(async (ctx) => ib.catalogue(ctx));
const inStock = cat.find((x) => x.stock > 2);
if (inStock) {
  const fake = {}; for (const x of cat) fake[x.sku] = x.stock; fake[inStock.sku] = 0;
  await sql`update business_config set value = ${JSON.stringify(fake)} where business_id = ${FIX.B} and key = 'mgr_stock_seen'`;
  calls.length = 0;
  s1 = await asB(async (ctx) => md.stockWatch(ctx, prof));
  check('mgrdesk-1: back in stock -> the manager is told from Alvi\'s number', s1.sent === 1 && calls.some((c) => c.inst === 'ai9' && c.number === '8801900000652' && /আবার স্টকে/.test(c.text) && c.text.includes(inStock.name)), [s1, calls]);
}
s1 = await asB(async (ctx) => md.stockWatch(ctx, prof));
check('mgrdesk-1: no change -> quiet', s1.quiet, s1);

const bsrc = fs.readFileSync(path.join(fnDir, 'handlers', 'bosschat.js'), 'utf8');
check('mgrdesk-1: bosschat gives the manager the tools, yes-then-do for payments/invoices, and confirm/cancel', /MGR_TOOLS/.test(bsrc) && /PROPOSE_MGR = \['propose_payment', 'propose_invoice'\]/.test(bsrc) && /CONFIRM_TOOLS/.test(bsrc) && !/role === 'md' && name === 'confirm'/.test(bsrc));
const isrc = fs.readFileSync(path.join(fnDir, 'handlers', 'inbox.js'), 'utf8');
check('mgrdesk-1: the inbox timer runs mgrTick', /mgrdesk\.js'\)\)\.mgrTick\(ctx\)/.test(isrc));
done();
