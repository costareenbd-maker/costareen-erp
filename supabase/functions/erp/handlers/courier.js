// Group 'courier' - Steadfast parcels and payouts.
// Ported line by line from ERP.js:5927-6208 (keys, booking, preview),
// 6316-6345 (balance), 6482-6531 (set aside / put back),
// 8422-8902 (payouts, the parcel-by-parcel check), 11037-11085 (nightly).
//
// The keys live in business_secrets (ERP_SF_KEY / ERP_SF_SECRET), read only
// through lib/ext.js, and never leave this file in a return value.

import { salesLog, paymentsTab, forget, asDate, str, SL, PAY } from '../lib/tabs.js';
import { formatDate, num, round2 } from '../lib/time.js';
import { custKey } from '../lib/phone.js';
import { getSecret, setSecret, getConfig, setConfig, httpFetch } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { paidByOrder, addPayment, syncInvoiceStatus, outstanding, lock, stamp, who } from './money.js';
import { cashRules } from './cash.js';

export const ERP_SF_BASE = 'https://portal.packzy.com/api/v1';
export const ERP_SF_AUTO_WRITEOFF = 200;
const WEBSITE_API = 'https://costareen.com/wp-json/cz/v1';

/** ERP_COURIER_WORDS (ERP:5799) */
export const ERP_COURIER_WORDS = {
  delivered:         { label: 'Delivered',        tone: 'ok',   collected: true },
  partial_delivered: { label: 'Part delivered',   tone: 'warn', collected: true },
  in_review:         { label: 'With the courier', tone: 'info', collected: false },
  pending:           { label: 'Waiting pickup',   tone: 'info', collected: false },
  hold:              { label: 'On hold',          tone: 'warn', collected: false },
  cancelled:         { label: 'Cancelled',        tone: 'bad',  collected: false },
  returned:          { label: 'Came back',        tone: 'bad',  collected: false },
  unknown:           { label: 'Courier says unknown', tone: 'warn', collected: false },
};

// ------------------------------------------------------------- helpers

/** A part the original wrapped in try/catch: a failure must not abort the call. */
async function attempt(ctx, fn) {
  try { return await ctx.tx.savepoint(() => fn()); } catch (_) { return undefined; }
}

/** erpSfKeys_ */
async function sfKeys(ctx) {
  if (!ctx.memo.sfKeys) {
    ctx.memo.sfKeys = { key: await getSecret(ctx, 'ERP_SF_KEY'), secret: await getSecret(ctx, 'ERP_SF_SECRET') };
  }
  return ctx.memo.sfKeys;
}

