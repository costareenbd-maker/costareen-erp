// erpScrub_ (ERP.js:4384): remove from a result anything this role may not
// see. Done once, here, so a new screen cannot forget it.
//
// Fix vs the original (docs/FIXES.md #1): the original deleted dashboard keys
// that the dashboard no longer used, so profit, cash and cover still reached
// sales and manager browsers. The dashboard handler now builds the figures a
// role may see in the first place; this table only backs it up.

import { roleAtLeast, powerOn } from './allow.js';

const DASH_MONEY = ['profitToday', 'profitMonth', 'profitWeek', 'profitAll', 'marginMtd',
  'stockValueCost', 'potentialProfit', 'grossProfit',
  // the keys the dashboard actually uses (docs/fixes/dashboard.md)
  'profit', 'cash', 'cover'];

// `who` is the session ({role, powers}); a bare role string still works.
export function scrub(name, out, who) {
  const sess = typeof who === 'string' ? { role: who } : (who || {});
  const role = sess.role;
  // buying prices follow the "Product cost" ability, dashboard money the "Dashboard" one
  const hideMoney = !powerOn(sess, 'costs');
  const hideDash = !powerOn(sess, 'dash');
  const hideSupplier = !roleAtLeast(role, 'manager') && !powerOn(sess, 'suppliers');
  if (!out || (!hideMoney && !hideDash && !hideSupplier && roleAtLeast(role, 'shareholder'))) return out;   // full sight

  function product(p) {
    if (!p || typeof p !== 'object') return p;
    if (hideMoney) {
      delete p.cost; delete p.cost_price; delete p.margin; delete p.profit;
      delete p.stockValueCost; delete p.landed;
    }
    if (hideSupplier) delete p.supplier;
    return p;
  }

  if (name === 'erpCatalog' && out.length) { out.forEach(product); return out; }
  if (name === 'erpProduct') return product(out);

  // Sales works in one business and should not learn the others exist.
  if (name === 'erpBusinesses' && role === 'sales' && out.businesses && out.businesses.length > 1) {
    const keep = out.businesses.filter((b) => b.id === out.active);
    out.businesses = keep.length ? keep : out.businesses.slice(0, 1);
    out.canAdd = false;
    out.single = true;
  }

  if (name === 'erpBundle') {
    if (out.catalog && out.catalog.length) out.catalog.forEach(product);
    if (out.dash && hideDash) {
      const d = out.dash;
      DASH_MONEY.forEach((k) => { if (k in d) delete d[k]; });
      (d.topProducts || []).forEach((t) => { delete t.profit; });
      (d.stockByCat || []).forEach((c) => { delete c.cost; delete c.uncosted; });
      d.hideProfit = true;
    }
    if (out.costs && hideMoney) delete out.costs;
    return out;
  }
  if (name === 'erpDashboardData' && hideDash) {
    ['profitToday', 'profitMonth', 'stockValueCost', 'potentialProfit'].forEach((k) => {
      if (k in out) delete out[k];
    });
    out.hideProfit = true;
    return out;
  }
  return out;
}
