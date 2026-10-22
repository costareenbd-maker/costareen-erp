// Minimum role for each action - copied verbatim from ERP.js ERP_ALLOW (build b261002-1321).
// Anything not listed is refused with "Unknown action", which the page reads
// as "this page is older than the server" (UI:8083).

export const ERP_ROLES = {
  owner:       { label: 'Owner',       rank: 4 },
  shareholder: { label: 'Shareholder', rank: 3 },
  manager:     { label: 'Manager',     rank: 2 },
  sales:       { label: 'Sales',       rank: 1 },
};

// owner 14 Oct 2026 (wholesale): no discount limit by default for anyone; a per-person limit set on purpose in Users still applies
export const ERP_DISCOUNT_CAP = { owner: 100, shareholder: 100, manager: 100, sales: 100 };

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
  erpMarkWebOrderEntered: 'manager', erpWebOrderInvoices: 'manager', erpSettingsLists: 'manager', erpListAddValue: 'manager',

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
  erpDashboardData: 'shareholder', erpLookupUsage: 'shareholder', erpFdDash: 'shareholder', erpFd22Analytics: 'shareholder', erpFdInventory: 'sales', erpFd19Profit: 'sales', erpFdCards: 'sales', erpInbox: 'sales', erpInboxOpen: 'sales', erpInboxSend: 'sales', erpInboxMode: 'sales', erpInboxContact: 'sales', erpInboxAssist: 'sales', erpInboxTasks: 'sales', erpInboxChannels: 'manager', erpInboxPullOld: 'manager', erpBalanceSheet: 'shareholder', erpProductFields: 'sales', erpProductFieldsSave: 'owner', erpProductAi: 'sales', erpProductAiSave: 'manager', erpSiteRead: 'owner', erpSitePages: 'manager', erpSitePageAct: 'owner', erpWebPrices: 'owner', erpWebPriceSync: 'owner', erpPoPay: 'shareholder', erpBalanceOpen: 'owner', erpInboxChannelSave: 'owner', erpInboxChannelAct: 'owner', erpInboxGoLive: 'owner', erpInboxProfile: 'manager', erpAgentDesk: 'manager', erpInboxKb: 'manager', erpShopOffers: 'manager', erpChatOrders: 'sales', erpLandingPages: 'manager', erpLandingSave: 'manager', erpLandingDrafts: 'sales', erpLandingDraftAct: 'sales', erpOrderShield: 'manager', erpOrderShieldSet: 'manager', erpPixel: 'manager', erpPixelSet: 'owner', erpPixelTest: 'owner', erpChatOrderAct: 'sales', erpInboxLeads: 'sales', erpInboxBroadcasts: 'manager', erpInboxFollowups: 'manager', erpInboxComments: 'sales', erpSavedReplies: 'sales', erpInboxStats: 'manager', erpInboxDigest: 'manager', erpAiWork: 'owner', erpInboxExport: 'sales', erpInboxGroups: 'manager', erpMetaConnect: 'owner', erpMetaStart: 'owner', erpMetaRefresh: 'owner', erpMetaUse: 'owner', erpMetaDisconnect: 'owner', erpInboxTemplates: 'owner', erpInboxFeatures: 'sales', erpInboxFeatureMap: 'sales', erpPlatformInboxPlan: 'owner', erpBookings: 'sales', erpBookingAct: 'sales',  erpLineMargins: 'sales', erpCommissionSales: 'sales', erpFdHead: 'sales', erpNavigator: 'sales', erpShipments: 'manager', erpShipment: 'manager', erpLots: 'manager', erpPoStage: 'manager', erpProductSizes: 'manager', erpLotFunding: 'shareholder', erpLotFund: 'owner', erpLotFundVoid: 'owner', erpHolding: 'shareholder', erpHoldingSave: 'owner', erpCommission: 'sales', erpShipmentLateCost: 'manager', erpInvestorLink: 'owner', erpInvestorLinkOff: 'owner', erpSystemCheck: 'shareholder', erpAnalytics: 'shareholder', erpCashUp: 'shareholder', erpCashUps: 'shareholder', erpPreorders: 'sales', erpFollowups: 'sales', erpSellers: 'sales', erpFollowupSave: 'sales', erpFollowupDone: 'sales', erpCustomerInsight: 'sales', erpCustomerErase: 'owner', erpPreorderSave: 'sales', erpPreorderPay: 'sales', erpPreorderLink: 'manager', erpPreorderFulfil: 'sales', erpPreorderCancel: 'manager', erpAskingPrices: 'manager', erpAskingSave: 'owner', erpAskingApply: 'manager', erpCommissionRuleSave: 'owner', erpCommissionRuleVoid: 'owner', erpCommissionPay: 'owner',
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
  erpPlatform: 'sales', erpPlatformCreate: 'sales', erpPlatformSuspend: 'sales', erpPlatformOwnerReset: 'sales', erpPlatformErrors: 'sales', erpPlatformJoint: 'sales',
  erpJoint: 'sales', erpJointCatalog: 'sales', erpJointStart: 'owner', erpJointProduct: 'sales', erpJointRecvCatalog: 'sales', erpJointReceive: 'sales', erpJointAsk: 'sales', erpJointSend: 'sales', erpJointGot: 'sales', erpJointAskAct: 'sales', erpJointMove: 'sales', erpJointAdjust: 'owner', erpJointBook: 'owner', erpJointSettings: 'owner', erpJointAgree: 'owner', erpJointCard: 'owner', erpJointStatementPdf: 'owner', erpRestockOffers: 'sales', erpRestockStart: 'sales', erpRestockList: 'sales', erpRestockCancel: 'sales', erpPlatformJointCopy: 'sales',
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
  erpReceiveMatch: 'manager', erpReceiveRead: 'manager', erpReceiveLearn: 'manager', erpAiReader: 'sales', erpAiReaderSet: 'sales', erpAiReaderTest: 'sales', erpProductSuggest: 'manager', erpCatalogue: 'sales', erpCatalogueAct: 'sales', erpAssistant: 'sales', erpPushList: 'manager', erpPushRulesSave: 'owner', erpAdDraft: 'owner', erpSocialPosts: 'sales', erpSocialSave: 'sales', erpSocialUpload: 'sales', erpSocialPhotos: 'sales', erpSocialCaptions: 'sales', erpSocialAct: 'sales', erpSocialAssets: 'sales', erpSocialCard: 'sales', erpSocialAiPhoto: 'sales', erpSocialScript: 'sales', erpSocialVideo: 'sales', erpSocialAssetAct: 'sales', erpSocialClipRequest: 'sales', erpSocialWebPhotos: 'manager', erpSocialAiModels: 'owner', erpSocialRules: 'sales', erpSocialPexels: 'owner', erpSocialInspo: 'sales', erpSocialLearn: 'sales', erpSocialNet: 'sales', erpSocialNetStart: 'owner', erpSocialNetToken: 'owner', erpSocialNetOff: 'owner', erpAds: 'manager', erpAdsSettings: 'owner', erpAdsInterests: 'manager', erpAdsAudience: 'owner', erpAdsPlan: 'manager', erpAdsAct: 'manager', erpSocialBridges: 'sales', erpSocialBridgeAdd: 'owner', erpSocialBridgeConnect: 'owner', erpSocialBridgeRefresh: 'manager', erpSocialBridgeRemove: 'owner', erpCreators: 'owner', erpCreatorSave: 'owner', erpCreatorShip: 'owner', erpCreatorPost: 'owner', erpCreatorProject: 'owner', erpCreatorRemove: 'owner', erpCreatorPortalLink: 'owner', erpSponsorLink: 'owner', erpCreatorRequests: 'owner', erpCreatorDecide: 'owner', erpCreatorEvents: 'owner', erpYoutubeKey: 'owner', erpCreatorRefresh: 'owner', erpCreatorProgramme: 'owner', erpCreatorInvite: 'owner', erpCreatorApprove: 'owner', erpCreatorLinkTo: 'owner', erpCreatorCatalog: 'owner', erpCreatorSources: 'owner', erpCreatorClaims: 'owner', erpCreatorReplace: 'owner', erpCreatorCatalogSet: 'owner', erpCreatorCatalogAdd: 'owner', erpCreatorCatalogRemove: 'owner', erpCreatorPreview: 'owner',
  erpApps: 'sales', erpAppSet: 'owner', erpAppQr: 'sales', erpFeedback: 'sales', erpFeedbackSend: 'sales', erpFeedbackSet: 'sales',
  erpCustomerList: 'sales', erpAlerts: 'manager', erpConnections: 'owner', erpGoogle: 'owner', erpSheet: 'owner', erpRestorePreview: 'owner', erpRestore: 'owner', erpWebMatches: 'manager', erpInstalls: 'sales', erpInstallInvite: 'sales', erpInstallSet: 'sales', erpInstallRetry: 'sales', erpInstallUpdate: 'sales', erpInstallToken: 'sales', erpMyUpdates: 'owner', erpLeads: 'sales', erpLeadForms: 'sales', erpAiBrain: 'owner', erpWatchFixDecide: 'owner', erpBrief: 'owner', erpBriefDecide: 'owner', erpBriefRunNow: 'owner', erpBriefSettings: 'owner', erpBrain: 'owner', erpBrainDraft: 'owner', erpBrainSave: 'owner', erpBrainFact: 'owner', erpEngineSwitch: 'owner', erpEngineScheduleSave: 'owner', erpEngineScheduleRun: 'owner', erpWatch: 'owner', erpWatchTargetSave: 'owner', erpWatchIssueAct: 'owner', erpWatchRunNow: 'owner', erpWatchReport: 'owner', erpEngine: 'owner', erpEngineJob: 'owner', erpEngineAsk: 'owner', erpEngineCancel: 'owner', erpEngineRetry: 'owner', erpEngineRate: 'owner', erpEngineDecide: 'owner', erpEngineClaim: 'owner', erpEngineTool: 'owner', erpEngineStep: 'owner', erpEngineDone: 'owner', erpSkills: 'owner', erpSkillLibraryInstall: 'owner', erpSkillPreview: 'owner', erpSkillInstall: 'owner', erpSkillSet: 'owner', erpSkillRemove: 'owner', erpSkillCheckUpdates: 'owner', erpSkillUpdate: 'owner', erpSkillTrending: 'owner', erpAiBrainSet: 'owner', erpAiBrainKey: 'owner', erpAiBrainModels: 'owner', erpAiBrainTest: 'owner', erpLeadFormsSet: 'manager', erpLeadResearch: 'manager', erpLeadUpsert: 'sales', erpLeadAct: 'sales', erpLeadHarvest: 'manager', erpLeadFind: 'manager', erpLeadCapture: 'sales', erpLeadImport: 'manager', erpMyUpdateToken: 'owner', erpMyUpdateRun: 'owner', erpInstallDomain: 'sales', erpInstallPwLink: 'sales', erpInstallBridge: 'sales', erpBrand: 'sales', erpBrandSet: 'sales', erpInstallHealth: 'sales', erpNews: 'sales', erpNewsAdd: 'sales', erpNewsEnd: 'sales', erpComplianceView: 'sales', erpComplianceLog: 'sales', erpProviderKey: 'owner', erpMarket: 'sales', erpMarketMine: 'owner', erpMarketSave: 'owner', erpMarketAsk: 'sales', erpMarketRequests: 'sales', erpMarketQuote: 'sales', erpMarketAccept: 'sales', erpMarketInvoice: 'sales', erpMarketReceive: 'sales', erpMarketClose: 'sales', erpMarketRate: 'sales', erpMarketHints: 'sales', erpMarketNames: 'sales', erpWanted: 'sales', erpWantedPost: 'sales', erpWantedClose: 'sales', erpWantedOffer: 'sales', erpMarketWaiting: 'sales', erpMarketTold: 'sales', erpInvoiceDesign: 'sales', erpInvoiceDesignSave: 'sales', erpInvoicePreview: 'sales', erpInvoiceSamplePdf: 'sales', erpInvoiceQrUpload: 'sales', erpWarrantyRules: 'sales', erpWarrantyRuleSave: 'sales', erpWarrantyRuleApply: 'sales', erpWarrantyRuleRemove: 'sales', erpSerialBulkSet: 'sales', erpWarrantyCard: 'sales', erpMyLink: 'sales', erpPassportSync: 'sales', erpPassportShowSeller: 'owner', erpPlatformRegister: 'sales', erpPlatformRegisterRemove: 'sales', erpPlatformLiteBlock: 'sales', erpPlatformDoctor: 'sales', erpPlatformDoctorCase: 'sales', erpPlatformDoctorSettings: 'sales', erpPlatformDoctorTipRemove: 'sales', erpPlatformCommunity: 'sales', erpPlatformIdeaSet: 'sales', erpPlatformUpdateAdd: 'sales', erpPlatformUpdateRemove: 'sales', erpPlatformGuideSet: 'sales', erpLoyalty: 'sales', erpLoyaltySave: 'manager', erpCustomerPoints: 'sales', erpPointsAdjust: 'manager', erpConsentSet: 'sales', erpRefillDue: 'sales', erpReminderSent: 'sales', erpDeliveryHistory: 'sales', erpDeliveryHistoryMany: 'sales', erpLoyaltyBackfill: 'manager', erpBoard: 'sales', erpBoardOffer: 'sales', erpBoardWithdraw: 'sales', erpBoardTake: 'sales', erpPlatformDesign: 'sales', erpPlatformDesignAct: 'sales', erpResellerProgramme: 'manager', erpResellerProgrammeSave: 'owner', erpResellerLinkSet: 'manager', erpResellerAccept: 'manager', erpResellerDecline: 'manager', erpResellerSlip: 'sales', erpResellerBook: 'sales', erpResellerPay: 'owner', erpResell: 'sales', erpResellJoin: 'manager', erpResellOrder: 'sales', erpResellCancel: 'sales', erpResellReceived: 'owner', erpPrintKit: 'sales', erpPrintSettingsSave: 'manager', erpPrinterSave: 'manager', erpSpools: 'sales', erpSpoolOpen: 'sales', erpSpoolSet: 'sales', erpPrintCost: 'sales', erpPrintJobs: 'sales', erpPrintJob: 'sales', erpPrintJobSave: 'sales', erpPrintRequests: 'sales', erpPrintRequestAnswer: 'sales', erpPrintRequestJob: 'sales', erpCodCollected: 'sales', erpRecovery: 'owner', erpEmergencyLink: 'owner', erpOwnerChange: 'owner', erpOwnerChangeAnswer: 'owner', erpOwnerChanges: 'owner', erpOwnerChangeCancel: 'owner', erpBusinessDelete: 'owner', erpBusinessesDeleted: 'sales', erpBusinessRestore: 'sales', erpConnStatus: 'sales', erpParcelLabels: 'sales', erpDeliveryOptions: 'sales', erpDeliveryOptionsSave: 'manager', erpWebMatchSet: 'manager', erpWebMatchClear: 'manager', erpShopKey: 'owner', erpSheetCreate: 'owner', erpSheetStop: 'owner', erpSheetSyncNow: 'owner', erpGoogleStart: 'owner', erpGoogleDisconnect: 'owner', erpGoogleCopyAll: 'owner', erpQuotePdfSave: 'sales', erpWebsiteSet: 'owner', erpWebsiteTest: 'owner', erpWebsiteSync: 'owner', erpRisks: 'manager', erpAlertRules: 'shareholder', erpAlertRulesSave: 'owner', erpAlertPhone: 'owner',
  // access by private link
  erpAccessKeys: 'owner', erpAccessKeyNew: 'owner', erpAccessKeyRevoke: 'owner',
  // the list view (look 2); each list checks its own role as well
  erpListView: 'sales',
  erpSetLook: 'sales', erpSetFdPrefs: 'sales', erpSetLang: 'sales', erpProfile: 'sales', erpProfileSave: 'sales', erpBg: 'sales', erpBgSave: 'manager', erpBgOff: 'sales', erpGame: 'sales', erpGameSet: 'owner', erpArena: 'sales', erpArenaResult: 'sales', erpArenaWorldSet: 'owner', erpWooConnectStart: 'owner', erpFighters: 'sales', erpFightersSet: 'owner', erpFighterMine: 'sales', erpFighterRemove: 'sales', erpDocLang: 'sales', erpBnWords: 'sales', erpBnWordsSet: 'manager',
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
export const ERP_READS = /^(erpBrief|erpBrain|erpWatch|erpEngine|erpEngineJob|erpSkills|erpAiBrain|erpAiBrainModels|erpLeadForms|erpLeads|erpLeadFind|erpLeadCapture|erpMyUpdates|erpPixel|erpLandingPages|erpLandingDrafts|erpOrderShield|erpSocialBridges|erpAds|erpAdsInterests|erpSocialNet|erpSocialLearn|erpSocialAiModels|erpSocialAssets|erpSocialPosts|erpSocialPhotos|erpInboxDigest|erpJointRecvCatalog|erpSitePages|erpBalanceSheet|erpProductFields|erpProductAi|erpMetaConnect|erpInboxFeatureMap|erpBookings|erpInboxExport|erpInbox|erpInboxOpen|erpInboxChannels|erpChatOrders|erpInboxStats|erpAiWork|erpCommissionSales|erpLineMargins|erpFdCards|erpFd19Profit|erpFdInventory|erpFd22Analytics|erpNavigator|erpSellers|erpFollowups|erpCustomerInsight|erpPreorders|erpCashUps|erpAskingPrices|erpSystemCheck|erpAnalytics|erpCommission|erpHolding|erpLotFunding|erpShipments|erpShipment|erpLots|erpFdHead|erpFdDash|erpReceiveMatch|erpAiReader|erpProductSuggest|erpCatalogue|erpPushList|erpCreators|erpCreatorPortalLink|erpSponsorLink|erpCreatorRequests|erpCreatorEvents|erpCreatorProgramme|erpCreatorPreview|erpCreatorCatalog|erpCreatorSources|erpCreatorClaims|erpApps|erpAppQr|erpFeedback|erpRestockOffers|erpRestockList|erpBundle|erpHello|erpMe|erpCatalog|erpSales|erpDues|erpCustomers|erpPnl|erpMoney|erpToday|erpDaySales|erpProduct|erpLookupCustomer|erpCustomerAccount|erpCustomerStatement|erpCustomerCredit|erpStatementPdf|erpWebOrders|erpWebOrderInvoices|erpCampaignAudience|erpCampaignList|erpCampaignGet|erpEvoStatus|erpEvoQr|erpBrandLogo|erpQuoteBoot|erpQuoteList|erpQuoteGet|erpQuoteAsset|erpExpenses|erpExpenseExport|erpCapital|erpBackupStatus|erpAiKeys|erpGetTheme|erpSetTheme|erpBusinesses|erpStockHistory|erpReorderPlan|erpPoList|erpSfPayouts|erpSfPayoutLines|erpBookedParcels|erpParcelPreview|erpReturnPreview|erpInvoicePdf|erpSettingsFull|erpSettingsLists|erpFormOptions|erpCostBook|erpAdmin|erpPeople|erpDevices|erpCourierKeyStatus|erpPayReasons|erpSelfTest|erpDiscontinued|erpAccessWarning|erpBusinessLinks|erpLookupUsage|erpRecentInvoices|erpCourier|erpWaProductPdf|erpProductListShare|erpShareFile|erpDashboardData|erpInvoice|erpCustomerPage|erpSearch|erpProductPage|erpPnlMonth|erpExpenseReceiptUrl|erpPartnership|erpPartnerStock|erpSecurity|erpCustomerList|erpAlerts|erpAccessKeys|erpListView|erpCurrencies|erpSharedStock|erpPoolCatalog|erpProductThumbs|erpProductPhotoUrl|erpFamilies|erpNotes|erpNoteFileUrl|erpSerialsFor|erpSerialLookup|erpJobs|erpJob|erpUsers|erpSessions|erpPlatform|erpPlatformErrors|erpJoint|erpJointCatalog|erpJointCard|erpRisks|erpAlertRules|erpConnections|erpWebsiteTest|erpGoogle|erpSheet|erpRestorePreview|erpWebMatches|erpDeliveryOptions|erpParcelLabels|erpConnStatus|erpRecovery|erpOwnerChange|erpOwnerChanges|erpBusinessesDeleted|erpBnWords|erpProfile|erpBg|erpGame|erpArena|erpFighters|erpInstalls|erpBrand|erpNews|erpComplianceLog|erpProviderKey|erpMarket|erpMarketMine|erpMarketRequests|erpMarketHints|erpMarketNames|erpWanted|erpInvoiceDesign|erpInvoicePreview|erpWarrantyRules|erpWarrantyCard|erpMyLink|erpPlatformRegister|erpPlatformDoctor|erpPlatformCommunity|erpMarketWaiting|erpLoyalty|erpCustomerPoints|erpRefillDue|erpDeliveryHistory|erpDeliveryHistoryMany|erpBoard|erpPlatformDesign|erpResell|erpPrintKit|erpPrintJobs|erpPrintJob|erpPrintCost|erpSpools|erpPrintRequests|erpCashBook|erpSuppliers|erpSupplierPage|erpCurrencies)$/;

