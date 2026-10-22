// leads-1 (owner 22 Oct 2026): one Leads list of customers and suppliers, fed from inside the ERP (comments, warm
// chats, landing pages, quote requests, market wanted posts), found outside (the map, Google through the AI), pasted
// (LinkedIn, Facebook, supplier pages, cards) or imported - never added twice, made into a customer or a supplier.
import { sql, FIX, owner, mgr, sales, web, check, done } from './harness.mjs';

const B = FIX.B;
let r = await sales('erpLeads', [{}]);
const adminOwner = (await owner('erpLeads', [{}])).ok;
check('an "Only me" app: a non-admin is refused while it is not open', !r.ok && /not open/.test(r.error), r);
await sql`insert into erp_app_flags (key, enabled) values ('leads', true) on conflict (key) do update set enabled = true`;
r = await sales('erpLeads', [{}]);
check('...and lets them in once the provider opens it', r.ok, r);

// ---- by hand, never twice
r = await mgr('erpLeadUpsert', [{ kind: 'customer', source: 'referral', name: 'Rafiq Maker', company: 'Maker Lab BD', phone: '01711-223344', city: 'Dhaka', want: 'PLA in bulk' }]);
const L1 = r.result && r.result.id;
check('a customer lead is added by hand', r.ok && r.result.added, r);
r = await mgr('erpLeadUpsert', [{ kind: 'customer', name: 'Rafiq again', phone: '+8801711223344' }]);
check('...the same phone is not added twice', r.ok && !r.result.added && r.result.id === L1, r);
r = await mgr('erpLeadUpsert', [{ kind: 'supplier', source: 'b2b', company: 'Shenzhen Filament Co., Ltd.', email: 'sales@szfil.test', country: 'China', link: 'https://szfil.en.alibaba.com' }]);
const S1 = r.result && r.result.id;
check('a supplier lead is added', r.ok && r.result.added, r);
r = await mgr('erpLeadUpsert', [{ kind: 'supplier', company: 'SZ Filament', link: 'https://szfil.en.alibaba.com' }]);
check('...the same link is not added twice', r.ok && !r.result.added, r);
r = await mgr('erpLeadUpsert', [{ kind: 'customer' }]);
check('a lead with nothing to reach is refused', !r.ok, r);

r = await mgr('erpLeads', [{ kind: 'supplier' }]);
check('the supplier tab lists suppliers only, with counts per kind', r.ok && r.result.leads.length === 1 && r.result.leads[0].company.startsWith('Shenzhen') && r.result.counts.customer === 1 && r.result.counts.supplier === 1, r.result && r.result.counts);
check('...and the sources a supplier can come from (Alibaba / 1688, Google, the map, LinkedIn ...)', r.ok && r.result.sources.some((s) => s.key === 'b2b') && r.result.sources.some((s) => s.key === 'maps') && !r.result.sources.some((s) => s.key === 'facebook_comment'), r.result.sources.map((s) => s.key));

// ---- brought in from inside the ERP
const ch = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status) values (${B}, 'messenger', 'Shop page', 'PAGE1', 'live') returning id`)[0].id;
await sql`insert into inbox_comments (business_id, channel_id, post_id, comment_id, from_id, from_name, text) values
  (${B}, ${ch}, 'p1', 'c1', 'u1', 'Nadia', 'PLA silk er dam koto?'), (${B}, ${ch}, 'p1', 'c2', 'u2', 'Karim', 'Nice print!'), (${B}, ${ch}, 'p1', 'c3', 'PAGE1', 'Shop page', 'Price inbox e dilam')`;
const ct = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name, phone) values (${B}, ${ch}, 'psid-9', 'Sumon', '01811000999') returning id`)[0].id;
await sql`insert into inbox_conversations (business_id, channel_id, contact_id, interest, last_in_at, last_text) values (${B}, ${ch}, ${ct}, 'hot', now(), 'Ender 3 ache?')`;
const pg = (await sql`insert into landing_pages (business_id, sku, headline) values (${B}, 'X1', 'Silk PLA offer') returning id`)[0].id;
await sql`insert into landing_drafts (business_id, page_id, visitor, name, phone, qty) values (${B}, ${pg}, 'v1', 'Lima', '01911000111', 2)`;
await sql`insert into print_requests (business_id, req_no, name, phone, notes) values (${B}, 'Q-1', 'Arif', '01611000222', 'Gear for a fan')`;
r = await mgr('erpLeadHarvest', []);
const H = r.result || {};
check('bring in: the comment asking a price, the hot chat, the unfinished landing order, the quote request',
  r.ok && H.added === 4 && H.bySource.facebook_comment.added === 1 && H.bySource.messenger.added === 1 && H.bySource.landing.added === 1 && H.bySource.quote.added === 1, H);
r = await mgr('erpLeadHarvest', []);
check('...a second time adds nothing (never twice)', r.ok && r.result.added === 0, r.result);
const chat = (await sql`select conversation_id, phone, source from inbox_leads where business_id = ${B} and source_ref like 'chat:%'`)[0];
check('the chat lead keeps its conversation and phone', chat && chat.conversation_id && chat.phone === '01811000999', chat);
r = await sales('erpLeadHarvest', []);
check('a salesperson does not run it', !r.ok, r);

