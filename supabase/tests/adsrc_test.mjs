// adsrc-1 (161_ad_source.sql): the ad a chat came from - read from Messenger/Instagram referral, WhatsApp Cloud API
// referral and Evolution's externalAdReply; kept on the conversation (first ad wins), copied to the lead, shown in Leads.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, check, done, deps, web, fnDir } from './harness.mjs';

const ch = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inboxch.js')));
const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
web.on(/generativelanguage\.googleapis\.com/, () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'OK.' }] } }] } }));
web.on(/graph\.facebook\.com|evo\.test/, () => ({ status: 200, body: { success: true } }));

// ---- 1. reading the ad on each platform
let ev = ch.readHook('messenger', { entry: [{ messaging: [{ sender: { id: 'PSID1' }, recipient: { id: 'PAGE' }, timestamp: 1,
  message: { mid: 'mA1', text: 'price?' }, referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '120211', ads_context_data: { ad_title: 'PLA sale', photo_url: 'https://x/p.jpg', post_id: 'P9' } } }] }] });
check('Messenger: the ad on a message is read', ev.length === 1 && ev[0].ad && ev[0].ad.id === '120211' && ev[0].ad.title === 'PLA sale' && ev[0].ad.post === 'P9', ev);
ev = ch.readHook('messenger', { entry: [{ messaging: [{ sender: { id: 'PSID2' }, recipient: { id: 'PAGE' }, timestamp: 1, referral: { source: 'ADS', ad_id: '777' } }] }] });
check('Messenger: opening the chat from an ad (nothing typed) is its own event', ev.length === 1 && ev[0].type === 'referral' && ev[0].ad.id === '777', ev);
ev = ch.readHook('messenger', { entry: [{ messaging: [{ sender: { id: 'PSID3' }, recipient: { id: 'PAGE' }, timestamp: 1, message: { mid: 'mA3', text: 'hi' } }] }] });
check('Messenger: a normal message has no ad', ev.length === 1 && ev[0].ad === null, ev);
ev = ch.readHook('wa_cloud', { entry: [{ changes: [{ value: { contacts: [{ wa_id: '8801711000111', profile: { name: 'Rina' } }], messages: [{ from: '8801711000111', id: 'wamid1', timestamp: '1', type: 'text', text: { body: 'I saw your ad' },
  referral: { source_url: 'https://fb.me/x', source_id: '120299', source_type: 'ad', headline: 'Printer offer', ctwa_clid: 'CLID-abc' } }] } }] }] });
check('WhatsApp Cloud API: ad id, headline and ctwa_clid are read', ev[0].ad && ev[0].ad.id === '120299' && ev[0].ad.clid === 'CLID-abc' && ev[0].ad.title === 'Printer offer', ev);
ev = ch.readHook('wa_evo', { event: 'messages.upsert', data: { key: { remoteJid: '8801711000222@s.whatsapp.net', fromMe: false, id: 'E1' }, pushName: 'Karim',
  message: { extendedTextMessage: { text: 'Hello', contextInfo: { externalAdReply: { title: 'Filament deal', sourceId: '120300', sourceUrl: 'https://fb.me/y', sourceType: 'ad', ctwaClid: 'CLID-evo' } } } } } });
check('WhatsApp via Evolution: externalAdReply is read', ev[0].ad && ev[0].ad.id === '120300' && ev[0].ad.clid === 'CLID-evo' && ev[0].text === 'Hello', ev);
ev = ch.readHook('wa_evo', { event: 'messages.upsert', data: { key: { remoteJid: '8801711000222@s.whatsapp.net', fromMe: true, id: 'E2' }, message: { conversation: 'our reply' } } });
check('our own message never carries an ad', ev[0].ad === null, ev);

