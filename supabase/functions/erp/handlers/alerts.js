// Alerts: things the owner should know without going looking. Redesign phase 6.
//
//   erpAlerts()            what needs attention now (bell in the top bar)
//   erpAlertPhone({phone}) the WhatsApp number alerts are also sent to
//   alertsPush(ctx)        timer, every 10 minutes: sends what is new to that
//                          number through the business's own WhatsApp link
//
// Stock and money already have their cards on the dashboard; these are the
// things nobody is looking at: a device waiting to be let in, a night job
// that failed, backups that stopped, actions failing for staff.

import { formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { erpDevices } from './settings.js';
import { waNumber, evoCall, erpEvoStatus } from './campaigns.js';

const str = (v) => String(v == null ? '' : v).trim();
const JOB_WORDS = { 'nightly:steadfast': 'The nightly Steadfast check', 'nightly:backup': 'The nightly backup',
                    'campaigns:tick': 'A WhatsApp campaign', 'websync:pull': 'Reading website orders',
                    'websync:push': 'Sending stock to the website', 'whatsapp:hook': 'A WhatsApp reply' };

export async function alertList(ctx) {
  const out = [];
  const part = async (fn) => { try { await ctx.tx.savepoint(fn); } catch (_) { /* one part failing must not hide the others */ } };

  await part(async () => {
    const d = await erpDevices(ctx);
    for (const p of d.pending) {
      out.push({ key: 'device:' + p.userId + ':' + p.id, level: 'warn', title: p.name + ' is waiting to be let in',
                 detail: p.label + (p.requested ? ' · asked ' + p.requested : ''), go: 'people' });
    }
  });

  await part(async () => {
    const rows = await ctx.sql`
      select action, message, at from erp_errors
      where business_id = ${ctx.biz} and who = 'Timer' and at > now() - interval '48 hours' order by at desc limit 40`;
    const seen = {};
    for (const r of rows) {
      const day = formatDate(new Date(r.at), 'yyyy-MM-dd'), k = 'timer:' + r.action + ':' + day;
      if (seen[k]) continue;
      seen[k] = true;
      out.push({ key: k, level: 'bad', title: (JOB_WORDS[str(r.action)] || str(r.action)) + ' failed',
                 detail: formatDate(new Date(r.at), 'd MMM, h:mm a') + ' · ' + str(r.message).slice(0, 160), go: '' });
    }
  });

  await part(async () => {
    const last = (await ctx.tx`select at from erp_backup_log where business_id = ${ctx.biz} and made > 0 order by at desc limit 1`)[0];
    if (!last) return;
    const hours = Math.round((ctx.now.getTime() - new Date(last.at).getTime()) / 3600e3);
    if (hours > 36) {
      out.push({ key: 'backup:' + formatDate(ctx.now, 'yyyy-MM-dd'), level: 'bad', title: 'No backup for ' + hours + ' hours',
                 detail: 'The last copy was made ' + formatDate(new Date(last.at), 'd MMM, h:mm a') + '.', go: 'security' });
    }
  });

  await part(async () => {
    const r = (await ctx.sql`
      select count(*)::int n, (array_agg(message order by at desc))[1] as last from erp_errors
      where business_id = ${ctx.biz} and who <> 'Timer' and at > now() - interval '24 hours'
        and message !~ '^(Your account does not have access|Sign in to the ERP|Too many wrong codes|Your sign-in has expired)'`)[0];
    if (r && r.n >= 10) {
      out.push({ key: 'errors:' + formatDate(ctx.now, 'yyyy-MM-dd'), level: 'info', title: r.n + ' actions were refused or failed in the last day',
                 detail: 'Most recent: ' + str(r.last).slice(0, 160), go: '' });
    }
  });
  return out;
}

export async function erpAlerts(ctx) {
  const alerts = await alertList(ctx);
  const out = { alerts, count: alerts.filter((a) => a.level !== 'info').length };
  if (ctx.s.role === 'owner') out.phone = str(await getConfig(ctx, 'alert_phone', ''));
  return out;
}

/** The number alerts are also sent to on WhatsApp. Empty switches that off. */
export async function erpAlertPhone(ctx, payload) {
  const raw = str(payload && payload.phone);
  if (raw && !waNumber(raw)) throw new Error('Type an 11-digit mobile number, or a number abroad with + and its country code.');
  await setConfig(ctx, 'alert_phone', raw);
  let ready = false;
  if (raw) { try { ready = !!(await erpEvoStatus(ctx)).connected; } catch (_) { ready = false; } }
  return { ok: true, phone: raw, whatsappReady: ready };
}

/** Timer: send what is new to the owner's WhatsApp, once each. */
export async function alertsPush(ctx) {
  const phone = waNumber(await getConfig(ctx, 'alert_phone', ''));
  if (!phone) return { skipped: 'no number' };
  const list = (await alertList(ctx)).filter((a) => a.level !== 'info');
  // what no longer applies may be said again if it comes back after a week
  await ctx.sql`delete from erp_alert_sent where business_id = ${ctx.biz} and sent_at < now() - interval '7 days'`;
  if (!list.length) return { sent: 0 };
  const had = {};
  for (const r of await ctx.sql`select key from erp_alert_sent where business_id = ${ctx.biz}`) had[r.key] = true;
  const fresh = list.filter((a) => !had[a.key]);
  if (!fresh.length) return { sent: 0 };
  const text = str(ctx.s.businessName) + ' ERP — needs your attention:\n' +
    fresh.slice(0, 8).map((a) => '• ' + a.title + (a.detail ? '\n  ' + a.detail : '')).join('\n') + '\n\nhttps://erp.costareen.com';
  const r = await evoCall(ctx, 'POST', '/message/sendText', { number: phone, text });
  if (r.code !== 200 && r.code !== 201) throw new Error('The alert did not go (' + r.code + ').');
  for (const a of fresh) {
    await ctx.sql`insert into erp_alert_sent (business_id, key) values (${ctx.biz}, ${a.key}) on conflict do nothing`;
  }
  return { sent: fresh.length };
}

/** Businesses that asked for alerts on WhatsApp. */
export async function alertBusinesses(sql) {
  return (await sql`select business_id from business_config where key = 'alert_phone' and btrim(coalesce(value, '')) <> ''`).map((r) => r.business_id);
}

export const HANDLERS = { erpAlerts, erpAlertPhone };
