// Every action the page may call, by its original name.
// The table in allow.js decides who may call it; this one decides what runs.
//
// Each screen group lives in its own file and exports HANDLERS; this file
// only gathers them. A name defined twice is a mistake and stops the build.

import * as shell from './shell.js';
import * as catalog from './catalog.js';
import * as money from './money.js';
import * as invoice from './invoice.js';
import { makeBundle } from './bundle.js';

import { HANDLERS as sales } from './sales.js';
import { HANDLERS as courier } from './courier.js';
import { HANDLERS as customers } from './customers.js';
import { HANDLERS as stock } from './stock.js';
import { HANDLERS as dashboard } from './dashboard.js';
import { HANDLERS as expenses } from './expenses.js';
import { HANDLERS as weborders } from './weborders.js';
import { HANDLERS as quotes } from './quotes.js';
import { HANDLERS as settings } from './settings.js';
import { HANDLERS as campaigns } from './campaigns.js';
import { HANDLERS as capital } from './capital.js';
import { HANDLERS as pages } from './pages.js';
import { HANDLERS as goods } from './goods.js';
import { HANDLERS as partners } from './partners.js';
import { HANDLERS as security } from './security.js';
import { HANDLERS as alerts } from './alerts.js';
import { HANDLERS as access } from './access.js';
import { HANDLERS as listview } from './listview.js';
import { HANDLERS as cash } from './cash.js';
import { HANDLERS as suppliers } from './suppliers.js';
import { HANDLERS as currency } from './currency.js';
import { HANDLERS as notes } from './notes.js';
import { HANDLERS as serials } from './serials.js';
import { HANDLERS as repairs } from './repairs.js';
import { HANDLERS as excel } from './excel.js';
import { HANDLERS as users } from './users.js';
import { HANDLERS as compliance } from './compliance.js';
import { HANDLERS as market } from './market.js';
import { HANDLERS as invoicedesign } from './invoicedesign.js';
import { HANDLERS as passport } from './passport.js';
import { HANDLERS as publicreg } from './publicreg.js';
import { HANDLERS as doctor } from './doctor.js';
import { HANDLERS as printkit } from './printkit.js';
import { HANDLERS as community } from './community.js';
import { HANDLERS as loyalty } from './loyalty.js';
import { HANDLERS as printboard } from './printboard.js';
import { HANDLERS as designdesk } from './designdesk.js';
import { HANDLERS as resellers } from './resellers.js';
import { HANDLERS as apps } from './apps.js';
import { HANDLERS as receivefile } from './receivefile.js';
import { HANDLERS as catalogue } from './catalogue.js';
import { HANDLERS as assistant } from './assistant.js';
import { HANDLERS as push } from './push.js';
import { HANDLERS as creators } from './creators.js';
import { HANDLERS as creatorportal } from './creatorportal.js';
import { HANDLERS as platform } from './platform.js';
import { HANDLERS as risk } from './risk.js';
import { HANDLERS as connections } from './connections.js';
import { HANDLERS as google } from './google.js';
import { HANDLERS as sheet } from './sheet.js';
import { HANDLERS as restore } from './restore.js';
import { HANDLERS as shop } from './shop.js';
import { HANDLERS as cod } from './cod.js';
import { HANDLERS as installer } from './installer.js';
import { HANDLERS as bizdelete } from './bizdelete.js';
import { HANDLERS as owners } from './owners.js';
import { HANDLERS as arena } from './arena.js';
import { HANDLERS as wooauth } from './wooauth.js';
import { HANDLERS as joint } from './joint.js';
import { HANDLERS as restock } from './restock.js';
import { HANDLERS as fddash } from './fddash.js';
import { HANDLERS as lots } from './lots.js';
import { HANDLERS as holding } from './holding.js';
import { HANDLERS as commission } from './commission.js';
import { HANDLERS as investorportal } from './investorportal.js';
import { HANDLERS as insight } from './insight.js';
import { HANDLERS as cashup } from './cashup.js';
import { HANDLERS as preorders } from './preorders.js';
import { HANDLERS as custextra } from './custextra.js';
import { HANDLERS as navigator } from './navigator.js';
import { HANDLERS as fd22 } from './fd22.js';
import { HANDLERS as fd20 } from './fd20.js';
import { HANDLERS as fd19 } from './fd19.js';

const core = {
  erpToday: shell.erpToday,
  erpGetTheme: shell.erpGetTheme,
  erpSetTheme: shell.erpSetTheme,
  erpBusinesses: shell.erpBusinesses,
  erpSetLook: shell.erpSetLook,
  erpSetLang: shell.erpSetLang,
  erpProfile: shell.erpProfile, erpProfileSave: shell.erpProfileSave, erpBg: shell.erpBg, erpBgSave: shell.erpBgSave, erpBgOff: shell.erpBgOff, erpGame: shell.erpGame, erpGameSet: shell.erpGameSet, erpFighters: shell.erpFighters, erpFightersSet: shell.erpFightersSet, erpFighterMine: shell.erpFighterMine, erpFighterRemove: shell.erpFighterRemove,
  erpDocLang: shell.erpDocLang,
  erpBnWords: (ctx) => shell.erpBnWords(ctx, {}),
  erpBnWordsSet: (ctx, p) => shell.erpBnWords(ctx, { set: (p && p.set) || {} }),
  erpSetBusiness: shell.erpSetBusiness,

  erpCatalog: catalog.erpCatalog,
  erpSettingsLists: catalog.erpSettingsLists,
  erpFormOptions: catalog.erpFormOptions,
  erpDeliveryOptions: catalog.erpDeliveryOptions,
  erpDeliveryOptionsSave: catalog.erpDeliveryOptionsSave,
  erpProduct: catalog.erpProduct,
  erpLookupCustomer: catalog.erpLookupCustomer,

  erpDues: money.erpDues,
  erpCustomerAccount: money.erpCustomerAccount,
  erpCustomerCredit: money.erpCustomerCredit,
  erpPayReasons: money.erpPayReasons,
  erpSettleDue: money.erpSettleDue,
  erpTakeAdvance: money.erpTakeAdvance,

  erpCreateInvoice: invoice.erpCreateInvoice,
  erpPoolCatalog: invoice.erpPoolCatalog,
};

export const HANDLERS = {};
for (const [group, table] of Object.entries({ core, sales, courier, customers, stock, dashboard,
                                              expenses, weborders, quotes, settings, campaigns, capital, pages, goods, partners, security, alerts, access, listview, cash, suppliers, currency, notes, serials, repairs, excel, users, compliance, market, invoicedesign, passport, publicreg, doctor, printkit, community, loyalty, printboard, restock, designdesk, resellers, apps, receivefile, catalogue, assistant, push, creators, creatorportal, platform, risk, connections, google, sheet, restore, shop, cod, installer, bizdelete, owners, arena, wooauth, joint, fddash, lots, holding, commission, investorportal, insight, cashup, preorders, custextra, navigator, fd22, fd20, fd19 })) {
  for (const [name, fn] of Object.entries(table)) {
    if (HANDLERS[name]) throw new Error('Handler ' + name + ' is defined twice (' + group + ').');
    HANDLERS[name] = fn;
  }
}

HANDLERS.erpBundle = makeBundle(HANDLERS);
