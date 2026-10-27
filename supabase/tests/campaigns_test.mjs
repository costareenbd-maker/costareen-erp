// Campaigns (WhatsApp) - erpCampaign*, erpCamp*, erpLead*, erpEvo*, product
// lists, the spread timer (campaignTick) and the STOP webhook (waHook).
// Run: TEST_SCRIPT=campaigns_test.mjs ... erp_server_test.py (see docs/PORTING.md)
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, web, files, pdfs, deps, fnDir } from './harness.mjs';

const C = await import(pathToFileURL(path.join(fnDir, 'handlers', 'campaigns.js')));
const T = await import(pathToFileURL(path.join(fnDir, 'lib', 'time.js')));

// ---- the outside world --------------------------------------------------------
const sleeps = [];
deps.sleep = async (ms) => { sleeps.push(ms); };
deps.hookBase = 'https://proj.test/functions/v1/erp';
const EVO = 'https://wa.test';
const evo = { state: 'open', stateCode: 200, sendCode: 201, sendBody: null, sent: [], hook: [], logout: 0, qr: 'QRDATA' };
let msgN = 0;
web.on(/^https:\/\/wa\.test\/instance\/connectionState\//, () => ({ status: evo.stateCode, body: { instance: { state: evo.state } } }));
web.on(/^https:\/\/wa\.test\/instance\/connect\//, () => ({ status: 200, body: { base64: evo.qr } }));
web.on(/^https:\/\/wa\.test\/instance\/logout\//, () => { evo.logout++; return { status: 200, body: {} }; });
web.on(/^https:\/\/wa\.test\/message\/send(Text|Media)\//, (url, opts) => {
  const b = JSON.parse(opts.body);
  evo.sent.push({ url, body: b, headers: opts.headers });
  if (evo.sendCode === 200 || evo.sendCode === 201) return { status: evo.sendCode, body: { key: { id: 'M' + (++msgN) } } };
  return { status: evo.sendCode, body: evo.sendBody || { response: { message: ['bad number'] } } };
});
web.on(/^https:\/\/wa\.test\/webhook\/set\//, (url, opts) => { evo.hook.push(JSON.parse(opts.body)); return { status: 201, body: {} }; });
web.on(/^https:\/\/down\.test\//, () => { throw new Error('connect ECONNREFUSED'); });

const ok = (r) => r && r.ok;
const err = (r) => (r && !r.ok ? r.error : '(no error)');
const today = T.todayStr(new Date());
const sends = (id) => sql`select * from campaign_sends where business_id = ${FIX.B} and campaign_no = ${id} order by seq`;

/** A context for the timer / webhook, which run outside erpCall. */
async function inBiz(now, fn) {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${JSON.stringify({ sub: FIX.U.owner, role: 'authenticated' })}, true)`;
    return fn({ tx, sql, s: { name: 'Timer', role: 'manager', businessId: FIX.B, businessName: 'Costareen' },
                biz: FIX.B, now, memo: {}, deps });
  });
}
const atDhaka = (h, m = 0, ymd = today) => new Date(T.dhakaDayStart(ymd).getTime() + (h * 60 + m) * 60000);

// ---- roles -------------------------------------------------------------------
let r = await sales('erpCampaignAudience', []);
check('sales cannot open campaigns', !ok(r) && /does not have permission/.test(r.error), r);
r = await mgr('erpEvoSetup', [{ url: EVO }]);
check('manager cannot set up the WhatsApp server', !ok(r) && /does not have permission/.test(r.error), r);
r = await mgr('erpEvoStopHook', [{}]);
check('manager cannot switch STOP replies', !ok(r) && /does not have permission/.test(r.error), r);

// ---- Evolution set-up and status ---------------------------------------------
r = await mgr('erpEvoStatus', []);
check('not set up', ok(r) && r.result.configured === false && r.result.hasKey === false && r.result.stopHook === false && !('connected' in r.result), r);
r = await mgr('erpEvoSendTest', [{ phone: '01712345678', text: 'hi' }]);
check('test send without a server', !ok(r) && r.error === 'Evolution API is not ready.', r);
r = await owner('erpEvoSetup', [{ url: 'wa.example.com', instance: 'x' }]);
check('bad server address', err(r) === 'The server address should look like https://wa.example.com', r);
r = await owner('erpEvoSetup', [{ url: EVO, instance: 'my shop' }]);
check('bad instance name', err(r) === 'The instance name: letters, numbers, - _ . only.', r);
r = await owner('erpEvoSetup', [{ url: EVO + '///', instance: 'shop1', key: ' SECRETKEY ' }]);
check('set up: connected, trailing slashes trimmed', ok(r) && r.result.configured && r.result.connected === true && r.result.state === 'open' &&
  r.result.url === EVO && r.result.instance === 'shop1' && r.result.hasKey === true, r);
check('the key never comes back', !JSON.stringify(r.result).includes('SECRETKEY'));
const sec = await sql`select key, value from business_secrets where business_id = ${FIX.B} order by key`;
check('secrets stored per business, key trimmed', sec.find((s) => s.key === 'ERP_EVO_KEY').value === 'SECRETKEY' && sec.length === 3, sec);
check('apikey header sent', web.calls.some((c) => /connectionState\/shop1$/.test(c.url) && c.opts.headers.apikey === 'SECRETKEY'));

evo.stateCode = 401;
r = await mgr('erpEvoStatus', []);
check('401 -> refused the key', r.result.error === 'The server refused the API key.' && r.result.connected === false, r);
evo.stateCode = 404;
r = await mgr('erpEvoStatus', []);
check('404 -> no instance', r.result.error === 'The server has no instance called "shop1".', r);
evo.stateCode = 502;
r = await mgr('erpEvoStatus', []);
check('other code', r.result.error === 'The server answered 502.', r);
evo.stateCode = 200; evo.state = 'close';
r = await mgr('erpEvoStatus', []);
check('reachable, no number linked -> needsLink', r.result.needsLink === true && r.result.connected === false &&
  r.result.error === 'The server is set up, but no WhatsApp number is linked to it yet.', r);
r = await owner('erpEvoQr', []);
check('QR code, prefixed as an image', ok(r) && r.result.connected === false && r.result.qr === 'data:image/png;base64,QRDATA', r);
r = await mgr('erpEvoSendTest', [{ phone: '01712345678', text: 'hi' }]);
check('test send while not linked', err(r) === 'The server is set up, but no WhatsApp number is linked to it yet.', r);
evo.state = 'open';
r = await owner('erpEvoQr', []);
check('QR when already linked', ok(r) && r.result.connected === true, r);
r = await owner('erpEvoLogout', []);
check('logout calls the server and answers the status', ok(r) && evo.logout === 1 && r.result.configured, r);
await sql`update business_secrets set value = 'https://down.test' where business_id = ${FIX.B} and key = 'ERP_EVO_URL'`;
r = await mgr('erpEvoStatus', []);
check('unreachable server', /^The server could not be reached: /.test(r.result.error), r);
await sql`update business_secrets set value = ${EVO} where business_id = ${FIX.B} and key = 'ERP_EVO_URL'`;

// ---- test message --------------------------------------------------------------
r = await mgr('erpEvoSendTest', [{ phone: '0171', text: 'hi' }]);
check('test number checked', err(r) === 'The test number must be an 11-digit mobile number, or a number abroad written with + and its country code.', r);
r = await mgr('erpEvoSendTest', [{ phone: '01712345678', text: '  ' }]);
check('test needs text', err(r) === 'Write the message first.', r);
r = await mgr('erpEvoSendTest', [{ phone: '01712345678', text: 'x'.repeat(4001) }]);
check('test text max 4000', err(r) === 'The message is over 4,000 characters.', r);
r = await mgr('erpEvoSendTest', [{ phone: '+82 10-1234-5678', text: 'Hello' }]);
check('test to a number abroad', ok(r) && r.result.to === '821012345678' && evo.sent.at(-1).body.number === '821012345678' && evo.sent.at(-1).body.text === 'Hello', r);
evo.sendCode = 400;
r = await mgr('erpEvoSendTest', [{ phone: '01712345678', text: 'Hello' }]);
check('test that did not go', err(r) === 'It did not go: ["bad number"]', r);
evo.sendCode = 201;

// ---- leads ---------------------------------------------------------------------
r = await mgr('erpLeadsAdd', [{ text: '  \n ' }]);
check('nothing pasted', err(r) === 'Paste at least one number.', r);
r = await mgr('erpLeadsAdd', [{ text: Array.from({ length: 501 }, (_, i) => '0171' + String(1000000 + i)).join('\n') }]);
check('at most 500 lines', err(r) === 'At most 500 at a time.', r);
r = await mgr('erpLeadsAdd', [{ one: { name: 'Kim', phone: '', code: '+82' } }]);
check('one: phone needed', err(r) === 'Type the phone number.', r);
r = await mgr('erpLeadsAdd', [{ one: { name: 'Kim', phone: '1012345678', code: '+82' }, source: 'Facebook' }]);
check('one lead abroad', ok(r) && r.result.added === 1 && r.result.skipped.length === 0, r);
let lead = (await sql`select * from campaign_leads where business_id = ${FIX.B} and name = 'Kim'`)[0];
check('stored +<cc><number>, key i<digits>, source, by', lead && lead.phone === '+821012345678' && lead.lead_key === 'i821012345678' &&
  lead.source === 'Facebook' && lead.by === 'Mehedi', lead);
r = await mgr('erpLeadsAdd', [{ one: { name: 'K', phone: '0171', code: '+880' } }]);
check('one: unusable number', err(r) === 'That phone number cannot be used: 0171. At home it is 11 digits starting 01; abroad, the country code and the full number.', r);
r = await mgr('erpLeadsAdd', [{ one: { name: 'Karim', phone: '01712345678', code: '+880' } }]);
check('one: already a customer', err(r) === '01712345678 is already a customer.', r);
r = await mgr('erpLeadsAdd', [{ text: 'Rafiq, 01811 111 112\n01898765432\nhello there\n02 9123 4567\nKarim 01712345678\n01898765432\n0082 10 9999 8888 Lee', source: 'Calls' }]);
check('paste: 3 added', ok(r) && r.result.added === 3, r);
const why = ok(r) ? r.result.skipped.map((s) => s.why) : [];
check('paste: reasons, in order', JSON.stringify(why) === JSON.stringify(['no phone number in it',
  'not an 11-digit mobile number, nor a number with a country code (+…)', 'already a customer', 'already a lead']), r.result);
const leads = await sql`select lead_key, name, phone, source from campaign_leads where business_id = ${FIX.B} order by seq`;
check('paste: name is what is left, number tidied', leads[1].name === 'Rafiq' && leads[1].phone === '01811111112' && leads[1].lead_key === '1811111112' &&
  leads[2].name === '' && leads[3].phone === '+821099998888' && leads[3].name === 'Lee' && leads[3].source === 'Calls', leads);
r = await mgr('erpLeadSave', [{ key: '1811111112', name: 'Rafiq Ahmed', source: 'Shop' }]);
check('lead saved', ok(r) && (await sql`select name, source from campaign_leads where lead_key = '1811111112'`)[0].name === 'Rafiq Ahmed', r);
r = await mgr('erpLeadSave', [{ key: 'nope', name: 'x' }]);
check('lead save: gone', err(r) === 'That lead is no longer on the list.', r);
r = await mgr('erpLeadRemove', [{ key: '1898765432' }]);
check('lead removed', ok(r) && !(await sql`select 1 from campaign_leads where lead_key = '1898765432'`).length, r);
r = await mgr('erpLeadRemove', [{ key: '1898765432' }]);
check('lead remove: gone', err(r) === 'That lead is no longer on the list.', r);

// ---- audience ------------------------------------------------------------------
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'FIL-SUN-PLA-BLA-001', qty: 1 }], payMode: 'none' }]);
check('(seed) a sale to Karim, unpaid', ok(r), r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01911111111' }, items: [{ sku: 'PRT-BAM-A1-001', qty: 1 }], payMode: 'full' }]);
check('(seed) a sale to Rahim, paid', ok(r), r);
await sql`insert into customers (business_id, name, phone) values (${FIX.B}, 'No Phone', ''), (${FIX.B}, 'Landline', '029123456'),
          (${FIX.B}, 'Karim again', '+8801712345678')`;
r = await mgr('erpCampaignAudience', []);
const aud = r.result || {};
const karim = (aud.customers || []).find((c) => c.key === '1712345678');
const rahim = (aud.customers || []).find((c) => c.key === '1911111111');
check('audience runs', ok(r) && aud.leadDaily === 30 && aud.leadRestDays === 7 && aud.spreadFrom === 10 && aud.spreadTo === 20, r);
check('only valid mobiles, de-duplicated by key', aud.customers.filter((c) => !c.lead).length === 2 &&
  !aud.customers.find((c) => c.name === 'Landline' || c.name === 'No Phone'), aud.customers);
check('Karim: wa, 1 order, spent 1350, Filaments, due 1350, today', karim && karim.wa === '8801712345678' && karim.orders === 1 &&
  karim.spent === 1350 && JSON.stringify(karim.cats) === '["Filaments"]' && karim.due === 1350 && karim.daysSince === 0 &&
  karim.optedOut === '' && karim.lastMessagedDays === null, karim);
check('sorted by spent: Rahim (52000) first', aud.customers[0] === rahim && rahim.spent === 52000 && rahim.due === 0, aud.customers[0]);
const auLeads = aud.customers.filter((c) => c.lead);
const kim = auLeads.find((c) => c.key === 'i821012345678');
check('leads after customers, with source', auLeads.length === 3 && aud.customers.indexOf(auLeads[0]) === 2 && kim && kim.wa === '821012345678' &&
  kim.source === 'Facebook' && kim.orders === 0 && kim.daysSince === null, auLeads);
check('categories, distinct and sorted', JSON.stringify(aud.categories) === '["Filaments","Printers"]', aud.categories);
check('saved lists empty', aud.saved && aud.saved.messages.length === 0 && aud.saved.groups.length === 0 && aud.stats.stopped === 0, aud);

// ---- saved messages and groups -------------------------------------------------
r = await mgr('erpCampMsgSave', [{ name: 'Monthly', text: '', attach: 'pdf' }]);
check('message needs text', err(r) === 'Write the message first.', r);
r = await mgr('erpCampMsgSave', [{ name: '  ', text: 'Hi {name}' }]);
check('message needs a name', err(r) === 'Give it a name.', r);
r = await mgr('erpCampMsgSave', [{ name: 'Monthly', text: 'x'.repeat(4001) }]);
check('message max 4000', err(r) === 'The message is over 4,000 characters.', r);
r = await mgr('erpCampMsgSave', [{ name: 'Monthly', text: 'Hi {name}', attach: 'file' }]);
const msg1 = ok(r) && r.result.messages[0];
check('message saved; own file is not kept', msg1 && /^MSG-[0-9a-f]{10}$/.test(msg1.id) && msg1.attach === 'none' && msg1.text === 'Hi {name}', r);
r = await mgr('erpCampMsgSave', [{ name: 'monthly', text: 'Other' }]);
check('message names unique (any case)', err(r) === 'There is already one called monthly.', r);
r = await mgr('erpCampMsgSave', [{ id: msg1.id, name: 'Monthly list', text: 'Hi {name}!', attach: 'sheet' }]);
check('message edited in place', ok(r) && r.result.messages.length === 1 && r.result.messages[0].name === 'Monthly list' && r.result.messages[0].attach === 'sheet', r);
r = await mgr('erpCampMsgSave', [{ id: 'MSG-nope', remove: true }]);
check('remove a message that is gone', err(r) === 'That is no longer there.', r);
r = await mgr('erpCampGroupSave', [{ name: '', filter: {} }]);
check('group needs a name', err(r) === 'Give the group a name.', r);
r = await mgr('erpCampGroupSave', [{ name: 'Filament buyers', filter: { q: '', last: 'in90', cats: ['Filaments'], minSpent: 500, junk: 'x' } }]);
const g1 = ok(r) && r.result.groups[0];
check('group saved: only known filters, as text', g1 && /^GRP-/.test(g1.id) && g1.filter.last === 'in90' && g1.filter.minSpent === '500' &&
  JSON.stringify(g1.filter.cats) === '["Filaments"]' && !('junk' in g1.filter), r);
r = await mgr('erpCampGroupSave', [{ name: 'FILAMENT BUYERS', filter: {} }]);
check('group names unique', err(r) === 'There is already a group called FILAMENT BUYERS.', r);
r = await mgr('erpCampGroupSave', [{ id: g1.id, remove: true }]);
check('group removed', ok(r) && r.result.groups.length === 0 && r.result.messages.length === 1, r);
r = await mgr('erpCampMsgSave', [{ id: msg1.id, remove: true }]);
check('message removed', ok(r) && r.result.messages.length === 0, r);

// ---- a campaign by hand ----------------------------------------------------------
r = await mgr('erpCampaignCreate', [{ name: 'Oct', message: ' ', recipients: [] }]);
check('hand: message needed', err(r) === 'Write the message first.', r);
r = await mgr('erpCampaignCreate', [{ name: 'Oct', message: 'x'.repeat(20001), recipients: [] }]);
check('hand: message max', err(r) === 'The message is too long.', r);
r = await mgr('erpCampaignCreate', [{ name: 'Oct', message: 'Hi', recipients: [{ key: 'x', phone: '0171' }, { key: '', phone: '01712345678' }] }]);
check('hand: nobody usable', err(r) === 'Choose at least one customer with a mobile number.', r);
const many = Array.from({ length: 2001 }, (_, i) => ({ key: 'k' + i, name: 'P' + i, phone: '0171' + String(1000000 + i) }));
r = await mgr('erpCampaignCreate', [{ message: 'Hi', recipients: many }]);
check('hand: at most 2000', err(r) === 'At most 2,000 customers in one campaign.', r);
r = await mgr('erpCampaignCreate', [{ name: '', message: 'Hi {name}', recipients: [
  { key: '1712345678', name: 'Karim', phone: '01712345678' }, { key: '1712345678', name: 'Karim', phone: '01712345678' },
  { key: '1911111111', name: 'Rahim', phone: '01911111111' }] }]);
const hand = r.result;
check('hand: created, duplicates left out, default name', ok(r) && /^CMP-\d{6}-\d{6}$/.test(hand.id) && hand.recipients.length === 2 &&
  hand.name === 'Campaign ' + T.formatDate(new Date(), 'd MMM yyyy') && hand.spread === null && hand.by === 'Mehedi' &&
  /^\d{1,2} \w{3} \d{4}, \d{1,2}:\d{2} (AM|PM)$/.test(hand.created), r);
check('hand: recipients waiting, wa number', hand.recipients[0].status === 'waiting' && hand.recipients[0].wa === '8801712345678' && !('lead' in hand.recipients[0]), hand.recipients);
r = await mgr('erpCampaignMark', [{ id: hand.id, key: '1712345678', status: 'done' }]);
check('mark: unknown status', err(r) === 'Unknown status.', r);
r = await mgr('erpCampaignMark', [{ id: hand.id, key: '0000', status: 'sent' }]);
check('mark: not in campaign', err(r) === 'That customer is not in this campaign.', r);
r = await mgr('erpCampaignMark', [{ id: hand.id, key: '1712345678', status: 'sent' }]);
check('mark: sent', ok(r) && r.result.ok === true, r);
r = await mgr('erpCampaignGet', [{ id: hand.id }]);
check('get: sent, with time and who', ok(r) && r.result.recipients[0].status === 'sent' && r.result.recipients[0].by === 'Mehedi' &&
  /^\d{1,2} \w{3}, \d{1,2}:\d{2} (AM|PM)$/.test(r.result.recipients[0].at), r.result && r.result.recipients);
r = await mgr('erpCampaignGet', [{ id: 'CMP-nope' }]);
check('get: no such campaign', err(r) === 'No such campaign.', r);
r = await mgr('erpCampaignList', []);
check('list: counts, by hand', ok(r) && r.result[0].id === hand.id && r.result[0].auto === false && r.result[0].spread === false &&
  JSON.stringify(r.result[0].counts) === '{"waiting":1,"sent":1,"skipped":0,"failed":0}', r);
r = await mgr('erpCampaignAudience', []);
check('audience: last messaged today, sent this month 1', r.result.customers.find((c) => c.key === '1712345678').lastMessagedDays === 0 &&
  r.result.stats.sentMonth === 1, r.result.stats);

// ---- asked to stop ----------------------------------------------------------------
r = await mgr('erpCampaignOptOut', [{ key: '' }]);
check('opt-out: which customer', err(r) === 'Which customer?', r);
r = await mgr('erpCampaignOptOut', [{ key: '1911111111', name: 'Rahim', phone: '01911111111' }]);
check('opt-out recorded', ok(r) && r.result.optedOut === true, r);
let o = (await sql`select * from campaign_optouts where business_id = ${FIX.B}`)[0];
check('opt-out row: reason default, by', o.reason === 'asked to stop' && o.by === 'Mehedi' && o.phone === '01911111111', o);
check('waiting sends of that person become skipped', (await sends(hand.id)).find((s) => s.customer_key === '1911111111').status === 'skipped');
r = await mgr('erpCampaignCreate', [{ message: 'Hi', recipients: [{ key: '1911111111', name: 'Rahim', phone: '01911111111' }] }]);
check('opted-out people are left out', err(r) === 'Choose at least one customer with a mobile number.', r);
r = await mgr('erpCampaignAudience', []);
check('audience shows the opt-out', r.result.customers.find((c) => c.key === '1911111111').optedOut === 'asked to stop' && r.result.stats.stopped === 1, r.result.stats);
r = await mgr('erpCampaignOptOut', [{ key: '1911111111', undo: true }]);
check('opt-out undone', ok(r) && r.result.optedOut === false && !(await sql`select 1 from campaign_optouts where business_id = ${FIX.B}`).length, r);

// ---- files: upload, share, product lists --------------------------------------------
r = await mgr('erpEvoUpload', [{ mime: 'text/plain', name: 'a.txt', data: 'aGk=' }]);
check('upload: type checked', err(r) === 'Attach a PDF, PNG or JPEG.', r);
const pdfBytes = '%PDF-1.4 brochure';
r = await mgr('erpEvoUpload', [{ mime: 'application/pdf', name: 'Brochure.pdf', data: Buffer.from(pdfBytes).toString('base64') }]);
const up = r.result;
check('upload: saved in assets', ok(r) && up.name === 'Brochure.pdf' && up.mime === 'application/pdf' && /^assets\/u\d{12}[0-9a-f]{4}-Brochure\.pdf$/.test(up.fileId), r);
check('upload: bytes kept', new TextDecoder().decode(files.get(FIX.B + '/' + up.fileId).bytes) === pdfBytes);
r = await mgr('erpShareFile', [{ fileId: up.fileId }]);
check('share: link and the name as uploaded', ok(r) && r.result.name === 'Brochure.pdf' && /^https:\/\/files\.test\//.test(r.result.url) && r.result.fileId === up.fileId, r);
r = await mgr('erpShareFile', [{ fileId: '' }]);
check('share: which file', err(r) === 'Which file?', r);
r = await mgr('erpShareFile', [{ fileId: 'backups/everything.sql' }]);
check('share: only campaign files', err(r) === 'That file is no longer there.', r);

r = await mgr('erpWaProductPdf', [{}]);
const ymd = T.formatDate(new Date(), 'yyyy-MM-dd');
let html = pdfs.at(-1).html;
check('product PDF: name, both products, prices', ok(r) && r.result.name === 'Costareen - available products ' + ymd + '.pdf' && r.result.products === 2 &&
  r.result.fileId === 'assets/' + r.result.name && /<h2 style="margin:0">Costareen<\/h2>/.test(html) &&
  html.includes('Available products · ' + T.formatDate(new Date(), 'd MMMM yyyy')) &&
  html.includes('<td>Sunlu PLA Black</td><td align="right" width="90">1350</td>') && html.indexOf('<h3 style="margin:14px 0 6px">Filaments') < html.indexOf('Printers'), r);
r = await mgr('erpWaProductPdf', [{ cats: ['Printers'], prices: false }]);
html = pdfs.at(-1).html;
check('product PDF: category filter, no prices', ok(r) && r.result.products === 1 && !html.includes('Sunlu') && html.includes('<tr><td>Bambu A1</td></tr>'), r);
await sql`update products set status = 'Discontinued' where business_id = ${FIX.B} and sku = 'PRT-BAM-A1-001'`;
r = await mgr('erpProductListShare', [{ kind: 'pdf' }]);
check('share list as PDF: discontinued left out', ok(r) && r.result.kind === 'pdf' && r.result.products === 1 && /^https:\/\/files\.test\//.test(r.result.url), r);
await sql`update products set status = 'Active' where business_id = ${FIX.B} and sku = 'PRT-BAM-A1-001'`;
r = await mgr('erpProductListShare', [{ kind: 'sheet' }]);
const csvKey = FIX.B + '/assets/Costareen - available products ' + ymd + '.csv';
let csv = files.get(csvKey) ? new TextDecoder().decode(files.get(csvKey).bytes) : '';
check('share list as "sheet": a CSV file with the same columns', ok(r) && r.result.kind === 'sheet' && r.result.products === 2 &&
  r.result.name === 'Costareen - available products ' + ymd && csv.replace(/^﻿/, '').split('\r\n')[0] === 'Category,Product,Brand,Price (BDT)' &&
  csv.includes('Filaments,Sunlu PLA Black,Sunlu,1350') && csv.indexOf('Filaments') < csv.indexOf('Printers'), [r, csv]);
r = await mgr('erpProductListShare', [{ kind: 'sheet', prices: false, cats: ['Filaments'] }]);
csv = new TextDecoder().decode(files.get(csvKey).bytes);
check('CSV without prices drops the column', ok(r) && r.result.products === 1 && csv.replace(/^﻿/, '').split('\r\n')[0] === 'Category,Product,Brand' &&
  csv.includes('Filaments,Sunlu PLA Black,Sunlu\r\n'), csv);

// ---- sent through Evolution, all at once -------------------------------------------
r = await mgr('erpEvoCampaignStart', [{ name: 'Now', text: ' ', recipients: [] }]);
check('evo: text needed', err(r) === 'Write the message first.', r);
r = await mgr('erpEvoCampaignStart', [{ name: 'Now', text: 'x'.repeat(4001), recipients: [] }]);
check('evo: text max', err(r) === 'The message is over 4,000 characters. Shorten it or send the product list as a PDF.', r);
r = await mgr('erpEvoCampaignStart', [{ name: 'Now', text: 'Hi', startOn: '5 Oct', recipients: [{ key: '1712345678', phone: '01712345678' }] }]);
check('evo: date format', err(r) === 'The start date should look like 2026-10-05.', r);
r = await mgr('erpEvoCampaignStart', [{ name: 'Now', text: 'Hi', startOn: '2020-01-01', recipients: [{ key: '1712345678', phone: '01712345678' }] }]);
check('evo: date passed', err(r) === 'The start date has already passed.', r);
r = await mgr('erpEvoCampaignStart', [{ name: 'Now', text: 'Assalamu alaikum {name} ,\nOffer!', spread: false, attach: null, recipients: [
  { key: '1712345678', name: 'Karim', phone: '01712345678' }, { key: '1911111111', name: 'Rahim ', phone: '01911111111' }] }]);
const now1 = r.result;
check('evo: created, not spread, EVO: message', ok(r) && now1.spread === null && /^EVO:\{"evo":true/.test(now1.message), r);
r = await mgr('erpCampaignList', []);
check('list: auto', r.result.find((c) => c.id === now1.id).auto === true, r.result);
sleeps.length = 0; evo.sent.length = 0;
r = await mgr('erpEvoSendBatch', [{ id: now1.id, max: 25 }]);
check('batch: both sent, nothing left', ok(r) && r.result.sent === 2 && r.result.failed === 0 && r.result.left === 0 && r.result.stopped === false, r);
check('batch: 8 s between the two, none before the first', JSON.stringify(sleeps) === '[8000]', sleeps);
check('batch: {name} filled, " ," fixed, no lead footer', evo.sent[0].body.text === 'Assalamu alaikum Karim,\nOffer!' &&
  evo.sent[1].body.text === 'Assalamu alaikum Rahim,\nOffer!' && evo.sent[0].body.number === '8801712345678' && /sendText\/shop1$/.test(evo.sent[0].url), evo.sent);
let ss = await sends(now1.id);
check('batch: sent rows carry who and the message id', ss[0].status === 'sent' && /^Mehedi · M\d+$/.test(ss[0].by), ss);

// a batch never runs longer than 12 people (fits the Edge Function's time)
const fifteen = Array.from({ length: 15 }, (_, i) => ({ key: 'b' + i, name: 'B' + i, phone: '0181' + String(2000000 + i) }));
r = await mgr('erpEvoCampaignStart', [{ name: 'Big', text: 'Hi {name}', recipients: fifteen }]);
const big = r.result;
sleeps.length = 0;
r = await mgr('erpEvoSendBatch', [{ id: big.id, max: 25 }]);
check('batch capped at 12, 3 left', ok(r) && r.result.sent === 12 && r.result.left === 3 && sleeps.length === 11 && sleeps.every((x) => x === 8000), [r, sleeps]);
evo.sendCode = 400;
r = await mgr('erpEvoSendBatch', [{ id: big.id }]);
check('batch: a refused number fails, the rest carry on', ok(r) && r.result.failed === 3 && r.result.stopped === false && r.result.trail === 3 &&
  r.result.errors.length === 3 && r.result.errors[0] === 'B12: ["bad number"]', r);
ss = await sends(big.id);
check('failed rows carry the reason', ss[12].status === 'failed' && ss[12].by === 'Mehedi · ["bad number"]', ss[12]);
r = await mgr('erpCampaignRetry', [{ id: big.id }]);
check('retry puts the failed back', ok(r) && r.result.recipients.filter((x) => x.status === 'waiting').length === 3, r);
r = await mgr('erpCampaignRetry', [{ id: big.id }]);
check('retry with none failed', err(r) === 'Nobody in this campaign has failed.', r);
evo.sendCode = 500; evo.sendBody = { message: 'Connection Closed' };
r = await mgr('erpEvoSendBatch', [{ id: big.id }]);
check('batch: server trouble stops at once', ok(r) && r.result.failed === 1 && r.result.stopped === true && r.result.left === 2 &&
  r.result.errors.at(-1) === 'Stopped: Connection Closed', r);
evo.sendCode = 201; evo.sendBody = null;
r = await mgr('erpEvoSendBatch', [{ id: hand.id }]);
check('batch refuses a by-hand campaign', err(r) === 'This campaign is not sent through Evolution API.', r);
r = await mgr('erpEvoSendBatch', [{ id: 'CMP-x' }]);
check('batch: no such campaign', err(r) === 'No such campaign.', r);

// with an attachment
r = await mgr('erpEvoCampaignStart', [{ name: 'Att', text: 'See {name}', attach: { fileId: up.fileId, name: 'Brochure.pdf', mime: 'application/pdf' },
  recipients: [{ key: '1712345678', name: 'Karim', phone: '01712345678' }] }]);
evo.sent.length = 0;
r = await mgr('erpEvoSendBatch', [{ id: r.result.id }]);
const media = evo.sent[0] && evo.sent[0].body;
check('attachment sent as a document with the caption', ok(r) && r.result.sent === 1 && /sendMedia\/shop1$/.test(evo.sent[0].url) && media.mediatype === 'document' &&
  media.mimetype === 'application/pdf' && media.caption === 'See Karim' && media.fileName === 'Brochure.pdf' &&
  Buffer.from(media.media, 'base64').toString() === pdfBytes, media);
r = await mgr('erpEvoSendTest', [{ phone: '01712345678', text: 'T', attach: { fileId: up.fileId, name: 'Brochure.pdf', mime: 'application/pdf' } }]);
check('test with the attachment', ok(r) && evo.sent.at(-1).body.mediatype === 'document', r);

// two campaigns in the same second do not share an id
r = await inBiz(new Date(), async (ctx) => {
  const a = await C.erpCampaignCreate(ctx, { message: 'A', recipients: [{ key: '1712345678', phone: '01712345678' }] });
  const b = await C.erpCampaignCreate(ctx, { message: 'B', recipients: [{ key: '1712345678', phone: '01712345678' }] });
  return [a.id, b.id];
});
check('same-second campaigns get their own ids (-2, -3 ...)', r[0] !== r[1] && r.every((x) => /^CMP-\d{6}-\d{6}(-\d+)?$/.test(x)) && /-\d+$/.test(r[1]), r);

// ---- spread through the day ---------------------------------------------------------
r = await mgr('erpEvoCampaignStart', [{ name: 'Leads', text: 'Hi {name}', recipients: [
  { key: 'i821012345678', name: 'Kim', phone: '+821012345678' }, { key: '1811111112', name: 'Rafiq Ahmed', phone: '01811111112' }] }]);
const sp = r.result;
check('a lead makes it spread', ok(r) && sp.spread && sp.spread.from === 10 && sp.spread.to === 20 && sp.spread.paused === false &&
  sp.spread.leadDaily === 30 && sp.spread.start === '' && sp.spread.last === '', r);
check('leads flagged in a spread campaign', sp.recipients.every((x) => x.lead === true), sp.recipients);
r = await mgr('erpEvoSendBatch', [{ id: sp.id }]);
check('batch refuses a spread campaign', err(r) === 'This campaign sends itself through the day. Pause or resume it instead.', r);
r = await mgr('erpCampaignPause', [{ id: sp.id, pause: true }]);
check('paused, says by whom', ok(r) && r.result.spread.paused === true && r.result.spread.why === 'Paused by Mehedi.', r);
r = await mgr('erpCampaignList', []);
check('list: spread + paused', r.result.find((c) => c.id === sp.id).paused === true && r.result.find((c) => c.id === sp.id).spread === true);
r = await inBiz(atDhaka(12), (ctx) => C.campaignTick(ctx));
check('tick: paused campaign is left alone', r.sent === 0 && (await sends(sp.id)).every((x) => x.status === 'waiting'), r);
r = await mgr('erpCampaignPause', [{ id: sp.id, pause: false }]);
check('resumed', ok(r) && r.result.spread.paused === false && r.result.spread.why === '', r);
r = await mgr('erpCampaignPause', [{ id: hand.id, pause: true }]);
check('pause: not a spread campaign', err(r) === 'That campaign does not send itself.', r);

r = await inBiz(atDhaka(21), (ctx) => C.campaignTick(ctx));
check('tick: outside 10-20 nothing goes', r.sent === 0, r);
evo.sent.length = 0; sleeps.length = 0;
r = await inBiz(atDhaka(12), (ctx) => C.campaignTick(ctx));
// 2 waiting, 8 h left = 48 ticks -> 1 this time
check('tick: one sent, spread over the day', r.sent === 1 && evo.sent.length === 1, r);
check('tick: lead gets the STOP footer', evo.sent[0].body.text === 'Hi Kim\n\nReply STOP to stop these messages.' && evo.sent[0].body.number === '821012345678', evo.sent);
ss = await sends(sp.id);
check('tick: sent by Timer', ss[0].status === 'sent' && /^Timer · M\d+$/.test(ss[0].by), ss[0]);
r = await mgr('erpCampaignGet', [{ id: sp.id }]);
check('get: last send shown', r.result.spread.last !== '', r.result.spread);
r = await inBiz(atDhaka(12, 5), (ctx) => C.campaignTick(ctx));
check('tick: too soon after the last one (gap)', r.sent === 0, r);
r = await inBiz(atDhaka(14), (ctx) => C.campaignTick(ctx));
check('tick: later, the next one', r.sent === 1, r);

// a lead messaged in the last 7 days is skipped in the next campaign
r = await mgr('erpEvoCampaignStart', [{ name: 'Leads 2', text: 'Again {name}', recipients: [{ key: 'i821012345678', name: 'Kim', phone: '+821012345678' }] }]);
const sp2 = r.result;
r = await inBiz(atDhaka(15), (ctx) => C.campaignTick(ctx));
ss = await sends(sp2.id);
check('lead rest days: skipped with the reason', r.sent === 0 && ss[0].status === 'skipped' && ss[0].by === 'Timer · messaged in the last 7 days', ss);

// server trouble pauses a spread campaign by itself
r = await mgr('erpEvoCampaignStart', [{ name: 'Spread', text: 'Yo {name}', spread: true, recipients: [{ key: '1712345678', name: 'Karim', phone: '01712345678' }] }]);
const sp3 = r.result;
check('spread asked for (customers only)', ok(r) && sp3.spread && !sp3.recipients[0].lead, r);
evo.sendCode = 401;
r = await inBiz(atDhaka(16), (ctx) => C.campaignTick(ctx));
r = await mgr('erpCampaignGet', [{ id: sp3.id }]);
check('stopped by itself, with the reason', r.result.spread.paused === true && /^Stopped by itself: /.test(r.result.spread.why) && r.result.recipients[0].status === 'failed', r.result.spread);
evo.sendCode = 201;
r = await mgr('erpCampaignRetry', [{ id: sp3.id }]);
check('retry un-pauses a spread campaign', ok(r) && r.result.spread.paused === false && r.result.spread.why === '' && r.result.recipients[0].status === 'waiting', r.result && r.result.spread);

// three failures in a row across ticks
r = await mgr('erpEvoCampaignStart', [{ name: 'Fails', text: 'F', spread: true, recipients: Array.from({ length: 3 }, (_, i) => ({ key: 'f' + i, phone: '0191' + String(3000000 + i) })) }]);
const sp4 = r.result;
await sql`update campaigns set spread = spread || '{"paused":true}' where business_id = ${FIX.B} and campaign_no <> ${sp4.id} and spread is not null`;
evo.sendCode = 400;
for (const h of [11, 13, 15]) await inBiz(atDhaka(h), (ctx) => C.campaignTick(ctx));
r = await mgr('erpCampaignGet', [{ id: sp4.id }]);
check('3 failures in a row pause it', r.result.spread.paused === true && /^Stopped by itself: 3 messages in a row failed\. Last: /.test(r.result.spread.why), r.result.spread);
evo.sendCode = 201;

// a future start date
const tomorrow = T.formatDate(new Date(Date.now() + 86400000), 'yyyy-MM-dd');
r = await mgr('erpEvoCampaignStart', [{ name: 'Later', text: 'L', startOn: tomorrow, recipients: [{ key: '1712345678', phone: '01712345678' }] }]);
const sp5 = r.result;
check('a start date makes it spread', ok(r) && sp5.spread && sp5.spread.start === tomorrow, r);
r = await inBiz(atDhaka(12), (ctx) => C.campaignTick(ctx));
check('tick: its day has not come', (await sends(sp5.id))[0].status === 'waiting');
r = await inBiz(atDhaka(12, 0, tomorrow), (ctx) => C.campaignTick(ctx));
check('tick: on its day it goes', (await sends(sp5.id))[0].status === 'sent', r);

// nothing waiting anywhere
await sql`update campaign_sends set status = 'skipped' where business_id = ${FIX.B} and status = 'waiting'`;
r = await inBiz(atDhaka(12), (ctx) => C.campaignTick(ctx));
check('tick: nothing waiting -> done', r.done === true, r);
check('spreadBusinesses: none left', (await C.spreadBusinesses(sql)).length === 0);

// ---- STOP replies --------------------------------------------------------------------
r = await owner('erpEvoStopHook', [{}]);
const hk = evo.hook.at(-1) && evo.hook.at(-1).webhook;
const word = ((hk && hk.url) || '').split('hook=')[1] || '';
check('STOP on: webhook set with a secret word', ok(r) && r.result.stopHook === true && hk.enabled === true && /^[0-9a-f]{64}$/.test(word) &&
  hk.url.startsWith('https://proj.test/functions/v1/erp?biz=' + FIX.B + '&hook=') && JSON.stringify(hk.events) === '["MESSAGES_UPSERT"]', [r, hk]);
check('the word is never in the answer', !JSON.stringify(r.result).includes(word));
const msgFrom = (jid, text, extra = {}) => ({ event: 'messages.upsert', data: { key: { remoteJid: jid, fromMe: false, ...extra }, pushName: 'Someone', message: { conversation: text } } });
r = await inBiz(new Date(), (ctx) => C.waHook(ctx, msgFrom('8801911111111@s.whatsapp.net', 'STOP'), { hook: 'wrong' }));
check('hook: wrong word refused', r.ok === false, r);
r = await inBiz(new Date(), (ctx) => C.waHook(ctx, msgFrom('8801911111111@s.whatsapp.net', 'hello'), { hook: word }));
check('hook: other text ignored', r.ok === true && !r.stopped, r);
r = await inBiz(new Date(), (ctx) => C.waHook(ctx, msgFrom('8801911111111@s.whatsapp.net', 'STOP', { fromMe: true }), { hook: word }));
check('hook: own message ignored', r.ok === true && !r.stopped, r);
r = await inBiz(new Date(), (ctx) => C.waHook(ctx, msgFrom('12036302@g.us', 'stop'), { hook: word }));
check('hook: group ignored', r.ok === true && !r.stopped, r);
r = await inBiz(new Date(), (ctx) => C.waHook(ctx, { event: 'MESSAGES_UPSERT', data: { key: { remoteJid: '8801911111111:12@s.whatsapp.net' },
  pushName: 'Rahim', message: { extendedTextMessage: { text: ' Stop! ' } } } }, { hook: word }));
o = (await sql`select * from campaign_optouts where business_id = ${FIX.B} and customer_key = '1911111111'`);
check('hook: STOP opts out by customer key', r.stopped === true && o.length === 1 && o[0].reason === 'replied STOP' && o[0].by === 'WhatsApp reply' &&
  o[0].phone === '01911111111' && o[0].customer === 'Rahim', o);
r = await inBiz(new Date(), (ctx) => C.waHook(ctx, msgFrom('8801911111111@s.whatsapp.net', 'বন্ধ'), { hook: word }));
check('hook: already stopped, not twice', r.stopped === true && (await sql`select 1 from campaign_optouts where customer_key = '1911111111'`).length === 1, r);
r = await inBiz(new Date(), (ctx) => C.waHook(ctx, msgFrom('821012345678@s.whatsapp.net', 'unsubscribe.'), { hook: word }));
o = (await sql`select * from campaign_optouts where business_id = ${FIX.B} and customer_key = 'i821012345678'`)[0];
check('hook: a lead abroad, named from the lead list', r.stopped === true && o && o.customer === 'Kim' && o.phone === '+821012345678', o);
r = await owner('erpEvoStopHook', [{ off: true }]);
check('STOP off: webhook disabled, word forgotten', ok(r) && r.result.stopHook === false && evo.hook.at(-1).webhook.enabled === false &&
  !(await sql`select 1 from business_secrets where business_id = ${FIX.B} and key = 'ERP_EVO_HOOK'`).length, r);
r = await inBiz(new Date(), (ctx) => C.waHook(ctx, msgFrom('8801712345678@s.whatsapp.net', 'stop'), { hook: word }));
check('hook: refused once switched off', r.ok === false, r);

// ---- another business sees none of it ----------------------------------------------------
await sql`insert into campaigns (business_id, campaign_no, name, message, recipients) values (${FIX.B2}, 'CMP-OTHER', 'Theirs', 'x', 0)`;
r = await mgr('erpCampaignList', []);
check('campaigns of another business are invisible', ok(r) && !r.result.find((c) => c.id === 'CMP-OTHER'), r);
r = await mgr('erpCampaignGet', [{ id: 'CMP-OTHER' }]);
check("another business's campaign cannot be opened", err(r) === 'No such campaign.', r);

// ---- setup clear ----------------------------------------------------------------------
r = await owner('erpEvoSetup', [{ clear: true }]);
check('clear: forgets the server', ok(r) && r.result.configured === false &&
  (await sql`select count(*)::int as n from business_secrets where business_id = ${FIX.B} and key like 'ERP_EVO_%'`)[0].n === 0, r);

await done();
