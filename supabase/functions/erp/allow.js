// Minimum role for each action - copied verbatim from ERP.js ERP_ALLOW (build b261002-1321).
// Anything not listed is refused with "Unknown action", which the page reads
// as "this page is older than the server" (UI:8083).

export const ERP_ROLES = {
  owner:       { label: 'Owner',       rank: 4 },
  shareholder: { label: 'Shareholder', rank: 3 },
  manager:     { label: 'Manager',     rank: 2 },
  sales:       { label: 'Sales',       rank: 1 },
};

export const ERP_DISCOUNT_CAP = { owner: 100, shareholder: 100, manager: 100, sales: 20 };

// 001 called the lowest role `staff`; it is the sheet's `sales`.
export function normRole(r) {
  const v = String(r || '').trim().toLowerCase();
  return v === 'staff' ? 'sales' : v;
}

export function roleAtLeast(role, needed) {
  const a = ERP_ROLES[normRole(role)], b = ERP_ROLES[needed];
  return !!(a && b && a.rank >= b.rank);
}

export const ERP_ALLOW = {
  // everyone who is signed in at all
  erpBundle: 'sales', erpCatalog: 'sales', erpFormOptions: 'sales',
  erpLookupCustomer: 'sales', erpCreateInvoice: 'sales',
  erpRecentInvoices: 'sales', erpCustomers: 'sales', erpSaveCustomer: 'sales',
  erpDaySales: 'sales', erpProduct: 'sales', erpGetTheme: 'sales',
  erpSetTheme: 'sales', erpToday: 'sales', erpDiscontinued: 'sales',

  // running the shop
  erpReceiveStock: 'manager', erpReceiveShipment: 'manager',
  erpAdjustStock: 'manager', erpStockHistory: 'manager',
  erpSaveProduct: 'manager', erpSetProductStatus: 'manager',
  erpWebOrders: 'manager', erpEnterWebOrder: 'manager',
  erpMarkWebOrderEntered: 'manager', erpWebOrderInvoices: 'manager', erpSettingsLists: 'manager',

  // the money
  erpCostBook: 'manager', erpSaveCostRows: 'manager',
  erpSaveCostSettings: 'manager', erpVoidInvoice: 'owner',
  erpSettingsFull: 'manager', erpLookupAdd: 'manager',
  erpLookupRemove: 'manager', erpConfigSet: 'shareholder',
  erpApplyReorderLevels: 'shareholder', erpTool: 'shareholder',
  erpMergeCustomers: 'shareholder', erpSelfTest: 'shareholder',
  erpBusinesses: 'sales', erpSetBusiness: 'manager',
  erpPeople: 'shareholder', erpAddPerson: 'shareholder',
  erpApproveDevice: 'shareholder', erpRevokePerson: 'shareholder',
  erpDashboardData: 'shareholder', erpLookupUsage: 'shareholder',
  erpDues: 'manager', erpRecordPayment: 'manager', erpRebuildDues: 'shareholder',
  erpMoney: 'shareholder', erpCourier: 'manager', erpLinkWebOrder: 'manager',
  erpReorderPlan: 'manager',
  erpSales: 'sales', erpInvoicePdf: 'sales',
  erpReturnPreview: 'manager', erpReturnGoods: 'manager', erpFixInvoice: 'manager',
  erpCancelInvoice: 'manager',
  erpPoCreate: 'manager', erpPoList: 'manager', erpPoClose: 'manager', erpPoArrive: 'manager',
  erpPoLineClose: 'manager', erpPoDiffDecide: 'manager', erpPoSettle: 'shareholder',
  erpPnl: 'shareholder',
  erpSfPayouts: 'manager', erpSfPayoutLines: 'manager', erpSfConfirmMatches: 'manager',
  erpCustomerStatement: 'sales', erpStatementPdf: 'sales', erpDueReminded: 'sales',
  erpQuoteBoot: 'sales', erpQuoteList: 'sales', erpQuoteGet: 'sales', erpQuoteSave: 'sales',
  erpQuoteDuplicate: 'sales', erpQuoteAsset: 'sales', erpBrandLogo: 'sales',
  erpBrandLogoClear: 'shareholder', erpQuoteSnippetsSave: 'manager',
  erpQuoteSettingsSave: 'shareholder', erpQuoteProfileSave: 'shareholder',
  erpQuoteAssetUpload: 'shareholder',
  erpQuoteItemsImport: 'shareholder', erpLetterheadSave: 'shareholder',
  erpCampaignAudience: 'manager', erpCampaignCreate: 'manager', erpCampaignGet: 'manager',
  erpCampaignList: 'manager', erpCampaignMark: 'manager', erpCampaignOptOut: 'manager',
  erpWaProductPdf: 'manager',
  erpEvoSetup: 'owner', erpEvoQr: 'owner', erpEvoLogout: 'owner', erpEvoStatus: 'manager',
  erpProductListShare: 'manager', erpShareFile: 'manager', erpEvoUpload: 'manager',
  erpEvoCampaignStart: 'manager', erpEvoSendBatch: 'manager',
  // record pages and search (redesign phase 2)
  erpInvoice: 'sales', erpCustomerPage: 'sales', erpSearch: 'sales',
  // product page and stock count (redesign phase 3)
  erpProductPage: 'sales', erpStockCount: 'manager',
  erpProductPhoto: 'manager', erpProductPhotoUrl: 'sales', erpProductThumbs: 'sales',
  erpFamilies: 'manager', erpFamilyApply: 'manager', erpFamilyClear: 'manager',
  erpNotes: 'sales', erpNoteAdd: 'sales', erpNoteVoid: 'manager', erpNoteFileUrl: 'sales',
  erpExport: 'manager', erpImport: 'manager',
  erpPlatform: 'sales', erpPlatformCreate: 'sales', erpPlatformSuspend: 'sales', erpPlatformOwnerReset: 'sales', erpPlatformErrors: 'sales',
  erpUsers: 'owner', erpUserInvite: 'owner', erpUserSet: 'owner', erpUserPowers: 'owner', erpUserResend: 'owner', erpSessions: 'sales', erpSessionEnd: 'sales', erpSignOutAll: 'sales',
  erpJobs: 'sales', erpJob: 'sales', erpJobOpen: 'sales', erpJobSave: 'sales', erpJobPay: 'manager',
  erpSerialSetup: 'manager', erpSerialsAdd: 'manager', erpSerialsFor: 'sales', erpSerialLookup: 'sales', erpSerialWarranty: 'shareholder',
  erpCapital: 'shareholder', erpCapitalHolderSave: 'owner', erpCapitalHolderEnd: 'owner',
  erpCapitalEntryAdd: 'owner', erpCapitalEntryVoid: 'owner', erpCapitalClose: 'owner', erpCapitalReopen: 'owner',
  erpExpenses: 'shareholder', erpExpenseAdd: 'shareholder', erpExpenseVoid: 'owner',
  erpExpenseItemSave: 'shareholder', erpExpenseItemEnd: 'shareholder',
  erpExpenseFixedPay: 'shareholder', erpExpenseRecurringSet: 'shareholder',
  erpExpenseExport: 'shareholder',
  // redesign phase 4: own categories, receipts, the month behind the P&L, partnership
  erpExpenseCategory: 'owner', erpExpenseReceipt: 'shareholder', erpExpenseReceiptUrl: 'shareholder',
  erpPnlMonth: 'shareholder',
  // redesign phase 5
  erpSecurity: 'owner', erpPartnerCompany: 'owner',
  // redesign phase 6
  erpCustomerList: 'sales', erpAlerts: 'manager', erpConnections: 'owner', erpGoogle: 'owner', erpSheet: 'owner', erpRestorePreview: 'owner', erpRestore: 'owner', erpWebMatches: 'manager', erpInstalls: 'sales', erpInstallInvite: 'sales', erpInstallSet: 'sales', erpInstallRetry: 'sales', erpInstallUpdate: 'sales', erpInstallToken: 'sales', erpInstallDomain: 'sales', erpInstallBridge: 'sales', erpBrand: 'sales', erpBrandSet: 'sales', erpInstallHealth: 'sales', erpNews: 'sales', erpNewsAdd: 'sales', erpNewsEnd: 'sales', erpComplianceView: 'sales', erpComplianceLog: 'sales', erpProviderKey: 'owner', erpMarket: 'sales', erpMarketMine: 'owner', erpMarketSave: 'owner', erpCodCollected: 'sales', erpRecovery: 'owner', erpEmergencyLink: 'owner', erpOwnerChange: 'owner', erpOwnerChangeAnswer: 'owner', erpOwnerChanges: 'owner', erpOwnerChangeCancel: 'owner', erpBusinessDelete: 'owner', erpBusinessesDeleted: 'sales', erpBusinessRestore: 'sales', erpConnStatus: 'sales', erpParcelLabels: 'sales', erpDeliveryOptions: 'sales', erpDeliveryOptionsSave: 'manager', erpWebMatchSet: 'manager', erpWebMatchClear: 'manager', erpShopKey: 'owner', erpSheetCreate: 'owner', erpSheetStop: 'owner', erpSheetSyncNow: 'owner', erpGoogleStart: 'owner', erpGoogleDisconnect: 'owner', erpGoogleCopyAll: 'owner', erpQuotePdfSave: 'sales', erpWebsiteSet: 'owner', erpWebsiteTest: 'owner', erpWebsiteSync: 'owner', erpRisks: 'manager', erpAlertRules: 'shareholder', erpAlertRulesSave: 'owner', erpAlertPhone: 'owner',
  // access by private link
  erpAccessKeys: 'owner', erpAccessKeyNew: 'owner', erpAccessKeyRevoke: 'owner',
  // the list view (look 2); each list checks its own role as well
  erpListView: 'sales',
  erpSetLook: 'sales', erpSetLang: 'sales', erpProfile: 'sales', erpProfileSave: 'sales', erpBg: 'sales', erpBgSave: 'manager', erpBgOff: 'sales', erpGame: 'sales', erpGameSet: 'owner', erpArena: 'sales', erpArenaResult: 'sales', erpArenaWorldSet: 'owner', erpWooConnectStart: 'owner', erpFighters: 'sales', erpFightersSet: 'owner', erpDocLang: 'sales', erpBnWords: 'sales', erpBnWordsSet: 'manager',
  erpFreezeSaleCosts: 'owner',
  // currencies (plan A5)
  erpCurrencies: 'manager', erpCurrencySave: 'manager',
  // suppliers and what is owed to them (plan A4)
  erpSuppliers: 'manager', erpSupplierPage: 'manager', erpSupplierSave: 'manager', erpSupplierBill: 'shareholder',
  erpSupplierPay: 'shareholder', erpSupplierVoid: 'owner',
  // money accounts (plan A3)
  erpCashBook: 'shareholder', erpCashSetup: 'owner', erpCashAccountSave: 'owner', erpCashMapSave: 'owner',
  erpCashTransfer: 'shareholder', erpCashAdjust: 'owner', erpCashMoveVoid: 'owner', erpCashReassign: 'owner',
  erpPartnership: 'shareholder', erpPartnerStock: 'shareholder', erpSharedStock: 'manager', erpPoolCatalog: 'sales',
  erpPoolCreate: 'owner', erpPoolInvite: 'owner', erpPoolJoin: 'owner', erpPoolEntryAdd: 'owner',
  erpPoolEntryRemove: 'owner', erpPoolClose: 'owner', erpPoolTier: 'owner', erpPoolShare: 'owner',
  erpPartnerDeal: 'owner',
  erpBookParcel: 'manager', erpParcelPreview: 'manager', erpBookedParcels: 'manager', erpExpressLink: 'sales', erpCheckDeliveries: 'manager',
  erpParcelHandled: 'manager', erpParcelPutBack: 'manager',
  erpCourierSetKeys: 'owner', erpCourierKeyStatus: 'manager', erpCourierTest: 'owner',
  erpBackupStatus: 'owner', erpBackupRun: 'owner', erpSfReconDecide: 'shareholder',
  erpSettleDue: 'manager', erpCustomerAccount: 'sales', erpPayReasons: 'manager',
  erpTakeAdvance: 'manager', erpCustomerCredit: 'sales',
  erpResetCode: 'shareholder', erpDevices: 'shareholder',
  erpAllowDevice: 'shareholder', erpDenyDevice: 'shareholder',
  erpRevokeDevice: 'shareholder',
  erpAccessWarning: 'shareholder', erpBusinessLinks: 'shareholder',
  erpAdmin: 'shareholder',
  erpAiKeys: 'owner', erpAiKeyCreate: 'owner', erpAiKeySet: 'owner',
  erpLeadsAdd: 'manager', erpLeadRemove: 'manager', erpCampaignPause: 'manager',
  erpEvoStopHook: 'owner',
  erpCampMsgSave: 'manager', erpCampGroupSave: 'manager', erpLeadSave: 'manager',
  erpCampaignRetry: 'manager', erpEvoSendTest: 'manager',

  // ownership: creating businesses and handing out links
  erpCreateBusiness: 'owner', erpDeployBusiness: 'owner',
  erpCheckBusinessSheet: 'owner', erpPrepareTemplate: 'owner',
  erpForgetBusiness: 'owner',
};