/** erpSfCall_ (ERP:5984): one call to Steadfast, with this business's keys. */
export async function sfCall(ctx, method, path, body) {
  const k = await sfKeys(ctx);
  if (!k.key || !k.secret) {
    throw new Error('This business has no courier keys yet. Settings → Courier, ' +
                    'and paste the API key and secret from your Steadfast account.');
  }
  const res = await httpFetch(ctx, ERP_SF_BASE + path, {
    method,
    headers: { 'api-key': k.key, 'secret-key': k.secret, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const code = res.code, text = res.text, json = res.json;
  if (code === 0) throw new Error('Could not reach Steadfast: ' + String(text).slice(0, 200));

  // Steadfast also answers 401 when asked about a parcel that is not
  // yours, so a 401 on a status lookup does not mean the keys are wrong.
  const lookup = String(path).indexOf('/status_by') === 0;
  const badKeys = /invalid api credentials/i.test(text);
  if ((code === 401 || code === 403) && lookup && !badKeys) {
    return json || { status: code, delivery_status: '' };
  }
  if (code === 401 || code === 403) {
    throw new Error('Steadfast refused the keys for this business. Check them in ' +
                    'Settings → Courier.');
  }
  if (!json) throw new Error('Steadfast replied with something unreadable (HTTP ' + code + ').');
  return json;
}

/** czFetch_ (Code:3852): the website's sync bridge. */
async function czFetch(ctx, path) {
  const key = await getSecret(ctx, 'CZ_SYNC_KEY');
  if (!key) throw new Error('Website sync key not set. Run "Setup Website Sync" from the menu first.');
  const base = String(await getConfig(ctx, 'website_api', WEBSITE_API)).trim() || WEBSITE_API;
  const res = await httpFetch(ctx, base + path, { method: 'GET', headers: { 'x-cz-key': key } });
  if (res.code !== 200) throw new Error('Website returned HTTP ' + res.code + ': ' + String(res.text).substring(0, 300));
  return JSON.parse(res.text);
}

/**
 * A Steadfast timestamp as Apps Script's new Date() read it: a bare date is
 * UTC midnight, a date and time with no zone is script-local (Asia/Dhaka).
 */
function sfDate(s) {
  const t = String(s || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(t);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - 6 * 3600 * 1000);
  return new Date(t);
}

// ------------------------------------------------------------- the tabs

/** COURIER_LOG rows, in write order (same columns as tabs.courierLog). */
function courierRows(ctx) {
  const k = 'tab:COURIER_LOG_SEQ';
  if (!ctx.memo[k]) {
    ctx.memo[k] = ctx.tx`
      select booked_at, invoice_no, coalesce(consignment_id, ''), customer, phone, address,
             cod_amount, invoice_total, booked_by, coalesce(note, ''), id
      from courier_log where business_id = ${ctx.biz}
      order by seq`.values();
  }
  return ctx.memo[k];
}
function forgetCourier(ctx) { forget(ctx, 'COURIER_LOG', 'COURIER_LOG_SEQ'); }

/** COURIER_PAYOUTS: payout_id, created_at, paid_at, cod_collected, delivery_charges, cod_fee, paid_to_bank, parcels, synced_at, fields_seen */
function payoutRows(ctx) {
  return ctx.tx`
    select payout_id, coalesce(created_src, ''), coalesce(paid_at, ''), cod_collected, delivery_charges,
           cod_fee, paid_to_bank, parcels, synced_at, coalesce(fields_seen, '')
    from courier_payouts where business_id = ${ctx.biz} order by seq`.values();
}

/** COURIER_PAYOUT_LINES: payout_id, consignment_id, tracking_code, cod_amount, status, recipient_name,
 *  recipient_phone, parcel_created, invoice_no, match, delivery_charge, cod_charge */
function lineRows(ctx) {
  return ctx.tx`
    select payout_id, coalesce(consignment_id, ''), coalesce(tracking_code, ''), cod_amount,
           coalesce(status, ''), coalesce(recipient_name, ''), coalesce(recipient_phone, ''),
           coalesce(parcel_created, ''), coalesce(invoice_no, ''), coalesce(match, ''),
           delivery_charge, cod_charge
    from courier_payout_lines where business_id = ${ctx.biz} order by seq`.values();
}

/** COURIER_RECON: consignment_id, payout_id, invoice_no, customer, expected, collected, gap, action, amount, note, at, by, + id */
function reconRows(ctx) {
  return ctx.tx`
    select consignment_id, coalesce(payout_id, ''), coalesce(invoice_no, ''), coalesce(customer, ''),
           expected, collected, gap, coalesce(action, ''), amount, coalesce(note, ''), at, coalesce(by, ''), id
    from courier_recon where business_id = ${ctx.biz} order by seq`.values();
}

/** erpSfBooked_ (ERP:6047): every parcel booked from here, by invoice. */
export async function sfBooked(ctx) {
  const out = {};
  for (const v of await courierRows(ctx)) {
    const inv = str(v[1]);
    if (!inv) continue;
    out[inv] = { consignment: str(v[2]), cod: num(v[6]), when: asDate(v[0]),
                 customer: str(v[3]),
                 byHand: /\[by hand\]/.test(String(v[9] || '')), row: v[10] };
  }
  return out;
}

/** erpOwedMap_ (ERP:8841): what every invoice still owes, in one pass. */
export async function owedMap(ctx, names) {
  const g = {}, s = {}, st = {};
  for (const r of await salesLog(ctx)) {
    const id = str(r[SL.order_id]);
    if (!id) continue;
    g[id] = Math.max(g[id] || 0, num(r[SL.grand_total]));
    s[id] = Math.max(s[id] || 0, num(r[SL.advance_paid]));
    if (str(r[SL.payment_status]).toLowerCase() === 'paid') st[id] = true;
    if (names && !names[id]) names[id] = str(r[SL.customer_name]);
  }
  const paid = await paidByOrder(ctx), out = {};
  for (const k of Object.keys(g)) {
    out[k] = st[k] ? 0 : Math.max(0, Math.round((g[k] - Math.max(paid[k] || 0, s[k] || 0)) * 100) / 100);
  }
  return out;
}

/** erpSfReconDone_ */
async function reconDone(ctx) {
  const done = {};
  for (const r of await reconRows(ctx)) done[String(r[0])] = String(r[7] || 'ok');
  return done;
}

// ------------------------------------------------------------- keys

/** erpCourierSetKeys (ERP:5951) */
export async function erpCourierSetKeys(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can change the courier keys.');
  payload = payload || {};
  const key = str(payload.apiKey), secret = str(payload.apiSecret);
  if (payload.clear) {
    await setSecret(ctx, 'ERP_SF_KEY', '');
    await setSecret(ctx, 'ERP_SF_SECRET', '');
    delete ctx.memo.sfKeys;
    return { ok: true, cleared: true, hasKey: false, hasSecret: false };
  }
  if (!key || !secret) throw new Error('Both the API key and the secret key are needed.');
  await setSecret(ctx, 'ERP_SF_KEY', key);
  await setSecret(ctx, 'ERP_SF_SECRET', secret);
  delete ctx.memo.sfKeys;
  return { ok: true, hasKey: true, hasSecret: true };
}

/** erpCourierKeyStatus (ERP:5975): whether keys exist - never what they are. */
export async function erpCourierKeyStatus(ctx) {
  const k = await sfKeys(ctx);
  return { hasKey: !!k.key, hasSecret: !!k.secret, business: (ctx.s && ctx.s.businessName) || '' };
}

/** erpCourierTest (ERP:6020) */
export async function erpCourierTest(ctx) {
  try {
    const r = await sfCall(ctx, 'GET', '/get_balance', null);
    if (!r || Number(r.status) !== 200) {
      return { ok: false, error: 'Steadfast answered, but not with the account balance.' };
    }
    return { ok: true, reply: 'connected', balance: r.current_balance };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/** erpCourierBalance_ (ERP:6316): what Steadfast holds, cached 30 minutes. */
export async function sfBalance(ctx) {
  const hit = await getConfig(ctx, 'sf_balance_cache', '');
  if (hit) {
    try {
      const c = JSON.parse(hit);
      if (Date.now() - c.at < 30 * 60 * 1000) return c.v;
    } catch (_) { /* as original */ }
  }
  let val = null;
  try {
    const r = await sfCall(ctx, 'GET', '/get_balance', null);
    if (r && r.current_balance !== undefined) val = Math.round(num(r.current_balance));
  } catch (_) {
    try {
      const w = await czFetch(ctx, '/cod?days=1&limit=1');
      if (w && w.balance !== null && w.balance !== undefined) val = Math.round(num(w.balance));
    } catch (_2) { /* as original */ }
  }
  await setConfig(ctx, 'sf_balance_cache', JSON.stringify({ at: Date.now(), v: val }));
  return val;
}

// ------------------------------------------------------------- one parcel

/** erpParcelPreview (ERP:6098) */
export async function erpParcelPreview(ctx, payload) {
  const invoiceNo = str(payload && payload.invoiceNo);
  if (!invoiceNo) throw new Error('Which invoice?');
  const inv = await outstanding(ctx, invoiceNo);
  if (!inv) throw new Error('No invoice called ' + invoiceNo + '.');

  const booked = (await sfBooked(ctx))[invoiceNo] || null;
  const missing = [];
  if (!inv.customer) missing.push('customer name');
  if (String(inv.phone || '').replace(/\D/g, '').length < 10) missing.push('phone number');
  if (!inv.address) missing.push('address');
  const k = await sfKeys(ctx);
  return {
    invoiceNo, customer: inv.customer, phone: inv.phone, address: inv.address,
    total: inv.grand, received: inv.paid, collect: inv.owed,
    missing, ready: !missing.length && !booked,
    alreadyBooked: booked ? booked.consignment : '',
    hasKeys: !!(k.key && k.secret),
  };
}

/** erpBookParcel (ERP:6128) */
export async function erpBookParcel(ctx, payload) {
  payload = payload || {};
  const invoiceNo = str(payload.invoiceNo);
  if (!invoiceNo) throw new Error('Which invoice?');
  // Fix (docs/fixes/courier.md #1): two bookings of one invoice queue here
  // instead of both reaching Steadfast.
  await lock(ctx, 'courier');

  const pre = await erpParcelPreview(ctx, { invoiceNo });
  if (pre.alreadyBooked) {
    throw new Error('Invoice ' + invoiceNo + ' already has a parcel (consignment ' +
                    pre.alreadyBooked + '). Booking it again would send two.');
  }
  if (pre.missing.length) {
    throw new Error('The courier needs a ' + pre.missing.join(', a ') + '. Add it to the invoice first.');
  }
  if (payload.expect !== undefined && payload.expect !== null &&
      Math.abs(num(payload.expect) - pre.collect) > 0.5) {
    throw new Error('The amount changed while you were looking: this parcel would ' +
                    'collect ' + pre.collect.toFixed(0) + ', not ' +
                    num(payload.expect).toFixed(0) + '. Open it again.');
  }

  const toName = str(payload.name) || pre.customer;
  const toPhone = str(payload.phone) || pre.phone;
  const toAddress = str(payload.address) || pre.address;
  if (!toName) throw new Error('The courier needs a name.');
  if (!toAddress) throw new Error('The courier needs an address.');
  if (String(toPhone).replace(/\D/g, '').length < 10) {
    throw new Error('That phone number is too short for the courier.');
  }
  const changed = (toName !== pre.customer) || (toPhone !== pre.phone) || (toAddress !== pre.address);
  const phone = '0' + String(toPhone).replace(/\D/g, '').slice(-10);

  const res = await sfCall(ctx, 'POST', '/create_order', {
    invoice: invoiceNo,
    recipient_name: toName,
    recipient_phone: phone,
    recipient_address: toAddress,
    cod_amount: pre.collect,
    note: str(payload.note),
  });
  if (Number(res.status) !== 200 || !res.consignment) {
    let why = '';
    if (res.errors && typeof res.errors === 'object') {
      for (const f of Object.keys(res.errors)) {
        const v = res.errors[f];
        why = f + ': ' + (v == null ? '' : v[0]);
        break;
      }
    }
    throw new Error('Steadfast would not take it. ' + (why || JSON.stringify(res).slice(0, 200)));
  }

  const cid = String(res.consignment.consignment_id || '');
  await ctx.tx`
    insert into courier_log (business_id, booked_at, invoice_no, consignment_id, customer, phone, address,
                             cod_amount, invoice_total, booked_by, note)
    values (${ctx.biz}, ${new Date()}, ${invoiceNo}, ${cid}, ${toName}, ${toPhone}, ${toAddress},
            ${pre.collect}, ${pre.total}, ${who(ctx)},
            ${(changed ? 'sent to a one-off address. ' : '') + str(payload.note)})`;
  forgetCourier(ctx);
  return { ok: true, invoiceNo, consignment: cid, collect: pre.collect, total: pre.total,
           customer: toName, address: toAddress, changed };
}

/** erpBookedParcels (ERP:6217): parcels booked from here, with what the courier says now. */
export async function erpBookedParcels(ctx) {
  const v = await courierRows(ctx);
  if (!v.length) return { parcels: [], warnings: [] };
  const k = await sfKeys(ctx);
  const haveKeys = !!(k.key && k.secret);
  const pays = await paymentsTab(ctx);
  const out = [], warn = [];

  for (const r of v) {
    const invoiceNo = str(r[1]);
    if (!invoiceNo) continue;
    const cid = str(r[2]);
    const cod = num(r[6]);
    const when = asDate(r[0]);

    let status = '';
    if (cid && haveKeys) {
      try {
        const s = await sfCall(ctx, 'GET', '/status_by_cid/' + encodeURIComponent(cid), null);
        status = String((s && s.delivery_status) || '');
      } catch (_) { status = ''; }
    }

    // money recorded against this invoice AFTER the parcel went out
    let since = 0;
    if (when) {
      for (const p of pays) {
        if (str(p[PAY.order_id]) !== invoiceNo) continue;
        if (/\[sf:/.test(String(p[PAY.note] || ''))) continue;   // the courier's own payment
        const pd = asDate(p[PAY.timestamp]);
        if (pd && pd.getTime() > when.getTime()) since += num(p[PAY.amount]);
      }
    }
    if (cod > 0.5 && since > 0.5 && status !== 'delivered') {
      warn.push({ invoiceNo, consignment: cid, collect: Math.round(cod), paidSince: Math.round(since) });
    }

    const known = Object.prototype.hasOwnProperty.call(ERP_COURIER_WORDS, status) ? ERP_COURIER_WORDS[status] : null;
    out.push({
      invoiceNo, consignment: cid,
      customer: str(r[3]), phone: String(r[4] == null ? '' : r[4]),
      cod: Math.round(cod), total: Math.round(num(r[7])),
      when: when ? formatDate(when, 'd MMM yy') : '',
      courier: status,
      courierLabel: known ? known.label : (status || (haveKeys ? 'No answer yet' : 'Keys not set')),
      tone: known ? known.tone : 'info',
      paidSince: Math.round(since),
    });
  }
  out.reverse();
  return { parcels: out, warnings: warn, hasKeys: haveKeys };
}

/** erpParcelHandled (ERP:6482): off the to-send list without booking anything. */
export async function erpParcelHandled(ctx, payload) {
  payload = payload || {};
  const invoiceNo = str(payload.invoiceNo);
  if (!invoiceNo) throw new Error('Which invoice?');
  const inv = await outstanding(ctx, invoiceNo);
  if (!inv) throw new Error('No invoice called ' + invoiceNo + '.');
  await lock(ctx, 'courier');
  if ((await sfBooked(ctx))[invoiceNo]) throw new Error('Invoice ' + invoiceNo + ' is already off the list.');

  const cid = String(payload.consignment == null ? '' : payload.consignment).replace(/\s+/g, '');
  const why = str(payload.note);
  const cod = cid ? inv.owed : 0;
  await ctx.tx`
    insert into courier_log (business_id, booked_at, invoice_no, consignment_id, customer, phone, address,
                             cod_amount, invoice_total, booked_by, note)
    values (${ctx.biz}, ${new Date()}, ${invoiceNo}, ${cid}, ${inv.customer}, ${inv.phone}, ${inv.address},
            ${cod}, ${inv.grand}, ${who(ctx)},
            ${(cid ? 'booked outside the ERP. ' : 'no parcel needed. ') + (why ? why + ' ' : '') + '[by hand]'})`;
  forgetCourier(ctx);
  return { ok: true, invoiceNo, consignment: cid, tracked: !!cid };
}

/** erpParcelPutBack (ERP:6516): only rows a person set aside. */
export async function erpParcelPutBack(ctx, payload) {
  const invoiceNo = str(payload && payload.invoiceNo);
  if (!invoiceNo) throw new Error('Which invoice?');
  await lock(ctx, 'courier');
  const b = (await sfBooked(ctx))[invoiceNo];
  if (!b) throw new Error('Invoice ' + invoiceNo + ' is not set aside.');
  if (!b.byHand) {
    throw new Error('That parcel was booked with Steadfast (consignment ' +
                    b.consignment + '). Cancel it in their portal first.');
  }
  await ctx.tx`delete from courier_log where business_id = ${ctx.biz} and id = ${b.row}`;
  forgetCourier(ctx);
  return { ok: true, invoiceNo };
}

// ------------------------------------------------------------- payouts

/** erpSfPayoutList_: every payout Steadfast lists, as it lists them. */
async function payoutList(ctx) {
  let all = [];
  for (let page = 1; page <= 30; page++) {
    const r = await sfCall(ctx, 'GET', '/payments?page=' + page, null);
    const list = (r && r.payments) || [];
    if (!list.length) break;
    all = all.concat(list);
    if (list.length < 10) break;
  }
  return all;
}

/** erpSfInvoiceIndex_: which invoice each consignment belongs to. */
async function invoiceIndex(ctx) {
  const byCid = {}, byPhone = {};
  try {
    const booked = await sfBooked(ctx);
    for (const inv of Object.keys(booked)) {
      if (booked[inv].consignment) byCid[String(booked[inv].consignment)] = inv;
    }
  } catch (_) { /* as original */ }
  const web = {}, seen = {};
  for (const r of await salesLog(ctx)) {
    const id = str(r[SL.order_id]);
    if (!id || /^RTN-/.test(id) || seen[id]) continue;
    seen[id] = true;
    const m = /WEB-(\S+)/.exec(String(r[SL.notes] || ''));
    if (m) web[m[1]] = id;
    const key = custKey(String(r[SL.customer_contact] || ''), String(r[SL.customer_name] || ''));
    if (key && key.indexOf('n:') !== 0) {
      (byPhone[key] = byPhone[key] || []).push({ id, when: asDate(r[SL.timestamp]) });
    }
  }
  // website orders: the website knows their consignment numbers
  try {
    const w = await czFetch(ctx, '/cod?days=120&limit=200');
    ((w && w.orders) || []).forEach((o) => {
      if (o.consignment && web[String(o.order_no)]) byCid[String(o.consignment)] = web[String(o.order_no)];
    });
  } catch (_) { /* as original */ }
  return { byCid, byPhone };
}

/** erpSfPick_ */
function sfPick(c, names) {
  for (const n of names) {
    if (c && c[n] !== undefined && c[n] !== null && c[n] !== '') return num(c[n]);
  }
  return null;    // the sheet's blank cell
}

/** erpSfPayoutSync_ (ERP:8515): fetch the paid payouts not kept yet. */
async function payoutSync(ctx) {
  const list = await payoutList(ctx);
  const have = {};
  for (const r of await payoutRows(ctx)) have[String(r[0])] = true;
  const fresh = list.filter((p) => p && p.payment_id && !have[String(p.payment_id)] &&
    String(p.status_label || '').toLowerCase() === 'paid');
  if (!fresh.length) return { added: 0, list };

  const index = await invoiceIndex(ctx);
  const now = new Date();
  let added = 0;
  for (const p of fresh) {
    const d = await sfCall(ctx, 'GET', '/payments/' + encodeURIComponent(p.payment_id), null);
    const pay = (d && d.payment) || null;
    if (!pay) continue;
    const lines = (pay.consignments || []).map((c) => {
      const cid = String(c.consignment_id == null ? '' : c.consignment_id);
      let inv = index.byCid[cid] || '', how = inv ? 'exact' : '';
      if (!inv) {
        // booked by hand: the same customer's invoice from before the parcel
        const key = custKey(String(c.recipient_phone || ''), '');
        const cands = (index.byPhone[key] || []).filter((x) =>
          !c.created_at || !x.when || x.when.getTime() <= sfDate(c.created_at).getTime() + 86400000);
        if (cands.length) {
          cands.sort((a, b) => (b.when ? b.when.getTime() : 0) - (a.when ? a.when.getTime() : 0));
          inv = cands[0].id; how = 'phone';
        }
      }
      return [String(pay.payment_id), cid, String(c.tracking_code || ''), num(c.cod_amount),
        String(c.status || ''), String(c.recipient_name || ''), String(c.recipient_phone || ''),
        String(c.created_at || '').slice(0, 10), inv, how,
        sfPick(c, ['delivery_charge', 'delivery_fee', 'shipping_charge', 'charge']),
        sfPick(c, ['cod_charge', 'cod_fee', 'cod_charges'])];
    });
    const seenF = (pay.consignments && pay.consignments[0]) ? Object.keys(pay.consignments[0]).join(',') : '';
    for (const l of lines) {
      await ctx.tx`
        insert into courier_payout_lines (business_id, payout_id, consignment_id, tracking_code, cod_amount,
          status, recipient_name, recipient_phone, parcel_created, invoice_no, match, delivery_charge, cod_charge)
        values (${ctx.biz}, ${l[0]}, ${l[1]}, ${l[2]}, ${l[3]}, ${l[4]}, ${l[5]}, ${l[6]}, ${l[7]},
                ${l[8]}, ${l[9]}, ${l[10]}, ${l[11]})`;
    }
    await ctx.tx`
      insert into courier_payouts (business_id, payout_id, created_src, paid_at, cod_collected, delivery_charges,
                                   cod_fee, paid_to_bank, parcels, synced_at, fields_seen, account_id)
      values (${ctx.biz}, ${String(pay.payment_id)}, ${String(pay.created_at || '')}, ${String(pay.paid_at || '')},
              ${num(pay.amount)}, ${num(pay.due_bills)}, ${num(pay.charges)}, ${num(pay.total)},
              ${lines.length}, ${now}, ${seenF}, ${(await cashRules(ctx)).payout || null})`;
    added++;
  }
  return { added, list };
}

/**
 * erpSfRecordPaid_ (ERP:8596): settle delivered parcels against their
 * invoices and check each one, once.
 */
async function recordPaid(ctx, items) {
  const now = new Date(), by = who(ctx);
  const prior = {};
  for (const r of await paymentsTab(ctx)) {
    const m = /\[sf:([^\]]+)\]/.exec(String(r[PAY.note] || ''));
    if (m) prior[m[1]] = (prior[m[1]] || 0) + num(r[PAY.amount]);
  }
  const done = await reconDone(ctx), names = {}, owed = await owedMap(ctx, names);
  const st = stamp(now);
  let n = 0, total = 0, k = 0;
  const out = [], tally = { ok: 0, writeoff: 0, review: 0, extra: 0, settled: 0 };
  const r2 = (v) => Math.round(v * 100) / 100;

  for (const it of items) {
    const cid = String(it.consignment || ''), inv = String(it.invoice || '');
    if (!inv || !cid || done[cid] || owed[inv] === undefined) continue;
    const had = prior[cid] || 0, got = r2(num(it.amount));
    let owe = owed[inv] || 0;
    const expected = r2(owe + had);
    let action = 'ok', amount = 0, note = '', gap = 0;

    if (expected <= 0.5) {
      // nothing was owed and nothing was recorded for this parcel: closed some other way, earlier
      if (got > 0.5) { action = 'settled'; note = 'the invoice was already closed before this payout was read'; }
    } else {
      const add = r2(Math.min(expected, got) - had);
      if (add > 0.5) {
        await addPayment(ctx, { id: 'S' + st + '-' + (k++), order: inv, customer: names[inv] || '', at: now,
          amount: add, method: 'COD (Steadfast)',
          note: 'paid out by Steadfast in ' + it.payout + ' [payment] [sf:' + cid + ']', by });
        n++; total += add; owe = r2(owe - add);
      }
      gap = r2(expected - got);
      if (Math.abs(gap) <= 0.5) { gap = 0; }
      else if (gap > 0 && gap <= ERP_SF_AUTO_WRITEOFF) {
        await addPayment(ctx, { id: 'A' + st + '-' + (k++), order: inv, customer: names[inv] || '', at: now,
          amount: gap, method: 'Adjusted',
          note: 'Steadfast collected ' + got + ', the invoice expected ' + expected +
                ' - the courier figure stands [reduce] [sfadj:' + cid + ']', by });
        owe = r2(owe - gap); action = 'writeoff'; amount = gap;
      }
      else if (gap > 0) { action = 'review'; amount = gap; }
      else { action = 'extra'; amount = -gap; }
    }
    owed[inv] = Math.max(0, owe);
    done[cid] = action; tally[action]++;
    out.push([cid, String(it.payout || ''), inv, names[inv] || '', expected, got, gap, action, amount, note, now, by]);
    if (action !== 'settled') await attempt(ctx, () => syncInvoiceStatus(ctx, inv));
  }
  for (const o of out) {
    await ctx.tx`
      insert into courier_recon (business_id, consignment_id, payout_id, invoice_no, customer, expected,
                                 collected, gap, action, amount, note, at, by)
      values (${ctx.biz}, ${o[0]}, ${o[1]}, ${o[2]}, ${o[3]}, ${o[4]}, ${o[5]}, ${o[6]}, ${o[7]}, ${o[8]},
              ${o[9]}, ${o[10]}, ${o[11]})`;
  }
  return { recorded: n, amount: Math.round(total), checked: out.length, tally };
}

/** erpSfNightInfo_ */
async function nightInfo(ctx) {
  try {
    const n = JSON.parse((await getConfig(ctx, 'sf_night', '')) || 'null');
    if (!n || !n.at) return null;
    return { when: formatDate(new Date(n.at), 'd MMM, h:mm a'), added: n.added || 0,
             recorded: n.recorded || 0, error: n.error || '' };
  } catch (_) { return null; }
}

/** erpSfPayoutsCore_ (ERP:8707): read new payouts, check every parcel, say what is left. */
async function payoutsCore(ctx) {
  const k = await sfKeys(ctx);
  if (!k.key || !k.secret) return { noKeys: true, payouts: [], pending: [], waiting: [] };

  await lock(ctx, 'courier');
  await lock(ctx, 'payments');
  const sync = await payoutSync(ctx);
  // exact matches from Steadfast's own record: the invoice is paid, no question
  const lines = await lineRows(ctx);
  const exact = [], checked = await reconDone(ctx);
  for (const l of lines) {
    if (String(l[9]) === 'exact' && /deliver/i.test(String(l[4])) && !checked[String(l[1])]) {
      exact.push({ invoice: String(l[8]), consignment: String(l[1]), amount: num(l[3]), payout: String(l[0]) });
    }
  }
  const auto = await recordPaid(ctx, exact);

  // booked by hand: phone AND amount agree with one unpaid invoice -> that is the parcel
  const owedA = await owedMap(ctx), seenA = await reconDone(ctx), sure = [], taken = {};
  for (const l of lines) {
    const cidA = String(l[1]), invA = String(l[8] || ''), codA = num(l[3]);
    if (String(l[9]) !== 'phone' || !invA || seenA[cidA] || taken[invA] || !/deliver/i.test(String(l[4]))) continue;
    if (!(codA > 0.5) || Math.abs((owedA[invA] || 0) - codA) > 0.5) continue;
    taken[invA] = true;
    sure.push({ invoice: invA, consignment: cidA, amount: codA, payout: String(l[0]) });
  }
  if (sure.length) {
    const autoB = await recordPaid(ctx, sure);
    auto.recorded += autoB.recorded; auto.amount += autoB.amount; auto.checked = (auto.checked || 0) + autoB.checked;
    auto.byPhone = autoB.recorded;
  }

  // ---- the payouts, newest first ----
  const rows = await payoutRows(ctx), lines2 = await lineRows(ctx);
  const inPayout = {}, matchedBy = {};
  for (const l of lines2) {
    inPayout[String(l[1])] = String(l[0]);
    const p = matchedBy[String(l[0])] || (matchedBy[String(l[0])] = { exact: 0, phone: 0, none: 0 });
    const m = String(l[9]) || 'none';
    p[m] = (p[m] || 0) + 1;
  }
  const delOf = {};
  for (const r of await salesLog(ctx)) {
    const did = str(r[SL.order_id]);
    if (did) delOf[did] = Math.max(delOf[did] || 0, num(r[SL.delivery_charge]));
  }
  const charged = {}, counted = {};
  for (const l of lines2) {
    const pid = String(l[0]), iv = String(l[8] || '');
    if (!iv || counted[pid + '|' + iv]) continue;
    counted[pid + '|' + iv] = true;
    const c = charged[pid] || (charged[pid] = { sum: 0, n: 0 });
    c.sum += delOf[iv] || 0; c.n++;
  }
  const payouts = rows.map((r) => {
    const ch = charged[String(r[0])] || { sum: 0, n: 0 };
    return { id: String(r[0]), paidAt: String(r[2] || r[1]).slice(0, 10), collected: num(r[3]),
             delivery: num(r[4]), fee: num(r[5]), paid: num(r[6]), parcels: num(r[7]),
             charged: Math.round(ch.sum), chargedOn: ch.n,
             matched: matchedBy[String(r[0])] || { exact: 0, phone: 0, none: 0 } };
  }).reverse();

  // ---- the check of every parcel against its invoice ----
  const recon = { ok: 0, settled: 0, writeoff: 0, writeoffSum: 0, extra: 0, extraSum: 0, kept: 0, review: [], list: [],
                  limit: ERP_SF_AUTO_WRITEOFF };
  for (const r of await reconRows(ctx)) {
    const a = String(r[7]);
    const row = { consignment: String(r[0]), payout: String(r[1]), invoice: String(r[2]), customer: String(r[3]),
      expected: Math.round(num(r[4])), collected: Math.round(num(r[5])), action: a, amount: Math.round(num(r[8])) };
    if (a === 'review') recon.review.push(row);
    else if (a === 'writeoff') { recon.writeoff++; recon.writeoffSum += row.amount; recon.list.push(row); }
    else if (a === 'extra') { recon.extra++; recon.extraSum += row.amount; recon.list.push(row); }
    else if (a === 'kept') { recon.kept++; recon.list.push(row); }
    else if (a === 'settled') recon.settled++;
    else recon.ok++;
  }
  recon.list = recon.list.reverse().slice(0, 60);
  const coming = (sync.list || []).filter((p) => String(p.status_label || '').toLowerCase() !== 'paid')
    .map((p) => ({ id: String(p.payment_id), status: String(p.status_label || ''), paid: num(p.total),
                   collected: num(p.amount) }));

  // ---- phone matches waiting for a person to confirm ----
  const paidTag = {};
  for (const r of await paymentsTab(ctx)) {
    const m = /\[sf:([^\]]+)\]/.exec(String(r[PAY.note] || ''));
    if (m) paidTag[m[1]] = true;
  }
  const pending = [], owedNow = await owedMap(ctx);
  for (const l of lines2) {
    if (String(l[9]) !== 'phone' || paidTag[String(l[1])] || !/deliver/i.test(String(l[4]))) continue;
    const owed = owedNow[String(l[8])] || 0;
    if (!(owed > 0.5)) continue;
    pending.push({ payout: String(l[0]), consignment: String(l[1]), cod: num(l[3]), customer: String(l[5]),
                   phone: String(l[6]), invoice: String(l[8]), owed: Math.round(owed) });
  }

  // ---- parcels the ERP booked that are not in any payout yet ----
  const waiting = [];
  try {
    const booked = await sfBooked(ctx);
    for (const inv of Object.keys(booked)) {
      const b = booked[inv];
      if (!b.consignment || inPayout[b.consignment]) continue;
      waiting.push({ invoice: inv, consignment: b.consignment, cod: Math.round(b.cod || 0), customer: b.customer,
                     booked: b.when ? formatDate(b.when, 'd MMM') : '' });
    }
  } catch (_) { /* as original */ }

  const t = { collected: 0, delivery: 0, fee: 0, paid: 0, charged: 0 };
  payouts.forEach((p) => { t.collected += p.collected; t.delivery += p.delivery; t.fee += p.fee; t.paid += p.paid; t.charged += p.charged; });
  let balance = null;
  try { balance = await sfBalance(ctx); } catch (_) { /* as original */ }
  const waitingCod = waiting.reduce((s, w) => s + w.cod, 0);
  return { payouts, coming, pending, waiting, totals: t,
           balance, waitingCod, added: sync.added, recon, night: await nightInfo(ctx),
           autoRecorded: auto.recorded, autoAmount: auto.amount, autoChecked: auto.checked || 0 };
}

/** erpSfPayouts (ERP:8695) */
export async function erpSfPayouts(ctx) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Your account cannot see courier money.');
  return payoutsCore(ctx);
}

/** erpSfPayoutLines (ERP:8857): the parcels inside one payout. */
export async function erpSfPayoutLines(ctx, payload) {
  const id = String((payload && payload.payoutId) || '');
  const chk = {};
  for (const r of await reconRows(ctx)) {
    chk[String(r[0])] = { action: String(r[7]), expected: Math.round(num(r[4])), amount: Math.round(num(r[8])) };
  }
  return { payoutId: id, lines: (await lineRows(ctx)).filter((l) => String(l[0]) === id).map((l) => {
    const c = chk[String(l[1])] || null;
    return { consignment: String(l[1]), cod: num(l[3]), status: String(l[4]), customer: String(l[5]),
             phone: String(l[6]), created: String(l[7]), invoice: String(l[8]), match: String(l[9]),
             delivery: l[10] === null || l[10] === '' ? null : num(l[10]),
             codFee: l[11] === null || l[11] === '' ? null : num(l[11]),
             check: c ? c.action : '', expected: c ? c.expected : null, gap: c ? c.amount : 0 };
  }) };
}

/** erpSfConfirmMatches (ERP:8875): a person confirms phone matches. */
export async function erpSfConfirmMatches(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Your account cannot record payments.');
  const want = {};
  ((payload && payload.consignments) || []).forEach((c) => { want[String(c)] = true; });
  const items = (await lineRows(ctx)).filter((l) => want[String(l[1])] && String(l[9]) === 'phone')
    .map((l) => ({ invoice: String(l[8]), consignment: String(l[1]), amount: num(l[3]), payout: String(l[0]) }));
  if (!items.length) throw new Error('Nothing to confirm.');
  await lock(ctx, 'courier');
  await lock(ctx, 'payments');
  return recordPaid(ctx, items);
}

/** erpSfReconDecide (ERP:8650): the owner's word on a large shortfall. */
export async function erpSfReconDecide(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder can decide this.');
  const cid = String((payload && payload.consignment) || ''), what = String((payload && payload.decision) || '');
  if (what !== 'writeoff' && what !== 'keep') throw new Error('Write it off, or keep it as due?');
  await lock(ctx, 'courier');
  await lock(ctx, 'payments');
  const rows = await reconRows(ctx);
  const r = rows.find((x) => String(x[0]) === cid && String(x[7]) === 'review');
  if (!r) throw new Error('That parcel is not waiting for a decision.');
  const inv = String(r[2]), now = new Date(), by = who(ctx);
  let amount = 0;
  if (what === 'writeoff') {
    const owe = (await owedMap(ctx))[inv] || 0;
    amount = Math.round(Math.min(owe, num(r[8])) * 100) / 100;
    if (amount > 0.5) {
      await addPayment(ctx, { id: 'A' + stamp(now), order: inv, customer: String(r[3]), at: now, amount,
        method: 'Adjusted',
        note: 'Steadfast collected ' + num(r[5]) + ', the invoice expected ' + num(r[4]) +
              ' - written off by ' + by + ' [reduce] [sfadj:' + cid + ']', by });
    }
  }
  await ctx.tx`
    update courier_recon set
      action = ${what === 'writeoff' ? 'writeoff' : 'kept'},
      amount = ${what === 'writeoff' ? amount : num(r[8])},
      note = ${what === 'writeoff' ? 'written off by hand' : 'kept as due: the customer still owes it'},
      at = ${now}, by = ${by}
    where business_id = ${ctx.biz} and id = ${r[12]}`;
  await attempt(ctx, () => syncInvoiceStatus(ctx, inv));
  return { ok: true, consignment: cid, decision: what, amount };
}

// ------------------------------------------------- for other groups

/**
 * erpSfNightly_ (ERP:11037) for the current business: read new payouts and
 * check parcels with nobody watching; the note goes to business_config
 * 'sf_night' for the dashboard. A business without keys is left alone.
 */
export async function sfNightly(ctx) {
  const note = { at: Date.now() };
  const k = await sfKeys(ctx);
  if (!k.key || !k.secret) return null;          // this business does not use Steadfast
  try {
    const r = await ctx.tx.savepoint(() => payoutsCore(ctx));
    note.added = r.added || 0; note.recorded = r.autoRecorded || 0; note.amount = r.autoAmount || 0;
    note.review = (r.recon && r.recon.review.length) || 0; note.pending = (r.pending || []).length;
  } catch (e) {
    for (const m of Object.keys(ctx.memo)) delete ctx.memo[m];   // rolled back: forget what was read
    note.error = String((e && e.message) || e).slice(0, 300);
  }
  await setConfig(ctx, 'sf_night', JSON.stringify(note));
  return note;
}

/** erpSfNeeds_ (ERP:11070): what about courier money needs a person - for the dashboard. */
export async function sfNeeds(ctx) {
  const out = { review: 0, pending: 0, error: '' };
  try {
    for (const r of await reconRows(ctx)) if (String(r[7]) === 'review') out.review++;
    const phone = (await lineRows(ctx)).filter((l) =>
      String(l[9]) === 'phone' && /deliver/i.test(String(l[4])) && String(l[8] || ''));
    if (phone.length) {
      const done = await reconDone(ctx), owed = await owedMap(ctx);
      phone.forEach((l) => { if (!done[String(l[1])] && (owed[String(l[8])] || 0) > 0.5) out.pending++; });
    }
    const n = await nightInfo(ctx);
    if (n && n.error) out.error = n.error;
  } catch (_) { /* as original */ }
  return out;
}

// ------------------------------------------------- delivered parcels (sheet build b261003-0358)
//
// The due of a parcel is cleared the moment the courier says "delivered",
// not days later when the payout arrives. It can only be done for a parcel
// this system can name: one booked from here, one whose consignment number
// was typed onto its invoice, or a website order (the website knows its
// parcels). A parcel that came back, or was only part delivered, is never
// guessed at: it is listed for a person.

/**
 * erpWebAlignTotal_: an invoice typed by hand for a website order holds the
 * goods alone; the website charged delivery and a cash-handling fee on top.
 * The difference is written onto the invoice as its delivery charge. Only
 * ever raises an invoice that has no delivery charge yet, and only by a
 * believable amount.
 */
async function webAlignTotal(ctx, invoiceNo, orderTotal, orderNo) {
  orderTotal = round2(num(orderTotal));
  if (!(orderTotal > 0)) return 0;
  const inv = (await ctx.tx`select id, grand_total, delivery_charge, advance_paid, cancelled_at from invoices
                            where business_id = ${ctx.biz} and invoice_no = ${invoiceNo} limit 1`)[0];
  if (!inv || inv.cancelled_at) return 0;
  const grand = num(inv.grand_total), del = num(inv.delivery_charge), adv = num(inv.advance_paid);
  const gap = round2(orderTotal - grand);
  if (del > 0.5 || !(gap > 0.5) || gap > 600) return 0;
  await ctx.tx`update invoices set delivery_charge = ${gap}, grand_total = ${orderTotal},
                 due_amount = ${Math.max(0, round2(orderTotal - adv))} where id = ${inv.id}`;
  await ctx.tx`insert into invoice_fixes (business_id, fixed_at, invoice_no, field, was, now, fixed_by)
               values (${ctx.biz}, now(), ${invoiceNo}, 'delivery charge', '0',
                       ${gap + ' - delivery and cash handling fee the website charged on order ' + (orderNo || '') +
                         ' (invoice total ' + grand + ' -> ' + orderTotal + ')'}, 'Website order')`;
  forget(ctx, 'SALES_LOG');
  return gap;
}

/** erpDeliveredCollect_: every delivered parcel that can be named - record the customer's payment and clear the due. */
export async function deliveredCollect(ctx) {
  const out = { checked: 0, collected: [], back: [], part: [], raised: [], errors: [], seen: [] };
  const parcels = {};

  // 1. parcels this system booked, or whose number was typed onto the invoice
  const booked = await sfBooked(ctx);
  for (const inv of Object.keys(booked)) {
    if (booked[inv].consignment) parcels[String(booked[inv].consignment)] = { inv, cod: booked[inv].cod, how: 'log', status: '' };
  }
  // 2. website orders: the website knows their parcels and what the courier says
  const web = {};
  for (const r of await salesLog(ctx)) {
    const m = /WEB-(\S+)/.exec(String(r[SL.notes] || '')), id = str(r[SL.order_id]);
    if (m && id && !/^RTN-/.test(id)) web[m[1]] = id;
  }
  if (Object.keys(web).length) {
    try {
      const site = await czFetch(ctx, '/cod?days=60&limit=200');
      for (const o of (site && site.orders) || []) {
        const wi = web[String(o.order_no || '')], cid = String(o.consignment || '');
        if (!wi || !cid) continue;
        parcels[cid] = { inv: wi, cod: num(o.cod_amount), how: 'web', status: String(o.courier || '').toLowerCase(),
                         total: num(o.total), orderNo: String(o.order_no || ''), isCod: /cash on delivery|\bcod\b/i.test(String(o.method || '')) };
      }
    } catch (e) { out.errors.push('The website did not answer: ' + String((e && e.message) || e).slice(0, 120)); }
  }

  // parcels already counted - by an earlier delivery, or by a payout
  const prior = {};
  for (const r of await paymentsTab(ctx)) {
    const pm = /\[sf:([^\]]+)\]/.exec(String(r[PAY.note] || ''));
    if (pm) prior[pm[1]] = true;
  }
  let done = {};
  try { done = await reconDone(ctx); } catch (_) { done = {}; }
  let haveKeys = false;
  try { const k = await sfKeys(ctx); haveKeys = !!(k.key && k.secret); } catch (_) { haveKeys = false; }
  const names = {};
  let owed = await owedMap(ctx, names);
  const now = new Date(), st = stamp(now);
  let k = 0;

  for (const cid of Object.keys(parcels)) {
    const p = parcels[cid];
    if (prior[cid] || done[cid] || owed[p.inv] === undefined) continue;
    // a website order's invoice typed by hand: bring it up to what the website charged, first
    if (p.how === 'web' && p.isCod) {
      try {
        const up = await ctx.tx.savepoint(() => webAlignTotal(ctx, p.inv, p.total, p.orderNo));
        if (up > 0) { owed[p.inv] = round2(owed[p.inv] + up); out.raised.push({ invoice: p.inv, by: up }); }
      } catch (_) { /* as original */ }
    }
    if (!(owed[p.inv] > 0.5) || !(p.cod > 0.5)) continue;          // nothing owed, or nothing the rider was to collect
    let status = p.status;
    if (!status && haveKeys) {
      try { status = String(((await sfCall(ctx, 'GET', '/status_by_cid/' + encodeURIComponent(cid), null)) || {}).delivery_status || '').toLowerCase(); }
      catch (_) { status = ''; }
    }
    out.checked++;
    if (out.seen.length < 60) out.seen.push(p.inv + ' ' + cid + ' ' + (status || 'no answer') + (p.how === 'web' ? ' (website)' : ''));
    const who1 = { invoice: p.inv, consignment: cid, customer: names[p.inv] || '' };
    if (status === 'delivered') {
      const amount = round2(Math.min(owed[p.inv], p.cod));
      await addPayment(ctx, { id: 'D' + st + '-' + (k++), order: p.inv, customer: names[p.inv] || '', at: now, amount,
        method: 'COD (Steadfast)',
        note: 'delivered - collected by the rider, with Steadfast until they pay out [payment] [sf:' + cid + ']', by: 'Courier' });
      owed[p.inv] = Math.max(0, round2(owed[p.inv] - amount));
      try { await ctx.tx.savepoint(() => syncInvoiceStatus(ctx, p.inv)); } catch (_) { /* as original */ }
      who1.amount = amount; out.collected.push(who1);
    } else if (status === 'cancelled' || status === 'returned') { who1.status = status; who1.owed = owed[p.inv]; out.back.push(who1); }
    else if (status === 'partial_delivered') { who1.status = status; who1.owed = owed[p.inv]; out.part.push(who1); }
  }
  return out;
}

/** erpDeliveredNote_: every round is written down, and the last one kept for the dashboard. */
async function deliveredNote(ctx, r) {
  let amt = 0;
  r.collected.forEach((x) => { amt += x.amount; });
  try {
    await ctx.tx.savepoint(() => ctx.tx`
      insert into delivery_checks (business_id, by, asked, collected, amount, raised, came_back, part, problem, said)
      values (${ctx.biz}, ${who(ctx) || 'Timer'}, ${r.checked}, ${r.collected.map((x) => x.invoice).join(', ')}, ${amt},
              ${r.raised.map((x) => x.invoice + ' +' + x.by).join(', ')}, ${r.back.map((x) => x.invoice).join(', ')},
              ${r.part.map((x) => x.invoice).join(', ')}, ${(r.errors || []).join(' ')}, ${(r.seen || []).join(' | ').slice(0, 3000)})`);
    await ctx.tx.savepoint(() => ctx.tx`
      delete from delivery_checks where business_id = ${ctx.biz} and id < (
        select id from delivery_checks where business_id = ${ctx.biz} order by id desc offset 800 limit 1)`);
  } catch (_) { /* the log is never the reason a check fails */ }
  await setConfig(ctx, 'sf_deliv', JSON.stringify({ at: Date.now(), collected: r.collected.length, back: r.back.length,
                                                    part: r.part.length, error: (r.errors || []).join(' ') }));
}

/** erpCheckDeliveries: ask now, from the Sales screen, instead of waiting for the hour. */
export async function erpCheckDeliveries(ctx) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Your account cannot record payments.');
  await lock(ctx, 'courier-delivered');
  const r = await deliveredCollect(ctx);
  await deliveredNote(ctx, r);
  return r;
}

/** erpDeliveryTick: the hourly visit, for a business that uses the courier or the website. */
export async function deliveryTick(ctx) {
  await lock(ctx, 'courier-delivered');
  const r = await deliveredCollect(ctx);
  await deliveredNote(ctx, r);
  return { checked: r.checked, collected: r.collected.length, back: r.back.length, part: r.part.length, error: (r.errors || []).join(' ') };
}

/** Parcels that came back or were only part delivered at the last check - for the dashboard. */
export async function deliveryBack(ctx) {
  try {
    const dn = JSON.parse(String(await getConfig(ctx, 'sf_deliv', '')) || 'null');
    return dn ? (num(dn.back) + num(dn.part)) : 0;
  } catch (_) { return 0; }
}

/**
 * erpExpressLink: a parcel booked in Steadfast's own panel - Express is,
 * their API cannot make one - is tied to its invoice by the consignment
 * number Steadfast gave it. From then on it is a parcel like any other here.
 * Steadfast is asked whether it knows the number; a silence is not treated
 * as a no.
 */
export async function erpExpressLink(ctx, payload) {
  payload = payload || {};
  const invoiceNo = str(payload.invoiceNo);
  const cid = String(payload.consignment || '').replace(/\s+/g, '').trim();
  if (!invoiceNo) throw new Error('Which invoice?');
  if (!/^[A-Za-z0-9-]{4,24}$/.test(cid)) throw new Error('That does not look like a consignment number. It is the number Steadfast gives the parcel, usually 8 or 9 digits.');
  const inv = await outstanding(ctx, invoiceNo);
  if (!inv) throw new Error('No invoice called ' + invoiceNo + '.');

  await lock(ctx, 'courier');
  forgetCourier(ctx);
  const booked = await sfBooked(ctx);
  if (booked[invoiceNo] && booked[invoiceNo].consignment) {
    throw new Error('Invoice ' + invoiceNo + ' already has a parcel: consignment ' + booked[invoiceNo].consignment + '.');
  }
  for (const other of Object.keys(booked)) {
    if (String(booked[other].consignment) === cid) throw new Error('Consignment ' + cid + ' is already on invoice ' + other + '. One parcel, one invoice.');
  }
  // what Steadfast says about it, if it answers
  let status = '', asked = false;
  try {
    const k = await sfKeys(ctx);
    if (k.key && k.secret) {
      asked = true;
      const r = await sfCall(ctx, 'GET', '/status_by_cid/' + encodeURIComponent(cid), null);
      status = String((r && r.delivery_status) || '');
    }
  } catch (_) { status = ''; }
  if (booked[invoiceNo]) {                                           // was set aside by hand with no number: now it has one
    await ctx.tx`update courier_log set consignment_id = ${cid}, cod_amount = ${inv.owed} where id = ${booked[invoiceNo].row} and business_id = ${ctx.biz}`;
  } else {
    await ctx.tx`
      insert into courier_log (business_id, booked_at, invoice_no, consignment_id, customer, phone, address,
                               cod_amount, invoice_total, booked_by, note)
      values (${ctx.biz}, ${new Date()}, ${invoiceNo}, ${cid}, ${inv.customer}, ${inv.phone}, ${inv.address},
              ${inv.owed}, ${inv.grand}, ${who(ctx)},
              ${(payload.express === false ? '[panel]' : '[express]') + ' booked in the Steadfast panel'})`;
  }
  forgetCourier(ctx);
  const known = Object.prototype.hasOwnProperty.call(ERP_COURIER_WORDS, status) ? ERP_COURIER_WORDS[status] : null;
  return { ok: true, invoiceNo, consignment: cid, collect: inv.owed, asked, found: !!status, status, statusLabel: known ? known.label : status };
}

/** erpSfChargesByMonth_ (ERP:8894): delivery + COD fee per payout month - for the P&L. */
export async function sfChargesByMonth(ctx) {
  const out = {};
  for (const r of await payoutRows(ctx)) {
    const m = String(r[2] || r[1]).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) continue;
    out[m] = (out[m] || 0) + num(r[4]) + num(r[5]);
  }
  return out;
}

/** erpSfReconByMonth_ (ERP:8682): extras and write-offs by the month checked - for the P&L. */
export async function sfReconByMonth(ctx) {
  const out = {};
  for (const r of await reconRows(ctx)) {
    const d = asDate(r[10]);
    if (!d) continue;
    const m = formatDate(d, 'yyyy-MM'), o = out[m] || (out[m] = { extra: 0, short: 0 });
    if (String(r[7]) === 'extra') o.extra += num(r[8]);
    if (String(r[7]) === 'writeoff') o.short += num(r[8]);
  }
  return out;
}

export const HANDLERS = {
  erpParcelPreview, erpBookParcel, erpParcelHandled, erpParcelPutBack, erpBookedParcels,
  erpSfPayouts, erpSfPayoutLines, erpSfConfirmMatches, erpSfReconDecide,
  erpCourierKeyStatus, erpCourierSetKeys, erpCourierTest,
  erpExpressLink, erpCheckDeliveries,
};
