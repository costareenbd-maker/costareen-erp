// Minimum role for each action - copied verbatim from ERP.js ERP_ALLOW (build b261002-1321).
// Anything not listed is refused with "Unknown action", which the page reads
// as "this page is older than the server" (UI:8083).

export const ERP_ROLES = {
  owner:       { label: 'Owner',       rank: 4 },
  shareholder: { label: 'Shareholder', rank: 3 },
  manager:     { label: 'Manager',     rank: 2 },
  sales:       { label: 'Sales',       rank: 1 },
};

export const ERP_DISCOUNT_CAP = { owner: 100, shareholder: 100, manager: 10, sales: 5 };

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
  erpCostBook: 'shareholder', erpSaveCostRows: 'shareholder',
  erpSaveCostSettings: 'shareholder', erpVoidInvoice: 'owner',
  erpSettingsFull: 'shareholder', erpLookupAdd: 'shareholder',
  erpLookupRemove: 'shareholder', erpConfigSet: 'shareholder',
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
  erpUsers: 'owner', erpUserInvite: 'owner', erpUserSet: 'owner', erpUserResend: 'owner', erpSessions: 'sales', erpSessionEnd: 'sales', erpSignOutAll: 'sales',
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
  erpCustomerList: 'sales', erpAlerts: 'manager', erpConnections: 'owner', erpGoogle: 'owner', erpSheet: 'owner', erpRestorePreview: 'owner', erpRestore: 'owner', erpWebMatches: 'manager', erpInstalls: 'sales', erpInstallInvite: 'sales', erpInstallSet: 'sales', erpInstallRetry: 'sales', erpInstallUpdate: 'sales', erpInstallToken: 'sales', erpInstallDomain: 'sales', erpCodCollected: 'sales', erpParcelLabels: 'sales', erpDeliveryOptions: 'sales', erpDeliveryOptionsSave: 'manager', erpWebMatchSet: 'manager', erpWebMatchClear: 'manager', erpShopKey: 'owner', erpSheetCreate: 'owner', erpSheetStop: 'owner', erpSheetSyncNow: 'owner', erpGoogleStart: 'owner', erpGoogleDisconnect: 'owner', erpGoogleCopyAll: 'owner', erpQuotePdfSave: 'sales', erpWebsiteSet: 'owner', erpWebsiteTest: 'owner', erpWebsiteSync: 'owner', erpRisks: 'manager', erpAlertRules: 'shareholder', erpAlertRulesSave: 'owner', erpAlertPhone: 'owner',
  // access by private link
  erpAccessKeys: 'owner', erpAccessKeyNew: 'owner', erpAccessKeyRevoke: 'owner',
  // the list view (look 2); each list checks its own role as well
  erpListView: 'sales',
  erpSetLook: 'sales', erpSetLang: 'sales', erpDocLang: 'sales', erpBnWords: 'sales', erpBnWordsSet: 'manager',
  erpFreezeSaleCosts: 'owner',
  // currencies (plan A5)
  erpCurrencies: 'manager', erpCurrencySave: 'shareholder',
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
export const ERP_READS = /^(erpBundle|erpHello|erpMe|erpCatalog|erpSales|erpDues|erpCustomers|erpPnl|erpMoney|erpToday|erpDaySales|erpProduct|erpLookupCustomer|erpCustomerAccount|erpCustomerStatement|erpCustomerCredit|erpStatementPdf|erpWebOrders|erpWebOrderInvoices|erpCampaignAudience|erpCampaignList|erpCampaignGet|erpEvoStatus|erpEvoQr|erpBrandLogo|erpQuoteBoot|erpQuoteList|erpQuoteGet|erpQuoteAsset|erpExpenses|erpExpenseExport|erpCapital|erpBackupStatus|erpAiKeys|erpGetTheme|erpSetTheme|erpBusinesses|erpStockHistory|erpReorderPlan|erpPoList|erpSfPayouts|erpSfPayoutLines|erpBookedParcels|erpParcelPreview|erpReturnPreview|erpInvoicePdf|erpSettingsFull|erpSettingsLists|erpFormOptions|erpCostBook|erpAdmin|erpPeople|erpDevices|erpCourierKeyStatus|erpPayReasons|erpSelfTest|erpDiscontinued|erpAccessWarning|erpBusinessLinks|erpLookupUsage|erpRecentInvoices|erpCourier|erpWaProductPdf|erpProductListShare|erpShareFile|erpDashboardData|erpInvoice|erpCustomerPage|erpSearch|erpProductPage|erpPnlMonth|erpExpenseReceiptUrl|erpPartnership|erpPartnerStock|erpSecurity|erpCustomerList|erpAlerts|erpAccessKeys|erpListView|erpCurrencies|erpSharedStock|erpPoolCatalog|erpProductThumbs|erpProductPhotoUrl|erpFamilies|erpNotes|erpNoteFileUrl|erpSerialsFor|erpSerialLookup|erpJobs|erpJob|erpUsers|erpSessions|erpPlatform|erpPlatformErrors|erpRisks|erpAlertRules|erpConnections|erpWebsiteTest|erpGoogle|erpSheet|erpRestorePreview|erpWebMatches|erpDeliveryOptions|erpParcelLabels|erpBnWords|erpInstalls|erpCashBook|erpSuppliers|erpSupplierPage|erpCurrencies)$/;