// ---- pasted
r = await mgr('erpLeadCapture', [{ text: 'Tanvir Hasan\nHead of Design at Bright Architects Ltd.\nDhaka, Bangladesh\nhttps://www.linkedin.com/in/tanvir-hasan\n+880 1712 345678' }]);
const C = r.result && r.result.lead;
check('a pasted LinkedIn profile: name, company, phone, city, link, source LinkedIn', r.ok && C.source === 'linkedin' && C.name === 'Tanvir Hasan' && C.company === 'Bright Architects Ltd.' && C.note === 'Head of Design' &&
  C.phone.replace(/\D/g, '').endsWith('1712345678') && C.city === 'Dhaka' && C.country === 'Bangladesh' && C.kind === 'customer', C);
r = await mgr('erpLeadCapture', [{ text: 'Ningbo Polymer Materials Co., Ltd.\nManufacturer of PLA / PETG filament\nsales@nbpoly.test\nhttps://nbpoly.en.alibaba.com/' }]);
check('a pasted Alibaba page is a supplier lead with its e-mail', r.ok && r.result.lead.kind === 'supplier' && r.result.lead.source === 'b2b' && r.result.lead.email === 'sales@nbpoly.test' && r.result.lead.country === 'China', r.result && r.result.lead);

// ---- found on the map (OpenStreetMap)
web.on(/nominatim\.openstreetmap\.org/, () => ({ body: [{ display_name: 'Dhaka, Dhaka District, Bangladesh', boundingbox: ['23.6', '23.9', '90.3', '90.5'] }] }));
web.on(/overpass-api\.de/, () => ({ body: { elements: [
  { type: 'node', id: 11, tags: { name: 'Gadget Point', shop: 'electronics', phone: '+880 1700 000011', 'addr:city': 'Dhaka' } },
  { type: 'node', id: 12, tags: { name: 'Bits & Bytes', shop: 'computer' } },
  { type: 'way', id: 13, tags: { shop: 'electronics' } }] } }));
r = await mgr('erpLeadFind', [{ kind: 'customer', via: 'map', what: 'electronics', place: 'Dhaka' }]);
const F = r.result || {};
check('the map finds named shops, the ones with a phone first', r.ok && F.list.length === 2 && F.list[0].company === 'Gadget Point' && F.list[0].ref === 'osm:node/11' && !F.list[0].have, F);
await mgr('erpLeadUpsert', [F.list[0]]);
r = await mgr('erpLeadFind', [{ kind: 'customer', via: 'map', what: 'electronics', place: 'Dhaka' }]);
check('...and marks the one already added', r.ok && r.result.list[0].have === true, r.result && r.result.list[0]);
r = await mgr('erpLeadFind', [{ kind: 'customer', via: 'ai', what: 'architects', place: 'Dhaka' }]);
check('Google through the AI says plainly when no AI key is set', !r.ok && /AI key/.test(r.error), r);

// ---- a list
r = await mgr('erpLeadImport', [{ kind: 'supplier', source: 'linkedin', rows: [['Full Name', 'Company', 'Email', 'Country'], ['Li Wei', 'Shenzhen Parts Ltd', 'li@szparts.test', 'China'],
  ['', '', '', ''], ['Li Wei dup', 'Shenzhen Parts Ltd', 'li@szparts.test', 'China']] }]);
check('an imported list: added, the empty row skipped, the repeat not added twice', r.ok && r.result.added === 1 && r.result.same === 1 && r.result.skipped === 1, r.result);
r = await mgr('erpLeadImport', [{ rows: [['Foo', 'Bar'], ['1', '2']] }]);
check('a sheet with no Name / Company / Phone / Email column is refused', !r.ok, r);

// ---- moving a lead on
r = await sales('erpLeadAct', [{ id: L1, stage: 3, note: 'Called, wants 20 rolls', followUp: '2026-11-02' }]);
const e = await sql`select what from inbox_lead_events where lead_id = ${L1} order by id`;
check('stage, note and follow-up are kept with their history', r.ok && e.some((x) => x.what === 'Stage: Interested') && e.some((x) => /Called, wants 20/.test(x.what)) && e.some((x) => /2026-11-02/.test(x.what)), e);
r = await sales('erpLeadAct', [{ id: L1, convert: 'customer' }]);
check('a salesperson does not make customers from leads', !r.ok, r);
r = await mgr('erpLeadAct', [{ id: L1, convert: 'customer' }]);
const cu = (await sql`select id, name, phone from customers where business_id = ${B} and name = 'Rafiq Maker'`)[0];
const l1 = (await sql`select stage, customer_id from inbox_leads where id = ${L1}`)[0];
check('made a customer: the customer exists and the lead is Won and linked', r.ok && cu && l1.stage === 5 && l1.customer_id === cu.id, { cu, l1, r });
r = await mgr('erpLeadAct', [{ id: S1, convert: 'supplier' }]);
const su = (await sql`select id from suppliers where business_id = ${B} and name = 'Shenzhen Filament Co., Ltd.'`)[0];
check('made a supplier from a supplier lead', r.ok && !!su, r);

// ---- the other business sees none of it
const other = (await sql`select count(*)::int as n from inbox_leads where business_id = ${FIX.B2}`)[0].n;
check('the other business is untouched', other === 0, other);
await done();