// ---- abilities per person (058_user_powers.sql) -----------------------------------------------
// Each ability is a group of calls that share one minimum role (the ability's `min`). A person
// gets it from their role, unless the owner switched it on or off for them (memberships.powers).
// An owner always has everything. Calls outside every ability keep the plain role rule.
export const ERP_POWERS = [
  { id: 'dash', label: 'Dashboard', help: 'The dashboard with sales, profit and stock value', min: 'shareholder',
    calls: ['erpDashboardData', 'erpFdDash'] },
  { id: 'costs', label: 'Product cost', help: 'Buying prices, the cost page, currency rates', min: 'manager',
    calls: ['erpCostBook', 'erpSaveCostRows', 'erpSaveCostSettings', 'erpCurrencySave', 'erpShipments', 'erpShipment', 'erpLots', 'erpShipmentLateCost'] },
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
    calls: ['erpSuppliers', 'erpSupplierPage', 'erpSupplierSave', 'erpPoCreate', 'erpPoList', 'erpPoClose', 'erpPoStage',
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
    calls: ['erpSaveProduct', 'erpProductAiSave', 'erpProductSizes', 'erpSetProductStatus', 'erpProductPhoto', 'erpFamilies', 'erpFamilyApply',
      'erpFamilyClear', 'erpExport', 'erpImport'] },
  { id: 'returns', label: 'Returns and invoice fixes', help: 'Take goods back, cancel or correct a saved invoice', min: 'manager',
    calls: ['erpReturnPreview', 'erpReturnGoods', 'erpFixInvoice', 'erpCancelInvoice'] },
  { id: 'dues', label: 'Dues and payments', help: 'Customer dues, take payments and advances', min: 'manager',
    calls: ['erpDues', 'erpRecordPayment', 'erpSettleDue', 'erpTakeAdvance', 'erpPayReasons'] },
  // 15 Oct 2026: who reads and answers the customer chats - everyone by default, the owner switches it per person
  { id: 'inbox', label: 'Inbox: see chats and reply', help: 'Read customer chats, reply, take orders and bookings from a chat. Which pages each person hears is set in Inbox > Team.', min: 'sales',
    calls: ['erpInbox', 'erpInboxOpen', 'erpInboxSend', 'erpInboxMode', 'erpInboxContact', 'erpInboxAssist', 'erpInboxTasks', 'erpChatOrders', 'erpChatOrderAct',
      'erpInboxComments', 'erpBookings', 'erpBookingAct'] },
  // 15 Oct 2026: the owner's manager does every job the owner does, without seeing how the business is doing.
  { id: 'act', label: 'Every action, like the owner', help: 'Void invoices, refunds, pay suppliers, expenses, commission, held stock - all the owner can do. Still no dashboard, profit, revenue, cash balances or capital; never users or security.', min: 'owner',
    calls: [] },
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
  if (id !== 'act' && !FIGURE_POWERS.includes(id) && actsAsOwner(s)) return true;
  return roleAtLeast(s.role, p.min);
}