// Calls that only read (ERP_READS, ERP.js:168). Every other call is taken to
// have changed the books, and throws the kept dashboard away.
export const ERP_READS = /^(erpBundle|erpHello|erpMe|erpCatalog|erpSales|erpDues|erpCustomers|erpPnl|erpMoney|erpToday|erpDaySales|erpProduct|erpLookupCustomer|erpCustomerAccount|erpCustomerStatement|erpCustomerCredit|erpStatementPdf|erpWebOrders|erpWebOrderInvoices|erpCampaignAudience|erpCampaignList|erpCampaignGet|erpEvoStatus|erpEvoQr|erpBrandLogo|erpQuoteBoot|erpQuoteList|erpQuoteGet|erpQuoteAsset|erpExpenses|erpExpenseExport|erpCapital|erpBackupStatus|erpAiKeys|erpGetTheme|erpSetTheme|erpBusinesses|erpStockHistory|erpReorderPlan|erpPoList|erpSfPayouts|erpSfPayoutLines|erpBookedParcels|erpParcelPreview|erpReturnPreview|erpInvoicePdf|erpSettingsFull|erpSettingsLists|erpFormOptions|erpCostBook|erpAdmin|erpPeople|erpDevices|erpCourierKeyStatus|erpPayReasons|erpSelfTest|erpDiscontinued|erpAccessWarning|erpBusinessLinks|erpLookupUsage|erpRecentInvoices|erpCourier|erpWaProductPdf|erpProductListShare|erpShareFile|erpDashboardData|erpInvoice|erpCustomerPage|erpSearch|erpProductPage|erpPnlMonth|erpExpenseReceiptUrl|erpPartnership|erpPartnerStock|erpSecurity|erpCustomerList|erpAlerts|erpAccessKeys|erpListView|erpCurrencies|erpSharedStock|erpPoolCatalog|erpProductThumbs|erpProductPhotoUrl|erpFamilies|erpNotes|erpNoteFileUrl|erpSerialsFor|erpSerialLookup|erpJobs|erpJob|erpUsers|erpSessions|erpPlatform|erpPlatformErrors|erpRisks|erpAlertRules|erpConnections|erpWebsiteTest|erpGoogle|erpSheet|erpRestorePreview|erpWebMatches|erpDeliveryOptions|erpParcelLabels|erpConnStatus|erpRecovery|erpOwnerChange|erpOwnerChanges|erpBusinessesDeleted|erpBnWords|erpProfile|erpBg|erpGame|erpArena|erpFighters|erpInstalls|erpBrand|erpNews|erpComplianceLog|erpProviderKey|erpMarket|erpMarketMine|erpCashBook|erpSuppliers|erpSupplierPage|erpCurrencies)$/;

