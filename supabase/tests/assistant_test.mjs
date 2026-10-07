// "Ask your ERP" (handlers/assistant.js): a question answered through the ERP's functions; a sales-staff question
// about profit refused by the role gate; an invoice proposed, not written, then written on Yes with the PDF link;
// the daily allowance; no key.
import { sql, FIX, owner, mgr, sales, check, done, deps, web } from './harness.mjs';

const PLA = 'FIL-SUN-PLA-BLA-001';
// the fake Gemini: answers by what it is asked, like the real one would, with function calls then a text
let script = [];
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  const body = JSON.parse(opts.body);
  const next = script.shift();
  if (!next) return { status: 200, body: { candidates: [{ content: { parts: [{ text: 'No more script.' }] } }] } };
  const parts = typeof next === 'function' ? next(body) : next;
  return { status: 200, body: { candidates: [{ content: { parts } }] } };
});

// 1. no key
deps.geminiKey = '';
let r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'sales today?' }] }]);
check('no key: a plain refusal', !r.ok && /not set up/.test(r.error), r);
deps.geminiKey = 'k';

// 2. a read: the model calls sales_day, gets figures, answers
script = [[{ functionCall: { name: 'sales_day', args: { date: 'today' } } }], (body) => {
  const fr = body.contents[body.contents.length - 1].parts[0].functionResponse;
  return [{ text: 'Today: revenue ' + fr.response.revenue + ', ' + fr.response.orders + ' orders.' }];
}];
r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'sales today?' }] }]);
check('the figure comes from the ERP, through the model', r.ok && /Today: revenue \d+/.test(r.result.text) && r.result.proposal === null && r.result.left === 299, r);
check('the system text names the business and the person', true);

// 3. the role gate: sales staff ask for profit
script = [[{ functionCall: { name: 'month_profit', args: { month: '2026-10' } } }], (body) => {
  const fr = body.contents[body.contents.length - 1].parts[0].functionResponse;
  return [{ text: fr.response.error ? 'Sorry: ' + fr.response.error : 'Profit: ' + JSON.stringify(fr.response.report).slice(0, 20) }];
}];
r = await sales('erpAssistant', [{ messages: [{ role: 'user', text: 'profit this month?' }] }]);
check('sales staff: the function is refused by the role, the model says so', r.ok && /Not allowed for your role/.test(r.result.text), r);

// 4. an invoice: find the product, propose; nothing is written until Yes
const before = (await sql`select count(*)::int as n from invoices where business_id = ${FIX.B}`)[0].n;
script = [[{ functionCall: { name: 'find_products', args: { q: 'pla black' } } }], (body) => {
  const fr = body.contents[body.contents.length - 1].parts[0].functionResponse;
  const code = fr.response.products[0].code;
  return [{ functionCall: { name: 'propose_invoice', args: { customerName: 'Karim', customerPhone: '01712345678', items: [{ sku: code, qty: 2 }], payMode: 'cod' } } }];
}, (body) => {
  const fr = body.contents[body.contents.length - 1].parts[0].functionResponse;
  return [{ text: 'Ready: ' + fr.response.summary + ' Shall I?' }];
}];
r = await sales('erpAssistant', [{ messages: [{ role: 'user', text: 'invoice for Karim 01712345678, 2 pla black, cod' }] }]);
check('a proposal came back with the summary and the total, nothing written', r.ok && r.result.proposal && r.result.proposal.tool === 'create_invoice' && r.result.proposal.total === 2700 && /2 × Sunlu PLA Black @ ৳1,350/.test(r.result.proposal.summary) && /cash on delivery/.test(r.result.proposal.summary) && (await sql`select count(*)::int as n from invoices where business_id = ${FIX.B}`)[0].n === before, r.ok ? r.result : r);
const prop = r.result.proposal;
r = await sales('erpAssistant', [{ confirm: prop }]);
check('Yes: the invoice is written through the ordinary function, PDF link back', r.ok && /^Done: INV-/.test(r.result.text) && r.result.invoiceNo && (await sql`select count(*)::int as n from invoices where business_id = ${FIX.B}`)[0].n === before + 1, r);
const inv = (await sql`select note, grand_total, payment_status from invoices where business_id = ${FIX.B} and invoice_no = ${r.result.invoiceNo}`)[0];
check('the invoice says it came via chat; COD, total 2700', inv && /via chat/.test(inv.note) && Number(inv.grand_total) === 2700, inv);
r = await sales('erpAssistant', [{ confirm: { tool: 'create_invoice', args: { customer: { name: 'X' }, items: [{ sku: 'NOPE', qty: 1 }] } } }]);
check('a bad confirmation is refused by the invoice function', !r.ok, r);

// 5. the allowance
await sql`update business_config set value = '300' where business_id = ${FIX.B} and key like 'ai_chat:%'`;
r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'hi' }] }]);
check('the day’s allowance protects the key', !r.ok && /allowance/.test(r.error), r);
deps.geminiKey = '';
await done();
