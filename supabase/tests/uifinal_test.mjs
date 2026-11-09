// crit2-ui (10 Nov 2026): games are OFF by default for every person (the owner too); each person turns them on for
// themselves (erpGameMine, kept in erp_prefs.games); the business setting game_who only says who MAY.
import { owner, mgr, sales, check, done, sql, FIX } from './harness.mjs';

let r = await owner('erpGame', []);
check('owner: allowed by default but OFF', r.ok && r.result.allowed === true && r.result.mine === false && r.result.on === false, r);
r = await sales('erpGame', []);
check('sales: not allowed, off', r.ok && r.result.allowed === false && r.result.on === false, r);

r = await sales('erpGameMine', [{ on: true }]);
check('sales cannot turn games on while only the owner may', !r.ok && /owner/i.test(r.error || ''), r);
r = await owner('erpGameMine', [{ on: 'yes' }]);
check('a non-boolean is refused plainly', !r.ok && /on or off/i.test(r.error || ''), r);

r = await owner('erpGameMine', [{ on: true }]);
check('owner turns games on for himself', r.ok && r.result.on === true && r.result.mine === true, r);
r = await mgr('erpGame', []);
check('...the manager still has them off', r.ok && r.result.on === false, r);

r = await owner('erpGameSet', [{ who: 'all' }]);
r = await mgr('erpGame', []);
check('business allows everyone: the manager is allowed but still OFF (no forcing on)', r.ok && r.result.allowed && !r.result.on, r);
r = await mgr('erpGameMine', [{ on: true }]);
check('manager turns them on for himself', r.ok && r.result.on, r);
r = await sales('erpGame', []);
check('...sales still off', r.ok && !r.result.on, r);

r = await owner('erpGameSet', [{ who: 'none' }]);
r = await owner('erpGame', []);
check('nobody: off for the owner even though he chose on', r.ok && !r.result.on && r.result.mine === true, r);
r = await mgr('erpGameMine', [{ on: true }]);
check('nobody: turning on is refused', !r.ok, r);
r = await mgr('erpGameMine', [{ on: false }]);
check('turning off is always allowed', r.ok && r.result.mine === false, r);

const row = await sql`select games from erp_prefs where user_id = ${FIX.U.owner}`;
check('the choice is kept per person in erp_prefs', row.length === 1 && row[0].games === true, row);
await done();
