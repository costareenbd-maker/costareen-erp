// taste-1 (9 Nov 2026, owner): "When I don't like a photo and say why, the model must remember what its owner likes;
// and there must be a place to reset it and set a new formula. Same for videos."
//
// Per business and kind (photo | video): the owner's own FORMULA (free text he writes, the standing rules) and NOTES
// (each "not like this" / "like this" with his reason, newest first, at most 40). Every picture prompt (ChatGPT and
// Gemini), the daily ad, the weekly ad factory and the video script writer read tasteText() - so the next picture or
// video follows them. Reset clears the notes and puts a new formula (or none).
//
//   erpTaste({kind})                              the formula and the notes (manager)
//   erpTasteNote({kind, verdict, why, assetId})   owner / shareholder; verdict no | yes; "no" on an asset also hides it
//   erpTasteSet({kind, formula})                  owner / shareholder: write the formula
//   erpTasteReset({kind, formula})                owner / shareholder: forget the notes, start from this formula
//   erpTasteForget({kind, at})                    owner / shareholder: drop one note
//   tasteText(ctx, kind)                          what the AI is told (empty when nothing is set)

import { roleAtLeast } from '../allow.js';
import { formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const KINDS = { photo: 'pictures', video: 'videos' };
const kindOf = (k) => (KINDS[str(k)] ? str(k) : 'photo');
function need(ctx, role) { if (!roleAtLeast(ctx.s.role, role || 'manager')) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).'); }

async function load(ctx, kind) {
  let t = {}; try { t = JSON.parse(str(await getConfig(ctx, 'taste_' + kind, '')) || '{}') || {}; } catch (_) { t = {}; }
  return { formula: str(t.formula), notes: Array.isArray(t.notes) ? t.notes : [], resetAt: str(t.resetAt) };
}
async function save(ctx, kind, t) { await setConfig(ctx, 'taste_' + kind, JSON.stringify(t)); }
const view = (kind, t) => ({ kind, formula: t.formula, resetAt: t.resetAt, notes: t.notes.map((n) => ({ ...n, when: n.at ? formatDate(new Date(n.at), 'd MMM') : '' })) });

/** What every picture / video prompt gets: the formula, then what he rejected and liked (newest first). */
export async function tasteText(ctx, kind) {
  let t; try { t = await load(ctx, kindOf(kind)); } catch (_) { return ''; }
  const no = t.notes.filter((n) => n.verdict === 'no').slice(0, 12).map((n) => '- ' + n.why + (n.what ? ' (on "' + n.what + '")' : ''));
  const yes = t.notes.filter((n) => n.verdict === 'yes').slice(0, 8).map((n) => '- ' + n.why + (n.what ? ' (on "' + n.what + '")' : ''));
  if (!t.formula && !no.length && !yes.length) return '';
  return ['THE OWNER\'S TASTE FOR ' + KINDS[kindOf(kind)].toUpperCase() + ' - follow it before anything else:',
    t.formula ? 'His formula: ' + t.formula : '',
    no.length ? 'He did NOT like (never do these again):\n' + no.join('\n') : '',
    yes.length ? 'He liked (do more of this):\n' + yes.join('\n') : ''].filter(Boolean).join('\n').slice(0, 2500);
}

export async function erpTaste(ctx, payload) {
  need(ctx);
  const kind = kindOf(payload && payload.kind);
  return view(kind, await load(ctx, kind));
}
export async function erpTasteNote(ctx, payload) {
  need(ctx, 'shareholder');
  const p = payload || {}, kind = kindOf(p.kind), verdict = str(p.verdict) === 'yes' ? 'yes' : 'no', why = str(p.why).slice(0, 300);
  if (why.length < 3) throw new Error(verdict === 'no' ? 'Say in a few words why you do not like it, so the AI learns.' : 'Say in a few words what you like about it.');
  let what = '';
  if (str(p.assetId)) {
    const a = (await ctx.tx`select id, title from social_assets where business_id = ${ctx.biz} and id = ${str(p.assetId)}`)[0];
    if (!a) throw new Error('That picture or video was not found.');
    what = str(a.title).slice(0, 80);
    await ctx.tx`update social_assets set meta = coalesce(meta, '{}'::jsonb) || ${ctx.tx.json({ verdict, verdictWhy: why })}, status = case when ${verdict} = 'no' then 'removed' else status end, updated_at = now() where id = ${a.id}`;
  }
  const t = await load(ctx, kind);
  t.notes = [{ verdict, why, what, by: str(ctx.s && ctx.s.name), at: ctx.now.toISOString() }, ...t.notes].slice(0, 40);
  await save(ctx, kind, t);
  return view(kind, t);
}
export async function erpTasteSet(ctx, payload) {
  need(ctx, 'shareholder');
  const p = payload || {}, kind = kindOf(p.kind), t = await load(ctx, kind);
  t.formula = str(p.formula).slice(0, 1500);
  await save(ctx, kind, t);
  return view(kind, t);
}
export async function erpTasteReset(ctx, payload) {
  need(ctx, 'shareholder');
  const p = payload || {}, kind = kindOf(p.kind);
  const t = { formula: str(p.formula).slice(0, 1500), notes: [], resetAt: ctx.now.toISOString() };
  await save(ctx, kind, t);
  return view(kind, t);
}
export async function erpTasteForget(ctx, payload) {
  need(ctx, 'shareholder');
  const p = payload || {}, kind = kindOf(p.kind), t = await load(ctx, kind);
  const n = t.notes.length;
  t.notes = t.notes.filter((x) => x.at !== str(p.at));
  if (t.notes.length === n) throw new Error('That note was not found.');
  await save(ctx, kind, t);
  return view(kind, t);
}

export const HANDLERS = { erpTaste, erpTasteNote, erpTasteSet, erpTasteReset, erpTasteForget };
