-- Plan A6: a closed month is closed for the whole books.
--
-- capital_closed is readable by shareholders only (it holds the month's
-- profit). Every writer - a manager saving a back-dated sale included - must
-- still be stopped by the lock, so the lock date alone is given to any member
-- through this function.
create or replace function public.books_locked_through(p_business uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(c.month), '')
  from public.capital_closed c
  where c.business_id = p_business
    and p_business in (select public.my_business_ids('member'))
$$;
revoke all on function public.books_locked_through(uuid) from public;
grant execute on function public.books_locked_through(uuid) to authenticated;

-- The owner can reopen the latest closed month (the row is removed; closing again writes it anew).
drop policy if exists capital_closed_delete on public.capital_closed;
create policy capital_closed_delete on public.capital_closed for delete
  using (business_id in (select public.my_business_ids('owner')));
