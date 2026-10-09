-- Direct links from bookings and plans to their client. Integrity was already implied (the home belongs to
-- the client through the composite key to properties); the explicit keys let the Data API embed the client
-- in booking queries ("bookings?select=*,client:clients(*)").
alter table public.bookings
  add constraint bookings_client_fkey
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id);

alter table public.recurring_plans
  add constraint recurring_plans_client_fkey
  foreign key (tenant_id, client_id) references public.clients (tenant_id, id);
