// WooCommerce (no plugin) and Shopify through their own APIs: settings, test, orders in, stock out, matching.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, web, deps, fnDir } from './harness.mjs';
const { runJob } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001', A1 = 'PRT-BAM-A1-001';
const stockOf = async (sku) => Number((await sql`select coalesce(ps.stock, 0) s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${B} and p.sku = ${sku}`)[0].s);
const cfg = async (k) => ((await sql`select value from business_config where business_id = ${B} and key = ${k}`)[0] || {}).value || '';
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString().slice(0, 19);

// ---------------------------------------------------------------- WooCommerce
let r = await mgr('erpWebsiteSet', [{ kind: 'woo' }]);
check('only the owner sets the website', !r.ok, r);
r = await owner('erpWebsiteSet', [{ kind: 'woo', url: 'shop.example.com/wp-admin/', key: 'cs_aaaaaaaaaaaaaaaa', secret: 'ck_bbbbbbbbbbbbbbbb' }]);
check('swapped Woo keys are caught', !r.ok && /swapped/.test(r.error), r);
r = await owner('erpWebsiteSet', [{ kind: 'woo', url: 'shop.example.com/wp-admin/', key: 'ck_aaaaaaaaaaaaaaaa', secret: 'cs_bbbbbbbbbbbbbbbb' }]);
check('Woo saved: address cleaned, keys kept as secrets, sync still off', r.ok && r.result.website.kind === 'woo' && r.result.website.url === 'https://shop.example.com' &&
  r.result.website.hasKey && !r.result.website.on && (await cfg('store_url')) === 'https://shop.example.com', r.result && r.result.website);
check('keys never come back to the page', !JSON.stringify(r.result).includes('ck_aaaa'));

const auth = 'Basic ' + Buffer.from('ck_aaaaaaaaaaaaaaaa:cs_bbbbbbbbbbbbbbbb').toString('base64');
const wooProducts = [
  { id: 11, type: 'simple', sku: PLA, name: 'Sunlu PLA Black', manage_stock: true, stock_quantity: 99, price: '1350' },
  { id: 12, type: 'simple', sku: 'WOO-A1', name: 'Bambu Lab A1 3D Printer', manage_stock: false, stock_quantity: null, price: '52000' },
  { id: 13, type: 'variable', sku: '', name: 'Mystery Spool' },
  { id: 14, type: 'simple', sku: 'NOT-OURS', name: 'Sticker Pack', manage_stock: true, stock_quantity: 4, price: '50' },
];
const wooOrders = [
  { id: 501, number: '501', status: 'processing', date_created: ago(5), payment_method_title: 'Cash on delivery', total: '1430',
    billing: { first_name: 'Woo', last_name: 'Buyer', phone: '01711000333', address_1: 'Road 2', city: 'Dhaka' }, shipping: {},
    line_items: [{ sku: PLA, name: 'Sunlu PLA Black', quantity: 1, total: '1350', total_tax: '0' }] },
  { id: 502, number: '502', status: 'processing', date_created: ago(4), payment_method_title: 'bKash', total: '52100',
    billing: { first_name: 'Printer', last_name: 'Buyer', phone: '01811000444' }, shipping: { address_1: 'Road 3', city: 'Ctg' },
    line_items: [{ sku: 'WOO-A1', name: 'Bambu Lab A1 3D Printer', quantity: 1, total: '52000', total_tax: '0' }] },
];
const batches = [];
let sawAuth = '';
web.on(/shop\.example\.com\/wp-json\/wc\/v3\/products\?per_page=1$/, (u, o) => { sawAuth = o.headers.Authorization; return { status: 200, body: [wooProducts[0]] }; });
web.on(/shop\.example\.com\/wp-json\/wc\/v3\/orders\?per_page=1$/, () => ({ status: 200, body: [] }));
web.on(/shop\.example\.com\/wp-json\/wc\/v3\/orders\?per_page=100/, () => ({ status: 200, body: wooOrders }));
web.on(/shop\.example\.com\/wp-json\/wc\/v3\/products\?per_page=100/, () => ({ status: 200, body: wooProducts }));
web.on(/shop\.example\.com\/wp-json\/wc\/v3\/products\/13\/variations/, () => ({ status: 200, body: [{ id: 131, sku: 'SPOOL-RED', manage_stock: true, stock_quantity: 2, price: '700', attributes: [{ option: 'Red' }] }] }));
web.on(/shop\.example\.com\/wp-json\/wc\/v3\/products\/batch$/, (u, o) => { batches.push(['simple', JSON.parse(o.body)]); return { status: 200, body: {} }; });
web.on(/shop\.example\.com\/wp-json\/wc\/v3\/products\/13\/variations\/batch$/, (u, o) => { batches.push(['var', JSON.parse(o.body)]); return { status: 200, body: {} }; });

