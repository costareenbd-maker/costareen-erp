// Online Brawl: people of one business challenge each other (multi-1); owners of different
// businesses meet in a world room when their business switched it on (multi-3).
//
//   erpArena()               -> {room, me: {id, name}, board, recent, world: null | {room, company, board, recent}, worldOn, canWorld}
//     room: this business's private Realtime channel name (made once, kept in business_config);
//     world: only for owners of a business with arena_world = 1.
//   erpArenaWorldSet({on})   owner: let owners of other companies challenge ours.
//   erpArenaResult({mid, winner, loser, winnerName, loserName, score, world, winnerCo, loserCo})
//     the challenger's browser runs the fight and writes the result once; the caller must be one
//     of the two players. The same match id twice is ignored.

import { getConfig, setConfig } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tally(rows, co) {
  const by = {};
  const add = (id, name, c, won) => { const b = by[id] || (by[id] = { id, name, wins: 0, losses: 0 }); if (name) b.name = name; if (c) b.company = c; if (won) b.wins++; else b.losses++; };
  for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; add(r.winner, r.winner_name, co ? r.winner_co : '', true); add(r.loser, r.loser_name, co ? r.loser_co : '', false); }
  const board = Object.values(by).sort((a, b) => b.wins - a.wins || a.losses - b.losses).slice(0, 10);
  const recent = rows.slice(0, 5).map((r) => ({ winner: r.winner_name, loser: r.loser_name, score: r.score, winnerCo: co ? r.winner_co : undefined, loserCo: co ? r.loser_co : undefined }));
  return { board, recent };
}
async function board(ctx) {
  const rows = await ctx.tx`select winner, loser, winner_name, loser_name, score, created_at
                            from arena_matches where business_id = ${ctx.biz} order by created_at desc limit 500`;
  return tally(rows, false);
}
async function worldBoard(ctx) {
  const rows = await ctx.sql`select winner, loser, winner_name, loser_name, winner_co, loser_co, score from arena_world order by created_at desc limit 500`;
  return tally(rows, true);
}
async function worldRoom(ctx) {
  const r = await ctx.sql`select v from arena_settings where k = 'world_room'`;
  if (r[0] && /^[a-z0-9-]{20,}$/.test(r[0].v)) return r[0].v;
  const room = 'arena-world-' + crypto.randomUUID();
  await ctx.sql`insert into arena_settings (k, v) values ('world_room', ${room}) on conflict (k) do nothing`;
  return (await ctx.sql`select v from arena_settings where k = 'world_room'`)[0].v;
}
const isOwner = (ctx) => ctx.s.role === 'owner';

export async function erpArena(ctx) {
  let room = str(await getConfig(ctx, 'arena_room', ''));
  if (!/^[a-z0-9-]{20,}$/.test(room)) { room = 'arena-' + crypto.randomUUID(); await setConfig(ctx, 'arena_room', room); }
  const worldOn = str(await getConfig(ctx, 'arena_world', '')) === '1';
  let world = null;
  if (worldOn && isOwner(ctx)) world = { room: await worldRoom(ctx), company: str(ctx.s.businessName) || 'Company', ...(await worldBoard(ctx)) };
  return { room, me: { id: ctx.s.userId, name: str(ctx.s.name) || 'Player' }, ...(await board(ctx)), world, worldOn, canWorld: isOwner(ctx) };
}

export async function erpArenaWorldSet(ctx, payload) {
  if (!isOwner(ctx)) throw new Error('Only an owner decides that.');
  await setConfig(ctx, 'arena_world', payload && payload.on ? '1' : '0');
  return erpArena(ctx);
}

export async function erpArenaResult(ctx, payload) {
  payload = payload || {};
  const mid = str(payload.mid).slice(0, 80), w = str(payload.winner), l = str(payload.loser);
  if (!mid || !UUID.test(w) || !UUID.test(l) || w === l) throw new Error('That match result is not complete.');
  if (ctx.s.userId !== w && ctx.s.userId !== l) throw new Error('Only a player of that match can write its result.');
  if (payload.world) {
    if (!isOwner(ctx) || str(await getConfig(ctx, 'arena_world', '')) !== '1') throw new Error('The arena with other companies is not on for your company.');
    const mine = str(ctx.s.businessName), iWon = ctx.s.userId === w;
    await ctx.sql`insert into arena_world (mid, winner, loser, winner_name, loser_name, winner_co, loser_co, score)
                  values (${mid}, ${w}, ${l}, ${str(payload.winnerName).slice(0, 60)}, ${str(payload.loserName).slice(0, 60)},
                          ${iWon ? mine : str(payload.winnerCo).slice(0, 60)}, ${iWon ? str(payload.loserCo).slice(0, 60) : mine}, ${str(payload.score).slice(0, 12)})
                  on conflict (mid) do nothing`;
    return worldBoard(ctx);
  }
  await ctx.tx`insert into arena_matches (business_id, mid, winner, loser, winner_name, loser_name, score)
               values (${ctx.biz}, ${mid}, ${w}, ${l}, ${str(payload.winnerName).slice(0, 60)}, ${str(payload.loserName).slice(0, 60)}, ${str(payload.score).slice(0, 12)})
               on conflict (business_id, mid) do nothing`;
  return board(ctx);
}

export const HANDLERS = { erpArena, erpArenaWorldSet, erpArenaResult };
