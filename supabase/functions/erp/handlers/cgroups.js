// cgroup-1 (owner 10 Nov 2026): one WhatsApp group per customer, like the supplier group the owner buys in
// ("Nazir Vai (Korea)"): the customer + our MD + the manager's number + the AI salesperson (Faujia Alvi). The
// manager's number makes the groups, a few a day with random gaps, only for people it already knows (its chats, our
// invoiced customers - the owner checks the list first). Faujia welcomes them; from then on orders, invoices, delivery
// news and the review card go to the group, and Faujia answers the customer there (never our own team).
//
//   erpCustomerGroups {action}: get | fill | skip | requeue | start | stop | per_day | make_one
//   cgTick(ctx)        the inbox timer: makes the next group when it is time
//   groupInbound(...)  ingest: a message in a WhatsApp group - ours (a customer group) or ignored
//
// Settings live in the Agent Desk profile: cg_on, cg_per_day, team_wa (the MD's WhatsApp); the manager's number is
// superior_wa (boss-1); Faujia's number is the newest live chat WhatsApp.
//
// cgroup-2 (owner 11 Nov 2026): "do not put me in the groups - the customer, the MD, the manager and Alvi only; no more
// random groups: a group is made only after the customer buys, the manager greets them, says why it is open, then the
// invoice goes in". So:
//   members      the customer + the MD (team_wa's FIRST number only - the owner's number there is left out) + Alvi;
//                the manager's number makes the group
//   cg_mode      'purchase' (cg_since = when it started): cgTick makes groups only for invoices made after cg_since,
//                one at a time, 9:00-22:00 Dhaka; the old random queue is never worked again
//   greeting     from the MANAGER's number (profile cg_welcome / cg_welcome_buy, {salute} = ভাই / আপু / nothing), kept in
//                the group's Inbox chat as the team's message; after a purchase the invoice PDF follows, then the notice
//
// cgpost-1 (owner 19 Nov 2026, "Alvi does not put the invoices in the groups"): purchaseTick read only the FIRST 40
// invoices after cg_since, so after invoice no. 40 (INV-20261115-2167) it never saw a new buyer again; and a buyer who
// already had a group never got the next invoice there. Now every invoice is worked once (business_config cg_inv_sent:
// {since, done[]}): no group -> the group is made (as before); a group -> Alvi's number posts the invoice PDF + notice.
// Invoices from before cgpost-1 went live are NOT sent by themselves (that would surprise customers days later); the
// manager / MD send any invoice by hand on WhatsApp ("2161 group-e dao" -> bosschat invoice_to_group).

import { formatDate } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';
import { call, chSecret, sendOut } from './inboxch.js';
import { bossPhones } from './superior.js';
import { getConfig, setConfig } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const MIN = 60e3;

export function teamPhones(p) { return [...new Set(bossPhones(p.superior_wa).concat(bossPhones(p.team_wa)))]; }
/** cgroup-2: the MD alone (team_wa's first number); the owner's number after it is never put in a customer group. */
export function mdPhone(p) { return bossPhones(p.team_wa)[0] || ''; }
const DEF_WELCOME = 'আসসালামু আলাইকুম{salute}\nআমি আমাদের শপের ম্যানেজার।\nআপনার অর্ডার, ইনভয়েস, ডেলিভারির খবর আর যেকোনো সাপোর্ট এক জায়গায় দ্রুত দেওয়ার জন্য এই গ্রুপটা খোলা হয়েছে।\nকিছু লাগলে এখানেই লিখবেন, আমরা দ্রুত উত্তর দেব। ধন্যবাদ 💙';
const DEF_WELCOME_BUY = 'আসসালামু আলাইকুম{salute}\nআমি আমাদের শপের ম্যানেজার। আমাদের থেকে কেনাকাটার জন্য অনেক ধন্যবাদ!\nআপনার অর্ডার, ডেলিভারির খবর আর যেকোনো সাপোর্টের জন্য এই গ্রুপটা খোলা হয়েছে।\nনিচে আপনার ইনভয়েস দিলাম, একবার দেখে নেবেন। কিছু লাগলে এখানেই লিখবেন 💙';
/** The manager's greeting: the Agent Desk text (or the default), with ভাই / আপু when the gender is known. */
export function managerWelcome(p, gender, bought) {
  const t = str(bought ? p.cg_welcome_buy : p.cg_welcome) || (bought ? DEF_WELCOME_BUY : DEF_WELCOME);
  return t.replace(/\{salute\}/g, gender === 'f' ? ' আপু' : gender === 'm' ? ' ভাই' : '');
}
const phone88 = (v) => { const d = str(v).replace(/[^0-9]/g, ''); return d.length === 11 && d[0] === '0' ? '88' + d : d.length === 10 && d[0] === '1' ? '880' + d : d; };