// ---- abilities per person (058_user_powers.sql) -----------------------------------------------
// Each ability is a group of calls that share one minimum role (the ability's `min`). A person
// gets it from their role, unless the owner switched it on or off for them (memberships.powers).
// An owner always has everything. Calls outside every ability keep the plain role rule.
export const ERP_POWERS = [
  { id: 'dash', label: 'Dashboard', help: 'The dashboard with sales, profit and stock value', min: 'shareholder',
    calls: ['erpDashboardData'] },
  { id: 'costs', label: 'Product cost', help: 'Buying prices, the cost page, currency rates', min: 'manager',
    calls: ['erpCostBook', 'erpSaveCostRows', 'erpSaveCostSettings', 'erpCurrencySave'] },
  { id: 'lists', label: 'Settings: drop-down lists', help: 'Categories, brands, payment methods', min: 'manager',
    calls: ['erpSettingsFull', 'erpLookupAdd', 'erpLookupRemove'] },
  { id: 'profit', label: 'Profitability', help: 'Profit and loss, month by month', min: 'shareholder',
    calls: ['erpPnl', 'erpPnlMonth'] },
  { id: 'expenses', label: 'Expenses', help: 'See and add expenses', min: 'shareholder',
    calls: ['erpExpenses', 'erpExpenseAdd', 'erpExpenseReceipt', 'erpExpenseReceiptUrl', 'erpExpenseExport',
      'erpExpenseItemSave', 'erpExpenseItemEnd', 'erpExpenseFixedPay', 'erpExpenseRecurringSet'] },
  { id: 'stock', label: 'Stock and receiving', help: 'Receive goods, adjust and count stock', min: 'manager',
    calls: ['erpReceiveStock', 'erpReceiveShipment', 'erpAdjustStock', 'erpStockHistory', 'erpStockCount',
      'erpReorderPlan', 'erpSerialsAdd', 'erpSerialSetup'] },
  { id: 'suppliers', label: 'Suppliers and purchase orders', help: 'Suppliers, place and receive orders', min: 'manager',
    calls: ['erpSuppliers', 'erpSupplierPage', 'erpSupplierSave', 'erpPoCreate', 'erpPoList', 'erpPoClose',
      'erpPoArrive', 'erpPoLineClose', 'erpPoDiffDecide'] },
  { id: 'weborders', label: 'Web orders and parcels', help: 'Website orders, courier parcels, courier payouts', min: 'manager',
    calls: ['erpWebOrders', 'erpEnterWebOrder', 'erpMarkWebOrderEntered', 'erpWebOrderInvoices', 'erpLinkWebOrder',
      'erpWebMatches', 'erpBookParcel', 'erpParcelPreview', 'erpBookedParcels', 'erpCheckDeliveries',
      'erpParcelHandled', 'erpParcelPutBack', 'erpCourier', 'erpSfPayouts', 'erpSfPayoutLines', 'erpSfConfirmMatches'] },
  { id: 'campaigns', label: 'Campaigns', help: 'WhatsApp campaigns and leads', min: 'manager',
    calls: ['erpCampaignAudience', 'erpCampaignCreate', 'erpCampaignGet', 'erpCampaignList', 'erpCampaignMark',
      'erpCampaignOptOut', 'erpCampaignPause', 'erpCampaignRetry', 'erpLeadsAdd', 'erpLeadRemove', 'erpLeadSave',
      'erpCampMsgSave', 'erpCampGroupSave', 'erpEvoSendTest', 'erpEvoCampaignStart', 'erpEvoSendBatch', 'erpEvoUpload',
      'erpWaProductPdf', 'erpProductListShare', 'erpShareFile', 'erpEvoStatus'] },
  { id: 'products', label: 'Add and edit products', help: 'New products, prices, photos, Excel in and out', min: 'manager',
    calls: ['erpSaveProduct', 'erpSetProductStatus', 'erpProductPhoto', 'erpFamilies', 'erpFamilyApply',
      'erpFamilyClear', 'erpExport', 'erpImport'] },
  { id: 'returns', label: 'Returns and invoice fixes', help: 'Take goods back, cancel or correct a saved invoice', min: 'manager',
    calls: ['erpReturnPreview', 'erpReturnGoods', 'erpFixInvoice', 'erpCancelInvoice'] },
  { id: 'dues', label: 'Dues and payments', help: 'Customer dues, take payments and advances', min: 'manager',
    calls: ['erpDues', 'erpRecordPayment', 'erpSettleDue', 'erpTakeAdvance', 'erpPayReasons'] },
];
export const POWER_OF_CALL = {};
ERP_POWERS.forEach((p) => p.calls.forEach((c) => {
  if (ERP_ALLOW[c] !== p.min) throw new Error('allow.js: ' + c + ' is ' + ERP_ALLOW[c] + ', its ability ' + p.id + ' is ' + p.min);
  POWER_OF_CALL[c] = p.id;
}));

