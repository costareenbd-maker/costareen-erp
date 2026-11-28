// ship-7: the team who meets travellers (photo, name, phone dialable from any country).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir } from './harness.mjs';

const ST = await import(pathToFileURL(path.join(fnDir, 'handlers', 'shipteam.js')));
const B = FIX.B;
deps.google = Object.assign({}, deps.google || {}, { appUrl: 'https://erp.example.com/#/dash' });
const PH = 'data:image/jpeg;base64,' + 'Q'.repeat(60);

let r = await owner('erpShipTeam', []);
check('not cargo: refused', !r.ok && /shipment business/.test(r.error), r);
await sql`insert into business_config (business_id, key, value) values (${B}, 'business_kind', 'cargo') on conflict (business_id, key) do update set value = 'cargo'`;

// phones become dialable from abroad
check('BD 01x -> +880', ST.e164('01847-800652') === '+8801847800652', ST.e164('01847-800652'));
check('KR 010 -> +82', ST.e164('010-4410-2291') === '+821044102291', ST.e164('010-4410-2291'));
check('+ kept', ST.e164('+82 10 1234 5678') === '+821012345678' && ST.e164('00880 1712 000111') === '+8801712000111', [ST.e164('+82 10 1234 5678'), ST.e164('00880 1712 000111')]);
check('unknown local number refused', ST.e164('12345') === '' && ST.e164('0201234567') === '', [ST.e164('12345'), ST.e164('0201234567')]);

r = await sales('erpShipTeamSave', [{ name: 'Mehedi', phone: '01847800652' }]);
check('sales cannot add team members', !r.ok, r);
r = await mgr('erpShipTeamSave', [{ name: '', phone: '01847800652' }]);
check('name needed', !r.ok && /name/.test(r.error), r);
r = await mgr('erpShipTeamSave', [{ name: 'Mehedi', phone: '12' }]);
check('phone needed', !r.ok && /country code/.test(r.error), r);
r = await mgr('erpShipTeamSave', [{ name: 'Mehedi', phone: '01847-800652', role: 'Dhaka airport', port: 'DAC', photo: PH }]);
check('Mehedi added, phone stored with +880', r.ok && r.result.team.length === 1 && r.result.team[0].phone === '+8801847800652' && r.result.team[0].photo === PH, r);
r = await mgr('erpShipTeamSave', [{ name: 'Seoul helper', phone: '010-1234-5678', port: 'ICN' }]);
r = await mgr('erpShipTeamSave', [{ name: 'Old staff', phone: '01700000000', port: 'DAC', active: false }]);
check('three, one off', r.ok && r.result.team.length === 3 && r.result.team.find((m) => m.name === 'Old staff').active === false, r);
r = await sales('erpShipTeam', []);
check('sales sees the team, cannot edit', r.ok && r.result.team.length === 3 && r.result.canEdit === false, r);

// the shipment's button gives the traveller's own page
r = await owner('erpShipPersonSave', [{ name: 'Arif', phone: '010-1111-2222', waOk: true }]);
check('traveller phone stored with +82', r.ok && r.result.phone === '+821011112222', r);
const pid = r.result.id;
r = await owner('erpShipNew', [{ type: 'trip', from: 'ICN', to: 'DAC' }]);
const tr = r.result.id;
r = await sales('erpShipShare', [{ id: tr }]);
check('no traveller yet: no link', !r.ok && /traveller first/.test(r.error), r);
await owner('erpShipCarrier', [{ id: tr, personId: pid }]);
r = await sales('erpShipShare', [{ id: tr }]);
check('his own page link', r.ok && /^[0-9a-f]{32}$/.test(r.result.token) && r.result.url === 'https://erp.example.com/c/?k=' + r.result.token, r);
const other = await sql`select count(*)::int n from ship_team where business_id <> ${B}`;
check('other business untouched', other[0].n === 0, other);
await done();
