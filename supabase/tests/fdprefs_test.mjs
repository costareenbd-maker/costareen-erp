// 118: the FilaDash look and dashboard layout follow the person (erpSetFdPrefs, erpBusinesses.fd).
// Run: TEST_SCRIPT=fdprefs_test.mjs ... erp_server_test.py
import { sql, owner, sales, check, done } from './harness.mjs';

let r = await owner('erpBusinesses', []);
check('nothing saved yet', r.ok && r.result.fd === null, r.result && r.result.fd);
r = await owner('erpSetFdPrefs', [{ theme: 'nord', accent: '#BE185D', text: 'l', density: 'compact', radius: 'sharp', pal: 'amber',
  dash: { order: ['revenue', 'net', 'stock'], hidden: { colours: 1 } } }]);
check('the owner saves a look', r.ok && r.result.fd.theme === 'nord' && r.result.fd.accent === '#be185d', r);
r = await owner('erpBusinesses', []);
const fd = r.result.fd;
check('...and every device gets it back', fd && fd.theme === 'nord' && fd.text === 'l' && fd.density === 'compact' && fd.radius === 'sharp' && fd.pal === 'amber', fd);
check('...with the dashboard layout', fd.dash && fd.dash.order.join() === 'revenue,net,stock' && fd.dash.hidden.colours === 1, fd.dash);
r = await sales('erpBusinesses', []);
check('another person keeps their own (nothing)', r.ok && r.result.fd === null, r.result.fd);
r = await sales('erpSetFdPrefs', [{ theme: '<script>', accent: 'red;background:url(x)', text: 'huge', density: 'x', radius: 'y', pal: 'a b',
  dash: { order: ['ok_1', '<b>', 'x'.repeat(40)], hidden: { '"': 1 } } }]);
check('anything odd is replaced by the defaults, never kept', r.ok && r.result.fd.theme === 'filadash' && r.result.fd.accent === '' && r.result.fd.text === 'm' &&
  r.result.fd.density === 'comfortable' && r.result.fd.radius === 'rounded' && r.result.fd.pal === 'theme' && r.result.fd.dash.order.join() === 'ok_1' && !Object.keys(r.result.fd.dash.hidden).length, r.result.fd);
r = await sales('erpSetFdPrefs', [{ dash: { order: ['c_salesDay', 'channelDonut'], hidden: {}, opts: { c_salesDay: { w: 4, t: 'bar', m: 'units' }, channelDonut: { t: 'pie' },
  bad: { w: 9, t: '<svg>', m: 'x y' }, '<i>': { w: 2 } } } }]);
check('card sizes, chart types and measures are kept (fd-45)', r.ok && r.result.fd.dash.opts.c_salesDay.w === 4 && r.result.fd.dash.opts.c_salesDay.t === 'bar' &&
  r.result.fd.dash.opts.c_salesDay.m === 'units' && r.result.fd.dash.opts.channelDonut.t === 'pie', r.result.fd.dash);
check('...but no unknown size, chart or odd key', !r.result.fd.dash.opts.bad && !r.result.fd.dash.opts['<i>'], r.result.fd.dash.opts);
r = await sales('erpSetFdPrefs', [{ dash: { order: Array.from({ length: 90 }, (_, i) => 'c_' + i), hidden: {} } }]);
check('a long dashboard (90 cards) is kept whole', r.ok && r.result.fd.dash.order.length === 90, r.result.fd.dash.order.length);
r = await owner('erpBusinesses', []);
check('the owner\'s look is untouched by that', r.result.fd.theme === 'nord', r.result.fd);
await done();