// ---- 2. kept on the chat, first ad wins, copied to the lead
await owner('erpInboxFeatures', [{ save: { leads: true } }]);
const wid = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings) values (${FIX.B}, 'wa_evo', 'Ads number', 'adsrc-test', 'practice', false, '{}'::jsonb) returning id`)[0].id;
const evoBody = (id, text, extra) => ({ event: 'messages.upsert', data: { key: { remoteJid: '8801711000333@s.whatsapp.net', fromMe: false, id }, pushName: 'Sumi', message: { extendedTextMessage: { text, ...(extra ? { contextInfo: { externalAdReply: extra } } : {}) } } } });
await asB((ctx) => ib.hookEvents(ctx, { id: wid }, evoBody('X1', 'I want the black PLA', { title: 'Black PLA ad', sourceId: 'AD-1', ctwaClid: 'CL-1' })));
let conv = (await sql`select * from inbox_conversations where channel_id = ${wid}`)[0];
check('the chat keeps the ad', conv && conv.ad && conv.ad.id === 'AD-1' && conv.ad.clid === 'CL-1', conv && conv.ad);
const note = (await sql`select text from inbox_messages where conversation_id = ${conv.id} and direction = 'note'`).map((m) => m.text);
check('a note in the chat says which ad', note.some((t) => /Came from an ad: Black PLA ad \(ad AD-1\)/.test(t)), note);
await asB((ctx) => ib.hookEvents(ctx, { id: wid }, evoBody('X2', 'and white?', { title: 'Other ad', sourceId: 'AD-2' })));
conv = (await sql`select * from inbox_conversations where channel_id = ${wid}`)[0];
check('a later ad does not overwrite the first', conv.ad.id === 'AD-1', conv.ad);
const contact = (await sql`select * from inbox_contacts where id = ${conv.contact_id}`)[0];
const leadId = await asB((ctx) => ib.leadUpsert(ctx, conv, contact, { name: 'Sumi', phone: '01711000333', want: 'black PLA' }, 'ai'));
let lead = (await sql`select * from inbox_leads where id = ${leadId}`)[0];
check('the lead made from the chat carries the ad', lead.ad && lead.ad.id === 'AD-1', lead.ad);
await sql`insert into erp_app_flags (key, enabled) values ('leads', true) on conflict (key) do update set enabled = true`;
let r = await owner('erpLeads', [{}]);
const shown = r.ok && (r.result.leads || r.result.rows || []).find((l) => l.id === leadId);
check('Leads shows the ad (id, title, whether Meta can be told)', shown && shown.ad && shown.ad.title === 'Black PLA ad' && shown.ad.clid === true, shown || r);

// a lead made before the ad was known gets it when the ad arrives
const wid2 = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings) values (${FIX.B}, 'wa_evo', 'Ads number 2', 'adsrc-test2', 'practice', false, '{}'::jsonb) returning id`)[0].id;
const b2 = (id, extra) => ({ event: 'messages.upsert', data: { key: { remoteJid: '8801711000444@s.whatsapp.net', fromMe: false, id }, message: { extendedTextMessage: { text: 'hi', ...(extra ? { contextInfo: { externalAdReply: extra } } : {}) } } } });
await asB((ctx) => ib.hookEvents(ctx, { id: wid2 }, b2('Y1')));
let c2 = (await sql`select * from inbox_conversations where channel_id = ${wid2}`)[0];
check('no ad: the chat has none', c2.ad === null, c2.ad);
const k2 = (await sql`select * from inbox_contacts where id = ${c2.contact_id}`)[0];
const l2 = await asB((ctx) => ib.leadUpsert(ctx, c2, k2, { name: 'Babu' }, 'ai'));
await asB((ctx) => ib.hookEvents(ctx, { id: wid2 }, b2('Y2', { title: 'Late ad', sourceId: 'AD-9' })));
lead = (await sql`select * from inbox_leads where id = ${l2}`)[0];
check('an ad seen later reaches the open lead too', lead.ad && lead.ad.id === 'AD-9', lead.ad);

