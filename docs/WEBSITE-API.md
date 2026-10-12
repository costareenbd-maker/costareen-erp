# Connecting any website to the ERP (the "open door")

For shops that are not WordPress + the Costareen sync plugin: PHP, Laravel, Node, a Shopify or
Wix app, anything that can make an HTTPS request **from its server**.

## The key

ERP → Settings → Connections → **Any website — open door** → *Make the website key*.
It is shown once (the ERP keeps only a hash). Put it in the website's server settings, e.g.
an environment variable `ERP_SHOP_KEY`. Never put it in the page's JavaScript: whoever has it
can send orders and read stock. Making a new key stops the old one at once.

Every call: header `x-shop-key: <key>`. Address:
`https://oqzcuuytytqadqjlwdsh.supabase.co/functions/v1/erp?shop=<what>`

| Call | Method | Body | Answer |
|---|---|---|---|
| `?shop=ping` | GET | – | `{ok, business}` |
| `?shop=stock` | GET | – | `{ok, count, items:[{sku, name, qty, price}]}` |
| `?shop=order` | POST | one order (below) | `{ok, order, added, duplicate, unmatched:[...]}` |
| `?shop=products` | POST | `{items:[{sku, name, price, barcode}]}` (≤ 5000) | `{ok, received, matched, unmatched}` |

Refusals: `401` bad/missing key, `400` with `error` saying what is wrong, `404/405` wrong call.

### An order

```json
{
  "number": "1001",                 // the website's order number: no spaces, ≤ 60 characters
  "created": "2026-10-03T10:00:00",
  "status": "processing",           // send the order again with "cancelled" to cancel it
  "customer": "Name", "phone": "01711000000", "address": "Road, area, city",
  "payment": "Cash on delivery",    // COD / bKash / Nagad / card ... decides paid or pending
  "total": 1430,                    // whole order incl. delivery; total − items = delivery charge
  "items": [ { "sku": "ABC-1", "name": "Product name", "qty": 1, "line_total": 1350, "barcode": "" } ]
}
```

Sending the same order again never doubles it (order number + SKU are kept once); a new
status is taken over. The order appears under **Web orders**; a person enters it, which makes
the invoice and deducts stock — exactly like the plugin's orders.

### Stock

`qty` = stock in the ERP minus website orders not entered yet (cancelled ones are not held),
never below 0. Products linked under another website SKU appear twice: under the ERP's SKU and
under the website's own SKU, with the same qty. Poll every 10–15 minutes.

## When the website's SKUs differ from the ERP's

Nothing is guessed. A website item matches a product when:
1. a person linked it once (Web orders → **Match website products**) — remembered for good;
2. the SKU is the same (capitals and spaces ignored);
3. the barcode is the same (also when the website puts the barcode in its SKU field).

Everything else waits in *Match website products* with the three closest names suggested
(by words and letters, so "Bambu Lab" finds "Bambulab"; a different size such as 1kg/3kg is
held back). Items with no SKU are matched and remembered by their name. Sending
`?shop=products` once lets the owner match the whole list before the first order arrives.
