// Owner safety (Settings > Security > Recovery, Settings > Users).
//
//   erpRecovery()                    the four things that keep an owner from ever being locked out, and which are done
//   erpEmergencyLink()               owner: a fresh emergency access link (shown once; the earlier one stops)
//   ownerChangeStart(ctx, m, role, active)   called by erpUserSet when an owner would lose access: nothing changes yet;
//                                    both owners get a link in their own e-mail
//   erpOwnerChange({token})          what a link is about (read by the owner who opened it)
//   erpOwnerChangeAnswer({token, agree})     yes / no; when both said yes the change is made
//   erpOwnerChanges()                waiting changes in this business (Users screen); erpOwnerChangeCancel({id}) by its maker
//
// The e-mail is a one-time sign-in link from the login system itself: opening it signs that owner in
// and proves they hold that mailbox. Nobody can agree for someone else.

import { getSecret } from '../lib/ext.js';
import { keyHash, newKey } from './access.js';
import { formatDate } from '../lib/time.js';

const str = (v) => String(v == null ? '' : v).trim();
const appUrl = (ctx) => String((ctx.deps && ctx.deps.google && ctx.deps.google.appUrl) || 'https://erp.costareen.com/').replace(/#.*$/, '');
function needOwner(ctx) { if (ctx.s.role !== 'owner') throw new Error('Only an owner can do that.'); }
async function sha(t) { return keyHash(t); }

export async function erpRecovery(ctx) {
  const owners = await ctx.sql`select u.email from memberships m join auth.users u on u.id = m.user_id
                               where m.business_id = ${ctx.biz} and m.role = 'owner' and m.active and u.email is not null and u.email not like '%.invalid'`;
  let mfa = false;
  try { mfa = (await ctx.sql`select 1 from auth.mfa_factors where user_id = ${ctx.s.userId} and status = 'verified' limit 1`).length > 0; } catch (_) { mfa = false; }
  const em = (await ctx.sql`select created_at from erp_access_keys where user_id = ${ctx.s.userId} and label like 'Emergency%' and revoked_at is null order by created_at desc limit 1`)[0];
  const drive = !!(await getSecret(ctx, 'GOOGLE_REFRESH'));
  return {
    secondOwner: owners.length >= 2, owners: owners.length, mfa, emergency: !!em, emergencyMade: em ? formatDate(new Date(em.created_at), 'd MMM yyyy') : '', drive,
    done: [owners.length >= 2, mfa, !!em, drive].filter(Boolean).length,
  };
}

export async function erpEmergencyLink(ctx) {
  needOwner(ctx);
  await ctx.sql`update erp_access_keys set revoked_at = now() where user_id = ${ctx.s.userId} and label like 'Emergency%' and revoked_at is null`;
  const key = newKey();
  await ctx.sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(key)}, ${ctx.s.userId}, 'Emergency (keep offline)')`;
  return { link: appUrl(ctx) + '#k=' + key };
}

/** An owner would lose access: start the two-owner agreement instead of changing anything. */
export async function ownerChangeStart(ctx, m, role, active) {
  const target = m.user_id;
  const waiting = (await ctx.sql`select id from erp_owner_changes where business_id = ${ctx.biz} and target_user = ${target} and status = 'waiting' and expires_at > now()`)[0];
  if (waiting) throw new Error('A change for this owner is already waiting for both owners to agree.');
  const mails = await ctx.sql`select id, email from auth.users where id = any(${[ctx.s.userId, target]}::uuid[])`;
  const mailOf = Object.fromEntries(mails.map((u) => [u.id, str(u.email)]));
  for (const u of [ctx.s.userId, target]) if (!/@/.test(mailOf[u] || '') || /\.invalid$/.test(mailOf[u])) throw new Error('Both owners need an e-mail login for this.');
  const id = (await ctx.sql`insert into erp_owner_changes (business_id, target_user, new_role, switch_off, requested_by)
                            values (${ctx.biz}, ${target}, ${role === 'owner' ? null : role}, ${!active}, ${ctx.s.userId}) returning id`)[0].id;
  try {
    for (const u of [ctx.s.userId, target]) {
      const token = newKey();
      await ctx.sql`insert into erp_owner_votes (change_id, user_id, token_hash) values (${id}, ${u}, ${await sha(token)})`;
      await ctx.deps.sendMagic(mailOf[u], appUrl(ctx) + '?approve=' + encodeURIComponent(token));
    }
  } catch (e) {
    await ctx.sql`delete from erp_owner_changes where id = ${id}`;
    throw new Error('The e-mails could not be sent, so nothing was started: ' + str(e && e.message).slice(0, 160));
  }
  return { pending: true, id, emails: [mailOf[ctx.s.userId], mailOf[target]] };
}

async function voteOf(ctx, token) {
  const v = (await ctx.sql`select v.*, c.business_id, c.target_user, c.new_role, c.switch_off, c.requested_by, c.status, c.expires_at
                           from erp_owner_votes v join erp_owner_changes c on c.id = v.change_id where v.token_hash = ${await sha(str(token))}`)[0];
  if (!v) throw new Error('That link is not known.');
  if (v.user_id !== ctx.s.userId) throw new Error('That link belongs to another owner. Open it from your own e-mail.');
  return v;
}
async function describe(ctx, v) {
  const names = Object.fromEntries((await ctx.sql`select u.id, coalesce(p.full_name, u.email) as n, u.email from auth.users u left join profiles p on p.id = u.id
                                                   where u.id = any(${[v.target_user, v.requested_by]}::uuid[])`).map((r) => [r.id, str(r.n) + ' (' + str(r.email) + ')']));
  const biz = str((await ctx.sql`select name from businesses where id = ${v.business_id}`)[0]?.name);
  const votes = await ctx.sql`select user_id, answer from erp_owner_votes where change_id = ${v.change_id}`;
  return { business: biz, target: names[v.target_user] || '?', by: names[v.requested_by] || '?',
           what: v.switch_off ? 'switch off' : 'change to ' + str(v.new_role), status: new Date(v.expires_at) < new Date() && v.status === 'waiting' ? 'expired' : v.status,
           mine: v.answer || '', agreed: votes.filter((x) => x.answer === 'yes').length, of: votes.length, youAreTarget: v.target_user === ctx.s.userId };
}
export async function erpOwnerChange(ctx, payload) { return describe(ctx, await voteOf(ctx, payload && payload.token)); }

export async function erpOwnerChangeAnswer(ctx, payload) {
  const v = await voteOf(ctx, payload && payload.token);
  if (v.status !== 'waiting') throw new Error('This change is already ' + v.status + '.');
  if (new Date(v.expires_at) < new Date()) { await ctx.sql`update erp_owner_changes set status = 'expired' where id = ${v.change_id}`; throw new Error('This change was not agreed within 48 hours and has lapsed.'); }
  const agree = !!(payload && payload.agree);
  await ctx.sql`update erp_owner_votes set answer = ${agree ? 'yes' : 'no'}, answered_at = now() where change_id = ${v.change_id} and user_id = ${ctx.s.userId}`;
  if (!agree) { await ctx.sql`update erp_owner_changes set status = 'refused' where id = ${v.change_id}`; return { ...(await describe(ctx, v)), status: 'refused' }; }
  const left = (await ctx.sql`select count(*)::int n from erp_owner_votes where change_id = ${v.change_id} and answer is distinct from 'yes'`)[0].n;
  if (left === 0) {
    // both agreed: the change is made (never the last owner)
    await ctx.sql.begin(async (tx) => {
      const others = (await tx`select count(*)::int n from memberships where business_id = ${v.business_id} and role = 'owner' and active and user_id <> ${v.target_user}`)[0].n;
      if (!others) throw new Error('That is the last owner. Make someone else an owner first.');
      await tx`update memberships set role = coalesce(${v.new_role}::member_role, role), active = ${!v.switch_off} where business_id = ${v.business_id} and user_id = ${v.target_user}`;
      if (v.switch_off) await tx`delete from auth.sessions where user_id = ${v.target_user}`;
      await tx`update erp_owner_changes set status = 'done' where id = ${v.change_id}`;
    });
  }
  return describe(ctx, { ...v, status: left === 0 ? 'done' : 'waiting', answer: 'yes' });
}

export async function erpOwnerChanges(ctx) {
  const rows = await ctx.sql`select c.id, c.target_user, c.new_role, c.switch_off, c.requested_by, c.made_at, c.expires_at,
                                    (select count(*)::int from erp_owner_votes v where v.change_id = c.id and v.answer = 'yes') as agreed
                             from erp_owner_changes c where c.business_id = ${ctx.biz} and c.status = 'waiting' and c.expires_at > now() order by c.made_at desc`;
  return { waiting: rows.map((r) => ({ id: r.id, target: r.target_user, what: r.switch_off ? 'switch off' : 'change to ' + r.new_role, agreed: r.agreed, mine: r.requested_by === ctx.s.userId,
    until: formatDate(new Date(r.expires_at), 'd MMM, h:mm a') })) };
}

export async function erpOwnerChangeCancel(ctx, payload) {
  const r = await ctx.sql`update erp_owner_changes set status = 'cancelled' where id = ${str(payload && payload.id)}::uuid and requested_by = ${ctx.s.userId} and status = 'waiting' returning id`;
  if (!r.length) throw new Error('Only the owner who asked can cancel it, while it is waiting.');
  return { ok: true };
}

export const HANDLERS = { erpRecovery, erpEmergencyLink, erpOwnerChange, erpOwnerChangeAnswer, erpOwnerChanges, erpOwnerChangeCancel };