// ---- 'act': every action like the owner, but no figures and no say over people or keys -----
// The abilities that show how the business is doing stay with the role (or their own switch).
export const FIGURE_POWERS = ['dash', 'profit'];
// Calls an acting person still may not make: the business's figures, and who may do what.
export const NOT_ACT = new RegExp('^erp(' + [
  'Balance[A-Za-z]*', 'DashboardData', 'FdDash', 'Fd22Analytics', 'Analytics', 'Pnl', 'PnlMonth', 'Money', 'Cash[A-Za-z]*', 'Capital[A-Za-z]*',
  'Holding[A-Za-z]*', 'LotFund[A-Za-z]*', 'InvestorLink[A-Za-z]*', 'Partner[A-Za-z]*', 'Pool[A-Za-z]*',
  'Joint(Settings|Agree|Card|StatementPdf)', 'FreezeSaleCosts',
  'User[A-Za-z]*', 'Security', 'People', 'AddPerson', 'RevokePerson', 'ResetCode', 'Devices', '(Approve|Allow|Deny|Revoke)Device',
  'AccessWarning', 'BusinessLinks', 'Admin', 'AccessKey[A-Za-z]*', 'Recovery', 'EmergencyLink', 'OwnerChange[A-Za-z]*',
  'BusinessDelete', 'Restore[A-Za-z]*', 'Backup[A-Za-z]*', 'AiKey[A-Za-z]*', 'ProviderKey', 'CreateBusiness', 'DeployBusiness',
  'CheckBusinessSheet', 'PrepareTemplate', 'ForgetBusiness', 'Platform[A-Za-z]*', 'AppSet', 'Connections', 'Google[A-Za-z]*',
  'Sheet[A-Za-z]*', 'ShopKey', 'Meta[A-Za-z]*', 'Courier(SetKeys|Test)', 'WooConnectStart', 'Website(Set|Test|Sync)',
  'Evo(Setup|Qr|Logout|StopHook)', 'Inbox(ChannelSave|ChannelAct|GoLive|Templates)', 'AiWork',
].join('|') + ')$');

/** Does this person have the owner's hand for actions (the 'act' switch)? Never an owner's figures. */
export function actsAsOwner(s) {
  return !!(s && normRole(s.role) !== 'owner' && s.powers && s.powers.act === true);
}

/** The role to judge an ACTION by: 'owner' for someone with the 'act' switch, else their own. */
export function actRole(s) {
  return actsAsOwner(s) ? 'owner' : (s && s.role);
}

/** May this session make this call? The ability decides where there is one, else the role. */
export function callAllowed(s, name) {
  const need = ERP_ALLOW[name];
  if (!need) return false;
  const p = POWER_OF_CALL[name];
  if (p) return powerOn(s, p);
  if (actsAsOwner(s) && !NOT_ACT.test(name)) return true;
  return roleAtLeast(s.role, need);
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
