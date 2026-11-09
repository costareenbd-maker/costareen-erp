// Game under New invoice: the owner decides who sees it (default: only the owner).
import { owner, mgr, sales, check, done } from './harness.mjs';
let r = await owner('erpGame', []);
// crit2-ui (10 Nov 2026): the owner MAY turn games on, but they are off until he does it for himself
check('default: the owner may, but it is off', r.ok && r.result.who === 'owner' && r.result.allowed && !r.result.on, r);
r = await owner('erpGameMine', [{ on: true }]);
check('...on once he turns it on for himself', r.ok && r.result.on, r);
r = await sales('erpGame', []);
check('default: staff do not', r.ok && !r.result.on, r);
r = await mgr('erpGameSet', [{ who: 'all' }]);
check('only the owner changes it', !r.ok, r);
r = await owner('erpGameSet', [{ who: 'all' }]);
check('everyone', r.ok && r.result.who === 'all', r);
r = await sales('erpGame', []);
check('...staff may now, still off until they choose', r.ok && r.result.allowed && !r.result.on, r);
r = await sales('erpGameMine', [{ on: true }]);
check('...staff see it once they turn it on', r.ok && r.result.on, r);
r = await owner('erpGameSet', [{ who: 'none' }]);
r = await owner('erpGame', []);
check('nobody, not even the owner', r.ok && !r.result.on, r);
r = await owner('erpGameSet', [{ who: 'boss' }]);
check('nonsense refused', !r.ok, r);
// fighters for the fighting game
const head = { w: 8, h: 8, pal: ['#112233', '#ffeedd'], px: '.'.repeat(8) + '01'.repeat(28) };
r = await owner('erpFighters', []);
check('no fighters at first', r.ok && r.result.fighters.length === 0, r);
r = await owner('erpFightersSet', [{ fighters: [{ name: 'Rafiq', move: 'whip', color: '#3366CC', head }] }]);
check('owner saves a fighter', r.ok && r.result.fighters[0].color === '#3366cc', r);
r = await sales('erpFighters', []);
check('staff can read them (to play)', r.ok && r.result.fighters.length === 1 && r.result.fighters[0].head.px.length === 64, r);
r = await mgr('erpFightersSet', [{ fighters: [] }]);
check('only the owner changes them', !r.ok, r);
r = await owner('erpFightersSet', [{ fighters: [{ name: 'X', move: 'fireball', color: '#000000', head }] }]);
check('unknown move refused', !r.ok, r);
r = await owner('erpFightersSet', [{ fighters: [{ name: 'X', move: 'whip', color: '#000000', head: { ...head, px: 'zz' + head.px.slice(2) } }] }]);
check('bad picture refused', !r.ok, r);
await done();
