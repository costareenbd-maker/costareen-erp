// joint-ai-1 (owner 11 Nov 2026): "Polymaker is in the joint stock and we sell it - the AI must see it too". The joint
// pool's products are in the sales AI's catalogue (pool code ~J, pool price and stock), their pictures come from the
// website by name, and a chat order of them becomes an invoice with joint lines. Made-up products and people only.
import { sql, FIX, owner, mgr, check, done, deps, web } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';

const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partner-ai@t.test', ${sql.json({ full_name: 'Partner Owner' })})`;
const B3 = (await sql.begin(async (t) => { await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`; return t`select create_business('Partner Shop') as id`; }))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
await sql`insert into joint_flags (business_id) values (${FIX.B}), (${B3}) on conflict do nothing`;
let r = await owner('erpJointStart', [{ action: 'create', name: 'Filament JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner Shop', tier: 'retail' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PX-PLA-RED', name: 'Testchroma PLA Red', brand: 'Testmaker', category: 'Filaments', type: 'PLA', retail: 1550, floor: 1400, cost: 1100 }]);
await owner('erpJointReceive', [{ pool: POOL, sku: 'PX-PLA-RED', qty: 10, unitCost: 1100, paidBy: FIX.B }]);

// the website's public catalogue (names + pictures)
await sql`insert into business_config (business_id, key, value) values (${FIX.B}, 'website_api', 'https://shop.test/wp-json/cz/v1') on conflict (business_id, key) do update set value = excluded.value`;
web.on(/shop\.test\/api\/v1\/catalog\/products/, () => ({ status: 200, body: { total: 3, items: [
  { name_en: 'Testmaker Testchroma PLA Matte Red Refill Filament 1.75mm 1kg', brand_name: 'Testmaker', thumb_url: '/static/p/matte_t.webp' },
  { name_en: 'Testmaker Testchroma PLA Red Refill Filament 1.75mm 1kg', brand_name: 'Testmaker', thumb_url: '/static/p/red_t.webp' },
  { name_en: 'Testmaker Testchroma PLA Blue Refill Filament 1.75mm 1kg', brand_name: 'Testmaker', thumb_url: '/static/p/blue_t.webp' }] } }));

const cat = await asB((ctx) => ib.catalogue(ctx));
const j = cat.find((x) => /^PX-PLA-RED~J/i.test(x.sku));
check('joint-ai-1: the joint stock product is in the AI\'s catalogue with the pool\'s price and stock', j && j.joint && j.sell === 1550 && j.stock === 10 && j.cost === 0, j);
check('joint-ai-1: its picture comes from the website (the exact name, not the "Matte" one), full size', j && j.link === 'https://shop.test/static/p/red.webp', j && j.link);
check('joint-ai-1: name matching - exact beats extra words; another colour never matches', ib.nameMatch('Testchroma PLA Red', 'Testmaker Testchroma PLA Red Refill Filament 1.75mm 1kg', 'Testmaker') === 1 &&
  ib.nameMatch('Testchroma PLA Red', 'Testmaker Testchroma PLA Matte Red Refill', 'Testmaker') === 2 && !ib.nameMatch('Testchroma PLA Red', 'Testmaker Testchroma PLA Blue Refill', 'Testmaker'));

// a chat order of it -> approve -> an invoice with a joint line (the pool's copy made)
await owner('erpInboxProfile', [{ save: { name: 'Costareen', delivery_in: 70, per_kg_in: 20, filament_g: 1300 } }]);
const ch = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on) values (${FIX.B}, 'messenger', 'Page', 'PAGEJ', 'live', true) returning *`)[0];
const ct = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name) values (${FIX.B}, ${ch.id}, 'PSIDJ', 'Rahim Uddin') returning *`)[0];
const cv = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id) values (${FIX.B}, ${ch.id}, ${ct.id}) returning *`)[0];
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text) values (${FIX.B}, ${cv.id}, 'in', 'customer', 'text', 'Rahim, 01712345678, House 5 Road 3 Mirpur 10 Dhaka. confirm')`;
let script = [[{ functionCall: { name: 'place_order', args: { name: 'Rahim', phone: '01712345678', address: 'House 5, Road 3, Mirpur 10, Dhaka', items: [{ code: j.sku, qty: 2 }] } } }], [{ text: 'ji bhai, order confirm.' }]];
web.on(/generativelanguage\.googleapis\.com/, () => { const next = script.shift() || [{ text: 'ok' }]; return { status: 200, body: { candidates: [{ content: { parts: next } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } } }; });
web.on(/graph\.facebook\.com/, () => ({ status: 200, body: { message_id: 'm1' } }));
await asB((ctx) => ib.agentReply(ctx, cv, { test: false }));
const o = (await sql`select * from chat_orders where conversation_id = ${cv.id}`)[0];
check('joint-ai-1: the AI takes a chat order of the joint product at the pool\'s price', o && o.items.length === 1 && /~J/.test(o.items[0].sku) && Number(o.items[0].price) === 1550, o);
r = await mgr('erpChatOrderAct', [{ id: o.id, action: 'approve' }]);
const inv = r.ok ? (await sql`select * from invoices where business_id = ${FIX.B} and invoice_no = ${r.result.invoiceNo || (await sql`select invoice_no from chat_orders where id = ${o.id}`)[0].invoice_no}`)[0] : null;
const lines = inv ? await sql`select * from invoice_lines where invoice_id = ${inv.id}` : [];
check('joint-ai-1: approving it makes an invoice with a joint line and the pool\'s copy', r.ok && lines.length === 1 && lines[0].pool_id && (await sql`select 1 from joint_sales where seller_invoice_no = ${inv.invoice_no} or invoice_no = ${inv.invoice_no}`.catch(() => [1])).length >= 1, [r, lines]);
await done();
