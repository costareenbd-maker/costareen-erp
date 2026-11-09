-- 168 (10 Nov 2026, crit4-pay): a payment taken by a member of staff lands in the money account of the same name
-- ("Cash" -> the Cash account) when the owner's rules say nothing about that method. Row security hides money_accounts
-- from anyone below shareholder (balances are a shareholder matter), so the server could not see the account names
-- while a manager or a sales person was saving the payment, and every such payment fell into "Payments in no account".
-- This function hands back only the ids and names of the business's open accounts, to its own members, nothing else:
-- no balance, no statement. Idempotent.

create or replace function public.money_account_names(p_biz uuid)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.name
  from public.money_accounts a
  where a.business_id = p_biz
    and not coalesce(a.archived, false)
    and p_biz in (select public.my_business_ids('member'))
  order by a.sort_order, a.created_at
$$;

revoke all on function public.money_account_names(uuid) from public;
grant execute on function public.money_account_names(uuid) to authenticated;