r = await owner('erpWebsiteTest', []);
check('test reads the shop with Basic auth', r.ok && r.result.ok && /WooCommerce/.test(r.result.reply) && sawAuth === auth, [r, sawAuth]);

r = await owner('erpTool', ['pullOrders']);
check('check for orders now works before switching on', r.ok && /added 2/.test(r.result), r);
const w501 = (await sql`select * from web_orders where business_id = ${B} and order_no = '501'`)[0];
check('Woo order as a web order: name, phone, address, payment', w501 && w501.customer_name === 'Woo Buyer' && w501.customer_phone === '01711000333' && /Road 2, Dhaka/.test(w501.customer_address) && w501.payment === 'Cash on delivery', w501);

r = await owner('erpTool', ['previewPush']);
check('preview: nothing changed, counts said', r.ok && /Preview only/.test(r.result) && batches.length === 0, r);
// the printer is called WOO-A1 there: match it once
r = await mgr('erpWebMatches', []);
check('the shop\'s own list shows its unmatched items (from the preview)', r.ok && r.result.unmatched.some((x) => x.key === 'woo-a1' && x.orders === 1) && r.result.unmatched.some((x) => x.key === 'not-ours' && x.onSite), r.result && r.result.unmatched.map((x) => x.key));
await mgr('erpWebMatchSet', [{ key: 'woo-a1', sku: A1 }]);

r = await owner('erpWebsiteSync', [{ on: true }]);
check('switched on', r.ok && r.result.website.on, r);
const plaStock = await stockOf(PLA), a1Stock = await stockOf(A1);
r = await runJob(deps, 'websync');
const sent = batches.filter((b) => b[0] === 'simple').flatMap((b) => b[1].update);
check('the timer pushes our stock less waiting orders, and turns on stock keeping', r.Costareen && !r.Costareen.push.error &&
  sent.find((x) => x.id === 11).stock_quantity === Math.max(0, plaStock - 1) && sent.find((x) => x.id === 12).stock_quantity === Math.max(0, a1Stock - 1) && sent.find((x) => x.id === 12).manage_stock === true, [r, sent]);
check('a shop item that is not ours is never touched', !sent.some((x) => x.id === 14) && !batches.some((b) => b[0] === 'var'), batches);

// entering the Woo printer order: the matched product
r = await owner('erpEnterWebOrder', ['502']);
check('the Woo order enters as our printer', r.ok && (await stockOf(A1)) === a1Stock - 1, r);

// cancelled in Woo: picked up on the next pull
wooOrders[0].status = 'cancelled';
await runJob(deps, 'websync');
check('a cancellation in WooCommerce shows in Web orders', (await sql`select status from web_orders where business_id = ${B} and order_no = '501'`)[0].status === 'cancelled');

// bad keys are said plainly
web.on(/shop\.example\.com\/wp-json\/wc\/v3\/products\?per_page=1$/, () => ({ status: 401, body: { code: 'woocommerce_rest_cannot_view' } }));
r = await owner('erpWebsiteTest', []);
check('refused keys are said plainly', r.ok && !r.result.ok && /refused the keys/.test(r.result.error), r.result);

// ---------------------------------------------------------------- Shopify
r = await owner('erpWebsiteSet', [{ kind: 'shopify', url: 'https://admin.shopify.com/store/My-Shop/orders', key: 'shpat_0123456789abcdef' }]);
check('Shopify: the admin address becomes the shop address; changing the kind switches the sync off', r.ok && r.result.website.url === 'https://my-shop.myshopify.com' &&
  r.result.website.kind === 'shopify' && !r.result.website.on && (await cfg('website_sync_on')) === '', r.result && r.result.website);
const shopifyOrders = [{ id: 9001, order_number: 1001, name: '#1001', created_at: ago(3), financial_status: 'pending', fulfillment_status: null, cancelled_at: null,
  payment_gateway_names: ['Cash on Delivery (COD)'], total_price: '1500.00', shipping_address: { name: 'Shopi Buyer', phone: '+8801911000555', address1: 'Road 9', city: 'Sylhet' },
  line_items: [{ sku: 'SHP-PLA-BLK', title: 'PLA Black', variant_title: '1kg', name: 'PLA Black - 1kg', quantity: 1, price: '1450.00', discount_allocations: [{ amount: '100.00' }] }] }];
