// Online Brawl (multi-1): a private room per business, results written by a player only, once per match.
import { owner, mgr, sales, call, FIX, check, done } from './harness.mjs';
const other = (name, args) => call(name, args, { authHeader: 'Bearer owner:' + FIX.U.other });   // owner of another business (B2)

let a = await owner('erpArena', []);
check('the owner gets a room and his own id', a.ok && /^arena-[0-9a-f-]{36}$/.test(a.result.room) && a.result.me.id, a);
const room = a.ok ? a.result.room : '', me = a.ok ? a.result.me.id : '';
let b = await mgr('erpArena', []);
check('a manager of the same business gets the same room', b.ok && b.result.room === room, b);
let c = await sales('erpArena', []);
check('sales staff can play too', c.ok && c.result.room === room, c);
const mgrId = b.ok ? b.result.me.id : '', salesId = c.ok ? c.result.me.id : '';

let r = await owner('erpArenaResult', [{ mid: 'm1', winner: me, loser: mgrId, winnerName: 'Owner', loserName: 'Manager', score: '2-1' }]);
check('a player writes the result', r.ok && r.result.board.length === 2 && r.result.board[0].id === me && r.result.board[0].wins === 1, r);
r = await mgr('erpArenaResult', [{ mid: 'm1', winner: mgrId, loser: me, winnerName: 'Manager', loserName: 'Owner', score: '2-0' }]);
check('the same match twice is ignored', r.ok && r.result.board[0].id === me && r.result.board[0].wins === 1 && r.result.board.find((x) => x.id === mgrId).wins === 0, r);
r = await sales('erpArenaResult', [{ mid: 'm2', winner: me, loser: mgrId, score: '2-0' }]);
check('someone who did not play cannot write a result', !r.ok && /Only a player/.test(r.error), r);
r = await owner('erpArenaResult', [{ mid: 'm3', winner: me, loser: me }]);
check('a match against oneself is refused', !r.ok, r);
a = await sales('erpArena', []);
check('the board shows wins and losses to everyone', a.ok && a.result.recent.length === 1 && a.result.recent[0].score === '2-1' && salesId, a);

// ---- multi-3: owners of other companies
a = await owner('erpArena', []);
check('the world arena is off until an owner switches it on', a.ok && a.result.world === null && a.result.worldOn === false && a.result.canWorld === true, a);
r = await mgr('erpArenaWorldSet', [{ on: true }]);
check('a manager cannot switch it', !r.ok, r);
r = await owner('erpArenaWorldSet', [{ on: true }]);
check('the owner switches it on and gets the world room', r.ok && /^arena-world-/.test(r.result.world.room) && r.result.world.company, r);
const world = r.ok ? r.result.world.room : '';
b = await mgr('erpArena', []);
check('staff never get the world room', b.ok && b.result.world === null && b.result.canWorld === false, b);
let o = await other('erpArena', []);
check('another company stays out until its own owner switches it on', o.ok && o.result.world === null && o.result.room !== room, o);
o = await other('erpArenaWorldSet', [{ on: true }]);
check('its owner switches it on: the same world room, its own company room', o.ok && o.result.world.room === world && o.result.room !== room, o);
const otherId = FIX.U.other;
r = await owner('erpArenaResult', [{ mid: 'w1', world: true, winner: me, loser: otherId, winnerName: 'Owner', loserName: 'Other', loserCo: 'Elsewhere', score: '2-1' }]);
check('a world result is kept with both companies', r.ok && r.result.board[0].id === me && r.result.recent[0].loserCo === 'Elsewhere' && r.result.recent[0].winnerCo, r);
a = await owner('erpArena', []);
check('a world match does not touch the company leaderboard', a.ok && a.result.recent.length === 1 && a.result.world.recent.length === 1, a);
r = await mgr('erpArenaResult', [{ mid: 'w2', world: true, winner: mgrId, loser: otherId }]);
check('staff cannot write world results', !r.ok, r);
r = await owner('erpArenaWorldSet', [{ on: false }]);
check('switched off again: no world room', r.ok && r.result.world === null, r);
await done();
