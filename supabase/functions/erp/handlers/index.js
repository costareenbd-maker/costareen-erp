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
import { HANDLERS as platform } from './platform.js';

const core = {
  erpToday: shell.erpToday,
  erpGetTheme: shell.erpGetTheme,
  erpSetTheme: shell.erpSetTheme,
  erpBusinesses: shell.erpBusinesses,
  erpSetLook: shell.erpSetLook,
  erpSetBusiness: shell.erpSetBusiness,

  erpCatalog: catalog.erpCatalog,
  erpSettingsLists: catalog.erpSettingsLists,
  erpFormOptions: catalog.erpFormOptions,
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
                                              expenses, weborders, quotes, settings, campaigns, capital, pages, goods, partners, security, alerts, access, listview, cash, suppliers, currency, notes, serials, repairs, excel, users, platform })) {
  for (const [name, fn] of Object.entries(table)) {
    if (HANDLERS[name]) throw new Error('Handler ' + name + ' is defined twice (' + group + ').');
    HANDLERS[name] = fn;
  }
}

HANDLERS.erpBundle = makeBundle(HANDLERS);
