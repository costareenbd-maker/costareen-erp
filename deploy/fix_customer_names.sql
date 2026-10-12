-- One phone = one customer (2026-10-05): tidy the saved names, then every invoice whose phone is a saved
-- customer's carries that customer's name (the name typed on the invoice is kept in its note).
begin;
-- names: no trailing commas/colons, single spaces
update customers set name = regexp_replace(regexp_replace(btrim(name), '\s+', ' ', 'g'), '[,;:\s]+$', '')
 where business_id = '81e318e7-fbde-4fcc-9b9f-b0061fe29c14'
   and name <> regexp_replace(regexp_replace(btrim(name), '\s+', ' ', 'g'), '[,;:\s]+$', '');

with c as (
  select id, name, right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) ph
  from customers where business_id = '81e318e7-fbde-4fcc-9b9f-b0061fe29c14' and coalesce(phone, '') <> ''
), fix as (
  select i.id, i.invoice_no, i.customer_name typed, c.id cid, c.name nm
  from invoices i join c on c.ph = right(regexp_replace(i.customer_phone, '[^0-9]', '', 'g'), 10)
  where i.business_id = '81e318e7-fbde-4fcc-9b9f-b0061fe29c14' and coalesce(i.customer_phone, '') <> ''
    and (lower(btrim(i.customer_name)) <> lower(c.name) or i.customer_id is distinct from c.id)
), up as (
  update invoices i set customer_name = f.nm, customer_id = f.cid,
         note = case when lower(btrim(f.typed)) <> lower(f.nm) then btrim(coalesce(i.note, '') || ' [name typed: ' || btrim(f.typed) || ']') else i.note end
  from fix f where i.id = f.id
  returning i.invoice_no, f.nm
)
update payments p set customer = up.nm from up
 where p.business_id = '81e318e7-fbde-4fcc-9b9f-b0061fe29c14' and p.invoice_no = up.invoice_no and p.customer is distinct from up.nm;
commit;
select (select count(*) from invoices i join customers c on c.business_id = i.business_id
          and right(regexp_replace(c.phone,'[^0-9]','','g'),10) = right(regexp_replace(i.customer_phone,'[^0-9]','','g'),10)
          where i.business_id = '81e318e7-fbde-4fcc-9b9f-b0061fe29c14' and coalesce(i.customer_phone,'') <> '' and coalesce(c.phone,'') <> ''
            and lower(btrim(i.customer_name)) <> lower(c.name)) as still_different,
       (select count(*) from invoices where business_id = '81e318e7-fbde-4fcc-9b9f-b0061fe29c14' and note like '%[name typed:%') as notes_kept;
