// Stage 2 (docs/PLATFORM-BLUEPRINT.md section 8): the open market.
//
//   erpMarket({q, category})   the Market tab: listings from the provider's own businesses (always) and, when this
//                              business shares its own stock, from every other sharing business. Seller shown as
//                              "Supplier · <city>"; no names, no exact quantities, no cost.
//   erpMarketMine()            owner: the switch, the city, and every product with its "shared" mark
//   erpMarketSave({on, city, products: [{id, shared, mode}]})   owner: saves, then lists at once
//   marketRefresh(ctx)         copies this business's shared products into the central list (also every 15 min)
//
// The central list (erp_market_listings) is on the provider's database (deps.control); a company's own
// database holds only its choices (market_shares + business_config).

const str = (v) => String(v == null ? '' : v).trim();
const STALE_DAYS = 3;          // a seller not refreshed for this long drops out of the market
const LIMIT = 300;

/** Who is listing: the provider's own businesses are 'self', a company on the bridge its install id. */
function sourceOf(deps) {
  if (!deps || !deps.control) return null;
  const ins = deps.install || {};
  if (ins.bridged) return str(ins.id);
  if (ins.id) return null;     // an old stand-alone copy with its own server: no market there
  return 'self';
}
function needMarket(ctx) {
  const src = sourceOf(ctx.deps);
  if (!src) throw new Error('The market works only for ERPs run by the provider.');
  return src;
}
async function conf(tx, biz) {
  const rows = await tx`select key, value from business_config where business_id = ${biz} and key in ('market_share_on', 'market_city')`;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { on: m.market_share_on === '1', city: str(m.market_city) };
}
const band = (stock, reorder) => (stock <= Math.max(Number(reorder) || 0, 2) ? 'low' : 'in');

/** Copy this business's shared, in-stock products into the market (or take them all out when sharing is off). */
export async function marketRefresh(ctx) {
  const src = sourceOf(ctx.deps);
  if (!src) return { skipped: true };
  const c = await conf(ctx.tx, ctx.biz);
  const rows = c.on ? await ctx.tx`
      select p.id, p.name, p.category, p.brand, p.color, p.unit, p.sell_price, p.reorder_level, coalesce(ps.stock, 0) as stock, m.price_mode
        from market_shares m join products p on p.id = m.product_id and p.business_id = m.business_id
        left join product_stock ps on ps.product_id = p.id
       where m.business_id = ${ctx.biz} and coalesce(p.status, 'Active') = 'Active'` : [];
  const list = rows.filter((r) => Number(r.stock) > 0).map((r) => ({
    source: src, business_id: ctx.biz, product_id: r.id, name: str(r.name), category: str(r.category) || null, brand: str(r.brand) || null,
    color: str(r.color) || null, unit: str(r.unit) || null, band: band(Number(r.stock), r.reorder_level),
    price: r.price_mode === 'ask' || !(Number(r.sell_price) > 0) ? null : Number(r.sell_price), city: c.city || null,
  }));
  const ctl = ctx.deps.control;
  await ctl.begin(async (t) => {
    await t`delete from erp_market_listings where source = ${src} and business_id = ${ctx.biz}`;
    if (list.length) await t`insert into erp_market_listings ${t(list, 'source', 'business_id', 'product_id', 'name', 'category', 'brand', 'color', 'unit', 'band', 'price', 'city')}`;
  });
  return { listed: list.length, on: c.on };
}

