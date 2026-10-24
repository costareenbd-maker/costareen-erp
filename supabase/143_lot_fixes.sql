-- 143 fix-1 (24 Oct 2026, the partner's odd-case report, batch 1 "stock and returns"):
--   H1  a return comes back at the cost it LEFT at: when the lot's cost was raised since (a late cost), the returned units
--       go into a lot of their own at their old cost (same place in the FIFO line), so the late cost is not counted twice
--   H3  a movement can name the lot it takes from (stock_movements.from_lot): "undo a receipt" takes the very units it put in
--   M6  only a real customer return (a return note: invoice_id set) reverses a sale's draws; a hand adjustment that happens
--       to say "Return: INV-..." is an ordinary adjustment
--   M7  a sale dated in the past takes from the lots that were on the shelf then, before lots received after it; a unit
--       taken from a lot that arrived after the sale's date counts as leaving on the day it arrived (never a negative
--       holding time, and the shipment's sell-through stays in order)
alter table public.stock_movements add column if not exists from_lot uuid;

create or replace function public.lots_follow() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_left numeric; v_take numeric; v_lot record; v_draw record; v_orig uuid; v_cost numeric; v_src text;
  v_lotcost numeric; v_lotat timestamptz; v_newlot uuid;
begin
  if new.kind::text = 'MOVE' then return new; end if;
  perform lots_begin(new.business_id, new.product_id, new.id, new.created_at);

  if new.direction = 'OUT' then
    v_left := new.qty;
    -- the named lot first (undo of a receipt), then the lots that were on the shelf at the movement's time, oldest first
    for v_lot in select * from stock_lots where product_id = new.product_id and qty_left > 0
                 order by (id is distinct from new.from_lot), (received_at > new.created_at), received_at, seq for update loop
      exit when v_left <= 0;
      v_take := least(v_left, v_lot.qty_left);
      update stock_lots set qty_left = qty_left - v_take where id = v_lot.id;
      insert into lot_draws (business_id, movement_id, lot_id, product_id, qty, unit_cost, at)
      values (new.business_id, new.id, v_lot.id, new.product_id, v_take, v_lot.unit_cost, greatest(new.created_at, v_lot.received_at));
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      insert into lot_draws (business_id, movement_id, lot_id, product_id, qty, unit_cost, at)
      values (new.business_id, new.id, null, new.product_id, v_left, null, new.created_at);
    end if;
    return new;
  end if;

  -- IN
  v_left := new.qty;
  if new.kind::text = 'RETURN' then
    if new.invoice_id is not null and new.reference like 'Return: %' then
      select id into v_orig from invoices
        where business_id = new.business_id and invoice_no = btrim(substr(new.reference, 9)) limit 1;
    end if;
    if v_orig is not null then
      for v_draw in select d.* from lot_draws d join stock_movements m on m.id = d.movement_id join stock_lots sl on sl.id = d.lot_id
                    where m.invoice_id = v_orig and m.direction = 'OUT' and d.product_id = new.product_id
                      and d.qty > 0 and d.qty - d.reversed > 0
                    order by d.at desc, sl.received_at desc, sl.seq desc for update of d loop
        exit when v_left <= 0;
        v_take := least(v_left, v_draw.qty - v_draw.reversed);
        update lot_draws set reversed = reversed + v_take where id = v_draw.id;
        select unit_cost, received_at into v_lotcost, v_lotat from stock_lots where id = v_draw.lot_id;
        if v_lotcost is not distinct from v_draw.unit_cost then
          update stock_lots set qty_left = qty_left + v_take where id = v_draw.lot_id;
          v_newlot := v_draw.lot_id;
        else
          -- H1: the lot's cost changed since these units left (a late cost): they come back at their own cost
          insert into stock_lots (business_id, product_id, movement_id, source, reference, received_at, qty_in, qty_left, unit_cost)
          values (new.business_id, new.product_id, new.id, 'return', new.reference, v_lotat, v_take, v_take, v_draw.unit_cost)
          returning id into v_newlot;
        end if;
        insert into lot_draws (business_id, movement_id, lot_id, product_id, qty, unit_cost, of_draw, at)
        values (new.business_id, new.id, v_newlot, new.product_id, -v_take, v_draw.unit_cost, v_draw.id, new.created_at);
        v_left := v_left - v_take;
      end loop;
      if v_left > 0 then
        select nullif(l.unit_cost, 0) into v_cost from invoice_lines l
          where l.invoice_id = v_orig and l.product_id = new.product_id and l.qty > 0 order by l.line_no limit 1;
      end if;
    end if;
    v_src := 'return';
  elsif new.kind::text = 'RECEIVE' then
    v_src := 'receive'; v_cost := nullif(new.unit_price, 0);
  elsif new.kind::text = 'OPENING' then
    v_src := 'opening'; v_cost := nullif(new.unit_price, 0);
  else
    v_src := 'adjust';
  end if;
  if v_left > 0 then
    insert into stock_lots (business_id, product_id, movement_id, source, reference, supplier, received_at, qty_in, qty_left, unit_cost)
    values (new.business_id, new.product_id, new.id, v_src, new.reference, nullif(new.supplier, ''), new.created_at, v_left, v_left, v_cost);
  end if;
  return new;
end $$;

-- H1: a lot made for returned units belongs to the return movement; when that movement is removed its draws go first
-- (lots_unfollow subtracts them), then the lot (as for a received lot). Nothing else changes in lots_unfollow.
