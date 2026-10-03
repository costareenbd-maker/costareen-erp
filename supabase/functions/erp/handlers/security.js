// Settings > Security, and a company for a partner. Redesign phase 5.
//
//   erpSecurity()            the activity log of this business (owner only)
//   erpPartnerCompany({...}) a separate company with its own owner login, for a
//                            partner. The owner of THIS business is not let
//                            into it: the partner's books are the partner's.

import { formatDate } from '../lib/time.js';
import { setConfig } from '../lib/ext.js';
import { SEED_LISTS } from './settings.js';
import { keyHash, newKey } from './access.js';

const str = (v) => String(v == null ? '' : v).trim();

// what an action is called on the screen; anything not here is spelled out from its name
const WORDS = {
  'sign-in': 'Opened the app',
  erpCreateInvoice: 'Saved an invoice', erpCancelInvoice: 'Cancelled a sale', erpVoidInvoice: 'Cancelled a sale',
  erpFixInvoice: 'Changed an invoice', erpReturnGoods: 'Took goods back', erpSettleDue: 'Received a payment',
  erpTakeAdvance: 'Took an advance', erpSaveProduct: 'Saved a product', erpSetProductStatus: 'Changed a product’s status',
  erpReceiveShipment: 'Received stock', erpReceiveStock: 'Received stock', erpAdjustStock: 'Adjusted stock',
  erpStockCount: 'Saved a stock count', erpExpenseAdd: 'Wrote an expense', erpExpenseVoid: 'Struck out an expense',
  erpAddPerson: 'Added a staff member', erpRevokePerson: 'Withdrew a person’s access', erpResetCode: 'Gave a new code',
  erpApproveDevice: 'Allowed a device', erpAllowDevice: 'Allowed a device', erpDenyDevice: 'Refused a device',
  erpRevokeDevice: 'Signed a device out', erpConfigSet: 'Changed a setting', erpSaveCourierKeys: 'Changed the courier keys',
  erpCapitalEntryAdd: 'Wrote in the capital book', erpCapitalClose: 'Closed a month', erpCapitalReopen: 'Reopened a closed month', erpNoteAdd: 'Wrote a note', erpSerialsAdd: 'Numbered units', erpJobOpen: 'Opened a repair job', erpExport: 'Exported a list to Excel', erpUserInvite: 'Invited a user', erpAlertRulesSave: 'Changed the alerts', erpPlatformCreate: 'Created the business (platform admin)', erpPlatformSuspend: 'Suspended the business (platform admin)', erpPlatformResume: 'Resumed the business (platform admin)', erpPlatformOwnerReset: 'Sent the owner a password reset (platform admin)', erpUserSet: 'Changed a user’s role or access', erpSessionEnd: 'Ended a session', erpSignOutAll: 'Signed a user out everywhere', erpImport: 'Imported from a spreadsheet', erpJobSave: 'Updated a repair job', erpJobPay: 'Received a payment on a repair job', erpSerialSetup: 'Changed a product’s warranty', erpSerialWarranty: 'Changed a sold unit’s warranty', erpExpressLink: 'Put a consignment number on an invoice', erpCheckDeliveries: 'Checked deliveries with the courier', erpNoteVoid: 'Struck out a note', erpProductPhoto: 'Changed a product photo', erpFamilyApply: 'Grouped colours into families', erpFamilyClear: 'Took a family apart', erpPoolEntryAdd: 'Wrote in the pool’s book',
  erpPoolClose: 'Closed a pool month', erpPoolCreate: 'Started a joint pool', erpPoolJoin: 'Joined a joint pool',
  erpPartnerCompany: 'Created a partner company', erpAccessKeyNew: 'Made an access link', erpSupplierPay: 'Paid a supplier', erpSupplierBill: 'Wrote a supplier bill', erpCashTransfer: 'Moved money between accounts', erpCashAdjust: 'Corrected an account after counting', erpAccessKeyRevoke: 'Switched an access link off', erpCreateBusiness: 'Added a business', erpBackupRun: 'Made a backup',
  erpSaveCostRows: 'Changed product costs', erpAiKeyCreate: 'Made an AI access key',
};
export function actionWords(name) {
  if (WORDS[name]) return WORDS[name];
  const s = String(name).replace(/^erp/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The activity log, newest first. */
export async function erpSecurity(ctx, payload) {
  const n = Math.min(500, Math.max(50, Math.round(Number(payload && payload.limit) || 200)));
  const rows = await ctx.tx`
    select who, role, action, detail, device, ip, at from erp_activity
    where business_id = ${ctx.biz} order by at desc limit ${n}`;
  const people = {};
  for (const r of rows) {
    const k = str(r.who) || '?';
    if (!people[k]) people[k] = { name: k, role: str(r.role), last: formatDate(new Date(r.at), 'd MMM, h:mm a'), actions: 0 };
    people[k].actions++;
  }
  return {
    activity: rows.map((r) => ({ when: formatDate(new Date(r.at), 'd MMM, h:mm a'), who: str(r.who), role: str(r.role),
                                 what: actionWords(str(r.action)), signIn: str(r.action) === 'sign-in',
                                 detail: str(r.detail), device: str(r.device), ip: str(r.ip) })),
    people: Object.values(people), kept: '90 days',
  };
}

/**
 * A company for a partner: its own business, its own owner login.
 * payload: { business, ownerName, email? }
 * Plan B1: the partner gets in with a private access link of their own, tied
 * to THEIR company and login - returned here once, to hand to them. With the
 * sign-in screen on, an e-mail to choose a password is sent as well.
 * Nobody from this business becomes a member of theirs.
 */
export async function erpPartnerCompany(ctx, payload) {
  payload = payload || {};
  const business = str(payload.business), ownerName = str(payload.ownerName);
  const typed = str(payload.email).toLowerCase(), linkOnly = !!(ctx.deps && ctx.deps.linkOnly);
  // a login needs an address; with access by link alone it is never written to, so one is made up when none is given
  const email = typed || (linkOnly ? 'partner-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16) + '@link.erp.invalid' : '');
  if (!business) throw new Error('What is the partner’s company called?');
  if (business.length > 80) throw new Error('That name is too long.');
  if (!ownerName) throw new Error('Who is the owner? Type their name.');
  if (ownerName.length > 60) throw new Error('That name is too long.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Type the owner’s e-mail address.');
  if (!ctx.deps || !ctx.deps.createOwner) throw new Error('Creating a login is not available here.');

  const userId = await ctx.deps.createOwner(email, ownerName);

  // the new company is made AS its owner, so it is theirs from the first row
  const mine = JSON.stringify({ sub: ctx.s.userId, role: 'authenticated' });
  let id, key = '';
  try {
    await ctx.tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
    id = (await ctx.tx`select create_business(${business}) as id`)[0].id;
    const nctx = { ...ctx, biz: id, memo: {} };
    for (const [kind, vals] of Object.entries(SEED_LISTS)) {
      await ctx.tx`delete from lookups where business_id = ${id} and kind = ${kind}`;
      const rows = vals.map((v, i) => ({ business_id: id, kind, value: v, sort_order: i + 1 }));
      await ctx.tx`insert into lookups ${ctx.tx(rows, 'business_id', 'kind', 'value', 'sort_order')}`;
    }
    for (const [k, v] of [['business_name', business], ['currency', 'BDT'], ['default_reorder', '5'], ['default_lead_time', '7']]) {
      await setConfig(nctx, k, v);
    }
    await ctx.tx`select set_config('request.jwt.claims', ${mine}, true)`;
    // their own key: it opens THEIR login, so it shows their company and nothing of this one
    key = newKey();
    await ctx.sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(key)}, ${userId}, ${ownerName.slice(0, 60)})`;
  } catch (e) {
    // the transaction is rolled back by the caller; do not leave a login with no company behind
    try { if (ctx.deps.removeUser) await ctx.deps.removeUser(userId); } catch (_) { /* best effort */ }
    throw e;
  }

  let mailed = false;
  if (typed && !linkOnly) { try { await ctx.deps.sendReset(email); mailed = true; } catch (_) { mailed = false; } }
  return { ok: true, business, email: typed, mailed, ownerName, link: { label: ownerName, key } };
}

export const HANDLERS = { erpSecurity, erpPartnerCompany };
