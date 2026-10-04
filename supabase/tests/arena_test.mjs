// Online Brawl (multi-1): a private room per business, results written by a player only, once per match.
import { owner, mgr, sales, check, done } from './harness.mjs';

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
await done();
