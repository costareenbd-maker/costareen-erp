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

// another business never sees it
const other = (await sql`select count(*)::int n from inbox_conversations where business_id <> ${FIX.B} and ad is not null`)[0].n;
check('no other business got an ad', other === 0, other);

done();
