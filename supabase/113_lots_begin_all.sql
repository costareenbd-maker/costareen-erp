-- 113: every product's lots begin at once (found by the P5 dry run on a copy of the live data).
--
-- 107 began a product's lots the first time its stock moved. Until then the product had no lot, so the holding cost of
-- the month (shared over lots by kg x days) fell on the few products that had moved - on the copy a new 2-unit
-- shipment carried 11,114 of rent. Now every product with stock gets its 'opening' lot (cost not known: the product's
-- cost book price stands in, as before) when this runs, dated the first day of this month (Dhaka), so the whole month's
-- holding cost is shared over all the stock on the shelf. A product with no stock gets the empty marker.

create or replace function public.lots_begin_all(p_biz uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_p record; v_n int := 0; v_at timestamptz := date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka';
begin
  for v_p in select p.id from products p where p.business_id = p_biz
               and not exists (select 1 from stock_lots l where l.product_id = p.id) loop
    perform lots_begin(p_biz, v_p.id, '00000000-0000-0000-0000-000000000000'::uuid, v_at + interval '1 millisecond');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- every business, now
do $$ declare b record; begin
  for b in select id from public.businesses loop perform public.lots_begin_all(b.id); end loop;
end $$;