/** Is this ability on for this session ({role, powers})? */
export function powerOn(s, id) {
  if (!s) return false;
  if (normRole(s.role) === 'owner') return true;
  const p = ERP_POWERS.find((x) => x.id === id);
  if (!p) return false;
  const o = s.powers && s.powers[id];
  if (o === true || o === false) return o;
  return roleAtLeast(s.role, p.min);
}

/** May this session make this call? The ability decides where there is one, else the role. */
export function callAllowed(s, name) {
  const need = ERP_ALLOW[name];
  if (!need) return false;
  const p = POWER_OF_CALL[name];
  return p ? powerOn(s, p) : roleAtLeast(s.role, need);
}

/** Every ability, on or off, for the page. */
export function powersMap(s) {
  const out = {};
  ERP_POWERS.forEach((p) => { out[p.id] = powerOn(s, p.id); });
  return out;
}

/** The person's own discount limit if the owner set one, else the role's. */
export function discountCapOf(role, powers) {
  const r = normRole(role);
  if (r === 'owner') return 100;
  const d = powers && Number(powers.discount);
  if (powers && powers.discount !== undefined && powers.discount !== null && powers.discount !== '' && isFinite(d)) return Math.max(0, Math.min(100, d));
  return ERP_DISCOUNT_CAP[r] ?? 0;
}
