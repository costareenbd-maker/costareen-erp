// Brawl: everyone makes their own fighter from a photo; the owner adds others and removes any.
import { owner, mgr, sales, check, done } from './harness.mjs';
const head = { w: 8, h: 8, pal: ['#112233', '#ffeedd'], px: '.'.repeat(8) + '01'.repeat(28) };
const stats = { spd: 7, pow: 4, hp: 5, def: 4 };
let r = await owner('erpFightersSet', [{ fighters: [{ name: 'Rafiq', move: 'whip', color: '#3366cc', head }] }]);
check('owner list saved, old fighter gets an id', r.ok && r.result.fighters[0].id && r.result.max === 60, r);
const rafiq = r.result.fighters[0].id;

r = await sales('erpFighterMine', [{ name: 'Toofan Mia', move: 'dash', color: '#22c55e', head, stats }]);
check('sales makes own fighter', r.ok && r.result.fighters.length === 2 && r.result.fighters[1].mine && r.result.fighters[1].stats.spd === 7, r);
check('who made it is not sent to the page', r.ok && !('by' in r.result.fighters[1]), r);
const mine = r.result.id;
r = await sales('erpFighterMine', [{ name: 'Toofan Mia 2', move: 'laser', color: '#22c55e', head, stats }]);
check('a new photo replaces the old one (one per person)', r.ok && r.result.fighters.length === 2 && r.result.id === mine && r.result.fighters[1].move === 'laser', r);
r = await owner('erpFighters', []);
check('the owner does not see it as his', r.ok && r.result.fighters.every((f) => !f.mine), r);
r = await mgr('erpFighters', []);
check('others see it, not as theirs', r.ok && r.result.fighters.length === 2 && !r.result.fighters[1].mine, r);

r = await sales('erpFighterMine', [{ name: 'Strong', move: 'dash', color: '#22c55e', head, stats: { spd: 9, pow: 9, hp: 9, def: 9 } }]);
check('abilities must add up to 20', !r.ok, r);
r = await sales('erpFighterMine', [{ name: 'Strong', move: 'dash', color: '#22c55e', head, stats: { spd: 10, pow: 6, hp: 2, def: 2 } }]);
check('each ability 1-9', !r.ok, r);
r = await sales('erpFighterMine', [{ name: 'Strong', move: 'dash', color: '#22c55e', head }]);
check('abilities needed', !r.ok, r);
r = await sales('erpFighterMine', [{ name: 'rafiq', move: 'dash', color: '#22c55e', head, stats }]);
check('same name as another refused', !r.ok, r);
r = await sales('erpFighterMine', [{ name: 'Guest', move: 'dash', color: '#22c55e', head, stats, other: true }]);
check('only the owner adds someone else', !r.ok, r);
r = await sales('erpFighterRemove', [{ id: rafiq }]);
check('sales cannot remove another fighter', !r.ok, r);

r = await owner('erpFighterMine', [{ name: 'Guest', move: 'slam', color: '#ef4444', head, stats, other: true }]);
check('owner adds someone else', r.ok && r.result.fighters.length === 3 && !r.result.fighters[2].mine, r);
r = await owner('erpFighterMine', [{ name: 'Guest 2', move: 'slam', color: '#ef4444', head, stats, other: true }]);
check('...and another (no one-per-person limit for those)', r.ok && r.result.fighters.length === 4, r);

// the owner's whole-list save keeps who made each one
r = await owner('erpFighters', []);
r = await owner('erpFightersSet', [{ fighters: r.result.fighters }]);
check('whole-list save ok', r.ok && r.result.fighters.length === 4, r);
r = await sales('erpFighters', []);
check('...and the maker is kept', r.ok && r.result.fighters.find((f) => f.id === mine).mine, r);

r = await sales('erpFighterRemove', [{ id: mine }]);
check('sales removes own fighter', r.ok && r.result.fighters.length === 3 && !r.result.fighters.some((f) => f.id === mine), r);
r = await owner('erpFighterRemove', [{ id: rafiq }]);
check('owner removes any', r.ok && r.result.fighters.length === 2, r);
r = await owner('erpFighterRemove', [{ id: rafiq }]);
check('gone already: plain message', !r.ok && /not in the game/.test(r.error || ''), r);
await done();