// ---- 3. adsrc-2: orders from a Messenger chat go to Meta the business-messaging way (page dataset, PSID); never twice
const px = await import(pathToFileURL(path.join(fnDir, 'handlers', 'pixel.js')));
const chm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inboxch.js')));
const sent = [];   // {to, events}
web.on(/graph\.facebook\.com\/v21\.0\/[^/]+\/events/, (url, opts) => { const b = JSON.parse(opts.body); sent.push({ to: url.split('/')[4], token: (url.match(/access_token=([^&]+)/) || [])[1], body: b }); return { status: 200, body: { events_received: b.data.length } }; });
const dsCalls = [];
web.on(/\/dataset\?/, (url, opts) => {
  dsCalls.push({ url, method: opts.method });
  if (/PAGE-NO/.test(url)) return { status: 403, body: { error: { message: '(#200) Requires page_events permission' } } };
  return opts.method === 'GET' ? { status: 200, body: { data: [] } } : { status: 200, body: { id: 'DS-777' } };
});
r = await owner('erpPixelSet', [{ pixel: '1234567890123456', token: 'PIXEL-TOKEN', when: 'approved' }]);
check('the pixel is set', r.ok, r);
const mkMsgr = async (ext, name) => {
  const id = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings) values (${FIX.B}, 'messenger', ${name}, ${ext}, 'practice', false, '{}'::jsonb) returning id`)[0].id;
  await asB((ctx) => chm.chSecretSet(ctx, { id }, 'TOKEN', 'PAGE-TOKEN-' + ext));
  return id;
};
const pageCh = await mkMsgr('PAGE-77', 'Ads page'), noCh = await mkMsgr('PAGE-NO', 'Page without permission');
const msgrHook = (page, psid, mid, ad) => ({ entry: [{ id: page, messaging: [{ sender: { id: psid }, recipient: { id: page }, timestamp: 1, message: { mid, text: 'order please' }, ...(ad ? { referral: { source: 'ADS', ad_id: ad } } : {}) }] }] });
await asB((ctx) => ib.hookEvents(ctx, { id: pageCh }, msgrHook('PAGE-77', 'PSID-A', 'mid-A', 'AD-M1')));
await asB((ctx) => ib.hookEvents(ctx, { id: noCh }, msgrHook('PAGE-NO', 'PSID-B', 'mid-B')));
const cA = (await sql`select id from inbox_conversations where channel_id = ${pageCh}`)[0].id, cB = (await sql`select id from inbox_conversations where channel_id = ${noCh}`)[0].id;
await sql`update chat_orders set meta = jsonb_build_object('sent', jsonb_build_object('skipLead', 'x', 'skipPurchase', 'x')) where business_id = ${FIX.B}`;
const order = async (no, conv, phone) => (await sql`insert into chat_orders (business_id, no, conversation_id, name, phone, address, items, status) values (${FIX.B}, ${no}, ${conv}, 'Mim', ${phone}, 'Dhaka', ${sql.json([{ sku: 'X', qty: 2, price: 750 }])}, 'pending') returning id`)[0].id;
const oA = await order('CO-BM-A', cA, '01711000555'), oB = await order('CO-BM-B', cB, '01711000666'), oW = await order('CO-BM-W', conv.id, '01711000333');
let t = await asB((ctx) => px.pixelTick(ctx));
const toDs = sent.filter((x) => x.to === 'DS-777'), toPx = sent.filter((x) => x.to === '1234567890123456');
const evA = toDs.flatMap((x) => x.body.data).find((e) => e.custom_data.order_id === 'CO-BM-A');
check('Messenger order: LeadSubmitted to the page\'s dataset, business_messaging, page_id + PSID, the page token',
  evA && evA.event_name === 'LeadSubmitted' && evA.action_source === 'business_messaging' && evA.messaging_channel === 'messenger' &&
  evA.user_data.page_id === 'PAGE-77' && evA.user_data.page_scoped_user_id === 'PSID-A' && toDs[0].token === 'PAGE-TOKEN-PAGE-77' && toDs[0].body.partner_agent, { evA, toDs });
check('the dataset was asked for (GET, then made with POST) and kept', dsCalls.some((d) => /PAGE-77/.test(d.url) && d.method === 'POST') &&
  (await sql`select value from business_config where business_id = ${FIX.B} and key = 'bm_dataset_PAGE-77'`)[0].value === 'DS-777', dsCalls);
const pxNos = toPx.flatMap((x) => x.body.data).map((e) => e.custom_data.order_id);
check('the Evolution (WhatsApp) order went the pixel way as before', pxNos.includes('CO-BM-W') && !pxNos.includes('CO-BM-A'), pxNos);
check('a page Meta refuses: nothing sent that way, the order is moved to the pixel way', (await sql`select meta->>'way' w from chat_orders where id = ${oB}`)[0].w === 'pixel' && t.errors >= 1, t);
sent.length = 0; t = await asB((ctx) => px.pixelTick(ctx));
check('...and its Lead goes through the pixel the next minute (once, as "Lead")', sent.flatMap((x) => x.body.data).filter((e) => e.custom_data.order_id === 'CO-BM-B' && e.event_name === 'Lead').length === 1 && sent.every((x) => x.to !== 'DS-777' || !x.body.data.some((e) => e.custom_data.order_id === 'CO-BM-B')), sent);
await sql`update chat_orders set status = 'approved' where id = ${oA}`;
sent.length = 0; dsCalls.length = 0; t = await asB((ctx) => px.pixelTick(ctx));
const purA = sent.filter((x) => x.to === 'DS-777').flatMap((x) => x.body.data).find((e) => e.event_name === 'Purchase');
check('approved: Purchase to the same dataset (value 1500 BDT), the dataset not asked again, nothing to the pixel for it',
  purA && purA.custom_data.value === 1500 && purA.custom_data.currency === 'BDT' && dsCalls.length === 0 &&
  !sent.some((x) => x.to === '1234567890123456' && x.body.data.some((e) => e.custom_data.order_id === 'CO-BM-A')), { purA, dsCalls });
sent.length = 0; await asB((ctx) => px.pixelTick(ctx));
check('nothing is sent twice', !sent.some((x) => x.body.data.some((e) => e.custom_data.order_id === 'CO-BM-A')), sent);
check('the way stays on the order', (await sql`select meta->>'way' w from chat_orders where id = ${oA}`)[0].w === 'bm', null);

// ---- 4. adsrc-3: profit per ad
r = await owner('erpAdProfit', [{}]);
const m1 = r.ok && r.result.rows.find((x) => x.id === 'AD-M1');
check('profit per ad lists each ad with its chats and orders', r.ok && m1 && m1.chats === 1 && m1.orders === 1 && r.result.rows.some((x) => x.id === 'AD-1' && x.chats === 1 && x.leads === 1), r);
// the AD-M1 order becomes a delivered invoice that cost 500 a piece; the ad spent 300 through the ERP
const prod = (await sql`select id, sku from products where business_id = ${FIX.B} limit 1`)[0];
const invId = (await sql`insert into invoices (business_id, invoice_no, customer_name, subtotal, grand_total, delivery_status) values (${FIX.B}, 'INV-AD-1', 'Mim', 1500, 1500, 'Delivered') returning id`)[0].id;
await sql`insert into invoice_lines (business_id, invoice_id, product_id, sku, name, qty, unit_price, line_total, unit_cost) values (${FIX.B}, ${invId}, ${prod.id}, ${prod.sku}, 'X', 2, 750, 1500, 500)`;
await sql`update chat_orders set invoice_no = 'INV-AD-1' where id = ${oA}`;
await sql`insert into ad_campaigns (business_id, name, objective, account, ad_id, daily_budget, spend, status) values (${FIX.B}, 'M1', 'messages', 'act_1', 'AD-M1', 100, 300, 'running')`;
r = await asB(async (ctx) => { const { forget } = await import(pathToFileURL(path.join(fnDir, 'lib', 'tabs.js'))); try { forget(ctx, 'SALES_LOG'); } catch (_) { /* */ } return null; });
r = await owner('erpAdProfit', [{ days: 30 }]);
const m2 = r.ok && r.result.rows.find((x) => x.id === 'AD-M1');
check('delivered: sales 1500, goods 1000, gross 500, spend 300, profit 200, spend per order 300',
  m2 && m2.delivered === 1 && m2.sales === 1500 && m2.gross === 500 && m2.spend === 300 && m2.profit === 200 && m2.perOrder === 300, m2 || r);
check('the best ad is first', r.result.rows[0].id === 'AD-M1', r.result.rows.map((x) => x.id));
// adsrc-4: the courier charged 130 + 15 COD, the customer paid 70 delivery -> courier 75, profit 125
await sql`update invoices set delivery_charge = 70 where id = ${invId}`;
await sql`insert into courier_payout_lines (business_id, payout_id, consignment_id, invoice_no, cod_amount, status, delivery_charge, cod_charge) values (${FIX.B}, 'P1', 'C1', 'INV-AD-1', 1570, 'delivered', 130, 15)`;
r = await owner('erpAdProfit', [{ days: 30 }]);
const m3 = r.ok && r.result.rows.find((x) => x.id === 'AD-M1');
check('courier after the customer\'s delivery charge: 75, profit 500 - 75 - 300 = 125', m3 && m3.courier === 75 && m3.profit === 125 && r.result.total.courier >= 75, m3 || r);
r = await (await import('./harness.mjs')).sales('erpAdProfit', [{}]);
check('sales staff cannot see profit per ad', !r.ok, r);

// another business never sees it
const other = (await sql`select count(*)::int n from inbox_conversations where business_id <> ${FIX.B} and ad is not null`)[0].n;
check('no other business got an ad', other === 0, other);

done();
