// A past day on the Dashboard shows its gross profit (shareholder and owner); others see the average order.
import { owner, mgr, check, done } from './harness.mjs';
const PLA = 'FIL-SUN-PLA-BLA-001';
let r = await owner('erpCreateInvoice', [{ customer: { name: 'Day Buyer', phone: '01711000666' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full', paymentMethod: 'Cash' }]);
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
r = await owner('erpDaySales', [day]);
check('the owner sees the day\'s gross profit and margin', r.ok && typeof r.result.gross === 'number' && r.result.gross === r.result.revenue - 2 * 900 && r.result.margin > 0, r.result);
r = await mgr('erpDaySales', [day]);
check('a manager does not see profit', r.ok && r.result.gross === undefined && r.result.revenue > 0, r.result);
await done();