async function evo(ctx, ch) {
  const base = (await chSecret(ctx, ch, 'URL')).replace(/\/+$/, ''), key = await chSecret(ctx, ch, 'KEY'), inst = str(ch.external_id);
  return base && key && inst ? { base, key, inst } : null;
}
async function ownNumber(ctx, ch) {
  const e = await evo(ctx, ch);
  if (!e) return '';
  const r = await call(ctx, e.base + '/instance/fetchInstances?instanceName=' + encodeURIComponent(e.inst), { method: 'GET', headers: { apikey: e.key } });
  const one = (Array.isArray(r.json) ? r.json : [r.json]).find(Boolean) || {};
  return str(one.ownerJid || one.owner || (one.instance && (one.instance.ownerJid || one.instance.owner))).replace(/@.*$/, '').replace(/[^0-9]/g, '');
}
/** The number that makes the groups (the manager's, superior_wa) and Faujia's (newest live chat WhatsApp). */
async function numbers(ctx, p) {
  const chs = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind = 'wa_evo' and status = 'live' order by created_at desc, id`;
  const boss = bossPhones(p.superior_wa)[0] || '';
  let maker = null, ai = null, aiNo = '';
  for (const c of chs) {
    const n = await ownNumber(ctx, c);
    if (n && n === boss && !maker) maker = c;
    if (!ai && str((c.settings || {}).purpose || 'chat') === 'chat' && n !== boss) { ai = c; aiNo = n; }
  }
  return { maker, ai, aiNo, boss };
}

export function subjectFor(name, gender, shop) {
  const first = str(name).split(/\s+/).filter((w) => !/^(md|mohammad|mohammed|muhammad|mst|mrs|mr|dr)\.?$/i.test(w))[0] || str(name).split(/\s+/)[0] || 'Customer';
  return (first + (gender === 'f' ? ' Apu' : ' Vai') + ' (' + (str(shop) || 'Shop') + ')').slice(0, 60);
}
export function welcomeText(p, name, gender) {
  const ai = str(p.agent_name).match(/\(([^)]*)\)/) ? str(p.agent_name).match(/\(([^)]*)\)/)[1] : str(p.agent_name).replace(/\s*\(.*\)\s*/, '') || 'আমি';
  const w = gender === 'f' ? 'আপু' : gender === 'm' ? 'ভাই' : '';
  return 'আসসালামু আলাইকুম' + (w ? ' ' + w : '') + ' 🌸\nআমি ' + ai + ', ' + (str(p.name) || 'আমাদের শপ') + ' থেকে। আপনার জন্য এই group-টা খুললাম, এখানে আমাদের MD আর ম্যানেজারও আছেন।\n\n' +
    'এখন থেকে এই group-এই:\n• অর্ডার করতে পারবেন - প্রোডাক্টের ছবি বা নাম আর কয়টা লাগবে লিখলেই হবে\n• প্রতিটা অর্ডারের invoice পাবেন\n• ডেলিভারির খবর আর যেকোনো প্রশ্নের উত্তর পাবেন\n\nকী লাগবে লিখুন, আমি আছি।';
}
/** Under the receipt in a customer group: the shop's standing note (as the supplier's group does). */
export function groupNotice() {
  return 'সম্মানিত গ্রাহক,\nঅনুগ্রহ করে invoice-টি দেখে নিন। কনফার্ম হওয়ার পর কোনো প্রোডাক্ট যোগ বা বদল করতে চাইলে আমাদের জানাবেন - ' +
    'পার্সেল পাঠানোর পরে নতুন কিছু নিলে সেটা নতুন অর্ডার হবে, আলাদা ডেলিভারি চার্জ লাগবে।\nআপনার সহযোগিতার জন্য ধন্যবাদ 💙';
}

/** fill: people the manager's number already knows - its WhatsApp chats in the Inbox, and our invoiced customers (12 months). */
async function fill(ctx, p) {
  const team = new Set(teamPhones(p));
  const seen = new Set((await ctx.tx`select phone from customer_groups where business_id = ${ctx.biz}`).map((r) => r.phone));
  const add = [];
  const chats = await ctx.tx`select k.name, k.gender, k.external_id, k.phone from inbox_contacts k join inbox_channels c on c.id = k.channel_id
    where k.business_id = ${ctx.biz} and c.kind = 'wa_evo' and c.status = 'live' and k.external_id not like '%@g.us' and k.external_id not like '%@lid'`;
  for (const k of chats) add.push({ phone: phone88(k.phone || k.external_id), name: str(k.name), gender: k.gender || null, source: 'whatsapp chat' });
  const inv = await ctx.tx`select distinct on (right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10)) customer_name, customer_phone
    from invoices where business_id = ${ctx.biz} and voided_at is null and created_at > ${new Date(ctx.now.getTime() - 365 * 24 * 3600e3)} and coalesce(customer_phone, '') <> ''
    order by right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10), created_at desc`;
  for (const i of inv) add.push({ phone: phone88(i.customer_phone), name: str(i.customer_name), gender: null, source: 'invoice' });
  let n = 0;
  for (const a of add) {
    if (!/^8801[3-9][0-9]{8}$/.test(a.phone) || team.has(a.phone) || seen.has(a.phone)) continue;
    seen.add(a.phone);
    await ctx.tx`insert into customer_groups (business_id, phone, name, gender, source) values (${ctx.biz}, ${a.phone}, ${a.name || a.phone}, ${a.gender}, ${a.source}) on conflict do nothing`;
    n++;
  }
  return n;
}

/** Make the next queued customer's group now. -> { made, id, error } */
export async function makeNext(ctx, p, rowId) {
  const row = rowId ? (await ctx.tx`select * from customer_groups where business_id = ${ctx.biz} and id = ${rowId} and status = 'queued'`)[0]
    : (await ctx.tx`select * from customer_groups where business_id = ${ctx.biz} and status = 'queued' order by (source = 'whatsapp chat') desc, queued_at, id limit 1`)[0];
  if (!row) return { error: 'nobody is waiting in the list' };
  const N = await numbers(ctx, p);
  if (!N.maker) return { error: "the manager's number (Agent Desk > superior WhatsApp) is not a linked WhatsApp in the inbox" };
  if (!N.ai || !N.aiNo) return { error: "the salesperson's WhatsApp number is not linked" };
  const e = await evo(ctx, N.maker);
  const members = [row.phone, mdPhone(p), N.aiNo].filter((x, i, a) => x && a.indexOf(x) === i && x !== N.boss);
  const subject = subjectFor(row.name, row.gender, p.name);
  const c = await call(ctx, e.base + '/group/create/' + encodeURIComponent(e.inst), { headers: { apikey: e.key }, body: { subject, description: (str(p.name) || 'Shop') + ' - orders, invoices and support', participants: members } });
  const jid = str(c.json && (c.json.id || (c.json.groupMetadata && c.json.groupMetadata.id)));
  if (!jid) {
    const why = 'the group could not be made (' + (c.code || 'no answer') + ' ' + str(c.json && (c.json.message || c.json.error) || '').slice(0, 120) + ')';
    await ctx.tx`update customer_groups set status = 'failed', error = ${why} where id = ${row.id}`;
    return { error: why, id: row.id };
  }
  // the customer may keep "only my contacts can add me": then the invite link goes to their chat
  let status = 'made';
  try {
    const pr = await call(ctx, e.base + '/group/participants/' + encodeURIComponent(e.inst) + '?groupJid=' + encodeURIComponent(jid), { method: 'GET', headers: { apikey: e.key } });
    const list = (pr.json && (pr.json.participants || pr.json)) || [];
    const ids = JSON.stringify(list);
    if (Array.isArray(list) && list.length && !ids.includes(row.phone)) {
      const ic = await call(ctx, e.base + '/group/inviteCode/' + encodeURIComponent(e.inst) + '?groupJid=' + encodeURIComponent(jid), { method: 'GET', headers: { apikey: e.key } });
      const link = str(ic.json && (ic.json.inviteUrl || (ic.json.inviteCode ? 'https://chat.whatsapp.com/' + ic.json.inviteCode : '')));
      if (link) { await sendOut(ctx, N.ai, { external_id: row.phone }, { kind: 'text', text: 'আপনার অর্ডার, invoice আর সাপোর্টের জন্য ' + (str(p.name) || 'আমাদের') + ' টিমের সাথে আপনার আলাদা group খুলেছি - এই লিংকে ঢুকে যান: ' + link }); status = 'invited'; }
    }
  } catch (_) { /* made; the welcome still goes */ }
  // the group becomes a chat in the Inbox on Faujia's number, and she welcomes them
  const contact = (await ctx.tx`insert into inbox_contacts (business_id, channel_id, external_id, name, gender, phone)
    values (${ctx.biz}, ${N.ai.id}, ${jid}, ${row.name}, ${row.gender}, ${'+' + row.phone})
    on conflict (channel_id, external_id) do update set name = excluded.name returning *`)[0];
  const conv = (await ctx.tx`insert into inbox_conversations (business_id, channel_id, contact_id) values (${ctx.biz}, ${N.ai.id}, ${contact.id})
    on conflict (contact_id) do update set channel_id = excluded.channel_id returning *`)[0];
  await ctx.tx`update customer_groups set status = ${status}, group_jid = ${jid}, subject = ${subject}, conversation_id = ${conv.id}, made_at = now(), error = null where id = ${row.id}`;
  // cgroup-2: the manager greets them from his own number (the ONE automatic message his number sends - mgr-quiet-1);
  // after a purchase Alvi's number sends the invoice and the notice
  const { writeMsg } = await import('./inbox.js');
  const bought = row.source === 'purchase';
  const hello = managerWelcome(p, row.gender, bought);
  const s1 = await sendOut(ctx, N.maker, { external_id: jid }, { kind: 'text', text: hello });
  await writeMsg(ctx, conv, { direction: 'out', author: 'team', userName: 'Manager', kind: 'text', text: hello, externalId: s1.externalId || null });
  if (bought && str(row.invoice_no)) {
    try {
      const S = await import('./sales.js');
      const pdf = await ctx.tx.savepoint(() => S.erpInvoicePdf(ctx, { invoiceNo: str(row.invoice_no) }));
      if (pdf && pdf.found && pdf.url) {
        const s2 = await sendOut(ctx, N.ai, { external_id: jid }, { kind: 'document', url: pdf.url, fileName: 'Invoice_' + str(row.invoice_no) + '.pdf', caption: 'Invoice ' + str(row.invoice_no) });
        await writeMsg(ctx, conv, { direction: 'out', author: 'ai', kind: 'text', text: '(invoice ' + str(row.invoice_no) + ' PDF)', externalId: s2.externalId || null });
        await sendOut(ctx, N.ai, { external_id: jid }, { kind: 'text', text: groupNotice() });
      } else await writeMsg(ctx, conv, { direction: 'note', author: 'system', kind: 'event', text: 'Group made after invoice ' + str(row.invoice_no) + ' - its PDF was not found, send it by hand.' });
    } catch (e) { await writeMsg(ctx, conv, { direction: 'note', author: 'system', kind: 'event', text: 'The invoice could not be sent to the group: ' + str(e && e.message).slice(0, 160) }); }
  }
  return { made: true, id: row.id, jid, status };
}

/** The inbox timer: the next group when it is time (10:00-21:00 Dhaka, the day's number, a random 25-55 min gap). */
export async function cgTick(ctx) {
  const { profile } = await import('./inbox.js');
  const p = await profile(ctx, false);
  if (!p.cg_on) return { off: true };
  if (str(p.cg_mode) === 'purchase') return purchaseTick(ctx, p);
  const h = Number(formatDate(ctx.now, 'H'));
  if (h < 10 || h >= 21) return { waiting: 'night' };
  const today = (await ctx.tx`select count(*)::int n, max(made_at) last from customer_groups where business_id = ${ctx.biz} and made_at > ${new Date(ctx.now.getTime() - 24 * 3600e3)}`)[0];
  if (today.n >= Math.max(1, Math.min(30, num(p.cg_per_day) || 12))) return { waiting: 'the day is full' };
  if (today.last) {
    const gap = (25 + (parseInt(String(today.last.getTime ? today.last.getTime() : new Date(today.last).getTime()).slice(-2), 10) % 31)) * MIN;   // 25-55 min, fixed per group
    if (ctx.now.getTime() - new Date(today.last).getTime() < gap) return { waiting: 'gap' };
  }
  // stop by itself after three failures in a row (WhatsApp may be refusing)
  const last3 = await ctx.tx`select status from customer_groups where business_id = ${ctx.biz} and status in ('made', 'invited', 'failed') order by coalesce(made_at, queued_at) desc limit 3`;
  if (last3.length === 3 && last3.every((r) => r.status === 'failed')) return { stopped: 'three failures in a row - check the numbers' };
  return makeNext(ctx, p);
}

const SENT_KEY = 'cg_inv_sent';
async function sentState(ctx) {
  let st = null;
  try { st = JSON.parse(str(await getConfig(ctx, SENT_KEY, '')) || 'null'); } catch (_) { st = null; }
  if (!st || typeof st !== 'object' || !str(st.since)) { st = { since: ctx.now.toISOString(), done: [] }; await setConfig(ctx, SENT_KEY, JSON.stringify(st)); }
  if (!Array.isArray(st.done)) st.done = [];
  return st;
}
async function sentMark(ctx, st, no) {
  st.done = st.done.filter((x) => x !== no).concat([no]).slice(-1500);
  await setConfig(ctx, SENT_KEY, JSON.stringify(st));
}
const upper = (v) => str(v).toUpperCase();
/** The customer's open group (made / invited, with its WhatsApp id), or null. */
export async function groupOf(ctx, phone) {
  return (await ctx.tx`select * from customer_groups where business_id = ${ctx.biz} and phone = ${phone} and status in ('made', 'invited') and group_jid is not null order by made_at desc nulls last limit 1`)[0] || null;
}
/** cgpost-1: Alvi's number posts one invoice's PDF (and the shop's notice) into the customer's group. */
export async function invoiceToGroup(ctx, p, g, invoiceNo) {
  const N = await numbers(ctx, p);
  if (!N.ai) return { error: "the salesperson's WhatsApp number is not linked" };
  const S = await import('./sales.js');
  const pdf = await ctx.tx.savepoint(() => S.erpInvoicePdf(ctx, { invoiceNo: str(invoiceNo) }));
  if (!pdf || !pdf.found || !pdf.url) return { error: 'the PDF of invoice ' + invoiceNo + ' could not be made' };
  const s = await sendOut(ctx, N.ai, { external_id: g.group_jid }, { kind: 'document', url: pdf.url, fileName: 'Invoice_' + str(invoiceNo) + '.pdf', caption: 'Invoice ' + str(invoiceNo) });
  if (s && s.ok === false) return { error: 'WhatsApp did not take it (' + str(s.error).slice(0, 120) + ')' };
  await sendOut(ctx, N.ai, { external_id: g.group_jid }, { kind: 'text', text: groupNotice() });
  const v = g.conversation_id ? (await ctx.tx`select * from inbox_conversations where id = ${g.conversation_id}`)[0] : null;
  if (v) { const { writeMsg } = await import('./inbox.js'); await writeMsg(ctx, v, { direction: 'out', author: 'ai', kind: 'text', text: '(invoice ' + str(invoiceNo) + ' PDF)', externalId: (s && s.externalId) || null }); }
  return { sent: true };
}
/** Queue a group for this buyer (new row or the old list row) and make it now. */
async function groupForBuyer(ctx, p, ph, name, invoiceNo) {
  const g = (await ctx.tx`select * from customer_groups where business_id = ${ctx.biz} and phone = ${ph}`)[0];
  let id;
  if (g) { await ctx.tx`update customer_groups set status = 'queued', source = 'purchase', invoice_no = ${String(invoiceNo)}, error = null where id = ${g.id}`; id = g.id; }
  else id = (await ctx.tx`insert into customer_groups (business_id, phone, name, source, invoice_no) values (${ctx.biz}, ${ph}, ${str(name) || ph}, 'purchase', ${String(invoiceNo)}) returning id`)[0].id;
  return makeNext(ctx, p, id);
}
/** cgpost-1 (by hand, manager / MD on WhatsApp): this invoice into the buyer's group - the group is made first if there is none. */
export async function sendInvoiceToGroup(ctx, p, ref) {
  const d = str(ref).replace(/^#/, '');
  if (!d) return { error: 'Which invoice? Give its number.' };
  const tail = d.replace(/[^0-9]/g, '');
  const inv = await ctx.tx`select invoice_no, customer_name, customer_phone from invoices where business_id = ${ctx.biz} and voided_at is null
                           and (upper(invoice_no) = ${d.toUpperCase()} or (${tail.length >= 3} and invoice_no like ${'%-' + tail}))
                           order by created_at desc limit 3`;
  if (!inv.length) return { error: 'No invoice ' + d + '.' };
  const exact = inv.find((x) => upper(x.invoice_no) === d.toUpperCase());
  if (!exact && inv.length > 1) return { error: 'More than one invoice ends in ' + tail + ': ' + inv.map((x) => x.invoice_no).join(', ') };
  const i = exact || inv[0], ph = phone88(i.customer_phone);
  if (!/^8801[3-9][0-9]{8}$/.test(ph)) return { error: 'Invoice ' + i.invoice_no + ' has no usable Bangladesh mobile number (' + (str(i.customer_phone) || 'empty') + ').' };
  if (teamPhones(p).includes(ph)) return { error: 'That number is our own team.' };
  const st = await sentState(ctx);
  const g = await groupOf(ctx, ph);
  let r;
  if (g) r = await invoiceToGroup(ctx, p, g, i.invoice_no);
  else { r = await groupForBuyer(ctx, p, ph, i.customer_name, i.invoice_no); if (r.made) r = { sent: true, newGroup: true, invited: r.status === 'invited' }; }
  if (r.sent) await sentMark(ctx, st, String(i.invoice_no));
  return { ...r, invoice: i.invoice_no, customer: str(i.customer_name) };
}

/** cgroup-2 + cgpost-1: the next invoice not worked yet - its buyer's group is made (with the invoice), or the invoice
 *  goes into the group they already have. One invoice per tick; 9:00-22:00 Dhaka. */
export async function purchaseTick(ctx, p, anyHour) {
  const h = Number(formatDate(ctx.now, 'H'));
  if (!anyHour && (h < 9 || h >= 22)) return { waiting: 'night' };
  const st = await sentState(ctx);
  const since = new Date(Math.max(str(p.cg_since) ? new Date(str(p.cg_since)).getTime() : ctx.now.getTime(), new Date(st.since).getTime()));
  const last3 = await ctx.tx`select status from customer_groups where business_id = ${ctx.biz} and source = 'purchase' and status in ('made', 'invited', 'failed') order by coalesce(made_at, queued_at) desc limit 3`;
  const makeStopped = last3.length === 3 && last3.every((r) => r.status === 'failed');
  const day = (await ctx.tx`select count(*)::int n from customer_groups where business_id = ${ctx.biz} and made_at > ${new Date(ctx.now.getTime() - 24 * 3600e3)}`)[0].n;
  const team = new Set(teamPhones(p));
  const done = st.done.length ? st.done : ['-'];
  // 3 minutes old at least: the invoice may still be edited right after saving
  const inv = await ctx.tx`select invoice_no, customer_name, customer_phone, created_at from invoices where business_id = ${ctx.biz} and voided_at is null and created_at > ${since}
                           and created_at < ${new Date(ctx.now.getTime() - 3 * MIN)} and coalesce(customer_phone, '') <> ''
                           and not (invoice_no::text = any(${done}::text[])) order by created_at limit 40`;
  for (const i of inv) {
    const no = String(i.invoice_no), ph = phone88(i.customer_phone);
    if (!/^8801[3-9][0-9]{8}$/.test(ph) || team.has(ph)) { await sentMark(ctx, st, no); continue; }
    const g = await groupOf(ctx, ph);
    if (g) {
      const r = await invoiceToGroup(ctx, p, g, no);
      if (r.error) {
        // tried again next tick; after 2 hours it is left for the team (a note in the group's chat) so one bad invoice never blocks the rest
        if (ctx.now.getTime() - new Date(i.created_at).getTime() < 2 * 3600e3) return { error: r.error, invoice: no };
        const v = g.conversation_id ? (await ctx.tx`select * from inbox_conversations where id = ${g.conversation_id}`)[0] : null;
        if (v) { const { writeMsg } = await import('./inbox.js'); await writeMsg(ctx, v, { direction: 'note', author: 'system', kind: 'event', text: 'Invoice ' + no + ' could not be sent to this group: ' + r.error + ' - send it by hand.' }); }
        await sentMark(ctx, st, no);
        continue;
      }
      await sentMark(ctx, st, no);
      return { posted: no };
    }
    const old = (await ctx.tx`select * from customer_groups where business_id = ${ctx.biz} and phone = ${ph}`)[0];
    if (old && old.source === 'purchase' && old.status === 'failed') { await sentMark(ctx, st, no); continue; }   // the owner retries by hand
    if (makeStopped) return { stopped: 'three failures in a row - check the numbers' };
    if (day >= 30) return { waiting: 'the day is full' };
    await sentMark(ctx, st, no);   // a failed make is recorded on the group row, never retried in a loop
    return groupForBuyer(ctx, p, ph, i.customer_name, no);
  }
  return { waiting: 'no new invoice' };
}

/** ingest: a WhatsApp group message. Our customer group on Faujia's number -> handled like a chat (team members pause
 *  the AI); any other group (e.g. a supplier's) -> ignored. Returns null to go on as a chat, or a result to stop. */
export async function groupInbound(ctx, ch, ev) {
  const g = (await ctx.tx`select * from customer_groups where business_id = ${ctx.biz} and group_jid = ${str(ev.from)}`)[0];
  if (!g || !g.conversation_id) return { ignored: 'not a customer group' };
  const v = (await ctx.tx`select * from inbox_conversations where id = ${g.conversation_id}`)[0];
  if (!v || v.channel_id !== ch.id) return { ignored: 'another number in the group' };   // only Faujia's number answers
  const { profile, writeMsg } = await import('./inbox.js');
  const p = await profile(ctx, false);
  const who = phone88(str(ev.participant).replace(/@.*$/, ''));
  if (who && teamPhones(p).includes(who)) {
    // our MD / manager wrote: kept as the team's message; the AI keeps quiet for 15 minutes
    await writeMsg(ctx, v, { direction: 'out', author: 'team', userName: str(ev.name) || 'Team', kind: 'text', text: str(ev.text), externalId: ev.id || null });
    await ctx.tx`update inbox_conversations set mode = 'human', human_until = ${new Date(ctx.now.getTime() + 15 * MIN)}, reply_due_at = null where id = ${v.id}`;
    return { team: true };
  }
  return null;
}

export async function erpCustomerGroups(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner runs customer groups.');
  const a = str((payload || {}).action) || 'get';
  const { profile } = await import('./inbox.js');
  const p = await profile(ctx, false);
  const setP = async (patch) => { const { erpInboxProfile } = await import('./inbox2.js'); await erpInboxProfile(ctx, { save: patch }); };
  let note = '';
  if (['start', 'stop', 'per_day', 'make_one', 'after_purchase', 'greet_all'].includes(a) && !roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner starts, stops or makes customer groups.');
  if (a === 'fill') note = (await fill(ctx, p)) + ' added to the list';
  else if (a === 'skip' || a === 'requeue') await ctx.tx`update customer_groups set status = ${a === 'skip' ? 'skipped' : 'queued'}, error = null where business_id = ${ctx.biz} and id = ${str(payload.id)} and status <> 'made'`;
  else if (a === 'start' || a === 'stop') { if (a === 'start' && !bossPhones(p.team_wa).length) throw new Error("Write the MD's WhatsApp in Agent Desk first."); await setP({ cg_on: a === 'start' }); }
  else if (a === 'after_purchase') { if (!bossPhones(p.team_wa).length) throw new Error("Write the MD's WhatsApp in Agent Desk first."); await setP({ cg_on: true, cg_mode: 'purchase', cg_since: ctx.now.toISOString() }); note = 'Groups now open only after a purchase'; }
  else if (a === 'greet_all') {
    // cgroup-2: the manager's greeting (cg_welcome) once in every group already made
    const N = await numbers(ctx, p);
    if (!N.maker) throw new Error("The manager's number is not a linked WhatsApp in the inbox.");
    const { writeMsg } = await import('./inbox.js');
    const gs = await ctx.tx`select * from customer_groups where business_id = ${ctx.biz} and status in ('made', 'invited') and group_jid is not null and greeted_at is null`;
    let sent = 0;
    for (const g of gs) {
      const hello = managerWelcome(p, g.gender, false);
      const r = await sendOut(ctx, N.maker, { external_id: g.group_jid }, { kind: 'text', text: hello });
      if (!r.ok) continue;
      sent++;
      await ctx.tx`update customer_groups set greeted_at = now() where id = ${g.id}`;
      const v = g.conversation_id ? (await ctx.tx`select * from inbox_conversations where id = ${g.conversation_id}`)[0] : null;
      if (v) await writeMsg(ctx, v, { direction: 'out', author: 'team', userName: 'Manager', kind: 'text', text: hello, externalId: r.externalId || null });
    }
    note = 'Greeted ' + sent + ' of ' + gs.length + ' groups';
  }
  else if (a === 'per_day') await setP({ cg_per_day: Math.max(1, Math.min(30, Math.round(num(payload.n)) || 12)) });
  else if (a === 'make_one') { const r = await makeNext(ctx, p, str(payload.id) || null); if (r.error) throw new Error(r.error); note = 'Group made: ' + r.jid; }
  const p2 = await profile(ctx, false);
  const counts = (await ctx.tx`select status, count(*)::int n from customer_groups where business_id = ${ctx.biz} group by status`).reduce((o, r) => ({ ...o, [r.status]: r.n }), {});
  const rows = await ctx.tx`select * from customer_groups where business_id = ${ctx.biz} order by (status = 'queued') desc, coalesce(made_at, queued_at) desc limit 200`;
  return { on: !!p2.cg_on, mode: str(p2.cg_mode) || 'list', since: str(p2.cg_since), perDay: num(p2.cg_per_day) || 12, team: p2.team_wa, manager: p2.superior_wa, counts, note,
    rows: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, source: r.source, status: r.status, subject: str(r.subject), error: str(r.error), conv: r.conversation_id,
      at: r.made_at ? formatDate(new Date(r.made_at), 'd MMM, h:mm a') : '' })) };
}

export const HANDLERS = { erpCustomerGroups };