const sets = [];
let tokenSeen = '';
web.on(/my-shop\.myshopify\.com\/admin\/api\/[\d-]+\/shop\.json$/, (u, o) => { tokenSeen = o.headers['X-Shopify-Access-Token']; return { status: 200, body: { shop: { name: 'My Shop' } } }; });
web.on(/my-shop\.myshopify\.com\/admin\/api\/[\d-]+\/orders\.json\?limit=1/, () => ({ status: 200, body: { orders: [] } }));
web.on(/my-shop\.myshopify\.com\/admin\/api\/[\d-]+\/orders\.json\?status=any&limit=250/, () => ({ status: 200, body: { orders: shopifyOrders } }));
web.on(/my-shop\.myshopify\.com\/admin\/api\/[\d-]+\/products\.json\?limit=250&fields/, () => ({ status: 200, body: { products: [{ id: 1, title: 'PLA Black', variants: [{ sku: 'SHP-PLA-BLK', title: '1kg', inventory_item_id: 777, inventory_quantity: 50, inventory_management: 'shopify', price: '1450' }] }] },
  headers: { link: '<https://my-shop.myshopify.com/admin/api/2024-10/products.json?limit=250&page_info=abc>; rel="next"' } }));
web.on(/my-shop\.myshopify\.com\/admin\/api\/[\d-]+\/products\.json\?limit=250&page_info=abc/, () => ({ status: 200, body: { products: [{ id: 2, title: 'Gift Card', variants: [{ sku: '', title: 'Default Title', inventory_item_id: 888, inventory_quantity: 0, inventory_management: null, price: '500' }] }] } }));
web.on(/my-shop\.myshopify\.com\/admin\/api\/[\d-]+\/locations\.json$/, () => ({ status: 200, body: { locations: [{ id: 42, active: true }] } }));
web.on(/my-shop\.myshopify\.com\/admin\/api\/[\d-]+\/inventory_levels\/set\.json$/, (u, o) => { sets.push(JSON.parse(o.body)); return { status: 200, body: {} }; });

r = await owner('erpWebsiteTest', []);
check('Shopify test with the token header', r.ok && r.result.ok && r.result.reply === 'Shopify: My Shop' && tokenSeen === 'shpat_0123456789abcdef', r.result);
r = await owner('erpTool', ['pullOrders']);
const s1001 = (await sql`select * from web_orders where business_id = ${B} and order_no = '1001'`)[0];
const l1001 = (await sql`select l.* from web_order_lines l join web_orders o on o.id = l.web_order_id where o.business_id = ${B} and o.order_no = '1001'`)[0];
check('Shopify order: number without #, BD phone, discount taken off the line', r.ok && s1001 && s1001.customer_phone === '01911000555' && s1001.customer_name === 'Shopi Buyer' &&
  Number(l1001.line_total) === 1350 && /Cash on Delivery/.test(s1001.payment), [r, s1001, l1001]);
await mgr('erpWebMatchSet', [{ key: 'shp-pla-blk', sku: PLA }]);
await owner('erpWebsiteSync', [{ on: true }]);
const pla2 = await stockOf(PLA);
r = await runJob(deps, 'websync');
check('Shopify stock set at the first location, under the variant, waiting order held back; untracked items left alone', !r.Costareen.push.error && sets.length === 1 &&
  sets[0].location_id === 42 && sets[0].inventory_item_id === 777 && sets[0].available === Math.max(0, pla2 - 1), [r, sets]);
// cancelled in Shopify
shopifyOrders[0].cancelled_at = ago(1);
await runJob(deps, 'websync');
check('a cancelled Shopify order shows cancelled', (await sql`select status from web_orders where business_id = ${B} and order_no = '1001'`)[0].status === 'cancelled');

// back to the plugin: the old way still works and the store keys can be removed
r = await owner('erpWebsiteSet', [{ clearKey: true }]);
check('store keys removed, sync off', r.ok && !r.result.website.hasKey && !r.result.website.on && !(await sql`select 1 from business_secrets where business_id = ${B} and key in ('SHOPIFY_TOKEN','WOO_KEY','WOO_SECRET')`).length, r.result && r.result.website);
r = await owner('erpWebsiteSet', [{ kind: 'plugin' }]);
check('back to the Costareen plugin', r.ok && r.result.website.kind === 'plugin', r.result && r.result.website);
check('the other business untouched', !(await sql`select 1 from business_config where business_id = ${FIX.B2} and key in ('website_kind','store_url')`).length);
await done();
