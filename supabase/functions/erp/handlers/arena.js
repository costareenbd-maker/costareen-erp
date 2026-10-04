// Online Brawl (multi-1): people of one business challenge each other.
//
//   erpArena()               -> {room, me: {id, name}, board: [{id, name, wins, losses}], recent: [...]}
//     room: this business's private Realtime channel name (made once, kept in business_config);
//     only members are given it.
//   erpArenaResult({mid, winner, loser, winnerName, loserName, score})
//     the challenger's browser runs the fight and writes the result once; the caller must be one
//     of the two players. The same match id twice is ignored.

import { getConfig, setConfig } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function board(ctx) {
  const rows = await ctx.tx`select winner, loser, winner_name, loser_name, score, created_at
                            from arena_matches where business_id = ${ctx.biz} order by created_at desc limit 500`;
  const by = {};
  const add = (id, name, won) => { const b = by[id] || (by[id] = { id, name, wins: 0, losses: 0 }); if (name) b.name = name; if (won) b.wins++; else b.losses++; };
  for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; add(r.winner, r.winner_name, true); add(r.loser, r.loser_name, false); }
  const list = Object.values(by).sort((a, b) => b.wins - a.wins || a.losses - b.losses).slice(0, 10);
  const recent = rows.slice(0, 5).map((r) => ({ winner: r.winner_name, loser: r.loser_name, score: r.score }));
  return { board: list, recent };
}

export async function erpArena(ctx) {
  let room = str(await getConfig(ctx, 'arena_room', ''));
  if (!/^[a-z0-9-]{20,}$/.test(room)) { room = 'arena-' + crypto.randomUUID(); await setConfig(ctx, 'arena_room', room); }
  return { room, me: { id: ctx.s.userId, name: str(ctx.s.name) || 'Player' }, ...(await board(ctx)) };
}

export async function erpArenaResult(ctx, payload) {
  payload = payload || {};
  const mid = str(payload.mid).slice(0, 80), w = str(payload.winner), l = str(payload.loser);
  if (!mid || !UUID.test(w) || !UUID.test(l) || w === l) throw new Error('That match result is not complete.');
  if (ctx.s.userId !== w && ctx.s.userId !== l) throw new Error('Only a player of that match can write its result.');
  await ctx.tx`insert into arena_matches (business_id, mid, winner, loser, winner_name, loser_name, score)
               values (${ctx.biz}, ${mid}, ${w}, ${l}, ${str(payload.winnerName).slice(0, 60)}, ${str(payload.loserName).slice(0, 60)}, ${str(payload.score).slice(0, 12)})
               on conflict (business_id, mid) do nothing`;
  return board(ctx);
}

export const HANDLERS = { erpArena, erpArenaResult };
