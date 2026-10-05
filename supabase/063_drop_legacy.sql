-- Stage 1e (docs/PLATFORM-BLUEPRINT.md): a company's own database holds data, not the ERP's logic.
-- These 11 functions are left over from before the Edge Function did the work (the first Sheet bridge
-- and the first invoice/stock code). Nothing calls them any more: the server does all of it.
-- Dropped by name, every overload, WITHOUT cascade: if anything still depended on one, this stops
-- with an error instead of taking the dependant with it.
-- Kept on purpose (still used): the row-security helpers (my_business_ids...), the triggers,
-- dhaka_date, mark_dirty, are_partners and the pool/partner functions the server calls.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('pool_receive_stock', 'create_invoice', 'void_invoice', 'receive_stock', 'adjust_stock',
                         'next_invoice_no', 'sheet_products', 'sheet_stock', 'sheet_sales', 'sheet_movements',
                         'sheet_customers')
     -- callers before callees, so no drop fails on a function the next one in the list still calls
     order by array_position(array['pool_receive_stock', 'create_invoice', 'void_invoice', 'receive_stock', 'adjust_stock',
                                   'next_invoice_no', 'sheet_products', 'sheet_stock', 'sheet_sales', 'sheet_movements',
                                   'sheet_customers']::name[], p.proname)
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;
