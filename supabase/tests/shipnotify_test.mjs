// ship-4: reminders for the vendor shipment business - bell items, WhatsApp to the traveller and the team, once each.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, web, deps, fnDir } from './harness.mjs';

const N = await import(pathToFileURL(path.join(fnDir, 'handlers', 'shipnotify.js')));
const B = FIX.B;
const EVO = 'https://wa.test';
const evo = { state: 'open', sendCode: 201, sent: [] };
web.on(/^https:\/\/wa\.test\/instance\/connectionState\//, () => ({ status: 200, body: { instance: { state: evo.state } } }));
web.on(/^https:\/\/wa\.test\/message\/sendText\//, (url, opts) => { const b = JSON.parse(opts.body); evo.sent.push(b); return { status: evo.sendCode, body: { key: { id: 'M' + evo.sent.length } } }; });

async function tick(now) {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify({ sub: FIX.U.owner, role: 'authenticated' })}, true)`;
    return N.shipNotifyTick({ tx, sql, s: { name: 'Timer', role: 'owner', businessId: B, businessName: 'Vendor Shipment', userId: FIX.U.owner }, biz: B, now, memo: {}, deps });
  });
}
const H = 3600e3;

let r = await owner('erpShipNotify', []);
check('not cargo: refused', !r.ok && /shipment business/.test(r.error), r);
await sql`insert into business_config (business_id, key, value) values (${B}, 'business_kind', 'cargo') on conflict (business_id, key) do update set value = 'cargo'`;

// a traveller, a shipment with a bag and things, flight in 20 hours
r = await owner('erpShipPersonSave', [{ name: 'Arif', phone: '+82 10-1111-2222', waOk: true }]);
const pid = r.result.id;
r = await owner('erpShipNew', [{ type: 'trip', from: 'ICN', to: 'DAC', personId: pid }]);
const tr = r.result.id, code = r.result.code;
await owner('erpShipBagAdd', [{ id: tr, nickname: 'Blue' }]);
r = await owner('erpShip', [{ id: tr }]);
const bag = r.result.bags[0];
await owner('erpShipItems', [{ id: tr, add: { name: 'Toner', qty: 20, place: 'bag', bagId: bag.id } }]);
await owner('erpShipItems', [{ id: tr, add: { name: 'Phone', qty: 1, place: 'hand' } }]);
await owner('erpShipStep', [{ id: tr, action: 'seal' }]);
const T0 = new Date();
const dep = new Date(T0.getTime() + 20 * H), land = new Date(T0.getTime() + 26 * H);
r = await owner('erpShipCarrier', [{ id: tr, personId: pid, flightNo: 'KE657', departAt: dep.toISOString(), landAt: land.toISOString() }]);
check('flight set', r.ok, r);
await owner('erpShipStep', [{ id: tr, action: 'hand' }]);

// settings
r = await sales('erpShipNotifySave', [{ team: '01712345678' }]);
check('sales cannot change reminder settings', !r.ok, r);
r = await mgr('erpShipNotifySave', [{ team: '01712345678, 12345' }]);
check('bad team number refused', !r.ok && /12345/.test(r.error), r);
r = await mgr('erpShipNotifySave', [{ team: '01712345678', carrier: true }]);
check('team number saved, WhatsApp not linked yet', r.ok && r.result.team === '01712345678' && r.result.carrier === true && r.result.wa.connected === false, r);

// the bell, without WhatsApp
r = await sales('erpShipNotify', []);
check('attention list (sales): flight within a day', r.ok && r.result.bell.some((a) => a.key === 'ship:dep:' + code && a.go === 'ship:' + code), r.ok && r.result.bell);

// plan before WhatsApp: shows what will go, and that nothing can go
r = await sales('erpShipNotes', [{ id: tr }]);
check('shipment shows its messages to come', r.ok && r.result.wa === false && r.result.notes.some((n) => n.kind === 'c_eve' && n.state === 'due' && /২ ঘণ্টা আগে/.test(n.body) && /C-0001/.test(n.body) && /BG-\d{4}/.test(n.body))
  && r.result.notes.some((n) => n.kind === 'c_day' && n.state === 'waiting') && r.result.notes.some((n) => n.kind === 't_eve'), r.ok && r.result.notes.map((n) => [n.kind, n.state]));
r = await mgr('erpShipNotifySend', [{ id: tr, kind: 'c_eve' }]);
check('send by hand without WhatsApp: told to link it', !r.ok && /Connections/.test(r.error), r);
r = await tick(T0);
check('timer without WhatsApp: skipped', r && r.skipped, r);

// link WhatsApp, the timer sends the evening-before messages once
r = await owner('erpEvoSetup', [{ url: EVO, instance: 'alvi', key: 'K' }]);
check('WhatsApp linked', r.ok && r.result.connected === true, r);
r = await tick(T0);
check('timer: traveller + team told', r.sent === 2 && evo.sent.some((m) => m.number === '821011112222' && /KE657/.test(m.text) && /২ ঘণ্টা আগে/.test(m.text))
  && evo.sent.some((m) => m.number === '8801712345678' && /Arif/.test(m.text) && /২১ পিস/.test(m.text)), { r, sent: evo.sent });
r = await tick(new Date(T0.getTime() + 10 * 60e3));
check('not sent twice', r.sent === 0 && evo.sent.length === 2, r);

// day of the flight: 4 hours before
r = await tick(new Date(dep.getTime() - 4 * H));
check('day-of reminder to the traveller', r.sent === 1 && /আজ/.test(evo.sent[2].text) && evo.sent[2].number === '821011112222', { r, last: evo.sent[2] });

// traveller switched off on his profile: nothing more to him
await owner('erpShipPersonSave', [{ id: pid, name: 'Arif', phone: '+82 10-1111-2222', waOk: false }]);
r = await tick(new Date(land.getTime() + 30 * 60e3));
check('landed: team told, traveller (WhatsApp off) not', r.sent === 1 && evo.sent[3].number === '8801712345678' && /নেমেছেন/.test(evo.sent[3].text), { r, last: evo.sent[3] });
await owner('erpShipPersonSave', [{ id: pid, name: 'Arif', phone: '+82 10-1111-2222', waOk: true }]);

// late: landed > 4 h, not received (move the flight into the past so the step follows the clock)
await sql`update ships set depart_at = now() - interval '12 hours', land_at = now() - interval '5 hours' where id = ${tr}`;
r = await tick(new Date());
check('late: team told', evo.sent.some((m) => /রিসিভ হয়নি/.test(m.text)), { r, sent: evo.sent.slice(4) });
r = await mgr('erpAlerts', []);
check('bell: late is red', r.ok && r.result.alerts.some((a) => a.key === 'ship:late:' + code && a.level === 'bad'), r.ok && r.result.alerts);

// a failed send is written and tried again; a manual re-send works
evo.sendCode = 500;
r = await mgr('erpShipNotifySend', [{ id: tr, kind: 't_late' }]);
check('manual send failing: plain error', !r.ok && /did not take it/.test(r.error), r);
evo.sendCode = 201;
r = await mgr('erpShipNotifySend', [{ id: tr, kind: 't_late' }]);
check('manual re-send: written with the sender name', r.ok && r.result.notes.some((n) => n.kind === 't_late' && n.state === 'sent' && n.by), r.ok && r.result.notes);

// received + counted with a difference -> team told once
r = await sales('erpShipStep', [{ id: tr, action: 'receive' }]);
const counts = {}; r.result.items.forEach((i) => { counts[i.id] = i.qty; }); counts[r.result.items[0].id] = 18;
r = await owner('erpShipCheck', [{ id: tr, counts, finish: true }]);
check('counted', r.ok && r.result.step === 6, r);
const before = evo.sent.length;
r = await tick(new Date());
check('count difference: team told', r.sent === 1 && /মিলছে না/.test(evo.sent[before].text) && /২০/.test(evo.sent[before].text) && /১৮/.test(evo.sent[before].text), { r, last: evo.sent[before] });

// log screen
r = await sales('erpShipNotify', []);
check('message log', r.ok && r.result.log.length >= 6 && r.result.log.every((l) => l.code === code) && r.result.canEdit === false, r.ok && r.result.log.length);

// air cargo: arrives tomorrow -> team
r = await owner('erpShipNew', [{ type: 'air', from: 'ICN', to: 'DAC' }]);
const ac = r.result.id;
r = await owner('erpShipAir', [{ id: ac, forwarder: 'Hanjin', awb: '180-1234', cartons: 4, landAt: new Date(Date.now() + 20 * H).toISOString() }]);
check('air cargo details', r.ok, r);
const b2 = evo.sent.length;
r = await tick(new Date());
check('air cargo: team told it arrives', r.sent === 1 && /180-1234/.test(evo.sent[b2].text), { r, last: evo.sent[b2] });

// another business: nothing
r = await tick(new Date());
check('nothing new on the next tick', r.sent === 0, r);
const other = await sql`select count(*)::int n from ship_notes where business_id <> ${B}`;
check('other business untouched', other[0].n === 0, other);

// the words' time format
check('Bangla time', N.bnAt('2026-11-27T10:15:00Z', 'DAC') === '২৭ নভে, বিকাল ৪:১৫' && N.bnAt('2026-11-27T10:15:00Z', 'ICN') === '২৭ নভে, সন্ধ্যা ৭:১৫', [N.bnAt('2026-11-27T10:15:00Z', 'DAC'), N.bnAt('2026-11-27T10:15:00Z', 'ICN')]);

await done();
