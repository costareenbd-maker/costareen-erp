-- White label (installer-3): the built-in defaults no longer name Costareen. Costareen's own
-- business keeps exactly what it had, written down as its own settings first.
-- (Only that business's id; nothing happens on any other system.)
insert into public.business_config (business_id, key, value)
select b.id, 'website_api', 'https://costareen.com/wp-json/cz/v1' from public.businesses b
where b.id = '81e318e7-fbde-4fcc-9b9f-b0061fe29c14'
on conflict (business_id, key) do nothing;

insert into public.business_config (business_id, key, value)
select b.id, 'delivery_options',
  '[{"name":"Customer pickup","type":"pickup"},{"name":"Steadfast courier","type":"courier"},{"name":"Steadfast Express","type":"courier"},{"name":"Pathao Instant","type":"courier"},{"name":"Uber Instant","type":"rider"},{"name":"Costareen Delivery","type":"rider"}]'
from public.businesses b
where b.id = '81e318e7-fbde-4fcc-9b9f-b0061fe29c14'
on conflict (business_id, key) do nothing;