export async function erpMarket(ctx, payload) {
  const src = needMarket(ctx);
  const p = payload || {};
  const q = str(p.q).slice(0, 80), cat = str(p.category).slice(0, 80);
  const c = await conf(ctx.tx, ctx.biz);
  const ctl = ctx.deps.control;
  const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  // the provider's stock is always visible; other sellers only to a business that shares its own
  const rows = await ctl`
    select l.name, l.category, l.brand, l.color, l.unit, l.band, l.price, l.city, l.updated_at
      from erp_market_listings l
      left join erp_tenants t on l.source <> 'self' and t.id::text = l.source
     where not (l.source = ${src} and l.business_id = ${ctx.biz})
       and l.updated_at > now() - make_interval(days => ${STALE_DAYS})
       and (l.source = 'self' or (${c.on} and t.status = 'active'))
       and (${q} = '' or l.name ilike ${like} or coalesce(l.brand, '') ilike ${like} or coalesce(l.category, '') ilike ${like})
       and (${cat} = '' or l.category = ${cat})
     order by l.name, l.price nulls last
     limit ${LIMIT + 1}`;
  const cats = await ctl`
    select distinct l.category from erp_market_listings l left join erp_tenants t on l.source <> 'self' and t.id::text = l.source
     where l.category is not null and not (l.source = ${src} and l.business_id = ${ctx.biz})
       and l.updated_at > now() - make_interval(days => ${STALE_DAYS})
       and (l.source = 'self' or (${c.on} and t.status = 'active'))
     order by 1`;
  const now = Date.now();
  return {
    sharing: c.on, city: c.city, truncated: rows.length > LIMIT,
    categories: cats.map((r) => r.category),
    items: rows.slice(0, LIMIT).map((r) => ({
      name: r.name, category: r.category, brand: r.brand, color: r.color, unit: r.unit,
      band: r.band, price: r.price == null ? null : Number(r.price),
      seller: 'Supplier' + (r.city ? ' · ' + r.city : ''),
      minutes: Math.max(0, Math.round((now - new Date(r.updated_at).getTime()) / 60000)),
    })),
  };
}

export async function erpMarketMine(ctx) {
  needMarket(ctx);
  const c = await conf(ctx.tx, ctx.biz);
  const rows = await ctx.tx`
    select p.id, p.sku, p.name, p.category, p.brand, p.sell_price, coalesce(ps.stock, 0) as stock, m.price_mode
      from products p left join product_stock ps on ps.product_id = p.id
      left join market_shares m on m.product_id = p.id and m.business_id = p.business_id
     where p.business_id = ${ctx.biz} and coalesce(p.status, 'Active') = 'Active'
     order by (m.product_id is null), p.name`;
  return {
    on: c.on, city: c.city,
    products: rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, category: r.category, brand: r.brand,
      price: Number(r.sell_price) || 0, stock: Number(r.stock), shared: !!r.price_mode, mode: r.price_mode || 'price' })),
  };
}

export async function erpMarketSave(ctx, payload) {
  needMarket(ctx);
  const p = payload || {};
  const put = (k, v) => ctx.tx`insert into business_config (business_id, key, value) values (${ctx.biz}, ${k}, ${v})
                               on conflict (business_id, key) do update set value = excluded.value, updated_at = now()`;
  if (p.on !== undefined) await put('market_share_on', p.on ? '1' : '0');
  if (p.city !== undefined) await put('market_city', str(p.city).slice(0, 40));
  let changed = 0;
  for (const x of Array.isArray(p.products) ? p.products.slice(0, 5000) : []) {
    const id = str(x && x.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    if (x.shared) {
      const mode = x.mode === 'ask' ? 'ask' : 'price';
      const r = await ctx.tx`insert into market_shares (business_id, product_id, price_mode)
                             select ${ctx.biz}, id, ${mode} from products where id = ${id} and business_id = ${ctx.biz}
                             on conflict (business_id, product_id) do update set price_mode = excluded.price_mode returning 1`;
      changed += r.length;
    } else {
      changed += (await ctx.tx`delete from market_shares where business_id = ${ctx.biz} and product_id = ${id} returning 1`).length;
    }
  }
  const c = await conf(ctx.tx, ctx.biz);
  if (c.on && !c.city) throw new Error('Write your city: buyers see "Supplier · <city>".');
  const r = await marketRefresh(ctx);
  return { on: c.on, city: c.city, changed, listed: r.listed || 0 };
}

export const HANDLERS = { erpMarket, erpMarketMine, erpMarketSave };
