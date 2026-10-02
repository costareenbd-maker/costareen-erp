-- Plan B3: a sale of a partner's own item names the product, and the stock
-- owner's books carry it as a real invoice (stock out, cost, revenue, a due
-- the partner pays). The deal remembers both.
alter table public.partner_deals add column if not exists sku        text;
alter table public.partner_deals add column if not exists invoice_no text;

-- partner_deals is written through functions only. Either side may name the
-- product while the deal is not yet confirmed; only the stock owner's side may
-- attach the invoice, once.
create or replace function public.partner_deal_note(p_deal uuid, p_sku text, p_invoice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.partner_deals;
begin
  select * into v_deal from public.partner_deals where id = p_deal for update;
  if not found then
    raise exception 'Deal not found.';
  end if;
  if not (public.is_manager(v_deal.from_business_id) or public.is_manager(v_deal.to_business_id)) then
    raise exception 'You must be a manager of one side of the deal.';
  end if;
  if coalesce(btrim(p_sku), '') <> '' and v_deal.sku is null and v_deal.confirmed_at is null then
    update public.partner_deals set sku = btrim(p_sku) where id = p_deal;
  end if;
  if coalesce(btrim(p_invoice), '') <> '' and v_deal.invoice_no is null then
    if not public.is_manager(v_deal.from_business_id) then
      raise exception 'Only the company whose stock it is can attach the invoice.';
    end if;
    update public.partner_deals set invoice_no = btrim(p_invoice) where id = p_deal;
  end if;
end $$;
revoke all on function public.partner_deal_note(uuid, text, text) from public;
grant execute on function public.partner_deal_note(uuid, text, text) to authenticated;
