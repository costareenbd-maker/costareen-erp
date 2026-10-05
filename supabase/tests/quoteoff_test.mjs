// Quotation lines with a discount per piece (off): the amount and the totals count it, it never exceeds the rate.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { check, done, fnDir } from './harness.mjs';
const Q = await import(pathToFileURL(path.join(fnDir, 'handlers', 'quotes.js')));

const t = Q.quoteTotals({ items: [{ qty: 2, rate: 1700, off: 100 }, { qty: 1, rate: 500 }], discountType: 'Fixed', discount: 0, vat: 0, shipping: 0, advance: 0 });
check('subtotal counts the discount per piece', t.subtotal === 3700 && t.total === 3700, t);
const t2 = Q.quoteTotals({ items: [{ qty: 1, rate: 1000, off: 100 }], discountType: 'Percent', discount: 10, vat: 0, shipping: 0, advance: 0 });
check('a whole-quotation discount comes after the line discount', t2.subtotal === 900 && t2.discount === 90 && t2.total === 810, t2);
const t3 = Q.quoteTotals({ items: [{ qty: 3, rate: 200 }], discountType: 'Fixed', discount: 0, vat: 0, shipping: 0, advance: 0 });
check('lines without a discount are as before', t3.subtotal === 600, t3);
await done();
