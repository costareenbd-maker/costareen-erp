// ship-8: the traveller's own page. Owner's rules: without our bag only his own details; from the moment staff put him
// on a shipment until staff mark it received he sees that shipment; his own scan never completes anything; a staff
// scan never makes staff the carrier; a new phone opens with a WhatsApp code, not name + phone.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir, web } from './harness.mjs';

const P = await import(pathToFileURL(path.join(fnDir, 'handlers', 'shipportal.js')));
const N = await import(pathToFileURL(path.join(fnDir, 'handlers', 'shipnotify.js')));
const B = FIX.B;
deps.google = Object.assign({}, deps.google || {}, { appUrl: 'https://erp.example.com/' });
const evo = { sent: [] };
web.on(/^https:\/\/wa\.test\/instance\/connectionState\//, () => ({ status: 200, body: { instance: { state: 'open' } } }));
web.on(/^https:\/\/wa\.test\/message\/sendText\//, (url, opts) => { evo.sent.push(JSON.parse(opts.body)); return { status: 201, body: {} }; });
async function inBiz(fn, now) {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify({ sub: FIX.U.owner, role: 'authenticated' })}, true)`;
    return fn({ tx, sql, s: { name: 'Public', role: 'owner', businessId: B, businessName: 'Benndar Express', userId: FIX.U.owner }, biz: B, now: now || new Date(), memo: {}, deps });
  });
}
const act = (a, opt) => inBiz((ctx) => P.portalAct(ctx, a, opt));
const PH = 'data:image/jpeg;base64,' + 'Q'.repeat(60);

await sql`insert into business_config (business_id, key, value) values (${B}, 'business_kind', 'cargo') on conflict (business_id, key) do update set value = 'cargo'`;
let r = await owner('erpEvoSetup', [{ url: 'https://wa.test', instance: 'alvi', key: 'K' }]);

// the sign-up link
r = await sales('erpShipJoinLink', []);
const j = (r.result.url.match(/j=([0-9a-f]{32})/) || [])[1];
check('join link', r.ok && j && r.result.url === 'https://erp.example.com/c/?j=' + j, r);
let x = await act('join-info', { j: 'f'.repeat(32) });
check('wrong join link refused', x.status === 404, x);
x = await act('join-info', { j });
check('join info: business name only', x.status === 200 && x.body.biz.name === 'Benndar Express' && !x.body.me && !x.body.active, x.body);
x = await act('join', { j, body: { name: 'Arif', phone: '12345' } });
check('bad phone refused in Bangla', x.status === 400 && /দেশের কোড/.test(x.body.error), x.body);
x = await act('join', { j, body: { name: 'Arif', phone: '010-4410-2291', addrBd: 'Mirpur 10', addrKr: 'Ansan', waOk: true, photo: PH } });
check('joined: personal key, link sent on WhatsApp', x.status === 200 && /^[0-9a-f]{32}$/.test(x.body.key) && evo.sent.some((m) => m.number === '821044102291' && m.text.indexOf('c/?k=' + x.body.key) > 0), { x, sent: evo.sent });
const k = x.body.key;
x = await act('join', { j, body: { name: 'Someone else', phone: '+82 10 4410 2291' } });
check('same phone again: must use a code, nothing taken over', x.status === 409 && x.body.exists === true && !x.body.key, x.body);

// without our bag: only his own details
x = await act('me', { k });
check('own page: only his details', x.status === 200 && x.body.me.name === 'Arif' && x.body.me.addrKr === 'Ansan' && x.body.me.code === 'C-0001' && x.body.active === null, x.body);
const first = JSON.stringify(x.body);
await mgr('erpShipTeamSave', [{ name: 'Mehedi', phone: '01847800652', port: 'DAC', photo: PH }]);
await mgr('erpShipGuideSave', [{ port: 'DAC', terminal: 'Terminal 3', meet: 'Gate 4, outside', steps: 'Belt 5\nGreen channel\nGate 4, left', photos: [PH] }]);
x = await act('me', { k });
check('no team, no guide, no staff phone before a shipment', !/Mehedi|8801847800652|Gate 4/.test(JSON.stringify(x.body)), x.body);
x = await act('save', { k, body: { addrBd: 'Uttara', phone: '010-4410-2291' } });
check('he edits his own details', x.status === 200 && x.body.me.addrBd === 'Uttara', x.body);

// luggage request
x = await act('request', { k, body: { direction: 'kr_bd', leaveOn: '2026-12-15', bags: 2, devices: 1, ownGoods: true, carry: ['ল্যাপটপ', 'something else'] } });
check('no rules tick needed; only items from our list kept', x.status === 200 && x.body.history[0].carry.join() === 'ল্যাপটপ' && x.body.carryList.indexOf('মোবাইল ফোন') >= 0, x.body);
await sql`delete from ship_requests where carry::text like '%ল্যাপটপ%'`;
x = await act('request', { k, body: { direction: 'kr_bd', leaveOn: '2026-12-15', returnOn: '2026-12-01', agree: true } });
check('return before leaving refused', x.status === 400, x.body);
x = await act('request', { k, body: { direction: 'kr_bd', leaveOn: '2026-12-15', returnOn: '2027-01-10', flight: 'KE 657', bags: 2, devices: 1, ownGoods: true, agree: true } });
check('request saved, shows on his page', x.status === 200 && x.body.requests.length === 1 && x.body.requests[0].state === 'new' && x.body.requests[0].bags === 2, x.body);
r = await sales('erpShipRequests', []);
const rid = r.result.requests[0].id;
check('staff see the request', r.ok && r.result.requests[0].person.name === 'Arif' && r.result.requests[0].leaveOn === '2026-12-15', r);
r = await sales('erpAlerts', []);   // sales has no bell, managers do
r = await mgr('erpAlerts', []);
check('bell: new request', r.ok && r.result.alerts.some((a) => /যাত্রা জানানো/.test(a.title)), r.ok && r.result.alerts);

// staff make the shipment from it: his page opens the shipment at once (owner: from the moment his name is given)
r = await sales('erpShipRequestMake', [{ id: rid }]);
check('shipment made with him as traveller', r.ok && r.result.carrier && r.result.carrier.code === 'C-0001' && r.result.returnOn === '2027-01-10', r);
const tr = r.result.id, code = r.result.code;
r = await sales('erpShipRequestMake', [{ id: rid }]);
check('not twice', !r.ok, r);
r = await sales('erpShipMeetNote', [{ id: tr, note: 'Black jacket, paper with C-0001' }]);
r = await owner('erpShipBagNew', [{ nickname: 'Blue', photos: [{ photo: PH, thumb: PH }, { photo: PH, thumb: PH }] }]);
await owner('erpShipBagAdd', [{ id: tr, bagId: r.result.id }]);
const bagCode = r.result.code;
await owner('erpShipItems', [{ id: tr, add: { name: 'Toner', qty: 10, place: 'bag', bagId: r.result.id } }]);
x = await act('me', { k });
check('holding: team, guide, note, bags', x.body.active && x.body.active.code === code && x.body.active.team[0].name === 'Mehedi' && x.body.active.guide.terminal === 'Terminal 3'
  && x.body.active.guide.steps.length === 3 && x.body.active.meetNote.indexOf('Black jacket') === 0 && x.body.active.bags[0].code === bagCode && x.body.active.bags[0].photo === PH, x.body.active);

// his own scan: logged only; never completes, never changes the carrier
x = await act('took', { k, body: { code: 'BG-9999' } });
check('a bag not in his shipment refused', x.status === 400, x.body);
x = await act('took', { k, body: { code: bagCode } });
check('he confirms taking the bag', x.status === 200 && x.body.active.took === true, x.body.active);
let s = (await sql`select step, received_at, carrier_id from ships where id = ${tr}`)[0];
check('his scan changed nothing on the shipment', Number(s.step) === 0 && !s.received_at, s);

// staff: seal, hand over, fly, land; staff scanning the bag (twice) never become the carrier
r = await owner('erpShipStep', [{ id: tr, action: 'seal' }]);
check('sealed', r.ok, r);
await owner('erpShipCarrier', [{ id: tr, personId: s.carrier_id, flightNo: 'KE657', departAt: new Date(Date.now() - 12 * 3600e3).toISOString(), landAt: new Date(Date.now() - 3600e3).toISOString() }]);
r = await owner('erpShipStep', [{ id: tr, action: 'hand' }]);
check('handed', r.ok, r);
r = await sales('erpShipFind', [{ q: bagCode }]);
r = await sales('erpShipFind', [{ q: bagCode }]);
check('staff scan twice: still his shipment', r.ok && r.result.code === code, r);
r = await sales('erpShipStep', [{ id: tr, action: 'receive', via: bagCode }]);
check('staff receive', r.ok && r.result.step === 5 && r.result.carrier.code === 'C-0001', r);
r = await sales('erpShipStep', [{ id: tr, action: 'receive', via: bagCode }]);
check('second receive scan refused, carrier unchanged', !r.ok, r);
s = (await sql`select carrier_id from ships where id = ${tr}`)[0];
check('carrier is still the traveller', Number(s.carrier_id) === Number((await sql`select id from ship_people where code = 'C-0001' and business_id = ${B}`)[0].id), s);

// after staff received: back to his own details only
x = await act('me', { k });
check('after received: own details only, thank-you', x.body.active === null && x.body.thanks === true && !/Mehedi|Gate 4|8801847800652/.test(JSON.stringify(x.body)), x.body);

// a new phone: code on WhatsApp, not name + phone
evo.sent.length = 0;
x = await act('code', { j, body: { phone: '+82 10 9999 0000' } });
check('unknown number: same calm answer, nothing sent', x.status === 200 && evo.sent.length === 0, x);
x = await act('code', { j, body: { phone: '010-4410-2291' } });
const sentCode = ((evo.sent[0] || {}).text || '').match(/\d{6}/);
check('code sent on WhatsApp', x.status === 200 && sentCode, evo.sent);
x = await act('verify', { j, body: { phone: '010-4410-2291', code: '000000' } });
check('wrong code refused', x.status === 400 && !x.body.key, x.body);
x = await act('verify', { j, body: { phone: '010-4410-2291', code: sentCode[0] } });
check('right code: the same key', x.status === 200 && x.body.key === k, x.body);
x = await act('verify', { j, body: { phone: '010-4410-2291', code: sentCode[0] } });
check('a code works once', x.status === 400, x.body);

// ship-9: two numbers (Korea, Bangladesh), WhatsApp on one of them, optional emergency contact
x = await act('join', { j, body: { name: 'Karim', phoneKr: '010-7777-8888', phoneBd: '01712-555666', waOn: 'bd', emName: 'Rahima', emRelation: 'mother', emPhone: '01811-222333', waOk: true } });
check('joined with two numbers', x.status === 200 && x.body.key, x.body);
const k2 = x.body.key;
x = await act('me', { k: k2 });
check('both numbers, WhatsApp on the Bangladesh one, emergency contact', x.body.me.phoneKr === '+821077778888' && x.body.me.phoneBd === '+8801712555666' && x.body.me.phone === '+8801712555666' && x.body.me.waOn === 'bd'
  && x.body.me.emName === 'Rahima' && x.body.me.emPhone === '+8801811222333', x.body.me);
x = await act('join', { j, body: { name: 'Copy', phoneKr: '+82 10 7777 8888' } });
check('either of his numbers is already known', x.status === 409 && x.body.exists, x.body);
x = await act('save', { k: k2, body: { phoneKr: '', phoneBd: '' } });
check('cannot remove both numbers', x.status === 400, x.body);
x = await act('save', { k: k2, body: { phoneKr: '010-7777-8888', phoneBd: '01712-555666', waOn: 'kr', emName: '', emRelation: '', emPhone: '' } });
check('WhatsApp moved to the Korean number, emergency cleared', x.status === 200 && x.body.me.phone === '+821077778888' && x.body.me.emName === '', x.body.me);
r = await sales('erpShipFind', [{ q: '01712555666' }]);
check('staff find him by his Bangladesh number', r.ok && r.result.kind === 'person' && r.result.code === 'C-0002', r);
r = await sales('erpShipPerson', [{ id: (await sql`select id from ship_people where phone_bd = '+8801712555666'`)[0].id }]);
check('ERP shows both numbers', r.ok && r.result.phoneKr === '+821077778888' && r.result.phoneBd === '+8801712555666' && r.result.waOn === 'kr', r);
evo.sent.length = 0;
x = await act('code', { j, body: { phone: '01712-555666' } });
check('code asked with the other number goes to his WhatsApp number', x.status === 200 && evo.sent.length === 1 && evo.sent[0].number === '821077778888', evo.sent);

// ship-10: airports, weight, optional e-ticket; return date only remembered; one tap for the way back; history
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 fake ticket').toString('base64');
x = await act('request', { k: k2, body: { direction: 'kr_bd', fromAirport: 'PUS', toAirport: 'CGP', leaveOn: '2027-02-01', returnOn: '2027-03-01', bags: 2, bagKg: 23, flight: 'BS 362', agree: true, ticket: { name: 'eticket.pdf', mime: 'application/pdf', data: PDF } } });
check('trip with airports, kg and ticket', x.status === 200 && x.body.history[0].fromAirport === 'PUS' && x.body.history[0].toAirport === 'CGP' && x.body.history[0].bagKg === 23 && x.body.history[0].ticket === 'eticket.pdf', x.body.history && x.body.history[0]);
check('return date noted, nothing booked for it yet', x.body.returnOffer && x.body.returnOffer.on === '2027-03-01' && x.body.returnOffer.from === 'CGP' && x.body.returnOffer.to === 'PUS' && x.body.history.filter((h) => h.direction === 'bd_kr').length === 0, x.body.returnOffer);
x = await act('request', { k: k2, body: { direction: 'kr_bd', fromAirport: 'DAC', leaveOn: '2027-02-05', bagKg: 80, agree: true } });
check('weight over 50 kg refused', x.status === 400, x.body);
x = await act('return', { k: k2, body: { fromId: x.body ? 0 : 0 } });
check('return for an unknown trip refused', x.status === 400, x.body);
const outId = (await sql`select id from ship_requests where flight = 'BS 362'`)[0].id;
x = await act('return', { k: k2, body: { fromId: outId } });
check('one tap: the way back booked with the noted date', x.status === 200 && x.body.history.some((h) => h.direction === 'bd_kr' && h.leaveOn === '2027-03-01' && h.fromAirport === 'CGP' && h.toAirport === 'PUS' && h.returnOf === outId) && !x.body.returnOffer, x.body.history);
x = await act('return', { k: k2, body: { fromId: outId } });
check('not twice', x.status === 400, x.body);
x = await act('ticket', { k, body: { requestId: outId, ticket: { name: 'x.pdf', mime: 'application/pdf', data: PDF } } });
check('another person cannot add a ticket to his trip', x.status === 404, x.body);
x = await act('ticket', { k: k2, body: { requestId: outId, ticket: { name: 'x.exe', mime: 'application/x-msdownload', data: PDF } } });
check('only PDF or pictures', x.status === 400, x.body);
// staff compare the ticket with what he typed; nothing changes until they apply it
await sql`update ship_requests set ticket_data = ${sql.json({ passenger: 'KARIM', airline: 'US-Bangla', flight: 'BS 361', from_airport: 'PUS', to_airport: 'DAC', depart_date: '2027-02-02', depart_time: '10:30', arrive_date: '2027-02-02', arrive_time: '15:40', return_date: '', booking_ref: 'ABC123', baggage_kg: 30 })} where id = ${outId}`;
r = await sales('erpShipRequests', []);
let rq = r.result.requests.find((q) => q.id === outId);
check('staff see what differs', rq && rq.compare && rq.compare.rows.find((x2) => x2.field === 'যাত্রার তারিখ').same === false && rq.compare.rows.find((x2) => x2.field === 'কোথা থেকে').same === true && rq.compare.passenger === 'KARIM', rq && rq.compare);
check('his own answers untouched before applying', rq.leaveOn === '2027-02-01' && rq.toAirport === 'CGP', rq);
r = await sales('erpShipTicketApply', [{ id: outId }]);
check('sales cannot apply', !r.ok, r);
r = await mgr('erpShipRequestMake', [{ id: outId }]);
const shipFromReq = r.result.id;
r = await mgr('erpShipTicketApply', [{ id: outId }]);
rq = r.result.requests.find((q) => q.id === outId);
check('applied: trip takes the ticket details', r.ok && rq.leaveOn === '2027-02-02' && rq.toAirport === 'DAC' && rq.flight === 'US-Bangla BS 361' && rq.bagKg === 30 && rq.ticketAppliedBy, rq);
const sh = (await sql`select flight_no, depart_at from ships where id = ${shipFromReq}`)[0];
check('and its shipment the flight time', sh.flight_no === 'BS 361' && new Date(sh.depart_at).toISOString() === '2027-02-02T01:30:00.000Z', sh);
x = await act('me', { k: k2 });
check('history: approved trip with its shipment', x.body.history.some((h) => h.id === outId && h.status === 'made' && h.trip && h.trip.code), x.body.history);

// ship-11: who flies on which flight (however the number is typed), and the ticket scan on the form
check('flight numbers match however typed', P.flightKey('CZ 007') === 'CZ7' && P.flightKey('cz0007') === 'CZ7' && P.flightKey('KE657') === 'KE657', [P.flightKey('CZ 007'), P.flightKey('cz0007')]);
x = await act('request', { k, body: { direction: 'kr_bd', fromAirport: 'ICN', toAirport: 'DAC', leaveOn: '2027-04-10', flight: 'CZ 007', bags: 1, agree: true } });
const kRina = (await sql`select portal_token from ship_people where code = 'C-0001' and business_id = ${B}`)[0].portal_token;
x = await act('request', { k: k2, body: { direction: 'kr_bd', fromAirport: 'GMP', toAirport: 'DAC', leaveOn: '2027-04-10', flight: 'cz0007', bags: 2, bagKg: 23, agree: true } });
check('Gimpo accepted', x.status === 200 && x.body.history.some((h) => h.fromAirport === 'GMP'), x.body);
r = await sales('erpShipFlights', []);
const g = r.ok && r.result.flights.find((f) => f.day === '2027-04-10' && f.flight === 'CZ7');
check('two partners on the same flight', g && g.count === 2 && g.bags === 3, r.ok && r.result.flights);
x = await act('scan', { k: k2, body: { ticket: { name: 'a.exe', mime: 'application/x-msdownload', data: PDF } } });
check('scan: only PDF or pictures', x.status === 400, x.body);
x = await act('scan', { k: k2, body: { ticket: { name: 't.pdf', mime: 'application/pdf', data: PDF } } });
check('scan without an AI key: a plain "write it yourself" answer', x.status === 400 && /নিজে লিখুন/.test(x.body.error), x.body);
let ck = P.checkTicket({ passenger: 'MR RAHIM UDDIN', flight: 'cz0007', from_airport: 'icn', to_airport: 'DAC', depart_date: '2027-04-10', depart_time: '25:99', arrive_date: '2027-04-09', return_date: '2027-03-01', baggage_kg: 23 }, 'Rahim Uddin', '2027-01-01');
check('rules: flight tidied, bad time/arrival/return dropped, no warnings', ck.read.flight === 'CZ 7' && ck.read.from_airport === 'ICN' && ck.read.depart_time === '' && ck.read.arrive_date === '' && ck.read.return_date === '' && ck.read.baggage_kg === 23 && ck.checks.length === 0, ck);
ck = P.checkTicket({ passenger: 'KARIM HOSSAIN', flight: 'hello', from_airport: 'NRT', to_airport: 'DAC', depart_date: '2026-02-30' }, 'Rahim Uddin', '2027-01-01');
check('rules: odd things named for the partner', ck.read.flight === '' && ck.read.depart_date === '' && ck.checks.length === 4 && ck.checks.some((c) => /NRT/.test(c)) && ck.checks.some((c) => /মেলেনি/.test(c)), ck);
ck = P.checkTicket({ flight: 'BS 341', from_airport: 'DAC', to_airport: 'CGP', depart_date: '2026-12-01' }, 'X', '2027-01-01');
check('rules: past date and one-country route flagged', ck.read.flight === 'BS 341' && ck.checks.length === 2, ck);

r = await mgr('erpShipGuideSave', [{ carryList: ['মোবাইল ফোন', 'ল্যাপটপ', '', 'ঘড়ি'] }]);
check('staff set the list partners tick from', r.ok && r.result.carryList.join('|') === 'মোবাইল ফোন|ল্যাপটপ|ঘড়ি', r.ok && r.result.carryList);
x = await act('me', { k: k2 });
check('partner page carries the new list', x.body.carryList.length === 3, x.body.carryList);

// messages: 3 days before, with his own page
r = await owner('erpShipPersonSave', [{ name: 'Rina', phone: '010-5555-6666', waOk: true }]);
const p2 = r.result.id;
r = await owner('erpShipNew', [{ type: 'trip', from: 'ICN', to: 'DAC', personId: p2 }]);
await owner('erpShipCarrier', [{ id: r.result.id, personId: p2, flightNo: 'OZ1', departAt: new Date(Date.now() + 60 * 3600e3).toISOString(), landAt: new Date(Date.now() + 66 * 3600e3).toISOString() }]);
r = await sales('erpShipNotes', [{ id: r.result.id }]);
const c3 = r.ok && r.result.notes.find((n) => n.kind === 'c_3d');
check('3 days before: message with his page', c3 && c3.state === 'due' && /c\/\?k=[0-9a-f]{32}/.test(c3.body) && /Mehedi/.test(c3.body), c3 || r);

const other = await sql`select count(*)::int n from ship_requests where business_id <> ${B}`;
check('other business untouched', other[0].n === 0, other);
await done();
