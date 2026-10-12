-- ============================================================================
-- COSTAREEN ERP - redesign phase 6 (speed at scale)
-- ----------------------------------------------------------------------------
-- Run AFTER 025. Idempotent.
--
-- Every table's row-level security asked "is this person a member of the
-- row's business?" by calling is_member(business_id) once for EVERY ROW a
-- query looked at. With 16,000 invoice lines that alone was ~100 ms per query,
-- on every screen.
--
-- The question does not depend on the row. So it is now asked once per query:
-- "which businesses is this person in?" - and each row is checked against
-- that short list. The answer is built from the very same functions
-- (is_member / is_manager / is_shareholder / is_owner), so who may see and
-- change what is exactly as before. Only policies written in exactly that
-- form are touched; anything else is left as it is.
-- ============================================================================

create or replace function public.my_business_ids(p_level text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.business_id
  from public.memberships m
  where m.user_id = auth.uid()
    and case p_level
          when 'member'      then public.is_member(m.business_id)
          when 'manager'     then public.is_manager(m.business_id)
          when 'shareholder' then public.is_shareholder(m.business_id)
          when 'owner'       then public.is_owner(m.business_id)
          else false
        end
$$;

do $$
declare
  p record;
  q text;
  w text;
  pat constant text := '(public\.)?is_(member|manager|shareholder|owner)\(business_id\)';
  rep constant text := '(business_id in (select public.my_business_ids(''\2'')))';
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public' and (qual ~ pat or with_check ~ pat)
  loop
    q := regexp_replace(p.qual, pat, rep, 'g');
    w := regexp_replace(p.with_check, pat, rep, 'g');
    execute format('alter policy %I on %I.%I %s %s', p.policyname, p.schemaname, p.tablename,
                   case when q is not null then 'using (' || q || ')' else '' end,
                   case when w is not null then 'with check (' || w || ')' else '' end);
  end loop;
end $$;

revoke all on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
