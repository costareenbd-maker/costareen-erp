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
  erpBrainDraft: 'Asked the Engine to draft the Business Brain', erpBrainSave: 'Changed or approved the Business Brain', erpBrainFact: 'Added or removed a fact in the Business Brain',
  erpEngineSwitch: 'Switched the Engine on or off for this business',
  erpEngineScheduleSave: 'Changed a timed job of the Engine', erpEngineScheduleRun: 'Ran a timed job of the Engine now', erpWatchTargetSave: 'Changed the pages the Watchdog checks', erpWatchIssueAct: 'Resolved, ignored or reopened a Watchdog issue', erpWatchRunNow: 'Ran the Watchdog checks now',
  erpEngineAsk: 'Gave the Engine a job', erpEngineCancel: 'Stopped an Engine job', erpEngineRetry: 'Sent an Engine job again', erpEngineRate: 'Rated an Engine job', erpEngineDecide: 'Answered an Engine proposal (Yes writes it)', erpSkillLibraryInstall: 'Installed a skill from the library', erpSkillPreview: 'Read a skill link from GitHub', erpSkillInstall: 'Installed skills from GitHub', erpSkillSet: 'Switched a skill on or off or changed its agents', erpSkillRemove: 'Uninstalled a skill', erpSkillCheckUpdates: 'Checked the skills for updates', erpSkillUpdate: 'Updated a skill from GitHub', erpSkillTrending: 'Looked at trending skills',
  'sign-in': 'Opened the app',
  erpCreateInvoice: 'Saved an invoice', erpCancelInvoice: 'Cancelled a sale', erpVoidInvoice: 'Cancelled a sale',
  erpFixInvoice: 'Changed an invoice', erpReturnGoods: 'Took goods back', erpSettleDue: 'Received a payment',
  erpTakeAdvance: 'Took an advance', erpSaveProduct: 'Saved a product', erpSetProductStatus: 'Changed a product’s status',
  erpCommissionRuleSave: 'Set a commission rule', erpCommissionRuleVoid: 'Removed a commission rule', erpCommissionPay: 'Paid commission',
  erpFollowupSave: 'Planned a customer follow-up', erpFollowupDone: 'Did a customer follow-up', erpCustomerErase: 'Removed a customer’s personal data',
  erpPreorderSave: 'Took a pre-order', erpPreorderPay: 'Took a pre-order deposit', erpPreorderLink: 'Gave a pre-order line its product', erpPreorderFulfil: 'Handed over a pre-order', erpPreorderCancel: 'Cancelled a pre-order',
  erpCashUp: 'Counted an account (cash-up)', erpAskingSave: 'Set the asking markups', erpAskingApply: 'Set selling prices from the asking prices',
  erpInvestorLink: 'Made an investor page link', erpInvestorLinkOff: 'Switched an investor page off',
  erpShipmentLateCost: 'Added a cost after the goods',
  erpHoldingSave: 'Changed how holding cost is shared',
  erpLotFund: 'Recorded who funded a shipment', erpLotFundVoid: 'Struck out a shipment funding',
  erpPoStage: 'Moved an order along', erpProductSizes: 'Set product sizes',
  erpReceiveShipment: 'Received stock', erpReceiveStock: 'Received stock', erpAdjustStock: 'Adjusted stock',
  erpStockCount: 'Saved a stock count', erpExpenseAdd: 'Wrote an expense', erpExpenseVoid: 'Struck out an expense',
  erpAddPerson: 'Added a staff member', erpRevokePerson: 'Withdrew a person’s access', erpResetCode: 'Gave a new code',
  erpApproveDevice: 'Allowed a device', erpAllowDevice: 'Allowed a device', erpDenyDevice: 'Refused a device',
  erpRevokeDevice: 'Signed a device out', erpConfigSet: 'Changed a setting', erpSaveCourierKeys: 'Changed the courier keys',
  erpCapitalEntryAdd: 'Wrote in the capital book', erpCapitalClose: 'Closed a month', erpCapitalReopen: 'Reopened a closed month', erpNoteAdd: 'Wrote a note', erpSerialsAdd: 'Numbered units', erpJobOpen: 'Opened a repair job', erpExport: 'Exported a list to Excel', erpUserInvite: 'Invited a user', erpAlertRulesSave: 'Changed the alerts', erpWebsiteSet: 'Changed the website connection', erpGoogleStart: 'Started connecting Google Drive', erpGoogleDisconnect: 'Disconnected Google Drive', erpSheetCreate: 'Made the live backup sheet', erpRestore: 'Went back to a backup', erpWebMatchSet: 'Matched a website item to a product', erpBnWordsSet: 'Changed the Bangla words', erpEmergencyLink: 'Made a new emergency link', erpOwnerChangeAnswer: 'Answered an owner change', erpOwnerChangeCancel: 'Cancelled an owner change', erpBgSave: 'Changed the background photo', erpGameSet: 'Changed who sees the game', erpArenaResult: 'Played an online Brawl match', erpArenaWorldSet: 'Switched the Brawl arena with other companies', erpWooConnectStart: 'Started connecting the WooCommerce shop', erpFightersSet: 'Changed the game fighters', erpFighterMine: 'Made a game fighter from a photo', erpFighterRemove: 'Removed a game fighter', erpProfileSave: 'Changed own name or photo', erpBusinessDelete: 'Deleted a business (a copy was kept)', erpBusinessRestore: 'Brought back a deleted business', erpInstallInvite: 'Made an install link (platform admin)', erpInstallSet: 'Switched a company copy on or off (platform admin)', erpInstallRetry: 'Carried on a failed install (platform admin)', erpInstallUpdate: 'Updated a company copy (platform admin)', erpInstallToken: 'Replaced a company copy’s Supabase token (platform admin)', erpLeadUpsert: 'Added or changed a lead', erpAiBrainSet: 'Changed which AI does which work', erpAiBrainKey: 'Changed an AI provider key (platform admin)', erpAiBrainTest: 'Tested an AI',  erpLeadFormsSet: 'Changed the public reseller / supplier forms', erpLeadAct: 'Moved a lead on (stage, note, follow-up, given to someone, made a customer or supplier)', erpLeadHarvest: 'Brought in leads from the Inbox, landing pages, quote requests and the market', erpLeadImport: 'Imported leads from a list', erpMyUpdateToken: 'Replaced this ERP’s Supabase access token (for updates)', erpMyUpdateRun: 'Updated this ERP to the newest version', erpInstallDomain: 'Set a company copy’s web address (platform admin)', erpInstallPwLink: 'Made a password link for a company copy’s owner (platform admin)', erpInstallBridge: 'Moved a company copy onto the provider’s server (platform admin)', erpBrandSet: 'Changed the ERP name, sponsor line or logo (platform admin)', erpNewsAdd: 'Posted an announcement to every company (platform admin)', erpNewsEnd: 'Ended an announcement (platform admin)', erpComplianceView: 'Compliance check of a company (platform admin)', 'compliance-view': 'Provider compliance check (read only)', erpMarketSave: 'Changed what is shared on the market', erpMarketAsk: 'Asked a supplier on the market', erpMarketQuote: 'Gave a price to a market request', erpMarketAccept: 'Accepted a market price', erpMarketInvoice: 'Invoiced a market order', erpMarketReceive: 'Received a market order into stock', erpMarketClose: 'Closed a market request', erpMarketRate: 'Rated a market supplier', erpWantedPost: 'Posted on the wanted board', erpWantedClose: 'Closed a wanted post', erpWantedOffer: 'Offered a price on the wanted board', erpInvoiceDesignSave: 'Changed the invoice design', erpInvoiceQrUpload: 'Uploaded the invoice payment QR', erpWarrantyRuleSave: 'Set a warranty rule', erpWarrantyRuleApply: 'Applied a warranty rule to the products', erpWarrantyRuleRemove: 'Removed a warranty rule', erpSerialBulkSet: 'Set serial numbers and warranty on products', erpPassportSync: 'Published sold serials to the register', erpMarketTold: 'Told a waiting buyer a product is back', erpPrintSettingsSave: 'Changed the print rates', erpPrinterSave: 'Added or changed a printer', erpSpoolOpen: 'Opened a spool for printing', erpSpoolSet: 'Corrected a spool', erpPrintJobSave: 'Saved a print job', erpPrintRequestAnswer: 'Answered a print request', erpPrintRequestJob: 'Made a print job from a request', erpRestockStart: 'Kept an order waiting and asked the market for the missing goods', erpRestockCancel: 'Cancelled a waiting order', erpResellerProgrammeSave: 'Changed the reseller programme', erpResellerLinkSet: 'Answered a reseller (approved, declined or paused)', erpResellerAccept: 'Accepted a reseller order and invoiced it', erpResellerDecline: 'Declined a reseller order', erpResellerBook: 'Booked the parcel of a reseller order', erpResellerPay: 'Paid a reseller\u2019s commission', erpResellJoin: 'Asked a supplier to sell for them', erpResellOrder: 'Placed a reseller order', erpResellCancel: 'Cancelled a reseller order', erpResellReceived: 'Confirmed a commission received', erpPlatformDesignAct: 'Acted on the design desk (a designer blocked or unblocked, a link issued, a request removed)', erpBoardOffer: 'Offered a price on a Get-it-printed job', erpBoardWithdraw: 'Withdrew an offer on a Get-it-printed job', erpBoardTake: 'Made a print job from a Get-it-printed job', erpLoyaltySave: 'Changed the points rules', erpLoyaltyBackfill: 'Counted past invoices for points', erpPointsAdjust: 'Gave or redeemed customer points', erpConsentSet: 'Recorded a customer’s answer about reminders', erpReminderSent: 'Sent a refill reminder', erpPlatformIdeaSet: 'Answered or removed an idea on the ideas board (platform admin)', erpPlatformUpdateAdd: 'Wrote a public update (platform admin)', erpPlatformUpdateRemove: 'Took down a public update (platform admin)', erpPlatformGuideSet: 'Added or changed a guide (platform admin)', erpPlatformDoctorCase: 'Answered or removed a Print Doctor case (platform admin)', erpPlatformDoctorSettings: 'Approved or removed shared settings on the Print Doctor (platform admin)', erpPlatformDoctorTipRemove: 'Removed a Print Doctor tip (platform admin)', erpPlatformRegisterRemove: 'Removed a public registration from the register (platform admin)', erpPlatformLiteBlock: 'Blocked or unblocked a Lite seller (platform admin)', erpPassportShowSeller: 'Changed how the shop shows on the register', erpInstallHealth: 'Checked a company\u2019s connection (platform admin)', erpCodCollected: 'Marked a cash-on-delivery sale delivered and collected', erpDeliveryOptionsSave: 'Changed the delivery options', erpWebMatchClear: 'Unmatched a website item', erpShopKey: 'Changed the website door key', erpSheetStop: 'Stopped the live backup sheet', erpWebsiteSync: 'Switched the website sync on or off', erpPlatformCreate: 'Created the business (platform admin)', erpPlatformSuspend: 'Suspended the business (platform admin)', erpPlatformJoint: 'Switched joint stock on or off (platform admin)', erpJointStart: 'Set up joint stock (a pool or a partner company)', erpJointProduct: 'Added or changed a joint product', erpJointReceive: 'Received stock into a joint pool', erpJointAdjust: 'Corrected a joint pool’s stock', erpJointMove: 'Moved joint stock from one partner’s shelf to the other’s', erpJointBook: 'Wrote in a joint pool’s money book', erpJointSettings: 'Changed a joint pool’s settings', erpJointAgree: 'Agreed (or took back agreeing) a joint month', erpJointStatementPdf: 'Made a joint stock statement', erpPlatformResume: 'Resumed the business (platform admin)', erpPlatformOwnerReset: 'Sent the owner a password reset (platform admin)', erpUserSet: 'Changed a user’s role or access', erpUserPowers: 'Changed a user’s abilities', erpSessionEnd: 'Ended a session', erpSignOutAll: 'Signed a user out everywhere', erpImport: 'Imported from a spreadsheet', erpJobSave: 'Updated a repair job', erpJobPay: 'Received a payment on a repair job', erpSerialSetup: 'Changed a product’s warranty', erpSerialWarranty: 'Changed a sold unit’s warranty', erpExpressLink: 'Put a consignment number on an invoice', erpCheckDeliveries: 'Checked deliveries with the courier', erpNoteVoid: 'Struck out a note', erpProductPhoto: 'Changed a product photo', erpFamilyApply: 'Grouped colours into families', erpFamilyClear: 'Took a family apart', erpPoolEntryAdd: 'Wrote in the pool’s book', erpPlatformJointCopy: 'Switched joint stock on or off for a company copy (platform admin)',
  erpInboxChannelSave: 'Connected or changed an Inbox channel', erpInboxChannelAct: 'Switched an Inbox channel or its AI', erpInboxGoLive: 'Took an Inbox channel live',
  erpInboxSend: 'Replied in the Inbox', erpInboxPullOld: 'brought in old chats', erpBalanceOpen: 'Opened the books (balance sheet start)', erpPoPay: 'Paid a supplier for an order', erpProductAiSave: 'Wrote what the AI says about a product', erpSiteRead: 'Read the website for the AI', erpWebPrices: 'Sent ERP prices to the website (or looked)', erpWebPriceSync: 'Switched website prices following the ERP', erpSitePageAct: 'Added or skipped a website page for the AI', erpProductFieldsSave: 'Chose the product details for the AI', erpInboxMode: 'Took over or handed back an Inbox chat', erpInboxProfile: 'Changed the AI agent’s business details',
  erpAgentDesk: 'Changed the AI agent’s rules', erpChatOrderAct: 'Acted on a chat order', erpLandingSave: 'Saved a landing page', erpLandingDraftAct: 'Acted on an unfinished order', erpListAddValue: 'Added a value to a list (from the product form)', erpOrderShieldSet: 'Changed the order shield (block list, risky orders, our-fault returns)', erpPixelSet: 'Changed the Meta pixel settings', erpPixelTest: 'Sent a test event to the Meta pixel', erpSocialSave: 'Saved a social post', erpSocialAct: 'Acted on a social post', erpSocialUpload: 'Uploaded a picture or video for a post', erpSocialCard: 'Made a picture card', erpSocialAiPhoto: 'Made an AI photo', erpSocialScript: 'Had a reel script written', erpSocialVideo: 'Started a video', erpSocialAssetAct: 'Removed a made picture or video', erpSocialClipRequest: 'Asked staff for a clip', erpSocialWebPhotos: 'Fetched product pictures from the website', erpSocialRules: 'Changed the posting rules', erpSocialPexels: 'Set the stock-footage key', erpSocialInspo: 'Added or removed an inspiration', erpSocialNetToken: 'Connected a social account', erpSocialNetOff: 'Disconnected a social account', erpAdsSettings: 'Changed the paid-ads settings', erpAdsAudience: 'Sent the customer audience to Meta (hashed)', erpAdsPlan: 'Built an ad campaign (paused)', erpAdsAct: 'Started, paused or stopped an ad campaign', erpSocialBridgeAdd: 'Added a posting bridge', erpSocialBridgeRemove: 'Removed a posting bridge', erpSocialBridgeRefresh: 'Read a posting bridge again', erpBookingAct: 'Acted on a booking', erpInboxBroadcasts: 'Saved or sent a broadcast',
  erpInboxFeatures: 'Switched Inbox features', erpMetaStart: 'Started Connect with Facebook', erpMetaRefresh: 'Read again what the Facebook login reaches', erpMetaUse: 'Made an Inbox channel from the Facebook login', erpMetaDisconnect: 'Disconnected Facebook', erpInboxTemplates: 'Asked Meta for the message templates or checked them', erpInboxGroups: 'Changed the Inbox team groups or a teammate\u2019s channels', erpPlatformInboxPlan: 'Set a company’s Inbox plan (platform admin)',
  erpPoolClose: 'Closed a pool month', erpPoolCreate: 'Started a joint pool', erpPoolJoin: 'Joined a joint pool',
  erpPartnerCompany: 'Created a partner company', erpAccessKeyNew: 'Made an access link', erpSupplierPay: 'Paid a supplier', erpSupplierBill: 'Wrote a supplier bill', erpCashTransfer: 'Moved money between accounts', erpCashAdjust: 'Corrected an account after counting', erpAccessKeyRevoke: 'Switched an access link off', erpCreateBusiness: 'Added a business', erpBackupRun: 'Made a backup',
  erpSaveCostRows: 'Changed product costs', erpAiKeyCreate: 'Made an AI access key', erpAppSet: 'Switched an app on or off', erpReceiveLearn: 'Taught the ERP a supplier’s product names', erpReceiveRead: 'Read a photo of a supplier document with the AI reader', erpAiReaderSet: 'Changed the AI reader\u2019s key (platform admin)', erpAiReaderTest: 'Tested the AI reader\u2019s key (platform admin)', erpCatalogueAct: 'Changed the master catalogue (platform admin)', erpAssistant: 'Used the chat assistant', erpFeedbackSend: 'Sent feedback to the provider', erpFeedbackSet: 'Answered feedback (platform admin)', erpPushRulesSave: 'Changed the What-to-push rules', erpAdDraft: 'Asked the AI to write an advertisement', erpCreatorSave: 'Added or changed a creator', erpCreatorShip: 'Recorded filament given to a creator', erpCreatorPost: 'Recorded a creator’s post', erpCreatorProject: 'Recorded a creator’s project', erpCreatorRemove: 'Removed a creator line', erpCreatorDecide: 'Answered a creator’s filament request', erpYoutubeKey: 'Changed the YouTube key', erpCreatorRefresh: 'Fetched YouTube numbers for creators’ videos', erpCreatorInvite: 'Invited a creator (sign-in link or e-mail)', erpCreatorApprove: 'Approved or declined a creator', erpCreatorLinkTo: 'Changed where a creator\u2019s project link goes', erpCreatorCatalogSet: 'Showed or hid a product for creators', erpCreatorReplace: 'Booked sponsorship rolls replaced by the brand', erpCreatorCatalogAdd: 'Added products creators may request', erpCreatorCatalogRemove: 'Removed a product creators could request',
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
